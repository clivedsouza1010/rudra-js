import { productSchema, type Product } from '@rudra-js/core';
import { createSeededRandom } from './seeded-random.js';

const CATEGORIES = [
  'Trail Running',
  'Road Running',
  'Hiking Boots',
  'Approach Shoes',
  'Insulated Jackets',
  'Rain Shells',
  'Base Layers',
  'Backpacks',
  'Tents',
  'Sleeping Bags',
  'Headlamps',
  'Trekking Poles',
] as const;

const MATERIALS = ['Gore-Tex', 'Merino', 'Ripstop', 'Vibram', 'Primaloft', 'Cordura'];
const MODELS = ['Switchback', 'Ridgeline', 'Cirque', 'Traverse', 'Saddle', 'Cascade', 'Talus'];
const TAGS = ['waterproof', 'lightweight', 'insulated', 'breathable', 'recycled', 'wide-fit'];

/**
 * A catalog as a function of a seed.
 *
 * Committing a generator rather than a data file keeps a 2,000-product catalog
 * to a page of code, and makes a change to it show up in review as an intent
 * rather than as a wall of regenerated JSON.
 */
export function generateCatalog(seed: number, size = 2000): Product[] {
  const random = createSeededRandom(seed);
  const pick = <Item>(items: readonly Item[]): Item => items[Math.floor(random() * items.length)]!;

  return Array.from({ length: size }, (_unused, index) => {
    const category = pick(CATEGORIES);
    const tagCount = Math.floor(random() * 3);

    return productSchema.parse({
      sku: `RJ-${String(index + 1).padStart(5, '0')}`,
      title: `${pick(MODELS)} ${pick(MATERIALS)} ${category.split(' ').at(-1)}`,
      category,
      price: Math.round((20 + random() * 480) * 100) / 100,
      currency: 'USD',
      imageUrl: `/images/rj-${String(index + 1).padStart(5, '0')}.webp`,
      rating: Math.round(random() * 50) / 10,
      // A tenth out of stock: reconciliation drops these, and a catalog where
      // that never happens never exercises it.
      isInStock: random() > 0.1,
      tags: Array.from({ length: tagCount }, () => pick(TAGS)).filter(
        (tag, position, all) => all.indexOf(tag) === position,
      ),
    });
  });
}
