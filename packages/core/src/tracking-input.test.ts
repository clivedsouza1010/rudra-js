import { describe, expect, it } from 'vitest';
import {
  FIELD_LIMITS,
  parseTrackingInput,
  safeParseTrackingInput,
  type TrackingInputDraft,
} from './tracking-input.js';

const aProduct = {
  sku: 'TR-102',
  title: 'Switchback Trail Shoe GTX',
  category: 'Trail Running',
  price: 174,
};

/** The smallest payload the contract accepts: a user, a surface, one candidate. */
function minimalPayload(overrides: Partial<TrackingInputDraft> = {}): TrackingInputDraft {
  return {
    user: { id: 'shopper-1' },
    context: { surface: 'pdp' },
    candidates: [aProduct],
    ...overrides,
  };
}

describe('parseTrackingInput', () => {
  it('accepts the minimal payload', () => {
    const input = parseTrackingInput(minimalPayload());

    expect(input.user.id).toBe('shopper-1');
    expect(input.context.surface).toBe('pdp');
    expect(input.candidates).toHaveLength(1);
  });

  it('treats a payload with no signals block as cold start, not an error', () => {
    const input = parseTrackingInput(minimalPayload());

    expect(input.signals.likes).toEqual([]);
    expect(input.signals.dislikes).toEqual([]);
    expect(input.signals.mostViewed).toEqual([]);
    expect(input.signals.lastPurchased).toEqual([]);
    expect(input.signals.cart).toEqual([]);
    expect(input.signals.recentSearches).toEqual([]);
    expect(input.signals.interactions).toEqual([]);
  });

  it('applies the documented defaults so a host need not restate them', () => {
    const input = parseTrackingInput(minimalPayload());

    expect(input.schemaVersion).toBe('1');
    expect(input.context.slot).toBe('recommendations');
    expect(input.context.locale).toBe('en-US');
    expect(input.context.maxItems).toBe(4);
    expect(input.candidates[0]?.currency).toBe('USD');
    expect(input.candidates[0]?.isInStock).toBe(true);
    expect(input.candidates[0]?.tags).toEqual([]);
  });

  it('defaults a view signal to a single view', () => {
    const input = parseTrackingInput(
      minimalPayload({ signals: { mostViewed: [{ sku: 'TR-104' }] } }),
    );

    expect(input.signals.mostViewed[0]?.views).toBe(1);
  });

  it('rejects a payload with no candidates, because nothing could be recommended', () => {
    const result = safeParseTrackingInput(minimalPayload({ candidates: [] }));

    expect(result.success).toBe(false);
  });

  it.each([
    ['a missing user id', { user: { id: '' } }],
    ['a missing surface', { context: { surface: '' } }],
  ])('rejects %s', (_label, overrides) => {
    const result = safeParseTrackingInput(minimalPayload(overrides));

    expect(result.success).toBe(false);
  });

  it('throws rather than returning a partial result, so a caller bug is loud', () => {
    expect(() => parseTrackingInput({ user: { id: 'shopper-1' } })).toThrow();
  });

  it('reports which field failed, so a host can act on the error', () => {
    const result = safeParseTrackingInput(minimalPayload({ user: { id: '' } }));

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['user', 'id']);
  });
});

/**
 * These bounds are what stop a host-supplied string from becoming an unbounded
 * prompt, and therefore an unbounded model bill. They are load-bearing, not
 * defensive — so every entry in FIELD_LIMITS is exercised at the cap and one
 * past it, from the same builder, which is what makes the boundary meaningful.
 */
const repeat = (size: number) => 'x'.repeat(size);
const sized = <T>(size: number, build: (index: number) => T) =>
  Array.from({ length: size }, (_unused, index) => build(index));

