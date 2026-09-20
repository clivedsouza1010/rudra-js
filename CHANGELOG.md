# Changelog

Notable changes to rudra-js. The format follows [Keep a Changelog][kac], and the
project follows [Semantic Versioning][semver] — with the caveat that while the
version is `0.x`, the public contracts are still moving and a minor bump may
break them.

[kac]: https://keepachangelog.com/en/1.1.0/
[semver]: https://semver.org/spec/v2.0.0.html

## [Unreleased]

### Added

- `@rudra-js/core` exports `GeneratedSpecResult`, a name for what
  `safeParseGeneratedSpec` returns. It is `z.ZodSafeParseResult<GeneratedSpec>`,
  the type the function already returned at 0.5.0 — nothing changed but the
  signature, which says it now instead of leaving it to inference. What is new
  is being able to write the type down: annotating a variable, a helper's
  parameter or a wrapper's return used to mean
  `ReturnType<typeof safeParseGeneratedSpec>`, or spelling zod's generic out by
  hand. The emitted declaration shortens with it — at 0.5.0
  `safeParseGeneratedSpec` unfolded the whole spec across 49 lines, every block
  kind and every nullable field inline, and it is one line now. Nothing new is
  asked of zod: `ZodSafeParseResult` is zod's own name for what `safeParse`
  returns, it is there at the peer floor, and the range is unchanged at
  `^4.5.0`.
- The react README states what a custom renderer is never called for. A grid,
  carousel or bundle block with nothing left in the catalog is dropped before
  any renderer runs — a host's own, registered through `extendRegistry`, as
  much as the package's. Hero, banner and copy always reach their renderer,
  because none of them reads the catalog. The behaviour is the one 0.5.0
  shipped; what was missing was saying so, and an empty-state branch inside a
  custom grid or carousel renderer is dead code. A test pins it now.

### Changed

- The example shop stops drawing two of its three call-to-action labels as
  buttons. `.rudra-bundle__cta` and `.rudra-banner__cta` came out of the rule
  they shared with `.rudra-hero__cta` in
  `examples/shop/public/demo-styles.css`, and render as bold accent text rather
  than a bordered inline-block box. Neither has anywhere to send anyone:
  `BundleRenderer` and `BannerRenderer` each draw their label as a bare
  `<span>` with no href, so the stylesheet had them looking like controls that
  did nothing. The hero's label keeps the button rule, because it became a real
  link in the same release. The react README says to copy this stylesheet as a
  starting point, so a copy taken since 0.5.0 differs here.

### Fixed

- `@rudra-js/react` drew the hero's call to action as a label no one could
  click. It was a bare `<span class="rudra-hero__cta">` next to
  `<a class="rudra-hero__link">` inside `<section class="rudra-hero">`, while
  the demo stylesheet drew it as a button, so a pointer landing on it hit
  nothing. The span is now the last child of that anchor, after
  `<span class="rudra-hero__price">`: a click or a tap on the label follows the
  link, and the link's accessible name runs through the label rather than
  stopping at the price. Keyboard access is where it was — the anchor has
  always been focusable and the label still is not. Nothing else about the
  markup moved, and the condition for drawing the label is the one it was: a
  hero whose `sku` is `null`, or whose SKU has left the catalog, still renders
  no anchor and no label. What this does break is hero CSS that reaches the
  class from above it. `.rudra-hero > .rudra-hero__cta`,
  `.rudra-hero__link + .rudra-hero__cta` and
  `.rudra-hero__link ~ .rudra-hero__cta` each matched at 0.5.0 and none matches
  now, so a label that took its border and padding from one of those renders as
  bare text. `.rudra-hero .rudra-hero__cta` and a plain `.rudra-hero__cta` both
  still match, and `examples/shop/public/demo-styles.css` uses the plain form.
  Two things follow from the new parent: the label inherits the anchor's
  `color` unless it sets its own, and `.rudra-hero__link:hover` covers it now.

### Security

