import { verify } from '@rudra-js/attested';
import { ALLOWED_PHRASES, claimIn, hostFacts, type HostFacts } from './claim-screening.js';
import type {
  Block,
  GeneratedSpec,
  ProductReference,
  RecommendationBasis,
} from './component-spec.js';
import { engagedCategories, type SignalDigest } from './signal-digest.js';
import type { Bundle, Product, TrackingInput } from './tracking-input.js';

/**
 * Nothing here trusts the model. Repair, not rejection, is the default: text is
 * truncated and unverifiable claims are downgraded, and only an empty result
 * fails outright.
 */

/** Truncation ceilings. Not in the schema — a provider's strict mode rejects length bounds. See `component-spec.ts`. */
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
  // Not rendered anywhere — this is the SKU as it reads back in a violation.
  violationSku: 32,
} as const;

/** More than this and the component stops being a component. */
export const MAX_BLOCKS = 4;

/** The fill pass calls this too: one past the cap never renders, so nothing is worth reserving for it. */
export function capBlocks(blocks: Block[]): Block[] {
  return blocks.slice(0, MAX_BLOCKS);
}

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

  // The ellipsis counts against the limit, so leave room for it.
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
  allowed: Set<string>;
  blocked: Set<string>;
  /** A bundle is placed whole, so it checks this narrower set. See `refusedEverywhere`. */
  blockedInBundle: Set<string>;
}

/**
 * A thumbs-down, and the product on the screen right now. No block may hold one
 * of these, a bundle included.
 *
 * Read from the payload rather than the digest on purpose. `DIGEST_LIMITS`
 * trims each history to what fits in a prompt, and a shopper with thirteen
 * dislikes would otherwise be shown the thirteenth. The cap exists to bound
 * what the model is told, not what the shopper may be shown.
 */
function refusedEverywhere(input: TrackingInput): Set<string> {
  const refused = new Set<string>();
  for (const signal of input.signals.dislikes) refused.add(signal.sku);
  if (input.context.currentSku) refused.add(input.context.currentSku);

  return refused;
}

/**
 * SKUs that must never be recommended, whatever chose them.
 *
 * Everything above plus what the shopper already has, read from the payload for
 * the same reason: a shopper with nine purchases must not be sold the ninth back.
 *
 * Exported because the deterministic selector applies the same rule when it
 * picks. Two copies of "never recommend these" would drift, and the pair that
 * drifted would be the model path and the fallback path — the two whose
 * comparability the whole evaluation depends on.
 */
export function neverRecommend(input: TrackingInput): Set<string> {
  const { signals } = input;

  const blocked = refusedEverywhere(input);
  for (const signal of [...signals.lastPurchased, ...signals.cart]) {
    blocked.add(signal.sku);
  }

  return blocked;
}

function buildAllowlist(input: TrackingInput): Allowlist {
  const allowed = new Set<string>();
  for (const product of input.candidates) {
    if (product.isInStock) allowed.add(product.sku);
  }

  return {
    allowed,
    blocked: neverRecommend(input),
    blockedInBundle: refusedEverywhere(input),
  };
}

function verifyBasis(
  basis: RecommendationBasis,
  product: Product,
  digest: SignalDigest,
  engaged: ReadonlySet<string>,
): boolean {
  switch (basis) {
    case 'most_viewed':
      return digest.topViewed.some((viewed) => viewed.sku === product.sku);
    case 'complements_cart':
      return digest.cartSkus.length > 0;
    case 'complements_purchase':
      return digest.purchasedSkus.length > 0;
    case 'liked_category':
      // Affinity alone is not enough: it scores the category the shopper is
      // standing in, and standing somewhere is not liking it. That claim is
      // `similar_to_current`, which says so honestly.
      return (
        engaged.has(product.category) &&
        digest.categoryAffinity.some((affinity) => affinity.category === product.category)
      );
    case 'similar_to_current':
      return digest.currentCategory === product.category;
    case 'popular':
      // Makes no claim about this shopper, so there is nothing to check.
      return true;
  }
}

/** Anything attested reads as a numeral — ½ ² Ⅲ included, which it reports rather than ignores. */
const NUMERAL = /[\p{Nd}\p{No}\p{Nl}]/u;

const NO_FACTS: readonly string[] = [];

