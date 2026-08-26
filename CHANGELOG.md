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
