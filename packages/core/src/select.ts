import type { RecommendationBasis } from './component-spec.js';
import type { SignalDigest } from './digest.js';
import { neverRecommend } from './reconcile.js';
import type { Product, TrackingInput } from './tracking-input.js';

/**
 * The deterministic selector — which products to show, in what order, and why.
 *
 * This is the half of the problem a language model is not needed for. Given the
 * same digest, it always returns the same picks, it cannot fail, and it costs
 * nothing. It exists for three reasons, in ascending order of importance:
 *
 *  1. It is what renders when the model is slow, erroring, or not configured.
 *  2. It supplies the candidate ordering the model is asked to work from.
 *  3. It is the control arm. If a generated component cannot be told apart from
 *     this, the model has not earned its place, and the evaluation has to be
 *     able to ask that question honestly.
 */

export interface Pick {
  product: Product;
  /** Why this product, stated so reconciliation can check it. */
  basis: RecommendationBasis;
  /** How the basis reads to a shopper. */
  reason: string;
  /** Unnormalised. Only the ordering is meaningful. */
  score: number;
}

/**
 * How much each factor moves a product up the list. Relative sizes are what
 * matter: category affinity dominates, a revisit is nearly as strong, and
 * rating only separates products the signals cannot.
 */
const SCORE_WEIGHTS = {
  category: 3,
  revisit: 1.5,
  rating: 1.2,
  tagOverlap: 0.6,
} as const;

/** Beyond this many shared tags, more overlap says nothing new. */
const MAX_TAG_OVERLAP = 3;

/** Assumed rating for a product the catalog does not rate. */
const UNRATED = 3.5;

/** Tags on the products this shopper has actually engaged with. */
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

/**
 * States why a product was picked, choosing the most specific claim the signals
 * actually support.
 *
 * Every branch has to be one reconciliation can verify — the selector is held to
 * the same standard as the model, and a basis it cannot support would be
 * downgraded there just the same. `popular` asserts nothing and is the honest
 * answer when nothing else holds.
 */
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
  if ((product.rating ?? 0) >= 4.5) {
    return { basis: 'popular', reason: 'Highly rated' };
  }
  return { basis: 'popular', reason: `Popular in ${product.category}` };
}

/**
 * Scores every eligible candidate and returns them best first.
 *
 * Ties break on SKU so the order is total: two runs over the same payload
 * produce the same list, which is what makes the control arm reproducible.
 */
export function selectProducts(input: TrackingInput, digest: SignalDigest): Pick[] {
  const affinityByCategory = new Map(
    digest.categoryAffinity.map((affinity) => [affinity.category, affinity.score]),
  );
  // Normalised against the strongest affinity so the weights below mean the
  // same thing whether a shopper has two signals or two hundred.
  const strongestAffinity = Math.max(1, ...affinityByCategory.values());
  const tags = engagedTags(input, digest);
  const excluded = neverRecommend(digest);
  const viewsBySku = new Map(digest.topViewed.map((viewed) => [viewed.sku, viewed.views]));

  const picks: Pick[] = [];
  for (const product of input.candidates) {
    if (!product.inStock) continue;
    if (excluded.has(product.sku)) continue;

    const categoryScore = (affinityByCategory.get(product.category) ?? 0) / strongestAffinity;
    const tagOverlap = product.tags.filter((tag) => tags.has(tag)).length;
    const ratingScore = (product.rating ?? UNRATED) / 5;
    // Something viewed and not bought is a strong re-surface signal, but it
    // saturates: the twentieth view means little more than the fifth.
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

    picks.push({ product, basis, reason, score });
  }

  return picks.toSorted(
    (left, right) => right.score - left.score || left.product.sku.localeCompare(right.product.sku),
  );
}
