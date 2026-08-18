import { describe, expect, it } from 'vitest';
import { DIGEST_LIMITS, buildDigest } from './digest.js';
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
    ['likes', 'liked', 'likedSkus'],
    ['dislikes', 'disliked', 'dislikedSkus'],
    ['cart', 'cart', 'cartSkus'],
    ['lastPurchased', 'purchased', 'purchasedSkus'],
  ] as const)('caps %s at DIGEST_LIMITS.%s', (signalName, limitName, digestKey) => {
    const limit = DIGEST_LIMITS[limitName];
    const many = Array.from({ length: limit + 5 }, (_unused, index) => ({
      sku: `SKU-${index}`,
    }));

    const digest = digestOf({ signals: { [signalName]: many } });

    expect(digest[digestKey]).toHaveLength(limit);
  });

  it('caps recent searches', () => {
    const many = Array.from({ length: DIGEST_LIMITS.searches + 3 }, (_u, i) => `search ${i}`);

    expect(digestOf({ signals: { recentSearches: many } }).recentSearches).toHaveLength(
      DIGEST_LIMITS.searches,
    );
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

  it('caps the list', () => {
    const many = Array.from({ length: DIGEST_LIMITS.viewed + 4 }, (_u, i) => ({
      sku: `SKU-${i}`,
      views: i + 1,
    }));

    expect(digestOf({ signals: { mostViewed: many } }).topViewed).toHaveLength(
      DIGEST_LIMITS.viewed,
    );
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

  it('honours a caller-supplied weight', () => {
    const full = digestOf({ signals: { likes: [{ sku: 'TR-101' }] } }).categoryAffinity[0]?.score;
    const halved = digestOf({
      signals: { likes: [{ sku: 'TR-101', weight: 0.5 }] },
    }).categoryAffinity[0]?.score;

    expect(halved).toBeLessThan(full ?? 0);
  });

  it('caps the list', () => {
    const many = Array.from({ length: DIGEST_LIMITS.affinity + 4 }, (_u, i) => ({
      sku: `SKU-${i}`,
      category: `Category ${i}`,
    }));

    expect(digestOf({ signals: { likes: many } }).categoryAffinity).toHaveLength(
      DIGEST_LIMITS.affinity,
    );
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

  it('caps the number of types', () => {
    const many = Array.from({ length: DIGEST_LIMITS.interactionTypes + 3 }, (_u, i) => ({
      type: `type_${i}`,
    }));

    expect(digestOf({ signals: { interactions: many } }).interactionCounts).toHaveLength(
      DIGEST_LIMITS.interactionTypes,
    );
  });
});
