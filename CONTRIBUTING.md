# Contributing to rudra-js

Thanks for looking. This is a small project maintained in spare time. It will help the most if you
open an issue to check that the idea fits, ahead of writing any code. You can see what we're aiming
at in _Scope_ below.

## Getting set up

You'll need Node `>=22.12`, as Node 20 is end of life. Also, `scripts/verify-consumer.mjs` needs
`--experimental-strip-types`, but 20.19 doesn't have that. `.nvmrc` names an exact version. If you
want to change this, have a look at [The npm pin](#the-npm-pin) first, because the publishing
workflows also read this file.

```sh
nvm use
npm install
npm run build      # the packages resolve each other through dist/
npm test
```

Keep `npm run test:watch` running while you work, with `npx tsc -b --watch` beside it: tests have to
use `dist/` to reach the other packages, but watch mode won't rebuild that.

## Scope

rudra-js turns **one validated tracking payload into one renderable component specification**. That
boundary is the design:

- It doesn't collect, store or aggregate tracking data. The host owns its pipeline and hands over a
  JSON object per render.
- It doesn't ship a model. Adapters implement `ComponentProvider`.
- It doesn't own the rendering. A registry of components does.

If a proposal stays inside this boundary, it will be easy to accept. If it moves the boundary, we
need to talk first. Often the answer will be "your host can do this already", and it's better to
hear that early than after you've written the code.

## Sending a change

- Your pull request has to be a single coherent change. If you have a rename and a bug fix in a
  branch, that's two pull requests.
- All of the checks below have to pass. CI will run these too.
- Use the description to tell us how you convinced yourself that the tests would catch a regression.
  This is worth more to us than a coverage number.
- For anything a host would notice, add a line under `[Unreleased]` in
  [CHANGELOG.md](./CHANGELOG.md). If none is needed, you have to say why in the description.

Contributions are licensed under the MIT licence in [LICENSE](./LICENSE), the same licence the rest
of the project uses. By sending a pull request you're confirming you have the right to submit the
work: you wrote it, or whoever holds the rights to it has let you contribute it here. There's no
separate agreement to sign.

## Naming

In a published package, names are permanent in a way that internal names aren't. A consumer will
just see the name, with none of the file around it. It will also be a breaking change to rename it.
Most of what follows has to be caught in review, because a linter can't.

### The rules

**1. Never shadow a TypeScript built-in or a platform global.**

`Pick`, `Omit`, `Record`, `Partial`, `Exclude`, `Parameters`, `ReturnType` and the rest of the
utility types are in scope in any consumer's file. An export named `Pick` is more than bad style:
importing it will remove `Pick<T, K>` from that module. Some platform globals have this problem too:
`Event`, `Request`, `Response`, `Node`, `Element`, `Text`, `Range`, `Selection`, `File` and
`Location`.

You can fix these with a domain prefix: `ProductPick`, not `Pick`.

**2. Spell it out. No abbreviations, no invented shorthand.**

`ProductReference`, not `ProductRef`. `configuration`, not `config`. `index`, not `idx`. `error`,
not `err`.

An acronym is the exception if it's the standard term in the domain and the people who use it
_never_ write it out in full (`sku`, `url`, `html`, `json`). `SKU` counts, but `Ref` doesn't. In a
package that also ships React components, that name will actively mislead.

**3. Booleans read as a question, and answer it positively.**

Prefix with `is`, `has` or `are`. Never name the negative:

```ts
isInStock; // not inStock, not outOfStock
isUsable; // not usable
hasSupportedBasis; // not basisHolds
```

`isNotEnabled` is not allowed at all. To work out `!isNotEnabled`, you have to negate twice.

**4. Filenames are kebab-case noun phrases naming the concept the module owns.**

Put verbs in function names, not filenames: `product-selection.ts` exporting `selectProducts`, not
`select.ts`.

Avoid any name that a tool might claim. To most JavaScript developers `spec.ts` looks like a test
file, since `.spec.ts` is a test convention. That's why we use `component-spec.ts`.

Enforced by `unicorn/filename-case`.

**5. An exported name has to make sense with no other context.**

All the reader sees is `import { Block } from '@rudra-js/core'`. If the name only makes sense next
to its neighbours in the file, it's too short.

**6. Match the name to the shape.** If a function returns a boolean, it reads as a predicate
(`showsAnyProduct`). If it builds something, it reads as a builder (`buildDigest`). A type and its
schema share a stem: `ProductReference` and `productReferenceSchema`.

### Case conventions

| Construct                                       | Convention             |
| ----------------------------------------------- | ---------------------- |
| Variables, functions, parameters, object fields | `camelCase`            |
| Types, interfaces, classes                      | `PascalCase`           |
| Module-level constants that are configuration   | `SCREAMING_SNAKE_CASE` |
| Files and directories                           | `kebab-case`           |

### When to rename

You can rename freely up to the first published release. It costs nothing. After that, you'll need
real breakage or a real collision to justify a rename, because it will be a major-version change.

## Tests

Any behaviour that a comment claims is true needs a test that will fail when it stops being true.
There are two habits that are worth more than a coverage percentage.

**Assert the value, not a relation between two derived values.** Two results can agree and both be
wrong. If a bug empties both sides, an equality check will pass but pin nothing.

**Mutate the source and confirm the suite notices.** It's not a test if it passes when you break the
thing it names. If a mutation fails nothing, either the test proves nothing or the mutation is
equivalent. You'll have to find out which before you move on.

## Checks

`npm run check` runs all six in order and stops at the first failure:

```sh
npm run build
npm run typecheck        # includes test files, which the build does not
npm run lint
npm run format:check
npm test
npm run verify:consumer  # packs every package and uses them from outside the repo
```

In CI all six are separate steps. This means a failed run will name the check that failed.

## Releasing

Bump the version in a pull request of its own and merge it. There's more to a bump than the
`version` fields: you have to get the new version to all the places that name it. If you miss any,
`npm ci` inside the release job will stop the release on a tag you can't take back. These are the
places:

- `version` in the root manifest, in all of the `packages/*/package.json` files and in
  `examples/shop/package.json`.
- All the peer ranges that packages declare on their siblings. `^0.5.0` becomes `^0.6.0` in
  `packages/core`, `packages/react`, `packages/anthropic` and `packages/a2ui` (two there, core and
  react). A caret on a `0.x` version will only allow patches. If you leave one behind, you'll
  publish packages that can't be installed together.
- All the exact sibling pins those four have in `devDependencies` (two in `packages/a2ui`) and the
  three in `examples/shop`.
- `package-lock.json`, regenerated with the npm the release installs:

  ```sh
  npm install -g npm@11.19.1
  npm install --package-lock-only --ignore-scripts
  ```

  Node 22.21.1 comes with npm 10.9.4. That npm will drop the 12 `libc` fields in the lockfile
  without telling you. These fields pick the glibc or musl build of Next's SWC and of oxlint's
  native binaries on the runner.

You'll need to go through this list on the pull request, because nothing will check it for you. If
you miss one, the release will either fail on the tag or publish packages that can't be installed
together.

There's no automation for the paperwork either. `release.yml` will publish to npm and do nothing
more: no GitHub release, no CHANGELOG edit. You'll need to move the `## [Unreleased]` heading and
the `[unreleased]:` compare link at the bottom of `CHANGELOG.md` in that pull request too, because
nothing fails if you don't. You'll also need to update the `Status:` line at the top of `README.md`.
That line names the version, but no test reads it. It was two releases behind by the time anyone
noticed.

Then push a signed tag `vX.Y.Z` at the merge commit, while it's still the tip of `main`:

```sh
git tag -s v0.5.1 -m 'v0.5.1'
git push origin v0.5.1
```

Pushing a `v*` tag will start [`.github/workflows/release.yml`](.github/workflows/release.yml). This
runs the six checks a pull request runs (build included) and then publishes `@rudra-js/attested`,
`@rudra-js/core`, `@rudra-js/react`, `@rudra-js/a2ui` and `@rudra-js/anthropic` in that order with
`npm publish --provenance`.

This is the order an install can satisfy. `@rudra-js/attested` has to go first, because it depends
on nothing and core declares it as a peer. Core has to come ahead of react and anthropic, since they
declare it as a peer. a2ui has to follow react, because it declares core and react. npm can't
publish over a half-finished release. If a package goes out ahead of a failure, it will be public
and stuck at a version the next tag can't reuse.

Three steps will run before anything is installed. Any one of them stops the release: the tagged
commit has to be on `main`, it has to be the tip of `main` and the tag has to equal the `version` in
`packages/core/package.json`. All the package manifests have this version too.

Of the three, the tip check is the strict one (it's strict on purpose). It takes more than being on
`main`, because all the commits after the bump also read the bumped version. With a tag a few
commits back, the other two checks would pass and the release would publish a tree that's missing
whatever landed since. You wouldn't be able to undo this. The provenance would also point at a real
`main` commit. This strict check has a price: a tag will be used up if `main` moves between your tag
push and the start of the job.

Be careful with tags. Once you've pushed a tag that matches `v*`, you can't move or delete it. This
means a tag that fails a check is used up. To fix this, you'll have to bump the version and tag
again. This is also true of a version that did publish: npm rejects a republish. To fix a mistake
you'll have to tag a new patch version, not retry the old one.

### The npm pin

Both `release.yml` and `rehearsal.yml` install `npm@11.19.1` before they publish. Node 22 ships npm
10, but that can't do trusted publishing at all. For this you need npm 11.5 or newer, which reads
the OIDC token itself.

For trusted publishing you'll also need Node 22.14 or newer. That's higher than the `>=22.12` floor
the packages declare and also higher than the `>=22.9` that npm asks for. The two workflows take
their Node from `.nvmrc`. This is why `.nvmrc` names an exact version and not the `22` line: with
`22` the runner can pick any 22.x it has cached (which could be older than 22.14). Nothing will
check that `.nvmrc` stays at 22.14 or above. If it drops, the first sign of trouble will be a
release that cannot publish, on a tag you cannot reuse.

We pin npm to an exact version and not to a range, because npm is the thing doing the publishing. If
a publisher changes under you between two releases, you don't want to find that out during a
release.

This pin isn't watched against new npm releases. You'll have to bump it by hand, in both files.
You'll also have to look before you merge, because nothing checks that the two match:

```sh
grep -n 'npm@' .github/workflows/release.yml .github/workflows/rehearsal.yml
```

You'll usually have to change more than these two files, as `.nvmrc` will need a bump too. npm 12
declares `^22.22.2 || ^24.15.0 || >=26.0.0`, `.nvmrc` is 22.21.1 and `.npmrc` sets
`engine-strict=true`. This means that installing npm 12 on today's Node will be a hard refusal.

Run `rehearsal.yml` once you have bumped the pin. This installs the same npm and does a `--dry-run`
publish of all the packages. You'd see a broken npm there and not halfway through a release. But it
doesn't go near OIDC: no `npm` environment, no `id-token: write`, no `--provenance`. If the
rehearsal is green, this tells you that packing and the checks are fine, but not that the publish
will authenticate.

### What publishing is bound to

There's no npm token anywhere in this repository. Each of the published packages has a trusted
publisher configured on npmjs.com. These publishers all name the same three things: this repository,
the workflow file `release.yml` and the GitHub environment `npm`. With `id-token: write`, the
workflow mints an OIDC token that npm checks against those three.

Publishing will stop if you rename the workflow file, rename the environment or move the repository.
It won't start again until someone edits the publisher on npmjs.com to match. You'll get an error
from npm saying the token doesn't match a configured publisher, but it won't tell you which of the
three is wrong.

To add a package you need to make two edits: a trusted publisher for its name on npmjs.com and a
`npm publish --provenance --access public` step in `release.yml` with its `working-directory`. There
can't be a publisher until the package exists. You'll have to publish a placeholder version by hand
first, then configure it. You'll need to put the new step as early as its peers allow (ahead of
everything, if nothing it declares as a peer has to land first) to make an auth failure cost as
little as possible.

If a publish does half-finish (attested published, core failed), there's nothing to publish by hand
with. You'll have to bump the patch version on all of them, merge and tag again. Don't go looking
for a token to finish the run. If the npmjs.com settings of a package don't require trusted
publishing, it will accept a granular token. This would leave you with a version where some of the
tarballs are attested and some aren't.

## Reporting a security issue

Please don't open a public issue. Check [SECURITY.md](./SECURITY.md) instead. We can use GitHub's
private vulnerability reporting to get a private thread and a private fork to prepare a fix in.

## Behaviour

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). It applies in issues, pull
requests, discussions and anywhere else the project is represented.
