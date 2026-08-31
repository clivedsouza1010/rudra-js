import { productSchema } from '@rudra-js/core';
import { describe, expect, it } from 'vitest';
import { generateCatalog } from './catalog.js';
import { generateBundles } from './bundles.js';

const catalog = generateCatalog(1, 200);

/** Small enough to work out the right answer by hand. */
const handBuilt = [
  { sku: 'TR-1', title: 'Trail one', category: 'Trail Running', price: 100 },
  { sku: 'TR-2', title: 'Trail two', category: 'Trail Running', price: 50 },
  { sku: 'TR-3', title: 'Trail three', category: 'Trail Running', price: 70 },
  { sku: 'TR-4', title: 'Trail four', category: 'Trail Running', price: 10, isInStock: false },
  { sku: 'TE-1', title: 'Tent one', category: 'Tents', price: 300 },
].map((product) => productSchema.parse(product));

describe('the generated bundles', () => {
  it('pairs the two cheapest in stock in a category, at a tenth off', () => {
    // Trail Running: 50 and 70, cheapest first. The 10 is out of stock, and
    // Tents has only one product, so it gets no set at all.
    expect(generateBundles(handBuilt)).toEqual([
      {
        id: 'BUN-Trail-Running',
        skus: ['TR-2', 'TR-3'],
        price: 108,
        label: 'Trail Running starter set',
      },
    ]);
  });

  it('pairs products from the same category', () => {
    const categoryOf = new Map(catalog.map((product) => [product.sku, product.category]));

    for (const bundle of generateBundles(catalog)) {
      const categories = new Set(bundle.skus.map((sku) => categoryOf.get(sku)));
      expect(categories.size).toBe(1);
    }
  });

  it('rounds a set price to the penny', () => {
    // A tenth off 33.33 and 66.66 is 89.991, and a shop cannot charge that.
    const awkward = [
      { sku: 'X-1', title: 'One', category: 'Tents', price: 33.33 },
      { sku: 'X-2', title: 'Two', category: 'Tents', price: 66.66 },
    ].map((product) => productSchema.parse(product));

    expect(generateBundles(awkward)[0]?.price).toBe(89.99);
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
