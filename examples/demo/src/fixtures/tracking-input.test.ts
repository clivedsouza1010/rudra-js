import { describe, expect, it } from 'vitest';
import { parseTrackingInput, productSchema } from '@rudra-js/core';
import { generateCatalog } from './catalog';
import { generateShoppers } from './shoppers';
import { generateBundles } from './bundles';
import {
  buildAlsoViewedInput,
  buildCompareInput,
  buildMoreToConsiderInput,
  buildTrackingInput,
} from './tracking-input';

const catalog = generateCatalog(1, 200);
const shoppers = generateShoppers(9, catalog, 50);
const bundles = generateBundles(catalog);

describe('the tracking payload the demo builds', () => {
  it('is accepted by the payload contract for every shopper', () => {
    for (const shopper of shoppers) {
      expect(() =>
        parseTrackingInput(buildTrackingInput(shopper, 'RJ-00001', catalog, bundles)),
      ).not.toThrow();
    }
  });

  it('offers only in-stock candidates', () => {
    const input = buildTrackingInput(shoppers[0]!, 'RJ-00001', catalog, bundles);

    expect(input.candidates?.every((candidate) => candidate.isInStock === true)).toBe(true);
  });

  it('puts the product being viewed in the context, not in the signals', () => {
    const input = buildTrackingInput(shoppers[0]!, 'RJ-00042', catalog, bundles);

    expect(input.context.currentSku).toBe('RJ-00042');
  });

  it('gives two different shoppers different payloads', () => {
    const first = buildTrackingInput(shoppers[0]!, 'RJ-00001', catalog, bundles);
    const second = buildTrackingInput(shoppers[1]!, 'RJ-00001', catalog, bundles);

    expect(first).not.toEqual(second);
    expect(first.user.id).not.toBe(second.user.id);
  });

  it('never recommends the product being viewed, even when its category has no other in-stock member', () => {
    const viewed = catalog.find((product) => product.isInStock)!;
    const otherCategoryProducts = catalog.filter(
      (product) => product.category !== viewed.category && product.isInStock,
    );
    const catalogWithoutCategoryPeers = [viewed, ...otherCategoryProducts];

    const input = buildTrackingInput(
      shoppers[0]!,
      viewed.sku,
      catalogWithoutCategoryPeers,
      bundles,
    );

    expect(input.candidates.length).toBeGreaterThan(0);
    expect(input.candidates.some((candidate) => candidate.sku === viewed.sku)).toBe(false);
  });

  describe('the bundles it offers', () => {
    const smallCatalog = [
      productSchema.parse({ sku: 'current', title: 'Current', category: 'Cat', price: 15 }),
      productSchema.parse({ sku: 'A', title: 'A', category: 'Cat', price: 10 }),
      productSchema.parse({ sku: 'B', title: 'B', category: 'Cat', price: 20 }),
    ];

    it('keeps a bundle whose members are all candidates', () => {
      const bundle = { id: 'BUN-1', skus: ['A', 'B'], price: 25, currency: 'USD' };

      const input = buildTrackingInput(shoppers[0]!, 'current', smallCatalog, [bundle]);

      expect(input.bundles).toEqual([bundle]);
    });

    it('drops a bundle that names a product outside the candidates', () => {
      const bundle = { id: 'BUN-2', skus: ['A', 'not-a-candidate'], price: 5, currency: 'USD' };

      const input = buildTrackingInput(shoppers[0]!, 'current', smallCatalog, [bundle]);

      expect(input.bundles).toEqual([]);
    });
  });
});

describe('the three other sections', () => {
  const current = catalog.find((product) => product.category === 'Backpacks')!;
  const shopper = shoppers[0]!;

  it('build payloads the contract accepts, each in its own slot', () => {
    const inputs = [
      buildCompareInput(shopper, current, catalog, bundles),
      buildMoreToConsiderInput(shopper, current, catalog, bundles),
      buildAlsoViewedInput(shopper, current, catalog, bundles, shoppers),
    ];

    expect(inputs.map((input) => parseTrackingInput(input).context.slot)).toEqual([
      'compare-similar-items',
      'more-to-consider',
      'customers-also-viewed',
    ]);
  });

  it('compare products in the same category, nearest in price first', () => {
    const candidates = buildCompareInput(shopper, current, catalog, bundles).candidates ?? [];
    const gaps = candidates.map((product) => Math.abs(product.price - current.price));

    expect(candidates.every((product) => product.category === current.category)).toBe(true);
    expect(gaps).toEqual(gaps.toSorted((left, right) => left - right));
  });

  it('offer related categories under more to consider, not the one being viewed', () => {
    const candidates =
      buildMoreToConsiderInput(shopper, current, catalog, bundles).candidates ?? [];

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((product) => product.category === current.category)).toBe(false);
  });

  it('never offer the product being viewed', () => {
    for (const input of [
      buildCompareInput(shopper, current, catalog, bundles),
      buildMoreToConsiderInput(shopper, current, catalog, bundles),
      buildAlsoViewedInput(shopper, current, catalog, bundles, shoppers),
    ]) {
      expect(input.candidates?.some((product) => product.sku === current.sku)).toBe(false);
    }
  });

  it('still offer something under customers also viewed when nobody else browsed the category', () => {
    const candidates =
      buildAlsoViewedInput(shopper, current, catalog, bundles, []).candidates ?? [];

    expect(candidates.length).toBeGreaterThan(0);
  });
});
