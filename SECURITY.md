# Security policy

## Reporting a vulnerability

**Please don't open a public issue.** Use GitHub's private vulnerability reporting instead: go to
the [Security tab][advisories] and choose _Report a vulnerability_. This will open a private thread
with us. We can also prepare the fix in a private fork before anything is disclosed.

We aim to acknowledge within 5 working days. If we confirm a report, we'll agree a disclosure date
with you and publish a GitHub Security Advisory. In this case we'll also credit you, unless you'd
rather stay anonymous.

[advisories]: https://github.com/clivedsouza1010/rudra-js/security/advisories/new

## Supported versions

rudra-js is pre-1.0 and under active development. Only the latest release gets fixes. We keep no
long-term support branches and we don't backport security fixes to earlier `0.x` versions.

## What this project defends against

rudra-js sits between a host application and a language model. It turns model output into
server-rendered HTML. Its inputs are untrusted in different ways. For this reason the guarantees for
each of them are also different.

**Model output is untrusted, but what limits it is structural.** We don't ask the model nicely. If
you can show any of the following, that's a vulnerability:

- Generated output reaching the DOM as anything other than escaped text.
- Any generated component naming a product outside the host's candidate set. This also covers a
  product that is out of stock or that the shopper disliked, purchased or has in the cart.
- Any stated recommendation basis (`most_viewed`, `complements_cart` and the rest) surviving into a
  rendered component when the shopper's signals don't support it.
- Model output influencing anything other than presentation: a URL, a price, a product title, an
  image source or an attribute value outside the schema's enums.

There is one exception to the second bullet. It's deliberate and not an oversight. A bundle is a set
_you_ defined and it is placed whole. This means a set may hold something the shopper already bought
or has in their basket. But any member with a thumbs-down will block the whole set. This is also
true of a member that is out of stock, already on the page or the product being looked at right now.
If you sell a set as one "add all" offer, this is worth knowing: a shopper can be shown a set
holding the thing already in their basket.

It's also worth knowing about the currently-viewed half of this rule, because it costs you a
placement. A "frequently bought together, including this item" set names the product whose page it
is on. This means it is refused on the very page it was written for. If you build these sets from
just the companions, this rejection goes away. They will then pass or fail the other checks like any
set. And if a bundle block is the only block the model asked for, refusing the set leaves the
component with nothing to show. The deterministic component will then be rendered in its place.

In any other placement (grid, carousel, hero) all bought, in-basket, disliked and currently-viewed
products are dropped. There is no cap on any of these refusals. We match against all of the signals
in your payload (a set's members included) and not against the trimmed history we build from it. But
the trimmed basket and views, then the current category, will decide which set wins if more than one
is clean. In per-shopper mode the model sees that basket and views. In the default cohort mode it
sees neither.

**Host payloads are untrusted too. We validate them at the boundary.** Any of these is a
vulnerability:

- A payload that passes `parseTrackingInput` but produces an unbounded prompt (and with it an
  unbounded bill).
- One shopper's data reaching another shopper's rendered component.
- Text from a host payload reaching a prompt in a way that changes the model's instructions instead
  of being read as data.
- Prototype pollution.
- Any parsed field silently disappearing instead of being rejected.

**An A2UI agent is also untrusted, but with `RudraRecommendations` all it can do is hint.** The
agent places `RudraRecommendations` but the block is built by your server. Any hint that reaches the
model is quoted as data, like a shopper's search. This means an agent can't sway the wording any
more than a shopper can. Any of these is a vulnerability:

- Any property set on the component by the agent (other than the four hints) reaching the request
  the browser sends or the rendered block.
- Any request body that sets any of the shopper, the signals, the candidates, the surface, the slot
  and the locale but passes `parseRecommendationRequest`.
- Anything returned by `loadRecommendations` reaching the page without first passing core's spec,
  product and bundle schemas.
- Any `currentSku` or `currentCategory` kept by `fitRecommendationRequest` although none of the
  candidates it was given carries it.

**You'll find the block itself in the basic-catalog messages.** `buildRecommendationMessages` writes
the block's words, prices and links into A2UI messages. These messages can be changed by anything
that forwards them. They can also be changed by any later message for the same surface. Since the
ids are fixed, a model that writes A2UI itself will be able to replace a card's link or price just
by sending a component with a matching id. You have to keep the model away from the messages. There
are two ways to do this:

- If you don't run the agent's code yourself, have your app call the endpoint and then render the
  messages with a renderer that never gets the agent's messages. This is the only setup where you
  don't have to filter what the model sends.
- If you do run it, you have to pass the messages from your agent's code to the client unchanged
  (never via the model) and use a `surfaceId` the model is never told. Only forward objects from the
  model if they are exactly one v0.9 message: a `version` and one of `createSurface`,
  `updateComponents`, `updateDataModel` or `deleteSurface`, whose `surfaceId` is a string other than
  the block's. Everything else has to be dropped (including arrays, `{ messages }` wrappers and
  objects with a `type` field) because `@a2ui/web_core` will also unwrap and apply those.

