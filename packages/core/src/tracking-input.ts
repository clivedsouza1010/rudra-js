import { z } from 'zod';

/**
 * The tracking-input contract.
 *
 * rudra-js does not collect, store, or aggregate anything. The host application
 * owns its tracking pipeline and hands the framework a single JSON object per
 * render. This module is that contract: one schema, validated at the edge of
 * the framework, so a malformed payload fails loudly here instead of silently
 * producing a bad prompt.
 */

/** A product the LLM is permitted to place in the generated component. */
export const productSchema = z.object({
  sku: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  price: z.number().nonnegative(),
  currency: z.string().min(1).default('USD'),
  imageUrl: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  inStock: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
});
export type Product = z.infer<typeof productSchema>;

/** Base shape for any signal that points at a single SKU. */
export const skuSignalSchema = z.object({
  sku: z.string().min(1),
  category: z.string().optional(),
  /** Epoch milliseconds. Used only for recency ordering. */
  at: z.number().int().optional(),
  /** Optional caller-supplied strength, 0..1. Defaults to 1. */
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
 * Catch-all for "all the user interaction with the website". `type` is an open
 * vocabulary on purpose — 'scroll_depth', 'hover', 'share', 'wishlist',
 * 'review_submitted', 'filter_applied', whatever the host already emits.
 */
export const interactionSchema = z.object({
  type: z.string().min(1),
  sku: z.string().optional(),
  category: z.string().optional(),
  at: z.number().int().optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type Interaction = z.infer<typeof interactionSchema>;

/** Where on the site this component is being rendered. */
export const renderContextSchema = z.object({
  /** 'pdp' | 'home' | 'cart' | 'search' | 'category' | any host-defined surface. */
  surface: z.string().min(1),
  /** Named placement, e.g. 'below-fold-recommendations'. Part of the cache key. */
  slot: z.string().min(1).default('recommendations'),
  currentSku: z.string().optional(),
  currentCategory: z.string().optional(),
  searchQuery: z.string().optional(),
  locale: z.string().default('en-US'),
  /** Upper bound on products across the whole generated component. */
  maxItems: z.number().int().min(1).max(12).default(4),
});
export type RenderContext = z.infer<typeof renderContextSchema>;

export const trackingSignalsSchema = z.object({
  likes: z.array(skuSignalSchema).default([]),
  dislikes: z.array(skuSignalSchema).default([]),
  mostViewed: z.array(viewSignalSchema).default([]),
  lastPurchased: z.array(purchaseSignalSchema).default([]),
  cart: z.array(skuSignalSchema).default([]),
  recentSearches: z.array(z.string()).default([]),
  interactions: z.array(interactionSchema).default([]),
});
export type TrackingSignals = z.infer<typeof trackingSignalsSchema>;

export const trackingInputSchema = z.object({
  schemaVersion: z.literal('1').default('1'),
  user: z.object({
    id: z.string().min(1),
    segment: z.string().optional(),
    isReturning: z.boolean().optional(),
  }),
  context: renderContextSchema,
  // A payload with no `signals` block at all is the cold-start case, not an
  // error — every signal category defaults to empty.
  signals: trackingSignalsSchema.default(() => ({
    likes: [],
    dislikes: [],
    mostViewed: [],
    lastPurchased: [],
    cart: [],
    recentSearches: [],
    interactions: [],
  })),
  /**
   * The candidate set. The LLM may only choose SKUs from this list — anything
   * else is dropped during reconciliation. This is what makes it impossible for
   * a generated component to surface a product that does not exist, is out of
   * stock, or is not merchandised for this user.
   */
  candidates: z.array(productSchema).min(1),
});

export type TrackingInput = z.infer<typeof trackingInputSchema>;
/** The pre-parse shape, with all defaulted fields optional. */
export type TrackingInputDraft = z.input<typeof trackingInputSchema>;

/** Throws a ZodError if the payload does not satisfy the contract. */
export function parseTrackingInput(value: unknown): TrackingInput {
  return trackingInputSchema.parse(value);
}

export function safeParseTrackingInput(value: unknown) {
  return trackingInputSchema.safeParse(value);
}
