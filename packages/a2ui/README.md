# @rudra-js/a2ui

This package is part of [rudra-js](https://rudrajs.com).

rudra-js is an open-source TypeScript library (MIT) you install from npm. A language model designs one product-recommendation block for a page in your shop, rudra-js checks it against your catalog, and React renders it.

It is not a hosted platform, a visual or low-code app builder, or a workspace you sign up for.

This package puts that block inside the interfaces an [A2UI](https://a2ui.org) agent builds. It
adds one component, `RudraRecommendations`, to the catalog your A2UI renderer draws from. The agent
places it and hints at what the shopper is looking at. Your server still picks the products and
builds the block with `@rudra-js/core`, and the browser renders it with `@rudra-js/react`.

It works with version 0.9 of the A2UI protocol, through `@a2ui/react` and `@a2ui/web_core` 0.14.

> **Not on npm yet.** The package is in the repository but hasn't been published, so the install
> below fails until the first release that includes it.

## Install

```sh
npm install @rudra-js/a2ui @rudra-js/core @rudra-js/react @rudra-js/attested @a2ui/react @a2ui/web_core react react-dom
```

Everything but zod is a peer dependency, so your app holds one copy of each. On pnpm, read
[zod](#zod) first.

## Three pieces

### The catalog your agent is prompted with

Put `agentCatalog.toJson()` in your agent's prompt, have it create surfaces with
`catalogId: agentCatalog.id`, and join your own catalog instructions to these if you have any.

```ts
import { Catalog } from '@a2ui/web_core/v0_9';
import { basicCatalog } from '@a2ui/web_core/v0_9/basic_catalog';
import { RUDRA_RECOMMENDATIONS_INSTRUCTIONS, rudraRecommendationsApi } from '@rudra-js/a2ui/server';

export const agentCatalog = new Catalog(
  'https://shop.example/a2ui/catalog.json',
  'v0.9',
  [...basicCatalog.components.values(), rudraRecommendationsApi],
  [...basicCatalog.functions.values()],
  { instructions: RUDRA_RECOMMENDATIONS_INSTRUCTIONS },
);
```

The first `toJson()` logs one "Recursive reference detected" warning per hint. It's harmless.

### Your endpoint

`shopperFor` and `candidatesFor` stand for the session and catalog code you already have.

```ts
import { createComponentGenerator, parseTrackingInput } from '@rudra-js/core';
import {
  fitRecommendationRequest,
  parseRecommendationRequest,
  type RecommendationRequest,
  type RecommendationResult,
} from '@rudra-js/a2ui/server';
import { candidatesFor, shopperFor } from './your-shop.js';

const generator = createComponentGenerator({ provider: null });

export async function POST(request: Request): Promise<Response> {
  let asked: RecommendationRequest;
  try {
    asked = parseRecommendationRequest(await request.json());
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const shopper = await shopperFor(request);
  const candidates = await candidatesFor(shopper);
  const hints = fitRecommendationRequest(asked, candidates);
  const input = parseTrackingInput({
    user: { id: shopper.id },
    context: { surface: 'assistant', locale: shopper.locale, ...hints },
    candidates,
    signals: shopper.signals,
  });
  const spec = await generator.generate(input);

  const result: RecommendationResult = { spec, products: input.candidates, bundles: input.bundles };
  return Response.json(result);
}
```

- `parseRecommendationRequest` accepts only `currentSku`, `currentCategory`, `searchQuery` and
  `maxItems`. Anything else is a 400.
- `fitRecommendationRequest` drops a SKU or category none of your candidates has.
- Pick candidates on your side, not from the hints. Each new category, `maxItems` or candidate set
  is a new cohort and a new model call, so rate-limit the endpoint (see
  [SECURITY.md](../../SECURITY.md)).
- Send back `input.candidates` and `input.bundles`, not your raw catalog.

### The browser

```tsx
import type { ReactCatalogComponent } from '@a2ui/react/v0_9';
import { Catalog, MessageProcessor } from '@a2ui/web_core/v0_9';
import { basicCatalog } from '@a2ui/web_core/v0_9/basic_catalog';
import { createRudraRecommendationsComponent } from '@rudra-js/a2ui';

const recommendations = createRudraRecommendationsComponent({
  async loadRecommendations(request, signal) {
    const response = await fetch('/api/recommendations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
    if (!response.ok) throw new Error(`recommendations: HTTP ${response.status}`);
    return response.json();
  },
  locale: 'en-US',
});

const shopCatalog = new Catalog<ReactCatalogComponent>(
  'https://shop.example/a2ui/catalog.json',
  'v0.9',
  [...basicCatalog.components.values(), recommendations],
  [...basicCatalog.functions.values()],
);

export const processor = new MessageProcessor<ReactCatalogComponent>([shopCatalog]);
```

Render the processor's surfaces with `A2uiSurface`. The options take every `RudraComponent` prop
except `spec`, `products` and `bundles`, plus `placeholder` and `onError`.

## What comes from where

| Set by the agent                          | Set by your server                        | Set by your catalog  |
| ----------------------------------------- | ----------------------------------------- | -------------------- |
| Where the block goes on the surface       | The shopper, their signals, the locale    | Every product title  |
| `currentSku`, `currentCategory`, if yours | Which products are candidates             | Every price          |
| `searchQuery`, `maxItems`                 | The provider, and so who writes the words | Every image and link |

Each hint can be a literal or bound to the agent's data model (`{ "path": "/viewing/sku" }`).

[SECURITY.md](../../SECURITY.md) covers what an agent can and can't influence.

## What the component does

- It sends only the four hints, and skips one that won't parse or a blank search. A hint of the
  wrong type, like a numeric SKU, makes A2UI refuse the agent's whole message.
- It asks once the hints hold still for 300 ms, and keeps the last block up until the next one
  arrives. `signal` aborts when the hints change or the component unmounts.
- It checks the result against core's schemas before rendering any of it.
- It shows `placeholder` until the first load. On a failed load, a bad result or a render error it
  shows nothing and calls `onError`.
- Each component on a surface loads on its own.

## Where it runs

| Import from             | Holds                                                                  | Runs     |
| ----------------------- | ---------------------------------------------------------------------- | -------- |
| `@rudra-js/a2ui`        | `createRudraRecommendationsComponent`, the component's name and schema | Browser  |
| `@rudra-js/a2ui/server` | `rudraRecommendationsApi`, its instructions, and the request functions | Anywhere |

A2UI renders on the client, so a crawler won't see a block an agent places. For a product page,
render `RudraComponent` on the server, as the
[`@rudra-js/react` README](https://github.com/clivedsouza1010/rudra-js/tree/main/packages/react)
describes.

## zod

A2UI's schemas are zod 3, so this package depends on zod 3 while the rest of rudra-js uses zod 4.
npm installs both, each where its package finds it, and you don't need either one yourself.

On pnpm, `@a2ui/react` gets core's zod 4 as its zod peer, and the browser example stops
typechecking (TS2344). If your app has no zod of its own, add zod 3:

```sh
pnpm add zod@^3.25.76
```

If your app uses zod 4, drop the peer from `@a2ui/react` in `.pnpmfile.cjs`, and pnpm gives it
the zod 3 it depends on:

```js
module.exports = {
  hooks: {
    readPackage(manifest) {
      if (manifest.name === '@a2ui/react') delete manifest.peerDependencies?.zod;
      return manifest;
    },
  },
};
```

## A2UI's declaration files

A2UI's declarations need `"dom"` in `lib`, and two of their relative imports have no file extension,
which `nodenext` refuses. Keep `skipLibCheck: true`.
