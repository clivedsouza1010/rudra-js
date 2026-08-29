# @rudra-js/anthropic

An Anthropic adapter for
[`@rudra-js/core`](https://github.com/clivedsouza1010/rudra-js/tree/main/packages/core)'s
`ComponentProvider`.

No vendor SDK, no dependencies. It speaks the Messages API over `fetch`, which
is what makes its contract obligations testable with no network and no SDK
version to track.

## Install

```sh
npm install @rudra-js/anthropic @rudra-js/core zod
```

Both `@rudra-js/core` and `zod` are peer dependencies: the schema this adapter
sends to the model comes from your copy of core, and it is converted with your
copy of zod.

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

## Licence

[MIT](./LICENSE)
