# @rudra-js/react

Renders a component specification from
[`@rudra-js/core`](https://github.com/clivedsouza1010/rudra-js/tree/main/packages/core) as React Server
Components.

No client JavaScript. The recommendation area arrives in the initial HTML
response and needs no hydration, which is what removes the pop-in of a
client-fetched recommendation rail and what makes the content visible to a
crawler that does not run JavaScript.

## Install

```sh
npm install @rudra-js/react @rudra-js/core react
```

Both `@rudra-js/core` and `react` are peer dependencies: the specification you pass
in comes from your copy of core, and the elements this renders have to come from
the same React your app renders. Two copies of either would mean a spec that
fails its own type check, or a component tree React refuses to render.

```tsx
import { RudraComponent } from '@rudra-js/react';

<RudraComponent spec={spec} products={catalog} locale="en-GB" />;
```

`spec` is what `createComponentGenerator().generate()` returned. `products` is
your catalog.

## What comes from where

This split is the reason a generated component is safe to put in a page.

| Decided by the model                       | Decided by your catalog |
| ------------------------------------------ | ----------------------- |
| Which layout, in what order                | Every product title     |
| Which products, and how they are described | Every price             |
| Tone, headline, badge text                 | Every image and link    |

The specification has no field carrying a title, a price, an image or a URL.
Product facts are resolved at render time from `products`, keyed by a SKU
reconciliation has already checked. Everything the model writes is rendered as
text and escaped by React.

**Validate `products` with `productSchema` from `@rudra-js/core`** — the same
schema your candidates already passed. It is a second door into the framework:
`imageUrl` lands in an `<img src>`, and `productSchema` is what rejects a
protocol-relative `//evil.example/pixel.png` or a `data:` URL. React neutralises
a `javascript:` URL by itself, but not those. A price that is not a finite
number throws rather than rendering the product as free.

## Styling

The package ships no CSS, on purpose — a stylesheet would fight whatever your
site already has. Every element it emits carries a class, and this is all of
them:

| Where          | Classes                                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The wrapper    | `.rudra`, `.rudra__header`, `.rudra__headline`, `.rudra__subheadline`, `.rudra__rationale`                                                                                 |
| A hero         | `.rudra-hero`, `.rudra-hero__headline`, `.rudra-hero__body`, `.rudra-hero__link`, `.rudra-hero__price`, `.rudra-hero__cta`                                                 |
| A grid         | `.rudra-grid`, `.rudra-grid__title`, `.rudra-grid__items`                                                                                                                  |
| A carousel     | `.rudra-carousel`, `.rudra-carousel__title`, `.rudra-carousel__track`                                                                                                      |
| A banner       | `.rudra-banner`, `.rudra-banner__text`, `.rudra-banner__cta`                                                                                                               |
| A copy block   | `.rudra-copy`, `.rudra-copy__title`, `.rudra-copy__body`                                                                                                                   |
| A product card | `.rudra-card`, `.rudra-card--featured`, `.rudra-card__image`, `.rudra-card__body`, `.rudra-card__title`, `.rudra-card__price`, `.rudra-card__reason`, `.rudra-card__badge` |

`.rudra__rationale` only appears under `hasDiagnostics`. `className` is added
alongside `rudra` rather than replacing it, so the child classes keep working.

Two of these need something from you. `.rudra-carousel__track` is expected to
scroll horizontally — give it `overflow-x: auto`, since nothing here uses
JavaScript to scroll it. `.rudra-card--featured` is applied alongside
`.rudra-card`, so write it as `.rudra-card--featured { ... }` after the base
rule rather than instead of it.

### Attributes

The same markup carries what the model decided, for styling and for analytics.

| Attribute                | On                | Value                                                      |
| ------------------------ | ----------------- | ---------------------------------------------------------- |
| `data-rudra-slot`        | the wrapper       | The slot the spec was generated for                        |
| `data-rudra-source`      | the wrapper       | `llm`, `cache` or `fallback`                               |
| `data-rudra-tone`        | the wrapper       | The tone the model chose for the component                 |
| `data-rudra-banner-tone` | a banner          | A banner's own tone, a different vocabulary from the above |
| `data-rudra-columns`     | a grid            | The column count the model chose                           |
| `data-rudra-sku`         | a card, hero link | The product, for click attribution                         |
| `data-rudra-basis`       | a card            | Why the product was picked — `most_viewed`, `popular`, …   |

`data-rudra-source` is public on purpose: hit rate and fallback share can be
read straight off a rendered page. Everything more specific appears only under
`hasDiagnostics`, since it tells a visitor what you run and when it is failing:

| Attribute               | On          | Value                         |
| ----------------------- | ----------- | ----------------------------- |
| `data-rudra-provider`   | the wrapper | The model vendor, or `none`   |
| `data-rudra-model`      | the wrapper | The model name, or `none`     |
| `data-rudra-latency-ms` | the wrapper | How long generation took      |
| `data-rudra-degraded`   | the wrapper | Why it fell back, when it did |

## Replacing a renderer

Swap any block for your own design-system component. The model is not involved
and the specification does not change, so this gives it no new ability — it can
still only choose from the same fixed vocabulary.

```tsx
import { RudraComponent, extendRegistry } from '@rudra-js/react';

const registry = extendRegistry({
  grid: ({ block, context }) => <MyProductGrid items={block.items} context={context} />,
});

<RudraComponent spec={spec} products={catalog} registry={registry} />;
```

## Props

| Prop             | Notes                                                                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec`           | Required. From `@rudra-js/core`.                                                                                                                                           |
| `products`       | Required. A list of products, or anything keyed by SKU. See below, and the warning above.                                                                                  |
| `registry`       | Replace some or all block renderers.                                                                                                                                       |
| `hrefForSku`     | Defaults to `/product/{sku}`, URL-encoded.                                                                                                                                 |
| `formatPrice`    | Defaults to `Intl.NumberFormat`, which knows each currency's own number of decimal places.                                                                                 |
| `locale`         | Punctuates prices. Defaults to the **server's** locale, which is rarely the shopper's — pass it if you serve more than one.                                                |
| `hasDiagnostics` | Adds the provider, the model name, the latency and the model's own reasoning to the markup. Off by default: it tells a visitor which model you use and when it is failing. |
| `className`      | Added alongside `rudra`.                                                                                                                                                   |

### What `products` may be

A list of products, or anything keyed by SKU that answers `get(sku)` and
`has(sku)` — a `Map`, or your own index. Those two methods are the only ones the
renderers call, so a shop with a catalog too large to copy into a `Map` on every
request can pass a view over its own store instead.

The check is on those two methods rather than on `instanceof Map`, which is
per-realm: a `Map` arriving from a worker or a `node:vm` sandbox is a perfectly
good catalog and fails `instanceof`. Anything that is neither a list nor keyed —
a `Set` of products, a plain object, a `Map` that has been through JSON — is
refused on the spot with an error naming the prop, rather than quietly rendering
an empty recommendation area.

The component renders nothing at all when there is nothing to show — a spec with
no blocks, or one whose every product has left your catalog since it was
generated. An empty recommendation area, or a headline over an empty box, takes
up space and tells the shopper the page is broken.

## Licence

[MIT](./LICENSE)
