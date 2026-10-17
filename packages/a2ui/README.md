# @rudra-js/a2ui

This package is part of [rudra-js](https://rudrajs.com).

rudra-js is an open-source TypeScript library (MIT) you install from npm. A language model designs one product-recommendation block for a page in your shop, rudra-js checks it against your catalog, and React renders it.

It is not a hosted platform, a visual or low-code app builder, or a workspace you sign up for.

This package puts that block inside the interfaces an [A2UI](https://a2ui.org) agent builds. A2UI
is an open protocol for agents that describe a UI as JSON, and a renderer in your app draws it
from a catalog of components you trust. This package adds one component to that catalog,
`RudraRecommendations`.

An agent can place the component and hint at what the shopper is looking at. It can't choose the
products, write the block or name a price. Your server picks and words the recommendations with
`@rudra-js/core`, exactly as it would for a product page, and the browser checks what comes back
and renders it with `@rudra-js/react`.

It works with version 0.9 of the A2UI protocol, through `@a2ui/react` and `@a2ui/web_core` 0.14.

> **Not on npm yet.** The package is in the repository but hasn't been published, so the install
> below fails until the first release that includes it.

## Install

```sh
npm install @rudra-js/a2ui @rudra-js/core @rudra-js/react @rudra-js/attested @a2ui/react @a2ui/web_core react react-dom
```

Everything but zod is a peer dependency. A2UI keeps one set of surfaces and catalogs per page, and
React renders one tree, so there can only be one copy of each. With pnpm, read [zod](#zod) first.

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

Put `agentCatalog.toJson()`, the catalog document, in your agent's prompt, and have it create
surfaces with `catalogId: agentCatalog.id`. `RUDRA_RECOMMENDATIONS_INSTRUCTIONS` tells the agent
what the component is for and not to write product facts around it. A2UI leaves a component's own
description out of the catalog JSON, so the catalog's instructions are where that goes. If your
catalog has instructions of its own, join the two.

The first `toJson()` logs a few "Recursive reference detected ... Defaulting to any" warnings from
the JSON Schema generator A2UI uses, one per hint. They come from the function-call form a hint can
take, and they're harmless: the document still says what each hint accepts.

### Your endpoint

`shopperFor` and `candidatesFor` stand for the session and catalog code you already have.
`candidatesFor` has to return at least one product. The candidates come from your side, such as a
merchandising set or your catalog, not from the agent's hints.

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

  // The agent only hints at what the shopper is looking at. Who the shopper is,
  // what they've done and what you sell all come from your side.
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

A request carries at most four hints: `currentSku`, `currentCategory`, `searchQuery` and
`maxItems`, each with the bounds it has in core's `renderContextSchema`.
`parseRecommendationRequest` is strict, so a body that tries to set the shopper, the candidates, the surface or the locale gets
a 400 instead of quietly reaching your generator.

The hints come from the agent, and anyone can call your endpoint with any hints at all, so treat
each one as something a shopper could have typed. `fitRecommendationRequest` keeps a `currentSku`
or a `currentCategory` only when one of your candidates carries it, and returns the four hints and
nothing else. That matters for cost as well as sense. In core's default cohort mode the category,
`maxItems` and the set of candidate SKUs are all part of the cache key, so an open-ended set of any
of them is an open-ended number of model calls. That's why the example picks candidates on your
side rather than from the hints: pick them from a search or a SKU, and every distinct value is a
new cohort. Dropping a `currentSku` none of your candidates has costs nothing in cohort mode, since
core only uses it there to keep that product off the block, and a product that isn't a candidate
can't be on it. With `generation: 'per-shopper'` it also tells the model what the shopper is
looking at; to keep that, add the product to the candidates after looking it up in your own
catalog. Put a rate limit in front of the endpoint too, as the cohort cost note in
[SECURITY.md](../../SECURITY.md) asks of any page that can cost a model call.

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

| Set by the agent                          | Set by your server                        | Set by your catalog  |
| ----------------------------------------- | ----------------------------------------- | -------------------- |
| Where the block goes on the surface       | The shopper, their signals, the locale    | Every product title  |
| `currentSku`, `currentCategory`, if yours | Which products are candidates             | Every price          |
| `searchQuery`, `maxItems`                 | The provider, and so who writes the words | Every image and link |

Each hint can be a literal or bound to the agent's data model (`{ "path": "/viewing/sku" }`).

The hints aren't instructions, but some of them are words a model reads, quoted as data the way a
shopper's own search is. In core's default cohort mode that's only the category, and after
`fitRecommendationRequest` it's one of your own. The SKU only keeps that product off the block, and
the search changes nothing unless your endpoint uses it. With `generation: 'per-shopper'` the SKU
and the search reach the prompt too, so a hostile or prompt-injected agent can try to sway the
wording of the block through them, within the limits [SECURITY.md](../../SECURITY.md) describes for
shopper text. It can't change the products, the prices, the images or the links.

The agent can still write anything it likes into its own `Text` components beside the block.
`RUDRA_RECOMMENDATIONS_INSTRUCTIONS` asks it not to put prices or product facts there, but that's a
request to a model, not a boundary. The boundary is the block itself.

## What the component does

- It reads only the four hints, and only the ones the agent still writes. A2UI hands a component
  every property the agent wrote, and keeps a value after the agent stops writing it, so an
  invented `headline` or `price` is there to read; the component never reads it, and it never
  leaves the browser.
- It leaves out a hint that wouldn't pass `parseRecommendationRequest`, such as a `maxItems` of 40
  or an over-long search, and asks with the rest. A2UI checks each hint's type before that, though:
  a hint that is neither a binding nor the right type, such as a SKU written as a number, gets the
  agent's whole message refused, the agent's own components included.
- It asks once the hints have held still for 300 ms, the first time too. A data model the agent
  sends within 300 ms of the components, as one sent right after them usually is, makes it into
  the first request; one that comes later means a second request once it has settled. A search
  bound to a text field asks once the shopper pauses, not once per keystroke. A bound hint with no
  value, yet or any more, is left out of the request, and so is an empty or blank search.
- When the hints change, the last block stays up until the new one arrives, and a result for hints
  that have since changed is dropped. If the hints come back to the ones on screen, it doesn't ask
  again.
- It shows `placeholder` until the first load finishes, and nothing by default. After a failed
  load it shows nothing until the hints change.
- It checks what `loadRecommendations` returns before rendering any of it: the spec against core's
  spec schema, and the products and bundles against `productSchema` and `bundleSchema`. That is
  what keeps a protocol-relative `//elsewhere.example` image off the page.
- When a load fails, a result fails those checks, or the block throws while rendering (from a
  custom `hrefForSku`, say), it shows nothing in its place and calls `onError` with the reason. The
  rest of the surface stays. It doesn't call `onError` for a load it cancelled itself.
- It passes an `AbortSignal` that aborts when the hints change or the component leaves the page.
- Each `RudraRecommendations` on a surface loads on its own, so an agent that places a dozen asks a
  dozen times. Your endpoint's rate limit is what bounds that.

## Where it runs

The component renders in the browser only. A2UI draws its surfaces on the client, and
`@a2ui/react` can't even be imported where there is no DOM. That's why there are two entry points:

| Import from             | Holds                                                                  | Runs     |
| ----------------------- | ---------------------------------------------------------------------- | -------- |
| `@rudra-js/a2ui`        | `createRudraRecommendationsComponent`, the component's name and schema | Browser  |
| `@rudra-js/a2ui/server` | `rudraRecommendationsApi`, its instructions, and the request functions | Anywhere |

It also means a block placed by an agent isn't in your initial HTML, and a crawler won't see it.
For a product page, render `RudraComponent` on the server as the
[`@rudra-js/react` README](https://github.com/clivedsouza1010/rudra-js/tree/main/packages/react)
describes. This package is for the surfaces an agent builds.

## zod

A2UI's schemas are zod 3, and a component's schema has to be one too, so this package depends on
`zod` 3 while the rest of rudra-js uses zod 4. With npm that's all there is to it: npm installs
both and puts each where the package that asked for it finds it, and you don't need either one
yourself.

pnpm needs one more step. `@a2ui/react` asks for zod 3 as a peer, and pnpm hands it the zod 4 that
core brings, so the browser example above stops typechecking (TS2344: `ReactCatalogComponent` does
not satisfy `ComponentApi`). If your app has no zod of its own, add zod 3 to it:

```sh
pnpm add zod@^3.25.76
```

If your app uses zod 4 itself, take the peer away from `@a2ui/react` in a `.pnpmfile.cjs`, and pnpm
gives it the zod 3 it depends on:

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

With `skipLibCheck: false`, TypeScript checks A2UI's own declarations as well, and two things in
them may trip it. They use DOM types, so a server project without `"dom"` in `lib` gets dozens of
errors from importing `@rudra-js/a2ui/server` alone: the server entry names A2UI's types, and
those name lit's. And with `"dom"` in `lib` and `moduleResolution: "nodenext"`, two errors remain in
`@a2ui/web_core` 0.14: two relative imports in `src/v0_8/types/types.d.ts` that leave off the file
extension. Both come from A2UI, not from this package, and any project that imports
`@a2ui/web_core` sees them. With `skipLibCheck: true` you won't.
