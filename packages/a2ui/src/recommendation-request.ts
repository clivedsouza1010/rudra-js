import { renderContextSchema } from '@rudra-js/core';

/** What the browser sends your endpoint: the agent's hints about what the shopper is looking at. */
export interface RecommendationRequest {
  currentSku?: string | undefined;
  currentCategory?: string | undefined;
  searchQuery?: string | undefined;
  maxItems?: number | undefined;
}

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
 * Builds a request in the browser from what the agent set. It reads only the fields a request
 * has, so a property the agent invented, such as a headline or a price, never leaves the browser.
 * A value that wouldn't pass `parseRecommendationRequest` is left out, so one bad hint doesn't
 * cost the shopper the whole block.
 */
export function pickRecommendationRequest(
  properties: Partial<Record<keyof RecommendationRequest, unknown>>,
): RecommendationRequest {
  const request: Record<string, unknown> = {};
  for (const [field, schema] of Object.entries(recommendationRequestSchema.shape)) {
    const checked = schema.safeParse(properties[field as keyof RecommendationRequest]);
    if (checked.success && checked.data !== undefined) request[field] = checked.data;
  }
  // Every field in it has just passed its own part of the schema.
  return request as RecommendationRequest;
}
