import { z } from 'zod';

/**
 * The tracking-input contract — the boundary between the host application and
 * rudra-js.
 *
 * rudra-js does not collect, store, or aggregate anything. The host owns its
 * tracking pipeline (an event stream, a CDP, a warehouse) and hands the
 * framework one JSON object per render. This module is that contract: one
 * schema, validated at the edge, so a malformed payload fails loudly here
 * rather than quietly producing a bad prompt several layers later.
 *
 * Every fixed-shape object below is a `strictObject`, so an unrecognised field
 * is an error rather than being dropped. That matters more than it looks: with
 * a lenient object, a host that misspells `recentSearches` gets a shopper who
 * silently looks like a first-time visitor, and nothing anywhere reports it.
 * The only dynamic shape is `interaction.meta`, which is a record by design.
 */

/**
 * Every free-text field and every array is length-capped.
 *
 * These caps are not cosmetic. Host-supplied strings end up inside the prompt
 * we send to a language model, and a model is billed per token — so an
 * unbounded string is an unbounded bill, and an unbounded array of candidates
 * is the same problem multiplied.
 *
 * What this buys is that no single field is unbounded. It is deliberately not
 * an aggregate budget: the caps multiply out to far more than any context
 * window, because rejecting a large-but-legitimate payload is the wrong
 * response to one. Fitting a payload into a prompt is `digest`'s job, and it
 * trims rather than throws.
 */
export const FIELD_LIMITS = {
  identifier: 128,
  shortText: 200,
  searchQuery: 200,
  tag: 64,
  tagsPerProduct: 20,
  metaEntries: 50,
  signalsPerCategory: 500,
  candidates: 200,
} as const;

/** Assigning these as object keys mutates the prototype instead of the object. */
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Upper bound on any timestamp: 2100-01-01. */
const MAX_EPOCH_MS = Date.UTC(2100, 0, 1);

const identifier = () => z.string().min(1).max(FIELD_LIMITS.identifier);
const optionalIdentifier = () => z.string().min(1).max(FIELD_LIMITS.identifier).optional();

/**
 * Epoch milliseconds, used only for recency ordering. Bounded because a
 * negative or year-3000 timestamp does not fail anywhere downstream — it just
 * sorts to one end and silently reorders the shopper's history.
 */
const epochMs = () => z.number().int().min(0).max(MAX_EPOCH_MS).optional();

/** A product the generated component is permitted to place. */
export const productSchema = z.strictObject({
  sku: identifier(),
  title: z.string().min(1).max(FIELD_LIMITS.shortText),
  category: identifier(),
  price: z.number().nonnegative(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'expected a three-letter ISO 4217 code')
    .default('USD'),
  // Constrained to http(s) because this lands in an `<img src>` the host did
  // not write. A bare capped string would also accept '' and 'javascript:'.
  imageUrl: z
    .url({ protocol: /^https?$/ })
    .max(FIELD_LIMITS.shortText)
    .optional(),
  rating: z.number().min(0).max(5).optional(),
  inStock: z.boolean().default(true),
  tags: z
    .array(z.string().min(1).max(FIELD_LIMITS.tag))
    .max(FIELD_LIMITS.tagsPerProduct)
    .default([]),
});
export type Product = z.infer<typeof productSchema>;

/** Base shape for any signal that points at a single SKU. */
export const skuSignalSchema = z.strictObject({
  sku: identifier(),
  category: optionalIdentifier(),
  at: epochMs(),
  /** Caller-supplied strength, 0..1. Defaults to 1 when absent. */
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

/**
 * `meta` is the one dynamic shape in the contract, so its keys are checked
 * before the record is parsed rather than after. Zod builds its result by
 * assigning each key, and assigning `__proto__` sets the prototype instead of
 * adding a key — so the entry would vanish from the parsed output with no
 * error, which is the silent drop this module exists to prevent.
 */
const metaKeysAreSafe = z.custom<Record<string, string | number | boolean>>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    !Object.getOwnPropertyNames(value).some((key) => RESERVED_KEYS.has(key)),
  { message: `meta may not use the reserved keys ${[...RESERVED_KEYS].join(', ')}` },
);

// `z.record` bounds key and value shape but not how many entries a record may
// carry, so the count is checked separately.
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

/**
 * Catch-all for everything else the shopper did. `type` is an open vocabulary
 * on purpose — 'scroll_depth', 'wishlist', 'filter_applied', whatever the host
 * already emits — so hosts do not have to map their events onto ours.
 */
export const interactionSchema = z.strictObject({
  type: identifier(),
  sku: optionalIdentifier(),
  category: optionalIdentifier(),
  at: epochMs(),
  value: z.union([z.string().max(FIELD_LIMITS.shortText), z.number(), z.boolean()]).optional(),
  meta: metaSchema.optional(),
});
export type Interaction = z.infer<typeof interactionSchema>;

/** Where on the site this component is being rendered. */
export const renderContextSchema = z.strictObject({
  /** 'pdp', 'home', 'cart', 'search', or any host-defined surface. */
  surface: identifier(),
  /** Named placement, e.g. 'below-fold-recommendations'. */
  slot: z.string().min(1).max(FIELD_LIMITS.identifier).default('recommendations'),
  currentSku: optionalIdentifier(),
  currentCategory: optionalIdentifier(),
  searchQuery: z.string().max(FIELD_LIMITS.searchQuery).optional(),
  locale: z.string().min(2).max(35).default('en-US'),
  /** Upper bound on products across the whole generated component. */
  maxItems: z.number().int().min(1).max(12).default(4),
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

export const trackingInputSchema = z.strictObject({
  schemaVersion: z.literal('1').default('1'),
  user: z.strictObject({
    id: identifier(),
    segment: optionalIdentifier(),
    isReturning: z.boolean().optional(),
  }),
  context: renderContextSchema,
  // A payload with no `signals` block at all is the cold-start case, not an
  // error. Every category defaults to empty, so a first-time visitor needs no
  // special handling from the host.
  signals: trackingSignalsSchema.prefault({}),
  /**
   * The only products the generated component may place. Merchandising rules
   * belong here: whatever the host leaves out cannot be recommended, which is
   * what makes it impossible to surface a product that does not exist or is not
   * merchandised for this shopper.
   *
   * SKUs must be unique — a duplicate is a host bug that spends prompt budget
   * twice and invites the same product in two slots.
   */
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
});

export type TrackingInput = z.infer<typeof trackingInputSchema>;

/** The shape a caller passes in, before defaults are applied. */
export type TrackingInputDraft = z.input<typeof trackingInputSchema>;

/**
 * The result of a non-throwing parse. Exported so a consumer can type a
 * validation failure without depending on zod directly.
 */
export type TrackingInputResult = z.ZodSafeParseResult<TrackingInput>;

/**
 * Validates a payload, throwing a `ZodError` if it does not satisfy the
 * contract. An invalid payload is a caller bug, and it should be loud.
 */
export function parseTrackingInput(value: unknown): TrackingInput {
  return trackingInputSchema.parse(value);
}

/** Non-throwing variant, for callers that want to inspect the failure. */
export function safeParseTrackingInput(value: unknown): TrackingInputResult {
  return trackingInputSchema.safeParse(value);
}
