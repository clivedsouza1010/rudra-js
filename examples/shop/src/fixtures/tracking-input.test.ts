import { describe, expect, it } from 'vitest';
import { parseTrackingInput } from '@rudra-js/core';
import { generateCatalog } from './catalog';
import { generateShoppers } from './shoppers';
import { buildTrackingInput } from './tracking-input';

const catalog = generateCatalog(1, 200);
const shoppers = generateShoppers(9, catalog, 50);

describe('the tracking payload the shop builds', () => {
  it('is accepted by the payload contract for every shopper', () => {
    for (const shopper of shoppers) {
      expect(() =>
        parseTrackingInput(buildTrackingInput(shopper, 'RJ-00001', catalog)),
      ).not.toThrow();
    }
  });

  it('offers only in-stock candidates', () => {
    // Out-of-stock products are dropped by reconciliation anyway; sending them
    // spends prompt budget on products that cannot be placed.
    const input = buildTrackingInput(shoppers[0]!, 'RJ-00001', catalog);

    expect(input.candidates?.every((candidate) => candidate.isInStock === true)).toBe(true);
  });

  it('puts the product being viewed in the context, not in the signals', () => {
    const input = buildTrackingInput(shoppers[0]!, 'RJ-00042', catalog);

    expect(input.context.currentSku).toBe('RJ-00042');
  });

  it('gives two different shoppers different payloads', () => {
    // Identical payloads would collapse to one cache key, and every later
    // measurement of hit rate would be measuring the fixture.
    const first = buildTrackingInput(shoppers[0]!, 'RJ-00001', catalog);
    const second = buildTrackingInput(shoppers[1]!, 'RJ-00001', catalog);

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

    const input = buildTrackingInput(shoppers[0]!, viewed.sku, catalogWithoutCategoryPeers);

    expect(input.candidates.length).toBeGreaterThan(0);
    expect(input.candidates.some((candidate) => candidate.sku === viewed.sku)).toBe(false);
  });
});
