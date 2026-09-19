import { describe, expect, it } from 'vitest';
import { buildDigest } from './signal-digest.js';
import { parseTrackingInput, type TrackingInputDraft } from './tracking-input.js';

const product = (sku: string, category = 'Trail Running') => ({
  sku,
  title: `Product ${sku}`,
  category,
  price: 100,
});

function digestOf(overrides: Partial<TrackingInputDraft> = {}) {
  return buildDigest(
    parseTrackingInput({
      user: { id: 'shopper-1' },
      context: { surface: 'pdp' },
      candidates: [product('TR-101'), product('TR-102'), product('NU-201', 'Nutrition')],
      ...overrides,
    }),
  );
}

describe('buildDigest', () => {
  it('carries the render context through unchanged', () => {
    const digest = digestOf({
      context: {
        surface: 'pdp',
        slot: 'rail',
        currentSku: 'TR-101',
        locale: 'en-GB',
        maxItems: 3,
      },
    });

    expect(digest.surface).toBe('pdp');
    expect(digest.slot).toBe('rail');
    expect(digest.currentSku).toBe('TR-101');
    expect(digest.locale).toBe('en-GB');
    expect(digest.maxItems).toBe(3);
  });

  it('omits optional context rather than emitting undefined keys', () => {
    const digest = digestOf();

    expect('currentSku' in digest).toBe(false);
    expect('searchQuery' in digest).toBe(false);
    expect('segment' in digest).toBe(false);
  });
});

describe('cold start', () => {
  it('is cold when the shopper has no behavioural evidence', () => {
    expect(digestOf().isColdStart).toBe(true);
  });

  it.each([
    ['a like', { likes: [{ sku: 'TR-101' }] }],
    ['a dislike', { dislikes: [{ sku: 'TR-101' }] }],
    ['a purchase', { lastPurchased: [{ sku: 'TR-101' }] }],
    ['a cart item', { cart: [{ sku: 'TR-101' }] }],
    ['a view', { mostViewed: [{ sku: 'TR-101', views: 1 }] }],
  ])('is not cold once there is %s', (_label, signals) => {
    expect(digestOf({ signals }).isColdStart).toBe(false);
  });

  it('stays cold on a search alone, which says want rather than engagement', () => {
    expect(digestOf({ signals: { recentSearches: ['hydration vest'] } }).isColdStart).toBe(true);
  });
});

describe('returning shopper', () => {
  it('is inferred from a past purchase when the host does not say', () => {
    expect(digestOf({ signals: { lastPurchased: [{ sku: 'TR-101' }] } }).isReturning).toBe(true);
  });

  it('defaults to false with no purchase history', () => {
    expect(digestOf().isReturning).toBe(false);
  });

  it('lets the host override the inference', () => {
    const digest = digestOf({
      user: { id: 'shopper-1', isReturning: false },
      signals: { lastPurchased: [{ sku: 'TR-101' }] },
    });

    expect(digest.isReturning).toBe(false);
  });
});

describe('signal ordering and de-duplication', () => {
  it('keeps the most recent occurrence of a repeated SKU, once', () => {
    const digest = digestOf({
      signals: {
        likes: [
          { sku: 'TR-101', at: 1_000 },
          { sku: 'TR-102', at: 3_000 },
          { sku: 'TR-101', at: 5_000 },
        ],
      },
    });

    expect(digest.likedSkus).toEqual(['TR-101', 'TR-102']);
  });

  it('sorts an undated signal last rather than dropping it', () => {
    const digest = digestOf({
      signals: { likes: [{ sku: 'TR-101' }, { sku: 'TR-102', at: 9_000 }] },
    });

    expect(digest.likedSkus).toEqual(['TR-102', 'TR-101']);
  });

  it.each([
    ['likes', 12, 'likedSkus'],
    ['dislikes', 12, 'dislikedSkus'],
    ['cart', 8, 'cartSkus'],
    ['lastPurchased', 8, 'purchasedSkus'],
  ] as const)('caps %s at %i, dropping the oldest', (signalName, limit, digestKey) => {
    const many = Array.from({ length: limit + 1 }, (_unused, index) => ({
      sku: `SKU-${index}`,
      at: index + 1,
    }));

    const digest = digestOf({ signals: { [signalName]: many } });

    expect(digest[digestKey]).toHaveLength(limit);
    expect(digest[digestKey]).toContain('SKU-1');
    expect(digest[digestKey]).not.toContain('SKU-0');
  });

  it('caps recent searches at 5, keeping the most recent', () => {
    const many = Array.from({ length: 8 }, (_u, i) => `search ${i}`);

    expect(digestOf({ signals: { recentSearches: many } }).recentSearches).toEqual([
      'search 0',
      'search 1',
      'search 2',
      'search 3',
      'search 4',
    ]);
  });
});

