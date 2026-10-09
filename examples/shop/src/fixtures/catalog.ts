import { productSchema, type Product } from '@rudra-js/core';
import { mulberry32, pick } from './seeded-random';

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

export function generateCatalog(seed: number, size = 2000): Product[] {
  const random = mulberry32(seed);

  return Array.from({ length: size }, (_unused, index) => {
    const category = pick(random, CATEGORIES);
    const tagCount = Math.floor(random() * 3);

    return productSchema.parse({
      sku: `RJ-${String(index + 1).padStart(5, '0')}`,
      title: `${pick(random, MODELS)} ${pick(random, MATERIALS)} ${category.split(' ').at(-1)}`,
      category,
      price: Math.round((20 + random() * 480) * 100) / 100,
      currency: 'USD',
      imageUrl: `/images/rj-${String(index + 1).padStart(5, '0')}.webp`,
      rating: Math.round(random() * 50) / 10,
      isInStock: random() > 0.1,
      tags: [...new Set(Array.from({ length: tagCount }, () => pick(random, TAGS)))],
    });
  });
}
