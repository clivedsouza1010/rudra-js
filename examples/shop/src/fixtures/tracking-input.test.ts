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
