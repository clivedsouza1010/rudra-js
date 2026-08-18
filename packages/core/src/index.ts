/**
 * @rudra/core — the contracts and logic that turn one tracking payload into one
 * renderable component specification.
 *
 * Carries no React and no model-vendor SDK, so it can be unit tested in
 * isolation and imported from any server runtime.
 */

export {
  FIELD_LIMITS,
  productSchema,
  skuSignalSchema,
  viewSignalSchema,
  purchaseSignalSchema,
  interactionSchema,
  renderContextSchema,
  trackingSignalsSchema,
  trackingInputSchema,
  parseTrackingInput,
  safeParseTrackingInput,
  type Product,
  type SkuSignal,
  type ViewSignal,
  type PurchaseSignal,
  type Interaction,
  type RenderContext,
  type TrackingSignals,
  type TrackingInput,
  type TrackingInputDraft,
  type TrackingInputResult,
} from './tracking-input.js';
