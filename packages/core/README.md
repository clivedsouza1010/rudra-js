# @rudra-js/core

The contracts and logic that turn one tracking payload into one renderable
component specification.

## Install

```sh
npm install @rudra-js/core @rudra-js/attested zod@^4
```

Two peer dependencies, for two different reasons.

`zod` is a peer because the public API of this package _is_ zod schemas, so your
app and the package have to resolve the same copy of zod. **zod 4.5 or later is
required**, which is what the peer range asks for. The schemas use zod 4 APIs,
and installing into a zod 3 app fails with `ERESOLVE`, which isn't the most
helpful error you'll ever read. The floor is 4.5 rather than 4.0 because 4.5
changed how a nullable field is written into the tool schema we send the model.

`@rudra-js/attested` is a peer for the opposite reason: none of its types cross
this package's public surface, and you never have to import it. It's a peer so
there is exactly one denylist in your tree. As a real dependency, an app that
pins its own copy gets two — we checked, and npm 10.9.4 installs the app's
version at the top and quietly nests ours under `@rudra-js/core` — and the two
would then disagree about what counts as a claim. As a peer that same pin is an
`ERESOLVE` you can see and fix. Pin nothing and the tree is identical either
way: one copy, at the top. One tag publishes every `@rudra-js` package at one
version, so the ranges here always move together.

## Running without a model

`createComponentGenerator` takes a `provider`. Leave it out, or pass `null`, and
nothing calls a model and nothing gets billed:

```ts
const generator = createComponentGenerator({ provider: null });
const spec = await generator.generate(input);
```

This is a supported setting, not a stub. It's the control arm of the benchmark,
and it's the right one until you've settled on a provider. `generate` returns a
promise either way, so your code keeps its shape when you add one.

The deterministic component emits exactly one **grid** block, with a headline
from a fixed set of four, or no blocks at all when there's nothing left to show.
That happens when no candidate is in stock, and equally when every one of them
is ruled out for this shopper.
Every other block kind in the vocabulary (hero, carousel, banner, copy, bundle)
only ever comes from a model. So if you're wiring up bundles and none of them
appear, that's why. It isn't your catalog.

Want to render a spec you wrote yourself, still without a model? Pass
`createFixedSpecProvider(spec)` as the provider and it answers every request with
that spec. That's how our tests exercise the blocks the deterministic component
never emits.

## Options

Everything `createComponentGenerator` takes, and what you get if you leave it
out.

| Option           | What it does                                                                                    | Default                   |
| ---------------- | ----------------------------------------------------------------------------------------------- | ------------------------- |
| `provider`       | The model adapter. `null` runs without a model and bills nothing.                               | `null`                    |
| `cache`          | Where generated specs live between requests. Pass `createNullSpecCache()` to keep none.         | `createMemorySpecCache()` |
| `generation`     | `'cohort'` shares one component between shoppers who look alike; `'per-shopper'` does each one. | `'cohort'`                |
| `rank`           | `'signals'` orders products by the shopper's signals; `'given'` keeps the order you sent.       | `'signals'`               |
| `modelTimeoutMs` | How long the model gets. Past that, we abort the request and render the deterministic one.      | `1500`                    |
| `cacheTimeoutMs` | How long a cache read gets. Past that, the request generates as if the store had nothing.       | `50`                      |
| `onEvent`        | Called once per `generate` with a `GenerationEvent`. If your hook throws, we swallow it.        | none                      |

## `tracking-input`

The boundary between your application and rudra-js. We collect nothing, store
nothing, aggregate nothing. You own your tracking pipeline and hand us one JSON
object per render.

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

`parseTrackingInput` throws a `ZodError`. If you'd rather not catch,
`safeParseTrackingInput` hands you a `TrackingInputResult` instead, so you can
read `result.error.issues` without importing zod yourself.

### Cold start is not an error

A payload with no `signals` block is a first-time visitor, not a malformed
request. Every category defaults to `[]`, so you don't need a special case for
it.

