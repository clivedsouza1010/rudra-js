# Changelog

Notable changes to rudra-js. This file follows the format of
[Keep a Changelog][kac] and the project follows [Semantic Versioning][semver].
But while the version is `0.x` the public contracts are still moving and a minor
bump may break them.

[kac]: https://keepachangelog.com/en/1.1.0/
[semver]: https://semver.org/spec/v2.0.0.html

## [Unreleased]

## [0.9.1] - 2026-11-08

### Changed

- The READMEs, this changelog, CONTRIBUTING.md and SECURITY.md are reworded. No
  code changed and every code block in them is the same as in 0.9.0, so this
  release only brings the new READMEs to npm.

## [0.9.0] - 2026-10-31

### Added

- `buildRecommendationMessages` in `@rudra-js/a2ui/server`. This turns a
  recommendation result into A2UI messages that use only the basic catalog. That
  lets Flutter, Angular and other A2UI renderers show the block without
  `RudraRecommendations` or React. Prices are formatted on your server and
  product cards link to their pages with `openUrl`. In grids and carousels there
  will be two cards to a row. An empty link will be refused, as will a link or
  an image that isn't `http` or `https`. All of the text uses heading and
  caption styles. Also square brackets are turned into parentheses, `<` and `>`
  into `‹` and `›` and line breaks into spaces. This means no text can load an
  image and only a bare web or email address can show as a link.

### Changed

- **Breaking.** `@a2ui/react`, `@rudra-js/react` and `react` are optional peers
  of `@rudra-js/a2ui` now. This means a server that only builds messages doesn't
  install React. But npm and pnpm will no longer install those three for you. If
  your app uses `createRudraRecommendationsComponent` and its `package.json`
  doesn't list those three, you have to add them. If you don't, npm or pnpm will
  drop them and `@rudra-js/a2ui` will fail to load. With npm 11 they are dropped
  on the upgrade and on all later installs, even from a lockfile npm 10 wrote.
  With npm 10 and pnpm they are dropped on an install with no lockfile. For npm
  10 this is also true of `npm update` and `npm ci --omit=optional`. In the
  README the install command already lists them.

## [0.8.3] - 2026-10-24

### Changed

- READMEs are rewritten in plain words, the way the docs site was. They say the
  same things: all of the facts, defaults, limits and warnings are still there
  and all of the code blocks are unchanged. There are no more repeated sentences
  or notes on why the library was built a certain way. And words like "cohort"
  and "spec" are explained where they first appear.

### Fixed

- In the root README, Getting started didn't mention Cache Components (new
  Next.js apps turn this on). With it on, the build stops with "Next.js
  encountered the unstable value `Date.now()` while prerendering". It now says
  to either create the app with `--no-cache-components` or remove
  `cacheComponents` and `partialPrefetching` from `next.config.ts`.
- In the root README, questions were sent to GitHub Discussions. That is turned
  off and the link was a 404. Now they will be sent to Issues.
- READMEs for anthropic, attested, core and react linked to anchors on
  `rudrajs.com/docs` that the rebuilt docs site no longer has. Those links
  landed on the reference index. They now go to the reference pages for each
  package. And the core README no longer says that all exports are documented
  there.

## [0.8.2] - 2026-10-22

### Changed

- Both view dwell time (`dwellMs`) and category affinity scores are now left out
  of the cache key because they never reach the prompt. In per-shopper mode, a
  shopper whose dwell time or scores moved used to cost a second model call for
  the same prompt. Now they share the cached one. Otherwise shoppers share a key
  exactly when they did before. But a key will change if its digest has a dwell
  time or a category the shopper leans towards (the category being browsed
  counts too). This is also true of cohort keys. Any entry whose key changes
  will miss once after upgrading.
- More of the example shop's own recorded copy is caught by the claim screen.
  "other shoppers", as in "how well they've held up for other shoppers", was
  just the product rating said another way, but the prompt already says never to
  state one. "strongest all round pick", as in "the strongest all-round picks",
  ranks products by that rating. Also "strongest all around pick" covers the US
  spelling. But a plain "all-round pick" still passes. In the demo, the product
  page now drops that copy paragraph but keeps its grid. There are now 125
  phrases on the list, up from 122.

### Fixed

- In the a2ui README the install command failed with `ERESOLVE` in an app on an
  older `@rudra-js/core` or A2UI because for a bare name npm stays inside the
  range that's already in the app's `package.json`. It now asks for `@latest` on
  the `@rudra-js` packages (this includes `@rudra-js/anthropic` if the app has
  it) and `@0.14` on the `@a2ui` ones. There is a test to keep that `@0.14` on
  the release the package peers on.
- In the react, anthropic and core READMEs and the root README the install
  commands had this problem too. In an app on an older `@rudra-js/core` they
  failed with `ERESOLVE` or, when run again to upgrade, stayed inside the ranges
  the app already had. They now ask for `@latest` on the `@rudra-js` packages
  and tell you to add the other `@rudra-js` packages of the app in the same way.
  An app that has `@rudra-js/a2ui` is pointed to the install line of that
  package.
- In the react README, the command named `react` without `react-dom`. This meant
  npm could move `react` to a newer release than `react-dom` in a React 19 app.
  If that happens, React will refuse to load `react-dom`. It names both now. It
  also says Yarn moves a bare name to its latest version.
- Three gaps in the claim screen, in core and attested. In Greek text the
  accents stayed on and a shop's banned phrase `ευκαιρία` missed `ΕΥΚΑΙΡΙΑ`.
  These are now dropped on Greek letters but Latin ones are kept as before. Now
  Greek words told apart only by their accent will read as one: `προσφορά` also
  catches `πρόσφορα`. Any Greek phrase that starts or ends on ά, έ, ί, ό or ύ
  (with or without dialytika) now follows the whole-word rule, as one on α, ε,
  ι, ο or υ already did. This means `φθηνό` won't catch `φθηνότερο` any more and
  `άνετο` won't catch `πολυάνετο` either. You will have to list those forms too.
  None of `Ѡ`, `Ϙ`, `Ϗ` and `Ͳ` were folded and "LOѠ STOCK", "GOING ϘUICK", "IN
  STOCϏ" and "IN SͲOCK" got through. Now the by-look reading takes those as w,
  q, k and t. And `Ӏ` written for an l next to another look-alike capital
  ("seӀӀiΝg fast") passed both readings. Now a third reading will be added by
  both screens (by look, with `Ӏ` as l) and any reading that comes out the same
  as one already done will be skipped.

