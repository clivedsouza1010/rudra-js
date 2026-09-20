# Contributing to rudra-js

Thanks for looking. This is a small project maintained in spare time, so the most useful thing you
can do before writing any code is open an issue and check the idea fits. _Scope_ below says what
we're aiming at.

## Getting set up

You'll need Node `>=22.12`. Node 20 is end of life, and `scripts/verify-consumer.mjs` needs
`--experimental-strip-types`, which 20.19 doesn't have. `.nvmrc` names an exact version. The
publishing workflows read it too, so have a look at [The npm pin](#the-npm-pin) before you change
it.

```sh
nvm use
npm install
npm run build      # the packages resolve each other through dist/
npm test
```

Keep `npm run test:watch` running while you work.

## Scope

rudra-js turns **one validated tracking payload into one renderable component specification**. That
boundary is the design:

- It doesn't collect, store, or aggregate tracking data. The host owns its pipeline and hands over
  a JSON object per render.
- It doesn't ship a model. Adapters implement `ComponentProvider`.
- It doesn't own the rendering. A registry of components does.

Proposals that stay inside that boundary are easy to accept. Proposals that move it need a
conversation first. The answer is often "your host can do this already", and hearing that after
you've written the code is nobody's idea of a good time.

## Sending a change

- One coherent change per pull request. A rename and a bug fix in the same branch is two pull
  requests wearing one coat.
- Every check below has to pass. CI runs the same ones.
- Tell us in the description what you did to convince yourself the tests would catch a regression.
  That's worth more than a coverage number.
- Add a line under `[Unreleased]` in [CHANGELOG.md](./CHANGELOG.md) for anything a host would
  notice, or say in the description why none is needed.

Contributions are licensed under the MIT licence in [LICENSE](./LICENSE), the same licence the rest
of the project uses. By sending a pull request you're confirming you have the right to submit the
work: you wrote it, or whoever holds the rights to it has let you contribute it here. There's no
separate agreement to sign.

## Naming

Names in a published package are permanent in a way internal names aren't. A consumer sees them
without the surrounding file, and renaming one is a breaking change. A linter can't catch most of
what follows, so review has to.

### The rules

**1. Never shadow a TypeScript built-in or a platform global.**

`Pick`, `Omit`, `Record`, `Partial`, `Exclude`, `Parameters`, `ReturnType` and the rest of the
utility types are in scope in every consumer's file. An export named `Pick` doesn't merely read
badly — importing it removes `Pick<T, K>` from that module. The same goes for `Event`, `Request`,
`Response`, `Node`, `Element`, `Text`, `Range`, `Selection`, `File` and `Location`.

A domain prefix sorts it out: `ProductPick`, not `Pick`.

**2. Spell it out. No abbreviations, no invented shorthand.**

`ProductReference`, not `ProductRef`. `configuration`, not `config`. `index`, not `idx`. `error`,
not `err`.

The exception is an acronym that's the standard term in the domain and is _never_ written out in
full by the people who use it: `sku`, `url`, `html`, `json`. `SKU` counts. `Ref` doesn't, and in a
package that also ships React components it actively misleads.

**3. Booleans read as a question, and answer it positively.**

Prefix with `is`, `has`, or `are`, and never name the negative:

```ts
isInStock; // not inStock, not outOfStock
isUsable; // not usable
hasSupportedBasis; // not basisHolds
```

`isNotEnabled` is banned outright. A reader has to negate twice to work out `!isNotEnabled`.

**4. Filenames are kebab-case noun phrases naming the concept the module owns.**

Verbs belong in function names, not filenames: `product-selection.ts` exporting `selectProducts`,
not `select.ts`.

Avoid any name a tool might claim. `spec.ts` reads as a test file to most JavaScript developers,
since `.spec.ts` is a test convention, so we use `component-spec.ts`.

Enforced by `unicorn/filename-case`.

**5. An exported name has to make sense with no other context.**

The reader sees `import { Block } from '@rudra-js/core'` and nothing else. If the name only makes
sense next to its neighbours in the file, it's too short.

**6. Match the name to the shape.** A function returning a boolean reads as a predicate
(`showsAnyProduct`). A function building something reads as a builder (`buildDigest`). A type and
its schema share a stem: `ProductReference` and `productReferenceSchema`.

### Case conventions

| Construct                                       | Convention             |
| ----------------------------------------------- | ---------------------- |
| Variables, functions, parameters, object fields | `camelCase`            |
| Types, interfaces, classes                      | `PascalCase`           |
| Module-level constants that are configuration   | `SCREAMING_SNAKE_CASE` |
| Files and directories                           | `kebab-case`           |

### When to rename

Before the first published release, rename freely. It costs nothing. After it, a rename is a
major-version change, so the bar is real breakage or a genuine collision.

## Tests

Every behaviour that a comment claims is true needs a test that fails when it stops being true. Two
habits are worth more than a coverage percentage.

**Assert the value, not a relation between two derived values.** Two results that agree can both be
wrong. A bug that empties both sides sails through an equality check while pinning nothing.

**Mutate the source and confirm the suite notices.** A test that passes when you break the thing it
names is not a test. If a mutation fails nothing, either the test is vacuous or the mutation is
equivalent. Find out which before you move on.

## Checks

`npm run check` runs all six, in order, and stops at the first failure:

```sh
npm run build
npm run typecheck        # includes test files, which the build does not
npm run lint
npm run format:check
npm test
npm run verify:consumer  # packs all four packages and uses them from outside the repo
```

All six run in CI as separate steps, so a failed run names the check that failed.
`tests/packaging.test.ts` holds us to that: the commands in `check` have to be the CI steps, in the
same order.

## Releasing

Bump the version on a pull request of its own, and merge it. A bump is more than the `version`
fields. One version has to reach every place that names it, or `npm ci` inside the release job
stops the release on a tag you can't take back:

- `version` in the root manifest, in all four `packages/*/package.json`, and in
  `examples/shop/package.json`.
- The peer range each package declares on a sibling — `^0.5.0` becomes `^0.6.0` in
  `packages/core`, `packages/react` and `packages/anthropic`. Caret on a `0.x` version is
  patch-only, so leaving one behind publishes four packages that can't be installed together.
- The exact sibling pin those three carry in `devDependencies`, and the two in
  `examples/shop`.
- `package-lock.json`, regenerated with the npm the release installs:

  ```sh
  npm install -g npm@11.19.1
  npm install --package-lock-only --ignore-scripts
  ```

  The npm bundled with Node 22.21.1 is 10.9.4, and it drops the 12 `libc` fields the lockfile
  carries without saying so. Those fields pick the glibc or musl lightningcss binary on the runner.

`tests/packaging.test.ts` checks all of it, so a bump that misses a spot fails on the pull request
instead of on the tag.

Nothing automates the paperwork either. `release.yml` publishes to npm and stops — no GitHub
release, no CHANGELOG edit. Move the `## [Unreleased]` heading and the `[unreleased]:` compare link
at the bottom of `CHANGELOG.md` in the same pull request, because nothing fails if you don't.

Then push a signed tag `vX.Y.Z` at the merge commit, while it's still the tip of `main`:

```sh
git tag -s v0.5.1 -m 'v0.5.1'
git push origin v0.5.1
```

A `v*` tag starts [`.github/workflows/release.yml`](.github/workflows/release.yml). It runs the
same six checks a pull request runs, build included, and then publishes `@rudra-js/attested`,
`@rudra-js/core`, `@rudra-js/react` and `@rudra-js/anthropic` in that order with
`npm publish --provenance`.

The order is what an install can satisfy. `@rudra-js/attested` depends on nothing and core declares
it as a peer, so attested goes first; react and anthropic both declare core as a peer, so core
leads them. npm can't publish over a half-finished release, so anything that goes out before a
failure is public and stuck at a version the next tag can't reuse.

Three steps run before anything is installed, and any one of them stops the release: the tagged
commit has to be on `main`, it has to be the tip of `main`, and the tag has to equal the `version`
in `packages/core/package.json`. All four manifests carry the same version and a test enforces
that, because one tag publishes all four.

The tip check is the strict one, and it's strict on purpose. Being on `main` isn't enough: every
commit after the bump reads the bumped version too, so a tag a few commits back clears the other
two and publishes a tree missing whatever landed since — irreversibly, with provenance pointing at
a real `main` commit. The price is that if `main` moves between your tag push and the job starting,
the tag is spent.

A quick heads-up on tags. Anything matching `v*` can't be moved or deleted once you've pushed it,
so a tag that fails a check is spent, and the fix is to bump the version and tag again. It's the
same story for a version that did publish: npm rejects a republish, so you fix a mistake by tagging
a new patch version, not by retrying the old one.

### The npm pin

Both `release.yml` and `rehearsal.yml` install `npm@11.19.1` before they publish. Node 22 ships npm
10, which can't do trusted publishing at all. That needs npm 11.5 or newer, which reads the OIDC
token itself.

Trusted publishing also needs Node 22.14 or newer. That's higher than the `>=22.12` floor the
packages declare, and higher than npm's own `>=22.9`. Both workflows take their Node from `.nvmrc`,
which is why `.nvmrc` names an exact version and not the `22` line: `22` lets the runner pick
whatever 22.x it has cached, and that could be older than 22.14. So a test fails if `.nvmrc` drops
below 22.14. Without it, the first sign of trouble is a release that cannot publish, on a tag you
cannot reuse.

We pin npm to one version rather than a range because npm is the thing doing the publishing, and a
publisher that changes under you between two releases is not something you want to find out about
during one.

Nothing watches this pin against what npm releases, so bump it by hand — in both files. A test
holds the two equal, so you can't move one and leave the other. Bumping it usually drags `.nvmrc`
along: npm 12 declares `^22.22.2 || ^24.15.0 || >=26.0.0`, `.nvmrc` is 22.21.1, and `.npmrc` sets
`engine-strict=true`, so installing npm 12 on today's Node is a hard refusal.

Run `rehearsal.yml` once you have. It installs the same npm and does a `--dry-run` publish of all
four packages, so a broken npm shows up there instead of halfway through a release. It doesn't go
near OIDC, though — no `npm` environment, no `id-token: write`, no `--provenance` — so a green
rehearsal says packing and the checks are fine, not that the publish will authenticate.

### What publishing is bound to

There's no npm token anywhere in this repository. Each of the four packages has a trusted
publisher configured on npmjs.com, and each one names three things: this repository, the workflow
file `release.yml`, and the GitHub environment `npm`. The workflow's `id-token: write` mints an
OIDC token that npm checks against those three.

So renaming the workflow file, renaming the environment, or moving the repository stops publishing
until someone edits the publisher on npmjs.com to match. The error npm returns says the token
doesn't match a configured publisher. It won't tell you which of the three is wrong.

Adding a package means two edits, not one: a trusted publisher for its name on npmjs.com, and a
`npm publish --provenance --access public` step in `release.yml` with its `working-directory`. The
publisher can't be created until the package exists, so publish a placeholder version by hand first,
then configure it. Put the new step as early as its own peers allow — ahead of everything, if
nothing it declares as a peer has to land before it — so an auth failure costs as little as
possible.

If a publish does half-finish — attested published, core failed — there's nothing to publish by hand
with. Bump the patch version on all four, merge, and tag again. Don't go hunting for a token to
finish the run: a package whose npmjs.com settings don't require trusted publishing will accept a
granular one, and you'd end up with a version where some tarballs are attested and some aren't.

## When the tool-schema golden fails

`tests/golden/tool-input-schema.json` is the schema sent to the model as the tool's `input_schema`,
so it's part of the prompt. zod writes it, and a zod upgrade has already rewritten it once. When the
test fails:

1. Run `npm run build` first. The regeneration command the test prints imports
   `packages/core/dist/index.js`, so a stale or missing build regenerates the old schema, or
   nothing at all.
2. Run the command the failure message prints, then `git diff` the golden.
3. Read the diff for three things: a field whose `type` changed, a nullable field written a new way
   (4.5.0 moved those from `anyOf` to a type array), and `additionalProperties` turning up where it
   wasn't before. The provider is sent the `input` shape, which carries none.
4. Run `npx vitest run packages/anthropic`. The adapter builds the request around this schema, and
   a shape it can't fill is a runtime refusal, not a test failure here.
5. Commit the golden with the zod version in the message, so the next reader can tell a deliberate
   regeneration from a drift nobody looked at.

## Reporting a security issue

Please don't open a public issue. Check [SECURITY.md](./SECURITY.md) instead. GitHub's private
vulnerability reporting gives us a private thread and a private fork to prepare a fix in.

## Behaviour

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). It applies in issues, pull
requests, discussions, and anywhere else the project is represented.
