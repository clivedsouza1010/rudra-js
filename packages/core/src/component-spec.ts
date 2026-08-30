import { z } from 'zod';

/**
 * The component specification — the only thing a language model is ever allowed
 * to return.
 *
 * The model chooses layout, ordering, emphasis, copy, the recommendation
 * strategy behind each pick, and which of the host's candidate products to
 * surface. It never returns markup, code, URLs, prices,
 * product titles, or images. Every field is an enum, a bounded number, a SKU
 * reference resolved against the candidate set, or free text that is clamped
 * and escaped before it renders. That is what makes generated output safe to
 * put in a server-rendered response.
 *
 * Two constraints shape this file, and both are easy to undo by accident:
 *
 *  1. It doubles as a provider structured-output schema, so it avoids
 *     recursion, string length bounds, and numeric ranges. Providers reject
 *     schemas that use them in strict mode. Bounds are enforced afterwards, in
 *     reconciliation, where a violation can be repaired rather than fatal.
 *  2. Optionality is `.nullable()` rather than `.optional()`, because strict
 *     structured outputs require every declared property to be present. "No
 *     badge" has to be expressible as `null`, not as a missing key.
 *
 * A test asserts both by converting this schema to JSON Schema, so neither is
 * left to a comment nobody reads.
 *
 * Note the asymmetry with `tracking-input`, which rejects unknown fields: these
 * schemas strip them. The inputs differ in kind. An unrecognised key in a host
 * payload is a typo, and silently dropping it costs the shopper their history,
 * so it must be loud. An unrecognised key from a model is drift, and discarding
 * it is exactly right — rejecting the whole spec over one stray key would cost
 * the shopper the component. Either way the renderer only ever sees the fields
 * declared here, which is the property that matters.
 */

/** Overall voice of the component. */
export const TONES = ['neutral', 'enthusiastic', 'urgent', 'editorial'] as const;

/** What a banner is claiming. */
export const BANNER_TONES = ['info', 'promo', 'urgency', 'restock'] as const;

/** How prominently a single product is placed. */
export const EMPHASIS = ['normal', 'featured'] as const;

/**
 * Why a product was chosen — the recommendation strategy behind the pick.
 *
 * This is a closed set rather than free text because every value here is a
 * factual claim about the shopper, and a claim the server can check. "Because
 * you viewed this" written as prose is unverifiable: nothing downstream can
 * tell whether the shopper viewed anything. Declared as `most_viewed`,
 * reconciliation can look it up in the digest and drop the claim if it is
 * false.
 *
 * Every value is deliberately checkable against data already in hand — the
 * signal digest or the host's own catalog. A basis that needs data the
 * framework never receives (`new_arrival`, `back_in_stock`, `trending_today`)
 * is not in this list, because it could only ever be taken on trust.
 */
export const RECOMMENDATION_BASES = [
  /** Same category as the product being viewed. */
  'similar_to_current',
  /** The shopper has viewed this product. */
  'most_viewed',
  /** Goes with something already in the cart. */
  'complements_cart',
  /** Goes with something the shopper has bought. */
  'complements_purchase',
  /** In a category the shopper's signals favour. */
  'liked_category',
  /** No claim about this shopper at all — the safe default. */
  'popular',
] as const;

/** A reference to one product from the candidate set, and why it was chosen. */
export const productReferenceSchema = z.object({
  /** Must be a SKU the host supplied in `TrackingInput.candidates`. */
  sku: z.string(),
  /**
   * The strategy behind this pick. Reconciliation checks it against the
   * shopper's signals, so the model cannot assert a relationship that is not
   * there.
   */
  basis: z.enum(RECOMMENDATION_BASES),
  /**
   * How the basis is phrased for the shopper, e.g. "Pairs with the boots you
   * bought". Free text, but it has to be consistent with `basis`, which is not.
   *
   * Nullable because reconciliation clears it when it cannot verify the basis:
   * a pick may still be worth showing when the stated reason for it is not
   * true, but the prose asserting that reason must not render.
   */
  reason: z.string().nullable(),
  /** Short accent label, e.g. "Back in stock". Null when nothing warrants one. */
  badge: z.string().nullable(),
  emphasis: z.enum(EMPHASIS),
});
export type ProductReference = z.infer<typeof productReferenceSchema>;
export type RecommendationBasis = (typeof RECOMMENDATION_BASES)[number];

