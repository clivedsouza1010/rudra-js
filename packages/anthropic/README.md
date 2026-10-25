# @rudra-js/anthropic

This package is part of [rudra-js](https://rudrajs.com).

rudra-js is an open-source TypeScript library (MIT) you install from npm. A language model designs one product-recommendation block for a page in your shop, rudra-js checks it against your catalog, and React renders it.

It is not a hosted platform, a visual or low-code app builder, or a workspace you sign up for.

This package plugs Anthropic's models into
[`@rudra-js/core`](https://github.com/clivedsouza1010/rudra-js/tree/main/packages/core)
as a `ComponentProvider`.

Its docs are at [rudrajs.com](https://rudrajs.com/reference/anthropic/createAnthropicProvider).

> Anthropic and Claude are trademarks of Anthropic, PBC. This package is an
> independent adapter and is not affiliated with or endorsed by Anthropic.

## Install

```sh
npm install @rudra-js/anthropic@latest @rudra-js/core@latest @rudra-js/attested@latest
```

Use this same command in a new app or in one that already uses rudra-js. Use it
to upgrade too. If your app has `@rudra-js/react`, add it to the command with
`@latest` too. If it has `@rudra-js/a2ui`, use the install line in that
package's README instead. That line also names the two A2UI packages.

The `@rudra-js` packages are released together. Each one's peer dependency
ranges on the others start at its own version. When you give npm a package name
with no version, it stays inside the range your `package.json` already has. So
without `@latest`, an app on an older core can get an `ERESOLVE` error.

```ts
import { createAnthropicProvider } from '@rudra-js/anthropic';
import { createComponentGenerator } from '@rudra-js/core';

const provider = createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });
const generator = createComponentGenerator({ provider });
```

`model` defaults to `claude-sonnet-5`. `thinking` defaults to
`{ type: 'disabled' }`. `maxTokens` and `baseUrl` are optional too.

Generation runs while the page request waits, inside core's `modelTimeoutMs`.
That defaults to 1500ms. A model that reasons before it answers won't finish in
that time. Sonnet 5 reasons by default when the request leaves `thinking` out.
So the `thinking` default is what keeps Sonnet 5 inside the time limit.

To use another model, pass `model`, and raise `modelTimeoutMs` to match. Some
models reject an explicit `{ type: 'disabled' }` and reason whatever you send.
For those, pass `thinking: null`, and the adapter sends no `thinking` field at
all. The example shop in this repo pins `claude-opus-5` and gives
`modelTimeoutMs` 60 seconds. That's a demo setting. Don't use it in production.

The adapter asks the model to answer by calling its tool. It doesn't force the
call, because Claude Opus 5.5, Sonnet 5.5, Fable 5.1 and Mythos 5.1 reject a
forced tool call. So a model can answer in plain text instead. The adapter
rejects that reply, the same as any reply that doesn't fit. You get the
fallback, which is the block core builds without a model. The event's `error`
in `onEvent` says `anthropic returned no emit_component_spec tool use`.

Those four models also reject `thinking: { type: 'disabled' }`, so pass
`thinking: null` with them.

You can pass your own `fetch`. This package's tests do that to stand in for a
network call.

The adapter builds the tool schema it sends the model from the `schema` on the
`ProviderRequest`. That's the schema `@rudra-js/core` defines. This package
keeps no copy of its own.

### An identity-linked key needs a workspace

An identity-linked key is one you made against your own identity, outside any
workspace. It belongs to you across several workspaces. The API can't tell which
one a request acts in, so it answers with this error:

```
400 invalid_request_error — anthropic-workspace-id is required when
authenticating with an identity-linked API key
```

Pass the workspace, or create the key from inside a workspace instead:

```ts
createAnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  workspaceId: process.env.ANTHROPIC_WORKSPACE_ID!,
});
```

## Data handling

Each generation sends one POST to `https://api.anthropic.com/v1/messages`. Set
`baseUrl` to send it to another host instead. That can be a proxy or a gateway.
It can also be a region-specific endpoint you have.

The [`@rudra-js/core` README](https://github.com/clivedsouza1010/rudra-js/tree/main/packages/core#what-the-model-sees)
lists what goes in that request, under **What the model sees**. Read it before
you send real shopper traffic.

In cohort mode, the default, shoppers who look alike share one generated block.
Each shopper's own products are filled in per request. Per-shopper mode
generates for each shopper. Neither mode sends `user.id`.

A cohort-mode request can still be personal data. It carries:

- the name of the category that shopper leans towards most
- whether they have any history
- any `segment` you gave them, as you wrote it
- the candidate products, which you may have picked or ordered just for them

A per-shopper request also carries:

- the product that shopper is looking at
- their current and recent searches
- whether they're returning
- their likes, dislikes and purchases
- their basket
- their most-viewed products
- the categories they lean towards
- interaction counts

If your shop is in the EU or the UK, or sells to shoppers there, you're the one
sending personal data out. You need a data processing agreement (DPA) with
whoever receives it. If the receiver is outside the EU or the UK, you also need a
transfer mechanism. That holds even when your shop is outside the EU and the UK.

If you call Anthropic with a key from your own Anthropic account, the receiver is
Anthropic. Anthropic's data processing addendum is part of its Commercial Terms.
It makes Anthropic your processor and includes the transfer clauses. Your shop
is Anthropic's customer. A proxy you run yourself that forwards to Anthropic
doesn't change that.

If you point `baseUrl` at a gateway or platform run by someone other than you or
Anthropic, its operator sees every request and the `apiKey` you pass. If that's
a key from your own Anthropic account, Anthropic is still your processor. The
operator is a second processor, so you need a DPA with the operator as well. If
the platform issued the key, Anthropic says the platform's terms govern that
use. You're the platform's customer, and the platform's DPA is the one that
covers you.

This package is a piece of code in the middle. It _isn't_ a party to anything.

When the API answers with an error, the adapter throws an `Error` that carries
the status code and Anthropic's error category, like
`anthropic responded 400 (invalid_request_error)`. It leaves out Anthropic's own
error message. That message quotes the request back. The request can hold a
shopper's search terms. If the adapter kept the message, a `console.error(error)`
in your app would write those terms to a log. A test in
`anthropic-provider.test.ts` puts a search term in that message and checks that
it doesn't reach the thrown error.

## Licence

[MIT](./LICENSE)
