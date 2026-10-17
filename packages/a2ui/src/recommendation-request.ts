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
 * Keeps a `currentSku` or a `currentCategory` only when one of your candidates carries it, so put
 * the product being looked at among them, as core's quickstart does. Both hints come from the
 * agent, or from whoever called your endpoint. In core's default cohort mode a category is part of
 * the cache key and of the prompt, so an open-ended set of categories is an open-ended number of
 * model calls; a category none of your products has is one nobody needs.
 */
export function fitRecommendationRequest(
  request: RecommendationRequest,
  candidates: readonly Pick<Product, 'sku' | 'category'>[],
): RecommendationRequest {
  const { currentSku, currentCategory, ...otherHints } = request;
  const isCandidateSku = candidates.some((candidate) => candidate.sku === currentSku);
  const isCandidateCategory = candidates.some(
    (candidate) => candidate.category === currentCategory,
  );

  return {
    ...otherHints,
    ...(currentSku !== undefined && isCandidateSku ? { currentSku } : {}),
    ...(currentCategory !== undefined && isCandidateCategory ? { currentCategory } : {}),
  };
}

/**
 * Builds a request in the browser from what the agent set. It reads only the fields a request
 * has, so a property the agent invented, such as a headline or a price, never leaves the browser.
 * A value that wouldn't pass `parseRecommendationRequest` is left out, so one bad hint doesn't
 * cost the shopper the whole block.
 */
export function pickRecommendationRequest(
  properties: Partial<Record<RecommendationHint, unknown>>,
): RecommendationRequest {
  const request: Record<string, unknown> = {};
  for (const [field, schema] of Object.entries(recommendationRequestSchema.shape)) {
    const checked = schema.safeParse(properties[field as RecommendationHint]);
    if (checked.success && checked.data !== undefined) request[field] = checked.data;
  }
  // Every field in it has just passed its own part of the schema.
  return request as RecommendationRequest;
}

/**
 * Whether a hint the agent bound to its data model, or to a function, has no value yet. The
 * component waits for it rather than asking without it and then asking again.
 */
export function isAwaitingBoundHint(
  written: Readonly<Record<string, unknown>>,
  resolved: Partial<Record<RecommendationHint, unknown>>,
): boolean {
  return Object.keys(recommendationRequestSchema.shape).some((field) => {
    const isBound = typeof written[field] === 'object' && written[field] !== null;
    return isBound && resolved[field as RecommendationHint] === undefined;
  });
}
