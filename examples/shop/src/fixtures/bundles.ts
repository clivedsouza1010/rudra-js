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

    // The two cheapest in one pass, so nothing has to sort the whole group.
    let first: Product | undefined;
    let second: Product | undefined;
    for (const product of group) {
      if (!first || product.price < first.price) {
        second = first;
        first = product;
      } else if (!second || product.price < second.price) {
        second = product;
      }
    }
    const cheapest = [first!, second!];

    let sum = 0;
    for (const product of cheapest) sum += product.price;

    bundles.push({
      id: `BUN-${category.replaceAll(' ', '-')}`,
      skus: cheapest.map((product) => product.sku),
      price: Math.round(sum * 0.9 * 100) / 100,
      label: `${category} starter set`,
    });
  }

  return bundles;
}
