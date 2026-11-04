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

You will need this command in a new app and in an app that already uses
rudra-js. You will also need this command to upgrade. If your app has
`@rudra-js/react`, you will need to add it to the command with `@latest` too. If
your app has `@rudra-js/a2ui`, you will need to use the install line in that
package's README instead. That line also names the two A2UI packages.

All of these `@rudra-js` packages are released together. Peer dependency ranges
between them start at the version of the package that has the range. If you give
npm a package name with no version, npm will stay inside the range your
`package.json` already has. This means leaving out `@latest` can give an app on
an older core an `ERESOLVE` error.

```ts
import { createAnthropicProvider } from '@rudra-js/anthropic';
import { createComponentGenerator } from '@rudra-js/core';

const provider = createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });
const generator = createComponentGenerator({ provider });
```

By default, `model` is `claude-sonnet-5` and `thinking` is
`{ type: 'disabled' }`. You can also set `maxTokens` and `baseUrl`. These are
optional too.

Your page request waits while generation runs inside core's `modelTimeoutMs`.
This is 1500ms by default. If a model reasons before it answers, it won't finish
in that time. By default Sonnet 5 will reason if the request leaves `thinking`
out. So the `thinking` default is what keeps Sonnet 5 inside the time limit.

If you want to use another model, pass `model` and raise `modelTimeoutMs` to
match. Some models reject an explicit `{ type: 'disabled' }` and reason whatever
you send. For those models you will need to pass `thinking: null` to have the
adapter send no `thinking` field at all. There is an example shop in this repo
that pins `claude-opus-5` and gives `modelTimeoutMs` 60 seconds. That's a demo
setting. Don't use it in production.

This adapter asks the model to answer by calling its tool. But the call isn't
forced, because Claude Opus 5.5, Sonnet 5.5, Fable 5.1 and Mythos 5.1 reject a
forced tool call. This means a model can answer in plain text instead. If a
model does this, the adapter will reject the reply like any other reply that
doesn't fit. You will then get the fallback (the block that core builds without
a model). For this reply the event's `error` in `onEvent` says
`anthropic returned no emit_component_spec tool use`.

Those four models also reject `thinking: { type: 'disabled' }`. With them you
need to pass `thinking: null`.

You can pass a custom `fetch`. This package's tests do that to stand in for a
network call.

This adapter builds the tool schema it sends the model from the `schema` on the
`ProviderRequest`. That's the schema defined by `@rudra-js/core`. This package
doesn't keep a copy.

### An identity-linked key needs a workspace

If you made a key against your own identity, outside any workspace, this is an
identity-linked key. This key belongs to you across several workspaces. Because
the API can't tell which of those a request acts in, it answers with this error:

```
400 invalid_request_error — anthropic-workspace-id is required when
authenticating with an identity-linked API key
```

You need to pass the workspace or create the key from inside a workspace
instead:

```ts
createAnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  workspaceId: process.env.ANTHROPIC_WORKSPACE_ID!,
});
```

## Data handling

For each generation there is a single POST to
`https://api.anthropic.com/v1/messages`. You can set `baseUrl` to send this to
another host instead, like a proxy, a gateway or a region-specific endpoint you
have.

What goes in that request is listed in the [`@rudra-js/core` README](https://github.com/clivedsouza1010/rudra-js/tree/main/packages/core#what-the-model-sees),
under **What the model sees**. You will need to read this before you send real
shopper traffic.

By default, shoppers who look alike share a single generated block, but each
shopper's products are filled in per request. This is cohort mode. In
per-shopper mode a block is generated for each shopper. Neither mode sends
`user.id`.

Even a cohort-mode request can be personal data. It carries:

- the name of the category that shopper leans towards most
- whether they have any history
- any `segment` you gave them, as you wrote it
- the candidate products (you may have picked or ordered these just for them)

A per-shopper request also carries:

- which product the shopper is looking at
- their current and recent searches
- whether they're returning
- their likes, dislikes and purchases
- their basket
- their most-viewed products
- the categories they lean towards
- interaction counts

If your shop is in the EU or the UK or sells to shoppers there, you are the
sender of personal data. You need a data processing agreement (DPA) with whoever
receives this data. You will also need a transfer mechanism if the receiver is
outside the EU or the UK. This is true even if your shop is outside the EU and
the UK.

For calls to Anthropic with a key from your own Anthropic account, the receiver
is Anthropic. Its data processing addendum is part of its Commercial Terms. This
addendum makes Anthropic your processor and includes the transfer clauses. Your
shop is Anthropic's customer. This doesn't change if a proxy you run yourself
forwards to Anthropic.

If `baseUrl` points at a gateway or platform run by someone other than you or
Anthropic, its operator will see all requests and your `apiKey`. If that key is
from your own Anthropic account, Anthropic will still be your processor. You
will also need a DPA with the operator, because the operator is a second
processor. If the platform issued the key, Anthropic says the platform's terms
govern this use. In this case you're the platform's customer. It is the
platform's DPA that covers you.

This package is a piece of code in the middle. It _isn't_ a party to anything.

When the API answers with an error, the adapter will throw an `Error` with the
status code and Anthropic's error category, like
`anthropic responded 400 (invalid_request_error)`. It leaves out Anthropic's
error message, because that message quotes back a request that can hold a
shopper's search terms. If the adapter kept the message, those terms would be
written to a log by a `console.error(error)` in your app. There is a test for
this in `anthropic-provider.test.ts`. It puts a search term in the message to
check that the term doesn't reach the thrown error.

## Licence

[MIT](./LICENSE)