- Three of the checks that stand between model output and a shopper were
  narrower than they read, and all three are widened.

  The set of products that must never be recommended is now read from the
  payload instead of from the digest. The digest keeps the eight most recent
  purchases and eight most recent basket entries because that is what a prompt
  can afford; the blocklist was reading the same shortened lists, so a shopper
  with a longer order book could be recommended something they already own, or
  have in the basket, with nothing recorded in `violations`. Bundles are
  unchanged and still allow a set holding a bought or in-basket product, which
  `SECURITY.md` now says out loud.

  A product's badge is now dropped along with its reason when the stated basis
  does not hold. The reason was already dropped, the basis already downgraded
  to `popular` and the downgrade already recorded — and then a badge saying the
  same thing in three words rendered underneath. Twenty-four characters is
  enough for "You viewed this".

  `liked_category` no longer accepts the category a shopper is merely standing
  in. Category affinity scores the current page on purpose, because it is good
  evidence for ranking, but it is not evidence that anyone likes anything: a
  first-time visitor on a tent page had a tent affinity and a clean bill for
  "because you keep coming back to tents". It is now checked against the
  categories the shopper bought, liked, carted or viewed in. `similar_to_current`
  is the basis for standing on a page, and it says so honestly.

- The prompt escapes invisible characters the general Unicode categories miss.
  `Default_Ignorable_Code_Point` is in the class now, which covers the ones that
  are marks or letters rather than format characters — the Hangul fillers, the
  Mongolian selectors and the thirteen variation selectors at U+FE00 that spell
  no emoji. Twenty-eight such code points used to reach the model as themselves,
  which is an alphabet: enough to carry a sentence inside a search term that
  reads as ordinary text in a shop's own logs. Three are still let through, the
  zero-width joiner and U+FE0E and U+FE0F, because emoji are spelled with them.
  Ordinary text, accented text, non-Latin text and emoji are untouched.

- What a host value turns into is capped, not just the value itself. An escape
  writes up to eight characters for one, applied after the contract's length
  caps, so a field sitting on its cap could buy eight times the prompt — and the
  bill — that the cap implies. A quoted value is now cut at twice
  `FIELD_LIMITS.shortText`, on a character boundary. Real text escapes nothing
  and never reaches it.

- `productSchema` reads an `imageUrl` path the way a browser does. A browser
  drops tab, carriage return and newline from a URL before parsing it and reads
  a backslash as a slash, so a handful of root-relative-looking paths actually
  named another host — and both this package's own comment and the react README
  said those were what `productSchema` rejected. It does now. Ordinary paths,
  including one with a stray tab in the middle, are accepted as before.

- `@rudra-js/react` treats a catalog row flagged `isInStock: false` as a row
  that is not there. Cards for it are dropped, a hero loses its link, and a
  bundle with a sold-out member disappears — the same as a row you leave out,
  which was already the documented behaviour. Core only ever names a product
  that was in stock in the payload, but the `products` prop is read later and
  can be the fresher of the two. A catalog that omits the field renders as it
  did.

- The cache key holds the provider name and the model id as two fields rather
  than as one joined string. Joined with a colon they were ambiguous, and hosted
  model ids carry colons, so two different provider configurations sharing one
  store could read each other's entries. **Every cache key changes with this**,
  so a shared persistent store misses once per key after the upgrade and then
  settles. An in-process cache notices nothing.

- `SECURITY.md` and the package READMEs now state four limits that were true
  before and unwritten: block prose carries no basis and so nothing checks it
  against a shopper's history; `complements_cart` and `complements_purchase`
  check only that a basket or an order history exists; a bundle's copy is
  written before the shop picks which set fills the block; and a cohort key made
  from anything a visitor can choose — a `locale` taken from `Accept-Language`,
  a category read off a URL slug — lets one visitor mint cohorts, pay for a
  model call each and evict the entries real shoppers were being served from.

## [0.5.0] - 2026-09-14

### Changed

- `@rudra-js/core` now screens every model-written string with
  `@rudra-js/attested` as well as with its own `CLAIM_PATTERNS`, which is a new
  required peer dependency. Three passes, in this order: core's patterns, which
  still name one of `rating`, `price`, `discount`, `delivery` and `stock`;
  attested's quantity layer, recorded as `unverifiable-claim:quantity:<field>`;
  attested's wording layer, recorded as `unverifiable-claim:wording:<field>`.
  Core's patterns answer first so every violation string an evaluation already
  counts reads the same as before. All 41 patterns stay — measured over the 55
  distinct strings the tests require to drop by kind, they catch all 55, where
  attested's two layers together reach 38, so replacing them would have been a
  downgrade. The extra pass costs what an extra pass costs: one `reconcileSpec`
  against 0.4.0, median of nine batches of twenty, runs 0.021 ms to 0.215 ms on
  digit-free copy over seven candidates, 0.032 ms to 0.244 ms digit-free at the
  payload ceiling, and 0.022 ms to 0.967 ms with a digit in every field against
  a 60-candidate spec sheet. That is 7.6x to 44x on a pass that was cheap to
  begin with, and it runs next to a model call, not instead of one.
