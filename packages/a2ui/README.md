# @rudra-js/a2ui

This package is part of [rudra-js](https://rudrajs.com).

rudra-js is an open-source TypeScript library (MIT) you install from npm. A language model designs one product-recommendation block for a page in your shop, rudra-js checks it against your catalog, and React renders it.

It is not a hosted platform, a visual or low-code app builder, or a workspace you sign up for.

This package puts that block inside the interfaces an [A2UI](https://a2ui.org) agent builds. It
adds one component, `RudraRecommendations`, to the catalog your A2UI renderer draws from. The agent
places it and hints at what the shopper is looking at. Your server still picks the products and
builds the block with `@rudra-js/core`, and the browser renders it with `@rudra-js/react`.

It works with version 0.9 of the A2UI protocol, through `@a2ui/react` and `@a2ui/web_core` 0.14.

## Install

```sh
npm install @rudra-js/a2ui@latest @rudra-js/core@latest @rudra-js/react@latest @rudra-js/attested@latest @a2ui/react@0.14 @a2ui/web_core@0.14 react react-dom
```

Run the same command in a new app, in one that already uses rudra-js or A2UI, and to upgrade. If
your app has `@rudra-js/anthropic`, add `@rudra-js/anthropic@latest` to the command. The
`@rudra-js` packages are published together, and each one's peer ranges on the others start at its
own version. For a bare name npm stays inside the range your `package.json` already has, so
without `@latest` an app on an older core can get an `ERESOLVE`. `@0.14` is the `@a2ui` release
this package works with. `react` and `react-dom` carry no version, so npm and pnpm keep a React 18
app on 18.

Everything but zod is a peer dependency, so your app holds one copy of each. npm and pnpm add
peers for you, but your code imports most of them itself, and pnpm lets it import only what your
`package.json` names. Yarn doesn't add peers, so there you need the whole list. It does move a bare
name to its latest version, so leave out `react` and `react-dom` if your app already has React. On
pnpm, read [zod](#zod) first.

Keep `skipLibCheck: true`. Without it, A2UI's own declarations fail to typecheck: they need `"dom"`
in `lib`, and two of their imports have no file extension, which `nodenext` refuses.

## Three pieces

### The catalog your agent is prompted with

Put `agentCatalog.toJson()` in your agent's prompt and have it create surfaces with
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

The first `toJson()` logs one "Recursive reference detected" warning per hint. It's harmless.

### Your endpoint

`shopperFor` and `candidatesFor` stand for the session and catalog code you already have.
`provider: null` calls no model, so pass your own provider. In the default cohort mode the model
never sees `searchQuery`, so the agent's search only counts with `generation: 'per-shopper'`.

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
  is a new model call, and with `per-shopper` so is each shopper and each new SKU or search, so
  rate-limit the endpoint (see [SECURITY.md](https://github.com/clivedsouza1010/rudra-js/blob/main/SECURITY.md)).
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

Give the browser catalog the same id as the agent catalog, because A2UI looks it up by the
`catalogId` the agent sends. Render the processor's surfaces with `A2uiSurface`. The options take
`loadRecommendations`, `placeholder`, `onError`, and every `RudraComponent` prop except `spec`,
`products` and `bundles`.

## What the component does

- It reads each hint as a literal or from the agent's data model (`{ "path": "/viewing/sku" }`),
  and sends only the four. It leaves out a blank one, and one the server would turn away, like a
  `maxItems` of 40. A literal of the wrong type, like a numeric SKU, makes A2UI refuse the agent's
  whole message.
- It asks once the hints hold still for 300 ms, and keeps the last block up until the next one
  arrives. `signal` aborts when the hints change or the component unmounts.
- It checks the result against core's schemas before rendering any of it.
- It shows `placeholder` until the first load. On a failed load, a bad result or a render error it
  shows nothing and calls `onError`.
- Each component on a surface sends its own request.

## Where it runs

`@rudra-js/a2ui` holds `createRudraRecommendationsComponent` and its types, and loads only in the
browser, because `@a2ui/react` needs a DOM. The agent catalog and your endpoint import from
`@rudra-js/a2ui/server`, which runs anywhere. In Next.js a `'use client'` file still runs on the
server for the first render, so load the one that imports `@rudra-js/a2ui` from a client component
with `next/dynamic` and `ssr: false`.

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

## Licence

[MIT](./LICENSE)
