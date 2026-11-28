# [rudra-js](https://rudrajs.com) &middot; [![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/clivedsouza1010/rudra-js/blob/main/LICENSE) [![npm version](https://img.shields.io/npm/v/@rudra-js/core.svg?style=flat)](https://www.npmjs.com/package/@rudra-js/core) [![demo page](https://img.shields.io/badge/demo_page-link-blue)](https://demo.rudrajs.com/product/RJ-00001?shopper=S-0001)

rudra-js is an open-source TypeScript library for generating dynamic product recommendations.

You specify the tracking input to the generator, rudra-js does all the work.

- It sends the sanitized data to an LLM (Large Language Model), which is applicable only when a provider is configured.
- The model comes back with one recommendation block for a product page.
- rudra-js checks everything against your catalog and react renders it out.

The whole point is to stop the model from just writing html because that can lead to fake prices or products you dont even sell. Instead the model returns a spec using only fields the library defines. It can pick a layout and write a headline but there is no place for prices or names or links so it has to use skus from what you provided. 

![The demo's product page for a made-up outdoor store, with a gallery, a buy box and the first recommendation section. In that section the line under the heading and the cards marked Featured are the model's. The products, their order and the line under each are core's picks, and every title, price and image comes from the demo's catalog.](docs/demo.png)

`@rudra-js/react` turns the spec into html by pulling real details from your catalog at render time and anything from the model gets escaped.

rudra-js also runs three checks on the words the model produces. One looks for patterns around prices and ratings and stock. Another checks that any digits match things from your input like categories or tags. The last one is a list of claims without numbers like top pick.

Fields that fail get dropped. Even so some rewordings can slip through if they avoid the lists and spelled out numbers get past the digit check. That is why the main protection is that the model never sees a price and has nowhere to put one anyway. The block ends up in the first html response so crawlers see it without needing javascript.

On our benchmark, the default mode uses fewer model calls than generating per shopper. 

> **Status: `0.11.0`, early.** the public API might still change between minor versions before `1.0`.

## Getting started

No API key is needed if you skip the provider because `@rudra-js/core` just builds the block itself 
and the same input always gives the same result. 

```sh
npm install @rudra-js/core@latest @rudra-js/react@latest @rudra-js/attested@latest
```

```tsx
import { createComponentGenerator, parseTrackingInput } from '@rudra-js/core';
import { RudraComponent } from '@rudra-js/react';

const catalog = [
  { sku: 'A-1', title: 'Cast iron skillet', category: 'Cookware', price: 39, currency: 'USD' },
  { sku: 'A-2', title: 'Enamel dutch oven', category: 'Cookware', price: 89, currency: 'USD' },
  { sku: 'A-3', title: 'Chef knife', category: 'Knives', price: 55, currency: 'USD' },
];

// Passing no provider means no API key.
// Core builds the block itself, and the same input always gives the same block.
// Create the generator once, so every request shares its cache.
const generator = createComponentGenerator({ provider: null });

async function recommendations() {
  // Parsing fills in what you left out and rejects anything that doesn't belong.
  // Always pass the parsed candidates to the renderer, not your raw objects.
  const input = parseTrackingInput({
    user: { id: 'shopper-1' },
    context: { surface: 'pdp', currentSku: 'A-1', currentCategory: 'Cookware' },
    candidates: catalog,
    signals: { cart: [{ sku: 'A-2', at: Date.now() }] },
  });

  const spec = await generator.generate(input);

  return <RudraComponent spec={spec} products={input.candidates} locale="en-US" />;
}
```

With this sample, a shopper looking at the skillet with the dutch oven already in their cart will be
shown the knife, under the heading "Goes with your cart". They won't be shown the product they're
viewing or the one in their cart. No model will be asked and nothing will be billed.

In Next.js, add `export default recommendations` at the bottom of the sample to turn it into a page.

