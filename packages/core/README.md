# @rudra-js/core

The contracts and logic that turn one tracking payload into one renderable
component specification.

## Install

```sh
npm install @rudra-js/core zod
```

`zod` is a peer dependency: the package's public API _is_ zod schemas, so your
application and this package must resolve the same zod instance.

## `tracking-input`

The boundary between a host application and rudra-js. rudra-js collects,
stores and aggregates nothing — the host owns its tracking pipeline and hands
the framework one JSON object per render.

```ts
import { parseTrackingInput } from '@rudra-js/core';

const input = parseTrackingInput({
  user: { id: 'shopper-1' },
  context: { surface: 'pdp', currentSku: 'TR-102' },
  signals: {
    likes: [{ sku: 'TR-104' }],
    recentSearches: ['waterproof trail shoe'],
  },
  candidates: [
    {
      sku: 'TR-102',
      title: 'Switchback Trail Shoe GTX',
      category: 'Trail Running',
      price: 174,
      imageUrl: 'https://cdn.example.com/tr-102.png', // or '/images/tr-102.png'
    },
  ],
});
```

`parseTrackingInput` throws a `ZodError`; `safeParseTrackingInput` returns a
`TrackingInputResult` instead, so a host can inspect `result.error.issues`
without importing zod itself.

### Cold start is not an error

A payload with no `signals` block is a first-time visitor, not a malformed
request. Every category defaults to `[]`, so the host needs no special case.

### What the host must supply

`user.id`, `context.surface`, and at least one entry in `candidates`.
`candidates` is the merchandising boundary: whatever the host leaves out cannot
be recommended, which is what makes it impossible to surface a product that
does not exist or is not merchandised for this shopper. SKUs must be unique.

`bundles` is optional: the sets the shop sells together, each with the shop's
own price for the set and, if you want one, your own name for it. Every product
in a set must also be a candidate — that is what lets the same checks that pass
a single product pass a whole set, and what lets the renderer look the members
up in the catalog it already has. Ids must be unique, and one set must not name
the same product twice.

The model never picks a set and is never told a price. It only asks for a
bundle block and writes the words around it; the framework picks which set when
the page is served, from what the shopper has in their basket, has looked at,
or is browsing now.

The words the model writes for that block are the one claim on the page this
framework does not check. The prompt tells it to write about the offer, not
the products in it, and never to say it saves money or by how much — but
nothing verifies that afterwards, the way every other claim on the page is
verified against your data. Pass a `label` on the bundle if you want the set
to carry a name the framework can vouch for; it renders ahead of the model's
own words, as the one part of the block that is checked.

### Defaults

| Field                      | Default             |
| -------------------------- | ------------------- |
| `schemaVersion`            | `'1'`               |
| `context.slot`             | `'recommendations'` |
| `context.locale`           | `'en-US'`           |
| `context.maxItems`         | `4`                 |
| `candidates[].currency`    | `'USD'`             |
| `candidates[].isInStock`   | `true`              |
| `candidates[].tags`        | `[]`                |
| `signals.*`                | `[]`                |
| `bundles`                  | `[]`                |
| `mostViewed[].views`       | `1`                 |
| `lastPurchased[].quantity` | `1`                 |

### Cohorts

By default one generated component is shared between shoppers who look alike,
and each shopper's own products are filled in per request. A cohort is the
shopper's segment, the surface and slot, the locale, the item count, whether
they are a first-time visitor, and the category they lean towards. Everything
that makes a person an individual — who they are, what they liked, viewed or
searched for — is left out, which is what lets many page views reuse one call.

The candidate list is part of the cohort too, because the model is shown those
products and writes about them. In most shops candidates come from the page, so
everyone looking at it shares them. A shop that picks candidates per shopper
gets smaller cohorts, which is the honest outcome: its prompt really is
personal.

Pass `generation: 'per-shopper'` to generate for the individual instead. Then
the model chooses the products too, and every shopper pays for their own call.

```ts
createComponentGenerator({ provider, generation: 'per-shopper' });
```

### Limits

Every free-text field and every array is capped, because host strings end up
inside a model prompt and a model is billed per token. The caps live in
`FIELD_LIMITS` and are exported, so a host can validate against the same
numbers rather than discovering them from a rejection.

| Limit                | Value | Applies to                                                          |
| -------------------- | ----- | ------------------------------------------------------------------- |
| `identifier`         | 128   | `sku`, `category`, `surface`, `slot`, `interaction.type`, meta keys |
| `shortText`          | 200   | `title`, `imageUrl`, `interaction.value`, meta values               |
| `searchQuery`        | 200   | `context.searchQuery`, `recentSearches[]`                           |
| `tag`                | 64    | `tags[]`                                                            |
| `tagsPerProduct`     | 20    | `tags`                                                              |
| `metaEntries`        | 50    | `interaction.meta`                                                  |
| `signalsPerCategory` | 500   | each array under `signals`                                          |
| `candidates`         | 200   | `candidates`                                                        |
| `productsPerBundle`  | 5     | `bundles[].skus`, which also needs at least 2                       |
| `bundles`            | 20    | `bundles`                                                           |

These bound each field individually; they are not an aggregate prompt budget.
Fitting a payload into a context window is `digest`'s job, and it trims rather
than throws.

### Unknown fields are rejected

Every fixed-shape object is a `strictObject`. A host that misspells
`recentSearches` gets an error, not a shopper who silently looks like a
first-time visitor. `interaction.meta` is the one dynamic shape — an open
record, minus the keys that would mutate a prototype instead of the object.

## Licence

[MIT](./LICENSE)
