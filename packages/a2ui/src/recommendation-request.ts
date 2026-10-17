import { renderContextSchema, type Product } from '@rudra-js/core';

/** What the browser sends your endpoint: the agent's hints about what the shopper is looking at. */
export interface RecommendationRequest {
  currentSku?: string | undefined;
  currentCategory?: string | undefined;
  searchQuery?: string | undefined;
  maxItems?: number | undefined;
}

export type RecommendationHint = keyof RecommendationRequest;

// Built from core's schema, so each field has the bounds it has in a render context. `maxItems`
// has no default here, so a request that leaves it out doesn't override the number your endpoint
// chose. This is a zod 4 schema, and it stays inside this module: this package's own `zod` is
// zod 3, for A2UI, so its type can't be written into a declaration file correctly.
const recommendationRequestSchema = renderContextSchema
  .pick({ currentSku: true, currentCategory: true, searchQuery: true })
  .extend({ maxItems: renderContextSchema.shape.maxItems.unwrap().optional() });

/**
 * Checks a request body on your server. It is strict: a body that also tries to set the shopper,
 * the candidates, the surface or the locale is rejected rather than quietly trimmed. Throws a zod
 * error for anything that isn't a `RecommendationRequest`; answer that with a 400.
 */
export function parseRecommendationRequest(value: unknown): RecommendationRequest {
  return recommendationRequestSchema.parse(value) satisfies RecommendationRequest;
}

/**
 * Keeps a `currentSku` or a `currentCategory` only when one of your candidates carries it. Both
 * hints come from the agent, or from whoever called your endpoint. A SKU none of your candidates
 * has could never be on the block anyway, which is all core's cohort mode uses it for. In core's default cohort mode a category is part of
 * the cache key and of the prompt, so an open-ended set of categories is an open-ended number of
 * model calls; a category none of your products has is one nobody needs. It returns the four hints
 * and nothing else, whatever else the object it was given holds.
 */
export function fitRecommendationRequest(
  request: RecommendationRequest,
  candidates: readonly Pick<Product, 'sku' | 'category'>[],
): RecommendationRequest {
  const { currentSku, currentCategory, searchQuery, maxItems } = request;
  const isCandidateSku = candidates.some((candidate) => candidate.sku === currentSku);
  const isCandidateCategory = candidates.some(
    (candidate) => candidate.category === currentCategory,
  );

  return {
    ...(currentSku !== undefined && isCandidateSku ? { currentSku } : {}),
    ...(currentCategory !== undefined && isCandidateCategory ? { currentCategory } : {}),
    ...(searchQuery !== undefined ? { searchQuery } : {}),
    ...(maxItems !== undefined ? { maxItems } : {}),
  };
}

// A cleared search box writes an empty string into the data model; that is no search at all.
const isBlank = (value: unknown): boolean =>
  value === undefined || (typeof value === 'string' && value.trim() === '');

/**
 * Builds a request in the browser from the hints the agent currently writes on the component,
 * taking each one's value as A2UI resolved it. A2UI hands a component every property the agent
 * wrote, and keeps a value after the agent stops writing it, so this reads only the hint fields,
 * and only those still in `written`. An invented headline or price never leaves the browser. A
 * value that wouldn't pass `parseRecommendationRequest` is left out, so one bad hint doesn't cost
 * the shopper the whole block.
 */
export function pickRecommendationRequest(
  written: Readonly<Record<string, unknown>>,
  resolved: Partial<Record<RecommendationHint, unknown>>,
): RecommendationRequest {
  const request: Record<string, unknown> = {};
  for (const [field, schema] of Object.entries(recommendationRequestSchema.shape)) {
    if (!Object.hasOwn(written, field)) continue;
    const checked = schema.safeParse(resolved[field as RecommendationHint]);
    if (checked.success && !isBlank(checked.data)) request[field] = checked.data;
  }
  // Every field in it has just passed its own part of the schema.
  return request as RecommendationRequest;
}
