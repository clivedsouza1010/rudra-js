# Contributing to rudra-js

Thanks for looking. This is a small project maintained in spare time, so the
most useful thing you can do before writing code is open an issue and check the
idea fits — see _Scope_ below.

## Getting set up

Node `>=22.12` is required. Node 20 is end of life, and
`scripts/verify-consumer.mjs` needs `--experimental-strip-types`, which 20.19
does not have. There is an `.nvmrc`.

```sh
nvm use
npm install
npm run build      # the packages resolve each other through dist/
npm test
```

`npm run test:watch` while you work.

## Scope

rudra-js turns **one validated tracking payload into one renderable component
specification**. That boundary is the design, not an accident:

- It does not collect, store, or aggregate tracking data. The host owns its
  pipeline and hands over a JSON object per render.
- It does not ship a model. Adapters implement `ComponentProvider`.
- It does not own the rendering. A registry of components does.

Proposals that stay inside that boundary are easy to accept. Proposals that move
it need a conversation first, because the answer is often "your host can do this
already" — and hearing that after you have written the code is nobody's idea of
a good time.

## Sending a change

- One coherent change per pull request. A rename and a bug fix in the same
  branch is two pull requests wearing one coat.
- Every check below has to pass. CI runs the same ones.
- Explain in the description what you did to convince yourself the tests would
  catch a regression. That is worth more than a coverage number.
- Add a line under `[Unreleased]` in [CHANGELOG.md](./CHANGELOG.md) for anything
  a host would notice, or say in the description why none is needed.

Contributions are licensed under the MIT licence in [LICENSE](./LICENSE), the
same licence the rest of the project uses. By sending a pull request you confirm
you have the right to submit the work — you wrote it, or whoever holds the rights
to it has let you contribute it here. There is no separate agreement to sign.

## Naming

Names in a published package are permanent in a way internal names are not: a
consumer sees them without the surrounding file, and renaming one is a breaking
change. These rules exist because most of them cannot be enforced by a linter,
so they have to be enforced in review.

### The rules

**1. Never shadow a TypeScript built-in or a platform global.**

`Pick`, `Omit`, `Record`, `Partial`, `Exclude`, `Parameters`, `ReturnType` and
the rest of the utility types are in scope in every consumer's file. An export
named `Pick` does not merely read badly — importing it removes `Pick<T, K>` from
that module. The same applies to `Event`, `Request`, `Response`, `Node`,
`Element`, `Text`, `Range`, `Selection`, `File` and `Location`.

A domain prefix resolves it: `ProductPick`, not `Pick`.

**2. Spell it out. No abbreviations, no invented shorthand.**

`ProductReference`, not `ProductRef`. `configuration`, not `config`. `index`,
not `idx`. `error`, not `err`.

The exception is an acronym that is the standard term in the domain and is
never written out in full by the people who use it: `sku`, `url`, `html`,
`json`. `SKU` is a real exception; `Ref` is not, and in a package that also
ships React components it actively misleads.

**3. Booleans read as a question, and answer it positively.**

Prefix with `is`, `has`, or `are`, and never name the negative:

```ts
isInStock; // not inStock, not outOfStock
isUsable; // not usable
hasSupportedBasis; // not basisHolds
```

`isNotEnabled` is banned outright — a reader has to negate twice to understand
`!isNotEnabled`.

**4. Filenames are kebab-case noun phrases naming the concept the module owns.**

Verbs belong in function names, not filenames: `product-selection.ts` exporting
`selectProducts`, not `select.ts`.

Avoid any name a tool might claim. `spec.ts` reads as a test file to most
JavaScript developers, because `.spec.ts` is a test convention — hence
`component-spec.ts`.

Enforced by `unicorn/filename-case`.

**5. An exported name has to make sense with no other context.**

The reader sees `import { Block } from '@rudra-js/core'` and nothing else. If the
name only makes sense next to its neighbours in the file, it is too short.

**6. Match the name to the shape.** A function returning a boolean reads as a
predicate (`showsAnyProduct`). A function building something reads as a builder
(`buildDigest`). A type and its schema share a stem: `ProductReference` and
`productReferenceSchema`.

### Case conventions

| Construct                                       | Convention             |
| ----------------------------------------------- | ---------------------- |
| Variables, functions, parameters, object fields | `camelCase`            |
| Types, interfaces, classes                      | `PascalCase`           |
| Module-level constants that are configuration   | `SCREAMING_SNAKE_CASE` |
| Files and directories                           | `kebab-case`           |

### When to rename

Before the first published release, rename freely — it costs nothing. After it,
a rename is a major-version change, so the bar is real breakage or a genuine
collision.

## Tests

