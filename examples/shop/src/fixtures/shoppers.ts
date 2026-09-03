import type { Product } from '@rudra-js/core';
import { createSeededRandom } from './seeded-random';

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

/**
 * A shopper population as a function of a seed.
 *
 * Roughly a tenth have no history at all. That is the cold-start path, which
 * takes a different branch through the digest and a different cache key, and a
 * population without it never exercises either.
 */
export function generateShoppers(
  seed: number,
  catalog: readonly Product[],
  count = 500,
): Shopper[] {
  const random = createSeededRandom(seed);
  const pick = <Item>(items: readonly Item[]): Item => items[Math.floor(random() * items.length)]!;
  const someSkus = (howMany: number): string[] =>
    Array.from({ length: howMany }, () => pick(catalog).sku).filter(
      (sku, position, all) => all.indexOf(sku) === position,
    );

  return Array.from({ length: count }, (_unused, index) => {
    const isColdStart = random() < 0.1;

    return {
      id: `S-${String(index + 1).padStart(4, '0')}`,
      segment: pick(SEGMENTS),
      isReturning: !isColdStart && random() > 0.3,
      likedSkus: isColdStart ? [] : someSkus(Math.floor(random() * 4)),
      viewedSkus: isColdStart ? [] : someSkus(1 + Math.floor(random() * 8)),
      cartSkus: isColdStart ? [] : someSkus(Math.floor(random() * 3)),
      searches: isColdStart
        ? []
        : Array.from({ length: Math.floor(random() * 2) }, () => pick(SEARCHES)),
    };
  });
}