const capCases: Array<[string, keyof typeof FIELD_LIMITS, (size: number) => TrackingInputDraft]> = [
  [
    'a product title',
    'shortText',
    (size) => minimalPayload({ candidates: [{ ...aProduct, title: repeat(size) }] }),
  ],
  [
    'an interaction type',
    'identifier',
    (size) => minimalPayload({ signals: { interactions: [{ type: repeat(size) }] } }),
  ],
  [
    'a search query',
    'searchQuery',
    (size) => minimalPayload({ context: { surface: 'pdp', searchQuery: repeat(size) } }),
  ],
  [
    'a recent search',
    'searchQuery',
    (size) => minimalPayload({ signals: { recentSearches: [repeat(size)] } }),
  ],
  [
    'a product tag',
    'tag',
    (size) => minimalPayload({ candidates: [{ ...aProduct, tags: [repeat(size)] }] }),
  ],
  [
    'the tags on one product',
    'tagsPerProduct',
    (size) =>
      minimalPayload({
        candidates: [{ ...aProduct, tags: sized(size, (index) => `tag-${index}`) }],
      }),
  ],
  [
    'the entries in an interaction meta',
    'metaEntries',
    (size) =>
      minimalPayload({
        signals: {
          interactions: [
            {
              type: 'filter_applied',
              meta: Object.fromEntries(sized(size, (index) => [`key-${index}`, index])),
            },
          ],
        },
      }),
  ],
  [
    'the signals in one category',
    'signalsPerCategory',
    (size) =>
      minimalPayload({ signals: { likes: sized(size, (index) => ({ sku: `SKU-${index}` })) } }),
  ],
  [
    'the candidate set',
    'candidates',
    (size) =>
      minimalPayload({
        candidates: sized(size, (index) => ({ ...aProduct, sku: `SKU-${index}` })),
      }),
  ],
  [
    'the products in one bundle',
    'productsPerBundle',
    (size) =>
      minimalPayload({
        candidates: sized(size, (index) => ({ ...aProduct, sku: `SKU-${index}` })),
        bundles: [{ id: 'BUN-1', skus: sized(size, (index) => `SKU-${index}`), price: 10 }],
      }),
  ],
  [
    'the bundle set',
    'bundles',
    (size) =>
      minimalPayload({
        candidates: [
          { ...aProduct, sku: 'SKU-0' },
          { ...aProduct, sku: 'SKU-1' },
        ],
        bundles: sized(size, (index) => ({
          id: `BUN-${index}`,
          skus: ['SKU-0', 'SKU-1'],
          price: 10,
        })),
      }),
  ],
];

it('exercises every entry in FIELD_LIMITS, so a new cap cannot ship untested', () => {
  const covered = new Set(capCases.map(([, cap]) => cap));

  expect([...covered].toSorted()).toEqual(Object.keys(FIELD_LIMITS).toSorted());
});

describe.each(capCases)('the cap on %s', (_label, cap, build) => {
  it(`accepts exactly ${cap}`, () => {
    expect(safeParseTrackingInput(build(FIELD_LIMITS[cap])).success).toBe(true);
  });

  it(`rejects one past ${cap}`, () => {
    expect(safeParseTrackingInput(build(FIELD_LIMITS[cap] + 1)).success).toBe(false);
  });
});

/**
 * The contract rejects unrecognised fields rather than dropping them. A lenient
 * schema turns a host's typo into a shopper with no history and no error
 * anywhere, which is the exact failure this module exists to prevent.
 */
describe('unknown fields', () => {
  it.each([
    ['at the top level', { ...minimalPayload(), unexpected: 'value' }],
    [
      'on a signal category',
      { ...minimalPayload(), signals: { recentSeraches: ['hydration vest'] } },
    ],
    ['on a nested object', { ...minimalPayload(), user: { id: 'shopper-1', tier: 'gold' } }],
    // mostViewed and lastPurchased inherit strictness through .extend(), which
    // is zod behaviour rather than something this module states. Pin it.
    [
      'on an extended view signal',
      { ...minimalPayload(), signals: { mostViewed: [{ sku: 'TR-104', vieuws: 3 }] } },
    ],
    [
      'on an extended purchase signal',
      { ...minimalPayload(), signals: { lastPurchased: [{ sku: 'TR-104', quantitiy: 2 }] } },
    ],
  ])('rejects an unknown field %s', (_label, payload) => {
    expect(safeParseTrackingInput(payload).success).toBe(false);
  });

  it('still accepts arbitrary keys inside interaction meta, which is a record by design', () => {
    const result = safeParseTrackingInput(
      minimalPayload({
        signals: { interactions: [{ type: 'filter_applied', meta: { anythingAtAll: 'ok' } }] },
      }),
    );

    expect(result.success).toBe(true);
  });

  it('rejects __proto__ as a meta key rather than dropping it', () => {
    // JSON.parse makes __proto__ an own property; an object literal would have
    // set the prototype here in the test instead of reaching the schema at all.
    const meta = JSON.parse('{"__proto__": "x"}') as Record<string, string>;
    expect(Object.getPrototypeOf(meta)).toBe(Object.prototype);

    const result = safeParseTrackingInput(
      minimalPayload({ signals: { interactions: [{ type: 'filter_applied', meta }] } }),
    );

    expect(result.success).toBe(false);
  });

  // 'constructor' and 'prototype' are ordinary own properties: assigning them
  // shadows, it does not mutate. A host emitting a facet or CMS field by either
  // name is not a bug, and rejecting it would throw a render the fallback path
  // exists to prevent.
  it.each(['constructor', 'prototype'])('carries %s through as ordinary meta', (key) => {
    const meta = JSON.parse(`{"${key}": "acme", "a": "y"}`) as Record<string, string>;

    const input = parseTrackingInput(
      minimalPayload({ signals: { interactions: [{ type: 'filter_applied', meta }] } }),
    );

    const parsed = input.signals.interactions[0]?.meta;
    expect(parsed).toBeDefined();
    expect(Object.getOwnPropertyNames(parsed)).toEqual([key, 'a']);
    expect(parsed?.[key]).toBe('acme');
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });
});

