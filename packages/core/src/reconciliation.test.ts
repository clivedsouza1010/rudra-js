import { describe, expect, it } from 'vitest';
import {
  RECOMMENDATION_BASES,
  type GeneratedSpec,
  type ProductReference,
} from './component-spec.js';
import { buildDigest } from './signal-digest.js';
import { reconcileSpec, type ReconcileResult } from './reconciliation.js';
import { parseTrackingInput, type TrackingInputDraft } from './tracking-input.js';

const product = (sku: string, overrides: Record<string, unknown> = {}) => ({
  sku,
  title: `Product ${sku}`,
  category: 'Trail Running',
  price: 100,
  ...overrides,
});

const CANDIDATES = [
  product('TR-101'),
  product('TR-102'),
  product('NU-201', { category: 'Nutrition' }),
];

function inputFor(overrides: Partial<TrackingInputDraft> = {}) {
  return parseTrackingInput({
    user: { id: 'shopper-1' },
    context: { surface: 'pdp' },
    candidates: CANDIDATES,
    ...overrides,
  });
}

const ref = (sku: string, overrides: Partial<ProductReference> = {}): ProductReference => ({
  sku,
  basis: 'popular',
  reason: 'A dependable pick',
  badge: null,
  emphasis: 'normal',
  ...overrides,
});

const specWith = (blocks: GeneratedSpec['blocks']): GeneratedSpec => ({
  tone: 'neutral',
  headline: 'Back to the trail',
  subheadline: null,
  blocks,
  rationale: 'Leaned on the category affinity.',
});

const grid = (items: ProductReference[]) =>
  specWith([{ kind: 'grid', title: 'For you', columns: 3, items }]);

/** Runs a spec through reconciliation against a given payload. */
function reconcile(spec: GeneratedSpec, overrides: Partial<TrackingInputDraft> = {}) {
  const input = inputFor(overrides);
  return reconcileSpec(spec, input, buildDigest(input));
}

/** The first product reference of a spec whose only block is a grid. */
const basisOf = (result: ReconcileResult): ProductReference | undefined => {
  const [block] = result.spec.blocks;
  if (block?.kind !== 'grid') throw new Error('expected a grid');
  return block.items[0];
};

/** The products that survived, flattened across every block. */
const placedSkus = (blocks: GeneratedSpec['blocks']): string[] =>
  blocks.flatMap((block) =>
    block.kind === 'grid' || block.kind === 'carousel'
      ? block.items.map((item) => item.sku)
      : block.kind === 'hero' && block.sku !== null
        ? [block.sku]
        : [],
  );

describe('product truth', () => {
  it('drops a SKU the host never offered', () => {
    const result = reconcile(grid([ref('TR-101'), ref('GHOST-1')]));

    expect(placedSkus(result.spec.blocks)).toEqual(['TR-101']);
    expect(result.violations).toContain('unknown-sku:GHOST-1');
  });

  it('drops an out-of-stock candidate', () => {
    const result = reconcile(grid([ref('TR-101'), ref('TR-102')]), {
      candidates: [product('TR-101'), product('TR-102', { isInStock: false })],
    });

    expect(placedSkus(result.spec.blocks)).toEqual(['TR-101']);
    expect(result.violations).toContain('unknown-sku:TR-102');
  });

  it('drops a SKU the shopper disliked', () => {
    const result = reconcile(grid([ref('TR-101'), ref('TR-102')]), {
      signals: { dislikes: [{ sku: 'TR-102' }] },
    });

    expect(placedSkus(result.spec.blocks)).toEqual(['TR-101']);
    expect(result.violations).toContain('blocked-sku:TR-102');
  });

  it('drops the product the shopper is already looking at', () => {
    const result = reconcile(grid([ref('TR-101'), ref('TR-102')]), {
      context: { surface: 'pdp', currentSku: 'TR-101' },
    });

    expect(placedSkus(result.spec.blocks)).toEqual(['TR-102']);
    expect(result.violations).toContain('blocked-sku:TR-101');
  });

  // The prompt asks the model not to do these, and the deterministic path has
  // always excluded them. Asking is not the same as enforcing.
  it('drops a SKU the shopper already bought', () => {
    const result = reconcile(grid([ref('TR-101'), ref('TR-102')]), {
      signals: { lastPurchased: [{ sku: 'TR-101' }] },
    });

    expect(placedSkus(result.spec.blocks)).toEqual(['TR-102']);
    expect(result.violations).toContain('blocked-sku:TR-101');
  });

  it('drops a SKU already in the cart', () => {
    const result = reconcile(grid([ref('TR-101'), ref('TR-102')]), {
      signals: { cart: [{ sku: 'TR-102' }] },
    });

    expect(placedSkus(result.spec.blocks)).toEqual(['TR-101']);
    expect(result.violations).toContain('blocked-sku:TR-102');
  });

  it('places a product once, however often the model names it', () => {
    const result = reconcile(grid([ref('TR-101'), ref('TR-101'), ref('TR-102')]));

    expect(placedSkus(result.spec.blocks)).toEqual(['TR-101', 'TR-102']);
    expect(result.violations).toContain('duplicate-sku:TR-101');
  });

  it('de-duplicates across separate blocks, not just within one', () => {
    const result = reconcile(
      specWith([
        { kind: 'grid', title: null, columns: 2, items: [ref('TR-101')] },
        { kind: 'carousel', title: null, items: [ref('TR-101'), ref('TR-102')] },
      ]),
    );

    expect(placedSkus(result.spec.blocks)).toEqual(['TR-101', 'TR-102']);
  });
});

