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
