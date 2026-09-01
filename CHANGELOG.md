# Changelog

Notable changes to rudra-js. The format follows [Keep a Changelog][kac], and the
project follows [Semantic Versioning][semver] — with the caveat that while the
version is `0.x`, the public contracts are still moving and a minor bump may
break them.

[kac]: https://keepachangelog.com/en/1.1.0/
[semver]: https://semver.org/spec/v2.0.0.html

## [Unreleased]

Nothing released yet. Both packages are being built module by module and
neither has been published.

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
- The spec cache: a store port plus an in-memory implementation, keyed on the
  whole signal digest so no field can drift out of the key.
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
  context has two more fields. Both packages are `0.1.0` and unpublished, so
  this is a breaking change taken on purpose rather than worked around: the
  block union is closed so that a spec cannot say anything the renderer has not
  agreed to, and a new kind is therefore always a breaking change. Three things
  stop compiling for a host, and each has a one-line fix.
  - A `switch` over `block.kind` that ends in a `never` default. Add a
    `case 'bundle'`.
  - A `BlockRegistry` written out by hand. Add a `bundle` entry, or build it
    with `extendRegistry`, which keeps the defaults for whatever you leave out.
  - A `BlockRenderContext` built by hand. Add `bundles`, the shop's sets keyed
    by id, and `formatBundlePrice`.
