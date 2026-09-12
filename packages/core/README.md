# @rudra-js/core

The contracts and logic that turn one tracking payload into one renderable
component specification.

## Install

```sh
npm install @rudra-js/core zod@^4
```

`zod` is a peer dependency: the package's public API _is_ zod schemas, so your
application and this package must resolve the same zod instance. **zod 4 is
required** — the schemas use zod 4 APIs, and installing into a zod 3 app fails
with `ERESOLVE` rather than anything more helpful.

## Running without a model

`createComponentGenerator` takes a `provider`. Leave it out, or pass `null`, and
nothing calls a model and nothing is billed:

```ts
const generator = createComponentGenerator({ provider: null });
const spec = await generator.generate(input);
```

That is a supported configuration rather than a stub. It is the control arm of
the benchmark, and the right setting for anyone who has not yet decided on a
provider. `generate` returns a promise either way, so the shape of your code
does not change when you add one.

The deterministic component emits exactly one **grid** block — or nothing, when
no candidate is in stock — with a headline from a fixed set of four. Every other
block kind in the vocabulary (hero, carousel, banner, copy, bundle) only ever
comes from a model. If you are wiring bundles and none appear, that is why, and
not your catalog.

To render a spec you wrote yourself, without a model, pass
`createFixedSpecProvider(spec)` as the provider. It answers every request with
that spec, which is how the tests exercise blocks the deterministic component
never emits.

## Options

Everything `createComponentGenerator` takes, and what it does without it.

| Option           | What it does                                                                                         | Default                   |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ------------------------- |
| `provider`       | The model adapter. `null` runs without a model and bills nothing.                                    | `null`                    |
| `cache`          | Where generated specs are kept between requests. Pass `createNullSpecCache()` to keep none.          | `createMemorySpecCache()` |
| `generation`     | `'cohort'` shares one component between shoppers who look alike; `'per-shopper'` generates for each. | `'cohort'`                |
| `rank`           | `'signals'` orders products by this shopper's signals; `'given'` keeps the order you sent.           | `'signals'`               |
| `modelTimeoutMs` | How long the model gets. Past this the request is aborted and the deterministic component renders.   | `1500`                    |
| `cacheTimeoutMs` | How long a cache read gets. Past this the request generates as if the store had nothing.             | `50`                      |
| `onEvent`        | Called once per `generate` with a `GenerationEvent`. A hook that throws is swallowed.                | none                      |

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
`candidates` is the merchandising boundary. Every SKU the model writes is looked
up in that list, and one that is not on it is dropped by reconciliation before
anything renders — so a product you left out does not reach the page. SKUs must
be unique.

`bundles` is optional: the sets the shop sells together, each with the shop's
own price for the set, the currency that price is in, and, if you want one,
your own name for it. Every product in a set must also be a candidate — that is
what lets the same checks that pass a single product pass a whole set, and what
lets the renderer look the members up in the catalog it already has. Ids must be
unique, and one set must not name the same product twice.

The model never picks a set and is never told a price. It only asks for a
bundle block and writes the words around it; the framework picks which set when
the page is served, from what the shopper has in their basket, has looked at,
or is browsing now.

Every word the model writes is read for claims: the headline, the subheadline,
a hero, a banner, a block title, the copy block, the reason under a product,
and the words around the set. Text you supplied is never read this way — a
product title, a category and a bundle `label` are your words, not the model's.

The framework drops text that makes a claim it cannot check. It looks for
money, a customer score, a delivery date and a count of what is left, and it
leaves a specification alone even when the specification has a number in it.
Spotting one is not a guarantee, the way checking a price against your catalog
is. A field that cannot be empty — a headline, a banner's text — is emptied
instead of nulled, so the block drops the way any block with no text drops, and
an emptied page headline makes the whole generation unusable.

For the set the prompt also tells the model to write about the offer, not the
products in it, and never to say the set saves money or by how much. Pass a
`label` on the bundle to put your own words on the set: a label is text you
wrote, not text the model wrote, and it renders ahead of the model's words.

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
| `bundles[].currency`       | `'USD'`             |
| `mostViewed[].views`       | `1`                 |
| `lastPurchased[].quantity` | `1`                 |

