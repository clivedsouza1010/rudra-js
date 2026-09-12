# Changelog

Notable changes to rudra-js. The format follows [Keep a Changelog][kac], and the
project follows [Semantic Versioning][semver] — with the caveat that while the
version is `0.x`, the public contracts are still moving and a minor bump may
break them.

[kac]: https://keepachangelog.com/en/1.1.0/
[semver]: https://semver.org/spec/v2.0.0.html

## [Unreleased]

### Changed

- `@rudra-js/react` takes React 18 as well as 19. The peer range said `^19.0.0`
  while the package imports only two types from React and no runtime API, so
  the build touches nothing but `react/jsx-runtime`, which has existed since
  React 17. The range was refusing installs the code supports. A test now fails
  if anything in the package imports a React value rather than a type, so the
  range stays true.

### Fixed

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

[unreleased]: https://github.com/clivedsouza1010/rudra-js/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/clivedsouza1010/rudra-js/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/clivedsouza1010/rudra-js/releases/tag/v0.1.0
