import { describe, expect, it } from 'vitest';
import { generateCatalog } from './catalog.js';
import { generateShoppers } from './shoppers.js';

const catalog = generateCatalog(1, 200);

describe('the generated shopper population', () => {
  it('is identical for the same seed', () => {
    // Pinned to one shopper captured from a real run, not cross-checked
    // against a second call: a generator that ignored `seed` and always
    // started from one hardcoded state would leave both sides equally wrong,
    // and two live invocations agreeing with each other would not catch that.
    expect(generateShoppers(9, catalog, 20)[0]).toEqual({
      id: 'S-0001',
      segment: 'lapsed',
      isReturning: false,
      likedSkus: ['RJ-00145', 'RJ-00138', 'RJ-00053'],
      viewedSkus: [
        'RJ-00027',
        'RJ-00127',
        'RJ-00140',
        'RJ-00118',
        'RJ-00057',
        'RJ-00188',
        'RJ-00058',
        'RJ-00147',
      ],
      cartSkus: ['RJ-00074'],
      searches: ['merino base layer'],
    });
  });

  it('gives every shopper a unique id', () => {
    const shoppers = generateShoppers(9, catalog, 500);

    expect(new Set(shoppers.map((shopper) => shopper.id)).size).toBe(500);
  });

  it('references only SKUs the catalog has', () => {
    // A signal naming a ghost SKU exercises reconciliation's error path by
    // accident, and hides it from the tests that mean to exercise it.
    const skus = new Set(catalog.map((product) => product.sku));

    for (const shopper of generateShoppers(9, catalog, 100)) {
      for (const sku of [...shopper.likedSkus, ...shopper.viewedSkus, ...shopper.cartSkus]) {
        expect(skus).toContain(sku);
      }
    }
  });

  it('includes a cold-start shopper and a rich one, because they take different paths', () => {
    const shoppers = generateShoppers(9, catalog, 200);

    expect(shoppers.some((shopper) => shopper.viewedSkus.length === 0)).toBe(true);
    expect(shoppers.some((shopper) => shopper.viewedSkus.length >= 5)).toBe(true);
  });

  it('spreads shoppers across segments, so a cohort key has something to key on', () => {
    const segments = new Set(generateShoppers(9, catalog, 200).map((shopper) => shopper.segment));

    expect(segments.size).toBeGreaterThanOrEqual(3);
  });
});
