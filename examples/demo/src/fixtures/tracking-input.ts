import type { Bundle, Product, TrackingInputDraft } from '@rudra-js/core';
import type { Shopper } from './shoppers';

const AT = 1_700_000_000_000;

export function buildTrackingInput(
  shopper: Shopper,
  currentSku: string,
  catalog: readonly Product[],
  bundles: readonly Bundle[],
): TrackingInputDraft {
  const current = catalog.find((product) => product.sku === currentSku);
  const offerable = catalog.filter((product) => product.isInStock && product.sku !== currentSku);
  const inCategory = offerable.filter(
    (product) => !current || product.category === current.category,
  );
  const finalCandidates = (inCategory.length > 0 ? inCategory : offerable).slice(0, 24);

  const candidateSkus = new Set(finalCandidates.map((product) => product.sku));
  const offered = bundles.filter((bundle) => bundle.skus.every((sku) => candidateSkus.has(sku)));

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
    candidates: finalCandidates,
    bundles: offered,
  };
}
