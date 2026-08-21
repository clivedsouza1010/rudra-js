import { describe, expect, it } from 'vitest';
import type { GeneratedSpec } from './component-spec.js';
import { buildDigest } from './signal-digest.js';
import { buildFallbackSpec } from './fallback-component.js';
import { reconcileSpec } from './reconciliation.js';
import { parseTrackingInput, type TrackingInputDraft } from './tracking-input.js';

const product = (sku: string, overrides: Record<string, unknown> = {}) => ({
  sku,
  title: `Product ${sku}`,
  category: 'Trail Running',
  price: 100,
  ...overrides,
});

const FOUR = [product('TR-101'), product('TR-102'), product('TR-103'), product('NU-201')];

function build(overrides: Partial<TrackingInputDraft> = {}) {
  const input = parseTrackingInput({
    user: { id: 'shopper-1' },
    context: { surface: 'pdp' },
    candidates: FOUR,
    ...overrides,
  });
  const digest = buildDigest(input);
  return { spec: buildFallbackSpec(input, digest), input, digest };
}

const gridOf = (spec: GeneratedSpec) => {
  const [block] = spec.blocks;
  if (block && block.kind !== 'grid') throw new Error('expected a grid');
  return block;
};

describe('the deterministic component', () => {
  it('renders nothing rather than an empty region when nothing is eligible', () => {
    const { spec } = build({ candidates: [product('TR-101', { isInStock: false })] });

    expect(spec.blocks).toEqual([]);
  });

  it('respects the item budget', () => {
    const { spec } = build({ context: { surface: 'pdp', maxItems: 2 } });

    expect(gridOf(spec)?.items).toHaveLength(2);
  });

  it.each([
    [1, 2],
    [2, 2],
    [3, 3],
    [4, 4],
  ])('lays %i products out in %i columns', (itemCount, columns) => {
    const { spec } = build({
      candidates: FOUR.slice(0, itemCount),
      context: { surface: 'pdp', maxItems: itemCount },
    });

    expect(gridOf(spec)?.columns).toBe(columns);
  });

  it('features a lead product only when something follows it', () => {
    const few = build({ candidates: FOUR.slice(0, 2), context: { surface: 'pdp', maxItems: 2 } });
    const many = build({ context: { surface: 'pdp', maxItems: 4 } });

    expect(gridOf(few.spec)?.items[0]?.emphasis).toBe('normal');
    expect(gridOf(many.spec)?.items[0]?.emphasis).toBe('featured');
  });

  it.each([
    ['a first-time visitor', {}, 'Popular right now'],
    ['a shopper with a cart', { signals: { cart: [{ sku: 'TR-101' }] } }, 'Goes with your cart'],
    ['a shopper with history', { signals: { likes: [{ sku: 'TR-101' }] } }, 'Picked for you'],
  ])('greets %s with the right headline', (_label, overrides, headline) => {
    expect(build(overrides).spec.headline).toBe(headline);
  });

  it('says in the rationale which path produced it', () => {
    expect(build().spec.rationale).toContain('Deterministic');
  });
});

/**
 * The property the evaluation rests on. Arms (b) and (c) are only comparable if
 * the deterministic component is subject to the same rules as the generated one
 * — so its own output has to pass reconciliation untouched. If it ever does not,
 * the two arms differ by more than the model, and the comparison is invalid.
 */
describe('survives its own reconciliation', () => {
  it.each([
    ['a first-time visitor', {}],
    ['a shopper with likes', { signals: { likes: [{ sku: 'TR-101' }] } }],
    ['a shopper with a cart', { signals: { cart: [{ sku: 'TR-101' }] } }],
    ['a shopper with views', { signals: { mostViewed: [{ sku: 'TR-102', views: 5 }] } }],
    ['a shopper with dislikes', { signals: { dislikes: [{ sku: 'TR-101' }] } }],
    [
      'a shopper browsing a category',
      { context: { surface: 'pdp', currentCategory: 'Trail Running' } },
    ],
    ['a shopper on a product page', { context: { surface: 'pdp', currentSku: 'TR-101' } }],
    [
      'a shopper with everything at once',
      {
        context: { surface: 'pdp', currentSku: 'TR-101', currentCategory: 'Trail Running' },
        signals: {
          likes: [{ sku: 'TR-102' }],
          cart: [{ sku: 'TR-103' }],
          mostViewed: [{ sku: 'NU-201', views: 3 }],
        },
      },
    ],
  ])('reconciles with no violations for %s', (_label, overrides) => {
    const { spec, input, digest } = build(overrides);
    const result = reconcileSpec(spec, input, digest);

    expect(result.violations).toEqual([]);
  });

  it('is unchanged by reconciliation, not merely accepted by it', () => {
    const { spec, input, digest } = build({ signals: { likes: [{ sku: 'TR-101' }] } });

    expect(reconcileSpec(spec, input, digest).spec).toEqual(spec);
  });

  it('is isUsable whenever it produced anything at all', () => {
    const { spec, input, digest } = build();

    expect(reconcileSpec(spec, input, digest).isUsable).toBe(true);
  });
});