### What the host must supply

`user.id`, `context.surface`, and at least one entry in `candidates`. SKUs must
be unique.

`candidates` is the merchandising boundary. Every SKU the model writes gets
looked up in that list, and one that isn't on it is dropped by reconciliation
before anything renders. A product you left out doesn't reach the page.

`bundles` is optional. These are the sets you sell together, each with your own
price for the set, the currency that price is in, and, if you want one, your own
name for it. Every product in a set has to be a candidate as well. That's what
lets the checks that pass a single product run over a whole set, and what lets
the renderer look the members up in the catalog it already has. Ids must be
unique, and one set must not name the same product twice.

A set is placed whole, so one check runs differently: a set may hold something
the shopper already bought or has in the basket, where a grid or a carousel
would drop it. A thumbs-down on a member still blocks the whole set, and so does
a member that is out of stock, already on the page, or the product being looked
at right now.

That last one has a cost. A "frequently bought together, including this item"
set names the product whose page it sits on, so it is refused on exactly the
page you wrote it for. Leave the item out and sell the companions as the set —
that rejection goes away, and the rest of the checks still apply. And when a
bundle block is the only block the model asked for, refusing the set leaves
nothing to render, so the deterministic component takes over.

The model _never_ picks a set and is never told a price. All it does is ask for a
bundle block and write the words around it. We pick which set when the page is
served, going on what the shopper has in their basket, has looked at, or is
browsing right now.

Every word the model writes is read for claims: the headline, the subheadline, a
hero, a banner, a block title, the copy block, the reason under a product, and
the words around the set. Text you supplied is never read this way. A product
title, a category and a bundle `label` are your words, not the model's.

We drop text that makes a claim we can't check, in three passes. The first looks
for money, a customer score, a delivery date and a count of what's left. The
second asks whether every numeral in the sentence is one you supplied. The third
is `@rudra-js/attested`'s phrase list, for claims with no number in them to
check — "top pick", "customer favourite".

That second pass changed what happens to a specification. "a comfort rating of
-5C" used to be kept on the strength of the words around the number. It is kept
now only when a `5` turns up in a `tag` or a `category` name you sent us — the
number, not the string, so a tag reading `5-pocket` keeps it as surely as one
reading `-5C comfort`. Those are the strings we hand the model and let it repeat.
A `title` and a `rating` we also show it, and the prompt tells it never to
restate either, so neither stands behind a number. Put your spec sheet in `tags`
and the model can quote it; leave it out and a number in that field is one the
model made up, and it goes.

Which strings, exactly:

- Only candidates we showed the model. Out of stock, or past the 60 we send,
  means a product the model never saw, and its tags stand behind nothing.
- The `currentCategory` on the request is not one of them. It's a string from
  this request rather than a row of your catalog, and plenty of sites pass a URL
  segment straight into it.
- A `reason` or a `badge` sits under a named product, so it's read against that
  product's own tags and category. Every other field reads all the candidates'
  pooled.
- A tag or category that is nothing but a number in exponent notation, and whose
  exponent runs past a thousand, is dropped here. `1e2000000000` is twelve
  characters that lay out into a run long enough to end the process, and
  `@rudra-js/attested` is a peer dependency, so the copy you have installed may
  be one that still tries. `@rudra-js/attested` draws its own line in the same
  place but measures the laid-out run rather than the exponent, so a handful of
  tags near the margin — `1e1000`, `1.5e1000`, `9999e998` — get past this rule
  and then stand behind nothing on the other side of it. Nothing that wide is a
  product fact either way.

Two caveats worth saying out loud, because they're the shape of the check rather
than bugs in it. Pooled means pooled: one product's `40 litre` tag stands behind
"take 40 off" written in a headline about another. And nothing in the pass knows
which quantity a tag was about, so a tag holding a weight stands behind a price
with the same digits in it. It proves the digits came from you. It doesn't prove
the sentence is true.

