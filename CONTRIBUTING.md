# Contributing to rudra-js

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

The reader sees `import { Block } from '@rudra/core'` and nothing else. If the
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

All of these run in CI and must pass:

```sh
npm run build
npm run typecheck   # includes test files, which the build does not
npm run lint
npm run format:check
npm test
```
