# @rudra-js/react

This package is part of [rudra-js](https://rudrajs.com).

rudra-js is an open-source TypeScript library (MIT) you install from npm. A language model designs one product-recommendation block for a page in your shop, rudra-js checks it against your catalog, and React renders it.

It is not a hosted platform, a visual or low-code app builder, or a workspace you sign up for.

This package renders a component spec with React 18 or 19. The spec is the description of the block
that [`@rudra-js/core`](https://github.com/clivedsouza1010/rudra-js/tree/main/packages/core)
generates.

The reference for [`RudraComponent`](https://rudrajs.com/reference/react/RudraComponent) and [`extendRegistry`](https://rudrajs.com/reference/react/extendRegistry) is on rudrajs.com.

The components are plain functions with no hooks, state or effects. You can render them:

- with `renderToString`
- in a client-rendered app
- as Server Components, in a setup that supports them, such as the Next.js App Router

Rendered on the server, the recommendations arrive in the initial HTML response and need no client
JavaScript. They never pop in late the way a client-fetched recommendation rail does. A crawler that
doesn't run JavaScript still reads them.

## Install

```sh
npm install @rudra-js/react@latest @rudra-js/core@latest @rudra-js/attested@latest react react-dom
```

Use this same command to install and to upgrade, whether or not your app already uses rudra-js.

- If your app has `@rudra-js/anthropic`, add it to the command with `@latest` too.
- If your app has `@rudra-js/a2ui`, use the install line in that package's README instead. It also
  names the two A2UI packages.

Keep `@latest` on every `@rudra-js` package. The packages are published together. Each one's peer
ranges on the others start at its own version. With a bare name, npm stays inside the range your
`package.json` already has. So without `@latest`, an app on an older core can get an `ERESOLVE`.

Leave `react` and `react-dom` without a version. Then npm and pnpm keep a React 18 app on 18. Do name
both of them, so npm moves each one to the newest release in its range. React 19 won't load a
`react-dom` at a different version from `react`.

`@rudra-js/core` and `react` are peer dependencies. The spec you pass in comes from your copy of core.
The elements this package renders have to come from the same React your app renders. With two copies
of core, the spec fails its own type check. With two copies of React, React refuses to render the
component tree.

`@rudra-js/attested` is core's peer dependency. npm and pnpm add it for you. Yarn doesn't. Yarn does
move a bare name to its latest version, so with Yarn, leave `react` and `react-dom` out of the command
if your app already has React.

```tsx
import { RudraComponent } from '@rudra-js/react';

<RudraComponent spec={spec} products={catalog} locale="en-GB" />;
```

`spec` is what `createComponentGenerator().generate()` returned. `products` is your catalog.

## What comes from where

The model decides how the block is laid out and what the words say. Every fact about a product is
read from your catalog when the page is served. Whatever the model wrote is rendered as escaped text.

| Decided by the model                                                | Decided by your catalog |
| ------------------------------------------------------------------- | ----------------------- |
| Which layout, in what order                                         | Every product title     |
| Tone, headline, the words in each block                             | Every price             |
| Only in per-shopper mode: which products, and how each is described | Every image and link    |

The default is cohort mode, where shoppers who look alike share one spec. In cohort mode, core
fills in the products and their order for each request. It also writes the reason under each product.
It drops any badge the model wrote. Under `generation: 'per-shopper'`, the model makes those picks
itself. In both modes, the model chooses the product a hero names. The full split is in
[What the model decides, by mode](https://github.com/clivedsouza1010/rudra-js/tree/main/packages/core#what-the-model-decides-by-mode).

The spec has no field for a title, a price, an image or a URL. The component looks up each product in
`products` by a SKU that core has already checked.

**Validate `products` with `productSchema` from `@rudra-js/core`**, the same schema the candidate
products you sent to core already passed. This prop is a second way for data to reach the page.

`imageUrl` ends up in an `<img src>`. `productSchema` rejects a protocol-relative URL such as
`//evil.example/pixel.png`, and it rejects a `data:` URL. It reads a path the way a browser does, so it
also rejects `/\evil.example/pixel.png` and the same trick written with a tab or a newline in it. A
browser resolves each of these to someone else's host. React blocks a `javascript:` URL on its own,
but none of these.

If a price isn't a finite number, rendering throws an error.

A row with `isInStock: false` counts as a row that isn't there. Its cards are dropped. A hero that
names it loses its link. A bundle with it as a member disappears. Core only names products that were
in stock in the data you sent it. This catalog is read later, so it may be the fresher of the two.

## Styling

This package ships no CSS. Unstyled, the block renders as one run-on line. Every card element is
inline, so a card's parts sit on one line with spaces between them. Nothing separates one card from
the next. You style it from there.

For a working stylesheet, see `examples/shop/public/demo-styles.css`. It uses nothing but the classes
in the table below. Copy it as a starting point. It isn't a supported API. The example shop applies
it by default, and `?styles=off` shows you the raw markup.

Every element the component renders carries a class. Here is the full list:

| Where          | Classes                                                                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The wrapper    | `.rudra`, `.rudra__header`, `.rudra__headline`, `.rudra__subheadline`, `.rudra__rationale`                                                                                                                 |
| A hero         | `.rudra-hero`, `.rudra-hero__headline`, `.rudra-hero__body`, `.rudra-hero__link`, `.rudra-hero__price`, `.rudra-hero__cta`                                                                                 |
| A grid         | `.rudra-grid`, `.rudra-grid__title`, `.rudra-grid__items`                                                                                                                                                  |
| A carousel     | `.rudra-carousel`, `.rudra-carousel__title`, `.rudra-carousel__track`                                                                                                                                      |
| A banner       | `.rudra-banner`, `.rudra-banner__text`, `.rudra-banner__cta`                                                                                                                                               |
| A copy block   | `.rudra-copy`, `.rudra-copy__title`, `.rudra-copy__body`                                                                                                                                                   |
| A bundle       | `.rudra-bundle`, `.rudra-bundle__label`, `.rudra-bundle__title`, `.rudra-bundle__body`, `.rudra-bundle__items`, `.rudra-bundle__item`, `.rudra-bundle__link`, `.rudra-bundle__price`, `.rudra-bundle__cta` |
| A product card | `.rudra-card`, `.rudra-card--featured`, `.rudra-card__image`, `.rudra-card__body`, `.rudra-card__title`, `.rudra-card__price`, `.rudra-card__reason`, `.rudra-card__badge`                                 |

A few notes on those:

- `.rudra__rationale` appears only under `hasDiagnostics`.
- `.rudra-bundle__label` holds your own name for the set. It shows up only for a bundle you gave a
  `label`.
- Your `className` is added alongside `rudra`, never in place of it, so the child classes keep
  working.
- `.rudra-carousel__track` is meant to scroll horizontally, so give it `overflow-x: auto`. No
  JavaScript scrolls it for you.
- `.rudra-card--featured` is applied alongside `.rudra-card`. Write the `.rudra-card--featured { ... }`
  rule after the base rule so it layers on top.

`.rudra-banner__cta` and `.rudra-bundle__cta` are plain text, not links or buttons. Don't style
them as buttons unless a renderer of your own wraps them in one. The hero's call to action sits inside
the product link, so that one is clickable.

Every card in a carousel is a link. Tabbing through the cards scrolls the track, so the carousel
works by keyboard even with the scrollbar hidden.

### Attributes

The markup also carries what the model decided. You can hang styling or analytics off these
attributes.

| Attribute                | On                             | Value                                                      |
| ------------------------ | ------------------------------ | ---------------------------------------------------------- |
| `data-rudra-slot`        | the wrapper                    | The slot the spec was generated for                        |
| `data-rudra-source`      | the wrapper                    | `llm`, `cache` or `fallback`                               |
| `data-rudra-tone`        | the wrapper                    | The tone the model chose for the component                 |
| `data-rudra-banner-tone` | a banner                       | A banner's own tone, a different vocabulary from the above |
| `data-rudra-columns`     | a grid                         | The column count the model chose                           |
| `data-rudra-sku`         | a card, hero link, bundle item | The product, for click attribution                         |
| `data-rudra-basis`       | a card                         | Why the product was picked: `most_viewed`, `popular`, …    |

`data-rudra-source` is always there, so you can read the cache hit rate and the fallback share
straight off a rendered page. Anything more specific appears only under `hasDiagnostics`, because it
tells a visitor what you run and when it's failing:

| Attribute               | On          | Value                                                                                                                  |
| ----------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `data-rudra-provider`   | the wrapper | The model vendor, or `none`                                                                                            |
| `data-rudra-model`      | the wrapper | The model name, or `none`                                                                                              |
| `data-rudra-latency-ms` | the wrapper | How long generation took                                                                                               |
| `data-rudra-degraded`   | the wrapper | Why it fell back: `no-provider`, `provider-error`, `timeout`, `invalid-generation`, `unusable-on-serve` or `requested` |

## Replacing a renderer

Swap any block's renderer for a component from your own design system. Only the drawing changes. The
spec, and the block kinds the model picks from, stay the same.

```tsx
import { RudraComponent, extendRegistry } from '@rudra-js/react';

const registry = extendRegistry({
  grid: ({ block, context }) => <MyProductGrid items={block.items} context={context} />,
});

<RudraComponent spec={spec} products={catalog} registry={registry} />;
```

A grid, carousel or bundle block with nothing left in your catalog is dropped before any renderer
runs, yours or ours. The rest of the blocks still render. Hero, banner and copy blocks don't
depend on the catalog, so they always reach the renderer.

## Props

| Prop                | Notes                                                                                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec`              | Required. From `@rudra-js/core`.                                                                                                                                                                                                               |
| `products`          | Required. A list of products, or anything keyed by SKU. See below, and the `productSchema` warning above.                                                                                                                                      |
| `bundles`           | The sets your shop sells together. Only needed if a spec can carry a bundle block.                                                                                                                                                             |
| `registry`          | Replaces some or all of the block renderers.                                                                                                                                                                                                   |
| `hrefForSku`        | Defaults to `/product/{sku}`, URL-encoded.                                                                                                                                                                                                     |
| `formatPrice`       | Formats product prices, not bundle prices. Defaults to `Intl.NumberFormat`, which knows how many decimal places each currency wants.                                                                                                           |
| `formatBundlePrice` | Formats a bundle's own price, in the currency the shop put on the set. Defaults to `Intl.NumberFormat`, like `formatPrice`. The price and its currency come from the same bundle object, so members priced in another currency change nothing. |
| `locale`            | Sets how prices are punctuated. Defaults to the **server's** locale, which is rarely the shopper's. Pass it if you serve more than one locale.                                                                                                 |
| `hasDiagnostics`    | Adds the provider, the model name, the latency and the model's own reasoning to the markup. Off by default.                                                                                                                                    |
| `className`         | Added alongside `rudra`.                                                                                                                                                                                                                       |

### What `products` may be

`products` is a list of products, or anything keyed by SKU that answers `get(sku)` and `has(sku)`. A
`Map` works, and so does your own index. The renderers only ever call `get`. `has` is how the
component tells a keyed catalog from a list. If your catalog is too big to copy into a `Map` on every
request, pass a view of your own store instead. The prop is typed as a `ReadonlyMap`, so in
TypeScript either implement `ReadonlyMap` or cast with `as unknown as ReadonlyMap<string, Product>`.

A `Map` from a worker or a `node:vm` sandbox works too, even though it fails `instanceof Map`.

Anything that is neither a list nor keyed is refused on the spot, with an error that names the prop.
That means a `Set` of products, a plain object, or a `Map` that has been through JSON.

When there's nothing left to show, the component renders nothing at all. That covers a spec with no
blocks, and a spec whose products have all left your catalog since it was generated.

### What `bundles` is

`bundles` lists the sets your shop sells together, the same way `products` is your catalog. The
model only asks for a bundle block. It never invents a set, and it never sees a price.

You offer the sets, and core picks which one fills each bundle block. It does this in `reconcileSpec`
as the page is served, after the spec was generated. It goes by what this shopper has in their
basket, has looked at, or is browsing right now. The spec then carries the id of the set core picked.
This prop supplies the rest, so the component has something to draw: the set's members, its price,
the currency of that price, and your name for it.

**Validate `bundles` with `bundleSchema` from `@rudra-js/core`, and pass the same list you sent to
`parseTrackingInput`.** Core checked that list before it picked a set:

- every member is in stock
- no member is one the shopper disliked
- no member is the product the shopper is viewing
- no product shows up twice
- the whole set fits in what's left of `context.maxItems`, the most products the component may show

Core then hands the renderer only the id it chose. Pass a stale or different list here and you'll
draw a set none of those checks saw, under an id that was checked against another list.

## Licence

[MIT](./LICENSE)