- A specification with a number in it is no longer kept on the strength of the
  words around the number. `"a comfort rating of -5C"` and
  `"a waterproof rating of 20,000mm"` are kept when a `5` or a `20000` turns up
  in a `tag` or a `category` on the candidates the prompt showed the model, and
  dropped as `quantity` when it does not. The number, not the string: a tag
  reading `5-pocket` keeps the first of those as surely as `-5C comfort` does.
  Those are the strings the prompt hands the model and lets it repeat; a `title`
  and a `rating` it is shown but told never to restate, so neither stands behind
  a number. This reverses a documented judgement in `reconciliation.ts` (since
  moved to `claim-screening.ts`) and it reclassifies 15 strings the test suite
  used to assert were kept. Put your spec sheet in `tags` and the model can
  quote it. On a catalogue with no digit in any tag or category — the example
  shop is one — the rule becomes "no digit may appear", and an emptied headline
  makes the whole generation unusable, so one digit there costs the model call.
- The numbers that stand behind a sentence are narrower than the request. Only
  candidates the prompt actually showed the model count: a product that is out
  of stock or past the 60-candidate cap stands behind nothing. `currentCategory`
  does not count at all — it is a string from the request rather than a row of
  the catalogue, and a host that passes a URL segment into it would be handing
  the fact list to whoever types the URL. A `reason` and a `badge` are read
  against their own product's tags and category; every other field reads all the
  candidates' pooled.
- A `reason` this library wrote is exempt from the screen, not just one the host
  supplied. In `cohort` mode `fitToShopper` replaces every item reason with the
  host's own sentence or the selector's, so screening it was core reading back
  its own copy — and losing, for any shop with a category called Clearance or
  Last Chance, while the deterministic component printed the same sentence
  unscreened. The fourth argument to `reconcileSpec` is now a
  `ReadonlyMap<string, string>` of SKU to that sentence rather than a
  `ReadonlySet<string>` of SKUs, and `ProductPick.reasonFromHost` is gone with
  it.
- Three more patterns, all closing a gap in a rule that was already there rather
  than opening a new one. `rating` catches "number one seller", the words a model
  reaches for when "best seller" is banned. `price` catches a currency sign with
  no digit after it, because "$thirty-nine and it is yours" was walking past a
  rule that asked for one, and catches "dollars" and "euros" spelled out —
  "pounds" stays out of that one, since a pack weighs two of those.

### Fixed

- `@rudra-js/attested` laid a string fact out from its exponent without weighing
  the run first, so a twelve-character catalogue tag took the process down.
  `'1e2000000000'` threw a `RangeError`, and `'-2.5e400000000'` reached a heap
  abort no caller can catch. An exponent that would run past a thousand digits
  now stands behind no numeral at all — nothing a shop sells is that wide, and
  every finite JavaScript number lays out inside it, the longest being `5e-324`
  at 326 characters. Core screens every model-written string now, so a tag like
  that reaches this code on any render. `@rudra-js/core` keeps such a tag off
  the fact list as well, rather than relying on the fix: attested is a peer
  dependency, so the copy a host has installed may still be one that tries.
  Core draws its line on the exponent and attested on the laid-out run, so a
  few tags at the margin — `1e1000`, `9999e998` — pass core's rule and then
  stand behind nothing here. Nothing that wide is a product fact either way.
- `@rudra-js/attested` did two things again on every `verify` call that it only
  needed to do once: it re-read the whole fact list, and it rebuilt its index
  over the text for each of the eighty-odd phrases it screens against. A fact
  list is now read once per list rather than once per call, held against a copy
  of what the list carried so a host that writes to its own array still gets a
  fresh reading. Measured on one call, median of nine batches of twenty: handed
  the same array again, as core does for the fields of one pass, 0.052 ms to
  0.025 ms on a digit-free field, 0.251 ms to 0.016 ms against 420 facts and
  2.245 ms to 0.022 ms against 4200; handed a new array every call, as core's
  per-product `reason` and `badge` are, 0.045 ms to 0.018 ms, 0.251 ms to
  0.231 ms and 2.224 ms to 2.300 ms. The second set is the index saving on its
  own, and at 4200 facts the copy costs a shade more than it saves.