## [0.8.1] - 2026-10-18

### Changed

- `@rudra-js/a2ui` is published to npm from this release on. This will be done
  by the release workflow right after `@rudra-js/react`, since it needs both
  core and react.

## [0.8.0] - 2026-10-17

### Added

- `@rudra-js/a2ui` is a new package. An [A2UI](https://a2ui.org) agent can place
  a `RudraRecommendations` component and hint at a SKU, a category, a search and
  how many items. Your server will still pick the products and build the block
  with core. The package supports A2UI 0.9 via `@a2ui/react` and
  `@a2ui/web_core` 0.14. Not on npm yet.
- `parseComponentSpec` in `@rudra-js/core` checks a whole `ComponentSpec`
  (metadata included).
- `@rudra-js/core/schemas` is a second entry point with `productSchema`,
  `bundleSchema`, `renderContextSchema`, `FIELD_LIMITS` and
  `parseComponentSpec`. You can also use it in browser code because it skips
  core's `node:crypto` import.

### Fixed

- `SECURITY.md` listed the things a cohort key is built from but left out the
  SKUs of the candidates. Those have been part of it since 0.1.0. Any new
  candidate set will also be a new model call.

## [0.7.6] - 2026-10-10

### Changed

- READMEs now say plainly what rudra-js is (an open-source TypeScript library)
  and what it is not. Also the npm descriptions and keywords name rudra-js.

### Fixed

- In the core README, the text said our tests use `createFixedSpecProvider` to
  exercise the blocks the deterministic component never emits. They don't. It
  now says this instead: a fixed spec still has to pass reconciliation. To do
  that it has to have a headline that survives screening and at least one
  product on show.

## [0.7.5] - 2026-10-10

### Added

- `@rudra-js/attested` exports `foldLookalikes(text, byLook?)`, the part of its
  phrase normalising that strips hidden characters and folds lookalike letters.
  `@rudra-js/core` now uses this instead of keeping its own copy. This is why
  the peer range of core on attested is `^0.7.5`.

### Changed

- Now cohort cache keys will be built from the digest the model is prompted with
  instead of a hand-picked list of its fields. The same shoppers will share a
  key as before, but the key strings are new. This means existing cohort cache
  entries will miss once after upgrading.

## [0.7.4] - 2026-10-08

### Changed

- More is caught by the claim screen. `@rudra-js/attested`'s phrase list now
  holds generic environmental claims ("eco-friendly", "carbon neutral",
  "sustainable" and the like). Under EU Directive 2024/825 (applied via the law
  of each country from 27 September 2026) those are unfair unless the trader can
  show recognised excellent environmental performance. And a "neutral" claim
  based on offsetting is unfair outright. It also holds social proof nobody can
  back ("others are looking at this", "trending") and countdowns ("ends
  tonight"). It leaves out the bare word "green" because this is too often a
  colour. Also core now allows "sustainable pace". In core the stock pattern
  reads "only two left" as well as "only 2 left". In attested the list of
  phrases grows from 81 to 122.

### Fixed

- `@rudra-js/react` no longer renders an empty hero heading if the claim screen
  removes its text. And a hero left with nothing to show renders nothing. In a
  card, the link text (this is what a screen reader announces) ran together
  ("Shoe$53.67Popular"). Its parts are now separated by spaces. This also goes
  for the text and call to action of the hero link and the banner. In the react
  README it now says the banner and bundle calls to action are plain text (not
  controls).
- In the core README, the list of what the model sees was off in two places. Any
  shopper with no likes, dislikes, purchases, basket items or views counts as
  having no history. This means a shopper with only searches or other
  interactions is still sent as "no history at all". And per-shopper mode sends
  up to six categories the shopper leans towards rather than all of those.

## [0.7.3] - 2026-10-01

### Fixed

- In core and `@rudra-js/attested`, Greek and Cyrillic capitals that look like
  Latin ones got claims past the screen: "IΝ STOCK", "ΗURRY", "ΜONEY BACK" and
  "ΒARGAIN" all rendered. There are thirteen capitals which lowercase to a
  letter that looks like something else or to a letter the look-alike table
  doesn't have. For example `Ν` becomes `ν` (this reads as v). Now the text will
  be read twice by both screens (once as before, once with those capitals taken
  by how they look) and a claim will be flagged if either reading catches it.
  This means all-caps copy will still match a shop's own lowercase phrases. Also
  the table gains `ϳ` and `ѵ`, to be read as j and v.

## [0.7.2] - 2026-09-30

### Changed

- `@rudra-js/anthropic` asks the model to call its tool instead of forcing the
  call (`tool_choice` is `auto`, one call at most). It also adds a system line
  that tells the model to put its JSON in that tool. All requests fell back with
  Claude Opus 5.5, Sonnet 5.5, Fable 5.1 and Mythos 5.1 because they answer a
  forced tool call with a 400. But there is a cost: a model can now reply in
  plain text. In that case the reply will fail the check just like any other bad
  answer and the page gets the fallback component.

### Fixed

- With a lunate sigma in place of a "c", a claim got past the screen in
  `@rudra-js/attested` and core: "In stoϲk now" and "ϹHEAP" rendered. There was
  an entry for `ϲ` in the look-alike table, but the table is read after NFKC has
  turned `ϲ` into `ς` and `Ϲ` into `Σ`. This is why that entry could never
  match. Now the two lunate sigmas will be turned into `c` by both screens
  before NFKC runs. Ordinary Greek sigmas are left alone, to let the banned
  phrases of a Greek shop still match their case endings.

## [0.7.1] - 2026-09-26

### Changed

- For all four packages the npm homepage is https://rudrajs.com rather than the
  package folder on GitHub. But the repository and issues links still go to
  GitHub.

## [0.7.0] - 2026-09-25

### Changed

- In core and anthropic the zod range is `^4.0.0`, down from `^4.5.0`. Neither
  package uses anything newer than 4.0. That floor only fixed how the tool
  schema is worded, but it shut out all apps on zod 4.0 to 4.4. On those
  versions a nullable field in the tool schema will be written as `anyOf`
  instead of a type array. And before 4.1.13 the block list will also be `anyOf`
  instead of `oneOf`. Same schema, different wording.
- Now zod is a dependency of core and anthropic rather than a peer. An app
  doesn't need to have a zod of its own any more. An app on zod 3 will install
  instead of failing with `ERESOLVE`. An app on zod 4 still shares one copy. On
  zod 3 there are two copies and the app's zod can't be mixed with the exported
  schemas.
- Now the docs don't say `@rudra-js/react` needs Server Components. It never
  did. Its components don't have hooks and render the same with `renderToString`
  or in a client-rendered React 18 or 19 app.

### Deprecated

- In `@rudra-js/core`, `parseGeneratedSpec` is slated for removal. It is a
  throwing wrapper that forwards straight to `generatedSpecSchema.parse` and is
  not called by anything in the repo. To get throwing behaviour use the exported
  `generatedSpecSchema` directly. If you do not want that, use
  `safeParseGeneratedSpec`.

## [0.6.0] - 2026-09-20

### Added

- `@rudra-js/core` exports `GeneratedSpecResult` as a name for what
  `safeParseGeneratedSpec` returns. It is `z.ZodSafeParseResult<GeneratedSpec>`,
  the type the function already returned at 0.5.0. Only the signature changed,
  to state this type instead of leaving that to inference. You can now write the
  type down. To annotate a variable, a helper's parameter or a wrapper's return,
  you used to need `ReturnType<typeof safeParseGeneratedSpec>` or had to spell
  out zod's generic by hand. This also shortens the emitted declaration. At
  0.5.0 `safeParseGeneratedSpec` unfolded the whole spec across 49 lines, with
  all block kinds and nullable fields inline. It is one line now. There is
  nothing more asked of zod: `ZodSafeParseResult` is the name zod gives to the
  result of `safeParse`. It is there at the peer floor and the range stays at
  `^4.5.0`.
- Now the react README states what a custom renderer is never called for. Any
  grid, carousel or bundle block with nothing left in the catalog will be
  dropped before any renderer runs. This is true of a host's renderer
  (registered via `extendRegistry`) as much as the package's. But hero, banner
  and copy always reach their renderer because none of those reads the catalog.
  This is the behaviour 0.5.0 shipped but it wasn't written down. Also an
  empty-state branch inside a custom grid or carousel renderer is dead code.
  That behaviour is pinned by a test now.
- `SECURITY.md` and the core README say what the currently-viewed rule costs.
  Both of those already said a set will be refused if it holds the product whose
  page it is on. Neither said this rules out the common "frequently bought
  together, including this item" set on exactly the page it was written for.
  Neither said that a bundle block with no other block beside it hands the whole
  component to the deterministic fallback when the set is refused. If you sell
  the companions without the item, the set will be placed if it passes the rest.
  This is the behaviour the last release shipped and the consequence is new in
  writing only.

### Changed

- Two of the three call-to-action labels in the example shop are not drawn as
  buttons any more. `.rudra-bundle__cta` and `.rudra-banner__cta` came out of
  the rule they shared with `.rudra-hero__cta` in
  `examples/shop/public/demo-styles.css`. These two will now be rendered as bold
  accent text rather than a bordered inline-block box. Neither of those has
  anywhere to send anyone: `BundleRenderer` and `BannerRenderer` draw their
  labels as a bare `<span>` without an href. That left the stylesheet making
  those look like controls that did nothing. But the hero's label keeps the
  button rule because it became a real link in the same release. In the react
  README you are told to copy this stylesheet as a starting point. This means a
  copy taken since 0.5.0 will differ here.

### Fixed

- `@rudra-js/react` drew the hero's call to action as a label that could not be
  clicked. It was a bare `<span class="rudra-hero__cta">` next to
  `<a class="rudra-hero__link">` inside `<section class="rudra-hero">`, while
  the demo stylesheet drew this as a button. This meant there was nothing for a
  pointer to hit. Now the span is the last child of that anchor, after
  `<span class="rudra-hero__price">`. You can now click or tap the label to
  follow the link. Also the accessible name of the link will include the label
  rather than stop at the price. For keyboards, access is where it was: the
  anchor has always been focusable and the label still is not. There are no
  other changes to the markup and the condition for drawing the label has not
  changed: a hero whose `sku` is `null`, or whose SKU has left the catalog,
  still renders neither an anchor nor a label. This does break some hero CSS:
  any that reaches the class from above it. At 0.5.0
  `.rudra-hero > .rudra-hero__cta`, `.rudra-hero__link + .rudra-hero__cta` and
  `.rudra-hero__link ~ .rudra-hero__cta` each matched but none matches now. Any
  label that took its border and padding from any of those will render as bare
  text. But `.rudra-hero .rudra-hero__cta` and just `.rudra-hero__cta` still
  match (`examples/shop/public/demo-styles.css` uses the plain form). Two things
  follow from the new parent: the label inherits the anchor's `color` unless it
  sets its own. And `.rudra-hero__link:hover` covers the label now.

### Security

- Three of the checks that stand between model output and a shopper were
  narrower than they read. All three are wider now.

  Now the set of products that must never be recommended is read from the
  payload instead of from the digest. Only the eight most recent purchases and
  eight most recent basket entries are kept in the digest, because that is what
  a prompt can afford. But the blocklist was reading those shortened lists too.
  This meant a shopper with more orders could be recommended something they
  already own or have in the basket. Also nothing was recorded in `violations`.
  As `SECURITY.md` now says out loud, a bundle keeps its exception and can still
  hold a bought or in-basket product.

  If the stated basis does not hold, a product's badge will now be dropped along
  with its reason. By that point the reason was already dropped, the basis
  already downgraded to `popular` and the downgrade already recorded. But a
  badge repeating that reason in three words would then be rendered underneath.
  There is room in twenty-four characters to say "You viewed this".

  Now `liked_category` needs more than the category a shopper is merely standing
  in. For category affinity the current page is scored on purpose, because this
  is good evidence for ranking. But it's not evidence that anyone likes
  anything: a first-time visitor on a tent page had a tent affinity and passed
  the check for "because you keep coming back to tents". Now it will be checked
  against the categories the shopper bought, liked, carted or viewed in.
  `similar_to_current` is the basis for standing on a page. It is honest about
  that.

- Any member the shopper thumbed down or is looking at will now be refused by a
  bundle. It skips the never-recommend set on purpose, because a set is placed
  whole and may hold something already bought or in the basket. But it was
  reading dislikes from the digest (this keeps only the twelve most recent) and
  it never looked at `context.currentSku` at all. This let a thirteenth
  thumbs-down come back inside a set. It also let the product on the page the
  shopper was standing on come back. Both will be read from the payload now, the
  source all of the other blocks read. There is no change to the
  purchase-and-basket exception. `SECURITY.md` had already claimed both of
  these.

- Now a claim that was cut in half by the length cap will be caught. All model
  copy is truncated to fit its field and then read for price, discount, stock,
  rating and delivery claims. But that read ran after the cut. For example a
  badge reading "Ridge picks, only 2 left!" lost the word "left" at twenty-four
  characters, rendered as "Ridge picks, only 2…" and matched no stock pattern.
  That sentence would be dropped if it was two characters shorter. This leaked
  on all capped fields and needed no adversary: ordinary copy running a couple
  of characters long is enough. It also recorded no violation, so an evaluation
  counted it as clean. Now the patterns will read the text the model wrote as
  well as the text that will render. If either flags, the field goes. But the
  numeral and wording passes will still read only the rendered text: a number
  the cap threw away cannot mislead anybody.

- In the prompt, invisible characters the general Unicode categories miss will
  now be escaped. `Default_Ignorable_Code_Point` is in the class now, to cover
  the ones that are marks or letters rather than format characters: the Hangul
  fillers, the Mongolian selectors and the thirteen variation selectors at
  U+FE00 that spell no emoji. There were twenty-eight such code points that used
  to reach the model as themselves. That's an alphabet and it is enough to carry
  a sentence inside a search term that will read as ordinary text in the logs of
  a shop. Three will still be let through (the zero-width joiner, U+FE0E and
  U+FE0F) because emoji are spelled with those. This leaves ordinary text,
  accented text, non-Latin text and emoji untouched.

- Now the escaped form of a host value is capped too, and not just the value
  itself. An escape can write up to eight characters for one and is applied
  after the length caps of the contract. This means a field sitting on its cap
  could buy eight times the prompt (and the bill) that the cap implies. Now a
  quoted value will be cut at twice `FIELD_LIMITS.shortText`, on a character
  boundary. But real text escapes nothing and will never reach this cut.

- `productSchema` reads an `imageUrl` path the way a browser does. Before
  parsing a URL a browser will drop tab, carriage return and newline from it. It
  will also read a backslash as a slash. This means a handful of
  root-relative-looking paths actually named another host. And this package's
  own comment and the react README said those were the ones `productSchema`
  rejected. It does now. As before, ordinary paths will continue to be accepted.
  This includes a path with a stray tab in the middle.

- `@rudra-js/react` treats a catalog row flagged `isInStock: false` as a row
  that is not there. This means cards for it will be dropped, a hero will lose
  its link and a bundle with a sold-out member will disappear. It is just like a
  row you leave out (that was already the documented behaviour). Core will only
  ever name a product that was in stock in the payload, but the `products` prop
  is read later and can be the fresher of the two. Any catalog that omits the
  field will render as it did.

- There are now two fields in the cache key for the provider name and the model
  id, instead of just one joined string. With a colon to join those they were
  ambiguous because hosted model ids carry colons. This means two different
  provider configurations sharing a store could read each other's entries.
  **Every cache key changes with this**. After the upgrade a shared persistent
  store will miss once per key and then settle. An in-process cache will not
  notice anything.

- `SECURITY.md` and the package READMEs now state four limits that were true
  before but not written down: there is no basis in block prose and so nothing
  will check it against the history of a shopper; `complements_cart` and
  `complements_purchase` check only that a basket or an order history exists;
  the copy of a bundle is written before the shop picks which set fills the
  block; and a cohort key made from anything a visitor can choose (a `locale`
  taken from `Accept-Language`, a category read off a URL slug) can be used by a
  single visitor to make new cohorts, pay for a model call each and evict the
  entries real shoppers were being served from.

## [0.5.0] - 2026-09-14

### Changed

- `@rudra-js/core` now screens all model-written strings with
  `@rudra-js/attested` as well as with its own `CLAIM_PATTERNS`. This means
  attested will be a new required peer dependency. There are three passes, in
  this order: core's patterns (these still name one of `rating`, `price`,
  `discount`, `delivery` and `stock`); attested's quantity layer (recorded as
  `unverifiable-claim:quantity:<field>`); attested's wording layer (recorded as
  `unverifiable-claim:wording:<field>`). To keep all violation strings an
  evaluation already counts reading as they did before, core's patterns answer
  first. All 41 patterns stay. Over the 55 distinct strings the tests require to
  drop by kind, they catch all 55 where attested's two layers together reach 38.
  That means replacing those would have been a downgrade. There is a cost to the
  extra pass. Against 0.4.0 (median of nine batches of twenty) a single
  `reconcileSpec` runs 0.021 ms to 0.215 ms on digit-free copy over seven
  candidates, 0.032 ms to 0.244 ms digit-free at the payload ceiling and 0.022
  ms to 0.967 ms with a digit in all fields against a 60-candidate spec sheet.
  That is 7.6x to 44x on a pass that was cheap to begin with. It also runs next
  to a model call rather than instead of one.
