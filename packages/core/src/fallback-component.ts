import { columnsFor, type GeneratedSpec, type ProductReference } from './component-spec.js';
import type { SignalDigest } from './signal-digest.js';
import { selectProducts, type SelectOptions } from './product-selection.js';
import type { TrackingInput } from './tracking-input.js';

const MIN_PICKS_FOR_A_FEATURED_LEAD = 3;

function headlineFor(digest: SignalDigest): { headline: string; subheadline: string | null } {
  if (digest.isColdStart) {
    return { headline: 'Popular right now', subheadline: null };
  }
  if (digest.cartSkus.length > 0) {
    return { headline: 'Goes with your cart', subheadline: null };
  }
  const topCategory = digest.categoryAffinity[0]?.category;
  if (topCategory) {
    return { headline: 'Picked for you', subheadline: `More from ${topCategory}` };
  }
  return { headline: 'You might also like', subheadline: null };
}

export function buildFallbackSpec(
  input: TrackingInput,
  digest: SignalDigest,
  options: SelectOptions = {},
): GeneratedSpec {
  const picks = selectProducts(input, digest, options).slice(0, digest.maxItems);
  const { headline, subheadline } = headlineFor(digest);
  const isLeadFeatured = picks.length >= MIN_PICKS_FOR_A_FEATURED_LEAD;
  const items: ProductReference[] = picks.map((pick, index) => ({
    sku: pick.product.sku,
    basis: pick.basis,
    reason: pick.reason,
    badge: null,
    emphasis: index === 0 && isLeadFeatured ? 'featured' : 'normal',
  }));

  return {
    tone: 'neutral',
    headline,
    subheadline,
    blocks:
      items.length === 0
        ? []
        : [{ kind: 'grid', title: null, columns: columnsFor(items.length, 4), items }],
    rationale: digest.isColdStart
      ? 'Deterministic: no behavioural signals, ranked by rating and stock.'
      : 'Deterministic: ranked by category affinity, revisit, rating and tag overlap.',
  };
}