/**
 * Values the host controls that reach a browser or a sort order. A bare capped
 * string accepts things that fail somewhere less obvious than here.
 */
describe('host-supplied values that are not merely bounded', () => {
  const withProduct = (overrides: Record<string, unknown>) =>
    safeParseTrackingInput(minimalPayload({ candidates: [{ ...aProduct, ...overrides }] }));

  it.each([
    ['an https url', 'https://cdn.example.com/tr-102.png', true],
    ['an http url', 'http://cdn.example.com/tr-102.png', true],
    ['a javascript: url', 'javascript:alert(1)', false],
    ['an empty string', '', false],
    ['a root-relative path', '/images/tr-102.png', true],
    ['a protocol-relative url', '//cdn.example.com/tr-102.png', false],
    ['a bare word', 'tr-102.png', false],
  ])('imageUrl: %s', (_label, imageUrl, accepted) => {
    expect(withProduct({ imageUrl }).success).toBe(accepted);
  });

  it.each([
    ['an ISO 4217 code', 'EUR', true],
    ['a lowercase code', 'usd', false],
    ['a currency name', 'DOLLARS', false],
  ])('currency: %s', (_label, currency, accepted) => {
    expect(withProduct({ currency }).success).toBe(accepted);
  });

  it.each([
    ['a real timestamp', Date.UTC(2026, 0, 1), true],
    ['zero', 0, true],
    ['a negative timestamp', -1, false],
    ['a year-3000 timestamp', Date.UTC(3000, 0, 1), false],
    ['a fractional timestamp', 1.5, false],
  ])('signal timestamp: %s', (_label, at, accepted) => {
    const result = safeParseTrackingInput(
      minimalPayload({ signals: { likes: [{ sku: 'TR-104', at }] } }),
    );

    expect(result.success).toBe(accepted);
  });

  it('rejects a duplicate SKU in the candidate set', () => {
    const result = safeParseTrackingInput(
      minimalPayload({ candidates: [aProduct, { ...aProduct, title: 'Same shoe, listed twice' }] }),
    );

    expect(result.success).toBe(false);
  });
});

const withBundles = (bundles: unknown) => ({
  user: { id: 'S-1' },
  context: { surface: 'pdp' },
  candidates: [
    { sku: 'A', title: 'A', category: 'Tents', price: 10 },
    { sku: 'B', title: 'B', category: 'Tents', price: 20 },
  ],
  bundles,
});

describe('bundles', () => {
  it('accepts a set the shop sells together', () => {
    const parsed = parseTrackingInput(withBundles([{ id: 'BUN-1', skus: ['A', 'B'], price: 25 }]));

    expect(parsed.bundles).toEqual([{ id: 'BUN-1', skus: ['A', 'B'], price: 25 }]);
  });

  it('defaults to none, so a host that has no bundles sends nothing', () => {
    const parsed = parseTrackingInput({
      user: { id: 'S-1' },
      context: { surface: 'pdp' },
      candidates: [{ sku: 'A', title: 'A', category: 'Tents', price: 10 }],
    });

    expect(parsed.bundles).toEqual([]);
  });

  it('refuses a bundle naming a product that is not a candidate', () => {
    // The renderer resolves bundle members from the candidates list.
    expect(() =>
      parseTrackingInput(withBundles([{ id: 'BUN-1', skus: ['A', 'GHOST'], price: 25 }])),
    ).toThrow();
  });

  it('refuses a bundle of one', () => {
    expect(() =>
      parseTrackingInput(withBundles([{ id: 'BUN-1', skus: ['A'], price: 25 }])),
    ).toThrow();
  });

  it('refuses a negative price', () => {
    expect(() =>
      parseTrackingInput(withBundles([{ id: 'BUN-1', skus: ['A', 'B'], price: -1 }])),
    ).toThrow();
  });

  it('refuses two sets with the same id', () => {
    // A duplicate id would let the renderer draw the wrong set at the wrong price.
    expect(() =>
      parseTrackingInput(
        withBundles([
          { id: 'BUN-1', skus: ['A', 'B'], price: 25 },
          { id: 'BUN-1', skus: ['B', 'A'], price: 99 },
        ]),
      ),
    ).toThrow();
  });

  it('refuses a set that lists the same product twice', () => {
    // It renders the product twice and spends two slots for one thing.
    expect(() =>
      parseTrackingInput(withBundles([{ id: 'BUN-1', skus: ['A', 'A'], price: 25 }])),
    ).toThrow();
  });
});
