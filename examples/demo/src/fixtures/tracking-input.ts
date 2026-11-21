import type { Bundle, Product, TrackingInputDraft } from '@rudra-js/core';
import type { Shopper } from './shoppers';

const AT = 1_700_000_000_000;

const RELATED: Record<string, string[]> = {
  'Trail Running': ['Road Running', 'Base Layers', 'Headlamps'],
  'Road Running': ['Trail Running', 'Base Layers', 'Headlamps'],
  'Hiking Boots': ['Trekking Poles', 'Backpacks', 'Approach Shoes'],
  'Approach Shoes': ['Hiking Boots', 'Backpacks', 'Trekking Poles'],
  'Insulated Jackets': ['Base Layers', 'Rain Shells', 'Sleeping Bags'],
  'Rain Shells': ['Insulated Jackets', 'Backpacks', 'Base Layers'],
  'Base Layers': ['Insulated Jackets', 'Rain Shells', 'Trail Running'],
  Backpacks: ['Tents', 'Sleeping Bags', 'Headlamps', 'Trekking Poles'],
  Tents: ['Sleeping Bags', 'Backpacks', 'Headlamps'],
  'Sleeping Bags': ['Tents', 'Insulated Jackets', 'Headlamps'],
  Headlamps: ['Tents', 'Trail Running', 'Backpacks'],
  'Trekking Poles': ['Hiking Boots', 'Backpacks', 'Rain Shells'],
};

function buildSlotInput(
  shopper: Shopper,
  currentSku: string,
  current: Product | undefined,
  candidates: Product[],
  bundles: readonly Bundle[],
  slot: string,
  maxItems: number,
): TrackingInputDraft {
  const candidateSkus = new Set(candidates.map((product) => product.sku));
  const offered = bundles.filter((bundle) => bundle.skus.every((sku) => candidateSkus.has(sku)));

  return {
    user: { id: shopper.id, segment: shopper.segment, isReturning: shopper.isReturning },
    context: {
      surface: 'pdp',
      slot,
      currentSku,
      ...(current ? { currentCategory: current.category } : {}),
      locale: 'en-US',
      maxItems,
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
    candidates,
    bundles: offered,
  };
}

function offerableBesides(catalog: readonly Product[], currentSku: string): Product[] {
  return catalog.filter((product) => product.isInStock && product.sku !== currentSku);
}

function distinctTitles(products: Product[], current: Product): Product[] {
  const titles = new Set([current.title]);
  return products.filter((product) => {
    if (titles.has(product.title)) return false;
    titles.add(product.title);
    return true;
  });
}

export function buildTrackingInput(
  shopper: Shopper,
  currentSku: string,
  catalog: readonly Product[],
  bundles: readonly Bundle[],
): TrackingInputDraft {
  const current = catalog.find((product) => product.sku === currentSku);
  const offerable = offerableBesides(catalog, currentSku);
  const otherTitles = offerable.filter((product) => !current || product.title !== current.title);
  const inCategory = otherTitles.filter(
    (product) => !current || product.category === current.category,
  );
  const finalCandidates = (
    [inCategory, otherTitles].find((products) => products.length > 0) ?? offerable
  ).slice(0, 24);

  return buildSlotInput(
    shopper,
    currentSku,
    current,
    finalCandidates,
    bundles,
    'recommendations',
    4,
  );
}

export function buildCompareInput(
  shopper: Shopper,
  current: Product,
  catalog: readonly Product[],
  bundles: readonly Bundle[],
): TrackingInputDraft {
  const nearestInPrice = offerableBesides(catalog, current.sku)
    .filter((product) => product.category === current.category)
    .toSorted(
      (left, right) => Math.abs(left.price - current.price) - Math.abs(right.price - current.price),
    );
  const candidates = distinctTitles(nearestInPrice, current).slice(0, 12);

  return buildSlotInput(
    shopper,
    current.sku,
    current,
    candidates,
    bundles,
    'compare-similar-items',
    4,
  );
}

export function buildMoreToConsiderInput(
  shopper: Shopper,
  current: Product,
  catalog: readonly Product[],
  bundles: readonly Bundle[],
): TrackingInputDraft {
  const related = RELATED[current.category] ?? [];
  const byCategory = related.map((category) =>
    distinctTitles(
      offerableBesides(catalog, current.sku).filter((product) => product.category === category),
      current,
    ),
  );
  const candidates: Product[] = [];
  for (let index = 0; candidates.length < 24 && index < 24; index += 1) {
    for (const products of byCategory) {
      const product = products[index];
      if (product && candidates.length < 24) candidates.push(product);
    }
  }

  return buildSlotInput(shopper, current.sku, current, candidates, bundles, 'more-to-consider', 8);
}

export function buildAlsoViewedInput(
  shopper: Shopper,
  current: Product,
  catalog: readonly Product[],
  bundles: readonly Bundle[],
  shoppers: readonly Shopper[],
): TrackingInputDraft {
  const bySku = new Map(catalog.map((product) => [product.sku, product]));
  const views = new Map<string, number>();
  for (const other of shoppers) {
    if (other.id === shopper.id) continue;
    const browsedHere = other.viewedSkus.some(
      (sku) => bySku.get(sku)?.category === current.category,
    );
    if (!browsedHere) continue;
    for (const sku of other.viewedSkus) views.set(sku, (views.get(sku) ?? 0) + 1);
  }

  const offerable = offerableBesides(catalog, current.sku);
  const viewed = offerable
    .filter((product) => views.has(product.sku))
    .toSorted((left, right) => views.get(right.sku)! - views.get(left.sku)!);
  const sameCategory = offerable.filter(
    (product) => product.category === current.category && !views.has(product.sku),
  );
  const candidates = distinctTitles([...viewed, ...sameCategory], current).slice(0, 24);

  return buildSlotInput(
    shopper,
    current.sku,
    current,
    candidates,
    bundles,
    'customers-also-viewed',
    8,
  );
}
