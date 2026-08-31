import type {
  Block,
  GeneratedSpec,
  ProductReference,
  RecommendationBasis,
} from './component-spec.js';
import type { SignalDigest } from './signal-digest.js';
import type { Bundle, Product, TrackingInput } from './tracking-input.js';

/**
 * Reconciliation — the boundary between what the model said and what renders.
 *
 * Schema validation guarantees shape. It cannot guarantee truth: a well-formed
 * spec can still name a product that does not exist, one the shopper told us
 * they dislike, one that sold out since the candidate set was assembled, or
 * claim the shopper viewed something they never saw. This pass is where those
 * become impossible.
 *
 * Nothing here trusts the model. A generation that survives every rule and
 * still has nothing to show degrades to `isUsable: false`, and the caller renders
 * the deterministic component instead.
 *
 * Repair, not rejection, is the default. A slightly clipped headline is a better
 * outcome for the shopper than a discarded generation, so text is truncated and
 * unverifiable claims are downgraded. Only an empty result fails outright.
 */

/**
 * Length ceilings, applied by truncation. These live here rather than in the
 * schema because a provider's strict structured-output mode rejects string
 * length bounds — see the note in `component-spec.ts`.
 */
const CLAMP = {
  headline: 90,
  subheadline: 140,
  blockTitle: 80,
  reason: 120,
  badge: 24,
  ctaLabel: 32,
  bannerText: 160,
  copyBody: 420,
  rationale: 300,
} as const;

/** More than this and the component stops being a component. */
const MAX_BLOCKS = 4;

export interface ReconcileResult {
  spec: GeneratedSpec;
  /** True when something survived that is worth rendering. */
  isUsable: boolean;
  /** Machine-readable notes on what was removed or changed, for evaluation. */
  violations: string[];
}