- Now a specification with a number in it will not be kept just because of the
  words around the number. `"a comfort rating of -5C"` and
  `"a waterproof rating of 20,000mm"` will be kept if a `5` or a `20000` turns
  up in a `tag` or a `category` on the candidates the prompt showed the model.
  If it doesn't, they are dropped as `quantity`. It is the number that counts
  and not the string: a tag reading `5-pocket` will keep the first of those as
  surely as `-5C comfort` does. Those are the strings the prompt hands the model
  and lets it repeat. It is shown a `title` and a `rating` but told never to
  restate those. This means neither of those can support a number. This reverses
  a documented judgement in `reconciliation.ts` (since moved to
  `claim-screening.ts`) and reclassifies 15 strings the test suite used to
  assert were kept. If you put your spec sheet in `tags` the model can quote it.
  On a catalogue with no digit in any tag or category (the example shop is one)
  the rule becomes "no digit may appear". An emptied headline makes the whole
  generation unusable. This means one digit there costs the model call.
- For a sentence, the numbers that can support it are narrower than the request.
  Only the candidates the prompt actually showed the model will count. Any
  product that is out of stock or past the 60-candidate cap supports nothing.
  `currentCategory` does not count at all because it is a string from the
  request rather than a row of the catalogue. Any host that passes a URL segment
  into it would be handing the fact list to whoever types the URL. For a
  `reason` and a `badge` the tags and category of their own product are read;
  all of the other fields read those of all the candidates pooled.
