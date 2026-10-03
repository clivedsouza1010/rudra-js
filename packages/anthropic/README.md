# @rudra-js/anthropic

An Anthropic adapter for
[`@rudra-js/core`](https://github.com/clivedsouza1010/rudra-js/tree/main/packages/core)'s
`ComponentProvider`.

This adapter is documented at [rudrajs.com](https://rudrajs.com/docs#createAnthropicProvider).

> Anthropic and Claude are trademarks of Anthropic, PBC. This package is an
> independent adapter and is not affiliated with or endorsed by Anthropic.

## Install

```sh
npm install @rudra-js/anthropic @rudra-js/core @rudra-js/attested
```

```ts
import { createAnthropicProvider } from '@rudra-js/anthropic';
import { createComponentGenerator } from '@rudra-js/core';

const provider = createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });
const generator = createComponentGenerator({ provider });
```

`model` defaults to `claude-sonnet-5`, and `thinking` defaults to
`{ type: 'disabled' }`.

Both of those come from the same constraint. Generation runs on the request
path, inside `modelTimeoutMs`, which core defaults to 1500ms. A model that
reasons before it answers won't finish in time. Sonnet 5 reasons by default
when `thinking` is left out, so it's the leaving out that would break the
budget, not the choice of model.

Want a different model? Pass `model` to pin one, and raise `modelTimeoutMs` to
match while you're there. A quick heads-up on `thinking`: some models reject an
explicit `{ type: 'disabled' }` and reason whatever you do. Pass
`thinking: null` for those and we'll send no `thinking` field at all. Our
example shop pins `claude-opus-5` and gives `modelTimeoutMs` a full 60 seconds,
which is a demo talking, not a production setting.

The adapter asks the model to answer by calling its tool rather than forcing the
call, because Claude Opus 5.5, Sonnet 5.5, Fable 5.1 and Mythos 5.1 reject a
forced tool call. So a model can answer in plain text instead. That reply is
turned down like any other that doesn't fit, you get the fallback component, and
the event's `error` in `onEvent` says
`anthropic returned no emit_component_spec tool use`. Those four models also
reject `thinking: { type: 'disabled' }`, so pass `thinking: null` with them, and
raise `modelTimeoutMs`, since they'll reason before they answer.

`maxTokens` and `baseUrl` are optional too.

### An identity-linked key needs a workspace

A key you made against your identity rather than inside a workspace belongs to
you across several of them. The API can't tell which one a request is acting in,
so it answers:

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

`fetch` is injectable. That's how our test suite stands in for a network call.

The tool schema we send the model is derived from the `schema` on the
`ProviderRequest`, the same schema `@rudra-js/core` defines. We don't keep a
copy here. A second copy would be a second vocabulary, and then the reconciler
enforces one thing while the model is told another.

## Data handling

Each generation is one POST to `https://api.anthropic.com/v1/messages`. Set
`baseUrl` and it goes to that host instead, whether that's a proxy, a gateway,
or a region-specific endpoint you have.

What's in that request is listed under **What the model sees** in the
[`@rudra-js/core` README](https://github.com/clivedsouza1010/rudra-js/tree/main/packages/core#what-the-model-sees).
Read it before you send real shopper traffic. In cohort mode, the default, the
request carries no individual. In per-shopper mode it carries that shopper's
likes, dislikes, purchases, basket, views and recent searches.

If your shop is in the EU or the UK, you're the one sending personal data to
Anthropic, so you'll need a data processing agreement with them plus a transfer
mechanism for the data leaving your region. Your shop is Anthropic's customer.
This package is a piece of code in the middle, and it _isn't_ a party to
anything.

When the API answers with an error, the `Error` we throw carries the status code
and the vendor's error category, like `anthropic responded 400
(invalid_request_error)`. We leave the vendor's own message out. It quotes the
request back, and for this framework the request can hold a shopper's search
terms, which an adopter's `console.error(error)` would then write to a log. A
test in `anthropic-provider.test.ts` puts a search term in that message and
asserts it does not reach the thrown error.

## Licence

[MIT](./LICENSE)
