// Written into the temp consumer by verify-consumer.mjs, which fills in the forbidden specifier.
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

// A set the shop sells together, validated the way a host validates one.
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

// The bundle half of the public surface: the block kind, the `bundles` prop,
// and the shop's own name and price for the set.
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
// Takes the set and an optional locale — no catalog. The price and the currency
// both come off the bundle itself.
const bundlePrice = defaultFormatBundlePrice(firstBundle, 'en-US');
if (bundlePrice !== '$180.00') {
  throw new Error(`defaultFormatBundlePrice returned ${bundlePrice}`);
}

// The set says which money it is in, so a euro set in a dollar catalog is still
// priced in euros.
const euroPrice = defaultFormatBundlePrice({ ...firstBundle, currency: 'EUR' }, 'en-US');
if (euroPrice !== '€180.00') {
  throw new Error(`defaultFormatBundlePrice ignored the bundle currency: ${euroPrice}`);
}

// The locale is optional, and leaving it out must still produce a price.
if (defaultFormatBundlePrice(firstBundle).length === 0) {
  throw new Error('defaultFormatBundlePrice returned nothing without a locale');
}

// Proves the package's entry point and types resolve for a real consumer under
// nodenext, without ever making a network call.
const anthropicProvider = createAnthropicProvider({
  apiKey: 'not-a-real-key',
  fetch: async () => new Response('{}'),
});
if (typeof anthropicProvider.name !== 'string' || typeof anthropicProvider.model !== 'string') {
  throw new Error('@rudra-js/anthropic provider has no name/model strings');
}

// The guarantee half, resolving with no dependencies of its own and no node
// builtins — which is the only reason it can claim to run anywhere.
const facts: Facts = { values: [174] };
const claim = verify('Only 2 left at $174', facts);
if (claim.supported) {
  throw new Error('@rudra-js/attested passed a quantity the facts do not carry');
}
if (claim.quantity.findings[0]?.token !== '2') {
  throw new Error(`@rudra-js/attested named the wrong token: ${JSON.stringify(claim.quantity)}`);
}

// The consumer must not be able to reach the repository's own dependency tree —
// if it can, an undeclared dependency in a published package resolves here and
// this whole check reports a false green.
// Held in a variable so the specifier is not a literal: tsc resolves literals,
// and would report this deliberate miss as a compile error.
const forbidden: string = '__FORBIDDEN_PACKAGE__';
let leaked = true;
try {
  await import(forbidden);
} catch {
  leaked = false;
}
if (leaked) {
  throw new Error(
    `the consumer resolved '${forbidden}', so it is not isolated from the repo — ` +
      'this check cannot be trusted until that is fixed',
  );
}

console.log('  render + isolation: ok');