describe('the item budget', () => {
  it('stops placing once maxItems is reached', () => {
    const result = reconcile(grid([ref('TR-101'), ref('TR-102'), ref('NU-201')]), {
      context: { surface: 'pdp', maxItems: 2 },
    });

    expect(placedSkus(result.spec.blocks)).toHaveLength(2);
    expect(result.violations).toContain('budget:dropped:NU-201');
  });

  it('spends one budget across every block, not one per block', () => {
    const result = reconcile(
      specWith([
        { kind: 'grid', title: null, columns: 2, items: [ref('TR-101'), ref('TR-102')] },
        { kind: 'carousel', title: null, items: [ref('NU-201')] },
      ]),
      { context: { surface: 'pdp', maxItems: 2 } },
    );

    expect(placedSkus(result.spec.blocks)).toEqual(['TR-101', 'TR-102']);
  });

  it('counts a hero product against the same budget', () => {
    const result = reconcile(
      specWith([
        { kind: 'hero', headline: 'Pick of the season', body: null, sku: 'TR-101', ctaLabel: null },
        { kind: 'grid', title: null, columns: 2, items: [ref('TR-102'), ref('NU-201')] },
      ]),
      { context: { surface: 'pdp', maxItems: 2 } },
    );

    expect(placedSkus(result.spec.blocks)).toEqual(['TR-101', 'TR-102']);
  });

  it('caps the number of blocks', () => {
    const copyBlock = { kind: 'copy', title: null, body: 'Built for wet rock.' } as const;
    const result = reconcile(
      specWith([
        { kind: 'grid', title: null, columns: 2, items: [ref('TR-101')] },
        copyBlock,
        copyBlock,
        copyBlock,
        copyBlock,
      ]),
    );

    expect(result.spec.blocks.length).toBeLessThanOrEqual(4);
    expect(result.violations).toContain('too-many-blocks:5');
  });
});

/**
 * `basis` is a factual claim about the shopper. The model has every incentive to
 * reach for the most flattering one, so each is checked against the digest.
 */