## [0.4.0] - 2026-09-13

### Added

- `@rudra-js/attested`, a new package with no dependencies and no node builtins.
  It checks model-written copy against the facts a shop stands behind, in two
  layers reported apart. The quantity layer inverts the check core's
  `CLAIM_PATTERNS` cannot: every run of digits in the text has to be a value the
  host supplied, whatever language the sentence is in, so "Nur noch 2 übrig" and
  "4,8 von 5" no longer sail through. The wording layer, for claims with no
  number in them, stays a denylist, says so in `strength: 'best-effort'` on
  every result, and takes phrases the host adds for their own language — or,
  through `allowedPhrases`, wording the shop stands behind, so a shop that
  genuinely offers free shipping is not barred from saying so. `verifyFields` also
  reads the fields joined, because a card renders them next to each other and
  the model picks where one field ends. The README states the guarantee in one
  sentence and lists every bypass left open under its own heading. Nothing in
  `@rudra-js/core` is wired to it yet.

### Fixed

- `@rudra-js/attested` dropped only format characters as invisible, so a
  variation selector survived both layers. `"$1<U+FE0F>3"` renders as `$13` and
  passed against facts of 1 and 3 — a false acceptance in the layer the package
  calls a proof — and `"fr<U+FE0F>ee shipping"` walked past the built-in entry.
  The class is now every format character and every default-ignorable code
  point, which covers the variation selectors, the combining grapheme joiner and
  the zero-width set, and a sweep over the whole of Unicode holds it there.
- `@rudra-js/attested` read a number fact through `String()`, so `1e21` arrived
  as `1e+21` and minted 1 and 21 as supported values. Both `"1 left"` and
  `"Only 21 sold"` then passed. A number is now laid out in positional notation
  first, keeping exactly the digits `String()` chose and adding only the zeros
  the exponent implies. String facts are untouched, because there the host typed
  the digits.
- `@rudra-js/attested` could not actually allow 7 of its 81 built-in phrases.
  `allowedPhrases` deleted the exact string while matching ignored spaces and
  phrases nest, so allowing `best seller` left `bestseller` firing and allowing
  `back in stock` left `in stock` firing. An allowance now works on the text
  rather than on the list: where one of the host's phrases appears, a banned
  claim sitting wholly inside it is not reported, and the same words elsewhere
  still are. `checked` stays at the full list. This also closes the negation
  hole the README names — allowing `no sale` clears
  `"there is no sale on this product"` while a `sale` later in the same text
  still fails.
- `@rudra-js/attested` still let a control character or a combining mark split a
  number, because neither is a format character or default-ignorable.
  `"$1<U+0008>3"` and `"$4<U+0305>9"` both render as the joined number and both
  passed against the two digits apart. The class is now every character that
  takes no room on the page: format characters, default-ignorable code points,
  the controls that are not whitespace, and the marks that hang on the character
  before them. Whitespace controls and spacing marks stay, because a tab, a line
  break and a Devanagari matra are gaps the shopper can see, so two numbers on
  two lines are still two numbers. The wording layer takes the same class, and it
  composes accents before dropping anything, so `café` keeps its `é` while
  `"fr<U+0305>ee shipping"` no longer hides from its own entry.
- `@rudra-js/attested` minted garbage from a string fact in exponent notation.
  The number arm was laid out positionally, but the string arm was not, so
  `'1e21'` still stood behind `"Only 21 sold"`. A string whose whole content is
  a number in exponent notation is now laid out the same way; any other string
  is still read exactly as typed, so `'SKU AX-220e5'` keeps minting 220 and 5.
- `@rudra-js/attested` threw a `TypeError` on any fact that was not a number or
  a string. `values: [product.price]` with a null price took the whole call
  down, and a bigint — the only way to hand over an id past 2^53 without
  `JSON.parse` rounding it — threw as well. `values` now takes bigints, and
  anything else stands behind no numeral instead of throwing.
- `@rudra-js/attested` let an allowance reach across a paragraph break. The
  allowance works on normalised copy, where a blank line and a `---` rule both
  collapsed to a space, so `['we do not offer free shipping']` forgave
  `"We do not offer"` above a rule with `"Free shipping on every order"` below
  it. A line break now survives normalisation: matching still reads straight
  through it, so the denylist catches `"Free\n\nshipping"`, but an allowance
  will not bridge one. The two rules pull opposite ways on purpose.

