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
 */

/**
 * Every free-text field is length-capped.
 *
 * These caps are not cosmetic. Host-supplied strings end up inside the prompt
 * we send to a language model, and a model is billed per token — so an
 * unbounded string is an unbounded bill, and an unbounded array of candidates
 * is the same problem multiplied. Capping at the schema means the cost of a
 * render has a ceiling that does not depend on what the host sends.
 */
export const FIELD_LIMITS = {
  identifier: 128,
  shortText: 200,
  searchQuery: 200,
  tag: 64,
  tagsPerProduct: 20,
  signalsPerCategory: 500,
  candidates: 200,
} as const;

const identifier = () => z.string().min(1).max(FIELD_LIMITS.identifier);
const optionalIdentifier = () => z.string().min(1).max(FIELD_LIMITS.identifier).optional();

/** A product the generated component is permitted to place. */
export const productSchema = z.object({
  sku: identifier(),
  title: z.string().min(1).max(FIELD_LIMITS.shortText),
  category: identifier(),
  price: z.number().nonnegative(),
  currency: z.string().min(1).max(8).default('USD'),
  imageUrl: z.string().max(FIELD_LIMITS.shortText).optional(),
  rating: z.number().min(0).max(5).optional(),
  inStock: z.boolean().default(true),
  tags: z.array(z.string().min(1).max(FIELD_LIMITS.tag)).max(FIELD_LIMITS.tagsPerProduct).default([]),
});
export type Product = z.infer<typeof productSchema>;

/** Base shape for any signal that points at a single SKU. */
export const skuSignalSchema = z.object({
  sku: identifier(),
  category: optionalIdentifier(),
  /** Epoch milliseconds. Used only for recency ordering. */
  at: z.number().int().optional(),
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
 * Catch-all for everything else the shopper did. `type` is an open vocabulary
 * on purpose — 'scroll_depth', 'wishlist', 'filter_applied', whatever the host
 * already emits — so hosts do not have to map their events onto ours.
 */
export const interactionSchema = z.object({
  type: identifier(),
  sku: optionalIdentifier(),
  category: optionalIdentifier(),
  at: z.number().int().optional(),
  value: z.union([z.string().max(FIELD_LIMITS.shortText), z.number(), z.boolean()]).optional(),
  meta: z
    .record(
      z.string().max(FIELD_LIMITS.identifier),
      z.union([z.string().max(FIELD_LIMITS.shortText), z.number(), z.boolean()]),
    )
    .optional(),
});
export type Interaction = z.infer<typeof interactionSchema>;

/** Where on the site this component is being rendered. */
export const renderContextSchema = z.object({
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

const signalArray = <Schema extends z.ZodTypeAny>(schema: Schema) =>
  z.array(schema).max(FIELD_LIMITS.signalsPerCategory).default([]);

export const trackingSignalsSchema = z.object({
  likes: signalArray(skuSignalSchema),
  dislikes: signalArray(skuSignalSchema),
  mostViewed: signalArray(viewSignalSchema),
  lastPurchased: signalArray(purchaseSignalSchema),
  cart: signalArray(skuSignalSchema),
  recentSearches: signalArray(z.string().min(1).max(FIELD_LIMITS.searchQuery)),
  interactions: signalArray(interactionSchema),
});
export type TrackingSignals = z.infer<typeof trackingSignalsSchema>;

export const trackingInputSchema = z.object({
  schemaVersion: z.literal('1').default('1'),
  user: z.object({
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
   */
  candidates: z.array(productSchema).min(1).max(FIELD_LIMITS.candidates),
});

export type TrackingInput = z.infer<typeof trackingInputSchema>;

/** The shape a caller passes in, before defaults are applied. */
export type TrackingInputDraft = z.input<typeof trackingInputSchema>;

/**
 * Validates a payload, throwing a `ZodError` if it does not satisfy the
 * contract. An invalid payload is a caller bug, and it should be loud.
 */
export function parseTrackingInput(value: unknown): TrackingInput {
  return trackingInputSchema.parse(value);
}

/** Non-throwing variant, for callers that want to inspect the failure. */
export function safeParseTrackingInput(value: unknown) {
  return trackingInputSchema.safeParse(value);
}