describe('verifying the stated reason for a pick', () => {
  it('keeps most_viewed when the shopper really did view it', () => {
    const result = reconcile(grid([ref('TR-101', { basis: 'most_viewed' })]), {
      signals: { mostViewed: [{ sku: 'TR-101', views: 3 }] },
    });

    expect(basisOf(result)?.basis).toBe('most_viewed');
    expect(basisOf(result)?.reason).toBe('A dependable pick');
  });

  it('downgrades most_viewed when they never viewed it', () => {
    const result = reconcile(grid([ref('TR-101', { basis: 'most_viewed' })]));

    expect(basisOf(result)?.basis).toBe('popular');
    expect(result.violations).toContain('unsupported-basis:most_viewed:TR-101');
  });

  it('drops the prose along with the claim it was stating', () => {
    const result = reconcile(
      grid([ref('TR-101', { basis: 'most_viewed', reason: 'You keep coming back to this' })]),
    );

    // The pick may still be fine; the sentence asserting why is not.
    expect(basisOf(result)?.reason).toBeNull();
  });

  it('keeps the product rather than discarding it over a false claim', () => {
    const result = reconcile(grid([ref('TR-101', { basis: 'complements_cart' })]));

    expect(placedSkus(result.spec.blocks)).toEqual(['TR-101']);
  });

  it.each([
    ['complements_cart' as const, () => ({ cart: [{ sku: 'NU-201' }] })],
    ['complements_purchase' as const, () => ({ lastPurchased: [{ sku: 'NU-201' }] })],
  ])('keeps %s when the signal supports it', (basis, buildSignals) => {
    const result = reconcile(grid([ref('TR-101', { basis })]), { signals: buildSignals() });

    expect(basisOf(result)?.basis).toBe(basis);
  });

  it.each(['complements_cart', 'complements_purchase'] as const)(
    'downgrades %s when there is no such signal',
    (basis) => {
      expect(basisOf(reconcile(grid([ref('TR-101', { basis })])))?.basis).toBe('popular');
    },
  );

  it('keeps similar_to_current only for the category being browsed', () => {
    const browsing = { surface: 'pdp', currentCategory: 'Trail Running' };
    const matching = reconcile(grid([ref('TR-101', { basis: 'similar_to_current' })]), {
      context: browsing,
    });
    const mismatched = reconcile(grid([ref('NU-201', { basis: 'similar_to_current' })]), {
      context: browsing,
    });

    expect(basisOf(matching)?.basis).toBe('similar_to_current');
    expect(basisOf(mismatched)?.basis).toBe('popular');
  });

  it('keeps liked_category only for a category the signals favour', () => {
    const liked = reconcile(grid([ref('TR-101', { basis: 'liked_category' })]), {
      signals: { likes: [{ sku: 'TR-102' }] },
    });
    const unliked = reconcile(grid([ref('NU-201', { basis: 'liked_category' })]), {
      signals: { likes: [{ sku: 'TR-102' }] },
    });

    expect(liked.spec.blocks).toBeDefined();
    expect(basisOf(liked)?.basis).toBe('liked_category');
    expect(basisOf(unliked)?.basis).toBe('popular');
  });

  it('never downgrades popular, which claims nothing', () => {
    const result = reconcile(grid([ref('TR-101', { basis: 'popular' })]));

    expect(basisOf(result)?.basis).toBe('popular');
    expect(result.violations).toEqual([]);
  });

  it('checks every basis in the vocabulary', () => {
    // A basis added without a rule here would be waved through unverified.
    for (const basis of RECOMMENDATION_BASES) {
      const result = reconcile(grid([ref('TR-101', { basis })]));
      const kept = basisOf(result)?.basis;
      expect(kept === basis || kept === 'popular').toBe(true);
    }
  });
});

describe('text repair', () => {
  it('truncates rather than discarding an over-long headline', () => {
    const spec = { ...specWith([]), headline: 'x'.repeat(500) };
    const result = reconcile({ ...spec, blocks: grid([ref('TR-101')]).blocks });

    // The cap is a cap: the ellipsis is inside it, not added on top.
    expect(result.spec.headline).toHaveLength(90);
    expect(result.spec.headline.endsWith('…')).toBe(true);
  });

  it('collapses runs of whitespace', () => {
    const result = reconcile({
      ...grid([ref('TR-101')]),
      headline: '  Back    to \n the trail  ',
    });

    expect(result.spec.headline).toBe('Back to the trail');
  });

  it('turns a badge that clamps to nothing into null', () => {
    const result = reconcile(grid([ref('TR-101', { badge: '   ' })]));
    const [block] = result.spec.blocks;
    if (block?.kind !== 'grid') throw new Error('expected a grid');

    expect(block.items[0]?.badge).toBeNull();
  });

  it('narrows a grid that is wider than it has items to fill', () => {
    const result = reconcile(
      specWith([{ kind: 'grid', title: null, columns: 4, items: [ref('TR-101')] }]),
    );
    const [block] = result.spec.blocks;
    if (block?.kind !== 'grid') throw new Error('expected a grid');

    expect(block.columns).toBe(2);
  });
});