- Now a `reason` this library wrote is also exempt from the screen, just like a
  reason the host supplied. In `cohort` mode `fitToShopper` replaces all item
  reasons with the sentence of the host or of the selector. By screening that,
  core was reading back its own copy only to fail it for any shop with a
  category called Clearance or Last Chance, while the deterministic component
  printed the same sentence unscreened. Now the fourth argument to
  `reconcileSpec` is a `ReadonlyMap<string, string>` of SKU to that sentence
  rather than a `ReadonlySet<string>` of SKUs. `ProductPick.reasonFromHost` is
  gone with it.
- Three more patterns, all closing a gap in a rule that was already there rather
  than opening a new one. For `rating` this catches "number one seller", the
  words a model reaches for when "best seller" is banned. For `price` this
  catches a currency sign with no digit after it, because "$thirty-nine and it
  is yours" got past a rule that asked for one. It will also catch "dollars" and
  "euros" spelled out, but "pounds" stays out of that rule since a pack weighs
  two of those.

### Fixed

- `@rudra-js/attested` laid a string fact out from its exponent without checking
  the length of the run first. This let a twelve-character catalogue tag take
  the process down. `'1e2000000000'` threw a `RangeError` and `'-2.5e400000000'`
  reached a heap abort no caller can catch. An exponent that would run past a
  thousand digits now supports no numeral at all. There is nothing a shop sells
  that is that wide. All finite JavaScript numbers lay out inside that limit,
  the longest being `5e-324` at 326 characters. Since core screens all
  model-written strings now, a tag like that will reach this code on any render.
  `@rudra-js/core` also keeps such a tag off the fact list to avoid relying on
  the fix: attested is a peer dependency and the copy a host has installed may
  still be a version that tries. In core the line is drawn on the exponent and
  in attested on the laid-out run. This means a few tags at the margin
  (`1e1000`, `9999e998`) will pass core's rule and then support nothing here.
  Either way nothing that wide is a product fact.