/** The budget and the de-duplication set are global to a spec, not to a block. */
function createPlacementTracker(maxItems: number, facts: HostFacts) {
  const placedSkus = new Set<string>();
  const violations: string[] = [];
  let remaining = maxItems;

  return {
    violations,
    facts: facts.pooled,
    factsFor: (sku: string): readonly string[] => facts.bySku.get(sku) ?? NO_FACTS,
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
 * Runs after clamping, so what is screened is exactly what would have rendered.
 *
 * Three passes, most specific first. Core's patterns name one of the five kinds; `quantity`
 * is the only proof in the stack, every numeral having to be one the shop supplied; `wording`
 * is a second denylist and the weakest, so it answers last.
 */
function screenClaim(
  value: string | null,
  field: string,
  tracker: PlacementTracker,
  facts: readonly string[] = tracker.facts,
): string | null {
  if (value === null) return null;

  const kind = claimIn(value);
  if (kind !== null) {
    tracker.record(`unverifiable-claim:${kind}:${field}`);
    return null;
  }

  // Nothing for the quantity layer to weigh without a numeral, whatever the facts say,
  // and reading the fact list to prove that again per field is most of what this costs.
  const weighed = NUMERAL.test(value) ? facts : NO_FACTS;

  const result = verify(value, { values: weighed, allowedPhrases: ALLOWED_PHRASES });
  if (!result.quantity.supported) {
    tracker.record(`unverifiable-claim:quantity:${field}`);
    return null;
  }
  if (!result.wording.supported) {
    tracker.record(`unverifiable-claim:wording:${field}`);
    return null;
  }

  return value;
}

/**
 * Emptying a field that cannot be null hands it to the rule that already drops a block,
 * or a whole generation, whose text clamps to nothing — so a banner reading "20% off"
 * disappears rather than rendering blank.
 */
function screenRequired(value: string, field: string, tracker: PlacementTracker): string {
  return screenClaim(value, field, tracker) ?? '';
}

/**
 * Does not consume budget — the caller does that once it commits.
 *
 * Order matters. The budget is checked last because it is the least specific cause:
 * these strings are the evaluation signal, and reporting a hallucinated SKU as
 * `budget:dropped` would understate how often the model invents products.
 */
function rejectionFor(sku: string, allowlist: Allowlist, tracker: PlacementTracker): string | null {
  // A rejected SKU is whatever the model wrote, and the schema cannot bound it.
  const named = clamp(sku, CLAMP.violationSku);

  // Either hallucinated or out of stock. Either way it cannot render.
  if (!allowlist.allowed.has(sku)) return `unknown-sku:${named}`;
  if (allowlist.blocked.has(sku)) return `blocked-sku:${named}`;
  if (tracker.hasPlaced(sku)) return `duplicate-sku:${named}`;
  if (tracker.remaining <= 0) return `budget:dropped:${named}`;
  return null;
}

function reconcileItems(
  items: ProductReference[],
  allowlist: Allowlist,
  candidatesBySku: Map<string, Product>,
  digest: SignalDigest,
  engaged: ReadonlySet<string>,
  tracker: PlacementTracker,
  ourReasons: ReadonlyMap<string, string>,
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

    const hasSupportedBasis = verifyBasis(item.basis, product, digest, engaged);
    if (!hasSupportedBasis) tracker.record(`unsupported-basis:${item.basis}:${item.sku}`);

    // Our sentence, not the model's. It has to match, so a lookalike is still screened.
    const isOurs = item.reason !== null && ourReasons.get(item.sku) === item.reason;

    const own = tracker.factsFor(item.sku);
    const clampedReason = clampNullable(item.reason, CLAMP.reason);

    // The prose exists to state the basis. If the basis did not hold, the prose
    // is untrue — and the badge is prose too. "You viewed this" beside a
    // downgraded pick says the same thing the dropped sentence did.
    let reason: string | null = null;
    let badge: string | null = null;
    if (hasSupportedBasis) {
      reason = isOurs
        ? clampedReason
        : screenClaim(clampedReason, `reason:${item.sku}`, tracker, own);
      // The schema's own example badge was "Back in stock" — a stock claim, and it renders.
      badge = screenClaim(
        clampNullable(item.badge, CLAMP.badge),
        `badge:${item.sku}`,
        tracker,
        own,
      );
    }

    kept.push({
      sku: item.sku,
      basis: hasSupportedBasis ? item.basis : 'popular',
      reason,
      badge,
      emphasis: item.emphasis,
    });
  }

  return kept;
}

// Cart beats views beats category however the counts compare, so they can't be summed.
interface BundleFit {
  cartHits: number;
  viewedHits: number;
  categoryHits: number;
}

function fitOf(
  bundle: Bundle,
  digest: SignalDigest,
  candidatesBySku: Map<string, Product>,
): BundleFit {
  const fit: BundleFit = { cartHits: 0, viewedHits: 0, categoryHits: 0 };

  for (const sku of bundle.skus) {
    if (digest.cartSkus.includes(sku)) fit.cartHits += 1;
    else if (digest.topViewed.some((viewed) => viewed.sku === sku)) fit.viewedHits += 1;
    else if (candidatesBySku.get(sku)?.category === digest.currentCategory) fit.categoryHits += 1;
  }

  return fit;
}

function isBetterFit(fit: BundleFit, best: BundleFit | undefined): boolean {
  if (!best) return true;
  if (fit.cartHits !== best.cartHits) return fit.cartHits > best.cartHits;
  if (fit.viewedHits !== best.viewedHits) return fit.viewedHits > best.viewedHits;
  return fit.categoryHits > best.categoryHits;
}

function chooseBundle(
  bundles: readonly Bundle[],
  allowlist: Allowlist,
  digest: SignalDigest,
  candidatesBySku: Map<string, Product>,
  tracker: PlacementTracker,
): Bundle | undefined {
  let best: Bundle | undefined;
  let bestFit: BundleFit | undefined;

  for (const bundle of bundles) {
    if (bundle.skus.length > tracker.remaining) continue;

    let isPlaceable = true;
    for (const sku of bundle.skus) {
      if (!allowlist.allowed.has(sku)) isPlaceable = false;
      if (allowlist.blockedInBundle.has(sku)) isPlaceable = false;
      if (tracker.hasPlaced(sku)) isPlaceable = false;
    }
    if (!isPlaceable) continue;

    const fit = fitOf(bundle, digest, candidatesBySku);
    if (isBetterFit(fit, bestFit)) {
      best = bundle;
      bestFit = fit;
    }
  }

  return best;
}

/**
 * The set this shopper should get, decided before anything is placed.
 *
 * The generator needs the answer early, so it can keep the set's products out
 * of the grid and keep room for them. `chooseBundle` stays private: this hands
 * out the choice, not the machinery behind it.
 *
 * `spokenFor` is what the blocks above the bundle block will have placed by the
 * time it is reached. Placing it here first is what makes the two choices agree:
 * a set is only pre-chosen if reconciliation could still reach for it.
 */
export function bundleForShopper(
  input: TrackingInput,
  digest: SignalDigest,
  spokenFor: readonly string[],
): Bundle | undefined {
  const allowlist = buildAllowlist(input);
  const candidatesBySku = new Map(input.candidates.map((product) => [product.sku, product]));
  const tracker = createPlacementTracker(digest.maxItems, hostFacts(input));

  for (const sku of spokenFor) tracker.place(sku);

  return chooseBundle(input.bundles, allowlist, digest, candidatesBySku, tracker);
}

/**
 * The hero products these blocks will really place.
 *
 * A hero keeps the product the model named — its headline was written about
 * that product — so it spends a slot of the item budget the grid cannot have.
 * One this shopper cannot see is dropped below and spends nothing, so it is not
 * counted here either.
 */
export function placeableHeroSkus(blocks: readonly Block[], input: TrackingInput): string[] {
  const allowlist = buildAllowlist(input);

  const skus: string[] = [];
  for (const block of blocks) {
    if (block.kind !== 'hero') continue;
    if (block.sku === null) continue;
    if (!allowlist.allowed.has(block.sku) || allowlist.blocked.has(block.sku)) continue;
    if (skus.includes(block.sku)) continue;
    skus.push(block.sku);
  }

  return skus;
}

function reconcileBlock(
  block: Block,
  allowlist: Allowlist,
  candidatesBySku: Map<string, Product>,
  digest: SignalDigest,
  engaged: ReadonlySet<string>,
  bundles: readonly Bundle[],
  tracker: PlacementTracker,
  ourReasons: ReadonlyMap<string, string>,
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
      // A hero with no headline and no product is the empty region every other kind drops for.
      const headline = screenRequired(
        clamp(block.headline, CLAMP.headline),
        'hero-headline',
        tracker,
      );
      if (headline.length === 0 && sku === null) {
        tracker.record('empty-block:hero');
        return null;
      }
      return {
        kind: 'hero',
        headline,
        body: screenClaim(clampNullable(block.body, CLAMP.subheadline), 'hero-body', tracker),
        sku,
        ctaLabel: screenClaim(clampNullable(block.ctaLabel, CLAMP.ctaLabel), 'hero-cta', tracker),
      };
    }

    case 'grid': {
      const items = reconcileItems(
        block.items,
        allowlist,
        candidatesBySku,
        digest,
        engaged,
        tracker,
        ourReasons,
      );
      if (items.length === 0) {
        tracker.record('empty-block:grid');
        return null;
      }
      return {
        kind: 'grid',
        title: screenClaim(clampNullable(block.title, CLAMP.blockTitle), 'grid-title', tracker),
        // Never leave a grid wider than it has items to fill.
        columns: Math.min(block.columns, Math.max(2, items.length)) as 2 | 3 | 4,
        items,
      };
    }

    case 'carousel': {
      const items = reconcileItems(
        block.items,
        allowlist,
        candidatesBySku,
        digest,
        engaged,
        tracker,
        ourReasons,
      );
      if (items.length === 0) {
        tracker.record('empty-block:carousel');
        return null;
      }
      return {
        kind: 'carousel',
        title: screenClaim(clampNullable(block.title, CLAMP.blockTitle), 'carousel-title', tracker),
        items,
      };
    }

    case 'banner': {
      const text = screenRequired(clamp(block.text, CLAMP.bannerText), 'banner-text', tracker);
      if (text.length === 0) {
        tracker.record('empty-block:banner');
        return null;
      }
      return {
        kind: 'banner',
        tone: block.tone,
        text,
        ctaLabel: screenClaim(clampNullable(block.ctaLabel, CLAMP.ctaLabel), 'banner-cta', tracker),
      };
    }

    case 'copy': {
      const body = screenRequired(clamp(block.body, CLAMP.copyBody), 'copy-body', tracker);
      if (body.length === 0) {
        tracker.record('empty-block:copy');
        return null;
      }
      return {
        kind: 'copy',
        title: screenClaim(clampNullable(block.title, CLAMP.blockTitle), 'copy-title', tracker),
        body,
      };
    }

    case 'bundle': {
      const chosen = chooseBundle(bundles, allowlist, digest, candidatesBySku, tracker);
      if (!chosen) {
        tracker.record('no-bundle');
        return null;
      }

      for (const sku of chosen.skus) tracker.place(sku);

      return {
        kind: 'bundle',
        title: screenClaim(clampNullable(block.title, CLAMP.blockTitle), 'bundle-title', tracker),
        body: screenClaim(clampNullable(block.body, CLAMP.subheadline), 'bundle-body', tracker),
        ctaLabel: screenClaim(clampNullable(block.ctaLabel, CLAMP.ctaLabel), 'bundle-cta', tracker),
        // The model's bundleId is ignored on purpose.
        bundleId: chosen.id,
      };
    }
  }
}