Every behaviour that a comment claims is true needs a test that fails when it
stops being true. Two habits are worth more than coverage percentage:

**Assert the value, not a relation between two derived values.** Two results
that agree can both be wrong — a bug that empties both sides passes an equality
check while pinning nothing.

**Mutate the source and confirm the suite notices.** A test that passes when you
break the thing it names is not a test. If a mutation fails nothing, either the
test is vacuous or the mutation is equivalent — find out which before moving on.

## Checks

`npm run check` runs all six, in order, and stops at the first failure:

```sh
npm run build
npm run typecheck        # includes test files, which the build does not
npm run lint
npm run format:check
npm test
npm run verify:consumer  # packs all three packages and uses them from outside the repo
```

All six run in CI as separate steps, so a failed run names the check that
failed. `tests/packaging.test.ts` holds them to that: the commands in `check`
have to be the CI steps, in the same order.

## Releasing

Bump the version on a pull request of its own, and merge it. Then push a signed
tag `vX.Y.Z` at the merge commit:

```sh
git tag -s v0.2.0 -m 'v0.2.0'
git push origin v0.2.0
```

A `v*` tag starts [`.github/workflows/release.yml`](.github/workflows/release.yml).
It runs the same six checks a pull request runs, build included, and then
publishes `@rudra-js/core`, `@rudra-js/react` and `@rudra-js/anthropic` in that
order with `npm publish --provenance`. Core goes first because react declares it
as a peer.

The first two steps, before anything is installed, check the tag and stop if
either fails: the tagged commit is on `main`, and the tag equals the `version`
in `packages/core/package.json`. All three manifests carry the same version and
a test enforces that, because one tag publishes all three. Tags matching `v*`
cannot be moved or deleted once pushed, so a tag that fails a check is left
behind and the fix is to bump the version and tag again. The same goes for a
version that did publish: npm rejects a republish, so a mistake is fixed by
tagging a new patch version, not by retrying the old one.

### The npm pin

Both `release.yml` and `rehearsal.yml` install `npm@11.19.1` before they publish.
Node 22 ships npm 10, which cannot do trusted publishing at all — that needs npm
11.5 or newer, which reads the OIDC token itself. The version is pinned exactly
rather than to a range because npm is the thing doing the publishing, and a
publisher that changes under you between two releases is not something to find
out about during one.

Nothing watches this pin, so bump it by hand. Run `rehearsal.yml` after you do:
it installs the same npm and does a `--dry-run` publish of all three packages, so
a broken npm shows up there instead of halfway through a release.

### What publishing is bound to

There is no npm token anywhere in this repository. Each of the three packages
has a trusted publisher configured on npmjs.com, and each one names three
things: this repository, the workflow file `release.yml`, and the GitHub
environment `npm`. The workflow's `id-token: write` mints an OIDC token that npm
checks against those three.

So renaming the workflow file, renaming the environment, or moving the
repository stops publishing until the publisher is edited on npmjs.com to match.
The error npm returns says the token does not match a configured publisher and
does not say which of the three is wrong.

Adding a fourth package means two edits, not one: a trusted publisher for its
name on npmjs.com, and a `npm publish --provenance --access public` step in
`release.yml` with its `working-directory`. A package with a publish step and no
publisher fails the release after the earlier packages have already gone out.

If a publish does half-finish — core published, react failed — there is nothing
to publish by hand with. Bump the patch version on all three, merge, and tag
again.

## When the tool-schema golden fails

`tests/golden/tool-input-schema.json` is the schema sent to the model as the
tool's `input_schema`, so it is part of the prompt. zod writes it, and a zod
upgrade has already rewritten it once. When the test fails:

1. Run `npm run build` first. The regeneration command the test prints imports
   `packages/core/dist/index.js`, so a stale or missing build regenerates the
   old schema or nothing at all.
2. Run the command the failure message prints, then `git diff` the golden.
3. Read the diff for three things: a field whose `type` changed, a nullable
   field written a new way (4.5.0 moved those from `anyOf` to a type array), and
   `additionalProperties` appearing where it did not — the provider is sent the
   `input` shape, which carries none.
4. Run `npx vitest run packages/anthropic`. The adapter builds the request
   around this schema, and a shape it cannot fill is a runtime refusal, not a
   test failure here.
5. Commit the golden with the zod version in the message, so the next reader can
   tell a deliberate regeneration from a drift nobody looked at.

## Reporting a security issue

Please do not open a public issue. See [SECURITY.md](./SECURITY.md) — GitHub's
private vulnerability reporting gives us a private thread and a private fork to
prepare a fix in.

## Behaviour

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). It
applies in issues, pull requests, discussions, and anywhere else the project is
represented.