`context.locale` has to be a single language tag, such as `en-US`. One tag, not
a list and not an `Accept-Language` header.

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

#### What you put in `segment`

`segment` is sent to the model exactly as you wrote it, in both modes, and the
contract takes any string up to 128 characters. Use plain merchandising labels —
`lapsed`, `high-value`, `trial`, `wholesale`. Keep out anything that says
something protected about a person: health, race, ethnic origin, religion or
belief, sex life or sexual orientation, politics, union membership, biometric or
genetic data.

The same applies to `recentSearches`, `context.searchQuery` and
`interaction.type` in per-shopper mode. Those three are shopper text, and they
are sent as written. What a shopper types is theirs; what you label them with is
your choice.

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
| `localeTag`          | 35    | `context.locale`, which also has to be one language tag             |
| `maxItems`           | 12    | `context.maxItems`, which also needs at least 1                     |

These bound each field individually; they are not an aggregate prompt budget.
Fitting a payload into a context window is `digest`'s job, and it trims rather
than throws.

### Unknown fields are rejected

Every fixed-shape object is a `strictObject`. A host that misspells
`recentSearches` gets an error, not a shopper who silently looks like a
first-time visitor. `interaction.meta` is the one dynamic shape — an open
record, minus the keys that would mutate a prototype instead of the object.

## Bringing your own ranking

By default this orders the products for you, scoring each candidate against the
shopper's signals. If you already have a recommender you trust — bought
together, an engine trained on your orders, a merchandiser's hand-picked row —
pass `rank: 'given'` and the order you sent is the order that renders.

```ts
const generator = createComponentGenerator({ provider, rank: 'given' });
```

You keep the rest either way. Products the shopper must not be shown are still
dropped: out of stock, already bought, in the basket, disliked, and the one
being looked at. Every product still carries a basis that reconciliation checks
against the shopper's real signals, and everything the model writes is still
screened.

Each candidate can carry its own `reason`, which is the phrase shown under the
product. Use it when your ranking knows something the signals do not:

```ts
candidates: [
  {
    sku: 'A-2',
    title: 'Enamel dutch oven',
    category: 'Cookware',
    price: 89,
    reason: 'Bought together with your skillet',
  },
];
```

A reason you supply is your own words, like the title, so it is rendered as
written and not screened. Without one, the basis is stated for you from the
shopper's signals.

## What the model sees

The two generation modes send different things. Cohort is the default.

### Cohort mode

- the surface and the slot
- the locale
- the segment, when you set one
- the category being browsed (`context.currentCategory`)
- the name of the category the shopper leans towards most — the name only, the
  score stays behind
- whether this shopper has no history at all
- how many products the component may place (`context.maxItems`)
- the candidate list: one line per product, with its SKU, title, category,
  rating and tags

### Per-shopper mode

Everything above, and:

- the SKU being looked at right now
- the current search
- whether this is a returning shopper
- liked SKUs, and disliked SKUs
- purchased SKUs, and what is in the basket
- the most-viewed SKUs, each with its view count
- recent searches
- every category they lean towards, strongest first
- the other kinds of interaction, each with a count

### Left out of both

- `user.id`
- every timestamp (`at`) — used to sort signals, then dropped
- dwell time (`dwellMs`) — added up in the digest, left out of the prompt
- every price, and every currency
- `imageUrl`
- `interaction.value` and `interaction.meta` — the model is told which kinds of
  interaction happened and how often, and no more

The candidate list is trimmed on the way out: an out-of-stock product is dropped,
and at most 60 products go, in the order you supplied them.

`spec-cache.test.ts` walks every field of the digest and checks each one is
either in the cohort key or scrubbed from the cohort prompt. A field the key
leaves out that still changes the prompt fails that test. Adding a field to the
digest fails it too, until someone says which side the field is on.

## What the model decides, by mode

What the model wrote and what is replaced before the page is served. Cohort is
the default.

