import type { Bundle, Product } from '@rudra-js/core';

// One set per category: the two cheapest things in stock, at a tenth off.
export function generateBundles(catalog: readonly Product[]): Bundle[] {
  const byCategory = new Map<string, Product[]>();
  for (const product of catalog) {
    if (!product.isInStock) continue;
    const group = byCategory.get(product.category) ?? [];
    group.push(product);
    byCategory.set(product.category, group);
  }

  const bundles: Bundle[] = [];
  for (const [category, group] of byCategory) {
    const [cheapest, secondCheapest] = group.toSorted((left, right) => left.price - right.price);
    if (!cheapest || !secondCheapest) continue;

    bundles.push({
      id: `BUN-${category.replaceAll(' ', '-')}`,
      skus: [cheapest.sku, secondCheapest.sku],
      price: Math.round((cheapest.price + secondCheapest.price) * 0.9 * 100) / 100,
      // This shop prices everything in dollars, same as the catalog.
      currency: 'USD',
      label: `${category} starter set`,
    });
  }

  return bundles;
}
