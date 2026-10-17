# @rudra-js/a2ui

This package is part of [rudra-js](https://rudrajs.com).

rudra-js is an open-source TypeScript library (MIT) you install from npm. A language model designs one product-recommendation block for a page in your shop, rudra-js checks it against your catalog, and React renders it.

It is not a hosted platform, a visual or low-code app builder, or a workspace you sign up for.

This package puts that block inside the interfaces an [A2UI](https://a2ui.org) agent builds. A2UI
is an open protocol for agents that describe a UI as JSON, and a renderer in your app draws it
from a catalog of components you trust. This package adds one component to that catalog,
`RudraRecommendations`.

An agent can place the component and say what the shopper is looking at. It can't choose the
products, write the heading or name a price. Your server picks and words the recommendations with
`@rudra-js/core`, exactly as it would for a product page, and the browser checks what comes back
and renders it with `@rudra-js/react`.

It works with version 0.9 of the A2UI protocol, through `@a2ui/react` and `@a2ui/web_core` 0.14.

## Install

```sh
npm install @rudra-js/a2ui @rudra-js/core @rudra-js/react @rudra-js/attested @a2ui/react @a2ui/web_core react react-dom
```

Everything but zod is a peer dependency. A2UI keeps one set of surfaces and catalogs per page, and
React renders one tree, so there can only be one copy of each.

## Three pieces

### The catalog your agent is prompted with

```ts
import { Catalog } from '@a2ui/web_core/v0_9';
import { basicCatalog } from '@a2ui/web_core/v0_9/basic_catalog';
import { RUDRA_RECOMMENDATIONS_INSTRUCTIONS, rudraRecommendationsApi } from '@rudra-js/a2ui/server';

// The catalog your agent is prompted with. It holds no rendering code, so it runs on a server.
export const agentCatalog = new Catalog(
  'https://shop.example/a2ui/catalog.json',
  'v0.9',
  [...basicCatalog.components.values(), rudraRecommendationsApi],
  [...basicCatalog.functions.values()],
  { instructions: RUDRA_RECOMMENDATIONS_INSTRUCTIONS },
);
```

Put `agentCatalog.toJson()`, the catalog document, in your agent's prompt, and have it create surfaces with
`catalogId: agentCatalog.id`. `RUDRA_RECOMMENDATIONS_INSTRUCTIONS` tells the agent what the
component is for and not to write product facts around it. A2UI leaves a component's own
description out of the catalog JSON, so the catalog's instructions are where that goes. If your
catalog has instructions of its own, join the two.

### Your endpoint

`shopperFor` and `candidatesFor` stand for the session and catalog code you already have.

```ts
import { createComponentGenerator, parseTrackingInput } from '@rudra-js/core';
import {
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

  // The agent only hints at what the shopper is looking at. Who the shopper is,
  // what they've done and what you sell all come from your side.
  const shopper = await shopperFor(request);
  const input = parseTrackingInput({
    user: { id: shopper.id },
    context: { surface: 'assistant', locale: shopper.locale, ...asked },
    candidates: await candidatesFor(asked),
    signals: shopper.signals,
  });
  const spec = await generator.generate(input);

  const result: RecommendationResult = { spec, products: input.candidates, bundles: input.bundles };
  return Response.json(result);
}
```

A request carries at most four hints: `currentSku`, `currentCategory`, `searchQuery` and
`maxItems`, each with the bounds it has in core's `renderContextSchema`. `parseRecommendationRequest`
is strict, so a body that tries to set the shopper, the candidates, the surface or the locale gets
a 400 instead of quietly reaching your generator. The request comes from a browser, so treat every
hint as something the shopper could have typed, and a `currentSku` as a SKU that may not be yours.

Send back `input.candidates` and `input.bundles`, the parsed rows, not your raw catalog. The
`provider` is up to you. With `@rudra-js/anthropic` the model writes the wording, and the same
screening and reconciliation run as on any other page.

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

// The agent's catalog id, with the component's React implementation in it.
const shopCatalog = new Catalog<ReactCatalogComponent>(
  'https://shop.example/a2ui/catalog.json',
  'v0.9',
  [...basicCatalog.components.values(), recommendations],
  [...basicCatalog.functions.values()],
);

export const processor = new MessageProcessor<ReactCatalogComponent>([shopCatalog]);
```

Feed the processor your agent's messages and render its surfaces with `A2uiSurface`, as the
[`@a2ui/react` README](https://www.npmjs.com/package/@a2ui/react) shows.
`createRudraRecommendationsComponent` takes every `RudraComponent` prop but the three it fills in
(`spec`, `products` and `bundles`), so `locale`, `hrefForSku`, `formatPrice`, `registry` and
`className` work as they do on a product page.

## What comes from where

| Set by the agent                    | Set by your server                        | Set by your catalog  |
| ----------------------------------- | ----------------------------------------- | -------------------- |
| Where the block goes on the surface | The shopper, their signals, the locale    | Every product title  |
| `currentSku`, `currentCategory`     | Which products are candidates             | Every price          |
| `searchQuery`, `maxItems`           | The provider, and so who writes the words | Every image and link |

A hint can be a literal or bound to the agent's data model (`{ "path": "/viewing/sku" }`). When a
bound value changes, the component cancels the load in flight and asks again.

The agent can still write anything it likes into its own `Text` components beside the block.
`RUDRA_RECOMMENDATIONS_INSTRUCTIONS` asks it not to put prices or product facts there, but that's a
request to a model, not a boundary. The boundary is the block itself.

## What the component does

- It reads only the four hints. A2UI hands a component every property the agent wrote, so an
  invented `headline` or `price` is there to read; the component never reads it, and it never
  leaves the browser.
- It leaves out a hint that wouldn't pass `parseRecommendationRequest`, such as an over-long
  search, and asks with the rest. One bad hint doesn't cost the shopper the whole block.
- It shows `placeholder` while loading, and nothing by default.
- It checks what `loadRecommendations` returns before rendering any of it: the spec against core's
  spec schema, and the products and bundles against `productSchema` and `bundleSchema`. That is
  what keeps a protocol-relative `//elsewhere.example` image off the page.
- When a load fails, or returns something that fails those checks, it shows nothing and calls
  `onError` with the reason. It doesn't call it for a load it cancelled itself.
- It passes an `AbortSignal` that aborts when the hints change or the component leaves the page.

## Where it runs

The component renders in the browser only. A2UI draws its surfaces on the client, and
`@a2ui/react` can't even be imported where there is no DOM. That's why there are two entry points:

| Import from             | Holds                                                                     | Runs     |
| ----------------------- | ------------------------------------------------------------------------- | -------- |
| `@rudra-js/a2ui`        | `createRudraRecommendationsComponent`, the component's name and schema    | Browser  |
| `@rudra-js/a2ui/server` | `rudraRecommendationsApi`, its instructions, `parseRecommendationRequest` | Anywhere |

It also means a block placed by an agent isn't in your initial HTML, and a crawler won't see it.
For a product page, render `RudraComponent` on the server as the
[`@rudra-js/react` README](https://github.com/clivedsouza1010/rudra-js/tree/main/packages/react)
describes. This package is for the surfaces an agent builds.

## zod

A2UI's schemas are zod 3, and a component's schema has to be one too, so this package depends on
`zod` 3 while the rest of rudra-js uses zod 4. Both can be installed at once, and npm and pnpm put
each where the package that asked for it finds it. You don't need either one yourself.

## A2UI's declaration files

With `skipLibCheck: false` and `moduleResolution: "nodenext"`, TypeScript reports two errors in
`@a2ui/web_core` 0.14's own declarations: two relative imports in `src/v0_8/types/types.d.ts` that
leave off the file extension. They come from A2UI, not from this package, and any project that
imports `@a2ui/react` sees them. With `skipLibCheck: true` you won't.