Any of these is a vulnerability:

- Any text from the spec or the catalog reaching the messages as anything other than a heading or
  caption `Text`.
- Any text from the spec or the catalog reaching the messages with a square bracket, an angle
  bracket or a line break still in it.
- Any link or image URL reaching the messages that is empty or that is not `http` or `https`.
- Any link reaching the messages from anywhere but `hrefForSku`.
- Any generation detail reaching the messages, like the rationale, the provider or the model.

## How prompt injection is handled

Since shopper text reaches a language model here, the [OWASP LLM Prompt Injection Prevention Cheat
Sheet][owasp] applies. Below you can read about what we do and also what we choose not to do. This
second half matters as much as the first.

[owasp]: https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html

### The short version

There is exactly one tool for the model to use. It's just a schema to fill in to hand back an
answer. This means the model has no tool to fetch, write or call anything. It also has no network or
data access of its own. It has to answer in a fixed JSON shape and anything else it sends is thrown
away. It cannot **place** a product the shop didn't supply, because all SKUs are checked against the
shop's list. But it can write a product name into prose. There's nothing to prevent this.

Say an injection succeeds completely and the model does exactly what the attacker's text tells it to
do. That buys nothing more than the wording and the ordering of a recommendation block. That's as
far as it can go: the response is parsed against a schema, every SKU is checked against the shop's
list, every stated basis is checked against the shopper's signals, the model's text is screened for
claims and whatever survives is rendered as escaped text by React or as a `Text` by A2UI. There's no
other tool on the model's side of the boundary, just the schema it fills in to answer. This means
there's no tool that does anything and also no network or data access to aim at.

None of this is an accident. This is a defence based on what the model is _able_ to emit. It doesn't
depend on what we can persuade it to avoid.

### What is in place

| Technique                         | How                                                                                                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Least privilege                   | The model's only tool is the one it answers through. It fetches nothing, writes nothing and reads nothing, so there's no capability to scope                                                                           |
| Separating instructions from data | Two prompt halves. The instruction half is byte-identical for every request and holds no shopper value at all, and a test asserts that                                                                                 |
| Marking untrusted data            | Shopper and product data sit between `BEGIN_UNTRUSTED_DATA` and `END_UNTRUSTED_DATA`, and the instruction half says nothing inside them is an instruction                                                              |
| Input length limits               | Every free-text field and every array is capped in the payload contract, before a prompt is built                                                                                                                      |
| Input sanitisation                | Every host value is JSON-quoted, and invisible, direction-changing and line-ending characters are escaped. That includes the Unicode tag block, which can hide a whole instruction in a value that displays as nothing |
| Output validation                 | The response must satisfy a schema, then reconciliation checks every product against the shop's own list and every stated basis against the shopper's actual signals                                                   |
| Output rendering safety           | Output is data, not markup. Prices, titles, images and links come from the shop's catalog at render time, never from the model                                                                                         |
| Indirect injection                | The tracking payload _is_ the indirect channel, and we treat it as untrusted throughout                                                                                                                                |

### What we left out

**No keyword denylist on input.** This cheat sheet suggests scanning for phrases like
"ignore instructions" or "developer mode". But on a shopping site people do search for those. If you
block a legitimate search, you've traded a visible bug for a defence that can be beaten by just
rephrasing. Since the structural controls above don't depend on recognising an attack, they hold
against ones nobody has thought of. To be clear, the two word lists under _Residual risk_ below are
denylists on the model's output and not on what a shopper types.

**No guardrail classifier.** It makes sense to have a second model screening inputs and outputs if
the primary model can act. Ours can't.