The first and third passes are word lists, so spotting a claim isn't a
guarantee, not the way checking a price against your catalog is. The second is a
proof of something narrower than it sounds: every digit was one of yours. A
number written as a word isn't a number to it, so "four and a half stars" is not
a rating it can see — while a ½ or the K in "10K" is a numeral it can't read,
which it drops rather than waves through.

The model isn't told any of this. The prompt bans prices, ratings, discounts,
delivery dates and stock levels, and says nothing about digits, so it can't tell
`3-season` — a tag you sent, and fine — from `2 litres`, which is not. Whatever
the over-rejection rate is on your catalog, nothing in the prompt is steering it
down yet.

Some fields can't be empty, like a headline or a banner's text. Those get emptied
instead of nulled, so the block drops the way any block with no text drops. And
an emptied page headline makes the whole generation unusable.

That last one is the expensive edge of the digit check, so it's worth being
concrete: if the model writes "Our 3 favourites for wet weather" and no candidate
carries a 3, the headline empties, the generation is unusable, and the
deterministic component renders — a model call paid for and thrown away. In
cohort mode the spec is cached before reconciliation, so every cache hit for the
rest of the TTL runs the same screen and reaches the same fallback. The reason a
`reason` under a card is exempt is the same idea from the other side: in cohort
mode we wrote that sentence, so reading it back would only ever cost us.

For the set, the prompt also tells the model to write about the offer rather than
the products in it, and never to say the set saves money or by how much. Pass a
`label` on the bundle to put your own words on the set. A label is text you
wrote, not text the model wrote, so it renders ahead of the model's words.

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

`context.locale` has to be a single language tag, such as `en-US`. One tag. Not a
list, and not an `Accept-Language` header.

### Cohorts

By default one generated component is shared between shoppers who look alike, and
each shopper's own products are filled in per request. A cohort is the shopper's
segment, the surface and slot, the locale, the item count, whether they're a
first-time visitor, the category being browsed, and the category they lean
towards. Everything that makes a person an individual stays out of it: who they
are, what they liked, viewed or searched for. That's what lets many page views
reuse one call.

The candidate list is part of the cohort too, since the model is shown those
products and writes about them. In most shops candidates come from the page, so
everyone looking at it shares them. If you pick candidates per shopper you'll get
smaller cohorts. That's the honest outcome, because your prompt really is
personal.

What goes in the key is the _set_ of candidate SKUs. Not the order you sent them
in, not which ones were in stock, and not where the 60-product cut fell. So two
requests carrying the same SKUs in a different order share one component, and the
one generated first is the one both get. If your ranking is personal, order your
candidates and the products in the copy won't be the ones you put at the top.
Prices, titles and stock are always read from your catalog at render time, so
nothing stale is ever shown — a product that sold out is dropped as the page is
served, and any sentence written about it stays.

#### Who can create a cohort

Every field above is one you supply, and each distinct value is a cohort of its
own — a fresh model call, and a slot in the cache. If a visitor can choose one of
them, a visitor can choose how many calls you pay for. A `locale` copied straight
out of `Accept-Language`, a `currentCategory` read off a URL slug and a `segment`
built from a query parameter are the three that go wrong. The shipped cache holds
10,000 entries and drops the oldest, so enough made-up values also evict the
cohorts your real shoppers were being served from.

Draw those fields from sets you control: your own locale list, your own category
ids, your own segment labels. Nothing leaks either way — a cohort prompt carries
no shopper text at all — the cost is the bill and the model round trip on a page
that was being served from cache.

Pass `generation: 'per-shopper'` to generate for the individual instead. The
model then chooses the products too, and every shopper pays for their own call.

```ts
createComponentGenerator({ provider, generation: 'per-shopper' });
```

#### What you put in `segment`

`segment` is sent to the model exactly as you wrote it, in both modes, and the
contract takes any string up to 128 characters. Stick to plain merchandising
labels like `lapsed`, `high-value`, `trial`, `wholesale`. Keep out anything that
says something protected about a person: health, race, ethnic origin, religion or
belief, sex life or sexual orientation, politics, union membership, biometric or
genetic data.