function clamp(value: string, limit: number): string {
  const collapsed = value.trim().replace(/\s+/g, ' ');
  if (collapsed.length <= limit) return collapsed;

  // The ellipsis counts against the limit, so leave room for it. Otherwise a
  // clamped string is one character longer than the cap it was clamped to.
  const cut = collapsed.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[.,;:!?-]+$/, '')}…`;
}

function clampNullable(value: string | null, limit: number): string | null {
  if (value === null) return null;
  const clamped = clamp(value, limit);
  return clamped.length === 0 ? null : clamped;
}

interface Allowlist {
  /** SKUs the model may place. */
  allowed: Set<string>;
  /** SKUs that must never be placed, whatever the model decided. */
  blocked: Set<string>;
}

/**
 * SKUs that must never be recommended, whatever chose them.
 *
 * Exported because the deterministic selector applies the same rule when it
 * picks. Two copies of "never recommend these" would drift, and the pair that
 * drifted would be the model path and the fallback path — the two whose
 * comparability the whole evaluation depends on.
 */
export function neverRecommend(digest: SignalDigest): Set<string> {
  const blocked = new Set<string>([
    ...digest.dislikedSkus,
    ...digest.purchasedSkus,
    ...digest.cartSkus,
  ]);
  if (digest.currentSku) blocked.add(digest.currentSku);
  return blocked;
}

function buildAllowlist(input: TrackingInput, digest: SignalDigest): Allowlist {
  const allowed = new Set<string>();
  for (const product of input.candidates) {
    // An out-of-stock candidate is not a recommendation, it is a dead end.
    if (product.isInStock) allowed.add(product.sku);
  }

  // Blocked structurally rather than by asking the model nicely. The prompt
  // says not to place these; this is what makes it true when it ignores us.
  return { allowed, blocked: neverRecommend(digest) };
}

/**
 * Checks the model's stated reason for a pick against the shopper's actual
 * signals.
 *
 * `basis` is a factual claim — "you viewed this", "this goes with your cart" —
 * and the model has every incentive to reach for the most flattering one. A
 * claim we cannot support becomes `popular`, which asserts nothing, and the
 * prose that stated it is dropped along with it.
 */
function verifyBasis(basis: RecommendationBasis, product: Product, digest: SignalDigest): boolean {
  switch (basis) {
    case 'most_viewed':
      return digest.topViewed.some((viewed) => viewed.sku === product.sku);
    case 'complements_cart':
      return digest.cartSkus.length > 0;
    case 'complements_purchase':
      return digest.purchasedSkus.length > 0;
    case 'liked_category':
      return digest.categoryAffinity.some((affinity) => affinity.category === product.category);
    case 'similar_to_current':
      return digest.currentCategory === product.category;
    case 'popular':
      // Makes no claim about this shopper, so there is nothing to check.
      return true;
  }
}

/**
 * The running state of one reconciliation pass: what has been placed, how much
 * of the item budget is left, and what was changed along the way.
 *
 * This is deliberately one named thing rather than three parameters threaded
 * through every function. The budget and the de-duplication set are global to a
 * spec, not to a block, which is the part that is easy to get wrong.
 */
function createPlacementTracker(maxItems: number) {
  const placedSkus = new Set<string>();
  const violations: string[] = [];
  let remaining = maxItems;

  return {
    violations,
    get remaining() {
      return remaining;
    },
    hasPlaced: (sku: string) => placedSkus.has(sku),
    record(violation: string) {
      violations.push(violation);
    },
    place(sku: string) {
      placedSkus.add(sku);
      remaining -= 1;
    },
  };
}

type PlacementTracker = ReturnType<typeof createPlacementTracker>;

/**
 * Decides whether one SKU may be placed, and names the reason when it may not.
 * Does not consume budget — the caller does that once it commits.
 *
 * Order matters. The budget is checked last because it is the least specific
 * cause: a hallucinated SKU that arrives after the budget is spent is still a
 * hallucination, and reporting it as `budget:dropped` would understate how
 * often the model invents products. These strings are the evaluation signal,
 * so each one has to name the fault that actually fired.
 */
function rejectionFor(sku: string, allowlist: Allowlist, tracker: PlacementTracker): string | null {
  // Either hallucinated or out of stock. Either way it cannot render.
  if (!allowlist.allowed.has(sku)) return `unknown-sku:${sku}`;
  if (allowlist.blocked.has(sku)) return `blocked-sku:${sku}`;
  if (tracker.hasPlaced(sku)) return `duplicate-sku:${sku}`;
  if (tracker.remaining <= 0) return `budget:dropped:${sku}`;
  return null;
}

function reconcileItems(
  items: ProductReference[],
  allowlist: Allowlist,
  candidatesBySku: Map<string, Product>,
  digest: SignalDigest,
  tracker: PlacementTracker,
): ProductReference[] {
  const kept: ProductReference[] = [];

  for (const item of items) {
    const rejection = rejectionFor(item.sku, allowlist, tracker);
    if (rejection) {
      tracker.record(rejection);
      continue;
    }

    const product = candidatesBySku.get(item.sku);
    // rejectionFor already proved the SKU is an in-stock candidate.
    if (!product) continue;

    tracker.place(item.sku);

    const hasSupportedBasis = verifyBasis(item.basis, product, digest);
    if (!hasSupportedBasis) tracker.record(`unsupported-basis:${item.basis}:${item.sku}`);

    kept.push({
      sku: item.sku,
      basis: hasSupportedBasis ? item.basis : 'popular',
      // The prose exists to state the basis. If the basis did not hold, the
      // prose is a claim we just decided is untrue.
      reason: hasSupportedBasis ? clampNullable(item.reason, CLAMP.reason) : null,
      badge: clampNullable(item.badge, CLAMP.badge),
      emphasis: item.emphasis,
    });
  }

  return kept;
}

// The shop knows which sets exist. This only picks the one that fits the
// shopper best out of what the shop already offered.
function chooseBundle(
  bundles: readonly Bundle[],
  allowlist: Allowlist,
  digest: SignalDigest,
  candidatesBySku: Map<string, Product>,
): Bundle | undefined {
  let best: Bundle | undefined;
  let bestScore = -1;

  for (const bundle of bundles) {
    // Stock is the bar, not the whole blocked set: a set is meant to hold what
    // is in the cart or on the page. A thumbs-down still keeps the set out.
    let isPlaceable = true;
    for (const sku of bundle.skus) {
      if (!allowlist.allowed.has(sku)) isPlaceable = false;
      if (digest.dislikedSkus.includes(sku)) isPlaceable = false;
    }
    if (!isPlaceable) continue;

    // In the cart beats recently viewed, which beats the category being looked
    // at. Every step checks something we hold.
    let score = 0;
    for (const sku of bundle.skus) {
      if (digest.cartSkus.includes(sku)) score += 4;
      else if (digest.topViewed.some((viewed) => viewed.sku === sku)) score += 2;
      else if (candidatesBySku.get(sku)?.category === digest.currentCategory) score += 1;
    }

    if (score > bestScore) {
      best = bundle;
      bestScore = score;
    }
  }

  return best;
}

function reconcileBlock(
  block: Block,
  allowlist: Allowlist,
  candidatesBySku: Map<string, Product>,
  digest: SignalDigest,
  bundles: readonly Bundle[],
  tracker: PlacementTracker,
): Block | null {
  switch (block.kind) {
    case 'hero': {
      let sku = block.sku;
      if (sku !== null) {
        const rejection = rejectionFor(sku, allowlist, tracker);
        if (rejection) {
          tracker.record(rejection);
          // A hero without its product is still a legitimate headline.
          sku = null;
        } else {
          tracker.place(sku);
        }
      }
      // Every other block kind disappears when its content clamps to nothing.
      // A hero with no headline and no product is the same empty region, and
      // it would otherwise render above real content.
      const headline = clamp(block.headline, CLAMP.headline);
      if (headline.length === 0 && sku === null) {
        tracker.record('empty-block:hero');
        return null;
      }
      return {
        kind: 'hero',
        headline,
        body: clampNullable(block.body, CLAMP.subheadline),
        sku,
        ctaLabel: clampNullable(block.ctaLabel, CLAMP.ctaLabel),
      };
    }

    case 'grid': {
      const items = reconcileItems(block.items, allowlist, candidatesBySku, digest, tracker);
      if (items.length === 0) {
        tracker.record('empty-block:grid');
        return null;
      }
      return {
        kind: 'grid',
        title: clampNullable(block.title, CLAMP.blockTitle),
        // Never leave a grid wider than it has items to fill.
        columns: Math.min(block.columns, Math.max(2, items.length)) as 2 | 3 | 4,
        items,
      };
    }

    case 'carousel': {
      const items = reconcileItems(block.items, allowlist, candidatesBySku, digest, tracker);
      if (items.length === 0) {
        tracker.record('empty-block:carousel');
        return null;
      }
      return {
        kind: 'carousel',
        title: clampNullable(block.title, CLAMP.blockTitle),
        items,
      };
    }

    case 'banner': {
      const text = clamp(block.text, CLAMP.bannerText);
      if (text.length === 0) {
        tracker.record('empty-block:banner');
        return null;
      }
      return {
        kind: 'banner',
        tone: block.tone,
        text,
        ctaLabel: clampNullable(block.ctaLabel, CLAMP.ctaLabel),
      };
    }

    case 'copy': {
      const body = clamp(block.body, CLAMP.copyBody);
      if (body.length === 0) {
        tracker.record('empty-block:copy');
        return null;
      }
      return {
        kind: 'copy',
        title: clampNullable(block.title, CLAMP.blockTitle),
        body,
      };
    }

    case 'bundle': {
      const chosen = chooseBundle(bundles, allowlist, digest, candidatesBySku);
      if (!chosen) {
        tracker.record('no-bundle');
        return null;
      }

      for (const sku of chosen.skus) tracker.place(sku);

      return {
        kind: 'bundle',
        title: clampNullable(block.title, CLAMP.blockTitle),
        body: clampNullable(block.body, CLAMP.subheadline),
        ctaLabel: clampNullable(block.ctaLabel, CLAMP.ctaLabel),
        // The model's bundleId is ignored on purpose.
        bundleId: chosen.id,
      };
    }
  }
}

/** True when a spec contains at least one block that actually shows a product. */
function showsAnyProduct(blocks: Block[]): boolean {
  return blocks.some(
    (block) =>
      (block.kind === 'grid' && block.items.length > 0) ||
      (block.kind === 'carousel' && block.items.length > 0) ||
      (block.kind === 'hero' && block.sku !== null),
  );
}

export function reconcileSpec(
  generated: GeneratedSpec,
  input: TrackingInput,
  digest: SignalDigest,
): ReconcileResult {
  const allowlist = buildAllowlist(input, digest);
  const candidatesBySku = new Map(input.candidates.map((product) => [product.sku, product]));
  const tracker = createPlacementTracker(digest.maxItems);

  if (generated.blocks.length > MAX_BLOCKS) {
    tracker.record(`too-many-blocks:${generated.blocks.length}`);
  }

  const blocks: Block[] = [];
  for (const block of generated.blocks.slice(0, MAX_BLOCKS)) {
    const reconciled = reconcileBlock(
      block,
      allowlist,
      candidatesBySku,
      digest,
      input.bundles,
      tracker,
    );
    if (reconciled !== null) blocks.push(reconciled);
  }

  const spec: GeneratedSpec = {
    tone: generated.tone,
    headline: clamp(generated.headline, CLAMP.headline),
    subheadline: clampNullable(generated.subheadline, CLAMP.subheadline),
    blocks,
    rationale: clamp(generated.rationale, CLAMP.rationale),
  };

  // A component that recommends nothing is worse than no component at all.
  // Recorded separately: "no products survived" and "the model returned no
  // headline" are different failures and want different fixes.
  if (!showsAnyProduct(blocks)) tracker.record('unusable:no-products');
  if (spec.headline.length === 0) tracker.record('unusable:no-headline');
  const isUsable = showsAnyProduct(blocks) && spec.headline.length > 0;

  return { spec, isUsable, violations: tracker.violations };
}
