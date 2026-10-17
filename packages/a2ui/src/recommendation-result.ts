import { bundleSchema, parseComponentSpec, productSchema } from '@rudra-js/core/schemas';
import type { Bundle, ComponentSpec, Product } from '@rudra-js/core';

export interface RecommendationResult {
  spec: ComponentSpec;
  products: readonly Product[];
  bundles?: readonly Bundle[];
}

export function parseRecommendationResult(value: unknown): RecommendationResult {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('the recommendation result is not an object');
  }
  const { spec, products, bundles } = value as Record<string, unknown>;
  return {
    spec: parseComponentSpec(spec),
    products: productSchema.array().parse(products),
    bundles: bundleSchema.array().default([]).parse(bundles),
  };
}
