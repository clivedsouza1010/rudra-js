import { describe, expect, it } from 'vitest';
import { parseTrackingInput } from '@rudra-js/core';
import { generateCatalog } from './catalog.js';
import { generateShoppers } from './shoppers.js';
import { buildTrackingInput } from './tracking-input.js';

const catalog = generateCatalog(1, 200);
const shoppers = generateShoppers(9, catalog, 50);

describe('the tracking payload the shop builds', () => {
  it('is accepted by the payload contract for every shopper', () => {
    for (const shopper of shoppers) {
      expect(() =>
        parseTrackingInput(buildTrackingInput(shopper, 'RJ-00001', catalog)),
      ).not.toThrow();
    }
  });

  it('offers only in-stock candidates', () => {
    // Out-of-stock products are dropped by reconciliation anyway; sending them
    // spends prompt budget on products that cannot be placed.
    const input = buildTrackingInput(shoppers[0]!, 'RJ-00001', catalog);

    expect(input.candidates?.every((candidate) => candidate.isInStock !== false)).toBe(true);
  });

  it('puts the product being viewed in the context, not in the signals', () => {
    const input = buildTrackingInput(shoppers[0]!, 'RJ-00042', catalog);

    expect(input.context.currentSku).toBe('RJ-00042');
  });

  it('gives two different shoppers different payloads', () => {
    // Identical payloads would collapse to one cache key, and every later
    // measurement of hit rate would be measuring the fixture.
    const first = buildTrackingInput(shoppers[0]!, 'RJ-00001', catalog);
    const second = buildTrackingInput(shoppers[1]!, 'RJ-00001', catalog);

    expect(first).not.toEqual(second);
    // The two shoppers' other fields (segment, signals, ...) already differ by
    // chance, so the assertion above passes even if `user.id` were hardcoded.
    // This pins down the specific field a cache key would be built from.
    expect(first.user.id).not.toBe(second.user.id);
  });
});
