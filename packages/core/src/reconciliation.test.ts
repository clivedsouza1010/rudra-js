import { BANNED_PHRASES, verify } from '@rudra-js/attested';
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
import { buildDigest, DIGEST_LIMITS } from './signal-digest.js';
import { ALLOWED_PHRASES } from './claim-screening.js';
import {
  MAX_BLOCKS,
  bundleForShopper,
  placeableHeroSkus,
  reconcileSpec,
  type ReconcileResult,
} from './reconciliation.js';
import { FIELD_LIMITS, parseTrackingInput, type TrackingInputDraft } from './tracking-input.js';

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

const PRODUCT_GRID: Block = { kind: 'grid', title: null, columns: 2, items: [ref('TR-101')] };

function reconcile(
  spec: GeneratedSpec,
  overrides: Partial<TrackingInputDraft> = {},
  ourReasons?: ReadonlyMap<string, string>,
) {
  const input = inputFor(overrides);
  return reconcileSpec(spec, input, buildDigest(input), ourReasons);
}

const WELL_RATED = [
  product('TR-101', { rating: 4.9 }),
  product('TR-102', { rating: 4.8 }),
  product('NU-201', { category: 'Nutrition', rating: 4.7 }),
];

describe("a reason the shop supplied is the shop's own words", () => {
  const CLAIM = 'Only 2 left at this price';
  const candidates = [product('TR-101', { reason: CLAIM }), product('TR-102')];

  it('keeps it when the cohort path wrote it from the candidate', () => {
    const result = reconcile(
      grid([ref('TR-101', { reason: CLAIM })]),
      { candidates },
      new Map([['TR-101', CLAIM]]),
    );
    const items = result.spec.blocks.flatMap((b) => (b.kind === 'grid' ? b.items : []));

    expect(items[0]?.reason).toBe(CLAIM);
    expect(result.violations).toEqual([]);
  });

  it('screens the identical sentence when the model wrote it', () => {
    const result = reconcile(grid([ref('TR-101', { reason: CLAIM })]), { candidates });
    const items = result.spec.blocks.flatMap((b) => (b.kind === 'grid' ? b.items : []));

    expect(items[0]?.reason).toBeNull();
    expect(result.violations.join()).toMatch(/^unverifiable-claim:[a-z]+:reason:TR-101$/);
  });

  it('screens it when the shop never supplied one at all', () => {
    const result = reconcile(grid([ref('TR-101', { reason: CLAIM })]));
    const items = result.spec.blocks.flatMap((b) => (b.kind === 'grid' ? b.items : []));

    expect(items[0]?.reason).toBeNull();
  });

  it('screens a sentence the model wrote for a product the shop wrote one for', () => {
    const result = reconcile(
      grid([ref('TR-101', { reason: 'Only 2 left at this price, save 30%' })]),
      { candidates },
      new Map([['TR-101', CLAIM]]),
    );
    const items = result.spec.blocks.flatMap((b) => (b.kind === 'grid' ? b.items : []));

    expect(items[0]?.reason).toBeNull();
    expect(result.violations.join()).toMatch(/^unverifiable-claim:[a-z]+:reason:TR-101$/);
  });

  it('keeps a reason at the longest length the shop may send, uncut', () => {
    const longest = 'a'.repeat(FIELD_LIMITS.reason);
    const result = reconcile(
      grid([ref('TR-101', { reason: longest })]),
      { candidates: [product('TR-101', { reason: longest }), product('TR-102')] },
      new Map([['TR-101', longest]]),
    );
    const items = result.spec.blocks.flatMap((b) => (b.kind === 'grid' ? b.items : []));

    expect(items[0]?.reason).toBe(longest);
    expect(result.violations).toEqual([]);
  });
});

