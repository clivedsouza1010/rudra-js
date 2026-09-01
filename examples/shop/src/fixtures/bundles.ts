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
    if (group.length < 2) continue;

    // Track the two cheapest as we scan, so nothing has to sort the group.
    let cheapest: Product | undefined;
    let secondCheapest: Product | undefined;
    for (const product of group) {
      if (!cheapest || product.price < cheapest.price) {
        secondCheapest = cheapest;
        cheapest = product;
      } else if (!secondCheapest || product.price < secondCheapest.price) {
        secondCheapest = product;
      }
    }
    const twoCheapest = [cheapest!, secondCheapest!];

    let sum = 0;
    for (const product of twoCheapest) sum += product.price;

    bundles.push({
      id: `BUN-${category.replaceAll(' ', '-')}`,
      skus: twoCheapest.map((product) => product.sku),
      price: Math.round(sum * 0.9 * 100) / 100,
      // This shop prices everything in dollars, same as the catalog.
      currency: 'USD',
      label: `${category} starter set`,
    });
  }

  return bundles;
}