describe('usability', () => {
  it('is unusable when every product was dropped', () => {
    const result = reconcile(grid([ref('GHOST-1'), ref('GHOST-2')]));

    expect(result.isUsable).toBe(false);
    expect(result.violations).toContain('unusable:no-products');
  });

  it('is unusable when nothing but prose survives', () => {
    const result = reconcile(
      specWith([{ kind: 'copy', title: null, body: 'Trail season is here.' }]),
    );

    expect(result.isUsable).toBe(false);
  });

  it('is isUsable when a single product survives', () => {
    expect(reconcile(grid([ref('TR-101')])).isUsable).toBe(true);
  });

  it('is isUsable on a hero that kept its product', () => {
    const result = reconcile(
      specWith([
        { kind: 'hero', headline: 'Pick of the season', body: null, sku: 'TR-101', ctaLabel: null },
      ]),
    );

    expect(result.isUsable).toBe(true);
  });

  it('keeps a hero as a headline when its product was rejected', () => {
    const result = reconcile(
      specWith([
        {
          kind: 'hero',
          headline: 'Pick of the season',
          body: null,
          sku: 'GHOST-1',
          ctaLabel: null,
        },
        { kind: 'grid', title: null, columns: 2, items: [ref('TR-101')] },
      ]),
    );
    const [hero] = result.spec.blocks;

    if (hero?.kind !== 'hero') throw new Error('expected a hero');
    expect(hero.sku).toBeNull();
    expect(hero.headline).toBe('Pick of the season');
    expect(result.isUsable).toBe(true);
  });

  it('reports an empty block rather than rendering it', () => {
    const result = reconcile(
      specWith([
        { kind: 'grid', title: null, columns: 2, items: [ref('GHOST-1')] },
        { kind: 'grid', title: null, columns: 2, items: [ref('TR-101')] },
      ]),
    );

    expect(result.spec.blocks).toHaveLength(1);
    expect(result.violations).toContain('empty-block:grid');
  });
});

/**
 * `violations` is the evaluation signal — it is what a generation-validity rate
 * is computed from. A string that names the wrong cause is worse than no string
 * at all, because it looks like data.
 */
describe('attributing a rejection to its real cause', () => {
  const spentBudget = { context: { surface: 'pdp', maxItems: 1 } };

  it('still reports a hallucinated SKU once the budget is spent', () => {
    const result = reconcile(grid([ref('TR-101'), ref('GHOST-1')]), spentBudget);

    // Reporting this as budget:dropped would understate how often the model
    // invents products, which is the number Section V asks for.
    expect(result.violations).toContain('unknown-sku:GHOST-1');
    expect(result.violations).not.toContain('budget:dropped:GHOST-1');
  });

  it('still reports a blocked SKU once the budget is spent', () => {
    const result = reconcile(grid([ref('TR-102'), ref('TR-101')]), {
      ...spentBudget,
      signals: { dislikes: [{ sku: 'TR-101' }] },
    });

    expect(result.violations).toContain('blocked-sku:TR-101');
  });

  it('still reports a duplicate once the budget is spent', () => {
    const result = reconcile(grid([ref('TR-101'), ref('TR-101')]), spentBudget);

    expect(result.violations).toContain('duplicate-sku:TR-101');
  });

  it('reports the budget when the budget really is the reason', () => {
    const result = reconcile(grid([ref('TR-101'), ref('TR-102')]), spentBudget);

    expect(result.violations).toEqual(['budget:dropped:TR-102']);
  });

  it('names a missing headline as such, not as a missing product', () => {
    const result = reconcile({ ...grid([ref('TR-101')]), headline: '   ' });

    expect(result.isUsable).toBe(false);
    expect(result.violations).toContain('unusable:no-headline');
    expect(result.violations).not.toContain('unusable:no-products');
  });

  it('records both when both are missing', () => {
    const result = reconcile({ ...grid([ref('GHOST-1')]), headline: '   ' });

    expect(result.violations).toContain('unusable:no-products');
    expect(result.violations).toContain('unusable:no-headline');
  });
});

