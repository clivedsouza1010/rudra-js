import { describe, expect, it } from 'vitest';
import { generateCatalog } from './catalog.js';
import { generateBundles } from './bundles.js';

const catalog = generateCatalog(1, 200);

describe('the generated bundles', () => {
  it('is identical for the same catalog', () => {
    const [first] = generateBundles(catalog);

    expect(first).toEqual(generateBundles(catalog)[0]);
  });

  it('pairs products from the same category', () => {
    const categoryOf = new Map(catalog.map((product) => [product.sku, product.category]));

    for (const bundle of generateBundles(catalog)) {
      const categories = new Set(bundle.skus.map((sku) => categoryOf.get(sku)));
      expect(categories.size).toBe(1);
    }
  });

  it('prices a set below the sum of its parts, because that is the offer', () => {
    const priceOf = new Map(catalog.map((product) => [product.sku, product.price]));

    for (const bundle of generateBundles(catalog)) {
      let sum = 0;
      for (const sku of bundle.skus) sum += priceOf.get(sku)!;
      expect(bundle.price).toBeLessThan(sum);
    }
  });

  it('uses only products that are in stock', () => {
    const inStock = new Set(catalog.filter((p) => p.isInStock).map((p) => p.sku));

    for (const bundle of generateBundles(catalog)) {
      for (const sku of bundle.skus) expect(inStock).toContain(sku);
    }
  });

  it('never pairs a product with itself', () => {
    for (const bundle of generateBundles(catalog)) {
      expect(new Set(bundle.skus).size).toBe(bundle.skus.length);
    }
  });
});
