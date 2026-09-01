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
 * Free text that states something the renderer cannot check.
 *
 * The prompt bans prices, discounts, delivery dates, stock levels and ratings
 * because every one of them moves after the words are written, and a cohort
 * component is cached and served again later. `verifyBasis` checks the basis a
 * pick claims; nothing checks the sentences around it, so every string the
 * model writes is checked here — a heading is not a safer place for a claim
 * than the small print under it.
 *
 * A claim is about money, a customer score, when it arrives, or how many are
 * left. A specification is not a claim, even when it has a number or a
 * percentage in it: "100% recycled nylon", "a comfort rating of -5C" and
 * "arrives flat-packed" are all things a shop can say about the product itself,
 * and they stay. That is why almost every rule below needs a second word beside
 * the first — "20% off", not "20%"; "rated 4.8", not "rated". A careful
 * rewording will get past this, and that is the trade we want: missing one
 * claim is better than deleting honest copy on every page.
 *
 * One rule per line, because each line is a separate judgement about where the
 * boundary sits and each one wants its own reason written next to it.
 */
const CLAIM_PATTERNS: { kind: string; patterns: RegExp[] }[] = [
  {
    // Customers scoring the product. "rated for winter use", "rated to -10C"
    // and "an IPX7 water rating" are about what the product can take.
    kind: 'rating',
    patterns: [
      /\breviews?\b|\breviewed\b/,
      /\b(?:\d+(?:\.\d+)?|three|four|five)[\s-]?stars?\b/,
      /\bstars?[\s-]?ratings?\b/,
      // A rating somebody gave it, rather than one it was built to.
      /\b(?:customer|shopper|buyer|user|average|overall)[\s-]ratings?\b/,
      // A score out of five is written as a decimal. A spec is "-5C" or "20,000mm".
      /\bratings?\s+of\s+[0-5]\.\d\b/,
      /\b(?:highly|top|best|well|poorly|five|four)[\s-]rated\b/,
      // "rated 4.8" is a score. "rated 3 season" is what the tent is built for.
      /\brated\s+(?:[0-5]\.\d|(?:[0-5]|three|four|five)\s+(?:stars?|out of))\b/,
      // How many other people bought or liked it is a customer claim too.
      /\bbest[\s-]?sell(?:er|ers|ing)\b/,
      /\bloved by (?:thousands|hundreds|millions|\d)/,
    ],
  },
  {
    kind: 'price',
    patterns: [
      /[$£€¥]\s?\d/,
      /\b\d+(?:\.\d+)?\s?(?:usd|eur|gbp|dollars?|pounds?|euros?)\b/,
      /\bpric(?:e|es|ed|ing)\b/,
      // A before-and-after is a price claim even with no currency on it.
      /\bwas\s+[$£€¥]?\s?\d[\d,.]*\s*[,;–—-]?\s*now\s+[$£€¥]?\s?\d/,
      // "does not feel cheap" is about quality. Only the comparison is money.
      /\bcheap(?:er|est)\b/,
      /\baffordable\b|\bbargain\b/,
      // "at no cost to comfort" is not money. "costs less" is.
      /\bcosts?\s+(?:less|more|only|just|about|around|[$£€¥]?\d)/,
      /\blow(?:er)?[\s-]cost\b/,
      // "saves weight" and "saves on weight" are both about grams.
      /\bsaves?\s+(?:you\s+)?(?:money|cash|[$£€¥]\s?\d)/,
    ],
  },
  {
    // A percentage in outdoor copy is a specification far more often than it is
    // money off, so it only counts beside a money word: "20% off", not
    // "100% recycled".
    kind: 'discount',
    patterns: [
      /\d+(?:\.\d+)?\s?(?:%|percent)\s*(?:off\b|discount|reduction|less\b)/,
      /\b(?:save|saving|savings|off|discount|extra|up to)\s+(?:up to\s+)?\d+(?:\.\d+)?\s?(?:%|percent)/,
      /\bdiscount(?:s|ed)?\b/,
      /\bsale\b|\bmarked down\b|\bdeal of\b/,
      /\bhalf[\s-]?(?:price|off)\b/,
      // "extra clearance for thick socks" is room inside the shoe.
      /\bclearance\s+(?:sale|price|event|deal)\b|\bon clearance\b/,
      // "reduced weight" and "reduced to 900g" are specifications. Only a
      // reduced price, or a reduction with a date on it, is money off.
      /\bprice reduced\b|\breduced price\b|\breduced by \d+\s?(?:%|percent)|\breduced\s+(?:this|next|last)\s+week\b/,
    ],
  },
  {
    // When it turns up, not what turns up. "ships in a recycled box" and
    // "arrives flat-packed" describe the thing, so the verb alone is not enough
    // — it needs a day or a date beside it.
    kind: 'delivery',
    patterns: [
      /\bdelivery\b|\bshipping\b/,
      /\bnext[\s-]day\b|\bsame[\s-]day\b|\bovernight\b/,
      /\b(?:ships?|arrives?|arriving|delivered|by|before|in time for)\s+(?:on\s+)?(?:today|tomorrow|tonight|this week|next week|the weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
      /\b(?:ships?|arrives?|arriving)\s+(?:in|within)\s+\d/,
      /\bin time for\b/,
    ],
  },
  {
    kind: 'stock',
    patterns: [
      /\b(?:in|out of|low on) stock\b/,
      /\brestocked?\b|\bsold out\b/,
      // "the last few miles" is a distance, so a count needs "left" after it.
      /\b(?:only\s+)?(?:\d+|a few|a handful|a couple|one|few)\s+(?:left|remaining)\b/,
      /\blast (?:one|few)\s+(?:left|remaining|in stock)\b/,
      /\bselling fast\b|\b(?:almost|nearly) gone\b|\bwhile stocks last\b/,
    ],
  },
];

/** Names the first forbidden claim the text makes, or null when it makes none. */
function claimIn(text: string): string | null {
  const lower = text.toLowerCase();
  for (const claim of CLAIM_PATTERNS) {
    for (const pattern of claim.patterns) {
      if (pattern.test(lower)) return claim.kind;
    }
  }
  return null;
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
 * Drops text that makes a claim we cannot check, and names what it claimed.
 *
 * Runs after clamping, so what is screened is exactly what would have rendered.
 * Dropping means what it means everywhere else here: this field becomes null
 * and the rest of the block carries on.
 */
function screenClaim(
  value: string | null,
  field: string,
  tracker: PlacementTracker,
): string | null {
  if (value === null) return null;

  const kind = claimIn(value);
  if (kind === null) return value;

  tracker.record(`unverifiable-claim:${kind}:${field}`);
  return null;
}

/**
 * The same screen for a field that cannot be null. Emptying it hands the field
 * to the rule that already drops a block, or a whole generation, whose text
 * clamps to nothing — so a banner reading "20% off" disappears rather than
 * rendering blank.
 */
function screenRequired(value: string, field: string, tracker: PlacementTracker): string {
  return screenClaim(value, field, tracker) ?? '';
}

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
      reason: hasSupportedBasis
        ? screenClaim(clampNullable(item.reason, CLAMP.reason), `reason:${item.sku}`, tracker)
        : null,
      badge: clampNullable(item.badge, CLAMP.badge),
      emphasis: item.emphasis,
    });
  }

  return kept;
}