- `@rudra-js/attested` did two things again on all `verify` calls that it only
  needed to do once: it re-read the whole fact list and it rebuilt its index
  over the text for each of the eighty-odd phrases it screens against. Now a
  fact list will be read once per list rather than once per call. It will also
  be held against a copy of the list, to let a host that writes to its own array
  still get a fresh reading. These times are for a single call (median of nine
  batches of twenty). If you pass the same array again, as core does for the
  fields of a single pass, it goes 0.052 ms to 0.025 ms on a digit-free field,
  0.251 ms to 0.016 ms against 420 facts and 2.245 ms to 0.022 ms against 4200.
  If you pass a new array on each call, as core does for its per-product
  `reason` and `badge`, it goes 0.045 ms to 0.018 ms, 0.251 ms to 0.231 ms and
  2.224 ms to 2.300 ms. This second set is just the index saving. But at 4200
  facts the copy costs a bit more than it saves.

## [0.4.0] - 2026-09-13

### Added

- `@rudra-js/attested` is a new package without any dependencies or node
  builtins. It checks model-written copy against the facts a shop stands behind,
  in two layers reported apart. Its quantity layer inverts the check core's
  `CLAIM_PATTERNS` cannot do: all runs of digits in the text have to be values
  the host supplied, whatever language the sentence is in. This stops "Nur noch
  2 übrig" and "4,8 von 5" from being accepted. For claims without a number in
  them the wording layer stays a denylist and this is stated in
  `strength: 'best-effort'` on all results. It can take phrases the host adds
  for their own language. Via `allowedPhrases` it can also take wording the shop
  stands behind. This way a shop that really offers free shipping is not barred
  from saying that. `verifyFields` also reads the fields joined, because a card
  renders those next to each other and the model picks where a field ends. In
  the README the guarantee is stated in a single sentence and all bypasses left
  open are listed under their own heading. There is nothing in `@rudra-js/core`
  wired to this yet.

### Fixed

