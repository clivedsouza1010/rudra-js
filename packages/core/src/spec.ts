import { z } from 'zod';

/**
 * The UI spec contract — the only thing an LLM is ever allowed to return.
 *
 * The model chooses layout, ordering, copy, emphasis and which products to
 * surface. It never returns markup, product data, URLs, or code. Every field is
 * either an enum, a bounded number, a SKU reference resolved against the
 * candidate set, or free text that is length-clamped and escaped at render
 * time. That is what makes a generated component safe to embed in the SSR
 * payload.
 *
 * Design constraint: this schema is also sent to providers as a structured-output
 * JSON Schema, so it deliberately avoids recursion, `minLength`/`maxLength`, and
 * numeric ranges — none of which are supported by strict structured outputs.
 * Bounds are enforced in `reconcile.ts` instead. Optionality is expressed as
 * `.nullable()` rather than `.optional()` for the same reason: strict mode
 * requires every property to be present.
 */

export const TONES = ['neutral', 'enthusiastic', 'urgent', 'editorial'] as const;
export const BANNER_TONES = ['info', 'promo', 'urgency', 'restock'] as const;
export const EMPHASIS = ['normal', 'featured'] as const;

/** A reference to one product from the candidate set, plus why it was chosen. */
export const productRefSchema = z.object({
  /** Must be a SKU present in `TrackingInput.candidates`. */
  sku: z.string(),
  /** Short user-facing justification, e.g. "Pairs with the boots you bought". */
  reason: z.string(),
  /** Optional short badge, e.g. "Back in stock". Null when not warranted. */
  badge: z.string().nullable(),
  emphasis: z.enum(EMPHASIS),
});
export type ProductRef = z.infer<typeof productRefSchema>;

const heroBlockSchema = z.object({
  kind: z.literal('hero'),
  headline: z.string(),
  body: z.string().nullable(),
  /** Optional SKU to feature large. Must be in the candidate set. */
  sku: z.string().nullable(),
  ctaLabel: z.string().nullable(),
});

const gridBlockSchema = z.object({
  kind: z.literal('grid'),
  title: z.string().nullable(),
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  items: z.array(productRefSchema),
});

const carouselBlockSchema = z.object({
  kind: z.literal('carousel'),
  title: z.string().nullable(),
  items: z.array(productRefSchema),
});

const bannerBlockSchema = z.object({
  kind: z.literal('banner'),
  tone: z.enum(BANNER_TONES),
  text: z.string(),
  ctaLabel: z.string().nullable(),
});

const copyBlockSchema = z.object({
  kind: z.literal('copy'),
  title: z.string().nullable(),
  body: z.string(),
});

export const blockSchema = z.discriminatedUnion('kind', [
  heroBlockSchema,
  gridBlockSchema,
  carouselBlockSchema,
  bannerBlockSchema,
  copyBlockSchema,
]);
export type Block = z.infer<typeof blockSchema>;
export type BlockKind = Block['kind'];

export type HeroBlock = z.infer<typeof heroBlockSchema>;
export type GridBlock = z.infer<typeof gridBlockSchema>;
export type CarouselBlock = z.infer<typeof carouselBlockSchema>;
export type BannerBlock = z.infer<typeof bannerBlockSchema>;
export type CopyBlock = z.infer<typeof copyBlockSchema>;

/**
 * Exactly what the model must return. Server-owned metadata (spec version,
 * slot, provenance, latency) is added afterwards and is deliberately not part
 * of the model's burden.
 */
export const generatedSpecSchema = z.object({
  tone: z.enum(TONES),
  headline: z.string(),
  subheadline: z.string().nullable(),
  blocks: z.array(blockSchema),
  /**
   * One sentence on why this arrangement was chosen. Not rendered by default —
   * it exists so generations can be logged and evaluated offline.
   */
  rationale: z.string(),
});
export type GeneratedSpec = z.infer<typeof generatedSpecSchema>;

/** How a spec came to exist. Surfaced for benchmarking and observability. */
export type SpecSource = 'llm' | 'cache' | 'fallback';

/** A generated spec plus server-owned provenance. This is what gets rendered. */
export interface ComponentSpec extends GeneratedSpec {
  specVersion: '1';
  slot: string;
  source: SpecSource;
  /** Epoch milliseconds at which the underlying generation completed. */
  generatedAt: number;
  /** Wall-clock milliseconds spent in `generate()`, including cache lookup. */
  latencyMs: number;
  /** Provider name, or null for fallback specs. */
  provider: string | null;
  /** Model identifier, or null for fallback specs. */
  model: string | null;
  /** Set when the LLM path was attempted and did not produce a usable spec. */
  degradedReason?: string;
}

export const SPEC_VERSION = '1' as const;
