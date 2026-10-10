import { hostFacts, NO_FACTS, unbackedClaim, type HostFacts } from './claim-screening.js';
import {
  columnsFor,
  type Block,
  type GeneratedSpec,
  type ProductReference,
  type RecommendationBasis,
} from './component-spec.js';
import { categoriesTouchedBySignals, type SignalDigest } from './signal-digest.js';
import { FIELD_LIMITS, type Bundle, type Product, type TrackingInput } from './tracking-input.js';

const CLAMP = {
  headline: 90,
  subheadline: 140,
  blockTitle: 80,
  reason: FIELD_LIMITS.reason,
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

function blockedForBundles(input: TrackingInput): Set<string> {
  const blocked = new Set<string>();
  for (const signal of input.signals.dislikes) blocked.add(signal.sku);
  if (input.context.currentSku) blocked.add(input.context.currentSku);
  return blocked;
}

export function blockedForPicks(input: TrackingInput): Set<string> {
  const blocked = blockedForBundles(input);
  for (const signal of input.signals.lastPurchased) blocked.add(signal.sku);
  for (const signal of input.signals.cart) blocked.add(signal.sku);
  return blocked;
}

function inStockSkus(input: TrackingInput): Set<string> {
  const skus = new Set<string>();
  for (const product of input.candidates) {
    if (product.isInStock) skus.add(product.sku);
  }
  return skus;
}

interface Run {
  readonly allowed: ReadonlySet<string>;
  readonly blockedForPicks: ReadonlySet<string>;
  readonly blockedForBundles: ReadonlySet<string>;
  readonly products: ReadonlyMap<string, Product>;
  readonly digest: SignalDigest;
  readonly engaged: ReadonlySet<string>;
  readonly bundles: readonly Bundle[];
  readonly ourReasons: ReadonlyMap<string, string>;
  readonly facts: HostFacts;
  placed: Set<string>;
  remaining: number;
  violations: string[];
}

function startRun(
  input: TrackingInput,
  digest: SignalDigest,
  ourReasons: ReadonlyMap<string, string>,
): Run {
  return {
    allowed: inStockSkus(input),
    blockedForPicks: blockedForPicks(input),
    blockedForBundles: blockedForBundles(input),
    products: new Map(input.candidates.map((product) => [product.sku, product])),
    digest,
    engaged: categoriesTouchedBySignals(input),
    bundles: input.bundles,
    ourReasons,
    facts: hostFacts(input),
    placed: new Set(),
    remaining: digest.maxItems,
    violations: [],
  };
}

function verifyBasis(basis: RecommendationBasis, product: Product, run: Run): boolean {
  const { digest } = run;
  switch (basis) {
    case 'most_viewed':
      return digest.topViewed.some((viewed) => viewed.sku === product.sku);
    case 'complements_cart':
      return digest.cartSkus.length > 0;
    case 'complements_purchase':
      return digest.purchasedSkus.length > 0;
    case 'liked_category':
      return (
        run.engaged.has(product.category) &&
        digest.categoryAffinity.some((affinity) => affinity.category === product.category)
      );
    case 'similar_to_current':
      return digest.currentCategory === product.category;
    case 'popular':
      return true;
  }
}

function place(run: Run, sku: string): void {
  run.placed.add(sku);
  run.remaining -= 1;
}

function screenClaim(
  value: string | null,
  limit: number,
  field: string,
  run: Run,
  facts: readonly string[] = run.facts.pooled,
): string | null {
  if (value === null) return null;

  const clamped = clamp(value, limit);
  if (clamped.length === 0) return null;

  const kind = unbackedClaim(value, clamped, facts);
  if (kind === null) return clamped;

  run.violations.push(`unverifiable-claim:${kind}:${field}`);
  return null;
}

function screenRequired(value: string, limit: number, field: string, run: Run): string {
  return screenClaim(value, limit, field, run) ?? '';
}

function rejectionFor(sku: string, run: Run): string | null {
  const named = clamp(sku, CLAMP.violationSku);
  if (!run.allowed.has(sku)) return `unknown-sku:${named}`;
  if (run.blockedForPicks.has(sku)) return `blocked-sku:${named}`;
  if (run.placed.has(sku)) return `duplicate-sku:${named}`;
  if (run.remaining <= 0) return `budget:dropped:${named}`;
  return null;
}

function takeSlot(sku: string, run: Run): string | null {
  const rejection = rejectionFor(sku, run);
  if (rejection !== null) {
    run.violations.push(rejection);
    return null;
  }
  place(run, sku);
  return sku;
}

function reconcileItems(items: ProductReference[], run: Run): ProductReference[] {
  const kept: ProductReference[] = [];

  for (const item of items) {
    if (takeSlot(item.sku, run) === null) continue;

    const product = run.products.get(item.sku);
    if (!product) continue;

    if (!verifyBasis(item.basis, product, run)) {
      run.violations.push(`unsupported-basis:${item.basis}:${item.sku}`);
      kept.push({
        sku: item.sku,
        basis: 'popular',
        reason: null,
        badge: null,
        emphasis: item.emphasis,
      });
      continue;
    }

    const own = run.facts.bySku.get(item.sku) ?? NO_FACTS;
    const reason =
      item.reason !== null && run.ourReasons.get(item.sku) === item.reason
        ? clamp(item.reason, CLAMP.reason) || null
        : screenClaim(item.reason, CLAMP.reason, `reason:${item.sku}`, run, own);
    const badge = screenClaim(item.badge, CLAMP.badge, `badge:${item.sku}`, run, own);

    kept.push({ sku: item.sku, basis: item.basis, reason, badge, emphasis: item.emphasis });
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
  products: ReadonlyMap<string, Product>,
): BundleFit {
  const fit: BundleFit = { cartHits: 0, viewedHits: 0, categoryHits: 0 };
  for (const sku of bundle.skus) {
    if (digest.cartSkus.includes(sku)) fit.cartHits += 1;
    else if (digest.topViewed.some((viewed) => viewed.sku === sku)) fit.viewedHits += 1;
    else if (products.get(sku)?.category === digest.currentCategory) fit.categoryHits += 1;
  }
  return fit;
}

function isBetterFit(fit: BundleFit, best: BundleFit | undefined): boolean {
  if (!best) return true;
  if (fit.cartHits !== best.cartHits) return fit.cartHits > best.cartHits;
  if (fit.viewedHits !== best.viewedHits) return fit.viewedHits > best.viewedHits;
  return fit.categoryHits > best.categoryHits;
}

function chooseBundle(run: Run): Bundle | undefined {
  let best: Bundle | undefined;
  let bestFit: BundleFit | undefined;

  for (const bundle of run.bundles) {
    if (bundle.skus.length > run.remaining) continue;

    const isPlaceable = bundle.skus.every(
      (sku) => run.allowed.has(sku) && !run.blockedForBundles.has(sku) && !run.placed.has(sku),
    );
    if (!isPlaceable) continue;

    const fit = fitOf(bundle, run.digest, run.products);
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
  const run = startRun(input, digest, new Map());
  for (const sku of spokenFor) place(run, sku);

  return chooseBundle(run);
}

export function placeableHeroSkus(blocks: readonly Block[], input: TrackingInput): string[] {
  const allowed = inStockSkus(input);
  const blocked = blockedForPicks(input);
  const skus: string[] = [];
  for (const block of blocks) {
    if (block.kind !== 'hero' || block.sku === null) continue;
    if (!allowed.has(block.sku) || blocked.has(block.sku)) continue;
    if (!skus.includes(block.sku)) skus.push(block.sku);
  }
  return skus;
}

function reconcileBlock(block: Block, run: Run): Block | null {
  switch (block.kind) {
    case 'hero': {
      const sku = block.sku === null ? null : takeSlot(block.sku, run);
      const headline = screenRequired(block.headline, CLAMP.headline, 'hero-headline', run);
      if (headline.length === 0 && sku === null) {
        run.violations.push('empty-block:hero');
        return null;
      }
      return {
        kind: 'hero',
        headline,
        body: screenClaim(block.body, CLAMP.subheadline, 'hero-body', run),
        sku,
        ctaLabel: screenClaim(block.ctaLabel, CLAMP.ctaLabel, 'hero-cta', run),
      };
    }

    case 'grid': {
      const items = reconcileItems(block.items, run);
      if (items.length === 0) {
        run.violations.push('empty-block:grid');
        return null;
      }
      return {
        kind: 'grid',
        title: screenClaim(block.title, CLAMP.blockTitle, 'grid-title', run),
        columns: columnsFor(items.length, block.columns),
        items,
      };
    }

    case 'carousel': {
      const items = reconcileItems(block.items, run);
      if (items.length === 0) {
        run.violations.push('empty-block:carousel');
        return null;
      }
      return {
        kind: 'carousel',
        title: screenClaim(block.title, CLAMP.blockTitle, 'carousel-title', run),
        items,
      };
    }

    case 'banner': {
      const text = screenRequired(block.text, CLAMP.bannerText, 'banner-text', run);
      if (text.length === 0) {
        run.violations.push('empty-block:banner');
        return null;
      }
      return {
        kind: 'banner',
        tone: block.tone,
        text,
        ctaLabel: screenClaim(block.ctaLabel, CLAMP.ctaLabel, 'banner-cta', run),
      };
    }

    case 'copy': {
      const body = screenRequired(block.body, CLAMP.copyBody, 'copy-body', run);
      if (body.length === 0) {
        run.violations.push('empty-block:copy');
        return null;
      }
      return {
        kind: 'copy',
        title: screenClaim(block.title, CLAMP.blockTitle, 'copy-title', run),
        body,
      };
    }

    case 'bundle': {
      const chosen = chooseBundle(run);
      if (!chosen) {
        run.violations.push('no-bundle');
        return null;
      }

      for (const sku of chosen.skus) place(run, sku);
      return {
        kind: 'bundle',
        title: screenClaim(block.title, CLAMP.blockTitle, 'bundle-title', run),
        body: screenClaim(block.body, CLAMP.subheadline, 'bundle-body', run),
        ctaLabel: screenClaim(block.ctaLabel, CLAMP.ctaLabel, 'bundle-cta', run),
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
  const run = startRun(input, digest, ourReasons);

  if (generated.blocks.length > MAX_BLOCKS) {
    run.violations.push(`too-many-blocks:${generated.blocks.length}`);
  }

  const blocks: Block[] = [];
  for (const block of capBlocks(generated.blocks)) {
    const reconciled = reconcileBlock(block, run);
    if (reconciled !== null) blocks.push(reconciled);
  }

  const spec: GeneratedSpec = {
    tone: generated.tone,
    headline: screenRequired(generated.headline, CLAMP.headline, 'headline', run),
    subheadline: screenClaim(generated.subheadline, CLAMP.subheadline, 'subheadline', run),
    blocks,
    rationale: screenRequired(generated.rationale, CLAMP.rationale, 'rationale', run),
  };

  const hasProducts = showsAnyProduct(blocks);
  if (!hasProducts) run.violations.push('unusable:no-products');
  if (spec.headline.length === 0) run.violations.push('unusable:no-headline');
  const isUsable = hasProducts && spec.headline.length > 0;

  return { spec, isUsable, violations: run.violations };
}