- `@rudra-js/attested` dropped only format characters as invisible. This let a
  variation selector survive both layers. `"$1<U+FE0F>3"` renders as `$13` and
  passed against facts of 1 and 3, a false acceptance in the layer the package
  calls a proof. `"fr<U+FE0F>ee shipping"` also got past the built-in entry. Now
  the class will be all format characters and all default-ignorable code points.
  This covers the variation selectors, the combining grapheme joiner and the
  zero-width set. It is held there by a sweep over the whole of Unicode.
- `@rudra-js/attested` read a number fact via `String()`. That turned `1e21`
  into `1e+21` and made 1 and 21 supported values. Both `"1 left"` and
  `"Only 21 sold"` then passed. Now a number will be laid out in positional
  notation first, to keep exactly the digits `String()` chose and add only the
  zeros the exponent implies. But this doesn't touch string facts because there
  the host typed the digits.
- `@rudra-js/attested` was not actually able to allow 7 of its 81 built-in
  phrases. `allowedPhrases` deleted the exact string but matching ignored spaces
  and phrases nest. This means allowing `best seller` left `bestseller` firing
  and allowing `back in stock` left `in stock` firing. An allowance now works on
  the text rather than on the list: where any of the host's phrases appears, a
  banned claim sitting wholly inside that phrase will not be reported but those
  words elsewhere still are. But `checked` stays at the full list. This also
  closes the negation hole the README names: allowing `no sale` clears
  `"there is no sale on this product"` but a `sale` later in that text will
  still fail.
- `@rudra-js/attested` still let a control character or a combining mark split a
  number (neither of those is a format character or default-ignorable).
  `"$1<U+0008>3"` and `"$4<U+0305>9"` both render as the joined number and both
  passed against the two digits apart. Now the class will be all of the
  characters that take no room on the page: format characters, default-ignorable
  code points, the controls that are not whitespace and the marks that hang on
  the previous character. But whitespace controls and spacing marks will stay,
  because a tab, a line break and a Devanagari matra are kinds of gap the
  shopper can see. Two numbers on two lines are still two numbers. Also the
  wording layer takes this class. To do that it composes accents before dropping
  anything, to let `café` keep its `é` while `"fr<U+0305>ee shipping"` won't
  hide from its own entry any more.
- `@rudra-js/attested` got garbage from a string fact in exponent notation. For
  the number arm the layout was positional but not for the string arm. This
  meant `'1e21'` could still support `"Only 21 sold"`. Now if the whole content
  of a string is a number in exponent notation it will be laid out that way too;
  any other string will still be read exactly as typed: `'SKU AX-220e5'` keeps
  giving 220 and 5.
- `@rudra-js/attested` threw a `TypeError` on any fact that was not a number or
  a string. With `values: [product.price]` a null price took the whole call
  down. And a bigint (the only way to hand over an id past 2^53 without
  `JSON.parse` rounding that id) threw as well. Now `values` can also take
  bigints and anything else will support no numeral instead of throwing.
- `@rudra-js/attested` let an allowance reach across a paragraph break. An
  allowance works on normalised copy, where a blank line and a `---` rule both
  collapsed to a space. This let `['we do not offer free shipping']` forgive
  `"We do not offer"` above a rule with `"Free shipping on every order"` below.
  Now a line break will survive normalisation. For matching it is still read
  straight past, to let the denylist catch `"Free\n\nshipping"`, but an
  allowance will not bridge one. These two rules pull opposite ways on purpose.

- `@rudra-js/core`'s claim screen read the model's text with nothing more than
  `toLowerCase()` in front of it. This meant a banned claim only had to be
  spelled with characters the pattern did not expect. You could drop a
  zero-width space, a soft hyphen or a control character inside a word. You
  could hang an overline on a letter, use a Cyrillic o in place of a Latin one,
  use a blank-rendering Hangul filler or type the whole phrase fullwidth. All of
  those will render to the shopper as the real claim, but all of those got past
  the rule written for that claim. Now the text is read via the normalising pass
  `@rudra-js/attested` uses. This means characters that take no room will come
  off, compatibility spellings will fold to plain ASCII and a short table of
  Cyrillic and Greek look-alikes will map back to Latin. Only the reading
  changes: the rendered text is still exactly the text the model wrote,
  character for character. This screen is the best-effort backstop it always
  was: a reworded claim will still get past the screen and the structural
  boundaries are still the real defence.

### Changed

- `@rudra-js/attested` documents three holes it does not close, all in the
  best-effort wording layer. Any character that folds into an allowance counts
  as that allowance: `"№ SALE"` passes under `['no sale']`. Any footnote marker
  glued to a phrase will drop the finding: `"FREE SHIPPINGᵃ"` is not reported.
  And the quantity layer trusts Unicode about what renders as nothing, but a
  font is free to disagree with that. But laying facts out positionally also
  costs scientific notation in the copy: `"1e-7 g"` won't match a fact of `1e-7`
  any more. You will have to write out the value in full.

## [0.3.1] - 2026-09-13

This was released as 0.3.1 because the `v0.3.0` tag was pushed at a commit older
than the version bump. That tag was stopped by the guard of the release job
itself, nothing was published and `v*` tags can't be reused. There is no 0.3.0
on the registry. This release carries everything that version was meant to.

### Added

- `rank` on `createComponentGenerator`. By default (`'signals'`) products are
  ordered by the signals of the shopper as before. With `'given'` the order you
  sent is kept, for a shop whose own recommender is better than four weights.
  Either way the exclusions and the stock check still apply, all products still
  carry a basis reconciliation verifies and everything the model writes is still
  screened. Until now the host's ordering never reached the page in either
  generation mode, which meant that to adopt this you had to replace a ranker
  you trust.
- Any candidate can carry its own `reason`, the phrase shown under the product,
  for when your ranking knows something the signals do not. Any reason you
  supply will be your own words (like the title). It will render as written and
  will not be screened. But the same sentence from the model will still be
  screened.

