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

export {
  DIGEST_LIMITS,
  buildDigest,
  type CategoryAffinity,
  type InteractionCount,
  type SignalDigest,
  type ViewedProduct,
} from './signal-digest.js';

export {
  BANNER_TONES,
  EMPHASIS,
  RECOMMENDATION_BASES,
  SPEC_VERSION,
  TONES,
  blockSchema,
  generatedSpecSchema,
  parseGeneratedSpec,
  productReferenceSchema,
  safeParseGeneratedSpec,
  type BannerBlock,
  type Block,
  type BlockKind,
  type CarouselBlock,
  type ComponentSpec,
  type CopyBlock,
  type GeneratedSpec,
  type GridBlock,
  type HeroBlock,
  type ProductReference,
  type RecommendationBasis,
  type SpecSource,
} from './component-spec.js';

export { neverRecommend, reconcileSpec, type ReconcileResult } from './reconciliation.js';
export { selectProducts, type ProductPick } from './product-selection.js';
export { buildFallbackSpec } from './fallback-component.js';
