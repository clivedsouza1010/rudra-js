import { z } from 'zod';
import { CommonSchemas, type ComponentApi } from '@a2ui/web_core/v0_9';
import { FIELD_LIMITS } from '@rudra-js/core';

export const RUDRA_RECOMMENDATIONS_INSTRUCTIONS =
  'RudraRecommendations shows product recommendations from this shop. Place it and ' +
  'say what the shopper is looking at. The shop chooses the products and writes the heading, and ' +
  "every title, price, image and link comes from the shop's catalog. Do not write product names, " +
  'prices, ratings or offers around it.';

const recommendationsPropertiesSchema = z.object({
  currentSku: CommonSchemas.DynamicString.optional().describe(
    'SKU of the product the shopper is looking at or asking about. It is left out of the ' +
      'recommendations. Use only a SKU the shop gave you.',
  ),
  currentCategory: CommonSchemas.DynamicString.optional().describe(
    'Catalog category the shopper is browsing or asking about.',
  ),
  searchQuery: CommonSchemas.DynamicString.optional().describe(
    "What the shopper searched for or asked for, in the shopper's own words.",
  ),
  maxItems: CommonSchemas.DynamicNumber.optional().describe(
    `Most products to show, a whole number from 1 to ${FIELD_LIMITS.maxItems}. The shop decides ` +
      'when this is left out or out of range.',
  ),
});

export const rudraRecommendationsApi = {
  name: 'RudraRecommendations',
  schema: recommendationsPropertiesSchema,
} as const satisfies ComponentApi;
