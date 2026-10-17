import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  bundleSchema,
  createComponentGenerator,
  parseTrackingInput,
  productSchema,
  type ComponentSpec,
} from '@rudra-js/core';
import { RudraComponent, defaultFormatBundlePrice, type ProductCatalog } from '@rudra-js/react';
import { createAnthropicProvider } from '@rudra-js/anthropic';
import { verify, type Facts } from '@rudra-js/attested';
import type { RudraRecommendationsOptions } from '@rudra-js/a2ui';
import {
  RUDRA_RECOMMENDATIONS_COMPONENT,
  parseRecommendationRequest,
  rudraRecommendationsApi,
} from '@rudra-js/a2ui/server';

const products = [
  productSchema.parse({
    sku: 'TR-101',
    title: 'Switchback Trail Shoe',
    category: 'Trail Running',
    price: 174,
    currency: 'USD',
    isInStock: true,
    tags: [],
  }),
  productSchema.parse({
    sku: 'TR-102',
    title: 'Switchback Trail Sock',
    category: 'Trail Running',
    price: 26,
    currency: 'USD',
    isInStock: true,
    tags: [],
  }),
];
const catalog: ProductCatalog = products;

const bundles = [
  bundleSchema.parse({
    id: 'BUN-1',
    skus: ['TR-101', 'TR-102'],
    price: 180,
    label: 'Trail starter set',
  }),
];

const input = parseTrackingInput({
  user: { id: 'shopper-1' },
  context: { surface: 'pdp' },
  candidates: [
    { sku: 'TR-101', title: 'Switchback Trail Shoe', category: 'Trail Running', price: 174 },
    { sku: 'TR-102', title: 'Switchback Trail Sock', category: 'Trail Running', price: 26 },
  ],
  bundles,
});

const spec: ComponentSpec = await createComponentGenerator().generate(input);
const markup = renderToStaticMarkup(
  createElement(RudraComponent, { spec, products: catalog, locale: 'en-US' }),
);

if (!markup.includes('$174.00')) {
  throw new Error(`rendered markup has no price in it: ${markup.slice(0, 200)}`);
}

const bundleSpec: ComponentSpec = {
  ...spec,
  blocks: [{ kind: 'bundle', title: 'Get set up', body: null, ctaLabel: null, bundleId: 'BUN-1' }],
};
const bundleMarkup = renderToStaticMarkup(
  createElement(RudraComponent, {
    spec: bundleSpec,
    products: catalog,
    bundles,
    locale: 'en-US',
  }),
);

for (const expected of ['Trail starter set', '$180.00']) {
  if (!bundleMarkup.includes(expected)) {
    throw new Error(`rendered bundle has no ${expected} in it: ${bundleMarkup.slice(0, 300)}`);
  }
}

const [firstBundle] = bundles;
if (!firstBundle) {
  throw new Error('bundleSchema.parse returned nothing');
}
const bundlePrice = defaultFormatBundlePrice(firstBundle, 'en-US');
if (bundlePrice !== '$180.00') {
  throw new Error(`defaultFormatBundlePrice returned ${bundlePrice}`);
}

const euroPrice = defaultFormatBundlePrice({ ...firstBundle, currency: 'EUR' }, 'en-US');
if (euroPrice !== '€180.00') {
  throw new Error(`defaultFormatBundlePrice ignored the bundle currency: ${euroPrice}`);
}

if (defaultFormatBundlePrice(firstBundle).length === 0) {
  throw new Error('defaultFormatBundlePrice returned nothing without a locale');
}

const anthropicProvider = createAnthropicProvider({
  apiKey: 'not-a-real-key',
  fetch: async () => new Response('{}'),
});
if (typeof anthropicProvider.name !== 'string' || typeof anthropicProvider.model !== 'string') {
  throw new Error('@rudra-js/anthropic provider has no name/model strings');
}

const facts: Facts = { values: [174] };
const claim = verify('Only 2 left at $174', facts);
if (claim.supported) {
  throw new Error('@rudra-js/attested passed a quantity the facts do not carry');
}
if (claim.quantity.findings[0]?.token !== '2') {
  throw new Error(`@rudra-js/attested named the wrong token: ${JSON.stringify(claim.quantity)}`);
}

// The root of @rudra-js/a2ui needs a DOM, as @a2ui/react does, so here it is reached for its types
// only. Its server entry has to load and work in plain Node.
const a2uiOptions: RudraRecommendationsOptions = {
  loadRecommendations: async () => ({ spec, products, bundles }),
  locale: 'en-US',
};
if (typeof a2uiOptions.loadRecommendations !== 'function') {
  throw new Error('@rudra-js/a2ui options lost their loader');
}

if (rudraRecommendationsApi.name !== RUDRA_RECOMMENDATIONS_COMPONENT) {
  throw new Error(`@rudra-js/a2ui names its component ${rudraRecommendationsApi.name}`);
}
if (!rudraRecommendationsApi.schema.safeParse({ currentSku: { path: '/viewing/sku' } }).success) {
  throw new Error('@rudra-js/a2ui could not parse a data binding with its own zod 3 schema');
}

const asked = parseRecommendationRequest({ currentSku: 'TR-101', maxItems: 2 });
if (asked.currentSku !== 'TR-101' || asked.maxItems !== 2) {
  throw new Error(`parseRecommendationRequest returned ${JSON.stringify(asked)}`);
}
let isRefused = false;
try {
  parseRecommendationRequest({ candidates: [] });
} catch {
  isRefused = true;
}
if (!isRefused) {
  throw new Error('parseRecommendationRequest accepted a request that sets the candidates');
}

const forbidden: string = '__FORBIDDEN_PACKAGE__';
let failure: unknown = null;
try {
  await import(forbidden);
} catch (error) {
  failure = error;
}
if (failure === null) {
  throw new Error(
    `the consumer resolved '${forbidden}', so it is not isolated from the repo — ` +
      'this check cannot be trusted until that is fixed',
  );
}
const miss = failure as { code?: unknown; message?: unknown };
if (
  miss.code !== 'ERR_MODULE_NOT_FOUND' ||
  !String(miss.message).includes(`Cannot find package '${forbidden}' imported from`)
) {
  throw failure;
}

console.log('  render + isolation: ok');
