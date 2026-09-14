# Security policy

## Reporting a vulnerability

**Please don't open a public issue.** Use GitHub's private vulnerability reporting instead: go to the
[Security tab][advisories] and choose _Report a vulnerability_. That opens a private thread with us,
and we can prepare the fix in a private fork before anything is disclosed.

We aim to acknowledge within 5 working days. If we confirm a report, we'll agree a disclosure date
with you, publish a GitHub Security Advisory, and credit you, unless you'd rather stay anonymous.

[advisories]: https://github.com/clivedsouza1010/rudra-js/security/advisories/new

## Supported versions

rudra-js is pre-1.0 and under active development. Only the latest release gets fixes. We keep no
long-term support branches, and we don't backport security fixes to earlier `0.x` versions.

## What this project defends against

rudra-js sits between a host application and a language model, and turns model output into
server-rendered HTML. Two of its inputs are untrusted in different ways, so the guarantees for each
differ too.

**Model output is untrusted, and what constrains it is structural.** We don't ask the model nicely.
If you can show any of the following, that's a vulnerability:

- Generated output reaching the DOM as anything other than escaped text.
- A generated component naming a product outside the host's candidate set, one that is out of stock,
  or one the shopper disliked, purchased, or has in the cart.
- A stated recommendation basis (`most_viewed`, `complements_cart`, and the rest) surviving into a
  rendered component when the shopper's signals don't support it.
- Model output influencing anything other than presentation: a URL, a price, a product title, an
  image source, or an attribute value outside the schema's enums.

**Host payloads are untrusted too, and we validate them at the boundary.** Same deal, any of these is
a vulnerability:

- A payload that passes `parseTrackingInput` but produces an unbounded prompt, and with it an
  unbounded bill.
- One shopper's data reaching another shopper's rendered component.
- Text from a host payload reaching a prompt in a way that changes the model's instructions instead
  of being read as data.
- Prototype pollution, or any parsed field silently disappearing instead of being rejected.

## How prompt injection is handled

Shopper text reaches a language model here, so the [OWASP LLM Prompt Injection Prevention Cheat
Sheet][owasp] applies. What follows is what this project does, and what it chooses not to do. The
second half matters as much as the first.

[owasp]: https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html

### The short version

The model gets exactly one tool, and it's how it hands back its answer: a schema to fill in. It has
no tool that fetches anything, writes anything or calls anything, and no network or data access of
its own. It emits a fixed JSON shape and nothing else, and it cannot **place** a product the shop
didn't supply, because every SKU is checked against the shop's own list. It can still write a
product name into prose. Nothing prevents that.

Say an injection succeeds completely, and the model does exactly what the attacker's text tells it
to. What that buys is the wording and the ordering of a recommendation block. That's the reach it
has: the response is parsed against a schema, every SKU is checked against the shop's list, every
stated reason is checked against the shopper's signals, and whatever survives is rendered as escaped
text by React. The one tool on the model's side of the boundary is the schema it fills in to answer,
so there's no tool that does anything, and no network or data access to aim at.

None of that is a happy accident. The defence is what the model is _able_ to emit, not what we can
persuade it to avoid.

### What is in place

| Technique                         | How                                                                                                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Least privilege                   | The model's only tool is the one it answers through. It fetches nothing, writes nothing and reads nothing, so there's no capability to scope                                                                           |
| Separating instructions from data | Two prompt halves. The instruction half is byte-identical for every request and holds no shopper value at all, and a test asserts that                                                                                 |
| Marking untrusted data            | Shopper and product data sit between `BEGIN_UNTRUSTED_DATA` and `END_UNTRUSTED_DATA`, and the instruction half says nothing inside them is an instruction                                                              |
| Input length limits               | Every free-text field and every array is capped in the payload contract, before a prompt is built                                                                                                                      |
| Input sanitisation                | Every host value is JSON-quoted, and invisible, direction-changing and line-ending characters are escaped. That includes the Unicode tag block, which can hide a whole instruction in a value that displays as nothing |
| Output validation                 | The response must satisfy a schema, then reconciliation checks every product against the shop's own list and every stated reason against the shopper's actual signals                                                  |
| Output rendering safety           | Output is data, not markup. Prices, titles, images and links come from the shop's catalog at render time, never from the model                                                                                         |
| Indirect injection                | The tracking payload _is_ the indirect channel, and we treat it as untrusted throughout                                                                                                                                |

### What we left out

**No keyword denylist on input.** The cheat sheet suggests scanning for phrases like "ignore
instructions" or "developer mode". On a shopping site, people search for those. Block a legitimate
search and you've traded a visible bug for a defence that a rephrasing walks straight past. The
structural controls above don't depend on recognising an attack, so they hold against ones nobody
has thought of. One clarification: the two word lists under _Residual risk_ below are denylists on
the model's output, not on what a shopper types.