- `@rudra-js/core`'s claim screen read the model's text with nothing but
  `toLowerCase()` in front of it, so a banned claim only had to be spelled with
  characters the pattern did not expect. A zero-width space, a soft hyphen or a
  control character dropped inside a word, an overline hung on a letter, a
  Cyrillic o standing in for a Latin one, a blank-rendering Hangul filler, or the
  whole phrase typed fullwidth — every one of those renders to the shopper as the
  claim it is, and every one walked straight past the rule written for it. The
  text is now read through the same normalising pass `@rudra-js/attested` uses:
  the characters that take no room come off, compatibility spellings fold to
  plain ASCII, and a short table of Cyrillic and Greek look-alikes maps back to
  Latin. Only the reading changes — what renders is still exactly what the model
  wrote, character for character. The screen is the same best-effort backstop it
  always was: a reworded claim still gets through, and the structural boundaries
  are still the real defence.

### Changed

- `@rudra-js/attested` documents three holes it does not close, all in the
  best-effort wording layer. A character that folds into an allowance counts as
  that allowance, so `"№ SALE"` passes under `['no sale']`. A footnote marker
  glued to a phrase drops the finding, so `"FREE SHIPPINGᵃ"` is not reported.
  And the quantity layer trusts Unicode about what renders as nothing, which a
  font is free to disagree with. Laying facts out positionally also costs
  scientific notation in the copy: `"1e-7 g"` no longer matches a fact of
  `1e-7`, and the value has to be written out in full.

## [0.3.1] - 2026-09-13

Released as 0.3.1 because the `v0.3.0` tag was pushed at a commit that predated
the version bump. The release job's own guard stopped it, nothing was published,
and `v*` tags cannot be reused. There is no 0.3.0 on the registry, and this
release carries everything that version was meant to.

### Added

- `rank` on `createComponentGenerator`. The default, `'signals'`, orders
  products by the shopper's signals as before. `'given'` keeps the order you
  sent, for a shop whose own recommender is better than four weights. Either
  way the exclusions and the stock check still apply, every product still
  carries a basis reconciliation verifies, and everything the model writes is
  still screened. Until now the host's ordering never reached the page in
  either generation mode, so adopting this meant replacing a ranker you trust.
- A candidate can carry its own `reason`, the phrase shown under the product,
  for when your ranking knows something the signals do not. A reason you supply
  is your own words, like the title, so it renders as written and is not
  screened. The same sentence from the model still is.

### Fixed

- A product's `badge` is now read for banned claims like every other field the
  model writes. It was clamped and escaped but never screened, so in
  `per-shopper` mode a badge could carry "Only 2 left" or "Save 30%" straight to
  the page. The schema's own example for the field was "Back in stock", which is
  a stock claim, so the contract invited exactly what the screen exists to stop.
  In `cohort` mode nothing changes, because the badge was already dropped there.

- The deterministic selector no longer writes `Highly rated` as a product's
  reason. Its basis is `popular`, so the prose stated something the basis did
  not, and the claim screen deleted it: on a well-rated catalog every card in
  cohort mode lost its reason line, and each deletion was counted as the model
  making an unverifiable rating claim when the model had written nothing. The
  rating still decides the ordering, through its own weight in the score. A
  test now drives every branch of the selector through the screen, so a reason
  the screen would delete fails the suite.
- `@rudra-js/anthropic` sends `thinking: { type: 'disabled' }` by default and
  defaults to `claude-sonnet-5`. Generation runs on the request path inside
  `modelTimeoutMs`, which core defaults to 1500ms, and a model that reasons
  before answering does not finish inside that. Following the package's own
  quickstart therefore billed a call on every request and then timed out on
  every request, rendering the deterministic component every time. The model
  default alone did not fix this, because Sonnet 5 also reasons when `thinking`
  is left out; turning it off explicitly is what makes the budget reachable.
  Pass `thinking: null` to send no `thinking` field, which is what a model that
  rejects an explicit `disabled` needs, and raise `modelTimeoutMs` to match.

### Changed

- `@rudra-js/react` takes React 18 as well as 19. The peer range said `^19.0.0`
  while the package imports only two types from React and no runtime API, so
  the build touches nothing but `react/jsx-runtime`, which has existed since
  React 17. The range was refusing installs the code supports. A test now fails
  if anything in the package imports a React value rather than a type, so the
  range stays true.

