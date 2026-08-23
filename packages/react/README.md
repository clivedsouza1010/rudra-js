# @rudra/react

Renders a component specification from [`@rudra/core`](../core) as React Server
Components.

No client JavaScript. The recommendation area arrives in the initial HTML
response and needs no hydration, which is what removes the pop-in of a
client-fetched recommendation rail and what makes the content visible to a
crawler that does not run JavaScript.

```tsx
import { RudraComponent } from '@rudra/react';

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

**`products` must be catalog objects that passed `parseTrackingInput`, or ones
validated the same way.** It is a second door into the framework: `imageUrl`
lands in an `<img src>`, and the payload contract is what rejects a
`javascript:` one.

## Styling

The package ships no CSS, on purpose — a stylesheet would fight whatever your
site already has. Every element carries a class you can target:

| Class                                                                           | Element                                             |
| ------------------------------------------------------------------------------- | --------------------------------------------------- |
| `.rudra`                                                                        | the wrapper                                         |
| `.rudra__headline`, `.rudra__subheadline`                                       | the header                                          |
| `.rudra-hero`, `.rudra-grid`, `.rudra-carousel`, `.rudra-banner`, `.rudra-copy` | one per block kind                                  |
| `.rudra-card`, `.rudra-card--featured`                                          | a product, and the one the model chose to lead with |
| `.rudra-card__image`, `__title`, `__price`, `__reason`, `__badge`               | inside a product                                    |

`className` is added alongside `rudra` rather than replacing it, so the child
classes keep working.

Two attributes are worth styling against: `data-rudra-columns` on a grid carries
the column count the model chose, and `.rudra-carousel__track` is expected to
scroll horizontally — give it `overflow-x: auto`, since nothing here uses
JavaScript to scroll it.

## Replacing a renderer

Swap any block for your own design-system component. The model is not involved
and the specification does not change, so this gives it no new ability — it can
still only choose from the same fixed vocabulary.

```tsx
import { RudraComponent, extendRegistry } from '@rudra/react';

const registry = extendRegistry({
  grid: ({ block, context }) => <MyProductGrid items={block.items} context={context} />,
});

<RudraComponent spec={spec} products={catalog} registry={registry} />;
```

## Props

| Prop             | Notes                                                                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec`           | Required. From `@rudra/core`.                                                                                                                                              |
| `products`       | Required. Array or `Map`, keyed by SKU. See the warning above.                                                                                                             |
| `registry`       | Replace some or all block renderers.                                                                                                                                       |
| `hrefForSku`     | Defaults to `/product/{sku}`, URL-encoded.                                                                                                                                 |
| `formatPrice`    | Defaults to `Intl.NumberFormat`, which knows each currency's own number of decimal places.                                                                                 |
| `locale`         | Punctuates prices. Defaults to the **server's** locale, which is rarely the shopper's — pass it if you serve more than one.                                                |
| `hasDiagnostics` | Adds the provider, the model name, the latency and the model's own reasoning to the markup. Off by default: it tells a visitor which model you use and when it is failing. |
| `className`      | Added alongside `rudra`.                                                                                                                                                   |

A spec with no blocks renders nothing at all. An empty recommendation area takes
up space and tells the shopper the page is broken.

## Licence

[MIT](../../LICENSE)
