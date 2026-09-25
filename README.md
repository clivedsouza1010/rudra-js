# rudra-js

rudra-js gives you recommendation blocks designed by a language model and rendered on the server by
React, while every product fact comes from your own trusted catalog.

If a language model writes raw HTML, it can hallucinate a fake price or a product you don't sell
onto your page. So rudra-js never lets the model write HTML. Instead it returns a specification
drawn from a closed vocabulary: it picks a layout, writes a headline, and provides the copy. There
are simply no fields for it to invent a price, a product name, an image, or a link. Products are
referenced only by SKU, and only from the list you provide. In the default mode, the products shown
in a grid or carousel are chosen per request from that list, not by the model.

![The example shop's product page. The heading, the order, the highlighting and the paragraph are the model's. Every title, price and image is the shop's.](docs/demo.png)

`@rudra-js/react` turns that specification into markup, reading the title, price, image, and link
from your catalog as the page is served. Whatever the model wrote is rendered as escaped text.

We also read every word the model writes, in three passes. Patterns for prices, discounts, ratings,
delivery dates and stock counts. A check that every digit in the sentence is one your own payload
supplied — a category or a tag on a candidate we showed the model. And a list of claims that carry
no number to check, like "top pick" and "customer favourite". Any field that fails a pass is
dropped.

Two of the three are word lists, so a rewording that sits on neither gets through, and the digit
check reads digits, so a number spelled out in words isn't a number to it. "Four and a half stars
from other hikers" walks past all three. The tests hold a list of rewordings that still pass, so
the gap has a size you can go and read. That's why the structural boundaries are the real defence:
the model is never told a price, and the specification has nowhere to put one.

Because the block is in the initial HTML response and needs zero client-side JavaScript, a crawler
that never runs JavaScript still reads it. It's efficient too: on our 500-shopper benchmark the
default mode makes 460 model calls per 1,000 page views, compared to 1,000 if you generated for
every shopper. And if you want to run with no model at all, that's a fully supported setting rather
than a stub, and it won't cost you a penny.

> **Status: `0.6.0`, early.** It installs and it works. The Getting started below actually runs as a
> test on every commit. Just keep in mind that the public contracts might still shift between minor
> versions before we hit `1.0`, and the changelog will always tell you when they do.

## Getting started

You don't need an API key to get going. Leave the provider out and you'll get the deterministic
component, which is a fully supported setting and the right one until you've settled on a model.

```sh
npm install @rudra-js/core @rudra-js/react @rudra-js/attested zod@^4
```

A quick heads-up: every package here lives under the `@rudra-js` scope. The unscoped `rudra-js`
package on npm belongs to someone else, so make sure you include the `@`.

You'll need zod 4. The public API of `@rudra-js/core` _is_ zod schemas, so your app and the
package have to resolve the same copy of zod, which means a zod 3 app won't install at all.

You'll need React 18 or 19. You don't need Server Components: `@rudra-js/react` is plain React with
no hooks, so it works as a Server Component, with `renderToString`, or in a client-rendered app.
Rendering it on the server is what puts the block in the first HTML response.

You'll also need Node 22.12 or later. Node 20 is end of life, so we don't build or test on it.

```tsx
import { createComponentGenerator, parseTrackingInput } from '@rudra-js/core';
import { RudraComponent } from '@rudra-js/react';

const catalog = [
  { sku: 'A-1', title: 'Cast iron skillet', category: 'Cookware', price: 39, currency: 'USD' },
  { sku: 'A-2', title: 'Enamel dutch oven', category: 'Cookware', price: 89, currency: 'USD' },
  { sku: 'A-3', title: 'Chef knife', category: 'Knives', price: 55, currency: 'USD' },
];

async function recommendations() {
  // Passing no provider means no API key and no spend.
  // You get a reliable, deterministic component.
  const generator = createComponentGenerator({ provider: null });

  // Parsing fills in what you left out and strips anything that doesn't belong.
  // Always pass the parsed candidates to the renderer, not your raw objects.
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

In Next.js, adding `export default recommendations` at the bottom turns that into a page. A shopper
looking at the skillet with the dutch oven already in their cart is shown the knife, under the
heading "Goes with your cart". The page they're on and the thing they've already chosen are both
left out. No model was asked, and nothing was billed.

When you're ready to bring a model in, add [`@rudra-js/anthropic`](packages/anthropic) and pass it
as the `provider`. Everything above stays the same, except that the model now writes the wording,
the layout and the emphasis. By default the products in a grid or carousel are still chosen by the
core logic rather than by the model.

That adapter is one option, not the only one. Any model can sit behind the small interface described
in [Any provider](packages/core#any-provider).

_We run the code block above as a test on every commit, so if a change breaks it, CI catches it
straight away._

## Packages

| Package                                     | What it does                                                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [`@rudra-js/core`](packages/core)           | The contracts and logic that turn one tracking payload into one renderable component specification, screened with `@rudra-js/attested` |
| [`@rudra-js/react`](packages/react)         | Renders that specification with React, on the server or in the browser                                                                 |
| [`@rudra-js/anthropic`](packages/anthropic) | Talks to the Anthropic API, and is the only package that makes a billed call                                                           |
| [`@rudra-js/attested`](packages/attested)   | Checks model-written copy against the facts a shop stands behind, with no dependencies                                                 |

## Development

You'll need Node `>=22.12` to work on this. Node 20 is end of life and doesn't have the
`--experimental-strip-types` flag that `npm run verify:consumer` relies on. `.nvmrc` names an exact
Node 22 so the version is never a guess, and `engine-strict=true` turns a mismatch into a readable
install error. CI runs the checks on 22.12.0 as well as on the latest Node 22, so the floor we
claim is genuinely exercised.

```sh
nvm use
npm install

npm run check        # all six of the below, in order

npm run build        # tsc -b across the workspace
npm run typecheck    # includes test files, which the build does not
npm run lint
npm run format:check
npm test
npm run verify:consumer   # packs all four packages and uses them from outside the repo
```

To see what each generation mode costs under a stub model, run
`ANTHROPIC_API_KEY= RUDRA_REPLAY_ONLY=1 npm run bench`. [bench/README.md](bench/README.md) explains
what the columns mean.

If you keep a key exported in your shell, run the tests as `ANTHROPIC_API_KEY= npm test`.
`vitest.config.ts` sets `RUDRA_REPLAY_ONLY=1` for every test run, and the shop deliberately throws
at start-up when that flag and a key are both present, so a run with a key in the shell fails to
load rather than quietly spending money.

We run all six checks on every pull request as separate steps, so a failure names itself, and a
second job builds the example shop and checks its page still reads as one to a crawler. CI sets no
mode, so the shop replays and that job runs the build plainly:

```sh
npm run build --workspace @rudra-js/example-shop
npm run verify:crawlable
```

Locally that build is safe on its own, since a key alone no longer spends anything and only
`RUDRA_SHOP_MODE=record` does. The prefix below just makes it a rule rather than a default:

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

That replays the transcripts committed under `examples/shop/recordings/`, so it bills nothing
whatever keys you have in your environment. `RUDRA_SHOP_MODE` is the switch, and `record` is the one
value that spends money:

```sh
RUDRA_SHOP_MODE=record npm run dev --workspace @rudra-js/example-shop
```

That calls Claude once for each page that has no transcript yet and saves the answer as a new one.
Pages that already have one are still replayed, so browsing costs nothing after the first time.

[`examples/shop/README.md`](examples/shop/README.md) covers the rest: the environment variables, how
to re-record a transcript after a prompt change, and why the files under `recordings/` must only
ever hold demo shoppers and demo catalogs.

## Getting help

- **Questions and ideas** — come and talk in
  [Discussions](https://github.com/clivedsouza1010/rudra-js/discussions).
- **Bugs** — open an [issue](https://github.com/clivedsouza1010/rudra-js/issues/new/choose).
- **Vulnerabilities** — please report them privately, see [SECURITY.md](./SECURITY.md).

## Contributing

Contributions are welcome. [CONTRIBUTING.md](./CONTRIBUTING.md) covers setup, the scope the project
holds to, and its naming and testing conventions. Everyone taking part is expected to follow the
[code of conduct](./CODE_OF_CONDUCT.md).

Changes are recorded in the [changelog](./CHANGELOG.md).

## Patent

Patent pending in the US. A provisional application for the cohort caching
design — the coupled cache key and prompt projection in
[`spec-cache.ts`](packages/core/src/spec-cache.ts) — was filed on 20 September
2026, application 64/158,649.

This doesn't change how you can use rudra-js. The code is MIT and stays MIT. The
application was filed defensively, so that nobody else patents the design and
comes after the people using it. A provisional isn't examined and may never
become a granted patent.

## Licence

[MIT](./LICENSE) © Clive Dsouza