The same goes for `recentSearches`, `context.searchQuery` and `interaction.type`
in per-shopper mode. Those three are shopper text and they're sent as written.
What a shopper types is theirs. What you label them with is your choice.

### Limits

Every free-text field and every array is capped, because your strings end up
inside a model prompt and a model is billed per token. The caps live in
`FIELD_LIMITS` and we export them, so you can validate against the same numbers
instead of finding them out from a rejection.

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
| `reason`             | 120   | `candidates[].reason`, your own phrase for a product                |

These bound each field on its own. They aren't an aggregate prompt budget.
Fitting a payload into a context window is `digest`'s job, and it trims rather
than throws.

### Unknown fields are rejected

Every fixed-shape object is a `strictObject`. Misspell `recentSearches` and
you'll get an error, not a shopper who quietly looks like a first-time visitor.
`interaction.meta` is the one dynamic shape: an open record, minus the keys that
would mutate a prototype instead of the object.

## Bringing your own ranking

By default we order the products for you, scoring each candidate against the
shopper's signals. But you might already have a recommender you trust: bought
together, an engine trained on your own orders, or a merchandiser's hand-picked
row. Pass `rank: 'given'` and the order you sent is the order that renders.

```ts
const generator = createComponentGenerator({ provider, rank: 'given' });
```

You keep the rest either way. We still drop anything the shopper shouldn't be
shown, whether it's out of stock, already bought, in the basket, disliked, or
the product they're looking at right now — read from the payload you sent, not
from the shortened history the model was shown, so a shopper with a long order
book is covered too. Every product still carries a basis we check against their
real signals, and everything the model writes is still screened.

How much each basis proves is worth knowing, because two of the six prove less
than they read. `most_viewed` is checked against the SKUs they viewed,
`similar_to_current` against the category being browsed, `liked_category`
against the categories they bought, liked, carted or viewed in — standing on a
category page is not one of those — and `popular` claims nothing.
`complements_cart` and `complements_purchase` check only that the basket, or the
order history, isn't empty: nothing here can know that one product goes with
another. A basis that fails takes the sentence and the badge stating it with it.

Each candidate can carry its own `reason`, the phrase shown under the product.
Reach for it when your ranking knows something the signals don't:

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
written and not screened. That only applies where this request actually used it,
which is the default `cohort` mode. In `per-shopper` mode the model writes the
reasons itself, so every one of them is screened, including one that happens to
read the same as yours.

Without a reason of your own, the basis is stated for you from the shopper's
signals — "More in Backpacks", "Goes with what is in your cart". Those are our
words, not the model's, so in `cohort` mode they aren't screened either. They
used to be, and a shop with a category called Clearance or Last Chance would
have watched the phrase list delete the reason under every card while the
deterministic component printed the same sentence untouched.

## What the model sees

The two generation modes send different things. Cohort is the default.

### Cohort mode

- the surface and the slot
- the locale
- the segment, when you set one
- the category being browsed (`context.currentCategory`)
- the name of the category the shopper leans towards most. Just the name, the
  score stays behind
- whether this shopper has no history at all
- how many products the component may place (`context.maxItems`)
- the candidate list: one line per product, with its SKU, title, category, rating
  and tags

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
- every timestamp (`at`), which we use to sort signals and then drop
- dwell time (`dwellMs`), added up in the digest and left out of the prompt
- every price, and every currency
- `imageUrl`
- `interaction.value` and `interaction.meta`. The model is told which kinds of
  interaction happened and how often, and no more

The candidate list is trimmed on the way out. An out-of-stock product is dropped,
and at most 60 products go, in the order you supplied them.

`spec-cache.test.ts` walks every field of the digest and checks that each one is
either in the cohort key or scrubbed from the cohort prompt. A field the key
leaves out that still changes the prompt fails that test. Adding a field to the
digest fails it too, until someone says which side the field is on.