describe('choosing a bundle', () => {
  const block = {
    kind: 'bundle' as const,
    title: 'Get set up',
    body: null,
    ctaLabel: 'Add both',
    bundleId: null,
  };

  it('fills in a bundle the shop offered', () => {
    const result = reconcile(specWith([block]), {
      candidates: [product('A'), product('B')],
      bundles: [{ id: 'BUN-1', skus: ['A', 'B'], price: 25 }],
    });

    expect(result.spec.blocks[0]).toMatchObject({ kind: 'bundle', bundleId: 'BUN-1' });
  });

  it('throws away a bundleId the model tried to set', () => {
    // The model does not choose. If it did, it could name a set this shopper
    // was never offered.
    const result = reconcile(specWith([{ ...block, bundleId: 'BUN-MADE-UP' }]), {
      candidates: [product('A'), product('B')],
      bundles: [{ id: 'BUN-1', skus: ['A', 'B'], price: 25 }],
    });

    expect(result.spec.blocks[0]).toMatchObject({ bundleId: 'BUN-1' });
  });

  it('drops the block when the shop offers no bundles', () => {
    const result = reconcile(specWith([block]), { candidates: [product('A')], bundles: [] });

    expect(result.spec.blocks).toHaveLength(0);
  });

  it('will not show a bundle with a product the shopper cannot buy', () => {
    // A set missing one of its parts is not that set.
    const result = reconcile(specWith([block]), {
      candidates: [product('A'), product('B', { isInStock: false })],
      bundles: [{ id: 'BUN-1', skus: ['A', 'B'], price: 25 }],
    });

    expect(result.spec.blocks).toHaveLength(0);
  });

  it('will not show a bundle holding something the shopper disliked', () => {
    // Cart and purchase history are fine in a set. A thumbs-down is not.
    const result = reconcile(specWith([block]), {
      candidates: [product('A'), product('B')],
      bundles: [{ id: 'BUN-1', skus: ['A', 'B'], price: 25 }],
      signals: { dislikes: [{ sku: 'B' }] },
    });

    expect(result.spec.blocks).toHaveLength(0);
  });

  it('will not show a bundle whose product is already on the page', () => {
    // The same product twice on one page reads as a mistake.
    const result = reconcile(
      specWith([{ kind: 'grid', title: 'For you', columns: 3, items: [ref('A')] }, block]),
      {
        candidates: [product('A'), product('B')],
        bundles: [{ id: 'BUN-1', skus: ['A', 'B'], price: 25 }],
      },
    );

    expect(result.spec.blocks).toHaveLength(1);
    expect(result.spec.blocks[0]).toMatchObject({ kind: 'grid' });
  });

  it('will not show a bundle bigger than the room left', () => {
    const result = reconcile(specWith([block]), {
      candidates: [product('A'), product('B')],
      bundles: [{ id: 'BUN-1', skus: ['A', 'B'], price: 25 }],
      context: { surface: 'pdp', maxItems: 1 },
    });

    expect(result.spec.blocks).toHaveLength(0);
  });

  it('prefers a bundle holding something already in the cart', () => {
    const result = reconcile(specWith([block]), {
      candidates: [product('A'), product('B'), product('C')],
      bundles: [
        { id: 'PLAIN', skus: ['B', 'C'], price: 30 },
        { id: 'CART', skus: ['A', 'B'], price: 25 },
      ],
      signals: { cart: [{ sku: 'A' }] },
    });

    expect(result.spec.blocks[0]).toMatchObject({ bundleId: 'CART' });
  });
});

describe('an empty hero', () => {
  it('is dropped when it has neither a headline nor a product', () => {
    const result = reconcile(
      specWith([
        { kind: 'hero', headline: '   ', body: null, sku: 'GHOST-1', ctaLabel: null },
        { kind: 'grid', title: null, columns: 2, items: [ref('TR-101')] },
      ]),
    );

    // Every other block kind disappears when it clamps to nothing; a hero that
    // survives empty renders a blank region above real content.
    expect(result.spec.blocks.map((block) => block.kind)).toEqual(['grid']);
    expect(result.violations).toContain('empty-block:hero');
  });

  it('survives on a headline alone', () => {
    const result = reconcile(
      specWith([
        { kind: 'hero', headline: 'Pick of the season', body: null, sku: null, ctaLabel: null },
        { kind: 'grid', title: null, columns: 2, items: [ref('TR-101')] },
      ]),
    );

    expect(result.spec.blocks.map((block) => block.kind)).toEqual(['hero', 'grid']);
  });

  it('survives on a product alone', () => {
    const result = reconcile(
      specWith([{ kind: 'hero', headline: '   ', body: null, sku: 'TR-101', ctaLabel: null }]),
    );

    const [block] = result.spec.blocks;
    if (block?.kind !== 'hero') throw new Error('expected a hero');
    expect(block.sku).toBe('TR-101');
    expect(result.isUsable).toBe(true);
  });
});
