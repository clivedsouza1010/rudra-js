# @rudra-js/a2ui

This package is part of [rudra-js](https://rudrajs.com).

rudra-js is an open-source TypeScript library (MIT) you install from npm. A language model designs one product-recommendation block for a page in your shop, rudra-js checks it against your catalog, and React renders it.

It is not a hosted platform, a visual or low-code app builder, or a workspace you sign up for.

This package puts that block inside the interfaces an [A2UI](https://a2ui.org) agent builds. It
adds one component, `RudraRecommendations`, to the catalog your A2UI renderer draws from. The agent
places it and passes hints about what the shopper is looking at. Your server still picks the
products and builds the block with `@rudra-js/core`. The browser renders it with `@rudra-js/react`.
For Flutter, Angular or any other renderer, your server can send the block as A2UI messages
instead. See [Flutter, Angular and other renderers](#flutter-angular-and-other-renderers).

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
install `@rudra-js/core`, `@rudra-js/attested` and `@a2ui/web_core` for you, but not `@a2ui/react`,
`@rudra-js/react` or `react`. Those three are optional, so a server that only builds
[messages for other renderers](#flutter-angular-and-other-renderers) can leave React out. The
browser component can't load without them, so keep them in the command. List the rest anyway,
because your code imports most of them itself.
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

## Flutter, Angular and other renderers

`RudraRecommendations` needs a React renderer. For any other A2UI renderer, build the block on your
server as A2UI messages that use only the basic catalog, which every renderer ships. A server with
no React needs only these:

```sh
npm install @rudra-js/a2ui@latest @rudra-js/core@latest @rudra-js/attested@latest @a2ui/web_core@0.14
```

If your server has `@rudra-js/anthropic`, add `@rudra-js/anthropic@latest` to that command too.

```ts
import { buildRecommendationMessages, type RecommendationResult } from '@rudra-js/a2ui/server';

export function messagesFor(result: RecommendationResult, locale: string) {
  return buildRecommendationMessages(result, {
    surfaceId: 'rudra_recommendations',
    shopUrl: 'https://shop.example',
    locale,
  });
}
```

In [your endpoint](#your-endpoint), return `Response.json(messagesFor(result, shopper.locale))`
instead of `result`. Skip the [agent catalog](#the-catalog-your-agent-is-prompted-with) and
[browser](#the-browser) pieces, and keep `rudraRecommendationsApi` out of your agent's catalog.
Those are for `RudraRecommendations`, which needs React. Use your own `surfaceId` in place of
`'rudra_recommendations'`, and never name it in your agent's prompt.

Your app can call the endpoint with the four hints and give the messages it gets back to its A2UI
renderer. Or your agent's code can call it and pass the messages on to the client unchanged. Then
the call has to carry the shopper's session, because `shopperFor` reads the shopper from the
request. The first way is the safer one. Either way, keep the model away from the messages and
from the block's surface, as
[SECURITY.md](https://github.com/clivedsouza1010/rudra-js/blob/main/SECURITY.md) explains.

- The messages create the surface named `surfaceId` and fill it. To show a new block there, send
  `deleteSurface` for it first. When nothing in the block can be shown, you get no messages.
- Grids and carousels show two cards to a row. The basic catalog can't fit cards to the screen, and
  its `List` doesn't scroll on every renderer.
- Each product card is a button that opens the product's page. `hrefForSku` builds the link,
  `/product/<sku>` by default. `shopUrl` resolves that link and any relative image URL, because a
  native app has no page to resolve them against. A product whose image URL is empty or only
  spaces shows no image. A link that is empty, or a link or an image that doesn't end up `http` or
  `https`, throws.
- A featured card looks like any other, and a banner looks the same whatever its tone, because the
  basic catalog has no styles for them. Nothing carries the `data-rudra-*` attributes the React
  block uses for click tracking, so to count clicks, add a query parameter in `hrefForSku`.
- Prices are formatted on your server, for `locale`. Without it, they use the server's default
  locale, not the shopper's. Pass `formatPrice` and `formatBundlePrice` to format them yourself.
- All text uses a heading or caption style, never body, because the web renderers read only body
  text as Markdown. Flutter's `genui` and the A2UI SwiftUI renderer read every style as Markdown, as
  the
  [A2UI guide](https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9_1/docs/basic_catalog_implementation_guide.md)
  asks. So square brackets become parentheses, `<` and `>` become `‹` and `›`, and line breaks
  become spaces. No text can load an image, and only a bare web address or email address can show
  as a link. On SwiftUI a tap opens it. On `genui` it does nothing, and text that starts with `# `
  or `- ` shows as Markdown.
- The rationale and how the block was generated are never sent.
- Flutter's `genui` knows the basic catalog by its id from 0.10.3. For 0.8 to 0.10.2, pass
  `catalogId: 'https://a2ui.org/specification/v0_9/basic_catalog.json'`. On Android 11 and later,
  the app has to declare `https` links under `<queries>` in its manifest, or a tap on a card does
  nothing.
- On `@a2ui/angular` 0.13, register the `BasicCatalog` from `@a2ui/angular/v0_9`, because the one
  from `@a2ui/angular` has the v1.0 id. Pass `useUniversalComponents: true` to `provideA2Ui` too,
  next to `catalogs`. Without it, a click on a card does nothing, and each card tries to open its
  link in a new tab as soon as it renders.

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
