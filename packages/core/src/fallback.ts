import type { GeneratedSpec, ProductRef } from './component-spec.js';
import type { SignalDigest } from './digest.js';
import { selectProducts, type ProductPick } from './select.js';
import type { TrackingInput } from './tracking-input.js';

/**
 * The deterministic component — what renders when no model does.
 *
 * The manuscript names data latency as the central risk of moving
 * personalisation onto the server path: any delay in the recommendation engine
 * blocks the page. This module is the answer. It is pure, synchronous, and
 * cannot fail, so the server always has something correct to render — whether
 * the model is slow, erroring, rate-limited, or simply not configured.
 *
 * It reads the same digest and uses the same selector the model path does, so a
 * degraded render is a weaker version of the same decision rather than an
 * unrelated one. Only the presentation is fixed.
 */

/** A featured lead only reads as deliberate when something follows it. */
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

/** Wide enough to fill, never wider. */
function columnsFor(itemCount: number): 2 | 3 | 4 {
  if (itemCount >= 4) return 4;
  if (itemCount === 3) return 3;
  return 2;
}

function toProductRef(pick: ProductPick, index: number, total: number): ProductRef {
  return {
    sku: pick.product.sku,
    basis: pick.basis,
    reason: pick.reason,
    badge: null,
    emphasis: index === 0 && total >= MIN_PICKS_FOR_A_FEATURED_LEAD ? 'featured' : 'normal',
  };
}

/**
 * Builds a renderable spec from signals alone. Never throws. Returns a spec with
 * no blocks only when there is genuinely nothing in stock left to show, which
 * the renderer treats as "render nothing" — an empty recommendation region is
 * worse than none.
 */
export function buildFallbackSpec(input: TrackingInput, digest: SignalDigest): GeneratedSpec {
  const picks = selectProducts(input, digest).slice(0, digest.maxItems);
  const { headline, subheadline } = headlineFor(digest);
  const items = picks.map((pick, index) => toProductRef(pick, index, picks.length));

  return {
    tone: 'neutral',
    headline,
    subheadline,
    blocks:
      items.length === 0
        ? []
        : [{ kind: 'grid', title: null, columns: columnsFor(items.length), items }],
    rationale: digest.isColdStart
      ? 'Deterministic: no behavioural signals, ranked by rating and stock.'
      : 'Deterministic: ranked by category affinity, revisit, rating and tag overlap.',
  };
}