**No guardrail classifier.** A second model screening inputs and outputs is proportionate when the
primary model can act. Ours can't.

**No human in the loop.** A page render can't wait for one.

### Residual risk, stated plainly

- **Wording.** Roughly a kilobyte of model-written prose reaches the page per render. It's
  length-clamped, and it can't contain markup, because the schema has no field that carries markup.
  Every model-written field goes through three passes, in this order. A set of patterns for the
  claims the prompt bans: a customer rating, a price, a discount, a delivery date, a stock level.
  Then a check that every numeral in the sentence is one the shop supplied for this request,
  recorded as `quantity`. Then `@rudra-js/attested`'s phrase list, for claims that carry no number
  to check — "top pick", "customer favourite", "going quick" — recorded as `wording`. Any field
  that fails a pass is dropped.

  What that still leaves. Two of the three passes are word lists, not classifiers, so a rewording
  that sits on neither gets through; the test file holds a list of ones that do, which is the
  honest size of it. The digit check reads digit characters, so "four and a half stars from hikers"
  is not a number to it — though a numeral it cannot read, a ½ or the K in "10K", is a drop rather
  than a pass.

  The facts behind the digit check are every category and tag on the candidates we showed the
  model. A `reason` or a `badge` is read against its own product's; everything else reads all of
  them pooled, so one product's "40 litre" tag backs "take 40 off" in a headline. Nothing in that
  pass knows which quantity a tag was about, so a tag with a 40 in it stands behind any 40.

  Each field is read on its own, so "Our best" in a heading and "seller three years running"
  beneath it are two innocent fields and one claim to a shopper. `verifyFields` in that package
  closes exactly this and we don't call it.

  It eats honest copy too, both ways. A banner reading "free returns" is dropped from a shop that
  offers them. And on a catalogue with no digit in any tag or category name — the example shop in
  this repo is one — the rule stops being "every digit must be one you supplied" and becomes "no
  digit may appear", so "Built for 3 season use" goes along with the invented prices. A required
  field like a headline is emptied rather than nulled, and an empty headline makes the whole
  generation unusable, so one digit there costs the model call and renders the deterministic
  component instead.

  And anything outside those kinds — a competitor's product name, say — we don't look for at all.
  Host text is never screened, since it's the shop's own words.

- **Instruction disclosure.** A determined injection could get fragments of the instruction half
  echoed back inside a text field. Those instructions are open source and sitting in this repository,
  so the loss is small. It isn't zero.
- **Monitoring.** Per-request logging and rate limiting aren't here. What you get is one
  `GenerationEvent` per call through `onEvent`, carrying where the component came from, how long it
  took, whether a model was called, what it cost and what reconciliation removed. Wiring that to a
  log or a rate limiter is your job.

- **Invisible characters.** The escaping covers every character category that can carry hidden text.
  A few individual code points that render blank are _letters_ rather than format characters, U+3164
  Hangul filler among them, and those are left alone: they're legitimate in Korean text and can't
  encode an instruction on their own. They can pad a value. They can't smuggle one.

If you find a way past the structural controls, that's a vulnerability. Output reaching the page as
anything but escaped text, a product named from outside the shop's list, a claim about a shopper
surviving when their signals don't support it: any of those. The reporting instructions are at the
top of this file.

## What is out of scope

- **The tracking pipeline.** rudra-js collects, stores and aggregates nothing. You own your event
  stream and hand over one validated JSON object per render. Vulnerabilities in that pipeline are
  yours.
- **The model provider.** Our adapters are thin. A flaw in a vendor's API or SDK belongs to that
  vendor.
- **The quality or tone of generated prose.** Model-authored copy is length clamped and constrained
  to plain text, and unverifiable claims are downgraded. There's still no classifier. Copy that's
  merely poor, off-brand, or commercially unwise is a bug, not a vulnerability. Copy that makes a
  factual claim about a shopper the signals don't support **is** in scope, because that's a guarantee
  the framework makes.
- **Denial of service through a host's own configuration**, say a generation budget set so high that
  the page blocks. The framework bounds what it can, and a host can always misconfigure it.
- Findings from automated scanners with no demonstrated impact on this codebase.

## Supply chain

Releases are published from CI rather than from a maintainer's machine. Dependabot updates dependencies,
and GitHub Actions are pinned by commit SHA. CI runs with `contents: read` and doesn't persist its
checkout credentials. `npm ci --ignore-scripts` keeps dependency lifecycle scripts from executing
during a build.

### Checking what you installed

Every package is published with `npm publish --provenance`, so npm holds a signed statement of where
the tarball was built. You can check it yourself:

```sh
npm audit signatures
```

The attestation names this repository, the workflow that ran (`.github/workflows/release.yml`) and
the commit the release tag pointed at. If any of that doesn't match what you expect, the package
didn't come from this pipeline, and we'd like to hear about it.
