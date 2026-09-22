import { z } from 'zod';

export const FIELD_LIMITS = {
  identifier: 128,
  shortText: 200,
  searchQuery: 200,
  tag: 64,
  tagsPerProduct: 20,
  metaEntries: 50,
  signalsPerCategory: 500,
  candidates: 200,
  productsPerBundle: 5,
  bundles: 20,
  localeTag: 35,
  maxItems: 12,

  reason: 120,
} as const;

const RESERVED_META_KEY = '__proto__';

const MAX_EPOCH_MS = Date.UTC(2100, 0, 1);

const identifier = () => z.string().min(1).max(FIELD_LIMITS.identifier);
const optionalIdentifier = () => z.string().min(1).max(FIELD_LIMITS.identifier).optional();

const epochMs = () => z.number().int().min(0).max(MAX_EPOCH_MS).optional();

const isRootRelative = (value: string) => {
  const asParsed = value.replace(/[\t\n\r]/g, '');
  return value.startsWith('/') && /^\/(?![/\\])/.test(asParsed);
};

const imageReference = () =>
  z
    .string()
    .max(FIELD_LIMITS.shortText)
    .refine(
      (value) =>
        isRootRelative(value) ? true : z.url({ protocol: /^https?$/ }).safeParse(value).success,
      { message: 'expected an http(s) URL or a root-relative path' },
    );

export const productSchema = z.strictObject({
  sku: identifier(),
  title: z.string().min(1).max(FIELD_LIMITS.shortText),
  category: identifier(),
  price: z.number().nonnegative(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'expected a three-letter ISO 4217 code')
    .default('USD'),

  imageUrl: imageReference().optional(),
  rating: z.number().min(0).max(5).optional(),

  reason: z.string().min(1).max(FIELD_LIMITS.reason).optional(),
  isInStock: z.boolean().default(true),
  tags: z
    .array(z.string().min(1).max(FIELD_LIMITS.tag))
    .max(FIELD_LIMITS.tagsPerProduct)
    .default([]),
});
export type Product = z.infer<typeof productSchema>;

export const skuSignalSchema = z.strictObject({
  sku: identifier(),
  category: optionalIdentifier(),
  at: epochMs(),

  weight: z.number().min(0).max(1).optional(),
});
export type SkuSignal = z.infer<typeof skuSignalSchema>;

export const viewSignalSchema = skuSignalSchema.extend({
  views: z.number().int().positive().default(1),
  dwellMs: z.number().nonnegative().optional(),
});
export type ViewSignal = z.infer<typeof viewSignalSchema>;

export const purchaseSignalSchema = skuSignalSchema.extend({
  quantity: z.number().int().positive().default(1),
  price: z.number().nonnegative().optional(),
});
export type PurchaseSignal = z.infer<typeof purchaseSignalSchema>;

const metaKeysAreSafe = z.custom<Record<string, string | number | boolean>>(
  (value) =>
    typeof value === 'object' && value !== null && !Object.hasOwn(value, RESERVED_META_KEY),
  { message: `meta may not use the reserved key ${RESERVED_META_KEY}` },
);

const metaSchema = metaKeysAreSafe.pipe(
  z
    .record(
      z.string().min(1).max(FIELD_LIMITS.identifier),
      z.union([z.string().max(FIELD_LIMITS.shortText), z.number(), z.boolean()]),
    )
    .refine((entries) => Object.keys(entries).length <= FIELD_LIMITS.metaEntries, {
      message: `meta may carry at most ${FIELD_LIMITS.metaEntries} entries`,
    }),
);

export const interactionSchema = z.strictObject({
  type: identifier(),
  sku: optionalIdentifier(),
  category: optionalIdentifier(),
  at: epochMs(),
  value: z.union([z.string().max(FIELD_LIMITS.shortText), z.number(), z.boolean()]).optional(),
  meta: metaSchema.optional(),
});
export type Interaction = z.infer<typeof interactionSchema>;

export const renderContextSchema = z.strictObject({
  surface: identifier(),

  slot: z.string().min(1).max(FIELD_LIMITS.identifier).default('recommendations'),
  currentSku: optionalIdentifier(),
  currentCategory: optionalIdentifier(),
  searchQuery: z.string().max(FIELD_LIMITS.searchQuery).optional(),

  locale: z
    .string()
    .max(FIELD_LIMITS.localeTag)
    .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/, 'expected one language tag, such as en-US')
    .default('en-US'),

  maxItems: z.number().int().min(1).max(FIELD_LIMITS.maxItems).default(4),
});
export type RenderContext = z.infer<typeof renderContextSchema>;

const signalArray = <Schema extends z.ZodType>(schema: Schema) =>
  z.array(schema).max(FIELD_LIMITS.signalsPerCategory).default([]);

export const trackingSignalsSchema = z.strictObject({
  likes: signalArray(skuSignalSchema),
  dislikes: signalArray(skuSignalSchema),
  mostViewed: signalArray(viewSignalSchema),
  lastPurchased: signalArray(purchaseSignalSchema),
  cart: signalArray(skuSignalSchema),
  recentSearches: signalArray(z.string().min(1).max(FIELD_LIMITS.searchQuery)),
  interactions: signalArray(interactionSchema),
});
export type TrackingSignals = z.infer<typeof trackingSignalsSchema>;

export const bundleSchema = z.strictObject({
  id: identifier(),
  skus: z
    .array(identifier())
    .min(2)
    .max(FIELD_LIMITS.productsPerBundle)
    .refine((skus) => new Set(skus).size === skus.length, {
      message: 'a bundle must not list the same product twice',
    }),

  price: z.number().nonnegative(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'expected a three-letter ISO 4217 code')
    .default('USD'),
  label: z.string().min(1).max(FIELD_LIMITS.shortText).optional(),
});
export type Bundle = z.infer<typeof bundleSchema>;

export const trackingInputSchema = z
  .strictObject({
    schemaVersion: z.literal('1').default('1'),
    user: z.strictObject({
      id: identifier(),
      segment: optionalIdentifier(),
      isReturning: z.boolean().optional(),
    }),
    context: renderContextSchema,

    signals: trackingSignalsSchema.prefault({}),

    candidates: z
      .array(productSchema)
      .min(1)
      .max(FIELD_LIMITS.candidates)
      .refine(
        (products) => new Set(products.map((product) => product.sku)).size === products.length,
        {
          message: 'candidates must have unique SKUs',
        },
      ),

    bundles: z
      .array(bundleSchema)
      .max(FIELD_LIMITS.bundles)
      .refine((bundles) => new Set(bundles.map((bundle) => bundle.id)).size === bundles.length, {
        message: 'bundles must have unique ids',
      })
      .default([]),
  })
  .refine(
    (input) => {
      const candidateSkus = new Set(input.candidates.map((product) => product.sku));
      for (const bundle of input.bundles) {
        for (const sku of bundle.skus) {
          if (!candidateSkus.has(sku)) return false;
        }
      }
      return true;
    },
    { message: 'every product in a bundle must also be a candidate' },
  );

export type TrackingInput = z.infer<typeof trackingInputSchema>;

export type TrackingInputDraft = z.input<typeof trackingInputSchema>;

export type TrackingInputResult = z.ZodSafeParseResult<TrackingInput>;

export function parseTrackingInput(value: unknown): TrackingInput {
  return trackingInputSchema.parse(value);
}

export function safeParseTrackingInput(value: unknown): TrackingInputResult {
  return trackingInputSchema.safeParse(value);
}