/** One large featured statement, optionally anchored to a single product. */
const heroBlockSchema = z.object({
  kind: z.literal('hero'),
  headline: z.string(),
  body: z.string().nullable(),
  sku: z.string().nullable(),
  ctaLabel: z.string().nullable(),
});

/** The general-purpose choice when several products are comparably relevant. */
const gridBlockSchema = z.object({
  kind: z.literal('grid'),
  title: z.string().nullable(),
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  items: z.array(productReferenceSchema),
});

/** A horizontally scanned row, for when order implies a ranking. */
const carouselBlockSchema = z.object({
  kind: z.literal('carousel'),
  title: z.string().nullable(),
  items: z.array(productReferenceSchema),
});

/** A single line of merchandising copy. */
const bannerBlockSchema = z.object({
  kind: z.literal('banner'),
  tone: z.enum(BANNER_TONES),
  text: z.string(),
  ctaLabel: z.string().nullable(),
});

/** Short editorial prose, for explaining the theme of a selection. */
const copyBlockSchema = z.object({
  kind: z.literal('copy'),
  title: z.string().nullable(),
  body: z.string(),
});

/** A set the shop sells together. The shop picks which one; this only asks for it. */
const bundleBlockSchema = z.object({
  kind: z.literal('bundle'),
  title: z.string().nullable(),
  body: z.string().nullable(),
  ctaLabel: z.string().nullable(),
  // Filled in per request. Whatever the model puts here is thrown away.
  bundleId: z.string().nullable(),
});

/** Blocks do not nest. The vocabulary is closed on purpose. */
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

/**
 * Exactly what the model must return. Provenance — version, slot, latency, which
 * provider answered — is added by the server afterwards, and is deliberately not
 * part of the model's burden.
 */
export const generatedSpecSchema = z.object({
  tone: z.enum(TONES),
  headline: z.string(),
  subheadline: z.string().nullable(),
  blocks: z.array(blockSchema),
  /**
   * One sentence on why this arrangement was chosen. For engineers reading
   * generation logs, not for shoppers; it is not rendered by default.
   */
  rationale: z.string(),
});
export type GeneratedSpec = z.infer<typeof generatedSpecSchema>;

/** How a spec came to exist. Surfaced for benchmarking and observability. */
export type SpecSource = 'llm' | 'cache' | 'fallback';

/**
 * Why a component is not what the model would have produced.
 *
 * A closed set, like `SpecSource`: it is rendered into pages as
 * `data-rudra-degraded` and counted in dashboards, so a host needs to know what
 * it can receive without reading the generator.
 */
export type DegradedReason =
  /** No provider was configured, so nothing was ever asked. */
  | 'no-provider'
  /** The provider errored, or threw before it reached the vendor. */
  | 'provider-error'
  /** The deadline fired before an answer arrived. */
  | 'timeout'
  /** An answer came back that did not satisfy the schema. */
  | 'invalid-generation'
  /** A usable answer reconciled down to nothing for this shopper. */
  | 'unusable-on-serve'
  /** The caller asked for the deterministic component on purpose. */
  | 'requested';

export const SPEC_VERSION = '1' as const;

/** A generated spec plus the provenance the server owns. This is what renders. */
export interface ComponentSpec extends GeneratedSpec {
  specVersion: typeof SPEC_VERSION;
  slot: string;
  source: SpecSource;
  /** Epoch milliseconds at which the underlying generation completed. */
  generatedAt: number;
  /** Wall-clock milliseconds spent producing it, including any cache lookup. */
  latencyMs: number;
  /** Provider name, or null when no model was involved. */
  provider: string | null;
  /** Model identifier, or null when no model was involved. */
  model: string | null;
  /**
   * Why the deterministic component is showing instead of a generated one.
   * Present on every fallback, including the ones where no model was involved
   * at all — no provider configured, or the caller asked for it directly.
   */
  degradedReason?: DegradedReason;
}

/** Throws a `ZodError` if the value is not a well-formed generated spec. */
export function parseGeneratedSpec(value: unknown): GeneratedSpec {
  return generatedSpecSchema.parse(value);
}

/** Non-throwing variant, for validating untrusted model output. */
export function safeParseGeneratedSpec(value: unknown) {
  return generatedSpecSchema.safeParse(value);
}
