import { describe, expect, it } from 'vitest';
import { generateCatalog } from './catalog';
import { SWATCHES, colorIndexFor, detailsFor } from './product-details';

const catalog = generateCatalog(1, 400);

describe('the made-up product details', () => {
  it('are the same every time for the same product', () => {
    const product = catalog[0]!;

    expect(detailsFor(product)).toEqual(detailsFor(product));
  });

  it('split the ratings so they add up to the review count', () => {
    for (const product of catalog) {
      const details = detailsFor(product);
      const total = details.ratingCounts.reduce((left, right) => left + right, 0);

      expect(total).toBe(details.reviewCount);
      expect(details.ratingCounts.every((count) => count >= 0)).toBe(true);
    }
  });

  it('show no reviews for a product rated below one star', () => {
    const product = catalog.find((candidate) => (candidate.rating ?? 0) < 1)!;

    expect(detailsFor(product).reviewCount).toBe(0);
    expect(detailsFor(product).reviews).toEqual([]);
  });

  it('lead with a critical review when the product is rated poorly', () => {
    const product = catalog.find(
      (candidate) => (candidate.rating ?? 0) >= 1 && (candidate.rating ?? 0) < 2.5,
    )!;

    expect(detailsFor(product).reviews[0]!.rating).toBeLessThanOrEqual(2);
  });

  it('start the swatches with the color the product image is drawn in', () => {
    const product = catalog[3]!;

    expect(detailsFor(product).swatches[0]).toEqual(SWATCHES[colorIndexFor(product.sku)]);
  });

  it('list the item number in the specs', () => {
    const product = catalog[7]!;

    expect(detailsFor(product).specs).toContainEqual(['Item number', product.sku]);
  });

  it('never lists an outsole as a material', () => {
    for (const product of catalog.filter((candidate) => candidate.title.includes('Vibram'))) {
      const material = detailsFor(product).specs.find(([label]) => label === 'Material')?.[1];

      expect(material).not.toContain('outsole');
    }
  });
});
