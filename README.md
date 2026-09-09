# rudra-js

A framework of server side components built dynamically and rendered in real time.

rudra-js takes a validated payload describing what a shopper has done, asks a language model to
design a recommendation component for that shopper, and server-renders the result into the initial
HTML response. The model never returns markup: it returns a specification drawn from a closed
vocabulary, which a registry of components renders. So the model picks the arrangement and the
words, the registry writes the markup, and every product fact — title, price, image, link — is read
from your own catalog when the page is served. What the model wrote is rendered as escaped text.

> **Status: `0.1.0`, early.** Installable and usable — the Getting started below runs as a test on
> every commit. The public contracts may still change between minor versions before `1.0`, and the
> changelog says when they do.

## Getting started

Nothing here needs an API key. Leave the provider out and you get the deterministic
component — a supported setting, not a stub, and the right one until you have decided
on a model.

```sh
npm install @rudra-js/core @rudra-js/react zod@^4
```

Every package here lives under the `@rudra-js` scope. The unscoped `rudra-js` package on npm
belongs to someone else and has nothing to do with this project — check the `@` before you
install.

zod 4 is required. The public API of `@rudra-js/core` _is_ zod schemas, so your app and
the package have to resolve the same zod, and a zod 3 app will fail to install.

```tsx
import { createComponentGenerator, parseTrackingInput } from '@rudra-js/core';
import { RudraComponent } from '@rudra-js/react';

const catalog = [
  { sku: 'A-1', title: 'Cast iron skillet', category: 'Cookware', price: 39, currency: 'USD' },
  { sku: 'A-2', title: 'Enamel dutch oven', category: 'Cookware', price: 89, currency: 'USD' },
  { sku: 'A-3', title: 'Chef knife', category: 'Knives', price: 55, currency: 'USD' },
];

async function recommendations() {
  // No provider means no API key and no spend. It is a supported setting, not
  // a stub: you get the deterministic component.
  const generator = createComponentGenerator({ provider: null });

  // Parsing fills in what you left out and rejects what does not belong. Pass
  // the parsed candidates to the renderer, not your raw objects.
  const input = parseTrackingInput({
    user: { id: 'shopper-1' },
    context: { surface: 'pdp', currentSku: 'A-1', currentCategory: 'Cookware' },
    candidates: catalog,
    signals: { cart: [{ sku: 'A-2', at: Date.now() }] },
  });

  const spec = await generator.generate(input);

  return <RudraComponent spec={spec} products={input.candidates} />;
}
```

In Next.js, `export default recommendations` at the end makes this a page. A shopper
looking at the skillet with the dutch oven already in their cart is shown the knife,
under the heading "Goes with your cart". The page they are on and the thing they
have already chosen are both left out. No model was asked, and nothing was billed.

To bring a model in, add [`@rudra-js/anthropic`](packages/anthropic) and pass it as the
`provider`. Everything above stays the same — the model writes the wording, the layout and
the emphasis, and by default the products in a grid or carousel are still chosen here
rather than by the model. See [What the model decides, by
mode](packages/core#what-the-model-decides-by-mode) for the line in each mode,
[`@rudra-js/core`](packages/core) for the full payload, and
[`@rudra-js/react`](packages/react) for the class names to style.

That adapter is one option, not the only one. The three-method interface any model can sit
behind is in [Any provider](packages/core#any-provider).

The code above is run as a test on every commit, so a change that breaks it fails CI.

## Packages

| Package                                     | What it does                                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [`@rudra-js/core`](packages/core)           | The contracts and logic that turn one tracking payload into one renderable component specification |
| [`@rudra-js/react`](packages/react)         | Renders that specification as React Server Components, with no client JavaScript                   |
| [`@rudra-js/anthropic`](packages/anthropic) | Talks to the Anthropic API, and is the only package that makes a billed call                       |

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
npm run verify:consumer   # packs all three packages and uses them from outside the repo
```

`ANTHROPIC_API_KEY= RUDRA_REPLAY_ONLY=1 npm run bench` measures what each generation mode costs under a stub model; [bench/README.md](bench/README.md) says what its columns mean.

If you have a key in your shell, run the tests as `ANTHROPIC_API_KEY= npm test`. `vitest.config.ts`
sets `RUDRA_REPLAY_ONLY=1` for every test run, and the shop throws at start-up when that is set and
a key is set too — so a run with a key in the shell fails to load instead of calling the model.

CI runs all six of these on every pull request, and a second job builds the example shop and
checks that its page still reads as one to a crawler. CI has no key, so it runs the build plainly:

```sh
npm run build --workspace @rudra-js/example-shop
npm run verify:crawlable
```

Locally, empty the key on the build line — the shop reads `examples/shop/.env.local`, and a build
with a key calls the model for real:

```sh
ANTHROPIC_API_KEY= RUDRA_REPLAY_ONLY=1 npm run build --workspace @rudra-js/example-shop
```

## Example

[`examples/shop`](examples/shop) is a small Next.js storefront that puts the architecture through a
real page: a product page asks a language model for a recommendation component and server-renders
the result into the same HTML response, rather than fetching it after the page loads.

```sh
npm run dev --workspace @rudra-js/example-shop
# then visit http://localhost:3000/product/RJ-00001?shopper=S-0001
```

Set `ANTHROPIC_API_KEY` and `ANTHROPIC_WORKSPACE_ID` in the environment and it calls Claude for real, saving each answer as a
transcript under `examples/shop/recordings/`. Without a key it replays those committed transcripts
instead — so a clone with no key still exercises generation, deterministically, for free. A request with no
recorded transcript degrades the same way any other model failure does: to a deterministic
fallback component, so the page still renders. That degradation is worth watching for rather than
relying on — a test in the example fails once a transcript is committed if the page it belongs to is
ever served from the fallback instead.

A transcript is the whole prompt. Each file under `examples/shop/recordings/` holds the system half,
the user half and the model's answer, in plain JSON, and those files are committed to the repository.
So point the recording provider at demo shoppers and demo catalogs only. Do not run it against real
traffic, and do not run it in `per-shopper` mode: that mode puts a real person's likes, basket, views
and searches into the prompt, and recording writes all of it to a file you then commit.

Expect the first render of a page with a key to be slow. The shop gives the model 60 seconds rather
than core's 1.5-second default, because this model reasons before it answers and a spec does not
come back inside a second and a half — and since a transcript is written only once the call returns,
that default would mean no recording could ever be made. Nothing after that first render waits: the
same page comes from the in-process cache, and a keyless clone comes from the transcript.

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
