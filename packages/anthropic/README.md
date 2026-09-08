# @rudra-js/anthropic

An Anthropic adapter for
[`@rudra-js/core`](https://github.com/clivedsouza1010/rudra-js/tree/main/packages/core)'s
`ComponentProvider`.

> Anthropic and Claude are trademarks of Anthropic, PBC. This package is an
> independent adapter and is not affiliated with or endorsed by Anthropic.

## Install

```sh
npm install @rudra-js/anthropic @rudra-js/core zod
```

```ts
import { createAnthropicProvider } from '@rudra-js/anthropic';
import { createComponentGenerator } from '@rudra-js/core';

const provider = createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });
const generator = createComponentGenerator({ provider });
```

`model` defaults to the current Claude model this package was written against;
pass it to pin a different one. `maxTokens` and `baseUrl` are also optional.

### An identity-linked key needs a workspace

A key created against your identity rather than inside a workspace belongs to
you across several of them, so the API cannot infer which one a request acts in
and answers:

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

`fetch` is injectable, which is what the test suite uses in place of a network
call.

The tool schema sent to the model is derived from the `schema` on the
`ProviderRequest` — the same schema `@rudra-js/core` defines — rather than a
copy written out here. A second copy would be a second vocabulary: the
reconciler would enforce one thing and the model would be told another.

## Data handling

Each generation is one POST to `https://api.anthropic.com/v1/messages`. Set
`baseUrl` and it goes to that host instead — a proxy, a gateway, or a
region-specific endpoint you have.

What is in that request is listed under **What the model sees** in the
[`@rudra-js/core` README](https://github.com/clivedsouza1010/rudra-js/tree/main/packages/core#what-the-model-sees).
Read it before you send real shopper traffic. In cohort mode, the default, the
request carries no individual. In per-shopper mode it carries that shopper's
likes, dislikes, purchases, basket, views and recent searches.

If your shop is in the EU or the UK, you are the one sending personal data to
Anthropic, and you need a data processing agreement with them plus a transfer
mechanism for the data leaving your region. Your shop is Anthropic's customer;
this package is a piece of code in the middle and is not a party to anything.

When the API answers with an error, the thrown `Error` carries the status code
and the vendor's error category — `anthropic responded 400
(invalid_request_error)`. The vendor's own message is left out on purpose: it
quotes the request back, and for this framework the request can hold a shopper's
search terms, which an adopter's `console.error(error)` would then write to a
log. A test in `anthropic-provider.test.ts` puts a search term in that message
and asserts it does not reach the thrown error.

## Licence

[MIT](./LICENSE)
