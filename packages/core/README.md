# @rudra-js/core

This package is part of [rudra-js](https://rudrajs.com), an open-source
TypeScript library (MIT) you install from npm. With rudra-js, a language model
designs one product-recommendation block for a page in your shop: the model
picks the layout and writes the words. After rudra-js checks the model's reply
against your products, React renders the block with your own titles and prices.
To be clear, rudra-js is not a hosted platform, a visual or low-code app
builder, or a workspace you sign up for.

You give this package one page view:

- who the shopper is and what they've been doing
- the page they're on
- the products you're happy to show

You get back a spec. It's just data describing the block. Your model can write
the spec, or core can build one without a model. This also happens if the model
fails. Either way, core checks the spec against those products.

There's no React here: `@rudra-js/react` turns the spec into markup.

For more, see the guides and API reference on
[rudrajs.com](https://rudrajs.com).

## Install

```sh
npm install @rudra-js/core@latest @rudra-js/attested@latest
```

You can run this command in a new app or in an app that already uses rudra-js.
It's also how to upgrade.

If your app also has `@rudra-js/react` or `@rudra-js/anthropic`, you need to add
them to the command with `@latest`. For each of these packages, the peer range
on core covers only its own minor release. If you leave one behind, npm will
just warn you, but the next `npm install` or `npm ci` will fail with `ERESOLVE`.

If your app has `@rudra-js/a2ui`, you need to use the install line in the README
of that package instead. That line also names the two A2UI packages.

Be sure to keep `@latest` on all the names. For a bare name, npm will stay
inside the range your `package.json` already has. An app on an older core will
then never leave the minor release it's on.

You don't need to install `zod` yourself, because it's a dependency of this
package. The public API of this package _is_ zod schemas. If your zod 4 fits
this package's `zod` range, your app will share a single copy of zod with this
package. If your app's zod is below that range, it will get a second copy.

Apps on zod 3 will get their own copy next to ours, but the two copies don't
mix. Build on the exported schemas with their own methods
(`productSchema.array()`) instead of the methods of your zod
(`z.array(productSchema)`). Read `error.issues` instead of checking
`instanceof ZodError`.

`@rudra-js/anthropic` uses its own zod to write the tool schema sent to the
model. Because of this, the wording of the schema will shift a little between
zod releases. Before zod 4.5, a nullable field will be written as `anyOf`
instead of a type array, but both of these mean the same thing.

`@rudra-js/attested` is a peer dependency to make sure your app has exactly one
copy of its phrase list. None of its types appear in the public API of this
package and you never have to import it. If your app pins its own version, npm
will stop with an `ERESOLVE` you can see and fix. If you pin nothing, npm will
install a single copy at the top of the tree. All `@rudra-js` packages are
published to npm by a single tag at the same version. That's why these ranges
will always move together.

## Running without a model

`createComponentGenerator` takes a `provider`. If you leave this out or pass
`null`, no model will be called and nothing will be billed:

```ts
const generator = createComponentGenerator({ provider: null });
const spec = await generator.generate(input);
```

This is a supported setting. It's what the benchmark compares the models
against. It's also the right setting to use until you've picked a provider.
`generate` returns a promise either way, to let your code keep its shape when
you add one.

Without a model, core will build the spec itself. In the rest of this README
that spec is called the fallback. It has exactly one **grid** block with a
headline from a fixed set of four. If there's nothing left to show, it will have
no blocks at all. This will happen if no candidate is in stock, and also if all
of the candidates are ruled out for this shopper.

All the other block kinds (hero, carousel, banner, copy, bundle) only ever come
from a model. If you're wiring up bundles and none of them appear, this is why.
It isn't your catalog.

To render a spec you wrote yourself, still without a model, you can pass
`createFixedSpecProvider(spec)` as the provider. This will answer all requests
with that spec. Your spec will also go through the checks for a model's spec.
This means it will need a headline that passes the
[claim check](#what-the-host-must-supply) and also at least one product on show.
Otherwise you will get the fallback.

## Options

All the options of `createComponentGenerator` and what you get if you leave them
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
pipeline and you just pass in a single JSON object per render. rudra-js collects
nothing and stores nothing. It doesn't aggregate anything either.

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

`parseTrackingInput` throws a `ZodError`. If you'd rather not catch it, you can
use `safeParseTrackingInput` to get a `TrackingInputResult` instead. You will
then be able to read `result.error.issues` without importing zod yourself.

### Cold start is not an error

Any payload with no `signals` block is a first-time visitor. All of the signal
lists will default to `[]`. You don't need a special case for it.

### What the host must supply

You need to send `user.id`, `context.surface` and at least one entry in
`candidates`. All SKUs must be unique.

`candidates` sets which products can reach the page. Core looks up all the SKUs
the model writes in that list. Any SKU that isn't in the list will be dropped
before anything renders.

`bundles` is optional. These are the sets you sell together. Each of these has
your own price for the set and the currency of that price. It can also have your
own name for the set in its `label`. All the products in a set have to be
candidates as well. Bundle ids have to be unique and a set can't name a product
twice.

Because a set is placed whole, one of the checks works differently. A set may
hold something the shopper has already bought or has in the basket, even though
a grid or a carousel would drop that product. But the whole set will be blocked
if any member is:

- disliked by the shopper
- out of stock
- already on the page
- the product being looked at right now

That last rule has a cost. A "frequently bought together, including this item"
set will name the product of the page it sits on. It's then refused on exactly
the page you wrote it for. To get around this, you can leave that item out and
sell its companions as the set. That rejection will go away, but the other
checks will still apply.

If a bundle block is the only block the model asked for, refusing the set will
leave nothing to render. Then the fallback will take over.

The model _never_ picks a set and is never told a price. All it can do is ask
for a bundle block and write the words around it. Core picks which set to use as
the page is served, based on the shopper's basket, the products they've looked
at or what they're browsing right now.

The prompt tells the model to write about the offer and not the products in it.
It also tells the model never to say the set saves money, or by how much. If you
pass a `label`, this will render ahead of the model's words.

Core reads all of the words the model writes, to look for claims:

- the headline and the subheadline
- a hero
- a banner
- a block title
- the copy block
- the reason under a product
- the words around the set

Text you supplied is never read this way. All of these are your words: a product
title, a category and a bundle `label`.

Core drops any text that makes a claim it can't check. This README calls that
the claim check. There are three passes to it:

1. In the first pass, core looks for money, a customer score, a delivery date
   and a count of what's left.
2. In the second pass, core asks whether all the numerals in the sentence are
   ones you supplied.
3. In the third pass, core uses the phrase list of `@rudra-js/attested`. This
   catches claims with no number in them to check, like "top pick" and
   "customer favourite".

For example, the second pass will keep "a comfort rating of -5C" only if a `5`
turns up in a `tag` or a `category` name you sent. This pass compares the number
and not the string. A tag reading `5-pocket` will keep it just as surely as a
tag reading `-5C comfort`.

Tags and category names count because these are the strings core hands to the
model and lets it repeat. The model is also shown the `title` and `rating` of
each product, but neither of these can back a number, because the prompt tells
the model never to restate either. If you put your product's figures in `tags`,
these can be quoted by the model. If you leave these out, any figure the model
writes about them is made up and will be dropped.

Which strings count, exactly:

- Only candidates the model was shown. Any product that's out of stock or past
  the 60 core sends is a product the model never saw. Its tags back nothing.
- Not the `currentCategory` on the request. That's a string from this request
  and not a row of your catalog. There are also plenty of sites that pass a URL
  segment straight into it.
- A `reason` or a `badge` will sit under a named product. It's read against the
  tags and category of that product. All other fields are read against the tags
  and categories of all the candidates, pooled.

There are two things to know about the second pass. Pooled means pooled: a
`40 litre` tag on a product will back "take 40 off" in a headline about another
product. And nothing in this pass can know which quantity a tag was about.
That's why a tag holding a weight will back a price that has those digits in it.
This pass will prove the digits came from you, but it won't prove the sentence
is true.

In the first and third passes, core uses word lists. Word lists can miss a
claim. They aren't a guarantee in the way that checking a price against your
catalog is. For the second pass, the proof is narrower than it sounds: all of
the digits were yours. To this pass, a number written as a word isn't a number.
It can't see "four and a half stars" as a rating. It also can't read some
numerals, like a ½ or the K in "10K". Those will be dropped, not let through.

None of this is told to the model. In the prompt there's a ban on prices,
ratings, discounts, delivery dates and stock levels, but nothing about digits.
The model has no way to tell `3-season` (a tag you sent and fine to use) from
`2 litres` (which isn't). However much good text the check drops on your
catalog, nothing in the prompt can bring that down.

Some fields can't be null, like a headline or the text of a banner. If the check
drops text from one of these, it will empty the field instead. Banner and copy
blocks will then be dropped. For a hero, this will only happen if it has no
product either. An empty page headline makes the whole generation unusable.

That's the costly case. For example, the model might write
"Our 3 favourites for wet weather" when no candidate carries a 3. This headline
will be emptied. That makes the generation unusable and the fallback will
render. You will have paid for a model call just to throw it away. In cohort
mode the spec is cached before it's checked. This means all cache hits will
repeat the check and get the same fallback until the entry expires.

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

`context.locale` has to be a single language tag, such as `en-US`. It can't be a
list or an `Accept-Language` header.

### Cohorts

By default, shoppers who look alike will share a single generated spec and the
products for each shopper are filled in per request. A group of look-alike
shoppers is called a cohort. It's set by:

- the shopper's segment
- the surface and the slot
- the locale
- the item count
- whether they have any history
- the category being browsed
- the category they lean towards

Only two of these come from the shopper's data: whether they have any history
and the category they lean towards. Who they are, their searches and the
products they liked or viewed are all left out. This lets many page views reuse
a single model call.

Candidate lists are also part of the cohort, because the model is shown those
products and writes about them. In most shops the candidates come from the page
and will be shared by all the people looking at it. If you pick candidates per
shopper, you'll get smaller cohorts, because each prompt really is personal.

For a cohort, the cache key holds the _set_ of candidate SKUs. This key will
ignore the order they were sent in, which of them were in stock and where the
60-product cut fell. Two requests with the same SKUs in a different order are
going to share a spec. Both of them will get the first spec to be generated. If
your ranking is personal and you order your candidates per shopper, the products
the copy talks about won't be the ones you put at the top.

Prices, titles and stock will always be read from your catalog at render time.
This is to make sure a stale value never shows in those fields. If a product
sold out, it's dropped as the page is served, but any sentence the model wrote
about it will stay. You can also end up with copy written from an old title,
rating or tag, because the cache key holds SKUs and none of those fields.

#### Who can create a cohort

You supply all of the cohort fields above and each distinct value will make a
cohort of its own. This will cost you a fresh model call and also a slot in the
cache. If a visitor can choose any of these values, they can choose how many
calls you pay for. These are the three that go wrong:

- a `locale` copied straight out of `Accept-Language`
- a `currentCategory` read off a URL slug
- a `segment` built from a query parameter

There's room for 10,000 entries in the built-in cache. Once it's full, made-up
values will push out the cohorts your real shoppers were being served from.

You need to draw those fields from sets you control:

- your own locale list
- your own category ids
- your own segment labels

A cohort prompt leaves out the shopper's searches and signal lists, but those
three fields go in as written. If a visitor can set one, what they send reaches
your provider. The other cost will be the bill, plus a model round trip on a
page that was being served from cache.

To generate for each shopper instead, you can pass `generation: 'per-shopper'`.
The model will then pick the products too and each shopper will cost a call of
their own.

```ts
createComponentGenerator({ provider, generation: 'per-shopper' });
```

#### What you put in `segment`

In both modes, `segment` goes to the model exactly as you wrote it. The schema
takes any string of up to 128 characters. Stick to plain merchandising labels
like `lapsed`, `high-value`, `trial` or `wholesale`. Keep out anything that says
something protected about a person:

- health
- race
- ethnic origin
- religion or belief
- sex life or sexual orientation
- politics
- union membership
- biometric or genetic data

This also applies to `recentSearches`, `context.searchQuery` and
`interaction.type` in per-shopper mode. These three are shopper text and will be
sent as written. Anything a shopper types belongs to them, but the label you
give them is your choice.

### Limits

All free-text fields and all arrays have a cap, because your strings end up
inside a model prompt and you pay for a model per token. These caps are in
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

Each cap bounds a single field on its own. Together they aren't a budget for the
whole prompt. Core doesn't count tokens either. The digest, the short summary of
the shopper and the page, trims signals instead of throwing. The prompt will
also be limited to 60 in-stock candidates. With long titles and tag lists, those
60 products can still be too much for a small model.

### Unknown fields are rejected

Any fixed-shape object is a `strictObject`. If you misspell `recentSearches`,
you'll get an error instead of a shopper who looks like a first-time visitor
with no sign of why. `interaction.meta` is the only open shape. It takes any
key, except the keys that would change a prototype instead of the object.

## Bringing your own ranking

By default core orders the products for you in cohort mode and in the fallback,
by scoring each candidate against the shopper's signals. You might already have
a recommender you trust:

- bought-together data
- an engine trained on your orders
- a merchandiser's hand-picked row

If you pass `rank: 'given'`, the order you sent will be kept for grids and
carousels in cohort mode and in the fallback. The hero's product will still be
picked by the model. In per-shopper mode the model will pick the order too.

```ts
const generator = createComponentGenerator({ provider, rank: 'given' });
```

You keep the other checks either way. Core still drops anything the shopper
shouldn't be shown:

- out of stock
- already bought
- in the basket
- disliked
- being looked at right now

These checks use the payload you sent and not a trimmed copy of it. This means
a shopper with a long order history is covered too. Each product will still have
a basis: this is a code like `most_viewed` to say why
it's shown. Core checks this basis against the shopper's real signals. All of
the model's text will still be read by the claim check.

There are six bases, but two of them prove less than their names suggest:

- `most_viewed` is checked against the SKUs they viewed.
- `similar_to_current` is checked against the category being browsed.
- `liked_category` is checked against the categories of products they've bought,
  liked, carted or viewed. Just standing on a category page doesn't count.
- `popular` claims nothing.
- `complements_cart` checks only that the basket isn't empty.
- `complements_purchase` checks only that the order history isn't empty.

Of these, the two `complements_` bases are the weak ones, because nothing here
can know that a product goes with another. If a basis fails, the sentence and
the badge stating it are dropped too.

Candidates can also carry a `reason` (the phrase shown under the product). You
can use this if your ranking knows something the signals don't:

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

Any reason you supply is in your own words, like the title. It renders as
written and skips the claim check. But that only applies where this request
actually used it (the default `cohort` mode). In `per-shopper` mode the model
writes the reasons itself. All of these will be read by the claim check, even if
a reason reads the same as yours.

You don't have to supply a reason: core will state the basis for you from the
shopper's signals, like "More in Backpacks" or "Goes with what is in your cart".
These are core's words and not the model's. In `cohort` mode they also skip the
claim check.

## What the model sees

There are two generation modes and they send different things. Cohort is the
default.

### Cohort mode

- the surface and the slot
- the locale
- the segment, if set
- the category being browsed (`context.currentCategory`)
- the name of the category the shopper leans towards most, but not its score
- whether this shopper has no history at all (no likes, dislikes, purchases,
  basket items or views). Searches and other interactions don't count
- how many products the spec can place (`context.maxItems`)
- the candidate list: a line per product with its SKU, title, category, rating
  and tags

### Per-shopper mode

All of the above and also:

- the SKU being looked at right now
- the current search
- whether this is a returning shopper
- liked SKUs, and disliked SKUs
- purchased SKUs and what is in the basket
- most-viewed SKUs, each with its view count
- recent searches
- up to six categories they lean towards, strongest first
- other kinds of interaction, each with a count

### Left out of both

- `user.id`
- all timestamps (`at`). Core uses these to sort signals and then they're
  dropped
- dwell time (`dwellMs`). It's added up in the digest and left out of the prompt
- every price, and every currency
- `imageUrl`
- `interaction.value` and `interaction.meta`. The model is told which kinds of
  interaction happened and how often, but no more

The candidate list will be trimmed before it's sent. Out-of-stock products will
be dropped and no more than 60 products will go, in the order you supplied.

`spec-cache.test.ts` walks all the fields of the digest, to check that each
field is either in the cache key or removed from the cohort prompt. If a field
is left out of the key but still changes the prompt, that test will fail. It
will also fail for a new field added to the digest, until someone says which
side the field is on.

## What the model decides, by mode

Here you can see what the model wrote and what will be replaced by core before
the page is served.

| Decision                           | Cohort, the default                     | Per-shopper                            |
| ---------------------------------- | --------------------------------------- | -------------------------------------- |
| Layout and block order             | The model                               | The model                              |
| Headline, subheadline, copy        | The model                               | The model                              |
| Emphasis per item                  | The model                               | The model                              |
| Badge text                         | Dropped, written for another product    | The model                              |
| Which products, and in what order  | Filled in per request, not by the model | The model, from your candidates        |
| The reason and basis per product   | Filled in per request, not by the model | The model, checked against the signals |
| Which bundle, of the ones you pass | Chosen per request, not by the model    | Chosen per request, not by the model   |

In cohort mode the grid and carousel items are filled in per request (best pick
first). That way, a spec written for one shopper will also fit the next.

But the hero is the exception. It keeps the product the model named, because its
headline and body were written about that product. If this product can't be
placed, core will drop the link and keep the words. It can't be placed if:

- this shopper can't see it: it's out of stock, not a candidate, disliked,
  already bought, in the basket or being looked at
- an earlier block already placed it
- the item budget had run out by the time the hero was reached

## Any provider

There are three things to a provider:

```ts
export interface ComponentProvider {
  /** Short identifier recorded on every generated spec, e.g. 'anthropic'. */
  readonly name: string;
  /** Concrete model identifier, e.g. 'claude-opus-5'. */
  readonly model: string;
  generate(request: ProviderRequest): Promise<ProviderResult>;
}
```

`createComponentGenerator({ provider })` takes any object of that shape. This
might be a hosted API, a model you run yourself, a deployment inside your
tenancy or a recorded fixture. `@rudra-js/core` depends on no vendor SDK.
`@rudra-js/anthropic` is just one adapter and you don't have to use it.

An adapter takes its API key as an option. You can then choose where the key
comes from. `ANTHROPIC_API_KEY` is just the name the example shop uses. No
package here reads the environment.

## The cache

By default `cache` is an in-process store. `createMemorySpecCache()` keeps an
entry for `ttlMs`. This defaults to 60,000 milliseconds (one minute). This store
will hold up to `maxEntries`, which defaults to 10,000. Once it's full, the
entry read longest ago will be the first to go.

An entry holds the generated spec, as the model returned it before any checks.
It also holds `generatedAt` (the epoch milliseconds of when the model produced
the spec). It doesn't hold a payload or a prompt.

In cohort mode an entry holds no shopper id and it's shared by all the shoppers
in the cohort. But there's an exception if the segment or candidates were picked
for one shopper. In per-shopper mode the model wrote the entry from the signals
of that shopper. Its text can then repeat them (a search term, for instance)
and the entry will be personal data until it's gone.

Expiry is checked when an entry is read. An expired entry will stay in memory
until it's read again or pushed out by a newer entry.

The cache interface is two methods and an optional third:

```ts
export interface SpecCache {
  get(key: string): Promise<CachedSpec | undefined>;
  set(key: string, cached: CachedSpec): Promise<void>;
  delete?(key: string): Promise<void>;
}
```

You can also pass a store of your own (Redis, Memcached or whatever you already
run) and it will keep entries on its own terms. It's up to you to declare to
your users what that store holds and for how long. That's not set by this
package. To store nothing at all, you can pass `createNullSpecCache()`.

### When a generation is wrong

- If you pass `provider: null`, nothing new will be generated and all pages will
  render the fallback.
- If you shorten `ttlMs`, a bad entry will end sooner.
- If your store has `delete`, you can drop an entry by the `key` on its
  `GenerationEvent`. The next request will then generate again.

Core can't drop all the entries of a shopper for you, because nothing maps a
shopper to their keys. Per-shopper entries will end when they expire or when
newer entries push them out. You can also delete an entry by a `key` you kept.

## Watching it in production

The generator never fails a render. If a provider has been down for a week, this
will only show up as plainer pages. To find out, you need to watch `onEvent`.
Each call to `generate` that gets past input validation reports exactly one
`GenerationEvent`. If a payload fails `parseTrackingInput`, it will throw
instead and report nothing.

These are the numbers to keep:

- **Fallback share.** This is the share of events with `source: 'fallback'`. Be
  sure to alert if it climbs. `degradedReason` will tell you which way the call
  failed. If the reason is `'provider-error'` or `'timeout'`, `error` has the
  value that was thrown.
- **Cache hit rate.** `cache: 'hit'` over the events that have a `cache` field.
  A store that's down will show as `cache: 'error'` and a slow store as
  `cache: 'timeout'`. A broken store will then show up here and not just as a
  rising bill.
- **Spend.** This is the sum of `usage` over the events where `calledModel` is
  true. Any requests that joined a generation already in flight will carry the
  `usage` of that generation too. If you sum over all the events, this will
  count a call many times. Some of the calls the model answered are turned down
  by the adapter: a `max_tokens` stop, a refusal, no tool call or a reply that
  doesn't fit the schema. These were billed too, but they arrive as a
  `'provider-error'` with no `usage`. That's why your bill will be more than
  this sum.

## Running it in a regulated shop

This isn't legal advice. Which rules apply will depend on where you sell. To
help you answer the questions in a privacy or consumer-law review, this section
describes what the package does.

**What leaves your server.** Nothing, unless you pass a `provider` or a `cache`
that has its store somewhere else. With a provider, cohort mode will send the
page and locale, the category, the segment you set, the shopper's strongest
category, whether they have any history and the candidate products. That has no
shopper id, but it can still be personal data. Both the strongest category and
the history flag are taken from the shopper's data. Any segment will go to the
provider exactly as you wrote it. If you pick or order the candidate list per
shopper, this list is also about the shopper. Per-shopper mode will also send
the shopper's signals. You can see these lists under
[What the model sees](#what-the-model-sees). `user.id` is never sent in either
mode. The provider should be your processor, under a contract that says this.
For Anthropic, see the `@rudra-js/anthropic` README.

**A shopper who objects to profiling.** Leave `signals` and `user.segment` out
of their payload. In per-shopper mode, you also need to leave out
`context.searchQuery` and `user.isReturning`. They will be treated like a
first-time visitor, with a spec built just from the page and the catalog. With
those left out, `generateDeterministic(input)` can be used to get the same kind
of spec without calling the model or the cache. But if you call it with signals,
it will personalise.

**Deleting a shopper's data.** This package keeps nothing about a shopper except
the cache. In cohort mode an entry holds no shopper id and it's shared by all
the shoppers in the cohort. There's usually no single shopper's entry to delete.
But there's an exception if a cohort entry has a segment or candidate list
picked for one shopper. Like all per-shopper entries, it's about that shopper.
Nothing maps a shopper to their entries. That's why you need to keep `ttlMs`
short or pass `createNullSpecCache()`. `onEvent` sends no shopper id. But in
per-shopper mode its `key` is derived from a shopper id. `violations` can also
name SKUs from a shopper's basket or purchases. Treat logs of `onEvent` as
personal data.

**Caching pages.** In its HTML, a personalised page will say things like
"Goes with your cart" and "You looked at this recently". Serve those pages with
`Cache-Control: private` or `no-store`, to be sure a shared cache never hands
one shopper's page to another.

**Telling shoppers a model wrote the copy.** In the wrapper, `data-rudra-source`
says `llm` or `cache` if a model wrote the copy but `fallback` if it didn't.
This makes it a machine-readable marker you can build on, for example to show a
note. Whether you must label AI-written copy and how you do it will depend on
where you sell. In the EU, Article 50 of the AI Act is the rule to ask about.

**Claims.** All the copy on your page is your advertising, whoever wrote it. The
claim check catches prices, discounts, stock, ratings, delivery, urgency and
generic environmental claims. But it's just a list and rewordings get through.
You can read why in SECURITY.md and see the known ones in the tests. Any claim
it misses is still yours to stand behind.

**Children.** In the UK, the ICO's Children's Code covers any shop that
under-18s are more likely than not to use, not only a shop aimed at under-18s.
Its standard 12 asks for profiling to be off by default unless you can show a
compelling reason, judged by the child's best interests. It also asks for
safeguards when profiling is on. For a shop like that, don't use per-shopper
mode. For a shopper under 18, be sure to leave `signals` and `user.segment` out
of their payload unless they've switched personalisation on, as for a shopper
who objects to profiling. If you can't tell a shopper's age with confidence that
fits the risk, treat all shoppers as under 18. Just using cohort mode doesn't
turn profiling off. By default `rank: 'signals'` will still order products by
the shopper's signals in cohort mode and in the fallback, even with no provider.
Cohort mode will also still send their strongest category, whether they have any
history and any segment to the model.

**Marketplaces.** If other sellers list products on your site, EU platform rules
(Article 27 of the Digital Services Act) ask you to set out in your terms:

- your recommender's main parameters
- why they weigh as they do
- any options shoppers have to change them

This doesn't apply if you're a micro or small business. If shoppers can pick
between options, such as switching personalisation off, the control has to sit
where the products are shown.

Which parameters apply will depend on your mode and your `rank` setting:

- In cohort mode and in the fallback, `rank` sets the order. With
  `rank: 'given'` that's the order you sent. This means you will have to
  describe your own ranking.
- With `rank: 'signals'` the order comes from the shopper's category interest
  (the category they're browsing counts too), how often they've viewed a
  product, its rating and any tags it shares with products they've engaged with.
  Of these, category weighs most.
- In per-shopper mode the model picks which candidates to show and in what
  order, from what's under [What the model sees](#what-the-model-sees).
- In cohort mode the model picks the hero's product from the cohort list there.
- In all modes, anything out of stock, disliked or being looked at right now
  will be left out. This is also true of anything bought or in the basket,
  except as part of a bundle.
- A bundle will be picked by what's in the basket, then what they viewed, then
  the category being browsed.

**Accessibility.** Each of the cards is a single link with a readable name.
Headings will only render if they have text. You will have to check contrast,
focus styles and layout yourself, because these come from your stylesheet.

## Licence

[MIT](./LICENSE)