## What the model decides, by mode

What the model wrote, and what we replace before the page is served. Cohort is
the default.

| Decision                           | Cohort, the default                     | Per-shopper                            |
| ---------------------------------- | --------------------------------------- | -------------------------------------- |
| Layout and block order             | The model                               | The model                              |
| Headline, subheadline, copy        | The model                               | The model                              |
| Emphasis per item                  | The model                               | The model                              |
| Badge text                         | Dropped, written for another product    | The model                              |
| Which products, and in what order  | Filled in per request, not by the model | The model, from your candidates        |
| The reason and basis per product   | Filled in per request, not by the model | The model, checked against the signals |
| Which bundle, of the ones you pass | Chosen per request, not by the model    | Chosen per request, not by the model   |

In cohort mode the grid and carousel items are filled in per request, best pick
first, so a component written for one shopper still fits the next.

The hero is the exception. It keeps the product the model named, because its
headline and body were written about that product, and swapping it would leave
copy about something else. When that product can't be placed, reconciliation
drops the link and keeps the words. It can't be placed if this
shopper can't see it (out of stock, not a candidate, disliked, already bought, in
the basket, or the one being looked at), an earlier block already placed it, or
the item budget ran out before the hero was reached.

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

`createComponentGenerator({ provider })` takes any object of that shape: a hosted
API, a model you run yourself, a deployment inside your own tenancy, or a
recorded fixture. `@rudra-js/core` depends on no vendor SDK.
`@rudra-js/anthropic` is one adapter, not a requirement, and `provider: null` is
the default that costs nothing.

An adapter takes its API key as an option, so you choose where the key comes
from. `ANTHROPIC_API_KEY` is just the name the example shop uses for its own
convenience. No package here reads the environment.

## The cache

`cache` defaults to an in-process store. `createMemorySpecCache()` keeps an entry
for `ttlMs`, 60,000 milliseconds by default, so one minute. It holds up to
`maxEntries`, 10,000 by default. Once it's full, the entry read longest ago is
the first to go.

An entry holds the generated spec and `generatedAt`, the epoch milliseconds when
the model produced it. That's the whole of it. No payload, no shopper, no prompt.

The port is two methods, and an optional third:

```ts
export interface SpecCache {
  get(key: string): Promise<CachedSpec | undefined>;
  set(key: string, cached: CachedSpec): Promise<void>;
  delete?(key: string): Promise<void>;
}
```

Pass your own store, whether that's Redis, Memcached or whatever you already run,
and it keeps entries on its own terms. Just keep in mind that what that store
holds, and for how long, is yours to declare to your users. This package doesn't
set it. Pass `createNullSpecCache()` to store nothing at all.

### When a generation is wrong

Pass `provider: null` and nothing new is generated, so every page renders the
deterministic component. Shorten `ttlMs` and a bad entry ends sooner. A store
with `delete` can drop one entry by the `key` on its `GenerationEvent`, and the
next request generates again. Per-shopper entries only end by TTL, because
nothing maps a shopper to their keys.

## Watching it in production

The generator never fails a render, so a provider that's been down for a week
only shows as plainer pages. The way to know is `onEvent`: every call to
`generate` that gets past input validation reports exactly one `GenerationEvent`.
A payload that fails `parseTrackingInput` throws instead, and reports nothing.

These are the numbers worth keeping:

- **Fallback share** — the share of events with `source: 'fallback'`. Alert when
  it climbs. `degradedReason` tells you which way the call failed, and `error`
  carries what was thrown when the reason is `'provider-error'` or `'timeout'`.
- **Cache hit rate** — `cache: 'hit'` over the events that have a `cache` field.
  A store that's down shows as `cache: 'error'`, and a slow one as
  `cache: 'timeout'`, rather than as a rising bill.
- **Spend** — sum `usage` over the events where `calledModel` is true. Requests
  that joined an in-flight generation carry the same `usage`, so summing over
  every event counts one call many times.

## Licence

[MIT](./LICENSE)
