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