## [0.2.0] - 2026-09-10

### Added

- `GenerationEvent` carries `error` and `cache`. `error` is what the provider
  threw when `degradedReason` is `provider-error`, or the timeout itself when it
  is `timeout`, so rate limiting and schema drift no longer arrive as the same
  code. `cache` says how the request's one cache read went — `hit`, `miss`,
  `error` or `timeout` — so a store that is down stops looking exactly like a
  cold cache.
- `SpecCache` takes an optional `delete(key)`. The in-memory cache implements
  it and the generator never calls it; it is how a host drops one bad entry,
  using the `key` from that generation's event.
- `FIELD_LIMITS` names two caps that were written into the schema by hand:
  `localeTag`, 35, and `maxItems`, 12. Both are in the core README's table of
  limits.
- The claim screen reads six more ways of writing what it already banned: a
  currency code before the number, the rupee and the krona, a score as "4.8 out
  of 5", "limited stock", a count that "remains", and money off with no percent
  sign on it.
- The READMEs say what leaves the machine. The core README lists, per mode,
  every field that reaches the model and every one that stays behind —
  `user.id`, timestamps, dwell time, prices, currencies and `imageUrl` are in
  neither prompt — what belongs in `segment` and what does not, the
  three-method interface any provider sits behind, and what an entry in the
  cache holds. The anthropic README names the endpoint a generation posts to,
  and says an EU or UK shop sending personal data to Anthropic is the one that
  needs a data processing agreement, not this package. SECURITY.md says how to
  check a published package with `npm audit signatures`.
- The core README gains an options table for `createComponentGenerator` with
  every default, a "What the model decides, by mode" table, a "Watching it in
  production" section on what to compute from `onEvent` and what to alert on,
  and a "When a generation is wrong" section on getting a bad entry off the
  page.
- The example shop has a README and an `.env.example`, and `RUDRA_SHOP_MODE`
  chooses between replaying the committed transcripts and calling the model.

### Changed

- **Breaking.** `context.locale` takes one language tag — `en-US`,
  `zh-Hant-TW` — rather than any string of 2 to 35 characters. An
  `Accept-Language` header passed straight through parsed under 0.1.0 and now
  throws. The locale is part of the cohort cache key, so a list of tags gave
  every browser its own cohort and its own billed generation.
- The rationale the model writes goes through the same claim screen as every
  other field it writes, so a price or a stock claim cannot survive in the
  generation log while the same words are stripped from the headline above it.
- Both cache keys carry a fingerprint of the system prompt, so editing the
  prompt moves every key. An entry written under 0.1.0's prompt is never read
  back: it misses once and is generated again.
- **Breaking.** All three packages need Node 22.12 or later. The floor was
  `^20.19.0 || >=22.12.0`; Node 20 is end of life, and the check that installs
  the packages from outside the repo needs `--experimental-strip-types`, which
  20.19 does not have.
- The zod peer range in core and anthropic is `^4.5.0`, widened back from
  `^4.5.4`. The tool schema depends on a change zod made in 4.5.0 and on
  nothing later; the narrower range came from a weekly dependency bump
  rewriting the peer by accident.
- The release workflow checks the tag before it publishes anything: the tagged
  commit has to be an ancestor of `main`, and the tag has to equal the `version`
  in `packages/core/package.json`. A `v*` tag pushed on any branch used to
  publish, with valid provenance on it.
- Releases publish through npm trusted publishing. The workflow mints a
  short-lived OIDC token at publish time and no npm token is stored anywhere.
- The example shop is styled by default. The note at the top still says the
  package ships no CSS, and `?styles=off` shows the raw markup.
- The example shop replays by default. Only `RUDRA_SHOP_MODE=record` calls the
  model, a key on its own no longer spends anything, and a transcript that
  already exists is never overwritten.

### Removed

- Six pipeline internals are no longer exported from `@rudra-js/core`:
  `fitToShopper`, `neverRecommend`, `buildFallbackSpec`, `specCacheKey`,
  `cohortCacheKey` and `SYSTEM_PROMPT`. Nothing outside the package imported
  them, and after 1.0 taking them away would be a breaking change.

### Fixed

