import { describe, expect, it } from 'vitest';
import { buildDigest } from './signal-digest.js';
import { selectProducts } from './product-selection.js';
import { parseTrackingInput, type TrackingInputDraft } from './tracking-input.js';

const product = (sku: string, overrides: Record<string, unknown> = {}) => ({
  sku,
  title: `Product ${sku}`,
  category: 'Trail Running',
  price: 100,
  ...overrides,
});

function pickFor(overrides: Partial<TrackingInputDraft> = {}) {
  const input = parseTrackingInput({
    user: { id: 'shopper-1' },
    context: { surface: 'pdp' },
    candidates: [
      product('TR-101'),
      product('TR-102'),
      product('NU-201', { category: 'Nutrition' }),
    ],
    ...overrides,
  });
  return selectProducts(input, buildDigest(input));
}

const skus = (picks: ReturnType<typeof selectProducts>) => picks.map((pick) => pick.product.sku);

describe('what the selector refuses to pick', () => {
  it.each([
    ['out of stock', { candidates: [product('TR-101', { isInStock: false }), product('TR-102')] }],
    ['disliked', { signals: { dislikes: [{ sku: 'TR-101' }] } }],
    ['already purchased', { signals: { lastPurchased: [{ sku: 'TR-101' }] } }],
    ['already in the cart', { signals: { cart: [{ sku: 'TR-101' }] } }],
    ['the product being viewed', { context: { surface: 'pdp', currentSku: 'TR-101' } }],
  ])('never picks a product that is %s', (_label, overrides) => {
    expect(skus(pickFor(overrides))).not.toContain('TR-101');
  });

  it('returns nothing when every candidate is ineligible', () => {
    expect(pickFor({ candidates: [product('TR-101', { isInStock: false })] })).toEqual([]);
  });
});

describe('ordering', () => {
  it('is total, so two runs over one payload agree', () => {
    const first = skus(pickFor());
    const second = skus(pickFor());

    expect(first).toEqual(second);
  });

  it('breaks a tie on SKU rather than input order', () => {
    const forwards = pickFor({ candidates: [product('B-2'), product('A-1')] });
    const backwards = pickFor({ candidates: [product('A-1'), product('B-2')] });

    expect(skus(forwards)).toEqual(['A-1', 'B-2']);
    expect(skus(backwards)).toEqual(['A-1', 'B-2']);
  });

  it('puts a revisited product above one the shopper has never seen', () => {
    const picks = pickFor({ signals: { mostViewed: [{ sku: 'TR-102', views: 4 }] } });

    expect(skus(picks)[0]).toBe('TR-102');
  });

  it('lets category affinity outrank a better rating', () => {
    const picks = pickFor({
      candidates: [product('TR-101'), product('NU-201', { category: 'Nutrition', rating: 5 })],
      signals: { likes: [{ sku: 'TR-101' }] },
    });

    expect(skus(picks)[0]).toBe('TR-101');
  });

  it('falls back to rating when no signal separates two products', () => {
    const picks = pickFor({
      candidates: [product('AA-1', { rating: 2 }), product('BB-2', { rating: 5 })],
    });

    expect(skus(picks)[0]).toBe('BB-2');
  });
});

/**
 * The selector is held to the same standard as the model: every basis it states
 * has to be one reconciliation can verify. A claim it cannot support would be
 * downgraded there just the same, so stating one is simply a lie it gets caught
 * telling.
 */
describe('the stated basis', () => {
  const basisOf = (sku: string, overrides: Partial<TrackingInputDraft>) =>
    pickFor(overrides).find((pick) => pick.product.sku === sku)?.basis;

  it('claims most_viewed only for something actually viewed', () => {
    expect(basisOf('TR-102', { signals: { mostViewed: [{ sku: 'TR-102', views: 2 }] } })).toBe(
      'most_viewed',
    );
  });

  it('claims similar_to_current for the category being browsed', () => {
    expect(
      basisOf('TR-101', { context: { surface: 'pdp', currentCategory: 'Trail Running' } }),
    ).toBe('similar_to_current');
  });

  it('claims liked_category when the signals favour it', () => {
    expect(basisOf('TR-102', { signals: { likes: [{ sku: 'TR-101' }] } })).toBe('liked_category');
  });

  it('claims complements_cart only when something is in the cart', () => {
    expect(basisOf('NU-201', { signals: { cart: [{ sku: 'TR-101' }] } })).toBe('complements_cart');
  });

  it('claims nothing about a shopper it knows nothing about', () => {
    for (const pick of pickFor()) {
      expect(pick.basis).toBe('popular');
    }
  });

  it('gives every pick a reason to go with the basis', () => {
    for (const pick of pickFor({ signals: { likes: [{ sku: 'TR-101' }] } })) {
      expect(pick.reason.length).toBeGreaterThan(0);
    }
  });
});
