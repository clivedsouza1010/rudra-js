import type { Product, TrackingInputDraft } from '@rudra-js/core';
import type { Shopper } from './shoppers.js';

/** Fixed so a page is reproducible: a moving clock would move every cache key. */
const AT = 1_700_000_000_000;

/**
 * What the shop sends for one page view.
 *
 * Candidates are the merchandising decision — whatever is left out cannot be
 * recommended — so this is where the shop, not the model, decides what is
 * eligible.
 */
export function buildTrackingInput(
  shopper: Shopper,
  currentSku: string,
  catalog: readonly Product[],
): TrackingInputDraft {
  const current = catalog.find((product) => product.sku === currentSku);
  const candidates = catalog
    .filter((product) => product.isInStock && product.sku !== currentSku)
    .filter((product) => !current || product.category === current.category)
    .slice(0, 24);

  return {
    user: { id: shopper.id, segment: shopper.segment, isReturning: shopper.isReturning },
    context: {
      surface: 'pdp',
      slot: 'recommendations',
      currentSku,
      ...(current ? { currentCategory: current.category } : {}),
      locale: 'en-US',
      maxItems: 4,
    },
    signals: {
      likes: shopper.likedSkus.map((sku) => ({ sku, at: AT })),
      mostViewed: shopper.viewedSkus.map((sku, position) => ({
        sku,
        at: AT,
        views: shopper.viewedSkus.length - position,
      })),
      cart: shopper.cartSkus.map((sku) => ({ sku, at: AT })),
      recentSearches: shopper.searches,
    },
    candidates:
      candidates.length > 0 ? candidates : catalog.filter((p) => p.isInStock).slice(0, 24),
  };
}
