import { renderContextSchema } from '@rudra-js/core/schemas';
import type { Product } from '@rudra-js/core';

export interface RecommendationRequest {
  currentSku?: string | undefined;
  currentCategory?: string | undefined;
  searchQuery?: string | undefined;
  maxItems?: number | undefined;
}

const recommendationRequestSchema = renderContextSchema
  .pick({ currentSku: true, currentCategory: true, searchQuery: true })
  .extend({ maxItems: renderContextSchema.shape.maxItems.unwrap().optional() });

export function parseRecommendationRequest(value: unknown): RecommendationRequest {
  return recommendationRequestSchema.parse(value);
}

export function fitRecommendationRequest(
  request: RecommendationRequest,
  candidates: readonly Pick<Product, 'sku' | 'category'>[],
): RecommendationRequest {
  const { currentSku, currentCategory, searchQuery, maxItems } = request;
  const fitted: RecommendationRequest = {};
  if (candidates.some((candidate) => candidate.sku === currentSku)) fitted.currentSku = currentSku;
  if (candidates.some((candidate) => candidate.category === currentCategory)) {
    fitted.currentCategory = currentCategory;
  }
  if (searchQuery !== undefined) fitted.searchQuery = searchQuery;
  if (maxItems !== undefined) fitted.maxItems = maxItems;
  return fitted;
}

const isBlank = (value: unknown): boolean =>
  value === undefined || (typeof value === 'string' && value.trim() === '');

export function pickRecommendationRequest(
  written: Readonly<Record<string, unknown>>,
  resolved: Readonly<Record<string, unknown>>,
): RecommendationRequest {
  const request: Record<string, unknown> = {};
  for (const [field, schema] of Object.entries(recommendationRequestSchema.shape)) {
    if (!Object.hasOwn(written, field)) continue;
    const checked = schema.safeParse(resolved[field]);
    if (checked.success && !isBlank(checked.data)) request[field] = checked.data;
  }
  return recommendationRequestSchema.parse(request);
}