### Fixed

- Now a product's `badge` will be read for banned claims like all of the other
  fields the model writes. It was clamped and escaped but never screened. In
  `per-shopper` mode a badge could then carry "Only 2 left" or "Save 30%"
  straight to the page. The example for this field in the schema was "Back in
  stock" (a stock claim). That made the contract invite exactly what the screen
  exists to stop. In `cohort` mode nothing changes because the badge was already
  dropped there.

- As a product's reason, `Highly rated` will no longer be written by the
  deterministic selector. Its basis is `popular`. This means the prose stated
  something the basis did not and this was deleted by the claim screen. On a
  well-rated catalog all cards in cohort mode lost their reason line. All of
  those deletions were counted as the model making an unverifiable rating claim,
  even though the model had written nothing. But the rating still decides the
  ordering via its own weight in the score. There is now a test to drive all
  branches of the selector through the screen: a reason the screen would delete
  will fail the suite.
- `@rudra-js/anthropic` sends `thinking: { type: 'disabled' }` by default and
  defaults to `claude-sonnet-5`. Since generation runs on the request path
  inside `modelTimeoutMs` (core defaults this to 1500ms) a model that reasons
  before answering will not finish inside that. This means following the
  package's own quickstart billed a call on all requests and then timed out on
  all requests, and rendered the deterministic component each time. Just
  changing the model default did not fix this, because Sonnet 5 also reasons
  when `thinking` is left out. Turning it off explicitly is what makes the
  budget reachable. Pass `thinking: null` to send no `thinking` field (this is
  what a model that rejects an explicit `disabled` needs) and raise
  `modelTimeoutMs` to match.

### Changed

- `@rudra-js/react` takes React 18 as well as 19. Its peer range said `^19.0.0`
  while the package imports only two types from React and no runtime API. This
  means the build touches nothing but `react/jsx-runtime` (this has existed
  since React 17). That range was refusing installs the code supports. Now a
  test will fail if anything in the package imports a React value rather than a
  type, to keep the range true.

## [0.2.0] - 2026-09-10

### Added

- `GenerationEvent` carries `error` and `cache`. For `error` this is what the
  provider threw when `degradedReason` is `provider-error` or the timeout itself
  when it is `timeout`. This means rate limiting and schema drift won't arrive
  as the same code any more. Also `cache` says how the request's single cache
  read went (`hit`, `miss`, `error` or `timeout`). That way a store that is down
  will stop looking exactly like a cold cache.
- `SpecCache` takes an optional `delete(key)`. This is implemented by the
  in-memory cache but never called by the generator. It can be used by a host to
  drop a single bad entry with the `key` from that generation's event.
- `FIELD_LIMITS` names two caps that were written into the schema by hand:
  `localeTag` (35) and `maxItems` (12). You can find both in the table of limits
  in the core README.
- Now the claim screen reads six more ways of writing claims it already banned:
  a currency code before the number, the rupee and the krona, a score as "4.8
  out of 5", "limited stock", a count that "remains" and money off with no
  percent sign on it.
- READMEs say what leaves the machine. In the core README you will find, per
  mode, all fields that reach the model and all that stay behind (`user.id`,
  timestamps, dwell time, prices, currencies and `imageUrl` are in neither
  prompt). It also lists the data that belongs in `segment` and the data that
  does not, the three-method interface any provider sits behind and the contents
  of an entry in the cache. In the anthropic README you will see the endpoint a
  generation posts to. It also says that an EU or UK shop sending personal data
  to Anthropic is the one that needs a data processing agreement (not this
  package). SECURITY.md says how to check a published package with
  `npm audit signatures`.
- In the core README there is now an options table for
  `createComponentGenerator` with all of the defaults, a "What the model
  decides, by mode" table, a "Watching it in production" section on what to
  compute from `onEvent` and what to alert on and a "When a generation is wrong"
  section on getting a bad entry off the page.
- There is a README for the example shop and an `.env.example`. You can use
  `RUDRA_SHOP_MODE` to choose between replaying the committed transcripts and
  calling the model.

### Changed

- **Breaking.** `context.locale` takes a single language tag (`en-US`,
  `zh-Hant-TW`) rather than just any string of 2 to 35 characters. An
  `Accept-Language` header passed straight in would be parsed under 0.1.0 but
  will now throw. Because the locale is part of the cohort cache key, a list of
  tags gave each browser a cohort of its own and a billed generation of its own.
- Now the rationale the model writes will be read by the claim screen just like
  all of the other fields it writes. This means a price or a stock claim can't
  survive in the generation log while those words are stripped from the headline
  above.
- Both cache keys carry a fingerprint of the system prompt. This means editing
  the prompt will move all keys. An entry written under 0.1.0's prompt will
  never be read back: it misses once and is generated again.
- **Breaking.** All three packages need Node 22.12 or later. Until now the floor
  was `^20.19.0 || >=22.12.0`; Node 20 is end of life. Also the check that
  installs the packages from outside the repo needs to have
  `--experimental-strip-types` and 20.19 does not have that.
- In core and anthropic the zod peer range is `^4.5.0`, widened back from
  `^4.5.4`. This is because the tool schema depends on a change zod made in
  4.5.0 and on nothing more recent; the narrower range came from a weekly
  dependency bump that rewrote the peer by accident.
- Now the release workflow checks the tag before it publishes anything: the
  tagged commit has to be an ancestor of `main` and the tag has to equal the
  `version` in `packages/core/package.json`. It used to publish a `v*` tag
  pushed on any branch (with valid provenance on it).
- Now releases publish via npm trusted publishing. At publish time the workflow
  mints a short-lived OIDC token and no npm token is stored anywhere.
- By default the example shop is styled. But the note at the top still says the
  package ships no CSS. You can use `?styles=off` if you want to see the raw
  markup.
- By default the example shop replays. Only `RUDRA_SHOP_MODE=record` calls the
  model. Just having a key will not spend anything any more and a transcript
  that already exists will never be overwritten.