New Next.js apps from `create-next-app` have Cache Components turned on. This will stop the build
with "Next.js encountered the unstable value `Date.now()` while prerendering", because the sample
and `generate` read the clock while the page renders. To fix this, you can create the app with
`npx create-next-app@latest my-app --yes --no-cache-components`. You can also delete
`cacheComponents: true` and `partialPrefetching: true` from `next.config.ts`. There's more in the
[quick start](https://rudrajs.com/learn/quick-start#cache-components).

When adding a model, add [`@rudra-js/anthropic`](packages/anthropic) and pass it as the
`provider`. The wording and layout get handled by it but core still picks the products from your candidates on each request.

You can set `waitForModel: false` so the page serves a fallback right away and the model result caches for later.
See [Keeping the model off the page](packages/core#keeping-the-model-off-the-page).

If you're going to send real shopper traffic, read
[Running it in a regulated shop](packages/core#running-it-in-a-regulated-shop) first.

You don't have to use the Anthropic adapter: any model can be put behind the small interface
described in [Any provider](packages/core#any-provider).

If an [A2UI](https://a2ui.org) agent builds your pages, add [`@rudra-js/a2ui`](packages/a2ui) too.

## Packages

| Package                                     | What it does                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@rudra-js/core`](packages/core)           | The schemas and logic that turn a tracking input into a spec you can render in your code. The spec is checked with `@rudra-js/attested`.                                        |
| [`@rudra-js/react`](packages/react)         | Renders the spec with React, on the server or in the browser.                                                                                                                   |
| [`@rudra-js/anthropic`](packages/anthropic) | Connector to the Anthropic API.                                                                                                                                                 |
| [`@rudra-js/attested`](packages/attested)   | checks the model output against the app facts.                                                                                                          |
| [`@rudra-js/a2ui`](packages/a2ui)           | Puts the block in an [A2UI](https://a2ui.org) interface: an agent places it in React, or your server sends it to any other A2UI renderer. Your server still picks the products. |

## Development

You need Node `>=22.12` to work on this repo.

```sh
nvm use
npm install

npm run check        # all six of the below, in order

npm run build        # tsc -b across the workspace
npm run typecheck    # includes test files, which the build does not
npm run lint
npm run format:check
npm test
npm run verify:consumer   # packs every package and uses them from outside the repo
```

To see the cost of each generation mode under a stub model, run
`ANTHROPIC_API_KEY= RUDRA_REPLAY_ONLY=1 npm run bench`. [bench/README.md](bench/README.md) explains
the columns.

There's also a second job to build the demo
and check that a crawler still sees the block as part of the page. Because CI doesn't set
`RUDRA_DEMO_MODE`, the demo will replay. That job runs the plain build:

```sh
npm run build --workspace @rudra-js/example-demo
npm run verify:crawlable
```

That build is safe to run locally on its own: building doesn't call a model. Serving the demo will
only spend money with `RUDRA_DEMO_MODE=record`. Use the prefix below to make that a rule and not
just a default:

```sh
ANTHROPIC_API_KEY= RUDRA_REPLAY_ONLY=1 npm run build --workspace @rudra-js/example-demo
```

## Example

[`examples/demo`](examples/demo) itself is a small next js site that requests four recommendation sections and renders them server side with committed transcripts so replays show the model answers instead of core picks.

You can run it locally to see the page and recordings are safe as long as they only use demo data.

```sh
npm run dev --workspace @rudra-js/example-demo
# then visit http://localhost:3000/product/RJ-00001?shopper=S-0001
```

If you want to record new ones you set the demo mode to record but that actually calls the model and spends money.

```sh
RUDRA_DEMO_MODE=record npm run dev --workspace @rudra-js/example-demo
```

More details for the demo are here [`examples/demo/README.md`](examples/demo/README.md)


## Getting help

- **Bugs, Questions and ideas**: open an [issue](https://github.com/clivedsouza1010/rudra-js/issues).
- **Vulnerabilities**: report these privately (see [SECURITY.md](./SECURITY.md)).

## Contributing

The main purpose of this repository is to continue evolving rudra-js, making it better and easier to use. [CONTRIBUTING.md](./CONTRIBUTING.md) covers setup and the scope the
project holds to. It also covers the naming and testing conventions. We expect everyone taking part
to follow the [code of conduct](./CODE_OF_CONDUCT.md).

## Patent

Patent pending in the US. A provisional application for the cohort caching
design — the coupled cache key and prompt projection in
[`spec-cache.ts`](packages/core/src/spec-cache.ts) — was filed on 20 September
2026, application 64/158,649.

This doesn't change how you can use rudra-js. The code is MIT and stays MIT. The
application was filed defensively, so that nobody else patents the design and
comes after the people using it. A provisional isn't examined and may never
become a granted patent.

## Licence

[MIT](./LICENSE) © Clive Dsouza
