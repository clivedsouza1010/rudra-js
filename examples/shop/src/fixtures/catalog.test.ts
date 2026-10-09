import { describe, expect, it } from 'vitest';
import { productSchema } from '@rudra-js/core';
import { generateCatalog } from './catalog';

describe('the generated catalog', () => {
  it('is identical for the same seed', () => {
    expect(generateCatalog(1, 50)[0]).toEqual({
      sku: 'RJ-00001',
      title: 'Traverse Cordura Backpacks',
      category: 'Backpacks',
      price: 484.82,
      currency: 'USD',
      imageUrl: '/images/rj-00001.webp',
      rating: 1.4,
      isInStock: true,
      tags: [],
    });
  });

  it('differs for a different seed', () => {
    expect(generateCatalog(1, 50)).not.toEqual(generateCatalog(2, 50));
  });

  it('produces exactly the number of products asked for', () => {
    expect(generateCatalog(1, 37)).toHaveLength(37);
  });

  it('gives every product a unique SKU', () => {
    const catalog = generateCatalog(1, 2000);

    expect(new Set(catalog.map((product) => product.sku)).size).toBe(catalog.length);
  });

  it('produces only products the payload contract accepts', () => {
    for (const product of generateCatalog(3, 200)) {
      expect(() => productSchema.parse(product)).not.toThrow();
    }
  });

  it('spreads products across a category tree rather than one category', () => {
    const catalog = generateCatalog(4, 500);
    const categories = new Set(catalog.map((product) => product.category));

    expect(categories.size).toBeGreaterThanOrEqual(8);
  });

  it('leaves some products out of stock, because reconciliation must see both', () => {
    const catalog = generateCatalog(5, 500);

    expect(catalog.some((product) => !product.isInStock)).toBe(true);
    expect(catalog.some((product) => product.isInStock)).toBe(true);
  });
});