| Decision                           | Cohort, the default                     | Per-shopper                            |
| ---------------------------------- | --------------------------------------- | -------------------------------------- |
| Layout and block order             | The model                               | The model                              |
| Headline, subheadline, copy        | The model                               | The model                              |
| Emphasis per item                  | The model                               | The model                              |
| Badge text                         | Dropped — written for another product   | The model                              |
| Which products, and in what order  | Filled in per request, not by the model | The model, from your candidates        |
| The reason and basis per product   | Filled in per request, not by the model | The model, checked against the signals |
| Which bundle, of the ones you pass | Chosen per request, not by the model    | Chosen per request, not by the model   |

In cohort mode the grid and carousel items are filled in per request, best pick
first, so a component written for one shopper still fits the next. The hero is
the exception: it keeps the product the model named, because its headline and
body were written about that product and swapping it would leave copy about
something else. Reconciliation drops the link and keeps the words if the product cannot be
placed: this shopper cannot see it — out of stock, not a candidate, disliked,
already bought, in the basket, or the one being looked at — or an earlier block
already placed it, or the item budget ran out before the hero was reached.

## Any provider

A provider is three things:

```ts
export interface ComponentProvider {
  /** Short identifier recorded on every generated spec, e.g. 'anthropic'. */
  readonly name: string;
  /** Concrete model identifier, e.g. 'claude-opus-5'. */
  readonly model: string;
  generate(request: ProviderRequest): Promise<ProviderResult>;
}
```

`createComponentGenerator({ provider })` takes any object of that shape — a
hosted API, a model you run yourself, a deployment inside your own tenancy, or a
recorded fixture. `@rudra-js/core` depends on no vendor SDK.
`@rudra-js/anthropic` is one adapter, not a requirement, and `provider: null` is
the default that costs nothing.

An adapter takes its API key as an option, so you choose where the key comes
from. `ANTHROPIC_API_KEY` is the name the example shop uses for its own
convenience. No package here reads the environment.

## The cache

`cache` defaults to an in-process store. `createMemorySpecCache()` keeps an entry
for `ttlMs` — 60,000 milliseconds by default, so one minute — and holds up to
`maxEntries`, 10,000 by default. Once it is full, the entry read longest ago goes
first.

An entry holds the generated spec and `generatedAt`, the epoch milliseconds when
the model produced it. That is the whole of it — no payload, no shopper, no
prompt.

The port is two methods, and an optional third:

```ts
export interface SpecCache {
  get(key: string): Promise<CachedSpec | undefined>;
  set(key: string, cached: CachedSpec): Promise<void>;
  delete?(key: string): Promise<void>;
}
```

Pass your own store — Redis, Memcached, whatever you already run — and it keeps
entries on its own terms. What that store holds, and for how long, is yours to
declare to your users, because this package does not set it. Pass
`createNullSpecCache()` to store nothing at all.

### When a generation is wrong

Pass `provider: null` and nothing new is generated; every page renders the
deterministic component. Shorten `ttlMs` and a bad entry ends sooner. A store
with `delete` can drop one entry by the `key` on its `GenerationEvent`, and the
next request generates again. Per-shopper entries end only by TTL, because
nothing maps a shopper to their keys.

## Watching it in production

The generator never fails a render, so a provider that has been down for a
week only shows as plainer pages. The way to know is `onEvent`: every call to
`generate` that gets past input validation reports exactly one
`GenerationEvent`, and these are the numbers to keep from it. A payload that
fails `parseTrackingInput` throws instead, and reports nothing.

- **Fallback share** — the share of events with `source: 'fallback'`. Alert
  when it climbs. `degradedReason` says which way the call failed, and `error`
  carries what was thrown when the reason is `'provider-error'` or `'timeout'`.
- **Cache hit rate** — `cache: 'hit'` over the events that have a `cache`
  field. A store that is down now shows as `cache: 'error'`, and a slow one as
  `cache: 'timeout'`, rather than as a rising bill.
- **Spend** — sum `usage` over the events where `calledModel` is true.
  Requests that joined an in-flight generation carry the same `usage`, so
  summing over every event counts one call many times.

## Licence

[MIT](./LICENSE)
