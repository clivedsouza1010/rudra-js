/**
 * @rudra/core — the BackEnd Layer of the AI-driven SSR architecture.
 *
 * Contains no vendor SDK and no React. It turns one tracking payload into one
 * validated, renderable component specification.
 */

export {
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
} from './tracking-input.js';

export {
  productRefSchema,
  blockSchema,
  generatedSpecSchema,
  SPEC_VERSION,
  TONES,
  BANNER_TONES,
  EMPHASIS,
  type ProductRef,
  type Block,
  type BlockKind,
  type HeroBlock,
  type GridBlock,
  type CarouselBlock,
  type BannerBlock,
  type CopyBlock,
  type GeneratedSpec,
  type ComponentSpec,
  type SpecSource,
} from './spec.js';

export { buildDigest, type SignalDigest, type CategoryAffinity } from './digest.js';
export { buildPrompt, SYSTEM_PROMPT_TEXT, type PromptPair } from './prompt.js';
export { reconcileSpec, type ReconcileResult } from './reconcile.js';
export { buildFallbackSpec } from './fallback.js';

export {
  createMemoryCache,
  createNoopCache,
  createSingleFlight,
  cacheKey,
  fingerprintPrompt,
  type SpecCache,
  type MemoryCacheOptions,
} from './cache.js';

export {
  createStaticProvider,
  type ComponentProvider,
  type ProviderRequest,
  type ProviderResult,
} from './provider.js';

export {
  createGenerator,
  type Generator,
  type GeneratorOptions,
  type GenerationEvent,
} from './generator.js';