// Three separate counts, not one score — cart beats views beats category
// regardless of how the counts compare, so they can't be summed.
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

/** In the cart beats recently viewed, which beats the category being looked at. */
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
    // A bundle needs room for every product at once.
    if (bundle.skus.length > tracker.remaining) continue;

    let isPlaceable = true;
    for (const sku of bundle.skus) {
      if (!allowlist.allowed.has(sku)) isPlaceable = false;
      if (digest.dislikedSkus.includes(sku)) isPlaceable = false;
      // Already shown by an earlier block — twice on a page looks broken.
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
      const items = reconcileItems(block.items, allowlist, candidatesBySku, digest, tracker);
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
      const items = reconcileItems(block.items, allowlist, candidatesBySku, digest, tracker);
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

/** True when a spec contains at least one block that actually shows a product. */
function showsAnyProduct(blocks: Block[]): boolean {
  return blocks.some(
    (block) =>
      (block.kind === 'grid' && block.items.length > 0) ||
      (block.kind === 'carousel' && block.items.length > 0) ||
      (block.kind === 'hero' && block.sku !== null) ||
      // A bundle shows products too, so it counts the same as grid/carousel/hero.
      (block.kind === 'bundle' && block.bundleId !== null),
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
    headline: screenRequired(clamp(generated.headline, CLAMP.headline), 'headline', tracker),
    subheadline: screenClaim(
      clampNullable(generated.subheadline, CLAMP.subheadline),
      'subheadline',
      tracker,
    ),
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