function showsAnyProduct(blocks: Block[]): boolean {
  return blocks.some(
    (block) =>
      (block.kind === 'grid' && block.items.length > 0) ||
      (block.kind === 'carousel' && block.items.length > 0) ||
      (block.kind === 'hero' && block.sku !== null) ||
      (block.kind === 'bundle' && block.bundleId !== null),
  );
}

export function reconcileSpec(
  generated: GeneratedSpec,
  input: TrackingInput,
  digest: SignalDigest,
  /**
   * The reason this request wrote itself, by SKU: the host's own `reason` on a
   * candidate, or the sentence the selector wrote when there was none. Neither is the
   * model's words, and the deterministic component renders the same sentence unscreened.
   *
   * Only `fitToShopper` fills it, so in `per-shopper` mode it is empty and every
   * reason is the model's, including one that happens to read the same.
   */
  ourReasons: ReadonlyMap<string, string> = new Map(),
): ReconcileResult {
  const allowlist = buildAllowlist(input);
  const candidatesBySku = new Map(input.candidates.map((product) => [product.sku, product]));
  const tracker = createPlacementTracker(digest.maxItems, hostFacts(input));

  if (generated.blocks.length > MAX_BLOCKS) {
    tracker.record(`too-many-blocks:${generated.blocks.length}`);
  }

  const blocks: Block[] = [];
  for (const block of capBlocks(generated.blocks)) {
    const reconciled = reconcileBlock(
      block,
      allowlist,
      candidatesBySku,
      digest,
      engagedCategories(input),
      input.bundles,
      tracker,
      ourReasons,
    );
    if (reconciled !== null) blocks.push(reconciled);
  }

  const spec: GeneratedSpec = {
    tone: generated.tone,
    headline: screenRequired(clamp(generated.headline, CLAMP.headline), 'headline', tracker),
    subheadline: screenClaim(
      clampNullable(generated.subheadline, CLAMP.subheadline),
      'subheadline',
      tracker,
    ),
    blocks,
    rationale: screenRequired(clamp(generated.rationale, CLAMP.rationale), 'rationale', tracker),
  };

  // Recorded separately: no products and no headline are different failures.
  if (!showsAnyProduct(blocks)) tracker.record('unusable:no-products');
  if (spec.headline.length === 0) tracker.record('unusable:no-headline');
  const isUsable = showsAnyProduct(blocks) && spec.headline.length > 0;

  return { spec, isUsable, violations: tracker.violations };
}
