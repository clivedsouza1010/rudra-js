import { describe, expect, it } from 'vitest';
import {
  RECOMMENDATION_BASES,
  type Block,
  type BundleBlock,
  type GeneratedSpec,
  type ProductReference,
  type RecommendationBasis,
} from './component-spec.js';
import { selectProducts } from './product-selection.js';
import { buildDigest } from './signal-digest.js';
import { MAX_BLOCKS, reconcileSpec, type ReconcileResult } from './reconciliation.js';
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

/** One surviving product, so a spec stays usable while its words are tested. */
const PRODUCT_GRID: Block = { kind: 'grid', title: null, columns: 2, items: [ref('TR-101')] };

/** Runs a spec through reconciliation against a given payload. */
function reconcile(spec: GeneratedSpec, overrides: Partial<TrackingInputDraft> = {}) {
  const input = inputFor(overrides);
  return reconcileSpec(spec, input, buildDigest(input));
}

const WELL_RATED = [
  product('TR-101', { rating: 4.9 }),
  product('TR-102', { rating: 4.8 }),
  product('NU-201', { category: 'Nutrition', rating: 4.7 }),
];

describe('the selector writes reasons its own screen accepts', () => {
  // Every branch of basisFor, driven through selectProducts so the reasons are
  // the real ones. A reason the screen deletes is a card that loses its line
  // and a violation counted against a model that said nothing.
  const SHAPES: Array<[string, Partial<TrackingInputDraft>]> = [
    ['a cold-start shopper', {}],
    [
      'a shopper on a category page',
      { context: { surface: 'pdp', currentCategory: 'Trail Running' } },
    ],
    [
      'a shopper with something in the cart',
      { signals: { cart: [{ sku: 'TR-102', at: Date.now() }] } },
    ],
    [
      'a shopper who viewed a product',
      { signals: { mostViewed: [{ sku: 'TR-101', at: Date.now(), views: 3 }] } },
    ],
    ['a well-rated catalog', { candidates: WELL_RATED }],
  ];

  it.each(SHAPES)('keeps every reason for %s', (_name, overrides) => {
    const input = inputFor(overrides);
    const picks = selectProducts(input, buildDigest(input));
    expect(picks.length).toBeGreaterThan(0);

    const items = picks.map((pick) =>
      ref(pick.product.sku, { basis: pick.basis, reason: pick.reason }),
    );
    const result = reconcile(
      specWith([{ kind: 'grid', title: null, columns: 2, items }]),
      overrides,
    );

    const placed = result.spec.blocks.flatMap((block) =>
      block.kind === 'grid' || block.kind === 'carousel' ? block.items : [],
    );
    for (const item of placed) {
      expect(item.reason, `the selector's reason for ${item.sku} was deleted`).not.toBeNull();
    }
    expect(result.violations.filter((v) => v.startsWith('unverifiable-claim'))).toEqual([]);
  });
});

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

  // The spec schema cannot bound a string, so the SKU here is whatever the
  // model wrote. It goes straight into a violation string an evaluation logs.
  it('keeps a very long SKU short in the violation it records', () => {
    const result = reconcile(grid([ref('X'.repeat(500))]));

    const violation = result.violations[0] ?? '';
    expect(violation.startsWith('unknown-sku:')).toBe(true);
    expect(violation.length).toBeLessThan(50);
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

  it('caps the number of blocks at four, and hands back exactly four when given five', () => {
    const copyBlock = { kind: 'copy', title: null, body: 'Built for wet rock.' } as const;
    const spec = specWith([
      { kind: 'grid', title: null, columns: 2, items: [ref('TR-101')] },
      ...Array.from({ length: MAX_BLOCKS }, () => copyBlock),
    ]);

    const result = reconcile(spec);

    expect(MAX_BLOCKS).toBe(4);
    expect(spec.blocks).toHaveLength(MAX_BLOCKS + 1);
    expect(result.spec.blocks).toHaveLength(MAX_BLOCKS);
    expect(result.violations).toContain(`too-many-blocks:${MAX_BLOCKS + 1}`);
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

  const SUPPORTED_BY: Record<RecommendationBasis, Partial<TrackingInputDraft>> = {
    similar_to_current: { context: { surface: 'pdp', currentCategory: 'Trail Running' } },
    most_viewed: { signals: { mostViewed: [{ sku: 'TR-101', views: 3 }] } },
    complements_cart: { signals: { cart: [{ sku: 'NU-201' }] } },
    complements_purchase: { signals: { lastPurchased: [{ sku: 'NU-201' }] } },
    liked_category: { signals: { likes: [{ sku: 'TR-102' }] } },
    popular: {},
  };

  it.each(RECOMMENDATION_BASES)('keeps %s when the signals support it', (basis) => {
    const result = reconcile(grid([ref('TR-101', { basis })]), SUPPORTED_BY[basis]);

    expect(basisOf(result)?.basis).toBe(basis);
    expect(result.violations).toEqual([]);
  });

  it.each(RECOMMENDATION_BASES.filter((basis) => basis !== 'popular'))(
    'downgrades %s when the signals do not, and popular is left out because it claims nothing',
    (basis) => {
      const result = reconcile(grid([ref('TR-101', { basis })]));

      expect(basisOf(result)?.basis).toBe('popular');
      expect(result.violations).toContain(`unsupported-basis:${basis}:TR-101`);
    },
  );
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

  it('is isUsable when a bundle is the only block carrying products', () => {
    const result = reconcile(
      specWith([
        { kind: 'banner', tone: 'info', text: 'Free returns', ctaLabel: null },
        { kind: 'bundle', title: 'Get set up', body: null, ctaLabel: null, bundleId: null },
      ]),
      {
        candidates: [product('A'), product('B')],
        bundles: [{ id: 'BUN-1', skus: ['A', 'B'], price: 25 }],
      },
    );

    expect(result.isUsable).toBe(true);
    expect(result.violations).not.toContain('unusable:no-products');
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
    // Otherwise the model could name a set this shopper was never offered.
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

  it('prefers one product in the cart over three the shopper only viewed', () => {
    const result = reconcile(specWith([block]), {
      candidates: [product('A'), product('B'), product('C'), product('D'), product('E')],
      bundles: [
        { id: 'VIEWED', skus: ['C', 'D', 'E'], price: 60 },
        { id: 'CART', skus: ['A', 'B'], price: 40 },
      ],
      signals: {
        cart: [{ sku: 'A' }],
        mostViewed: [
          { sku: 'C', views: 4 },
          { sku: 'D', views: 3 },
          { sku: 'E', views: 2 },
        ],
      },
    });

    expect(result.spec.blocks[0]).toMatchObject({ bundleId: 'CART' });
  });

  it('prefers one viewed product over three in the category being browsed', () => {
    const result = reconcile(specWith([block]), {
      candidates: [
        product('A'),
        product('B', { category: 'Nutrition' }),
        product('C'),
        product('D'),
        product('E'),
      ],
      bundles: [
        { id: 'CATEGORY', skus: ['C', 'D', 'E'], price: 60 },
        { id: 'VIEWED', skus: ['A', 'B'], price: 40 },
      ],
      context: { surface: 'pdp', currentCategory: 'Trail Running' },
      signals: { mostViewed: [{ sku: 'A', views: 2 }] },
    });

    expect(result.spec.blocks[0]).toMatchObject({ bundleId: 'VIEWED' });
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

describe('claims the renderer cannot check', () => {
  /** The reason that survived on the one product of a one-grid spec. */
  const reasonFor = (text: string): string | null | undefined =>
    basisOf(reconcile(grid([ref('TR-101', { reason: text })])))?.reason;

  // Typed as the block, not inferred: `body: null` would otherwise infer the
  // literal type `null` and refuse a string override.
  const bundleBlock: BundleBlock = {
    kind: 'bundle',
    title: 'Get set up',
    body: null,
    ctaLabel: 'Add both',
    bundleId: null,
  };

  const withBundle = (overrides: Partial<BundleBlock>) =>
    reconcile(specWith([{ ...bundleBlock, ...overrides }]), {
      candidates: [product('A'), product('B')],
      bundles: [{ id: 'BUN-1', skus: ['A', 'B'], price: 25 }],
    });

  // Straight out of the committed transcript. The prompt told the model not to
  // state a rating, and it wrote all three of these anyway.
  const FROM_THE_TRANSCRIPT = [
    'one of the best-reviewed picks in Backpacks',
    'another highly rated backpack in this category',
    "well reviewed in the category you're browsing",
  ];

  for (const claim of FROM_THE_TRANSCRIPT) {
    it(`drops a rating the model really wrote: "${claim}"`, () => {
      expect(reasonFor(claim)).toBeNull();
    });
  }

  it('drops a price claim', () => {
    expect(reasonFor('the same pack for $40 less')).toBeNull();
  });

  it('drops a percentage claim', () => {
    expect(reasonFor('20% off for the rest of the week')).toBeNull();
  });

  it('drops a delivery promise', () => {
    expect(reasonFor('arrives before the weekend')).toBeNull();
  });

  it('drops a stock-level claim', () => {
    expect(reasonFor('only 2 left in stock')).toBeNull();
  });

  // The screen is worse than the hole it fills if it eats honest copy. These
  // talk about weight, warmth and materials, and none of them state a price,
  // a rating, a delivery date or a stock level.
  const ORDINARY = [
    'a waterproof option from the same category',
    'saves weight on long hikes',
    'rated for winter use',
    'goes with the pack in your cart',
    'made from recycled fabric',
    'the roomiest pack in the range',
    'a simple daypack for short walks',
    'the shape you kept coming back to',
  ];

  for (const reason of ORDINARY) {
    it(`keeps ordinary copy: "${reason}"`, () => {
      expect(reasonFor(reason)).toBe(reason);
    });
  }

  // A specification is not a claim, even with a number or a percentage in it.
  // Every line here is copy a real shop writes, and every one of them used to
  // be deleted. They are the regression that stops this screen becoming worse
  // than the hole it fills.
  const SPECIFICATIONS = [
    'made from 100% recycled nylon',
    '100% merino wool against the skin',
    '100% waterproof in a downpour',
    '30% lighter than the pack it replaces',
    'a comfort rating of -5C',
    'an IPX7 water rating',
    'rated 3 season for shoulder-season trips',
    'reduced to 900g without losing warmth',
    'a waterproof rating of 20,000mm',
    'rated to -10C for winter nights',
    'arrives flat-packed',
    'arrives ready to ride',
    'ships flat and folds away',
    'ships in a recycled box',
    'comfortable for the last few miles',
    'does not feel cheap',
    'cuts weight at no cost to comfort',
    'extra clearance for thick socks',
    // The twin of "saves weight on long hikes" above. Which side of "on" the
    // noun falls on is not something an author could predict.
    'saves on weight over the Alpine',
  ];

  for (const reason of SPECIFICATIONS) {
    it(`keeps a specification: "${reason}"`, () => {
      expect(reasonFor(reason)).toBe(reason);
    });
  }

  // Money, a customer score, when it arrives, how many are left.
  const REAL_CLAIMS: { reason: string; kind: string }[] = [
    { reason: 'half off this week', kind: 'discount' },
    { reason: 'was 120, now 80', kind: 'price' },
    { reason: 'reduced this week', kind: 'discount' },
    { reason: 'only a handful left', kind: 'stock' },
    { reason: 'get it by Friday', kind: 'delivery' },
    { reason: 'best seller in Backpacks', kind: 'rating' },
    { reason: 'loved by thousands of buyers', kind: 'rating' },
    { reason: 'yours for USD 20', kind: 'price' },
    { reason: 'EUR 5.99 for a spare pair', kind: 'price' },
    { reason: '₹1,499 for the pair', kind: 'price' },
    { reason: '249 kr for the pair', kind: 'price' },
    { reason: '4.8 out of 5 from other hikers', kind: 'rating' },
    { reason: 'limited stock on this colour', kind: 'stock' },
    { reason: 'only 3 remain', kind: 'stock' },
    { reason: 'only one remains', kind: 'stock' },
    { reason: 'save 20 off the pair', kind: 'discount' },
  ];

  for (const claim of REAL_CLAIMS) {
    it(`drops a ${claim.kind} claim: "${claim.reason}"`, () => {
      const result = reconcile(grid([ref('TR-101', { reason: claim.reason })]));

      expect(result.violations).toContain(`unverifiable-claim:${claim.kind}:reason:TR-101`);
    });
  }

  const ONE_ROW_PER_CLAIM_PATTERN: { kind: string; catches: string; keeps: string }[] = [
    { kind: 'rating', catches: 'reviewed by other hikers', keeps: 'a revised fit for wider feet' },
    {
      kind: 'rating',
      catches: 'five stars from other hikers',
      keeps: 'built for three-season use',
    },
    {
      kind: 'rating',
      catches: 'a star rating other hikers left',
      keeps: 'a comfort rating for winter nights',
    },
    {
      kind: 'rating',
      catches: 'the average rating in this category',
      keeps: 'the average weight of a winter pack',
    },
    { kind: 'rating', catches: 'a rating of 4.6 from hikers', keeps: 'a comfort rating of -5C' },
    {
      kind: 'rating',
      catches: '4.8 out of 5 from other hikers',
      keeps: '3 out of 4 pockets zip shut',
    },
    {
      kind: 'rating',
      catches: 'highly rated by other hikers',
      keeps: 'the top pick for winter nights',
    },
    {
      kind: 'rating',
      catches: 'rated 4.8 by other hikers',
      keeps: 'rated 3 season for shoulder-season trips',
    },
    { kind: 'rating', catches: 'our best-selling pack', keeps: 'the best pack for long days' },
    {
      kind: 'rating',
      catches: 'loved by thousands of hikers',
      keeps: 'loved by anyone who walks far',
    },

    { kind: 'price', catches: '£89 for the pair', keeps: 'a mesh pocket for a 1 litre bottle' },
    {
      kind: 'price',
      catches: '40 dollars for a spare pair',
      keeps: 'a 30 litre pack for long days',
    },
    { kind: 'price', catches: 'yours for USD 20', keeps: 'sold in USD and EUR' },
    { kind: 'price', catches: '249 kr for the pair', keeps: 'weighs 249 g in the stuff sack' },
    {
      kind: 'price',
      catches: 'the same pack at a lower price',
      keeps: 'priceless on a cold night',
    },
    { kind: 'price', catches: 'was 120, now 80', keeps: 'was a niche pack, now a range staple' },
    { kind: 'price', catches: 'cheaper than the pack it replaces', keeps: 'does not feel cheap' },
    {
      kind: 'price',
      catches: 'an affordable second pair',
      keeps: 'you can afford the extra layer',
    },
    {
      kind: 'price',
      catches: 'costs less than the pair it replaces',
      keeps: 'cuts weight at no cost to comfort',
    },
    {
      kind: 'price',
      catches: 'a low-cost second pair',
      keeps: 'a lower-volume pack for short walks',
    },
    {
      kind: 'price',
      catches: 'saves you money over a season',
      keeps: 'saves weight on long hikes',
    },

    { kind: 'discount', catches: '20% off this week', keeps: 'made from 100% recycled nylon' },
    {
      kind: 'discount',
      catches: 'save 25% on the pair',
      keeps: '30% lighter than the pack it replaces',
    },
    { kind: 'discount', catches: 'a discount for members', keeps: 'a members-only colourway' },
    { kind: 'discount', catches: 'the summer sale ends soon', keeps: 'holds its resale value' },
    { kind: 'discount', catches: 'half off this week', keeps: 'half the weight of the old model' },
    { kind: 'discount', catches: 'save 20 off the pair', keeps: 'saves 200 g off the base weight' },
    {
      kind: 'discount',
      catches: 'on clearance until the end of the month',
      keeps: 'extra clearance for thick socks',
    },
    {
      kind: 'discount',
      catches: 'reduced this week',
      keeps: 'reduced to 900g without losing warmth',
    },

    { kind: 'delivery', catches: 'free delivery on this one', keeps: 'ships flat and folds away' },
    {
      kind: 'delivery',
      catches: 'in your hands overnight',
      keeps: 'the next size up fits a bear canister',
    },
    { kind: 'delivery', catches: 'get it by Friday', keeps: 'arrives ready to ride' },
    { kind: 'delivery', catches: 'ships within 2 working days', keeps: 'ships in a recycled box' },
    {
      kind: 'delivery',
      catches: 'in time for the first frost',
      keeps: 'ready for the first frost',
    },

    { kind: 'stock', catches: 'in stock in your size', keeps: 'a well-stocked hip pocket' },
    {
      kind: 'stock',
      catches: 'limited stock on this colour',
      keeps: 'a limited run in three colours',
    },
    { kind: 'stock', catches: 'restocked this morning', keeps: 'sold in three sizes' },
    { kind: 'stock', catches: 'only 3 remain', keeps: 'comfortable for the last few miles' },
    { kind: 'stock', catches: 'selling fast in your size', keeps: 'nearly weightless in the hand' },
  ];

  for (const row of ONE_ROW_PER_CLAIM_PATTERN) {
    it(`drops "${row.catches}" and keeps "${row.keeps}"`, () => {
      const dropped = reconcile(grid([ref('TR-101', { reason: row.catches })]));
      const kept = reconcile(grid([ref('TR-101', { reason: row.keeps })]));

      expect(dropped.violations).toContain(`unverifiable-claim:${row.kind}:reason:TR-101`);
      expect(kept.violations).toEqual([]);
    });
  }

  it('records the claim it dropped', () => {
    const result = reconcile(grid([ref('TR-101', { reason: 'rated 4.8 stars by shoppers' })]));

    expect(result.violations).toContain('unverifiable-claim:rating:reason:TR-101');
  });

  it('records nothing for ordinary copy', () => {
    const result = reconcile(grid([ref('TR-101', { reason: 'saves weight on long hikes' })]));

    expect(result.violations).toEqual([]);
  });

  it('keeps the product when its reason is dropped', () => {
    const result = reconcile(grid([ref('TR-101', { reason: '30% off today' })]));

    expect(placedSkus(result.spec.blocks)).toEqual(['TR-101']);
    expect(result.isUsable).toBe(true);
  });

  it('screens a bundle title, body and CTA the same way', () => {
    const result = withBundle({
      title: 'Half price when you buy the set',
      body: 'rated 4.8 stars by shoppers',
      ctaLabel: 'Get it for $59',
    });

    expect(result.spec.blocks[0]).toMatchObject({
      kind: 'bundle',
      title: null,
      body: null,
      ctaLabel: null,
    });
    expect(result.violations).toContain('unverifiable-claim:price:bundle-title');
    expect(result.violations).toContain('unverifiable-claim:rating:bundle-body');
    expect(result.violations).toContain('unverifiable-claim:price:bundle-cta');
  });

  it('still shows the set when the words around it are dropped', () => {
    const result = withBundle({ title: 'Save 20% on the set', ctaLabel: 'Only 3 left' });

    expect(result.spec.blocks[0]).toMatchObject({ kind: 'bundle', bundleId: 'BUN-1' });
    expect(result.isUsable).toBe(true);
  });

  it('leaves ordinary bundle copy alone', () => {
    const result = withBundle({ body: 'Everything you need for one trip' });

    expect(result.spec.blocks[0]).toMatchObject({
      title: 'Get set up',
      body: 'Everything you need for one trip',
      ctaLabel: 'Add both',
    });
  });
});

/**
 * The screen once ran on four fields, so the same claim could be deleted from a
 * product's small print and kept in the heading right above it. Every string the
 * model writes is read now. Host text is not: a product title, a category and a
 * bundle label are the shop's own words.
 */
describe('claims in every field the model writes', () => {
  it('drops a claim in the spec headline', () => {
    const result = reconcile({ ...specWith([PRODUCT_GRID]), headline: 'Half price this week' });

    expect(result.spec.headline).toBe('');
    expect(result.violations).toContain('unverifiable-claim:price:headline');
  });

  it('drops a claim in the spec subheadline', () => {
    const result = reconcile({ ...specWith([PRODUCT_GRID]), subheadline: 'Only 2 left in stock' });

    expect(result.spec.subheadline).toBeNull();
    expect(result.violations).toContain('unverifiable-claim:stock:subheadline');
  });

  it('drops a claim in a hero headline', () => {
    const result = reconcile(
      specWith([
        {
          kind: 'hero',
          headline: 'Rated 4.8 stars by shoppers',
          body: null,
          sku: 'TR-101',
          ctaLabel: null,
        },
      ]),
    );

    expect(result.spec.blocks[0]).toMatchObject({ kind: 'hero', headline: '', sku: 'TR-101' });
    expect(result.violations).toContain('unverifiable-claim:rating:hero-headline');
  });

  it('drops a claim in a hero body', () => {
    const result = reconcile(
      specWith([
        {
          kind: 'hero',
          headline: 'Pick of the season',
          body: 'arrives before the weekend',
          sku: 'TR-101',
          ctaLabel: null,
        },
      ]),
    );

    expect(result.spec.blocks[0]).toMatchObject({ kind: 'hero', body: null });
    expect(result.violations).toContain('unverifiable-claim:delivery:hero-body');
  });

  it('drops a claim in a hero CTA', () => {
    const result = reconcile(
      specWith([
        {
          kind: 'hero',
          headline: 'Pick of the season',
          body: null,
          sku: 'TR-101',
          ctaLabel: 'Get it for $59',
        },
      ]),
    );

    expect(result.spec.blocks[0]).toMatchObject({ kind: 'hero', ctaLabel: null });
    expect(result.violations).toContain('unverifiable-claim:price:hero-cta');
  });

  it('drops a claim in a grid title', () => {
    const result = reconcile(
      specWith([{ kind: 'grid', title: '20% off everything', columns: 2, items: [ref('TR-101')] }]),
    );

    expect(result.spec.blocks[0]).toMatchObject({ kind: 'grid', title: null });
    expect(result.violations).toContain('unverifiable-claim:discount:grid-title');
  });

  it('drops a claim in a carousel title', () => {
    const result = reconcile(
      specWith([{ kind: 'carousel', title: 'Best sellers in Backpacks', items: [ref('TR-101')] }]),
    );

    expect(result.spec.blocks[0]).toMatchObject({ kind: 'carousel', title: null });
    expect(result.violations).toContain('unverifiable-claim:rating:carousel-title');
  });

  it('drops a claim in banner text', () => {
    const result = reconcile(
      specWith([
        { kind: 'banner', tone: 'info', text: '20% off for the rest of the week', ctaLabel: null },
        PRODUCT_GRID,
      ]),
    );

    expect(result.violations).toContain('unverifiable-claim:discount:banner-text');
  });

  it('drops a claim in a banner CTA', () => {
    const result = reconcile(
      specWith([
        { kind: 'banner', tone: 'info', text: 'Built for wet rock', ctaLabel: 'Only 3 left' },
        PRODUCT_GRID,
      ]),
    );

    expect(result.spec.blocks[0]).toMatchObject({ kind: 'banner', ctaLabel: null });
    expect(result.violations).toContain('unverifiable-claim:stock:banner-cta');
  });

  it('drops a claim in a copy title', () => {
    const result = reconcile(
      specWith([
        { kind: 'copy', title: 'Half off this week', body: 'Built for wet rock.' },
        PRODUCT_GRID,
      ]),
    );

    expect(result.spec.blocks[0]).toMatchObject({ kind: 'copy', title: null });
    expect(result.violations).toContain('unverifiable-claim:discount:copy-title');
  });

  it('drops a claim in a copy body', () => {
    const result = reconcile(
      specWith([
        { kind: 'copy', title: null, body: 'Free next-day delivery on every order.' },
        PRODUCT_GRID,
      ]),
    );

    expect(result.violations).toContain('unverifiable-claim:delivery:copy-body');
  });

  // The rationale is read by engineers, not shoppers, but it is still the
  // model's own words and a log that repeats an untrue claim is a log that
  // hides one.
  it('drops a claim in the spec rationale', () => {
    const result = reconcile({
      ...specWith([PRODUCT_GRID]),
      rationale: 'Half price today, only 2 left in stock',
    });

    expect(result.spec.rationale).toBe('');
    expect(result.violations).toContain('unverifiable-claim:price:rationale');
  });

  it('leaves an ordinary rationale alone', () => {
    const result = reconcile(specWith([PRODUCT_GRID]));

    expect(result.spec.rationale).toBe('Leaned on the category affinity.');
    expect(result.violations).toEqual([]);
  });
});

/**
 * Four of those fields cannot be null. Emptying one hands the block to the rule
 * that already drops a block whose text clamps to nothing, so a banner reading
 * "20% off" disappears rather than rendering blank.
 */
describe('a claim in a field that cannot be empty', () => {
  it('drops a banner whose text makes a claim', () => {
    const result = reconcile(
      specWith([
        { kind: 'banner', tone: 'info', text: '20% off for the rest of the week', ctaLabel: null },
        PRODUCT_GRID,
      ]),
    );

    expect(result.spec.blocks.map((block) => block.kind)).toEqual(['grid']);
    expect(result.violations).toContain('empty-block:banner');
  });

  it('drops a copy block whose body makes a claim', () => {
    const result = reconcile(
      specWith([
        { kind: 'copy', title: null, body: 'Free next-day delivery on every order.' },
        PRODUCT_GRID,
      ]),
    );

    expect(result.spec.blocks.map((block) => block.kind)).toEqual(['grid']);
    expect(result.violations).toContain('empty-block:copy');
  });

  it('drops a hero whose headline makes a claim and has no product', () => {
    const result = reconcile(
      specWith([
        {
          kind: 'hero',
          headline: 'Half price this week',
          body: null,
          sku: null,
          ctaLabel: null,
        },
        PRODUCT_GRID,
      ]),
    );

    expect(result.spec.blocks.map((block) => block.kind)).toEqual(['grid']);
    expect(result.violations).toContain('empty-block:hero');
  });

  it('makes the whole generation unusable when the spec headline makes a claim', () => {
    const result = reconcile({ ...specWith([PRODUCT_GRID]), headline: 'Half price this week' });

    expect(result.isUsable).toBe(false);
    expect(result.violations).toContain('unusable:no-headline');
  });
});

/**
 * Both strings below are from the committed transcript, from the generation
 * whose product reasons were already dropped for saying the same thing. They are
 * the regression that stops a page contradicting itself.
 */
describe('the words the model really wrote', () => {
  it('drops the subheadline it wrote', () => {
    const result = reconcile({
      ...specWith([PRODUCT_GRID]),
      subheadline: "A short, well-rated selection from the category you're browsing",
    });

    expect(result.spec.subheadline).toBeNull();
    expect(result.violations).toContain('unverifiable-claim:rating:subheadline');
  });

  it('drops the grid title it wrote', () => {
    const result = reconcile(
      specWith([
        { kind: 'grid', title: 'Top-rated in Backpacks', columns: 2, items: [ref('TR-101')] },
      ]),
    );

    expect(result.spec.blocks[0]).toMatchObject({ kind: 'grid', title: null });
    expect(result.violations).toContain('unverifiable-claim:rating:grid-title');
  });
});

/**
 * The same specifications the screen already leaves alone in a product reason. A
 * heading is not a different kind of sentence, and a screen that eats honest
 * copy on every page is worse than the hole it fills.
 */
describe('ordinary copy in the fields now screened', () => {
  const SPECIFICATIONS = [
    'made from 100% recycled nylon',
    'a comfort rating of -5C',
    'arrives flat-packed',
  ];

  for (const text of SPECIFICATIONS) {
    it(`keeps it in a headline: "${text}"`, () => {
      const result = reconcile({ ...specWith([PRODUCT_GRID]), headline: text });

      expect(result.spec.headline).toBe(text);
      expect(result.violations).toEqual([]);
    });

    it(`keeps it in a banner: "${text}"`, () => {
      const result = reconcile(
        specWith([{ kind: 'banner', tone: 'info', text, ctaLabel: null }, PRODUCT_GRID]),
      );

      expect(result.spec.blocks[0]).toMatchObject({ kind: 'banner', text });
      expect(result.violations).toEqual([]);
    });
  }
});
