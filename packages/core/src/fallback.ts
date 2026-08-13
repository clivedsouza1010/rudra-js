import type { SignalDigest } from './digest.js';
import type { GeneratedSpec, ProductRef } from './spec.js';
import type { Product, TrackingInput } from './tracking-input.js';

/**
 * The deterministic fallback.
 *
 * The manuscript names data latency as the central risk of moving
 * personalisation into the SSR path: "any significant delay in the
 * recommendation engine or data fetching will block the page rendering."
 * This module is the answer to that. It is pure, synchronous, and cannot fail,
 * so the server always has something correct to render — whether the model is
 * slow, erroring, rate-limited, or simply not configured.
 *
 * It reads the same digest the model reads, so a degraded render is a weaker
 * version of the same decision rather than an unrelated one.
 */

interface ScoredProduct {
  product: Product;
  score: number;
  reason: string;
}

/** Tag overlap between a candidate and the products the shopper has engaged with. */
function affinityTags(input: TrackingInput, digest: SignalDigest): Set<string> {
  const engaged = new Set([
    ...digest.likedSkus,
    ...digest.purchasedSkus,
    ...digest.cartSkus,
    ...digest.topViewed.map((v) => v.sku),
  ]);
  const tags = new Set<string>();
  for (const product of input.candidates) {
    if (!engaged.has(product.sku)) continue;
    for (const tag of product.tags) tags.add(tag);
  }
  return tags;
}

function scoreCandidates(input: TrackingInput, digest: SignalDigest): ScoredProduct[] {
  const affinityByCategory = new Map(digest.categoryAffinity.map((a) => [a.category, a.score]));
  const maxAffinity = Math.max(1, ...affinityByCategory.values());
  const tags = affinityTags(input, digest);

  const excluded = new Set<string>([
    ...digest.dislikedSkus,
    ...digest.purchasedSkus,
    ...digest.cartSkus,
    ...(digest.currentSku ? [digest.currentSku] : []),
  ]);

  const viewCounts = new Map(digest.topViewed.map((v) => [v.sku, v.views]));

  const scored: ScoredProduct[] = [];
  for (const product of input.candidates) {
    if (!product.inStock) continue;
    if (excluded.has(product.sku)) continue;

    const categoryScore = (affinityByCategory.get(product.category) ?? 0) / maxAffinity;
    const tagOverlap = product.tags.filter((tag) => tags.has(tag)).length;
    const ratingScore = (product.rating ?? 3.5) / 5;
    // A product the shopper viewed but did not buy is a strong re-surface signal.
    const revisitScore = Math.min(1, Math.log2(1 + (viewCounts.get(product.sku) ?? 0)) / 3);

    const score =
      categoryScore * 3 + Math.min(tagOverlap, 3) * 0.6 + ratingScore * 1.2 + revisitScore * 1.5;

    scored.push({ product, score, reason: reasonFor(product, digest, categoryScore, revisitScore) });
  }

  return scored.sort((a, b) => b.score - a.score || a.product.sku.localeCompare(b.product.sku));
}

function reasonFor(
  product: Product,
  digest: SignalDigest,
  categoryScore: number,
  revisitScore: number,
): string {
  if (revisitScore > 0) return 'You looked at this recently';
  if (digest.currentCategory && product.category === digest.currentCategory) {
    return `More in ${product.category}`;
  }
  if (categoryScore > 0.5) return `Based on your interest in ${product.category}`;
  if ((product.rating ?? 0) >= 4.5) return 'Highly rated';
  return `Popular in ${product.category}`;
}

function headlineFor(digest: SignalDigest): { headline: string; subheadline: string | null } {
  if (digest.isColdStart) {
    return { headline: 'Popular right now', subheadline: null };
  }
  if (digest.cartSkus.length > 0) {
    return { headline: 'Goes with your cart', subheadline: null };
  }
  const topCategory = digest.categoryAffinity[0]?.category;
  if (topCategory) {
    return {
      headline: 'Picked for you',
      subheadline: `More from ${topCategory}`,
    };
  }
  return { headline: 'You might also like', subheadline: null };
}

/**
 * Builds a renderable spec from signals alone. Never throws; returns a spec
 * with an empty block list only when there is genuinely nothing in stock to
 * show, which the renderer treats as "render nothing".
 */
export function buildFallbackSpec(input: TrackingInput, digest: SignalDigest): GeneratedSpec {
  const scored = scoreCandidates(input, digest).slice(0, digest.maxItems);
  const { headline, subheadline } = headlineFor(digest);

  const items: ProductRef[] = scored.map((entry, index) => ({
    sku: entry.product.sku,
    reason: entry.reason,
    badge: null,
    emphasis: index === 0 && scored.length > 2 ? 'featured' : 'normal',
  }));

  const columns: 2 | 3 | 4 = items.length >= 4 ? 4 : items.length === 3 ? 3 : 2;

  return {
    tone: 'neutral',
    headline,
    subheadline,
    blocks:
      items.length === 0
        ? []
        : [
            {
              kind: 'grid',
              title: null,
              columns,
              items,
            },
          ],
    rationale: digest.isColdStart
      ? 'Deterministic fallback: no behavioural signals, ranked by rating and stock.'
      : 'Deterministic fallback: ranked by category affinity, tag overlap, revisit and rating.',
  };
}
