import type { RecommendationBasis } from './component-spec.js';
import type { SignalDigest } from './signal-digest.js';
import { neverRecommend } from './reconciliation.js';
import type { Product, TrackingInput } from './tracking-input.js';

export interface ProductPick {
  product: Product;

  basis: RecommendationBasis;

  reason: string;

  score: number;
}

const SCORE_WEIGHTS = {
  category: 3,
  revisit: 1.5,
  rating: 1.2,
  tagOverlap: 0.6,
} as const;

const MAX_TAG_OVERLAP = 3;

const UNRATED = 3.5;

function engagedTags(input: TrackingInput, digest: SignalDigest): Set<string> {
  const engagedSkus = new Set([
    ...digest.likedSkus,
    ...digest.purchasedSkus,
    ...digest.cartSkus,
    ...digest.topViewed.map((viewed) => viewed.sku),
  ]);

  const tags = new Set<string>();
  for (const product of input.candidates) {
    if (!engagedSkus.has(product.sku)) continue;
    for (const tag of product.tags) tags.add(tag);
  }
  return tags;
}

interface Evidence {
  categoryScore: number;
  revisitScore: number;
  tagOverlap: number;
  hasCart: boolean;
}

function basisFor(
  product: Product,
  digest: SignalDigest,
  evidence: Evidence,
): { basis: RecommendationBasis; reason: string } {
  if (evidence.revisitScore > 0) {
    return { basis: 'most_viewed', reason: 'You looked at this recently' };
  }
  if (digest.currentCategory === product.category) {
    return { basis: 'similar_to_current', reason: `More in ${product.category}` };
  }
  if (evidence.categoryScore > 0.5) {
    return { basis: 'liked_category', reason: `Based on your interest in ${product.category}` };
  }
  if (evidence.hasCart) {
    return { basis: 'complements_cart', reason: 'Goes with what is in your cart' };
  }
  return { basis: 'popular', reason: `Popular in ${product.category}` };
}

export type RankOrder = 'signals' | 'given';

export interface SelectOptions {
  rank?: RankOrder;
}

export function selectProducts(
  input: TrackingInput,
  digest: SignalDigest,
  options: SelectOptions = {},
): ProductPick[] {
  const affinityByCategory = new Map(
    digest.categoryAffinity.map((affinity) => [affinity.category, affinity.score]),
  );

  const strongestAffinity = Math.max(1, ...affinityByCategory.values());
  const tags = engagedTags(input, digest);
  const excluded = neverRecommend(input);
  const viewsBySku = new Map(digest.topViewed.map((viewed) => [viewed.sku, viewed.views]));

  const picks: ProductPick[] = [];
  for (const product of input.candidates) {
    if (!product.isInStock) continue;
    if (excluded.has(product.sku)) continue;

    const categoryScore = (affinityByCategory.get(product.category) ?? 0) / strongestAffinity;
    const tagOverlap = product.tags.filter((tag) => tags.has(tag)).length;
    const ratingScore = (product.rating ?? UNRATED) / 5;

    const revisitScore = Math.min(1, Math.log2(1 + (viewsBySku.get(product.sku) ?? 0)) / 3);

    const score =
      categoryScore * SCORE_WEIGHTS.category +
      revisitScore * SCORE_WEIGHTS.revisit +
      ratingScore * SCORE_WEIGHTS.rating +
      Math.min(tagOverlap, MAX_TAG_OVERLAP) * SCORE_WEIGHTS.tagOverlap;

    const hasCart = digest.cartSkus.length > 0;
    const { basis, reason } = basisFor(product, digest, {
      categoryScore,
      revisitScore,
      tagOverlap,
      hasCart,
    });

    picks.push({
      product,
      basis,
      reason: product.reason ?? reason,
      score,
    });
  }

  if (options.rank === 'given') return picks;

  return picks.toSorted(
    (left, right) => right.score - left.score || left.product.sku.localeCompare(right.product.sku),
  );
}
