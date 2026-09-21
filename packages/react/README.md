# @rudra-js/react

Renders a component specification from
[`@rudra-js/core`](https://github.com/clivedsouza1010/rudra-js/tree/main/packages/core) as React
Server Components.

No client JavaScript. The recommendation area arrives in the initial HTML response and needs no
hydration, so it never pops in the way a client-fetched recommendation rail does, and a crawler that
doesn't run JavaScript still reads it.

## Install

```sh
npm install @rudra-js/react @rudra-js/core react zod@^4
```

Both `@rudra-js/core` and `react` are peer dependencies. The specification you pass in comes from
your copy of core, and the elements this renders have to come from the same React your app renders.
With two copies of either, you'd get a spec that fails its own type check, or a component tree React
refuses to render.

```tsx
import { RudraComponent } from '@rudra-js/react';

<RudraComponent spec={spec} products={catalog} locale="en-GB" />;
```

`spec` is what `createComponentGenerator().generate()` returned. `products` is your catalog.

## What comes from where

A rendered component rests on this split. The model decides how things are arranged and what the
words are. Every fact about a product is read from your catalog as the page is served, and whatever
the model wrote is rendered as escaped text.

| Decided by the model                                                | Decided by your catalog |
| ------------------------------------------------------------------- | ----------------------- |
| Which layout, in what order                                         | Every product title     |
| Tone, headline, the words in each block                             | Every price             |
| Only in per-shopper mode: which products, and how each is described | Every image and link    |

In the default cohort mode the framework fills in the products, their order and the reason under
each, per request, and a badge the model wrote gets dropped. The model picks those only under
`generation: 'per-shopper'`. In either mode it still chooses the product a hero names. You'll find
the full split in
[What the model decides, by mode](https://github.com/clivedsouza1010/rudra-js/tree/main/packages/core#what-the-model-decides-by-mode).

The specification has no field carrying a title, a price, an image or a URL. Product facts are
resolved at render time from `products`, keyed by a SKU reconciliation has already checked.

**Validate `products` with `productSchema` from `@rudra-js/core`**, the same schema your candidates
already passed. This prop is a second door into the framework. `imageUrl` lands in an `<img src>`,
and `productSchema` is what rejects a protocol-relative `//evil.example/pixel.png` or a `data:` URL.
It reads a path the way a browser does, so `/\evil.example/pixel.png` and the same trick written
with a tab or a newline in it are rejected too — each one resolves to someone else's host. React
neutralises a `javascript:` URL by itself, but not any of those. And if a price isn't a finite
number, it throws. A product that looks free is worse than a stack trace.

A row flagged `isInStock: false` counts as a row that isn't there. Cards for it are dropped, a hero
loses its link, and a bundle with one sold-out member disappears — the same as if you'd left the
row out. Core only ever names a product that was in stock in the payload, but this catalog is read
later and may be the fresher of the two.

## Styling

We ship no CSS. A stylesheet of ours would only fight whatever your site already has. So out of the
box the block renders as a run-on line — every card element is inline, so titles and prices sit
together with no separation. That's the starting point you style from.

Check out `examples/shop/public/demo-styles.css`. It's a working stylesheet written against nothing
but the table below, so copy it as a starting point rather than as a supported API. The example shop applies it by default, and `?styles=off`
shows you the raw markup.

Every element we emit carries a class. Here's all of them:

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

A few notes on those. `.rudra__rationale` only appears under `hasDiagnostics`.
`.rudra-bundle__label` is your own name for the set, so it shows up only for a bundle you gave a
`label`. And `className` is added alongside `rudra`, _never_ in place of it, so the child classes
keep working.

`.rudra-carousel__track` is meant to scroll horizontally, so give it `overflow-x: auto`. Nothing
here uses JavaScript to scroll it for you. `.rudra-card--featured` is applied alongside
`.rudra-card`, so write `.rudra-card--featured { ... }` after the base rule and let it layer on top.

### Attributes

The same markup carries what the model decided, so you can hang styling or analytics off it.

| Attribute                | On                             | Value                                                      |
| ------------------------ | ------------------------------ | ---------------------------------------------------------- |
| `data-rudra-slot`        | the wrapper                    | The slot the spec was generated for                        |
| `data-rudra-source`      | the wrapper                    | `llm`, `cache` or `fallback`                               |
| `data-rudra-tone`        | the wrapper                    | The tone the model chose for the component                 |
| `data-rudra-banner-tone` | a banner                       | A banner's own tone, a different vocabulary from the above |
| `data-rudra-columns`     | a grid                         | The column count the model chose                           |
| `data-rudra-sku`         | a card, hero link, bundle item | The product, for click attribution                         |
| `data-rudra-basis`       | a card                         | Why the product was picked: `most_viewed`, `popular`, …    |

We leave `data-rudra-source` public so you can read hit rate and fallback share straight off a
rendered page. Anything more specific than that appears only under `hasDiagnostics`, because it
tells a visitor what you run and when it's failing:

| Attribute               | On          | Value                                                                                                                  |
| ----------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `data-rudra-provider`   | the wrapper | The model vendor, or `none`                                                                                            |
| `data-rudra-model`      | the wrapper | The model name, or `none`                                                                                              |
| `data-rudra-latency-ms` | the wrapper | How long generation took                                                                                               |
| `data-rudra-degraded`   | the wrapper | Why it fell back: `no-provider`, `provider-error`, `timeout`, `invalid-generation`, `unusable-on-serve` or `requested` |

## Replacing a renderer

Swap any block for your own design-system component. The model isn't involved and the specification
doesn't change, so it gains nothing here. It still picks from the same fixed vocabulary it always
did.

```tsx
import { RudraComponent, extendRegistry } from '@rudra-js/react';

const registry = extendRegistry({
  grid: ({ block, context }) => <MyProductGrid items={block.items} context={context} />,
});

<RudraComponent spec={spec} products={catalog} registry={registry} />;
```

A grid, carousel or bundle block with nothing left in your catalog is dropped before any renderer
runs — yours as well as ours. The component has to decide whether to draw the wrapper and its
headline at all, and the only way to decide is to ask each block first. Hero, banner and copy always
reach the renderer, since they don't depend on the catalog.

## Props

| Prop                | Notes                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec`              | Required. From `@rudra-js/core`.                                                                                                                                                              |
| `products`          | Required. A list of products, or anything keyed by SKU. See below, and the warning above.                                                                                                     |
| `bundles`           | The sets your shop sells together. Only needed if a spec can carry a bundle block.                                                                                                            |
| `registry`          | Replace some or all block renderers.                                                                                                                                                          |
| `hrefForSku`        | Defaults to `/product/{sku}`, URL-encoded.                                                                                                                                                    |
| `formatPrice`       | Defaults to `Intl.NumberFormat`, which knows how many decimal places each currency wants. It formats products, not bundles.                                                                   |
| `formatBundlePrice` | The same for a bundle's own price, in the currency the shop put on the set. The set's price and its currency come from the same object, so members priced in another currency change nothing. |
| `locale`            | Punctuates prices. Defaults to the **server's** locale, which is rarely the shopper's, so pass it if you serve more than one.                                                                 |
| `hasDiagnostics`    | Adds the provider, the model name, the latency and the model's own reasoning to the markup. Off by default, since it tells a visitor which model you use and when it's failing.               |
| `className`         | Added alongside `rudra`.                                                                                                                                                                      |

### What `products` may be

A list of products, or anything keyed by SKU that answers `get(sku)` and `has(sku)`. A `Map` does
it, and so does your own index. Those two methods are the only ones the renderers ever call, so if
your catalog is too big to copy into a `Map` on every request, hand over a view of your own store
instead.

We look for those two methods rather than for `instanceof Map`, which is per-realm. A `Map` arriving
from a worker or a `node:vm` sandbox is a perfectly good catalog and fails `instanceof` anyway.

Anything that is neither a list nor keyed gets refused on the spot, with an error naming the prop.
That's a `Set` of products, a plain object, or a `Map` that has been through JSON. Better a loud
error than a quietly empty recommendation area.

When there's nothing left to show, the component renders nothing at all. That covers a spec with no
blocks, and one whose every product has left your catalog since it was generated. A single block
goes the same way on its own: it drops out and the rest of the component carries on without it. An
empty recommendation area, or a headline over an empty box, takes up space and tells the shopper the
page is broken.

### What `bundles` is

The sets your shop sells together, the same way `products` is your catalog. The model only asks for
a bundle block. It never invents one, and it _never_ sees a price.

You offer the sets, and the framework picks which one fills each block. That happens inside
`reconcileSpec` as the page is served, after the spec was generated rather than before, and it goes on what this
shopper has in their basket, has looked at, or is browsing right now. The spec then carries the id
it picked. This prop supplies the rest: that set's members, its price, the currency that price is
in, and your name for it, so the component has something to draw.

**Validate `bundles` with `bundleSchema` from `@rudra-js/core`, and pass the same list you sent to
`parseTrackingInput`.** Core already checked that list — every member in stock, none of them
disliked, none of them the product being looked at, no repeats, and the whole set inside the item
budget — and then hands the renderer nothing but the id it chose. Pass a stale or different list
here and you'll draw a set none of those checks ever saw, under an id that was proved against
another one.

## Licence

[MIT](./LICENSE)
