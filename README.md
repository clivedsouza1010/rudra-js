# rudra-js

A framework of server side components built dynamically and rendered in real time.

rudra-js takes a validated payload describing what a shopper has done, asks a language model to
design a recommendation component for that shopper, and server-renders the result into the initial
HTML response. The model never returns markup: it returns a specification drawn from a closed
vocabulary, which a registry of components renders. That is what makes generated output safe to put
in a page.

It is the reference implementation of the architecture in _AI-Driven Server Side Rendering of Web
Components Using Real-Time Data_.

> **Status: early, and not published.** Both packages are being built one module at a time and
> their contracts are still moving. Please do not depend on them yet.

## Packages

| Package                             | What it does                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| [`@rudra-js/core`](packages/core)   | The contracts and logic that turn one tracking payload into one renderable component specification |
| [`@rudra-js/react`](packages/react) | Renders that specification as React Server Components, with no client JavaScript                   |

## Development

Node `^20.19 || >=22.12` is required — TypeScript 7 and Vitest 4 both need it,
and both fail confusingly on older versions. `.nvmrc` pins 22, and
`engine-strict=true` turns a mismatch into a readable install error.

```sh
nvm use
npm install

npm run build        # tsc -b across the workspace
npm run typecheck    # includes test files, which the build does not
npm run lint
npm run format:check
npm test
npm run verify:consumer   # packs both packages and uses them from outside the repo
```

CI runs all six of these on every pull request, and builds the example shop in a second job.

## Example

[`examples/shop`](examples/shop) is a small Next.js storefront that puts the architecture through a
real page: a product page asks a language model for a recommendation component and server-renders
the result into the same HTML response, rather than fetching it after the page loads.

```sh
npm run dev --workspace @rudra-js/example-shop
# then visit http://localhost:3000/product/RJ-00001?shopper=S-0001
```

Set `ANTHROPIC_API_KEY` in the environment and it calls Claude for real, saving each answer as a
transcript under `examples/shop/recordings/`. Without a key it replays those committed transcripts
instead — so a clone with no key still exercises generation, deterministically, for free. A request with no
recorded transcript degrades the same way any other model failure does: to a deterministic
fallback component, so the page never breaks. That degradation is worth watching for rather than
relying on — a test in the example fails once a transcript is committed if the page it belongs to is
ever served from the fallback instead.

Expect the first render of a page with a key to be slow. The shop gives the model 60 seconds rather
than core's 1.5-second default, because this model reasons before it answers and a spec does not
come back inside a second and a half — and since a transcript is written only once the call returns,
that default would mean no recording could ever be made. Nothing after that first render waits: the
same page comes from the in-process cache, and a keyless clone comes from the transcript.

**What this slice does not prove.** The example's test that the recommendation area sends no
JavaScript calls the page as a plain function and inspects the output directly — it never runs
through Next's own build and render pipeline, so it cannot fail on a bootstrap `<script>` tag Next
might add elsewhere on the page. The area genuinely ships no client JavaScript today, but that test
is not what proves it; the real check — markup present in the first chunk of the response, in its
final DOM position, with JavaScript disabled in the browser — belongs to later benchmark work and
does not exist yet. That is a known limitation of the example, not of the
architecture.

## Getting help

- **Questions and ideas** — open a [discussion](https://github.com/clivedsouza1010/rudra-js/discussions).
- **Bugs** — open an [issue](https://github.com/clivedsouza1010/rudra-js/issues/new/choose).
- **Vulnerabilities** — please report privately, see [SECURITY.md](./SECURITY.md).

## Contributing

Contributions are welcome. [CONTRIBUTING.md](./CONTRIBUTING.md) covers setup, the scope the project
holds to, and its naming and testing conventions. Everyone taking part is expected to follow the
[code of conduct](./CODE_OF_CONDUCT.md).

Changes are recorded in the [changelog](./CHANGELOG.md).

## Licence

[MIT](./LICENSE) © Clive Dsouza