**No human in the loop.** A page render can't wait for one.

### Residual risk, stated plainly

- **Wording.** At the upper limit, a couple of kilobytes of model-written prose reach the page per
  render. That's around 2,200 characters on the default four items and around 3,400 with `maxItems`
  at 12, because a reason and a badge are bounded per item and not per block. It's length-clamped.
  It also can't contain markup, because the schema has no field to carry markup.
  All model-written fields get three passes, in this order. First there's a set of patterns for the
  claims the prompt bans: a customer rating, a price, a discount, a delivery date, a stock level.
  Then there's a check to make sure all numerals in the sentence are ones the shop supplied for this
  request, recorded as `quantity`. Last is `@rudra-js/attested`'s phrase list, for claims that carry
  no number to check (like "top pick", "customer favourite" and "going quick"), recorded as
  `wording`. Any field that fails a pass is dropped.

  This still leaves some gaps. Two of the three passes are just word lists and not classifiers. This
  means a rewording that is on neither list will not be caught. In the test file you can find a list
  of those that aren't. This list is the honest size of the problem. The digit check reads digit
  characters. To this check, "four and a half stars from hikers" is not a number. But a numeral it
  cannot read (a ½ or the K in "10K") counts as a drop and not a pass.

  For the digit check, the facts are all of the categories and tags on the candidates we showed the
  model. Any `reason` or `badge` is read against those of its product. All other fields are read
  against all of them pooled. This means a product's "40 litre" tag will back "take 40 off" in a
  headline. There is nothing in this pass that knows which quantity a tag was about. For this reason
  a tag with a 40 in it will back any 40.

  All of the fields are read separately. This means "Our best" in a heading and
  "seller three years running" beneath it will be two innocent fields but one claim to a shopper.
  `verifyFields` in that package closes exactly this gap but we don't call it.

  It also drops honest copy. This can happen in two ways. Even a banner reading "free returns" will
  be dropped from a shop that offers free returns. And on a catalogue that doesn't have a digit in
  any tag or category name (like the example shop in this repo), the rule stops being
  "every digit must be one you supplied" and becomes "no digit may appear". This means
  "Built for 3 season use" will be dropped along with the invented prices. Any required field (such
  as a headline) is emptied and not nulled. An empty page headline will be enough to make the whole
  generation unusable. In this case just one digit there will cost you the model call and leave you
  with the deterministic component instead.

  We don't look for anything outside those kinds (such as a competitor's product name) at all. Since
  it's the shop's own words, we never screen host text.

- **Claims about a shopper in prose that carries no basis.** All products carry a `basis`. It is
  checked against the signals before it renders. If the basis does not hold, it drops to `popular`
  and the sentence and badge stating it are also dropped. For block prose there is no basis to
  check. All of these are read by the three passes above: a headline, a subheadline, a hero's
  headline and body, a banner, a copy block and a bundle's title and body. This means a price, a
  discount or a stock level in those fields is dropped, but "back because you loved the last one"
  to a first-time visitor is not. In the default cohort mode the reason and badge of all the
  products are ours and not the model's. In both modes the block prose will be the model's.

- **What two of the six bases actually prove.** `complements_cart` and `complements_purchase` just
  check that the basket or the purchase history is not empty. It's not possible here to know that a
  product goes with another. This means you can end up with a sentence under those two that names
  something the shopper does not have. For the other four, the check is against the thing they
  claim: `most_viewed` against the viewed SKUs, `similar_to_current` against the category being
  browsed and `liked_category` against the categories the shopper actually bought, liked, carted or
  viewed in. But `popular` claims nothing.

- **A bundle's copy is written about a set the model never saw.** For each request, the shop picks
  which set fills a bundle block after the words were written. Any `bundleId` from the model is
  ignored. This means its title, body and call to action can be shown above a different set. In the
  prompt we tell the model to write about the offer and not the products in it. You can also pass a
  `label` that will render above the model's words. Neither of these is enforcement.