describe('a badge is screened like any other sentence', () => {
  it.each([
    ['a discount', 'Save 30%'],
    ['a stock level', 'Only 2 left'],
    ['a rating', 'Top rated'],
  ])('drops a badge claiming %s', (_kind, badge) => {
    const result = reconcile(grid([ref('TR-101', { badge })]));
    const items = result.spec.blocks.flatMap((b) => (b.kind === 'grid' ? b.items : []));

    expect(items[0]?.badge).toBeNull();
    expect(result.violations.join()).toMatch(/^unverifiable-claim:[a-z]+:badge:TR-101$/);
  });

  it('keeps a badge that claims nothing', () => {
    const result = reconcile(grid([ref('TR-101', { badge: 'Worth a look' })]));
    const items = result.spec.blocks.flatMap((b) => (b.kind === 'grid' ? b.items : []));

    expect(items[0]?.badge).toBe('Worth a look');
    expect(result.violations).toEqual([]);
  });

  it('drops a badge along with the basis it was stating', () => {
    const result = reconcile(
      grid([ref('TR-101', { basis: 'most_viewed', badge: 'You viewed this' })]),
    );

    expect(basisOf(result)?.basis).toBe('popular');
    expect(basisOf(result)?.badge).toBeNull();
  });

  it('keeps the badge when the basis holds', () => {
    const result = reconcile(
      grid([ref('TR-101', { basis: 'most_viewed', badge: 'Seen before' })]),
      {
        signals: { mostViewed: [{ sku: 'TR-101', views: 3 }] },
      },
    );

    expect(basisOf(result)?.badge).toBe('Seen before');
  });
});
describe('the selector writes reasons its own screen accepts', () => {
  const SHAPES: Array<[string, RecommendationBasis, Partial<TrackingInputDraft>]> = [
    ['a cold-start shopper', 'popular', {}],
    [
      'a shopper on a category page',
      'similar_to_current',
      { context: { surface: 'pdp', currentCategory: 'Trail Running' } },
    ],
    [
      'a shopper with something in the cart',
      'complements_cart',
      { signals: { cart: [{ sku: 'TR-102', at: Date.now() }] } },
    ],
    [
      'a shopper who viewed a product',
      'most_viewed',
      { signals: { mostViewed: [{ sku: 'TR-101', at: Date.now(), views: 3 }] } },
    ],
    ['a well-rated catalog', 'popular', { candidates: WELL_RATED }],
  ];

  it.each(SHAPES)('keeps every reason for %s', (_name, expectedBasis, overrides) => {
    const input = inputFor(overrides);
    const picks = selectProducts(input, buildDigest(input));
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.map((pick) => pick.basis)).toContain(expectedBasis);

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

const basisOf = (result: ReconcileResult): ProductReference | undefined => {
  const [block] = result.spec.blocks;
  if (block?.kind !== 'grid') throw new Error('expected a grid');
  return block.items[0];
};

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

  it('drops a purchase older than the digest keeps', () => {
    const bought = Array.from({ length: 9 }, (_, index) => ({
      sku: `BUY-${index + 1}`,
      at: 1_700_000_000_000 + index,
    }));

    const result = reconcile(grid([ref('BUY-1'), ref('TR-101')]), {
      candidates: [...bought.map((purchase) => product(purchase.sku)), product('TR-101')],
      signals: { lastPurchased: bought },
    });

    expect(placedSkus(result.spec.blocks)).toEqual(['TR-101']);
    expect(result.violations).toContain('blocked-sku:BUY-1');
  });

  it('places a product once, however often the model names it', () => {
    const result = reconcile(grid([ref('TR-101'), ref('TR-101'), ref('TR-102')]));

    expect(placedSkus(result.spec.blocks)).toEqual(['TR-101', 'TR-102']);
    expect(result.violations).toContain('duplicate-sku:TR-101');
  });

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

describe('the hero products a spec reserves room for', () => {
  it('reserves one slot for a product two heroes both name', () => {
    const input = inputFor();
    const heroes: Block[] = [
      { kind: 'hero', headline: 'Back in the range', body: null, sku: 'TR-101', ctaLabel: null },
      { kind: 'hero', headline: 'Out again', body: null, sku: 'TR-101', ctaLabel: null },
    ];

    expect(placeableHeroSkus(heroes, input)).toEqual(['TR-101']);
  });
});

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

  it('will not read standing in a category as liking it', () => {
    const browsing = { surface: 'pdp', currentCategory: 'Trail Running' };
    const result = reconcile(
      grid([ref('TR-101', { basis: 'liked_category', reason: 'You keep coming back to these' })]),
      { context: browsing },
    );

    expect(basisOf(result)?.basis).toBe('popular');
    expect(basisOf(result)?.reason).toBeNull();
    expect(result.violations).toContain('unsupported-basis:liked_category:TR-101');
  });

  it('keeps liked_category for a shopper who really did engage there', () => {
    const result = reconcile(grid([ref('TR-101', { basis: 'liked_category' })]), {
      context: { surface: 'pdp', currentCategory: 'Trail Running' },
      signals: { likes: [{ sku: 'TR-102' }] },
    });

    expect(basisOf(result)?.basis).toBe('liked_category');
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

    expect(result.spec.headline).toHaveLength(90);
    expect(result.spec.headline.endsWith('…')).toBe(true);
  });

  it('truncates an over-long reason', () => {
    const result = reconcile(grid([ref('TR-101', { reason: 'a'.repeat(130) })]));

    expect(basisOf(result)?.reason).toHaveLength(120);
    expect(basisOf(result)?.reason?.endsWith('…')).toBe(true);
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

  it('keeps a grid no wider than the model asked for', () => {
    const items = [ref('TR-101'), ref('TR-102'), ref('NU-201')];
    const result = reconcile(specWith([{ kind: 'grid', title: null, columns: 2, items }]));
    const [block] = result.spec.blocks;
    if (block?.kind !== 'grid') throw new Error('expected a grid');

    expect(block.items).toHaveLength(3);
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

  it('is unusable when a digit the shop never supplied is in the headline', () => {
    const result = reconcile({
      ...specWith([PRODUCT_GRID]),
      headline: 'Our 3 favourites for wet weather',
    });

    expect(result.spec.headline).toBe('');
    expect(result.violations).toContain('unverifiable-claim:quantity:headline');
    expect(result.violations).toContain('unusable:no-headline');
    expect(result.isUsable).toBe(false);
  });

  it('is isUsable when a bundle is the only block carrying products', () => {
    const result = reconcile(
      specWith([
        { kind: 'banner', tone: 'info', text: 'Built for wet rock', ctaLabel: null },
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

describe('attributing a rejection to its real cause', () => {
  const spentBudget = { context: { surface: 'pdp', maxItems: 1 } };

  it('still reports a hallucinated SKU once the budget is spent', () => {
    const result = reconcile(grid([ref('TR-101'), ref('GHOST-1')]), spentBudget);

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

  it('reports a cart SKU the host never offered as unknown, not blocked', () => {
    const result = reconcile(grid([ref('TR-101'), ref('TR-999')]), {
      signals: { cart: [{ sku: 'TR-999' }] },
    });

    expect(result.violations).toContain('unknown-sku:TR-999');
    expect(result.violations).not.toContain('blocked-sku:TR-999');
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
    const result = reconcile(specWith([block]), {
      candidates: [product('A'), product('B', { isInStock: false })],
      bundles: [{ id: 'BUN-1', skus: ['A', 'B'], price: 25 }],
    });

    expect(result.spec.blocks).toHaveLength(0);
  });

  it('will not show a bundle holding something the shopper disliked', () => {
    const result = reconcile(specWith([block]), {
      candidates: [product('A'), product('B')],
      bundles: [{ id: 'BUN-1', skus: ['A', 'B'], price: 25 }],
      signals: { dislikes: [{ sku: 'B' }] },
    });

    expect(result.spec.blocks).toHaveLength(0);
  });

  it('will not show a bundle holding a dislike the digest had no room for', () => {
    const result = reconcile(specWith([block]), {
      candidates: [product('A'), product('B')],
      bundles: [{ id: 'BUN-1', skus: ['A', 'B'], price: 25 }],
      signals: {
        dislikes: [
          { sku: 'B', at: 1_000 },
          ...Array.from({ length: DIGEST_LIMITS.disliked }, (_, i) => ({
            sku: `OTHER-${i}`,
            at: 2_000 + i,
          })),
        ],
      },
    });

    expect(result.spec.blocks).toHaveLength(0);
  });

  it('will not show a bundle holding the product being looked at', () => {
    const result = reconcile(specWith([block]), {
      candidates: [product('A'), product('B')],
      bundles: [{ id: 'BUN-1', skus: ['A', 'B'], price: 25 }],
      context: { surface: 'pdp', currentSku: 'B' },
    });

    expect(result.spec.blocks).toHaveLength(0);
  });

  it('still shows a bundle holding something the shopper already bought', () => {
    const result = reconcile(specWith([block]), {
      candidates: [product('A'), product('B')],
      bundles: [{ id: 'BUN-1', skus: ['A', 'B'], price: 25 }],
      signals: { lastPurchased: [{ sku: 'B' }] },
    });

    expect(result.spec.blocks[0]).toMatchObject({ kind: 'bundle', bundleId: 'BUN-1' });
  });

  it('still shows a bundle holding something in the basket', () => {
    const result = reconcile(specWith([block]), {
      candidates: [product('A'), product('B')],
      bundles: [{ id: 'BUN-1', skus: ['A', 'B'], price: 25 }],
      signals: { cart: [{ sku: 'B' }] },
    });

    expect(result.spec.blocks[0]).toMatchObject({ kind: 'bundle', bundleId: 'BUN-1' });
  });

  it('will not show a bundle whose product is already on the page', () => {
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

  it('keeps the first of two sets the signals cannot separate', () => {
    const result = reconcile(specWith([block]), {
      candidates: [product('A'), product('B'), product('C'), product('D')],
      bundles: [
        { id: 'FIRST', skus: ['A', 'B'], price: 30 },
        { id: 'SECOND', skus: ['C', 'D'], price: 30 },
      ],
    });

    expect(result.spec.blocks[0]).toMatchObject({ bundleId: 'FIRST' });
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

describe('the set the generator reserves room for', () => {
  const BUNDLE_BLOCK: Block = {
    kind: 'bundle',
    title: null,
    body: null,
    ctaLabel: null,
    bundleId: null,
  };

  function bothPaths(overrides: Partial<TrackingInputDraft>) {
    const input = inputFor(overrides);
    const digest = buildDigest(input);

    return {
      reserved: bundleForShopper(input, digest, [])?.id ?? null,
      placed: reconcileSpec(specWith([BUNDLE_BLOCK]), input, digest).spec.blocks[0] ?? null,
    };
  }

  const PAIR = {
    candidates: [product('A'), product('B')],
    bundles: [{ id: 'BUN-1', skus: ['A', 'B'], price: 25 }],
  };

  it('reserves nothing for a set holding a dislike the digest had no room for', () => {
    const { reserved, placed } = bothPaths({
      ...PAIR,
      signals: {
        dislikes: [
          { sku: 'B', at: 1_000 },
          ...Array.from({ length: DIGEST_LIMITS.disliked }, (_, i) => ({
            sku: `OTHER-${i}`,
            at: 2_000 + i,
          })),
        ],
      },
    });

    expect(reserved).toBeNull();
    expect(placed).toBeNull();
  });

  it('reserves nothing for a set holding the product being looked at', () => {
    const { reserved, placed } = bothPaths({
      ...PAIR,
      context: { surface: 'pdp', currentSku: 'B' },
    });

    expect(reserved).toBeNull();
    expect(placed).toBeNull();
  });

  it('reserves the set both paths can still place', () => {
    const { reserved, placed } = bothPaths(PAIR);

    expect(reserved).toBe('BUN-1');
    expect(placed).toMatchObject({ kind: 'bundle', bundleId: 'BUN-1' });
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
  const reasonFor = (text: string): string | null | undefined =>
    basisOf(reconcile(grid([ref('TR-101', { reason: text })])))?.reason;

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

  const SPECIFICATIONS = [
    'arrives flat-packed',
    'arrives ready to ride',
    'ships flat and folds away',
    'ships in a recycled box',
    'comfortable for the last few miles',
    'does not feel cheap',
    "doesn't feel cheap",
    'cuts weight at no cost to comfort',
    'saves on weight over the Alpine',
  ];

  for (const reason of SPECIFICATIONS) {
    it(`keeps a specification: "${reason}"`, () => {
      expect(reasonFor(reason)).toBe(reason);
    });
  }

  const NEAR_AN_ALLOWANCE = [
    'extra clearance for thick socks',
    'ample clearance for thick socks',
    'comfortable for the last few kilometres',
  ];

  for (const reason of NEAR_AN_ALLOWANCE) {
    it(`drops a near neighbour of an allowed phrase: "${reason}"`, () => {
      expect(reasonFor(reason)).toBeNull();
    });
  }

  const NUMERIC_SPECIFICATIONS: { reason: string; tags: string[] }[] = [
    { reason: 'made from 100% recycled nylon', tags: ['100% recycled'] },
    { reason: '100% merino wool against the skin', tags: ['100% merino'] },
    { reason: '100% waterproof in a downpour', tags: ['100% waterproof'] },
    { reason: '30% lighter than the pack it replaces', tags: ['30% lighter'] },
    { reason: 'a comfort rating of -5C', tags: ['-5C comfort'] },
    { reason: 'an IPX7 water rating', tags: ['IPX7'] },
    { reason: 'rated 3 season for shoulder-season trips', tags: ['3 season'] },
    { reason: 'reduced to 900g without losing warmth', tags: ['900g'] },
    { reason: 'a waterproof rating of 20,000mm', tags: ['20000mm'] },
    { reason: 'rated to -10C for winter nights', tags: ['-10C rated'] },
  ];

  for (const row of NUMERIC_SPECIFICATIONS) {
    it(`keeps "${row.reason}" when the shop supplied the number`, () => {
      const result = reconcile(grid([ref('TR-101', { reason: row.reason })]), {
        candidates: [product('TR-101', { tags: row.tags }), product('TR-102')],
      });

      expect(basisOf(result)?.reason).toBe(row.reason);
      expect(result.violations).toEqual([]);
    });

    it(`drops "${row.reason}" when it did not`, () => {
      const result = reconcile(grid([ref('TR-101', { reason: row.reason })]));

      expect(basisOf(result)?.reason).toBeNull();
      expect(result.violations).toContain('unverifiable-claim:quantity:reason:TR-101');
    });
  }

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

  const ONE_ROW_PER_CLAIM_PATTERN: {
    kind: string;
    catches: string;
    keeps: string;
    supports?: string[];
    droppedLater?: string;
  }[] = [
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
    {
      kind: 'rating',
      catches: 'a rating of 4.6 from hikers',
      keeps: 'a comfort rating of -5C',
      supports: ['-5C comfort'],
    },
    {
      kind: 'rating',
      catches: '4.8 out of 5 from other hikers',
      keeps: '3 out of 4 pockets zip shut',
      supports: ['3 zip pockets', '4 pockets'],
    },
    {
      kind: 'rating',
      catches: 'highly rated by other hikers',
      keeps: 'well made for winter nights',
    },
    {
      kind: 'rating',
      catches: 'rated 4.8 by other hikers',
      keeps: 'rated 3 season for shoulder-season trips',
      supports: ['3 season'],
    },
    { kind: 'rating', catches: 'our best-selling pack', keeps: 'the best pack for long days' },
    {
      kind: 'rating',
      catches: 'our number one seller last winter',
      keeps: 'the number one reason people upgrade',
    },
    {
      kind: 'rating',
      catches: 'loved by thousands of hikers',
      keeps: 'loved by anyone who walks far',
    },

    {
      kind: 'price',
      catches: '£89 for the pair',
      keeps: 'a mesh pocket for a 1 litre bottle',
      supports: ['1 litre'],
    },
    {
      kind: 'price',
      catches: '40 dollars for a spare pair',
      keeps: 'a 30 litre pack for long days',
      supports: ['30 litre'],
    },
    { kind: 'price', catches: 'yours for USD 20', keeps: 'sold in USD and EUR' },
    {
      kind: 'price',
      catches: '$thirty-nine and it is yours',
      keeps: 'thirty-nine ways to pack it',
    },
    {
      kind: 'price',
      catches: 'yours for 40 pounds',
      keeps: 'a 40 litre pack for long days',
      supports: ['40 litre'],
    },
    {
      kind: 'price',
      catches: 'yours today for thirty-nine dollars',
      keeps: 'two pounds lighter than the old one',
    },
    {
      kind: 'price',
      catches: '249 kr for the pair',
      keeps: 'weighs 249 g in the stuff sack',
      supports: ['249 g'],
    },
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

    {
      kind: 'discount',
      catches: '20% off this week',
      keeps: 'made from 100% recycled nylon',
      supports: ['100% recycled'],
    },
    {
      kind: 'discount',
      catches: 'save 25% on the pair',
      keeps: '30% lighter than the pack it replaces',
      supports: ['30% lighter'],
    },
    { kind: 'discount', catches: 'a discount for members', keeps: 'a members-only colourway' },
    { kind: 'discount', catches: 'the summer sale ends soon', keeps: 'holds its resale value' },
    { kind: 'discount', catches: 'half off this week', keeps: 'half the weight of the old model' },
    {
      kind: 'discount',
      catches: 'save 20 off the pair',
      keeps: 'saves 200 g off the base weight',
      supports: ['200 g'],
    },
    {
      kind: 'discount',
      catches: 'on clearance until the end of the month',
      keeps: 'extra clearance for thick socks',
      droppedLater: 'wording',
    },
    {
      kind: 'discount',
      catches: 'reduced this week',
      keeps: 'reduced to 900g without losing warmth',
      supports: ['900g'],
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
    {
      kind: 'stock',
      catches: 'only two left in your size',
      keeps: 'two left-hand pockets for keys',
    },
    { kind: 'stock', catches: 'selling fast in your size', keeps: 'nearly weightless in the hand' },
  ];

  for (const row of ONE_ROW_PER_CLAIM_PATTERN) {
    const verb = row.droppedLater === undefined ? 'keeps' : `leaves "${row.droppedLater}"`;

    it(`drops "${row.catches}" and ${verb} "${row.keeps}"`, () => {
      const overrides =
        row.supports === undefined
          ? {}
          : { candidates: [product('TR-101', { tags: row.supports }), product('TR-102')] };

      const dropped = reconcile(grid([ref('TR-101', { reason: row.catches })]), overrides);
      const kept = reconcile(grid([ref('TR-101', { reason: row.keeps })]), overrides);

      expect(dropped.violations).toContain(`unverifiable-claim:${row.kind}:reason:TR-101`);
      expect(kept.violations).toEqual(
        row.droppedLater === undefined
          ? []
          : [`unverifiable-claim:${row.droppedLater}:reason:TR-101`],
      );
    });
  }

  const EVERY_SPELLING: { kind: string; catches: string; supports?: string[] }[] = [
    { kind: 'rating', catches: 'our number one seller last winter' },
    { kind: 'rating', catches: 'our no.1 seller last winter' },
    { kind: 'rating', catches: 'our no. 1 seller last winter' },
    { kind: 'rating', catches: 'our no 1 seller last winter' },
    { kind: 'rating', catches: 'our #1 seller last winter' },
    { kind: 'rating', catches: 'our # 1 seller last winter' },
    { kind: 'rating', catches: 'the #1 selling pack' },
    { kind: 'rating', catches: 'it scores 4.8 out of five with other hikers', supports: ['4.8'] },
    { kind: 'rating', catches: 'a rating of 5.0 from other hikers', supports: ['5.0'] },
    { kind: 'rating', catches: 'the best-rated pack we carry' },
    { kind: 'price', catches: 'yours today for thirty-nine dollars' },
    { kind: 'price', catches: 'thirty-nine euros and it is yours' },
    { kind: 'price', catches: 'our pricing on this one just changed' },
    { kind: 'discount', catches: 'a 20% reduction this week', supports: ['20'] },
    { kind: 'delivery', catches: 'order now and get it by saturday' },
    { kind: 'stock', catches: 'low on stock in your size' },
    { kind: 'stock', catches: 'out of stock in your size' },
    { kind: 'stock', catches: 'a couple left in your size' },
    { kind: 'stock', catches: 'a handful left in your size' },
  ];

  for (const row of EVERY_SPELLING) {
    it(`reads "${row.catches}" as a ${row.kind} claim`, () => {
      const overrides =
        row.supports === undefined
          ? {}
          : { candidates: [product('TR-101', { tags: row.supports }), product('TR-102')] };

      const result = reconcile(grid([ref('TR-101', { reason: row.catches })]), overrides);

      expect(result.violations).toContain(`unverifiable-claim:${row.kind}:reason:TR-101`);
    });
  }

  const OVER_REACHES = [
    'the number one selling point is the hood',
    'the #1 selling point is the hood',
  ];

  for (const reason of OVER_REACHES) {
    it(`reads too much into "${reason}"`, () => {
      const result = reconcile(grid([ref('TR-101', { reason })]));

      expect(result.violations).toContain('unverifiable-claim:rating:reason:TR-101');
    });
  }

  const NOT_A_SELLER_CLAIM = ['a reseller of gear', 'resell it later', 'selling fast in your size'];

  for (const reason of NOT_A_SELLER_CLAIM) {
    it(`is no rating claim: "${reason}"`, () => {
      const result = reconcile(grid([ref('TR-101', { reason })]));

      expect(result.violations).not.toContain('unverifiable-claim:rating:reason:TR-101');
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

describe('a claim spelled in characters the patterns do not expect', () => {
  const reasonFor = (text: string): string | null | undefined =>
    basisOf(reconcile(grid([ref('TR-101', { reason: text })])))?.reason;

  const disguisedKindFor = (text: string): string | null => {
    const result = reconcile(grid([ref('TR-101', { reason: text })]));
    const violation = result.violations.find((entry) => entry.startsWith('unverifiable-claim:'));
    return violation ? (violation.split(':')[1] ?? null) : null;
  };

  const DISGUISED_STOCK: { hidden: string; reason: string }[] = [
    { hidden: 'a zero-width space', reason: 'in st\u200Bock in your size' },
    { hidden: 'a variation selector', reason: 'in st\uFE0Fock in your size' },
    { hidden: 'a soft hyphen', reason: 'in st\u00ADock in your size' },
    { hidden: 'a Cyrillic look-alike', reason: 'in st\u043Eck in your size' },
    { hidden: 'a lunate sigma', reason: 'in sto\u03F2k in your size' },
    { hidden: 'a capital lunate sigma', reason: 'IN STO\u03F9K in your size' },
    { hidden: 'a Greek capital nu', reason: 'I\u039D STOCK in your size' },
    { hidden: 'a mathematical capital nu', reason: 'I\u{1D6B4} STOCK in your size' },
    { hidden: 'a palochka for an l', reason: 'se\u04C0\u04C0ing fast in your size' },
    { hidden: 'a blank-rendering Hangul letter', reason: 'in st\u3164ock in your size' },
    { hidden: 'a combining mark', reason: 'in sto\u0305ck in your size' },
    { hidden: 'a control character', reason: 'in st\u0008ock in your size' },
    { hidden: 'an Arabic format character', reason: 'in st\u0600ock in your size' },
    {
      hidden: 'fullwidth letters',
      reason: '\uFF29\uFF2E \uFF33\uFF34\uFF2F\uFF23\uFF2B in your size',
    },
  ];

  for (const row of DISGUISED_STOCK) {
    it(`drops a stock claim hidden behind ${row.hidden}`, () => {
      expect(disguisedKindFor(row.reason)).toBe('stock');
    });
  }

  it('drops a discount claim hidden behind a Greek look-alike', () => {
    expect(reasonFor('20% \u03BFff for the rest of the week')).toBeNull();
  });

  it('drops a price claim hidden behind a Cyrillic er', () => {
    expect(disguisedKindFor('a great \u0440rice for the pair')).toBe('price');
  });

  it('drops a delivery claim hidden behind a Cyrillic o', () => {
    expect(disguisedKindFor('in your hands \u043Evernight')).toBe('delivery');
  });

  it('drops a price claim hidden behind a double-struck capital', () => {
    expect(disguisedKindFor('\u2119RICED to move')).toBe('price');
  });

  it('drops a rating claim hidden behind a numero sign', () => {
    expect(disguisedKindFor('\u21161 seller in your size')).toBe('rating');
  });

  it('drops a price claim hidden behind a Turkish dotted capital I', () => {
    expect(reasonFor('PR\u0130CED to move')).toBeNull();
  });

  it('renders honest copy exactly as the model wrote it', () => {
    const reason = '\uFF33uper light for long days';

    expect(reasonFor(reason)).toBe(reason);
  });
});

describe('the two passes attested adds', () => {
  const reasonFor = (text: string): string | null | undefined =>
    basisOf(reconcile(grid([ref('TR-101', { reason: text })])))?.reason;

  const kindFor = (text: string, overrides: Partial<TrackingInputDraft> = {}): string | null => {
    const result = reconcile(grid([ref('TR-101', { reason: text })]), overrides);
    const violation = result.violations.find((entry) => entry.startsWith('unverifiable-claim:'));
    return violation ? (violation.split(':')[1] ?? null) : null;
  };

  it.each([
    ['stock', 'in stock in your size'],
    ['rating', 'highly rated by other hikers'],
    ['discount', 'half off this week'],
    ['price', 'was 120, now 80'],
  ])('still names a %s claim by its kind', (kind, text) => {
    expect(kindFor(text)).toBe(kind);
  });

  it('drops the rationale the model really wrote', () => {
    const rationale =
      'Only signals available are the PDP category (Backpacks) and a lapsed segment with no ' +
      'view/purchase/cart history, so I kept it to a single ordered grid of the highest-rated ' +
      'in-category candidates plus a brief orienting copy block.';
    const result = reconcile({ ...specWith([PRODUCT_GRID]), rationale });

    expect(result.spec.rationale).toBe('');
    expect(result.violations).toContain('unverifiable-claim:wording:rationale');
  });

  const WORDING = [
    'the highest-rated pack in the category',
    'rated highest by other hikers',
    'our most popular pack this season',
    'a customer favourite in Backpacks',
    'great value for a winter pack',
    'free postage on this one',
    'going quick in your size',
    'flying off the shelves this week',
    'hurry, this one moves fast',
    'the top pick for winter nights',
  ];

  for (const reason of WORDING) {
    it(`drops wording with nothing to check: "${reason}"`, () => {
      expect(kindFor(reason)).toBe('wording');
    });
  }

  const QUANTITIES = [
    'yours today for 39',
    'now 45',
    'down from 80 to 60',
    '4.8 from other hikers',
    'scored 4.8 by buyers',
    'take 15 off the second one',
    'backed by 1,200 buyers',
    'under 50 for the pair',
  ];

  for (const reason of QUANTITIES) {
    it(`drops a number the shop never supplied: "${reason}"`, () => {
      expect(kindFor(reason)).toBe('quantity');
    });
  }

  it('names a sentence both passes reject by its quantity', () => {
    expect(kindFor('rated highest by other hikers, 4.8 overall')).toBe('quantity');
  });

  it('keeps a category name the shop chose, digit and all', () => {
    const overrides = {
      candidates: [product('TN-1', { category: '3-Season Tents' })],
      context: { surface: 'pdp', currentCategory: '3-Season Tents' },
    };
    const result = reconcile(
      grid([ref('TN-1', { basis: 'similar_to_current', reason: 'More in 3-Season Tents' })]),
      overrides,
    );
    const [block] = result.spec.blocks;
    if (block?.kind !== 'grid') throw new Error('expected a grid');

    expect(block.items[0]?.reason).toBe('More in 3-Season Tents');
    expect(result.violations).toEqual([]);
  });

  it('stands behind no category the shopper is browsing', () => {
    const headline = 'A step up from the 3-Season Tents you were looking at';
    const result = reconcile(
      { ...specWith([PRODUCT_GRID]), headline },
      { context: { surface: 'pdp', currentCategory: '3-Season Tents' } },
    );

    expect(result.spec.headline).toBe('');
    expect(result.violations).toContain('unverifiable-claim:quantity:headline');
  });

  it('stands behind no number a browsed category carries', () => {
    const result = reconcile(
      { ...specWith([PRODUCT_GRID]), headline: 'Scored 4.8 by buyers' },
      { context: { surface: 'pdp', currentCategory: '4.8' } },
    );

    expect(result.spec.headline).toBe('');
    expect(result.violations).toContain('unverifiable-claim:quantity:headline');
  });

  const headlineOn = (headline: string, overrides: Partial<TrackingInputDraft>) =>
    reconcile({ ...specWith([PRODUCT_GRID]), headline }, overrides);

  it('stands behind no tag on a candidate that is out of stock', () => {
    const result = headlineOn('4.8 from other hikers', {
      candidates: [product('TR-101'), product('TR-102', { isInStock: false, tags: ['4.8 rated'] })],
    });

    expect(result.spec.headline).toBe('');
    expect(result.violations).toContain('unverifiable-claim:quantity:headline');
  });

  const overflowing = (tagged: number) => {
    const many = [product('TR-101')];
    for (let index = 1; index < 120; index += 1) {
      many.push(product(`TR-${500 + index}`, index === tagged ? { tags: ['39 litre'] } : {}));
    }
    return many;
  };

  it('stands behind no tag on a candidate past the prompt cap', () => {
    const result = headlineOn('a 39 litre pack for long days', { candidates: overflowing(100) });

    expect(result.spec.headline).toBe('');
    expect(result.violations).toContain('unverifiable-claim:quantity:headline');
  });

  it('stands behind a tag on the last candidate the prompt shows', () => {
    const result = headlineOn('a 39 litre pack for long days', { candidates: overflowing(59) });

    expect(result.spec.headline).toBe('a 39 litre pack for long days');
    expect(result.violations).toEqual([]);
  });

  it.each([
    ['badge', 'Only 2'],
    ['badge', '40 off'],
    ['badge', 'Just 2 in your size'],
    ['reason', 'Sleeps 2 with room to spare'],
  ] as const)('reads a %s about one product against that product: "%s"', (field, text) => {
    const elsewhere = reconcile(grid([ref('TR-101', { [field]: text })]), {
      candidates: [product('TR-101'), product('TR-102', { tags: ['2 person', '40 litre'] })],
    });
    expect(basisOf(elsewhere)?.[field]).toBeNull();
    expect(elsewhere.violations).toContain(`unverifiable-claim:quantity:${field}:TR-101`);

    const own = reconcile(grid([ref('TR-101', { [field]: text })]), {
      candidates: [product('TR-101', { tags: ['2 person', '40 litre'] }), product('TR-102')],
    });
    expect(own.violations).toEqual([]);
  });

  it('stands behind nothing on a candidate past the cap the model placed anyway', () => {
    const result = reconcile(
      grid([ref('TR-600', { reason: 'a 39 litre pack for long days', badge: '39 litre' })]),
      { candidates: overflowing(100) },
    );

    expect(placedSkus(result.spec.blocks)).toEqual(['TR-600']);
    expect(basisOf(result)?.reason).toBeNull();
    expect(basisOf(result)?.badge).toBeNull();
    expect(result.violations).toContain('unverifiable-claim:quantity:reason:TR-600');
    expect(result.violations).toContain('unverifiable-claim:quantity:badge:TR-600');
  });

  it('stands behind the tag of the last candidate the prompt shows, in a field naming it', () => {
    const result = reconcile(grid([ref('TR-559', { reason: 'a 39 litre pack for long days' })]), {
      candidates: overflowing(59),
    });

    expect(basisOf(result)?.reason).toBe('a 39 litre pack for long days');
    expect(result.violations).toEqual([]);
  });

  const ABSURD = '1e2000000000';

  it('renders the rest of that candidate normally', () => {
    const result = reconcile(
      grid([ref('TR-101', { reason: 'rated 3 season for shoulder-season trips' })]),
      { candidates: [product('TR-101', { tags: [ABSURD, '3 season'] }), product('TR-102')] },
    );

    expect(basisOf(result)?.reason).toBe('rated 3 season for shoulder-season trips');
    expect(result.violations).toEqual([]);
  });

  it('stands behind no rating, even one the model was shown', () => {
    const result = reconcile(grid([ref('TR-101', { reason: 'Yours for 4.9' })]), {
      candidates: [product('TR-101', { rating: 4.9 }), product('TR-102')],
    });

    expect(basisOf(result)?.reason).toBeNull();
    expect(result.violations).toContain('unverifiable-claim:quantity:reason:TR-101');
  });

  it.each([
    ['a number core reads as a specification', 'Made to a 20,000mm waterproof rating'],
    ['wording only a denylist reaches', 'A customer favourite in our Fulham store'],
  ])("leaves the shop's own reason alone: %s", (_why, claim) => {
    const candidates = [product('TR-101', { reason: claim }), product('TR-102')];

    const kept = reconcile(
      grid([ref('TR-101', { reason: claim })]),
      { candidates },
      new Map([['TR-101', claim]]),
    );
    expect(basisOf(kept)?.reason).toBe(claim);
    expect(kept.violations).toEqual([]);

    const screened = reconcile(grid([ref('TR-101', { reason: claim })]), { candidates });
    expect(basisOf(screened)?.reason).toBeNull();
  });

  it.each(['More in Clearance', 'Popular in Last Chance', 'More in Popular Picks'])(
    "leaves the selector's own sentence alone: %s",
    (reason) => {
      const kept = reconcile(grid([ref('TR-101', { reason })]), {}, new Map([['TR-101', reason]]));

      expect(basisOf(kept)?.reason).toBe(reason);
      expect(kept.violations).toEqual([]);

      expect(kindFor(reason)).toBe('wording');
    },
  );

  it('reads digits, not words', () => {
    const spelled = "Four packs, ordered by how well they've held up";
    const digits = "4 packs, ordered by how well they've held up";

    expect(reasonFor(spelled)).toBe(spelled);
    expect(kindFor(digits)).toBe('quantity');
  });

  const TAKES_NO_ROOM = '';
  const DRAWS_A_BOX = '';

  it('reads through a character that takes no room, and not through one that does', () => {
    expect(kindFor(`in st${TAKES_NO_ROOM}ock in your size`)).toBe('stock');
    expect(kindFor(`in st${DRAWS_A_BOX}ock in your size`)).toBeNull();
  });

  it('reads through a zero-width space inside a claim word', () => {
    expect(kindFor('20% o\u200Bff this week')).toBe('discount');
  });

  it.each(['Built for wet rock and long days', 'Chosen for the way it carries'])(
    'has nothing for the quantity layer to weigh: %s',
    (text) => {
      const bare = verify(text, { values: [] });

      expect(bare.quantity.checked).toBe(0);
      expect(verify(text, { values: ['20,000mm', '4.8', '-5C'] }).quantity).toEqual(bare.quantity);
    },
  );

  it.each(['A ½-zip fleece for cold starts', 'Sized for a 10K on the trails'])(
    'drops a numeral it cannot read rather than waving it through: %s',
    (reason) => {
      expect(kindFor(reason)).toBe('quantity');
    },
  );

  it('keeps every allowed phrase pointed at something attested bans', () => {
    for (const allowed of ALLOWED_PHRASES) {
      expect(BANNED_PHRASES.some((banned) => allowed.includes(banned))).toBe(true);
    }
  });

  it('ends every allowed phrase on a word that finishes the thought', () => {
    const dangling = ['for', 'on', 'in', 'at', 'to', 'of', 'with', 'from', 'a', 'an', 'the'];

    for (const allowed of ALLOWED_PHRASES) {
      expect(dangling).not.toContain(allowed.split(' ').pop());
    }
  });

  it('forgives nothing past the words it allows', () => {
    expect(reasonFor('It does not feel cheap')).toBe('It does not feel cheap');
    expect(kindFor('It does not feel cheap, and the cheap one is on sale')).toBe('discount');
  });

  it('reads one field at a time, so a claim split over two gets through', () => {
    const split = reconcile({
      ...specWith([PRODUCT_GRID]),
      headline: 'Our best',
      subheadline: 'seller three years running',
    });

    expect(split.spec.headline).toBe('Our best');
    expect(split.spec.subheadline).toBe('seller three years running');
    expect(split.violations).toEqual([]);

    const whole = reconcile({
      ...specWith([PRODUCT_GRID]),
      headline: 'Our best seller three years running',
    });
    expect(whole.violations).toContain('unverifiable-claim:rating:headline');
  });

  const REWORDINGS_THAT_STILL_PASS = [
    'four and a half stars from other hikers',
    'it will not hurt your wallet',
    'we are down to what is left of this run',
    'grab it before someone else does',
    'the one other walkers keep coming back for',
    'on your doorstep quicker than you would think',
    'worth every penny you will spend on it',
    'moving quicker than we can restock it',
  ];

  for (const reason of REWORDINGS_THAT_STILL_PASS) {
    it(`a rewording still gets past all three passes: "${reason}"`, () => {
      expect(reasonFor(reason)).toBe(reason);
    });
  }
});

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

describe('a claim the cap cuts in half', () => {
  const TAGGED = {
    candidates: [product('TR-101', { tags: ['2 person', '3 season'] }), product('TR-102')],
  };

  it('drops a badge whose "left" fell outside the cap', () => {
    const result = reconcile(grid([ref('TR-101', { badge: 'Ridge picks, only 2 left!' })]), TAGGED);

    expect(basisOf(result)?.badge).toBeNull();
    expect(result.violations).toContain('unverifiable-claim:stock:badge:TR-101');
  });

  it('drops a reason whose discount fell outside the cap', () => {
    const result = reconcile(
      grid([
        ref('TR-101', { reason: `${'a steady pick for damp nights '.repeat(4)}and it is 30% off` }),
      ]),
      TAGGED,
    );

    expect(basisOf(result)?.reason).toBeNull();
    expect(result.violations).toContain('unverifiable-claim:discount:reason:TR-101');
  });

  it('drops a headline whose price fell outside the cap', () => {
    const result = reconcile(
      {
        ...specWith([PRODUCT_GRID]),
        headline: `${'ready for the shoulder season '.repeat(3)}and it was 50 now 30`,
      },
      TAGGED,
    );

    expect(result.spec.headline).toBe('');
    expect(result.violations).toContain('unverifiable-claim:price:headline');
  });

  it('drops a banner whose claim only appears once the spaces are collapsed', () => {
    const result = reconcile(
      specWith([{ kind: 'banner', tone: 'info', text: 'Back  in   stock', ctaLabel: null }]),
      TAGGED,
    );

    expect(result.spec.blocks).toHaveLength(0);
    expect(result.violations).toContain('unverifiable-claim:stock:banner-text');
  });

  it('still truncates honest copy rather than dropping it', () => {
    const honest = `${'a steady pick for damp nights '.repeat(4)}and it packs down small`;
    const result = reconcile(grid([ref('TR-101', { reason: honest })]), TAGGED);

    const kept = basisOf(result)?.reason ?? '';
    expect(kept.endsWith('…')).toBe(true);
    expect(honest.startsWith(kept.slice(0, -1))).toBe(true);
    expect(result.violations).toEqual([]);
  });
});

describe('ordinary copy in the fields now screened', () => {
  const SPECIFICATIONS: { text: string; tags: string[] }[] = [
    { text: 'made from 100% recycled nylon', tags: ['100% recycled'] },
    { text: 'a comfort rating of -5C', tags: ['-5C comfort'] },
    { text: 'arrives flat-packed', tags: [] },
  ];

  for (const row of SPECIFICATIONS) {
    const overrides = { candidates: [product('TR-101', { tags: row.tags }), product('TR-102')] };

    it(`keeps it in a headline: "${row.text}"`, () => {
      const result = reconcile({ ...specWith([PRODUCT_GRID]), headline: row.text }, overrides);

      expect(result.spec.headline).toBe(row.text);
      expect(result.violations).toEqual([]);
    });

    it(`keeps it in a banner: "${row.text}"`, () => {
      const result = reconcile(
        specWith([{ kind: 'banner', tone: 'info', text: row.text, ctaLabel: null }, PRODUCT_GRID]),
        overrides,
      );

      expect(result.spec.blocks[0]).toMatchObject({ kind: 'banner', text: row.text });
      expect(result.violations).toEqual([]);
    });
  }
});
