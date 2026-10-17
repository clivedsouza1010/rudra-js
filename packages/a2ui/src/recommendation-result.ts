import {
  SPEC_VERSION,
  bundleSchema,
  parseGeneratedSpec,
  productSchema,
  type Bundle,
  type ComponentSpec,
  type DegradedReason,
  type Product,
  type SpecSource,
} from '@rudra-js/core';

/** What your endpoint answers with, and what `loadRecommendations` resolves to. */
export interface RecommendationResult {
  /** What `generator.generate(input)` returned. */
  spec: ComponentSpec;
  /** The candidates the spec was generated from, as parsed: `input.candidates`. */
  products: readonly Product[];
  /** The bundles as parsed, `input.bundles`, when a spec can show one. */
  bundles?: readonly Bundle[];
}

// Keyed by every value of each type, so the compiler names a value core adds and this misses.
const SPEC_SOURCES = { llm: true, cache: true, fallback: true } satisfies Record<SpecSource, true>;
const DEGRADED_REASONS = {
  'no-provider': true,
  'provider-error': true,
  timeout: true,
  'invalid-generation': true,
  'unusable-on-serve': true,
  requested: true,
} satisfies Record<DegradedReason, true>;

const productListSchema = productSchema.array();
const bundleListSchema = bundleSchema.array();

const isOneOf = <Value extends string>(
  table: Record<Value, true>,
  value: unknown,
): value is Value => typeof value === 'string' && Object.hasOwn(table, value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isTextOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

function parseComponentSpec(value: unknown): ComponentSpec {
  const content = parseGeneratedSpec(value);
  const metadata = value as Record<string, unknown>;

  if (
    metadata.specVersion !== SPEC_VERSION ||
    typeof metadata.slot !== 'string' ||
    !isOneOf(SPEC_SOURCES, metadata.source) ||
    !isFiniteNumber(metadata.generatedAt) ||
    !isFiniteNumber(metadata.latencyMs) ||
    !isTextOrNull(metadata.provider) ||
    !isTextOrNull(metadata.model) ||
    (metadata.degradedReason !== undefined && !isOneOf(DEGRADED_REASONS, metadata.degradedReason))
  ) {
    throw new TypeError(
      `the recommendation spec is not a version ${SPEC_VERSION} ComponentSpec from @rudra-js/core`,
    );
  }

  return {
    ...content,
    specVersion: SPEC_VERSION,
    slot: metadata.slot,
    source: metadata.source,
    generatedAt: metadata.generatedAt,
    latencyMs: metadata.latencyMs,
    provider: metadata.provider,
    model: metadata.model,
    ...(metadata.degradedReason === undefined ? {} : { degradedReason: metadata.degradedReason }),
  };
}

/**
 * Checks a result before any of it reaches the page. It crossed the network as JSON, so it gets
 * the checks a payload gets: the spec through core's spec schema, and the products and bundles
 * through `productSchema` and `bundleSchema`, which is what keeps a `//elsewhere.example` image
 * off the page. Throws for anything else.
 */
export function parseRecommendationResult(value: unknown): RecommendationResult {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('the recommendation result is not an object');
  }
  const { spec, products, bundles } = value as Record<string, unknown>;

  return {
    spec: parseComponentSpec(spec),
    products: productListSchema.parse(products),
    bundles: bundles === undefined ? [] : bundleListSchema.parse(bundles),
  };
}