describe('most viewed', () => {
  it('merges repeat views of one SKU into a single running total', () => {
    const digest = digestOf({
      signals: {
        mostViewed: [
          { sku: 'TR-101', views: 2, dwellMs: 1_000 },
          { sku: 'TR-101', views: 3, dwellMs: 500 },
        ],
      },
    });

    expect(digest.topViewed).toEqual([{ sku: 'TR-101', views: 5, dwellMs: 1_500 }]);
  });

  it('omits dwell time entirely when no view reported any', () => {
    const digest = digestOf({
      signals: { mostViewed: [{ sku: 'TR-101', views: 1 }] },
    });

    expect(digest.topViewed[0]).not.toHaveProperty('dwellMs');
  });

  it('does not let a weaker record drag down an unweighted one', () => {
    const unweightedAlone = digestOf({
      signals: {
        mostViewed: [
          { sku: 'TR-101', views: 1 },
          { sku: 'TR-101', views: 1 },
        ],
      },
    }).categoryAffinity[0]?.score;
    const unweightedPlusWeak = digestOf({
      signals: {
        mostViewed: [
          { sku: 'TR-101', views: 1 },
          { sku: 'TR-101', views: 1, weight: 0.2 },
        ],
      },
    }).categoryAffinity[0]?.score;

    // An omitted weight means full strength, so the strongest of the two is 1.
    expect(unweightedPlusWeak).toBe(unweightedAlone);
  });

  it('merges weights the same way whichever record arrives first', () => {
    const weakFirst = digestOf({
      signals: {
        mostViewed: [
          { sku: 'TR-101', views: 1, weight: 0.2 },
          { sku: 'TR-101', views: 1 },
        ],
      },
    }).categoryAffinity;
    const weakSecond = digestOf({
      signals: {
        mostViewed: [
          { sku: 'TR-101', views: 1 },
          { sku: 'TR-101', views: 1, weight: 0.2 },
        ],
      },
    }).categoryAffinity;

    expect(weakFirst).toEqual(weakSecond);
  });

  it('lets an explicit zero weight contribute nothing', () => {
    const digest = digestOf({ signals: { mostViewed: [{ sku: 'TR-101', views: 1, weight: 0 }] } });

    expect(digest.categoryAffinity).toEqual([]);
  });

  it('takes the strongest weight when records for one SKU disagree', () => {
    const strongest = digestOf({
      signals: {
        mostViewed: [
          { sku: 'TR-101', views: 1, weight: 0.2 },
          { sku: 'TR-101', views: 1, weight: 1 },
        ],
      },
    }).categoryAffinity[0]?.score;
    const bothWeak = digestOf({
      signals: {
        mostViewed: [
          { sku: 'TR-101', views: 1, weight: 0.2 },
          { sku: 'TR-101', views: 1, weight: 0.2 },
        ],
      },
    }).categoryAffinity[0]?.score;

    expect(strongest).toBeGreaterThan(bothWeak ?? 0);
  });

  it('orders by view count, most viewed first', () => {
    const digest = digestOf({
      signals: {
        mostViewed: [
          { sku: 'TR-101', views: 1 },
          { sku: 'TR-102', views: 9 },
        ],
      },
    });

    expect(digest.topViewed.map((viewed) => viewed.sku)).toEqual(['TR-102', 'TR-101']);
  });

  it('caps the list at 10, keeping the most viewed', () => {
    const many = Array.from({ length: 14 }, (_u, i) => ({ sku: `SKU-${i}`, views: i + 1 }));

    const viewed = digestOf({ signals: { mostViewed: many } }).topViewed.map((v) => v.sku);

    expect(viewed).toHaveLength(10);
    expect(viewed).toContain('SKU-4');
    expect(viewed).not.toContain('SKU-3');
  });
});

