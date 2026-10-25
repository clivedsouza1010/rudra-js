# @rudra-js/core

This package is part of [rudra-js](https://rudrajs.com).

rudra-js is an open-source TypeScript library (MIT) you install from npm. A
language model designs one product-recommendation block for a page in your shop,
rudra-js checks it against your catalog, and React renders it.

It is not a hosted platform, a visual or low-code app builder, or a workspace
you sign up for.

You give this package one page view:

- the shopper and what they've been doing
- the page they're on
- the products you're willing to show

It gives back a spec: data that describes the recommendations on that page. Your
model writes it, or core builds it without one. Either way, it's checked against
those products. There's no React in this package. `@rudra-js/react` turns the
spec into markup.

The guides and the API reference are at [rudrajs.com](https://rudrajs.com).

## Install

```sh
npm install @rudra-js/core@latest @rudra-js/attested@latest
```

Run the same command in a new app, in an app that already uses rudra-js, and to
upgrade.

If your app also has `@rudra-js/react` or `@rudra-js/anthropic`, add them to the
command with `@latest`. Each one's peer range on core covers only its own minor
release. Leave one behind and npm only warns, but the next `npm install` or
`npm ci` fails with `ERESOLVE`.

If your app has `@rudra-js/a2ui`, use the install line in that package's README
instead. It also names the two A2UI packages.

Keep `@latest` on every name. For a bare name, npm stays inside the range your
`package.json` already has, so an app on an older core never leaves the minor
release it's on.

`zod` is a dependency, so you don't need to install it yourself. The public API
of this package _is_ zod schemas. An app on any zod 4 shares one copy of zod
with it.

An app on zod 3 gets its own copy next to ours, and the two don't mix. Build on
the exported schemas with their own methods (`productSchema.array()`), not with
your zod's (`z.array(productSchema)`). Read `error.issues` instead of checking
`instanceof ZodError`.

`@rudra-js/anthropic` uses its own zod to write the tool schema sent to the
model, so the schema's wording shifts a little between zod releases. Before zod
4.5, a nullable field is written as `anyOf` instead of a type array. Both mean
the same thing.

`@rudra-js/attested` is a peer dependency. None of its types appear in this
package's public API, and you never have to import it. It's a peer so your app
has exactly one copy of its phrase list. If your app pins its own version, npm
stops with an `ERESOLVE` you can see and fix. If you pin nothing, npm installs
one copy at the top of the tree. One tag publishes every `@rudra-js` package to
npm at the same version, so these ranges always move together.

## Running without a model

`createComponentGenerator` takes a `provider`. Leave it out, or pass `null`, and
nothing calls a model and nothing gets billed:

```ts
const generator = createComponentGenerator({ provider: null });
const spec = await generator.generate(input);
```

This is a supported setting. The benchmark compares the models against it. It's
the right setting until you've picked a provider. `generate` returns a promise
either way, so your code keeps its shape when you add one.

Without a model, core builds the spec itself. The rest of this README calls that
spec the fallback. It has exactly one **grid** block, with a headline from a
fixed set of four. It has no blocks at all when there's nothing left to show.
That happens when no candidate is in stock, and also when every candidate is
ruled out for this shopper.

The other block kinds (hero, carousel, banner, copy, bundle) only ever come from
a model. So if you're wiring up bundles and none of them appear, that's why. It
isn't your catalog.

To render a spec you wrote yourself, still without a model, pass
`createFixedSpecProvider(spec)` as the provider. It answers every request with
that spec. Your spec goes through the same checks as a model's, so it needs a
headline that passes the [claim check](#what-the-host-must-supply) and at least
one product on show. Otherwise you get the fallback.

## Options

Everything `createComponentGenerator` takes, and what you get if you leave it
out.

| Option           | What it does                                                                                            | Default                   |
| ---------------- | ------------------------------------------------------------------------------------------------------- | ------------------------- |
| `provider`       | The model adapter. `null` runs without a model and bills nothing.                                       | `null`                    |
| `cache`          | Where generated specs live between requests. Pass `createNullSpecCache()` to keep none.                 | `createMemorySpecCache()` |
| `generation`     | `'cohort'` shares one spec between shoppers who look alike. `'per-shopper'` generates for each shopper. | `'cohort'`                |
| `rank`           | `'signals'` orders products by the shopper's signals. `'given'` keeps the order you sent.               | `'signals'`               |
| `modelTimeoutMs` | How long the model gets. After that, core aborts the request and renders the fallback.                  | `1500`                    |
| `cacheTimeoutMs` | How long a cache read gets. After that, the request generates as if the cache had nothing.              | `50`                      |
| `onEvent`        | Called once per `generate` with a `GenerationEvent`. If your function throws, core ignores the error.   | none                      |

## `tracking-input`

This is the boundary between your app and rudra-js. You own your tracking
pipeline and pass one JSON object per render. rudra-js collects nothing and
stores nothing. It doesn't aggregate anything either.

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
`safeParseTrackingInput` returns a `TrackingInputResult` instead. Then you can
read `result.error.issues` without importing zod yourself.

### Cold start is not an error

A payload with no `signals` block is a first-time visitor. Every signal list
defaults to `[]`, so you don't need a special case for it.

### What the host must supply

Send `user.id`, `context.surface` and at least one entry in `candidates`. SKUs
must be unique.

`candidates` sets which products can reach the page. Core looks up every SKU the
model writes in that list. A SKU that isn't on it is dropped before anything
renders.

`bundles` is optional. These are the sets you sell together. Each one has your
own price for the set and the currency that price is in. It can also have your
own name for the set, its `label`. Every product in a set has to be a candidate
as well. Bundle ids must be unique, and one set must not name the same product
twice.

A set is placed whole, so one check works differently. A set may hold something
the shopper already bought or has in the basket. A grid or a carousel would drop
that product. The whole set is still blocked when any member is:

- disliked by the shopper
- out of stock
- already on the page
- the product being looked at right now

That last rule has a cost. A "frequently bought together, including this item"
set names the product whose page it sits on, so it's refused on exactly the page
you wrote it for. Leave that item out and sell its companions as the set. That
rejection goes away, and the other checks still apply.

When a bundle block is the only block the model asked for, refusing the set
leaves nothing to render. Then the fallback takes over.

The model _never_ picks a set and is never told a price. All it does is ask for
a bundle block and write the words around it. Core picks which set when the page
is served. It bases the choice on what the shopper has in their basket, has
looked at, or is browsing right now.

The prompt tells the model to write about the offer, not the products in it. It
also tells the model never to say the set saves money, or by how much. Your
`label`, when you pass one, renders ahead of the model's words.

Core reads every word the model writes for claims:

- the headline and the subheadline
- a hero
- a banner
- a block title
- the copy block
- the reason under a product
- the words around the set

Text you supplied is never read this way. A product title, a category and a
bundle `label` are your words.

Core drops text that makes a claim it can't check. This README calls that the
claim check. It runs in three passes:

1. The first looks for money, a customer score, a delivery date and a count of
   what's left.
2. The second asks whether every numeral in the sentence is one you supplied.
3. The third is `@rudra-js/attested`'s phrase list. It catches claims with no
   number in them to check, like "top pick" and "customer favourite".

For example, the second pass keeps "a comfort rating of -5C" only when a `5`
turns up in a `tag` or a `category` name you sent. The pass compares the number,
not the string, so a tag reading `5-pocket` keeps it as surely as one reading
`-5C comfort`.

Tags and category names count because they're the strings core hands the model
and lets it repeat. The model is also shown each product's `title` and `rating`.
Neither one backs a number, because the prompt tells it never to restate either.
Put your product's figures in `tags` and the model can quote them. Leave them
out, and any figure the model writes about them is made up, so it's dropped.

Which strings count, exactly:

- Only candidates the model was shown. A product that's out of stock, or past
  the 60 core sends, is one the model never saw. Its tags back nothing.
- Not the `currentCategory` on the request. It's a string from this request, not
  a row of your catalog, and plenty of sites pass a URL segment straight into
  it.
- A `reason` or a `badge` sits under a named product, so it's read against that
  product's own tags and category. Every other field is read against all the
  candidates' tags and categories, pooled.

Two things to know about the second pass. Pooled means pooled: one product's
`40 litre` tag backs "take 40 off" written in a headline about another. And
nothing in the pass knows which quantity a tag was about, so a tag holding a
weight backs a price with the same digits in it. The pass proves the digits came
from you. It doesn't prove the sentence is true.

The first and third passes are word lists. A word list can miss a claim, so it
isn't a guarantee the way checking a price against your catalog is. The second
pass proves something narrower than it sounds: every digit was one of yours. A
number written as a word isn't a number to it, so it can't see "four and a half
stars" as a rating. A ½, or the K in "10K", is a numeral it can't read. It drops
those instead of letting them through.

The model isn't told any of this. The prompt bans prices, ratings, discounts,
delivery dates and stock levels. It says nothing about digits. So the model
can't tell `3-season`, a tag you sent and fine to use, from `2 litres`, which
isn't. However much good text the check drops on your catalog, nothing in the
prompt brings that down.

Some fields can't be null, like a headline or a banner's text. When the check
drops text from one of those, it empties the field instead. The block then
drops, as any block with no text does. An empty page headline makes the whole
generation unusable.

That's the costly case. Say the model writes "Our 3 favourites for wet weather"
and no candidate carries a 3. The headline empties, so the generation is
unusable and the fallback renders. You paid for a model call and threw it away.
In cohort mode the spec is cached before it's checked, so every cache hit runs
the same check and gets the same fallback until the entry expires.

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

`context.locale` has to be one language tag, such as `en-US`. Not a list, and
not an `Accept-Language` header.

### Cohorts

By default, shoppers who look alike share one generated spec. Each shopper's own
products are filled in per request. A group of look-alike shoppers is a cohort.
A cohort is set by:

- the shopper's segment
- the surface and the slot
- the locale
- the item count
- whether they have any history
- the category being browsed
- the category they lean towards

Only two of these come from the shopper's own data: whether they have any
history, and the category they lean towards. Who they are, what they searched
for and the products they liked or viewed stay out. That's what lets many page
views reuse one model call.

The candidate list is part of the cohort too, because the model is shown those
products and writes about them. In most shops candidates come from the page, so
everyone looking at it shares them. If you pick candidates per shopper, you'll
get smaller cohorts, because each prompt really is personal.

The cache key for a cohort holds the _set_ of candidate SKUs. It ignores the
order you sent them in, which ones were in stock, and where the 60-product cut
fell. So two requests with the same SKUs in a different order share one spec,
and both get the one generated first. If your ranking is personal and you order
your candidates per shopper, the products the copy talks about won't be the ones
you put at the top.

Prices, titles and stock are always read from your catalog at render time, so a
stale one never shows. A product that sold out is dropped as the page is served.
Any sentence the model wrote about it stays.

#### Who can create a cohort

Every cohort field above is one you supply, and each distinct value makes a
cohort of its own. That's a fresh model call, and a slot in the cache. If a
visitor can choose one of these values, a visitor can choose how many calls you
pay for. These are the three that go wrong:

- a `locale` copied straight out of `Accept-Language`
- a `currentCategory` read off a URL slug
- a `segment` built from a query parameter

The built-in cache holds 10,000 entries, so once it's full, made-up values push
out the cohorts your real shoppers were being served from.

Draw those fields from sets you control:

- your own locale list
- your own category ids
- your own segment labels

Nothing leaks either way, because a cohort prompt carries no shopper text at
all. The cost is the bill, plus a model round trip on a page that was being
served from cache.

Pass `generation: 'per-shopper'` to generate for each shopper instead. The model
then picks the products too, and every shopper costs their own call.

```ts
createComponentGenerator({ provider, generation: 'per-shopper' });
```

#### What you put in `segment`

`segment` goes to the model exactly as you wrote it, in both modes. The schema
takes any string up to 128 characters. Stick to plain merchandising labels like
`lapsed`, `high-value`, `trial` or `wholesale`. Keep out anything that says
something protected about a person:

- health
- race
- ethnic origin
- religion or belief
- sex life or sexual orientation
- politics
- union membership
- biometric or genetic data

The same goes for `recentSearches`, `context.searchQuery` and `interaction.type`
in per-shopper mode. Those three are shopper text, and they're sent as written.
What a shopper types belongs to them. The label you give them is your choice.

### Limits

Every free-text field and every array has a cap, because your strings end up
inside a model prompt and you pay for a model per token. The caps live in
`FIELD_LIMITS`, which is exported. Validate against the same numbers instead of
finding them out from a rejection.

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

Each cap bounds one field on its own. Together they aren't a budget for the
whole prompt. Fitting a payload into a context window is the digest's job. The
digest is core's short summary of the shopper and the page, which goes into the
prompt. It trims instead of throwing.

### Unknown fields are rejected

Every fixed-shape object is a `strictObject`. Misspell `recentSearches` and you
get an error, instead of a shopper who quietly looks like a first-time visitor.
`interaction.meta` is the one open shape. It takes any key, except the keys that
would change a prototype instead of the object.

## Bringing your own ranking

By default core orders the products for you. It scores each candidate against
the shopper's signals. You might already have a recommender you trust:

- bought-together data
- an engine trained on your own orders
- a merchandiser's hand-picked row

Pass `rank: 'given'` and the order you sent is the order that renders.

```ts
const generator = createComponentGenerator({ provider, rank: 'given' });
```

You keep the other checks either way. Core still drops anything the shopper
shouldn't be shown:

- out of stock
- already bought
- in the basket
- disliked
- the product they're looking at right now

Core reads these from the payload you sent, not from the shorter history the
model was shown. So a shopper with a long order history is covered too. Every
product still carries a basis, a code like `most_viewed` that says why it's
shown, and core checks it against the shopper's real signals. Everything the
model writes still goes through the claim check.

There are six bases, and two of them prove less than their names suggest:

- `most_viewed` is checked against the SKUs they viewed.
- `similar_to_current` is checked against the category being browsed.
- `liked_category` is checked against the categories they bought, liked, carted
  or viewed in. Standing on a category page isn't one of those.
- `popular` claims nothing.
- `complements_cart` checks only that the basket isn't empty.
- `complements_purchase` checks only that the order history isn't empty.

The two `complements_` bases are the weak ones, because nothing here can know
that one product goes with another. A basis that fails takes the sentence and
the badge stating it with it.

Each candidate can carry its own `reason`, the phrase shown under the product.
Use it when your ranking knows something the signals don't:

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

A reason you supply is your own words, like the title, so it renders as written
and skips the claim check. That only applies where this request actually used
it, which is the default `cohort` mode. In `per-shopper` mode the model writes
the reasons itself. Every one of them goes through the claim check, even one
that reads the same as yours.

Without a reason of your own, core states the basis for you from the shopper's
signals, like "More in Backpacks" or "Goes with what is in your cart". Those are
core's words, not the model's, so in `cohort` mode they skip the claim check
too.

## What the model sees

The two generation modes send different things. Cohort is the default.

### Cohort mode

- the surface and the slot
- the locale
- the segment, when you set one
- the category being browsed (`context.currentCategory`)
- the name of the category the shopper leans towards most, without its score
- whether this shopper has no history at all, meaning no likes, dislikes,
  purchases, basket items or views. Searches and other interactions don't count
- how many products the spec may place (`context.maxItems`)
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
- up to six categories they lean towards, strongest first
- the other kinds of interaction, each with a count

### Left out of both

- `user.id`
- every timestamp (`at`). Core uses them to sort signals, then drops them
- dwell time (`dwellMs`). It's added up in the digest and left out of the prompt
- every price, and every currency
- `imageUrl`
- `interaction.value` and `interaction.meta`. The model is told which kinds of
  interaction happened and how often, and no more

The candidate list is trimmed before it's sent. Out-of-stock products are
dropped, and at most 60 products go, in the order you supplied them.

`spec-cache.test.ts` walks every field of the digest. It checks that each one is
either in the cache key or removed from the cohort prompt. A field the key
leaves out that still changes the prompt fails that test. A new field added to
the digest fails it too, until someone says which side the field is on.

## What the model decides, by mode

What the model wrote, and what core replaces before the page is served.

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
first, so a spec written for one shopper still fits the next.

The hero is the exception. It keeps the product the model named, because its
headline and body were written about that product. When that product can't be
placed, core drops the link and keeps the words. It can't be placed when:

- this shopper can't see it: it's out of stock, not a candidate, disliked,
  already bought, in the basket, or the one being looked at
- an earlier block already placed it
- the item budget ran out before the hero was reached

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

`createComponentGenerator({ provider })` takes any object of that shape. That
can be a hosted API, a model you run yourself, a deployment inside your own
tenancy, or a recorded fixture. `@rudra-js/core` depends on no vendor SDK.
`@rudra-js/anthropic` is one adapter, and you don't need it.

An adapter takes its API key as an option, so you choose where the key comes
from. `ANTHROPIC_API_KEY` is just the name the example shop uses. No package
here reads the environment.

## The cache

By default `cache` is an in-process store. `createMemorySpecCache()` keeps an
entry for `ttlMs`, which defaults to 60,000 milliseconds, so one minute. It
holds up to `maxEntries`, which defaults to 10,000. Once it's full, the entry
read longest ago is the first to go.

An entry holds the generated spec, as the model returned it before any checks.
It also holds `generatedAt`, the epoch milliseconds when the model produced it.
It holds no payload and no prompt.

In cohort mode an entry holds no shopper id, and everyone in the cohort shares
it. The exception is an entry whose segment or candidates were picked for one
shopper. In per-shopper mode the model wrote the entry from that shopper's
signals. So its text can repeat them, a search term for instance, and the entry
is personal data until it's gone.

Expiry is checked when an entry is read, so an expired entry stays in memory
until it's read again or pushed out by a newer one.

The cache interface is two methods, and an optional third:

```ts
export interface SpecCache {
  get(key: string): Promise<CachedSpec | undefined>;
  set(key: string, cached: CachedSpec): Promise<void>;
  delete?(key: string): Promise<void>;
}
```

Pass your own store, whether that's Redis, Memcached or whatever you already
run, and it keeps entries on its own terms. What that store holds, and for how
long, is yours to declare to your users. This package doesn't set it. Pass
`createNullSpecCache()` to store nothing at all.

### When a generation is wrong

- Pass `provider: null` and nothing new is generated, so every page renders the
  fallback.
- Shorten `ttlMs` and a bad entry ends sooner.
- If your store has `delete`, drop one entry by the `key` on its
  `GenerationEvent`. The next request generates again.

Per-shopper entries only end when they expire, because nothing maps a shopper to
their keys.

## Watching it in production

The generator never fails a render, so a provider that's been down for a week
only shows up as plainer pages. Watch `onEvent` to find out. Every call to
`generate` that gets past input validation reports exactly one
`GenerationEvent`. A payload that fails `parseTrackingInput` throws instead, and
reports nothing.

Keep these numbers:

- **Fallback share.** The share of events with `source: 'fallback'`. Alert when
  it climbs. `degradedReason` tells you which way the call failed. When the
  reason is `'provider-error'` or `'timeout'`, `error` carries what was thrown.
- **Cache hit rate.** `cache: 'hit'` over the events that have a `cache` field.
  A store that's down shows as `cache: 'error'`, and a slow one as
  `cache: 'timeout'`. So a broken store shows up here, not only as a rising
  bill.
- **Spend.** Sum `usage` over the events where `calledModel` is true. Requests
  that joined a generation already in flight carry the same `usage`, so summing
  over every event counts one call many times. Some calls the model answered are
  turned down by the adapter: a `max_tokens` stop, a refusal, no tool call, or a
  reply that doesn't fit the schema. Those were billed too. They arrive as a
  `'provider-error'` with no `usage`, so this sum is lower than your bill.

## Running it in a regulated shop

This isn't legal advice, and which rules apply depends on where you sell. It
describes what the package does, so you can answer what a privacy or
consumer-law review will ask.

**What leaves your server.** Nothing, unless you pass a `provider`, or a `cache`
whose store lives somewhere else. With a provider, cohort mode sends the page
and locale, the category, the segment you set, the shopper's strongest category,
whether they have any history, and the candidate products. That has no shopper
id, but it can still be personal data. The strongest category and the history
flag come from that shopper's data. The segment goes exactly as you wrote it.
The candidate list is about them too if you pick or order it per shopper.
Per-shopper mode adds the shopper's own signals. Both lists are under
[What the model sees](#what-the-model-sees). `user.id` is never sent in either
mode. The provider should be your processor, under a contract that says so. For
Anthropic, see the `@rudra-js/anthropic` README.

**A shopper who objects to profiling.** Leave `signals` and `user.segment` out
of their payload. In per-shopper mode, leave out `context.searchQuery` and
`user.isReturning` too. They get what a first-time visitor gets, built from the
page and the catalog, not from them. With those left out,
`generateDeterministic(input)` gives the same kind of spec without calling the
model or the cache. Called with signals, it still personalises.

**Deleting a shopper's data.** The package keeps nothing about a shopper except
the cache. In cohort mode an entry holds no shopper id and everyone in the
cohort shares it, so usually there's no one shopper's entry to delete. The
exception is a cohort entry whose segment or candidate list was picked for one
shopper. Like every per-shopper entry, it's about that shopper. Nothing maps a
shopper to their entries, so keep `ttlMs` short or pass `createNullSpecCache()`.
`onEvent` sends no shopper id. But in per-shopper mode its `key` is derived from
one, and `violations` can name SKUs from a shopper's basket or purchases. So
treat logs of it as personal data.

**Caching pages.** A personalised page says things like "Goes with your cart"
and "You looked at this recently" in its HTML. Serve those pages with
`Cache-Control: private` or `no-store`, so a shared cache never hands one
shopper's page to another.

**Telling shoppers a model wrote the copy.** The wrapper's `data-rudra-source`
says `llm` or `cache` when a model wrote the copy, and `fallback` when it
didn't. That makes it a machine-readable marker you can build on, for example
to show a note. Whether you must label AI-written copy, and how, depends on
where you sell. In the EU, Article 50 of the AI Act is the rule to ask about.

**Claims.** The copy on your page is your own advertising, whoever wrote it. The
claim check catches prices, discounts, stock, ratings, delivery, urgency and
generic environmental claims. But it's a list, and rewordings get through.
SECURITY.md explains why, and the tests list the known ones. Anything it misses
is still yours to stand behind.

**Children.** In the UK, the ICO's Children's Code covers any shop that
under-18s are more likely than not to use, not only one aimed at them. Its
standard 12 asks for profiling to be off by default unless you can show a
compelling reason, judged by the child's best interests. It also asks for
safeguards when profiling is on. For a shop like that, don't use per-shopper
mode. For a shopper under 18, leave `signals` and `user.segment` out of their
payload unless they've switched personalisation on, as for a shopper who objects
to profiling. If you can't tell a shopper's age with confidence that fits the
risk, treat every shopper as under 18. Cohort mode alone doesn't turn profiling
off. The default `rank: 'signals'` still orders products by the shopper's
signals in cohort mode and in the fallback, even with no provider. And cohort
mode still sends their strongest category, whether they have any history, and
any segment to the model.

**Marketplaces.** If other sellers list products on your site, EU platform rules
(Article 27 of the Digital Services Act) ask you to set out in your terms:

- your recommender's main parameters
- why they weigh as they do
- any options shoppers have to change them

This doesn't apply if you're a micro or small business. If shoppers can pick
between options, such as switching personalisation off, the control has to sit
where the products are shown.

Which parameters apply depends on your mode and your `rank` setting:

- `rank` sets the order in cohort mode and in the fallback. With `rank: 'given'`
  that's the order you sent, so describe your own ranking.
- With `rank: 'signals'` the order comes from the shopper's category interest
  (the category they're browsing counts too), how often they've viewed a
  product, its rating, and tags it shares with products they've engaged with.
  Category weighs most.
- In per-shopper mode the model picks which candidates to show and in what
  order, from what's under [What the model sees](#what-the-model-sees).
- In cohort mode the model picks the hero's product, from the cohort list in
  that section.
- In every mode, anything out of stock, disliked or being looked at right now is
  left out. So is anything bought or in the basket, except as part of a bundle.
- A bundle is picked by what's in the basket, then what they viewed, then the
  category being browsed.

**Accessibility.** Every card is one link with a readable name, and headings
only render when they have text. Contrast, focus styles and layout come from
your stylesheet, so those are yours to check.

## Licence

[MIT](./LICENSE)
