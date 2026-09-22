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

  violationSku: 32,
} as const;

export const MAX_BLOCKS = 4;

export function capBlocks(blocks: Block[]): Block[] {
  return blocks.slice(0, MAX_BLOCKS);
}

export interface ReconcileResult {
  spec: GeneratedSpec;

  isUsable: boolean;

  violations: string[];
}

function clamp(value: string, limit: number): string {
  const collapsed = value.trim().replace(/\s+/g, ' ');
  if (collapsed.length <= limit) return collapsed;

  const cut = collapsed.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[.,;:!?-]+$/, '')}…`;
}

interface Allowlist {
  allowed: Set<string>;
  blocked: Set<string>;

  blockedInBundle: Set<string>;
}

function refusedEverywhere(input: TrackingInput): Set<string> {
  const refused = new Set<string>();
  for (const signal of input.signals.dislikes) refused.add(signal.sku);
  if (input.context.currentSku) refused.add(input.context.currentSku);

  return refused;
}

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
      return (
        engaged.has(product.category) &&
        digest.categoryAffinity.some((affinity) => affinity.category === product.category)
      );
    case 'similar_to_current':
      return digest.currentCategory === product.category;
    case 'popular':
      return true;
  }
}

const NUMERAL = /[\p{Nd}\p{No}\p{Nl}]/u;

const NO_FACTS: readonly string[] = [];

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

function screenClaim(
  value: string | null,
  limit: number,
  field: string,
  tracker: PlacementTracker,
  facts: readonly string[] = tracker.facts,
): string | null {
  if (value === null) return null;

  const clamped = clamp(value, limit);
  if (clamped.length === 0) return null;

  const kind = claimIn(value) ?? claimIn(clamped);
  if (kind !== null) {
    tracker.record(`unverifiable-claim:${kind}:${field}`);
    return null;
  }

  const weighed = NUMERAL.test(clamped) ? facts : NO_FACTS;

  const result = verify(clamped, { values: weighed, allowedPhrases: ALLOWED_PHRASES });
  if (!result.quantity.supported) {
    tracker.record(`unverifiable-claim:quantity:${field}`);
    return null;
  }
  if (!result.wording.supported) {
    tracker.record(`unverifiable-claim:wording:${field}`);
    return null;
  }

  return clamped;
}

function screenRequired(
  value: string,
  limit: number,
  field: string,
  tracker: PlacementTracker,
): string {
  return screenClaim(value, limit, field, tracker) ?? '';
}

function rejectionFor(sku: string, allowlist: Allowlist, tracker: PlacementTracker): string | null {
  const named = clamp(sku, CLAMP.violationSku);

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

    if (!product) continue;

    tracker.place(item.sku);

    const hasSupportedBasis = verifyBasis(item.basis, product, digest, engaged);
    if (!hasSupportedBasis) tracker.record(`unsupported-basis:${item.basis}:${item.sku}`);

    const isOurs = item.reason !== null && ourReasons.get(item.sku) === item.reason;

    const own = tracker.factsFor(item.sku);

    let reason: string | null = null;
    let badge: string | null = null;
    if (hasSupportedBasis) {
      reason = isOurs
        ? clamp(item.reason ?? '', CLAMP.reason) || null
        : screenClaim(item.reason, CLAMP.reason, `reason:${item.sku}`, tracker, own);

      badge = screenClaim(item.badge, CLAMP.badge, `badge:${item.sku}`, tracker, own);
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

          sku = null;
        } else {
          tracker.place(sku);
        }
      }

      const headline = screenRequired(block.headline, CLAMP.headline, 'hero-headline', tracker);
      if (headline.length === 0 && sku === null) {
        tracker.record('empty-block:hero');
        return null;
      }
      return {
        kind: 'hero',
        headline,
        body: screenClaim(block.body, CLAMP.subheadline, 'hero-body', tracker),
        sku,
        ctaLabel: screenClaim(block.ctaLabel, CLAMP.ctaLabel, 'hero-cta', tracker),
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
        title: screenClaim(block.title, CLAMP.blockTitle, 'grid-title', tracker),

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
        title: screenClaim(block.title, CLAMP.blockTitle, 'carousel-title', tracker),
        items,
      };
    }

    case 'banner': {
      const text = screenRequired(block.text, CLAMP.bannerText, 'banner-text', tracker);
      if (text.length === 0) {
        tracker.record('empty-block:banner');
        return null;
      }
      return {
        kind: 'banner',
        tone: block.tone,
        text,
        ctaLabel: screenClaim(block.ctaLabel, CLAMP.ctaLabel, 'banner-cta', tracker),
      };
    }

    case 'copy': {
      const body = screenRequired(block.body, CLAMP.copyBody, 'copy-body', tracker);
      if (body.length === 0) {
        tracker.record('empty-block:copy');
        return null;
      }
      return {
        kind: 'copy',
        title: screenClaim(block.title, CLAMP.blockTitle, 'copy-title', tracker),
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
        title: screenClaim(block.title, CLAMP.blockTitle, 'bundle-title', tracker),
        body: screenClaim(block.body, CLAMP.subheadline, 'bundle-body', tracker),
        ctaLabel: screenClaim(block.ctaLabel, CLAMP.ctaLabel, 'bundle-cta', tracker),

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

  ourReasons: ReadonlyMap<string, string> = new Map(),
): ReconcileResult {
  const allowlist = buildAllowlist(input);
  const candidatesBySku = new Map(input.candidates.map((product) => [product.sku, product]));
  const engaged = engagedCategories(input);
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
      engaged,
      input.bundles,
      tracker,
      ourReasons,
    );
    if (reconciled !== null) blocks.push(reconciled);
  }

  const spec: GeneratedSpec = {
    tone: generated.tone,
    headline: screenRequired(generated.headline, CLAMP.headline, 'headline', tracker),
    subheadline: screenClaim(generated.subheadline, CLAMP.subheadline, 'subheadline', tracker),
    blocks,
    rationale: screenRequired(generated.rationale, CLAMP.rationale, 'rationale', tracker),
  };

  if (!showsAnyProduct(blocks)) tracker.record('unusable:no-products');
  if (spec.headline.length === 0) tracker.record('unusable:no-headline');
  const isUsable = showsAnyProduct(blocks) && spec.headline.length > 0;

  return { spec, isUsable, violations: tracker.violations };
}
