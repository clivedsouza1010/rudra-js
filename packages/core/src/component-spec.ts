import { z } from 'zod';

export const TONES = ['neutral', 'enthusiastic', 'urgent', 'editorial'] as const;

export const BANNER_TONES = ['info', 'promo', 'urgency', 'restock'] as const;

export const EMPHASIS = ['normal', 'featured'] as const;

export const RECOMMENDATION_BASES = [
  'similar_to_current',

  'most_viewed',

  'complements_cart',

  'complements_purchase',

  'liked_category',

  'popular',
] as const;

export const productReferenceSchema = z.object({
  sku: z.string(),

  basis: z.enum(RECOMMENDATION_BASES),

  reason: z.string().nullable(),

  badge: z.string().nullable(),
  emphasis: z.enum(EMPHASIS),
});
export type ProductReference = z.infer<typeof productReferenceSchema>;
export type RecommendationBasis = (typeof RECOMMENDATION_BASES)[number];

const heroBlockSchema = z.object({
  kind: z.literal('hero'),
  headline: z.string(),
  body: z.string().nullable(),
  sku: z.string().nullable(),
  ctaLabel: z.string().nullable(),
});

const gridBlockSchema = z.object({
  kind: z.literal('grid'),
  title: z.string().nullable(),
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  items: z.array(productReferenceSchema),
});

const carouselBlockSchema = z.object({
  kind: z.literal('carousel'),
  title: z.string().nullable(),
  items: z.array(productReferenceSchema),
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

const bundleBlockSchema = z.object({
  kind: z.literal('bundle'),
  title: z.string().nullable(),
  body: z.string().nullable(),
  ctaLabel: z.string().nullable(),

  bundleId: z.string().nullable(),
});

export const blockSchema = z.discriminatedUnion('kind', [
  heroBlockSchema,
  gridBlockSchema,
  carouselBlockSchema,
  bannerBlockSchema,
  copyBlockSchema,
  bundleBlockSchema,
]);
export type Block = z.infer<typeof blockSchema>;
export type BlockKind = Block['kind'];

export type HeroBlock = z.infer<typeof heroBlockSchema>;
export type GridBlock = z.infer<typeof gridBlockSchema>;
export type CarouselBlock = z.infer<typeof carouselBlockSchema>;
export type BannerBlock = z.infer<typeof bannerBlockSchema>;
export type CopyBlock = z.infer<typeof copyBlockSchema>;
export type BundleBlock = z.infer<typeof bundleBlockSchema>;

export const generatedSpecSchema = z.object({
  tone: z.enum(TONES),
  headline: z.string(),
  subheadline: z.string().nullable(),
  blocks: z.array(blockSchema),

  rationale: z.string(),
});
export type GeneratedSpec = z.infer<typeof generatedSpecSchema>;
export type GeneratedSpecResult = z.ZodSafeParseResult<GeneratedSpec>;

export type SpecSource = 'llm' | 'cache' | 'fallback';

export type DegradedReason =
  | 'no-provider'
  | 'provider-error'
  | 'timeout'
  | 'invalid-generation'
  | 'unusable-on-serve'
  | 'requested';

export const SPEC_VERSION = '1' as const;

export interface ComponentSpec extends GeneratedSpec {
  specVersion: typeof SPEC_VERSION;
  slot: string;
  source: SpecSource;

  generatedAt: number;

  latencyMs: number;

  provider: string | null;

  model: string | null;

  degradedReason?: DegradedReason;
}

export function parseGeneratedSpec(value: unknown): GeneratedSpec {
  return generatedSpecSchema.parse(value);
}

export function safeParseGeneratedSpec(value: unknown): GeneratedSpecResult {
  return generatedSpecSchema.safeParse(value);
}