describe('category affinity', () => {
  const categoriesOf = (draft: Partial<TrackingInputDraft>) =>
    digestOf(draft).categoryAffinity.map((affinity) => affinity.category);

  it('ranks a purchased category above a merely viewed one', () => {
    expect(
      categoriesOf({
        signals: {
          lastPurchased: [{ sku: 'NU-201' }],
          mostViewed: [{ sku: 'TR-101', views: 1 }],
        },
      })[0],
    ).toBe('Nutrition');
  });

  it('resolves a category from the candidate set when the signal omits one', () => {
    expect(categoriesOf({ signals: { likes: [{ sku: 'NU-201' }] } })).toContain('Nutrition');
  });

  it('lets a signal name a category the candidate set does not contain', () => {
    expect(
      categoriesOf({
        signals: { likes: [{ sku: 'XX-999', category: 'Climbing' }] },
      }),
    ).toContain('Climbing');
  });

  it('drops a category the shopper dislikes more than they like', () => {
    expect(
      categoriesOf({
        signals: { likes: [{ sku: 'TR-101' }], dislikes: [{ sku: 'TR-102' }] },
      }),
    ).not.toContain('Trail Running');
  });

  it('counts the category being browsed as evidence on its own', () => {
    expect(
      categoriesOf({
        context: { surface: 'pdp', currentCategory: 'Climbing' },
      }),
    ).toEqual(['Climbing']);
  });

  it('grows sub-linearly in view count, so one long session cannot outrank a purchase', () => {
    const [top] = digestOf({
      signals: {
        lastPurchased: [{ sku: 'NU-201' }],
        mostViewed: [{ sku: 'TR-101', views: 30 }],
      },
    }).categoryAffinity;

    expect(top?.category).toBe('Nutrition');
  });

  it('is unaffected by how the host batches view records', () => {
    const asOneRecord = digestOf({ signals: { mostViewed: [{ sku: 'TR-101', views: 30 }] } });
    const asManyRecords = digestOf({
      signals: { mostViewed: Array.from({ length: 30 }, () => ({ sku: 'TR-101', views: 1 })) },
    });

    // Asserting the score itself, not merely that the two agree: if scoring
    // ever yields NaN, both collapse to [] and an equality check passes
    // vacuously.
    const expected = [{ category: 'Trail Running', score: 4.95 }];
    expect(asOneRecord.categoryAffinity).toEqual(expected);
    expect(asManyRecords.categoryAffinity).toEqual(expected);
  });

  it('does not let repeated single-view records outrank a purchase', () => {
    const digest = digestOf({
      signals: {
        lastPurchased: [{ sku: 'NU-201' }],
        mostViewed: Array.from({ length: 30 }, () => ({ sku: 'TR-101', views: 1 })),
      },
    });

    expect(digest.categoryAffinity).toEqual([
      { category: 'Nutrition', score: 5 },
      { category: 'Trail Running', score: 4.95 },
    ]);
  });

  it('scores a single unweighted like at the like weight', () => {
    expect(digestOf({ signals: { likes: [{ sku: 'TR-101' }] } }).categoryAffinity).toEqual([
      { category: 'Trail Running', score: 4 },
    ]);
  });

  it('scores a single cart signal at the cart weight', () => {
    expect(digestOf({ signals: { cart: [{ sku: 'TR-101' }] } }).categoryAffinity).toEqual([
      { category: 'Trail Running', score: 3 },
    ]);
  });

  it('ranks a liked category above one that is only in the cart', () => {
    expect(
      categoriesOf({ signals: { likes: [{ sku: 'NU-201' }], cart: [{ sku: 'TR-101' }] } }),
    ).toEqual(['Nutrition', 'Trail Running']);
  });

  it('ranks the category being browsed above one backed only by views', () => {
    expect(
      categoriesOf({
        context: { surface: 'pdp', currentCategory: 'Climbing' },
        signals: { mostViewed: [{ sku: 'TR-101', views: 3 }] },
      }),
    ).toEqual(['Climbing', 'Trail Running']);
  });

  it('drops a category whose weighted score rounds to zero', () => {
    const digest = digestOf({ signals: { likes: [{ sku: 'TR-101', weight: 0.001 }] } });

    expect(digest.categoryAffinity).toEqual([]);
  });

  it('honours a caller-supplied weight', () => {
    const full = digestOf({ signals: { likes: [{ sku: 'TR-101' }] } }).categoryAffinity[0]?.score;
    const halved = digestOf({
      signals: { likes: [{ sku: 'TR-101', weight: 0.5 }] },
    }).categoryAffinity[0]?.score;

    expect(halved).toBeLessThan(full ?? 0);
  });

  it('caps the list at 6, keeping the strongest', () => {
    const many = Array.from({ length: 10 }, (_u, i) => ({
      sku: `SKU-${i}`,
      category: `Category ${i}`,
      weight: 1 - i / 10,
    }));

    const categories = categoriesOf({ signals: { likes: many } });

    expect(categories).toHaveLength(6);
    expect(categories).toContain('Category 5');
    expect(categories).not.toContain('Category 6');
  });
});

describe('interaction counts', () => {
  it('counts each type and orders by frequency', () => {
    const digest = digestOf({
      signals: {
        interactions: [
          { type: 'scroll_depth' },
          { type: 'size_guide_opened' },
          { type: 'scroll_depth' },
        ],
      },
    });

    expect(digest.interactionCounts).toEqual([
      { type: 'scroll_depth', count: 2 },
      { type: 'size_guide_opened', count: 1 },
    ]);
  });

  it('caps the number of types at 8, keeping the most frequent', () => {
    const many = Array.from({ length: 11 }, (_u, i) => i).flatMap((i) =>
      Array.from({ length: 11 - i }, () => ({ type: `type_${i}` })),
    );

    const types = digestOf({ signals: { interactions: many } }).interactionCounts.map(
      (c) => c.type,
    );

    expect(types).toHaveLength(8);
    expect(types).toContain('type_7');
    expect(types).not.toContain('type_8');
  });
});
