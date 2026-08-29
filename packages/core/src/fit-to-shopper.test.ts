import { describe, expect, it } from 'vitest';
import type { GeneratedSpec } from './component-spec.js';
import type { ProductPick } from './product-selection.js';
import { fitToShopper } from './fit-to-shopper.js';

const pick = (sku: string, basis: ProductPick['basis'] = 'popular'): ProductPick => ({
  product: {
    sku,
    title: `Product ${sku}`,
    category: 'Backpacks',
    price: 100,
    currency: 'USD',
    isInStock: true,
    tags: [],
  },
  basis,
  reason: `chosen because ${basis}`,
  score: 1,
});

/** What the model wrote, about a product this shopper may never see. */
const modelItem = () => ({
  sku: 'MODEL-1',
  basis: 'complements_cart' as const,
  reason: "goes with what's in your cart",
  badge: 'Staff pick',
  emphasis: 'featured' as const,
});

const spec = (blocks: GeneratedSpec['blocks']): GeneratedSpec => ({
  tone: 'neutral',
  headline: 'Picked for you',
  subheadline: null,
  blocks,
  rationale: 'test',
});

const grid = (count: number): GeneratedSpec['blocks'] => [
  { kind: 'grid', title: 'For you', columns: 3, items: Array.from({ length: count }, modelItem) },
];

describe('fitting a shared component to one shopper', () => {
  it('takes the product and the claim from the pick, not from the model', () => {
    const fitted = fitToShopper(spec(grid(1)), [pick('PICK-1', 'liked_category')], 4);

    const block = fitted.blocks[0]!;
    if (block.kind !== 'grid') throw new Error('expected a grid');
    expect(block.items[0]).toEqual({
      sku: 'PICK-1',
      basis: 'liked_category',
      reason: 'chosen because liked_category',
      badge: null,
      emphasis: 'featured',
    });
  });

  it('keeps the layout the model chose', () => {
    const fitted = fitToShopper(spec(grid(1)), [pick('PICK-1')], 4);

    const block = fitted.blocks[0]!;
    if (block.kind !== 'grid') throw new Error('expected a grid');
    expect(block.title).toBe('For you');
    expect(block.columns).toBe(3);
  });

  it('shrinks a block rather than padding it', () => {
    const fitted = fitToShopper(spec(grid(3)), [pick('PICK-1')], 4);

    const block = fitted.blocks[0]!;
    if (block.kind !== 'grid') throw new Error('expected a grid');
    expect(block.items).toHaveLength(1);
  });

  it('gives each slot a different product, in order', () => {
    const fitted = fitToShopper(
      spec([...grid(2), { kind: 'carousel', title: null, items: [modelItem()] }]),
      [pick('PICK-1'), pick('PICK-2'), pick('PICK-3')],
      4,
    );

    const first = fitted.blocks[0]!;
    const second = fitted.blocks[1]!;
    if (first.kind !== 'grid' || second.kind !== 'carousel') throw new Error('wrong blocks');
    expect(first.items.map((item) => item.sku)).toEqual(['PICK-1', 'PICK-2']);
    expect(second.items.map((item) => item.sku)).toEqual(['PICK-3']);
  });

  it('stops at maxItems', () => {
    const fitted = fitToShopper(spec(grid(3)), [pick('P1'), pick('P2'), pick('P3')], 2);

    const block = fitted.blocks[0]!;
    if (block.kind !== 'grid') throw new Error('expected a grid');
    expect(block.items).toHaveLength(2);
  });

  it('anchors a hero to a pick', () => {
    const fitted = fitToShopper(
      spec([
        { kind: 'hero', headline: 'Trail season', body: null, sku: 'MODEL-1', ctaLabel: 'Shop' },
      ]),
      [pick('PICK-1')],
      4,
    );

    const block = fitted.blocks[0]!;
    if (block.kind !== 'hero') throw new Error('expected a hero');
    expect(block.sku).toBe('PICK-1');
  });

  it('keeps a hero with nothing left to point at, minus the link', () => {
    const fitted = fitToShopper(
      spec([
        { kind: 'hero', headline: 'Trail season', body: null, sku: 'MODEL-1', ctaLabel: 'Shop' },
      ]),
      [],
      4,
    );

    const block = fitted.blocks[0]!;
    if (block.kind !== 'hero') throw new Error('expected a hero');
    expect(block.headline).toBe('Trail season');
    expect(block.sku).toBeNull();
  });

  it('leaves blocks that name no product alone', () => {
    const blocks: GeneratedSpec['blocks'] = [
      { kind: 'banner', tone: 'promo', text: 'Free returns', ctaLabel: null },
      { kind: 'copy', title: 'Why these', body: 'Built for wet rock.' },
    ];

    expect(fitToShopper(spec(blocks), [], 4).blocks).toEqual(blocks);
  });

  it('keeps the headline and tone the model wrote', () => {
    const fitted = fitToShopper(spec(grid(1)), [pick('PICK-1')], 4);

    expect(fitted.headline).toBe('Picked for you');
    expect(fitted.tone).toBe('neutral');
  });
});
