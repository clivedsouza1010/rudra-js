# @rudra-js/a2ui

This package is part of [rudra-js](https://rudrajs.com).

rudra-js is an open-source TypeScript library (MIT) you install from npm. A language model designs one product-recommendation block for a page in your shop, rudra-js checks it against your catalog, and React renders it.

It is not a hosted platform, a visual or low-code app builder, or a workspace you sign up for.

This package puts that block inside the interfaces an [A2UI](https://a2ui.org) agent builds. It
adds one component, `RudraRecommendations`, to the catalog your A2UI renderer draws from. The agent
places it and passes hints about what the shopper is looking at. Your server still picks the
products and builds the block with `@rudra-js/core`. The browser renders it with `@rudra-js/react`.

It works with version 0.9 of the A2UI protocol, using `@a2ui/react` and `@a2ui/web_core` 0.14.

## Install

```sh
npm install @rudra-js/a2ui@latest @rudra-js/core@latest @rudra-js/react@latest @rudra-js/attested@latest @a2ui/react@0.14 @a2ui/web_core@0.14 react react-dom
```

Use the same command to install and to upgrade, whether or not your app already uses rudra-js or A2UI.
If your app has `@rudra-js/anthropic`, add `@rudra-js/anthropic@latest` to that command.

The `@rudra-js` packages are released together. Each one's peer range for the others starts at its
own version. For a package name with no version, npm stays inside the range your `package.json`
already has. Without `@latest`, an app on an older core can get an `ERESOLVE` error. `react`
and `react-dom` have no version, so npm and pnpm keep a React 18 app on 18.

Everything except zod is a peer dependency, so your app holds one copy of each. npm and pnpm
install peers for you. List them anyway, because your code imports most of them itself.
pnpm only lets your code import what your `package.json` names. Yarn doesn't install peers, so on Yarn you
need the whole list. Yarn also moves a name with no version to its latest release. So on Yarn, if your app
already has React, leave out `react` and `react-dom`. On pnpm, read [zod](#zod) first.

Keep `skipLibCheck: true` in your `tsconfig.json`. Without it, A2UI's own type declarations fail
to typecheck. They need `"dom"` in `lib`. Two of their imports also have no file extension, which
`nodenext` refuses.

## Three pieces

### The catalog your agent is prompted with

Put `agentCatalog.toJson()` in your agent's prompt. Have the agent create surfaces with
`catalogId: agentCatalog.id`. If you have catalog instructions of your own, join them to
`RUDRA_RECOMMENDATIONS_INSTRUCTIONS`.

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

The first `toJson()` call logs one "Recursive reference detected" warning per hint. It's harmless.

### Your endpoint

`shopperFor` and `candidatesFor` stand in for the session and catalog code you already have.
`provider: null` calls no model, so pass your own provider.

`generation` defaults to `'cohort'`, which shares one block design between shoppers who look alike. In
that mode the model never sees `searchQuery`. The agent's search only matters with
`generation: 'per-shopper'`.

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
  `maxItems`. Anything else gets a 400.
- `fitRecommendationRequest` drops a SKU or category that none of your candidates has.
- Pick candidates on your side, not from the hints.
- Each new category, `maxItems` or candidate set means a new model call. With `per-shopper`, so
  does each shopper and each new SKU or search. Rate-limit the endpoint (see
  [SECURITY.md](https://github.com/clivedsouza1010/rudra-js/blob/main/SECURITY.md)).
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

Give the browser catalog the same id as the agent catalog. A2UI looks it up by the `catalogId` the
agent sends. Render the processor's surfaces with `A2uiSurface`.

`createRudraRecommendationsComponent` takes `loadRecommendations`, `placeholder` and `onError`. It
also takes every `RudraComponent` prop except `spec`, `products` and `bundles`.

## What the component does

- It reads each hint either as a literal value or from the agent's data model, like
  `{ "path": "/viewing/sku" }`. It sends only the four hints the endpoint accepts.
- It leaves out a hint that is blank, or one the server would turn away, like a `maxItems` of 40.
- A literal of the wrong type, like a numeric SKU, makes A2UI refuse the agent's whole message.
- It waits until the hints stop changing for 300 ms, then calls `loadRecommendations`.
- It keeps showing the last block until the next one arrives.
- `signal` aborts when the hints change or the component unmounts.
- It checks the result against core's schemas before it renders any of it.
- It shows `placeholder` until the first load finishes.
- If a load fails or the result fails the schema check, it shows nothing and calls `onError`. It
  does the same if the block throws while rendering.
- Each component on a surface sends its own request.

## Where it runs

`@rudra-js/a2ui` holds `createRudraRecommendationsComponent` and its types. It loads only in the
browser, because `@a2ui/react` needs a DOM. The agent catalog and your endpoint import from
`@rudra-js/a2ui/server`, which runs anywhere.

In Next.js, a `'use client'` file still runs on the server for the first render. Load the file
that imports `@rudra-js/a2ui` through `next/dynamic` with `ssr: false`, and make that call from a
client component.

A2UI renders in the browser, so a crawler won't see a block an agent places. For a product page,
render `RudraComponent` on the server, as the
[`@rudra-js/react` README](https://github.com/clivedsouza1010/rudra-js/tree/main/packages/react)
describes.

## zod

A2UI's schemas use zod 3, so this package depends on zod 3. The rest of rudra-js uses zod 4. npm
installs both, each where its own package finds it. With npm, you don't need either one yourself.

On pnpm, `@a2ui/react` gets core's zod 4 as its zod peer. Then the browser example fails to
typecheck with TS2344. If your app has no zod of its own, add zod 3:

```sh
pnpm add zod@^3.25.76
```

If your app uses zod 4, remove the zod peer from `@a2ui/react` in `.pnpmfile.cjs`. pnpm then gives
it the zod 3 it depends on:

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

## Licence

[MIT](./LICENSE)
