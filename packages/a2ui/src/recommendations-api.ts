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
  // A number outside the range is dropped by the component rather than refused here, since A2UI
  // refuses the agent's whole message, the rest of its interface included, for one bad property.
  maxItems: CommonSchemas.DynamicNumber.optional().describe(
    `Most products to show, a whole number from 1 to ${FIELD_LIMITS.maxItems}. The shop decides ` +
      'when this is left out or out of range.',
  ),
});

/**
 * The A2UI definition of the recommendation component: its name and the only properties an
 * agent can set. It holds no rendering code, so `@rudra-js/a2ui/server` exports it for a server to
 * put into the catalog an agent is prompted with. The package root needs a DOM.
 */
export const rudraRecommendationsApi = {
  name: RUDRA_RECOMMENDATIONS_COMPONENT,
  schema: recommendationsPropertiesSchema,
} as const satisfies ComponentApi;

export type RudraRecommendationsApi = typeof rudraRecommendationsApi;
