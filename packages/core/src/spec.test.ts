import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BANNER_TONES,
  EMPHASIS,
  TONES,
  blockSchema,
  generatedSpecSchema,
  productRefSchema,
  safeParseGeneratedSpec,
  type Block,
  type GeneratedSpec,
} from './spec.js';

const productRef = {
  sku: 'TR-102',
  reason: 'Pairs with the boots you bought',
  badge: null,
  emphasis: 'normal',
};

const spec = (blocks: unknown[]): unknown => ({
  tone: 'neutral',
  headline: 'Back to the trail',
  subheadline: null,
  blocks,
  rationale: 'Leaned on the repeated views of the hydration vest.',
});

describe('generatedSpecSchema', () => {
  it('accepts a minimal spec with no blocks at all', () => {
    expect(safeParseGeneratedSpec(spec([])).success).toBe(true);
  });

  it('accepts every block kind', () => {
    const everyKind = [
      { kind: 'hero', headline: 'Trail season', body: null, sku: 'TR-102', ctaLabel: null },
      { kind: 'grid', title: 'For you', columns: 3, items: [productRef] },
      { kind: 'carousel', title: null, items: [productRef] },
      { kind: 'banner', tone: 'info', text: 'Free returns', ctaLabel: null },
      { kind: 'copy', title: null, body: 'Built for wet rock.' },
    ];

    expect(safeParseGeneratedSpec(spec(everyKind)).success).toBe(true);
  });

  it('rejects a block kind outside the vocabulary', () => {
    expect(safeParseGeneratedSpec(spec([{ kind: 'iframe', src: 'https://evil' }])).success).toBe(
      false,
    );
  });

  it('rejects a grid width the renderer has no layout for', () => {
    const grid = (columns: number) => spec([{ kind: 'grid', title: null, columns, items: [] }]);

    expect(safeParseGeneratedSpec(grid(3)).success).toBe(true);
    expect(safeParseGeneratedSpec(grid(5)).success).toBe(false);
    expect(safeParseGeneratedSpec(grid(1)).success).toBe(false);
  });

  it.each([...TONES])('accepts the tone %s', (tone) => {
    expect(safeParseGeneratedSpec({ ...(spec([]) as object), tone }).success).toBe(true);
  });

  it('rejects a tone outside the enum', () => {
    expect(safeParseGeneratedSpec({ ...(spec([]) as object), tone: 'shouty' }).success).toBe(false);
  });

  it.each([...BANNER_TONES])('accepts the banner tone %s', (tone) => {
    const banner = spec([{ kind: 'banner', tone, text: 'Free returns', ctaLabel: null }]);

    expect(safeParseGeneratedSpec(banner).success).toBe(true);
  });

  it.each([...EMPHASIS])('accepts the emphasis %s', (emphasis) => {
    const grid = spec([
      { kind: 'grid', title: null, columns: 2, items: [{ ...productRef, emphasis }] },
    ]);

    expect(safeParseGeneratedSpec(grid).success).toBe(true);
  });
});

/**
 * The model cannot express anything the renderer would have to trust. These are
 * the fields it is structurally unable to send, which is the whole security
 * argument for a spec instead of generated markup.
 */
describe('what the model cannot say', () => {
  it.each([
    ['a price', { price: 99 }],
    ['a product title', { title: 'Switchback Trail Shoe' }],
    ['an image', { imageUrl: 'https://evil.example.com/x.png' }],
    ['a link', { href: 'javascript:alert(1)' }],
  ])('discards %s smuggled onto a product reference', (_label, extra) => {
    // Stripped rather than rejected: a stray key from a model is drift, and
    // failing the whole generation over it would cost the shopper the
    // component. What matters is that it cannot reach the renderer.
    const parsed = productRefSchema.parse({ ...productRef, ...extra });

    expect(Object.keys(parsed).toSorted()).toEqual(['badge', 'emphasis', 'reason', 'sku']);
    for (const key of Object.keys(extra)) {
      expect(parsed).not.toHaveProperty(key);
    }
  });

  it('rejects markup smuggled in as a block', () => {
    expect(safeParseGeneratedSpec(spec(['<script>alert(1)</script>'])).success).toBe(false);
  });

  it('keeps free text as text, so escaping is the renderer’s only job', () => {
    const parsed = generatedSpecSchema.parse(
      spec([{ kind: 'copy', title: null, body: '<b>bold</b>' }]),
    );
    const [block] = parsed.blocks as [Block];

    // Stored verbatim and typed as a string. Nothing here interprets it.
    expect(block).toEqual({ kind: 'copy', title: null, body: '<b>bold</b>' });
  });
});

/**
 * This schema is sent to providers as a structured-output JSON Schema. Strict
 * mode rejects string length bounds and numeric ranges, and requires every
 * declared property to be present — which is why optionality is expressed as
 * `.nullable()` throughout. Both constraints are pinned here rather than left
 * to a comment.
 */
describe('provider structured-output compatibility', () => {
  const jsonSchema = z.toJSONSchema(generatedSpecSchema, { io: 'output' });
  const serialised = JSON.stringify(jsonSchema);

  it('converts to JSON Schema at all', () => {
    expect(jsonSchema).toBeTypeOf('object');
  });

  it.each(['minLength', 'maxLength', 'minimum', 'maximum', 'pattern', 'format'])(
    'uses no %s, which strict structured outputs reject',
    (keyword) => {
      expect(serialised).not.toContain(`"${keyword}"`);
    },
  );

  it('declares every property of a product reference as required', () => {
    const parsed = JSON.parse(serialised) as Record<string, unknown>;
    const refSchema = z.toJSONSchema(productRefSchema, { io: 'output' }) as {
      properties: Record<string, unknown>;
      required?: string[];
    };

    expect(refSchema.required?.toSorted()).toEqual(Object.keys(refSchema.properties).toSorted());
    expect(parsed).toBeTypeOf('object');
  });

  it('expresses absence as null rather than as a missing key', () => {
    const withoutBadge = { sku: 'TR-102', reason: 'Goes with your cart', emphasis: 'normal' };

    expect(productRefSchema.safeParse(withoutBadge).success).toBe(false);
    expect(productRefSchema.safeParse({ ...withoutBadge, badge: null }).success).toBe(true);
  });

  it('has no recursion, so the block union stays flat', () => {
    expect(serialised).not.toContain('"$ref": "#"');
  });
});

describe('type surface', () => {
  it('narrows a block by its discriminant', () => {
    const parsed: GeneratedSpec = generatedSpecSchema.parse(
      spec([{ kind: 'grid', title: 'For you', columns: 4, items: [productRef] }]),
    );
    const [block] = parsed.blocks;

    // The discriminated union is what lets the renderer switch without casting.
    if (block?.kind !== 'grid') throw new Error('expected a grid block');
    expect(block.columns).toBe(4);
    expect(block.items[0]?.sku).toBe('TR-102');
  });

  it('parses a block on its own, not only inside a spec', () => {
    expect(blockSchema.safeParse({ kind: 'copy', title: null, body: 'Hello' }).success).toBe(true);
  });
});
