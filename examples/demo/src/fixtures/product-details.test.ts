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

  it('split the ratings so the bars average out to the product rating', () => {
    for (const product of catalog) {
      const details = detailsFor(product);
      if (details.reviewCount < 50) continue;
      const average =
        details.ratingCounts.reduce((sum, count, index) => sum + count * (5 - index), 0) /
        details.reviewCount;

      expect(Math.abs(average - (product.rating ?? 0))).toBeLessThan(0.06);
    }
  });

  it('never show a review at a star level the bars say nobody gave', () => {
    for (const product of generateCatalog(1)) {
      const details = detailsFor(product);

      for (const review of details.reviews) {
        expect(details.ratingCounts[5 - review.rating]).toBeGreaterThan(0);
      }
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

  it('never contradicts the highlights in the specs', () => {
    for (const product of generateCatalog(1)) {
      const details = detailsFor(product);
      const spec = (label: string) => details.specs.find(([name]) => name === label)?.[1];

      if (details.highlights.includes('Built light for long days')) {
        expect(spec('Weight class')).not.toBe('Heavyweight');
      }
      if (details.highlights.some((line) => line.includes('two doors'))) {
        expect(spec('Sleeps')).not.toBe('1');
      }
      if (details.highlights.some((line) => line.startsWith('Wide fit'))) {
        expect(['Snug', 'Regular']).not.toContain(spec('Fit'));
      }
    }
  });

  it('writes weights the way a store would, never as 16 oz or 0 oz', () => {
    for (const product of generateCatalog(1)) {
      const weight = detailsFor(product).specs.find(([label]) => label === 'Weight')?.[1] ?? '';

      expect(weight).not.toMatch(/ (16|0) oz$|^16\.0 oz$/);
    }
  });
});