- A hallucinated SKU is cut to 32 characters before it goes into a violation
  string. The spec schema cannot bound a string, so the whole of whatever the
  model wrote used to land in the list an evaluation reads.
- The documents that said the model picks the products. It does under
  `generation: 'per-shopper'`; under `cohort`, the default, every product but
  the one a hero names is filled in per request. The root README, the react
  README and four source comments are corrected.
- SECURITY.md said the generator that would emit monitoring events does not
  exist. It does: one `GenerationEvent` per call through `onEvent`, and wiring
  that to a log or a rate limiter is the host's job.
- The anthropic README names its default model, `claude-opus-5`, rather than
  calling it the current one.
- The anthropic install line asks for `zod@^4`, the range its peer takes and the
  range the other three READMEs print. It said `zod`, which reads as though any
  major would do.
- `defaultFormatBundlePrice` guards what `defaultFormatPrice` guards — building
  the formatter, not running it — which is the parity the react README claims.
- The example's placeholder image carries a width and a height, so an unstyled
  card no longer fills the viewport, and its route sends `no-cache` rather than
  pinning a stale image in the browser for a year.

## [0.1.0] - 2026-09-07

The first release. Three packages: `@rudra-js/core`, `@rudra-js/react` and
`@rudra-js/anthropic`.

### Added

- The tracking-input contract: one validated JSON payload per render, with every
  free-text field and array length-capped.
- The signal digest: reduces a payload to the bounded, ordered view everything
  downstream reads.
- The component spec: the closed vocabulary a language model is allowed to
  return, doubling as a provider structured-output schema.
- Reconciliation: reads every model-written field for the claims the prompt bans
  — a rating, a price, a discount, a delivery date, a stock level — and drops any
  field that makes one. Host text is left alone.
- Reconciliation: enforces product truth and verifies the stated reason for each
  pick against the shopper's actual signals.
- The deterministic selector and fallback component, which render when no model
  does and act as the control arm for evaluation.
- The language-model port, keeping the package free of any vendor SDK.
- The spec cache: a store port plus an in-memory implementation. Per-shopper
  generation keys on the whole signal digest. Cohort generation, the default,
  keys on a listed set of fields, and a test over every digest field fails if
  one the key leaves out reaches the prompt.
- The model prompt: a cacheable instruction half and a per-shopper half, with
  every host-supplied value quoted and escaped so it cannot introduce prompt
  structure.
- The component generator: the order every other module goes in, which always
  returns something renderable and never waits unbounded on a model or a store.
- `@rudra-js/react`: renders a specification as React Server Components. Product
  facts come from the shop's catalog at render time, never from the model, and
  the recommendation area needs no client JavaScript.
- The bundle block: a set the shop sells together, shown as one offer at the
  shop's own price. The shop supplies the sets in `bundles`, the model may only
  ask for the block and write the words around it, and the framework picks which
  set when the page is served, from the shopper's own basket, views and
  category. The set's members are drawn from the same catalog every other block
  uses, and the price shown is always the shop's, in the currency the shop put
  on the set, never a sum of the parts. The model's own words for the block are
  steered by the prompt — write about the offer, never state a saving — and text
  that makes such a claim is dropped, though spotting one is not a guarantee;
  pass a `label` on the bundle to put the shop's own words on the set, which is
  text the shop wrote rather than text the model wrote.

### Changed

- The block vocabulary now has six kinds rather than five, and the render
  context has two more fields. Nothing had been published, so this is a
  breaking change taken on purpose rather than worked around: the
  block union is closed so that a spec cannot say anything the renderer has not
  agreed to, and a new kind is therefore always a breaking change. Three things
  stop compiling for a host, and each has a one-line fix.
  - A `switch` over `block.kind` that ends in a `never` default. Add a
    `case 'bundle'`.
  - A `BlockRegistry` written out by hand. Add a `bundle` entry, or build it
    with `extendRegistry`, which keeps the defaults for whatever you leave out.
  - A `BlockRenderContext` built by hand. Add `bundles`, the shop's sets keyed
    by id, and `formatBundlePrice`.

[unreleased]: https://github.com/clivedsouza1010/rudra-js/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/clivedsouza1010/rudra-js/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/clivedsouza1010/rudra-js/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/clivedsouza1010/rudra-js/compare/v0.2.0...v0.3.1
[0.2.0]: https://github.com/clivedsouza1010/rudra-js/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/clivedsouza1010/rudra-js/releases/tag/v0.1.0
