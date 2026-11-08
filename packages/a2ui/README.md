# @rudra-js/a2ui

This package is part of [rudra-js](https://rudrajs.com), an open-source TypeScript library (MIT)
that you can install from npm. rudra-js uses a language model to design one product-recommendation
block for a page of your shop. The model picks the layout and writes the words. After rudra-js
checks the model's answer against your products, React renders the block with your own titles and
prices. rudra-js is not a hosted platform, a visual or low-code app builder, or a workspace you sign
up for.

You can use this package to let an [A2UI](https://a2ui.org) agent put the block into the interfaces
that it builds. This package adds a single component, `RudraRecommendations`, to the catalog your
A2UI renderer draws from. Your agent places the component and passes hints about what the shopper is
looking at. It's still up to your server to pick the products and build the block with
`@rudra-js/core`. To render the block in the browser, this package uses `@rudra-js/react`. For
Flutter, Angular or any other renderer, your server can send the block as A2UI messages instead (see
[Flutter, Angular and other renderers](#flutter-angular-and-other-renderers)).

This package works with version 0.9 of the A2UI protocol and uses `@a2ui/react` and `@a2ui/web_core`
0.14.

## Install

```sh
npm install @rudra-js/a2ui@latest @rudra-js/core@latest @rudra-js/react@latest @rudra-js/attested@latest @a2ui/react@0.14 @a2ui/web_core@0.14 react react-dom
```

To install and also to upgrade, you will need to use this same command. It doesn't matter if your
app already uses rudra-js or A2UI.
Any app that has `@rudra-js/anthropic` will also need to add `@rudra-js/anthropic@latest` to this
command.

All the `@rudra-js` packages are released together. For each package, the peer range for the others
starts at the version of that package. For a package name with no version, npm will stay inside the
range your `package.json` already has. If `@latest` is left out, an app on an older core can get an
`ERESOLVE` error. With no version on `react` and `react-dom`, npm and pnpm will keep a React 18 app
on 18.

Because everything except zod is a peer dependency, your app holds a single copy of each. On npm and
pnpm, `@rudra-js/core`, `@rudra-js/attested` and `@a2ui/web_core` will be installed for you, but not
`@a2ui/react`, `@rudra-js/react` or `react`. React can be left out on a server that only builds
[messages for other renderers](#flutter-angular-and-other-renderers), since those three are
optional. But those three have to stay in the command for the browser component to load. List the
rest anyway, because your code imports most of these itself.
With pnpm your code can only import the packages your `package.json` names. You will need the whole
list on Yarn because it doesn't install peers. It will also move a name with no version to its
latest release. So if your app already has React, leave out `react` and `react-dom` on Yarn. On
pnpm, read [zod](#zod) first.

A2UI's type declarations will fail to typecheck if you don't keep `skipLibCheck: true` in your
`tsconfig.json`. They need `"dom"` in `lib`. Two of their imports will also be refused by `nodenext`
because these have no file extension.

## Three pieces

### The catalog your agent is prompted with

Put `agentCatalog.toJson()` in your agent's prompt and have the agent create surfaces with
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

You will see a "Recursive reference detected" warning per hint from the first `toJson()` call. It's
harmless.

### Your endpoint

`shopperFor` and `candidatesFor` stand in for the session and catalog code you already have. You
will need to pass your own provider, because `provider: null` calls no model.

By default `generation` is `'cohort'`. This shares a single block design between shoppers who look
alike. In that mode the model never sees `searchQuery`. For the agent's search to matter, you need
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
  `maxItems`. Anything else will get a 400.
- `fitRecommendationRequest` will drop a SKU or category if it's not in any of your candidates.
- Pick candidates on your side instead of from the hints.
- There will be a new model call for each new category, `maxItems` or candidate set. With
  `per-shopper` this also goes for each shopper and each new SKU or search. Rate-limit the endpoint
  (see [SECURITY.md](https://github.com/clivedsouza1010/rudra-js/blob/main/SECURITY.md)).
- Send back `input.candidates` and `input.bundles` instead of your raw catalog.

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

Give the browser catalog the id of the agent catalog, because A2UI will look it up by the
`catalogId` the agent sends. Use `A2uiSurface` to render the surfaces of the processor.

`createRudraRecommendationsComponent` takes `loadRecommendations`, `placeholder` and `onError`. It
also takes all of the `RudraComponent` props except `spec`, `products` and `bundles`.

## What the component does

- It will read each hint either as a literal value or from the agent's data model, like
  `{ "path": "/viewing/sku" }`. It will only send the four hints the endpoint accepts.
- It leaves out any hint that is blank. It also leaves out a hint the server would turn away, like a
  `maxItems` of 40.
- With a literal of the wrong type, like a numeric SKU, A2UI will refuse the agent's whole message.
- It waits for the hints to stop changing for 300 ms and then calls `loadRecommendations`.
- It keeps showing the last block until the next one arrives.
- `signal` aborts when the hints change or the component unmounts.
- It will check the result against core's schemas before it renders any of it.
- It shows `placeholder` until the first load finishes.
- If a load fails or the result fails the schema check, it will show nothing and call `onError`.
  This is also what happens if the block throws while rendering.
- Each component on a surface sends its own request.

## Where it runs

`@rudra-js/a2ui` holds `createRudraRecommendationsComponent` and its types. It can only be loaded in
the browser, because `@a2ui/react` needs a DOM. For the agent catalog and your endpoint, import from
`@rudra-js/a2ui/server`. This entry point can run anywhere.

In Next.js, a `'use client'` file will also run on the server for the first render. To load the file
that imports `@rudra-js/a2ui`, you will need `next/dynamic` with `ssr: false`. This call has to be
made from a client component.

Any block an agent places won't be seen by a crawler, because A2UI renders in the browser. For a
product page, render `RudraComponent` on the server as the
[`@rudra-js/react` README](https://github.com/clivedsouza1010/rudra-js/tree/main/packages/react)
describes.

## Flutter, Angular and other renderers

`RudraRecommendations` needs a React renderer. For any other A2UI renderer, build the block on your
server as A2UI messages that use just the basic catalog. All renderers ship with this catalog. If
your server has no React, it only needs these:

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
[browser](#the-browser) pieces and keep `rudraRecommendationsApi` out of your agent's catalog,
because they are all for `RudraRecommendations`, which needs React. Use your own `surfaceId` in
place of `'rudra_recommendations'`. It must never be named in your agent's prompt.

Your app can call the endpoint with the four hints and give the messages it gets back to its A2UI
renderer. This is the safer way. Your agent's code can also call it and pass the messages on to the
client unchanged, but then the call has to carry the shopper's session because `shopperFor` reads
the shopper from the request. Either way, keep the model away from the messages and from the surface
of the block, as [SECURITY.md](https://github.com/clivedsouza1010/rudra-js/blob/main/SECURITY.md)
explains.

- These messages will create the surface named `surfaceId` and then fill it. To show a new block
  there, first send `deleteSurface` for this surface. You will get no messages if nothing in the
  block can be shown.
- Grids and carousels show two cards to a row, because the basic catalog can't fit cards to the
  screen and its `List` doesn't scroll on all renderers.
- Each product card is a button to open the product's page. By default `hrefForSku` builds the link
  as `/product/<sku>`. `shopUrl` will resolve this link and any relative image URL, because a native
  app has no page to resolve them against. If the image URL of a product is empty or only spaces, no
  image will be shown. An empty link will throw. A link or an image that doesn't end up `http` or
  `https` will also throw.
- Featured cards look like any other card and banners look the same in all tones, because the basic
  catalog has no styles for them. As nothing carries the `data-rudra-*` attributes the React block
  uses for click tracking, you will need to add a query parameter in `hrefForSku` to count clicks.
- Prices are formatted on your server for `locale`. If you leave it out, they will use the default
  locale of the server and not the shopper's. You can also pass `formatPrice` and
  `formatBundlePrice` to format prices yourself.
- All text uses a heading or caption style and never body, because the web renderers only read body
  text as Markdown. Flutter's `genui` and the A2UI SwiftUI renderer read all styles as Markdown, as
  the
  [A2UI guide](https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9_1/docs/basic_catalog_implementation_guide.md)
  asks. So square brackets become parentheses, while `<` and `>` become `‹` and `›`. Line breaks
  also become spaces. No text can load an image. Only a bare web address or email address can show
  as a link. On SwiftUI a tap will open the link, but on `genui` it does nothing and text that
  starts with `#` or `-` followed by a space shows as Markdown.
- Neither the rationale nor how the block was generated is ever sent.
- Flutter's `genui` knows the basic catalog by its id from 0.10.3. For 0.8 to 0.10.2, pass
  `catalogId: 'https://a2ui.org/specification/v0_9/basic_catalog.json'`. On Android 11 and later, a
  tap on a card will do nothing if the app doesn't declare `https` links under `<queries>` in its
  manifest.
- On `@a2ui/angular` 0.13, register the `BasicCatalog` from `@a2ui/angular/v0_9` because the catalog
  from `@a2ui/angular` has the v1.0 id. You also have to pass `useUniversalComponents: true` to
  `provideA2Ui` next to `catalogs`. If you don't, a click on a card will do nothing and all cards
  will try to open their links in a new tab as soon as they render.

## zod

This package depends on zod 3 because A2UI's schemas use zod 3, but the rest of rudra-js uses zod 4.
npm will install both, each where its own package can find it. With npm you don't need to add either
version yourself.

On pnpm, `@a2ui/react` gets core's zod 4 as its zod peer. This makes the browser example fail to
typecheck with TS2344. If your app has no zod of its own, you will need to add zod 3:

```sh
pnpm add zod@^3.25.76
```

If your app uses zod 4, you will need to remove the zod peer from `@a2ui/react` in `.pnpmfile.cjs`.
Then pnpm will give it the zod 3 it depends on:

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
