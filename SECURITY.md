# Security policy

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private vulnerability
reporting instead: go to the [Security tab][advisories] and choose _Report a
vulnerability_. It opens a private thread with the maintainers, and the fix can
be prepared in a private fork before anything is disclosed.

Expect an acknowledgement within 5 working days. If a report is confirmed, we
will agree a disclosure date with you, publish a GitHub Security Advisory, and
credit you unless you would rather stay anonymous.

[advisories]: https://github.com/clivedsouza1010/rudra-js/security/advisories/new

## Supported versions

rudra-js is pre-1.0 and under active development. Only the latest release
receives fixes. There are no long-term support branches, and no security
backports to earlier `0.x` versions.

## What this project defends against

rudra-js sits between a host application and a language model, and turns model
output into server-rendered HTML. Two of its inputs are untrusted in different
ways, and the guarantees differ accordingly.

**Model output is untrusted, and is constrained structurally rather than by
asking the model nicely.** A report showing any of the following is a
vulnerability:

- Generated output reaching the DOM as anything other than escaped text.
- A generated component naming a product outside the host's candidate set, one
  that is out of stock, or one the shopper disliked, purchased, or has in the
  cart.
- A stated recommendation basis (`most_viewed`, `complements_cart`, and the
  rest) surviving into a rendered component when the shopper's signals do not
  support it.
- Model output influencing anything other than presentation — a URL, a price, a
  product title, an image source, or an attribute value outside the schema's
  enums.

**Host payloads are untrusted, and are validated at the boundary.** A report
showing any of the following is a vulnerability:

- A payload that passes `parseTrackingInput` but produces an unbounded prompt,
  and therefore an unbounded bill.
- One shopper's data reaching another shopper's rendered component.
- Text from a host payload reaching a prompt in a way that changes the model's
  instructions rather than being read as data.
- Prototype pollution, or any parsed field silently disappearing rather than
  being rejected.

## How prompt injection is handled

Shopper text reaches a language model here, so the [OWASP LLM Prompt Injection
Prevention Cheat Sheet][owasp] applies. What follows is what this project does,
what it deliberately does not, and why — because a security posture claimed
without the second half is not a posture.

[owasp]: https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html

### The short version

The model has no tools, no network and no data access. It emits a fixed JSON
shape and nothing else, and it cannot **place** a product the shop did not
supply — every SKU is checked against the shop's own list. It can still write a
product name into prose, which nothing prevents.
An injection that fully succeeds — one where the model does exactly what the
attacker's text says — can change the wording and the ordering of a
recommendation block. It cannot reach anything.

That is the design, rather than a happy accident: the defence is what the model
is _able_ to emit, not what we can persuade it to avoid.

### What is in place

| Technique                         | How                                                                                                                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Least privilege                   | The model calls nothing and reads nothing. There is no tool to scope, because there are no tools                                                                                                                      |
| Separating instructions from data | Two prompt halves. The instruction half is byte-identical for every request and contains no shopper value at all — a test asserts it                                                                                  |
| Marking untrusted data            | Shopper and product data sit between `BEGIN_UNTRUSTED_DATA` and `END_UNTRUSTED_DATA`, and the instruction half says nothing inside them is an instruction                                                             |
| Input length limits               | Every free-text field and every array is capped in the payload contract, before a prompt is built                                                                                                                     |
| Input sanitisation                | Every host value is JSON-quoted, and invisible, direction-changing and line-ending characters are escaped — including the Unicode tag block, which can hide an entire instruction in a value that displays as nothing |
| Output validation                 | The response must satisfy a schema, then reconciliation checks every product against the shop's own list and every stated reason against the shopper's actual signals                                                 |
| Output rendering safety           | Output is data, not markup. Prices, titles, images and links come from the shop's catalog at render time, never from the model                                                                                        |
| Indirect injection                | The tracking payload _is_ the indirect channel, and it is treated as untrusted throughout                                                                                                                             |

### What is deliberately absent

**No keyword denylist.** The cheat sheet suggests scanning for phrases like
"ignore instructions" or "developer mode". On a shopping site those are also
things people search for, and a denylist that blocks a legitimate search is a
visible bug traded for a defence that a rephrasing walks past. The structural
controls above do not depend on recognising an attack, which is why they hold
against ones nobody has thought of.

**No guardrail classifier.** A second model screening inputs and outputs is
proportionate when the primary model can act. This one cannot.

**No human in the loop.** A page render cannot wait for one.

### Residual risk, stated plainly

- **Wording.** Roughly a kilobyte of model-written prose reaches the page per
  render. It is length-clamped and cannot contain markup, because the schema has
  no field that carries markup. It **can** contain anything else the model
  writes: a price, a discount, a stock claim, or a competitor's product name.
  The prompt instructs against all of those, and instruction is not enforcement
  — this is the one place the design relies on persuading the model rather than
  constraining it. There is no classifier reading the output.
- **Instruction disclosure.** A determined injection could get fragments of the
  instruction half echoed back inside a text field. Those instructions are open
  source and in this repository, so the loss is small, but it is not zero.
- **Monitoring.** Per-request logging and rate limiting are not here yet, and
  neither is the generator that would emit the events they need.

- **Invisible characters.** The escaping covers every character category that
  can carry hidden text. A few individual code points that render blank are
  _letters_ rather than format characters — U+3164 Hangul filler, for one — and
  are left alone, because they are legitimate in Korean text and cannot encode
  an instruction on their own. They can pad a value; they cannot smuggle one.

If you find a way past the structural controls — output reaching the page as
anything but escaped text, a product named from outside the shop's list, or a
claim about a shopper surviving when their signals do not support it — that is a
vulnerability, and the reporting instructions are at the top of this file.

## What is out of scope

- **The tracking pipeline.** rudra-js collects, stores and aggregates nothing.
  The host owns its event stream and hands over one validated JSON object per
  render. Vulnerabilities in that pipeline are the host's.
- **The model provider.** Adapters are thin; a flaw in a vendor's API or SDK
  belongs to that vendor.
- **The quality or tone of generated prose.** Model-authored copy is length
  clamped and constrained to plain text, and unverifiable claims are downgraded
  — but there is no classifier. Copy that is merely poor, off-brand, or
  commercially unwise is a bug, not a vulnerability. Copy that makes a factual
  claim about a shopper the signals do not support **is** in scope, because that
  is a guarantee the framework makes.
- **Denial of service through a host's own configuration**, for example setting
  a generation budget so high that the page blocks. The framework bounds what it
  can; a host can always misconfigure it.
- Findings from automated scanners with no demonstrated impact on this codebase.

## Supply chain

Releases are published from CI rather than from a maintainer's machine.
Dependencies are updated by Dependabot, GitHub Actions are pinned by commit SHA,
CI runs with `contents: read` and does not persist its checkout credentials, and
`npm ci --ignore-scripts` keeps dependency lifecycle scripts from executing
during a build.
