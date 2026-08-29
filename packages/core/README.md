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
| `mostViewed[].views`       | `1`                 |
| `lastPurchased[].quantity` | `1`                 |

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
