import { describe, expect, it } from 'vitest';
import { parseTrackingInput, productSchema } from '@rudra-js/core';
import { generateCatalog } from './catalog';
import { generateShoppers } from './shoppers';
import { generateBundles } from './bundles';
import { buildTrackingInput } from './tracking-input';

const catalog = generateCatalog(1, 200);
const shoppers = generateShoppers(9, catalog, 50);
const bundles = generateBundles(catalog);

describe('the tracking payload the shop builds', () => {
  it('is accepted by the payload contract for every shopper', () => {
    for (const shopper of shoppers) {
      expect(() =>
        parseTrackingInput(buildTrackingInput(shopper, 'RJ-00001', catalog, bundles)),
      ).not.toThrow();
    }
  });

  it('offers only in-stock candidates', () => {
    // Out-of-stock products are dropped by reconciliation anyway; sending them
    // spends prompt budget on products that cannot be placed.
    const input = buildTrackingInput(shoppers[0]!, 'RJ-00001', catalog, bundles);

    expect(input.candidates?.every((candidate) => candidate.isInStock === true)).toBe(true);
  });

  it('puts the product being viewed in the context, not in the signals', () => {
    const input = buildTrackingInput(shoppers[0]!, 'RJ-00042', catalog, bundles);

    expect(input.context.currentSku).toBe('RJ-00042');
  });

  it('gives two different shoppers different payloads', () => {
    // Identical payloads would collapse to one cache key, and every later
    // measurement of hit rate would be measuring the fixture.
    const first = buildTrackingInput(shoppers[0]!, 'RJ-00001', catalog, bundles);
    const second = buildTrackingInput(shoppers[1]!, 'RJ-00001', catalog, bundles);

    expect(first).not.toEqual(second);
    // The two shoppers' other fields (segment, signals, ...) already differ by
    // chance, so the assertion above passes even if `user.id` were hardcoded.
    // This pins down the specific field a cache key would be built from.
    expect(first.user.id).not.toBe(second.user.id);
  });

  it('never recommends the product being viewed, even when its category has no other in-stock member', () => {
    // Forces the fallback branch: the primary category filter comes up empty,
    // so this only exercises anything when that fallback also excludes the
    // viewed SKU.
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
    // A small, hand-picked catalog rather than the generated one, so which
    // SKUs land in the candidate list is a fact of the test, not a guess.
    const smallCatalog = [
      productSchema.parse({ sku: 'current', title: 'Current', category: 'Cat', price: 15 }),
      productSchema.parse({ sku: 'A', title: 'A', category: 'Cat', price: 10 }),
      productSchema.parse({ sku: 'B', title: 'B', category: 'Cat', price: 20 }),
    ];

    it('keeps a bundle whose members are all candidates', () => {
      const bundle = { id: 'BUN-1', skus: ['A', 'B'], price: 25 };

      const input = buildTrackingInput(shoppers[0]!, 'current', smallCatalog, [bundle]);

      expect(input.bundles).toEqual([bundle]);
    });

    it('drops a bundle that names a product outside the candidates', () => {
      const bundle = { id: 'BUN-2', skus: ['A', 'not-a-candidate'], price: 5 };

      const input = buildTrackingInput(shoppers[0]!, 'current', smallCatalog, [bundle]);

      expect(input.bundles).toEqual([]);
    });
  });
});