- **Cohort cost, if a visitor can choose a cohort.** The cohort key is built from `segment`,
  `surface`, `slot`, `locale`, `maxItems`, whether the shopper is new, the category being browsed,
  the top category their signals favour and the SKUs of the candidates. If you draw any of those
  from something a visitor controls (a `locale` copied out of `Accept-Language`, a category read off
  a URL slug), one visitor can create as many cohorts as they have the patience for. Each new value
  will be a fresh model call. There's also the shipped in-memory cache to think about: it holds
  10,000 entries and evicts the oldest. Enough new values will push out the cohorts real shoppers
  were being served from. A cohort prompt has no searches or signal lists, but any text in those
  fields goes in as written. A visitor who can set one can send text to your provider. The rest of
  the damage is to the bill and the latency. Take those fields from sets you control and put a rate
  limit in front of the page. With `@rudra-js/a2ui`, the agent (or anyone who calls your
  endpoint) picks the category and `maxItems`. An agent can also place as many components as it
  likes. `fitRecommendationRequest` drops a category your candidates don't have. Pick candidates on
  your side and not from a hint. Also rate-limit the endpoint.

- **Instruction disclosure.** A determined injection could get fragments of the instruction half
  echoed back inside a text field. This is a small loss, since these instructions are open source
  and can be read in this repository. It isn't zero.
- **Monitoring.** There's no per-request logging or rate limiting here. You will just get a
  `GenerationEvent` per call via `onEvent`. It tells you where the component came from, how long it
  took, whether a model was called, the token usage and what reconciliation removed. You work out
  the cost from your provider's prices. If the model answered a call but the adapter turned it down,
  the call will be billed anyway. Its event has no usage, which means those tokens will be missing.
  It's your job to wire this to a log or a rate limiter.

- **Invisible characters.** All of the character categories that can carry hidden text are escaped.
  This also goes for `Default_Ignorable_Code_Point`. This is needed to catch the characters that are
  _marks_ or _letters_ and not format characters (like the Hangul fillers, the Mongolian selectors,
  the variation selectors at U+FE00). These would get past the categories alone. There are three
  characters that are not escaped, because they are used to spell emoji: the zero-width joiner and
  the two emoji presentation selectors, U+FE0E and U+FE0F. Ordinary product titles would be broken
  if these were escaped. In this area we screen model output more strictly than input. All three are
  deleted by the claim screen before it reads a sentence, to make sure a phrase broken up with these
  is still caught.

If you have found a way past the structural controls, that's a vulnerability. Any of these will
count: output reaching the page as anything but escaped text, a product named from outside the
shop's list, a claim about a shopper surviving when their signals don't support it. You can find the
reporting instructions at the top of this file.

## What is out of scope

- **The tracking pipeline.** rudra-js doesn't collect, store or aggregate anything. You own your
  event stream and just hand over one validated JSON object per render. Any vulnerabilities in this
  pipeline are yours.
- **The model provider.** Our adapters are thin. If there's a flaw in a vendor's API or SDK, it
  belongs to the vendor.
- **The quality or tone of generated prose.** Model-authored copy is length clamped and constrained
  to plain text. Unverifiable claims are also downgraded. But there's no classifier. If copy is
  merely poor, off-brand or commercially unwise, it's a bug and not a vulnerability. But copy that
  makes a factual claim about a shopper the signals don't support **is** in scope, because this is a
  guarantee the framework makes.
- **Denial of service through a host's own configuration**, for example a generation budget set high
  enough to block the page. This framework bounds as much as it can, but it can always be
  misconfigured by a host.
- **What an A2UI agent writes outside the block.** A2UI draws the agent's own components (a `Text`
  beside the block for instance) using the agent's words. `RUDRA_RECOMMENDATIONS_INSTRUCTIONS` asks
  the agent not to state prices or product facts there, but this is just a request to a model and
  not a boundary. A2UI's renderers and catalog validation belong to A2UI.
- Findings from automated scanners with no demonstrated impact on this codebase.

## Supply chain

Releases are published from CI and not from a maintainer's machine. We have GitHub Actions pinned by
commit SHA and dependencies updated by Dependabot. CI runs with `contents: read`. It also doesn't
persist its checkout credentials. We use `npm ci --ignore-scripts` to keep dependency lifecycle
scripts from executing during a build.

### Checking what you installed

All packages are published with `npm publish --provenance`. This means npm holds a signed statement
of where the tarball was built. You can check the signature yourself:

```sh
npm audit signatures
```

In the attestation you can see this repository, the workflow that ran
(`.github/workflows/release.yml`) and the commit the release tag pointed to. If any of this doesn't
match what you expect, the package didn't come from this pipeline. We'd like to hear about it if that
happens.
