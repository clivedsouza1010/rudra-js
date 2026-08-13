import type { Product } from '@rudra/core';

/**
 * A seeded catalog. Deliberately small and deliberately structured: five
 * categories with overlapping tags, so category affinity and tag overlap
 * produce visibly different components for different shoppers.
 */

/**
 * Product imagery is generated as an inline SVG data URI rather than fetched.
 * Network image requests would dominate the FCP/LCP measurements and make the
 * SSR-vs-CSR comparison a test of the image pipeline instead of the rendering
 * strategy.
 */
function placeholder(sku: string, label: string): string {
  let hash = 0;
  for (let i = 0; i < sku.length; i += 1) hash = (hash * 31 + sku.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="hsl(${hue} 45% 90%)"/><circle cx="100" cy="82" r="42" fill="hsl(${hue} 45% 74%)"/><text x="100" y="160" font-family="sans-serif" font-size="15" fill="hsl(${hue} 40% 34%)" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

interface Seed {
  sku: string;
  title: string;
  category: string;
  price: number;
  rating: number;
  tags: string[];
  inStock?: boolean;
}

const SEEDS: Seed[] = [
  // Trail running
  { sku: 'TR-101', title: 'Ridgeline Trail Shoe', category: 'Trail Running', price: 139.0, rating: 4.6, tags: ['trail', 'footwear', 'grip'] },
  { sku: 'TR-102', title: 'Switchback Trail Shoe GTX', category: 'Trail Running', price: 174.0, rating: 4.8, tags: ['trail', 'footwear', 'waterproof'] },
  { sku: 'TR-103', title: 'Scree Gaiters', category: 'Trail Running', price: 34.0, rating: 4.2, tags: ['trail', 'accessory'] },
  { sku: 'TR-104', title: 'Hydration Vest 8L', category: 'Trail Running', price: 118.0, rating: 4.5, tags: ['trail', 'hydration', 'pack'] },

  // Hiking
  { sku: 'HK-201', title: 'Summit Approach Boot', category: 'Hiking', price: 205.0, rating: 4.7, tags: ['hiking', 'footwear', 'waterproof'] },
  { sku: 'HK-202', title: 'Carbon Trekking Poles', category: 'Hiking', price: 149.0, rating: 4.6, tags: ['hiking', 'accessory', 'lightweight'] },
  { sku: 'HK-203', title: 'Merino Hiking Sock 3-Pack', category: 'Hiking', price: 42.0, rating: 4.4, tags: ['hiking', 'merino', 'consumable'] },
  { sku: 'HK-204', title: 'Daypack 24L', category: 'Hiking', price: 96.0, rating: 4.3, tags: ['hiking', 'pack'] },

  // Outerwear
  { sku: 'OW-301', title: 'Stormline Hardshell', category: 'Outerwear', price: 289.0, rating: 4.8, tags: ['waterproof', 'shell', 'lightweight'] },
  { sku: 'OW-302', title: 'Alpine Down Hoody', category: 'Outerwear', price: 249.0, rating: 4.7, tags: ['insulation', 'lightweight'] },
  { sku: 'OW-303', title: 'Gridline Fleece', category: 'Outerwear', price: 89.0, rating: 4.4, tags: ['midlayer', 'fleece'] },
  { sku: 'OW-304', title: 'Packable Wind Shell', category: 'Outerwear', price: 74.0, rating: 4.1, tags: ['shell', 'lightweight'], inStock: false },

  // Camping
  { sku: 'CP-401', title: 'Featherlite 2P Tent', category: 'Camping', price: 379.0, rating: 4.6, tags: ['shelter', 'lightweight'] },
  { sku: 'CP-402', title: 'Down Bag -7°C', category: 'Camping', price: 265.0, rating: 4.5, tags: ['insulation', 'sleep'] },
  { sku: 'CP-403', title: 'Titanium Cook Set', category: 'Camping', price: 82.0, rating: 4.3, tags: ['cooking', 'lightweight'] },
  { sku: 'CP-404', title: 'Inflatable Sleep Pad', category: 'Camping', price: 128.0, rating: 4.4, tags: ['sleep', 'lightweight'] },

  // Nutrition
  { sku: 'NU-501', title: 'Electrolyte Tabs (20)', category: 'Nutrition', price: 14.0, rating: 4.5, tags: ['hydration', 'consumable'] },
  { sku: 'NU-502', title: 'Energy Gel Box (12)', category: 'Nutrition', price: 32.0, rating: 4.2, tags: ['consumable', 'fuel'] },
  { sku: 'NU-503', title: 'Recovery Protein 1kg', category: 'Nutrition', price: 54.0, rating: 4.3, tags: ['consumable', 'recovery'] },
];

export const CATALOG: Product[] = SEEDS.map((seed) => ({
  sku: seed.sku,
  title: seed.title,
  category: seed.category,
  price: seed.price,
  currency: 'USD',
  imageUrl: placeholder(seed.sku, seed.sku),
  rating: seed.rating,
  inStock: seed.inStock ?? true,
  tags: seed.tags,
}));

export const CATALOG_BY_SKU = new Map(CATALOG.map((product) => [product.sku, product]));

export function getProduct(sku: string): Product | undefined {
  return CATALOG_BY_SKU.get(sku);
}

/**
 * The candidate set handed to the generator.
 *
 * Narrowing candidates before generation is a merchandising decision, not a
 * model decision: it is where stock rules, margin rules and regional
 * availability belong. The model then chooses within that set.
 */
export function candidatesFor(currentSku: string | undefined, limit = 12): Product[] {
  const current = currentSku ? CATALOG_BY_SKU.get(currentSku) : undefined;

  const scored = CATALOG.filter((product) => product.inStock && product.sku !== currentSku).map(
    (product) => {
      let score = product.rating ?? 0;
      if (current) {
        if (product.category === current.category) score += 3;
        score += product.tags.filter((tag) => current.tags.includes(tag)).length;
      }
      return { product, score };
    },
  );

  return scored
    .sort((a, b) => b.score - a.score || a.product.sku.localeCompare(b.product.sku))
    .slice(0, limit)
    .map((entry) => entry.product);
}