### Removed

- From `@rudra-js/core` six pipeline internals are no longer exported:
  `fitToShopper`, `neverRecommend`, `buildFallbackSpec`, `specCacheKey`,
  `cohortCacheKey` and `SYSTEM_PROMPT`. There was nothing outside the package
  importing those. After 1.0 taking those away would be a breaking change.

### Fixed

- Now a hallucinated SKU will be cut to 32 characters before it goes into a
  violation string. Since the spec schema cannot bound a string, all of whatever
  the model wrote used to land in the list an evaluation reads.
- Some documents said the model picks the products. It does under
  `generation: 'per-shopper'`; under `cohort` (the default) all products but the
  one a hero names are filled in per request. This is now corrected in the root
  README, the react README and four source comments.
- SECURITY.md said the generator that would emit monitoring events does not
  exist. It does: there is a single `GenerationEvent` per call via `onEvent`. It
  is up to the host to wire that to a log or a rate limiter.
- Now the anthropic README names its default model (`claude-opus-5`) rather than
  calling this the current model.
- In the anthropic README the install line asks for `zod@^4`, the range its peer
  takes and the range the other three READMEs print. It said `zod` and this
  reads as though any major would do.
- `defaultFormatBundlePrice` guards what `defaultFormatPrice` guards (this
  covers building the formatter but not running it). This is the parity the
  react README claims.
- Now the placeholder image of the example carries a width and a height. This
  stops an unstyled card from filling the viewport. Its route also sends
  `no-cache` rather than pinning a stale image in the browser for a year.

## [0.1.0] - 2026-09-07

This is the first release. Three packages: `@rudra-js/core`, `@rudra-js/react`
and `@rudra-js/anthropic`.

### Added

- There is a tracking-input contract: a single validated JSON payload per
  render, with all free-text fields and arrays length-capped.
- There is a signal digest to reduce a payload to the bounded, ordered view that
  all later steps read.
- There is a component spec: the closed vocabulary a language model is allowed
  to return, also used as a provider structured-output schema.
- In reconciliation, all model-written fields are read for the claims the prompt
  bans (a rating, a price, a discount, a delivery date, a stock level) and any
  field that makes one will be dropped. But host text is left alone.
- In reconciliation, product truth is also enforced and the stated reason for
  each pick is verified against the shopper's actual signals.
- There is also a deterministic selector and fallback component. These will
  render when no model does and act as the control arm for evaluation.
- There is a language-model port to keep the package free of any vendor SDK.
- There is a spec cache: a store port plus an in-memory implementation. In
  per-shopper generation this keys on the whole signal digest. In cohort
  generation (the default) this keys on a listed set of fields. If one the key
  leaves out reaches the prompt, a test over all digest fields will fail.
- There is a model prompt: a cacheable instruction half and a per-shopper half,
  with all host-supplied values quoted and escaped to stop those from
  introducing prompt structure.
- There is a component generator: the order all of the other modules go in. It
  will always return something renderable and will never wait unbounded on a
  model or a store.
- `@rudra-js/react` renders a specification as React Server Components. At
  render time, product facts come from the shop's catalog and never from the
  model. Also the recommendation area needs no client JavaScript.
- There is a bundle block: a set the shop sells together, shown as one offer at
  the shop's own price. It is up to the shop to supply the sets in `bundles`.
  All the model may do is ask for the block and write the words around it. When
  the page is served the framework picks which set, from the shopper's basket,
  views and category. All members of a set are drawn from the catalog all of the
  other blocks use. Any price shown will always be the shop's, in the currency
  the shop put on the set, never a sum of the parts. Any words the model writes
  for the block are steered by the prompt (write about the offer, never state a
  saving) and text that makes such a claim is dropped, though spotting one is
  not a guarantee. You can pass a `label` on the bundle to put the words of the
  shop on the set. This is text the shop wrote rather than text the model wrote.

### Changed

- Now the block vocabulary has six kinds rather than five and the render context
  has two more fields. Since nothing had been published, this is a breaking
  change taken on purpose rather than worked around. This block union is closed
  to stop a spec from saying anything the renderer has not agreed to. This means
  a new kind will always be a breaking change. Three things stop compiling for a
  host and each has a one-line fix.
  - If you have a `switch` over `block.kind` that ends in a `never` default, add
    a `case 'bundle'`.
  - If you have a `BlockRegistry` written out by hand, add a `bundle` entry or
    build it with `extendRegistry` (this keeps the defaults for whatever you
    leave out).
  - If you have a `BlockRenderContext` built by hand, add `bundles` (the shop's
    sets keyed by id) and `formatBundlePrice`.

[unreleased]: https://github.com/clivedsouza1010/rudra-js/compare/v0.9.1...HEAD
[0.9.1]: https://github.com/clivedsouza1010/rudra-js/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/clivedsouza1010/rudra-js/compare/v0.8.3...v0.9.0
[0.8.3]: https://github.com/clivedsouza1010/rudra-js/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/clivedsouza1010/rudra-js/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/clivedsouza1010/rudra-js/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/clivedsouza1010/rudra-js/compare/v0.7.6...v0.8.0
[0.7.6]: https://github.com/clivedsouza1010/rudra-js/compare/v0.7.5...v0.7.6
[0.7.5]: https://github.com/clivedsouza1010/rudra-js/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/clivedsouza1010/rudra-js/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/clivedsouza1010/rudra-js/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/clivedsouza1010/rudra-js/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/clivedsouza1010/rudra-js/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/clivedsouza1010/rudra-js/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/clivedsouza1010/rudra-js/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/clivedsouza1010/rudra-js/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/clivedsouza1010/rudra-js/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/clivedsouza1010/rudra-js/compare/v0.2.0...v0.3.1
[0.2.0]: https://github.com/clivedsouza1010/rudra-js/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/clivedsouza1010/rudra-js/releases/tag/v0.1.0
