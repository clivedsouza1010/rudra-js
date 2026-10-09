import type { Product } from '@rudra-js/core';
import { mulberry32, pick } from './seeded-random';

export interface Shopper {
  id: string;
  segment: string;
  isReturning: boolean;
  likedSkus: string[];
  viewedSkus: string[];
  cartSkus: string[];
  searches: string[];
}

const SEGMENTS = ['new', 'returning', 'loyalty', 'lapsed'];
const SEARCHES = ['waterproof jacket', 'trail shoes', 'winter tent', 'merino base layer'];

export function generateShoppers(
  seed: number,
  catalog: readonly Product[],
  count = 500,
): Shopper[] {
  const random = mulberry32(seed);
  const someSkus = (howMany: number): string[] => [
    ...new Set(Array.from({ length: howMany }, () => pick(random, catalog).sku)),
  ];

  return Array.from({ length: count }, (_unused, index) => {
    const isColdStart = random() < 0.1;

    return {
      id: `S-${String(index + 1).padStart(4, '0')}`,
      segment: pick(random, SEGMENTS),
      isReturning: !isColdStart && random() > 0.3,
      likedSkus: isColdStart ? [] : someSkus(Math.floor(random() * 4)),
      viewedSkus: isColdStart ? [] : someSkus(1 + Math.floor(random() * 8)),
      cartSkus: isColdStart ? [] : someSkus(Math.floor(random() * 3)),
      searches: isColdStart
        ? []
        : Array.from({ length: Math.floor(random() * 2) }, () => pick(random, SEARCHES)),
    };
  });
}
