// A2UI's schemas are zod 3, so this file uses zod 3 while the rest of rudra-js uses zod 4.
import { z } from 'zod';
import { CommonSchemas, type ComponentApi } from '@a2ui/web_core/v0_9';
import { FIELD_LIMITS } from '@rudra-js/core';

export const RUDRA_RECOMMENDATIONS_COMPONENT = 'RudraRecommendations';

/**
 * How an agent should use the component, for the `instructions` of the catalog that holds it.
 * A2UI leaves a component's own description out of the catalog JSON, so this is where it goes.
 */
export const RUDRA_RECOMMENDATIONS_INSTRUCTIONS =
  `${RUDRA_RECOMMENDATIONS_COMPONENT} shows product recommendations from this shop. Place it and ` +
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
  maxItems: z
    .number()
    .int()
    .min(1)
    .max(FIELD_LIMITS.maxItems)
    .optional()
    .describe('Most products to show. The shop decides when this is left out.'),
});

/**
 * The A2UI definition of the recommendation component: its name and the only properties an
 * agent can set. It holds no rendering code, so it is safe to import on a server, for example to
 * put the component into the catalog JSON an agent is prompted with.
 */
export const rudraRecommendationsApi = {
  name: RUDRA_RECOMMENDATIONS_COMPONENT,
  schema: recommendationsPropertiesSchema,
} as const satisfies ComponentApi;

export type RudraRecommendationsApi = typeof rudraRecommendationsApi;
