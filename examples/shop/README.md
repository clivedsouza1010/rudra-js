# The example shop

This is a small Next.js storefront to try out the architecture on a real page. Its product page will
ask a language model for a recommendation component. That answer is then server-rendered into the
same HTML response rather than being fetched after the page loads. It's up to the model to choose
the layout, the order of the blocks, the emphasis and the wording. Core picks the products in a grid
or carousel, their order and the line under each. All of the product facts on the page come from
the shop's own catalog: title, price, image.

We use fixed seeds for the catalog, the bundles and the shoppers. That way all clones will see the
same shop. We save the model's answers as transcripts under `recordings/` and commit them. This
means that a clone with no API key still exercises generation. It will be deterministic and free.
If there is no transcript for a prompt, it will degrade the way any model failure does and fall
back to a deterministic component. You still get a page.

This example's stylesheet was written to match the class table in the `@rudra-js/react` README.
There is no CSS in the package. You can add `?styles=off` to any product URL to see the markup the
package emits, unstyled.

## Running it

```sh
npm run dev --workspace @rudra-js/example-shop
# then visit http://localhost:3000/product/RJ-00001?shopper=S-0001
```

That's replay mode, the default. It bills nothing, whatever keys you have in your environment.

To call the model:

```sh
RUDRA_SHOP_MODE=record npm run dev --workspace @rudra-js/example-shop
```

This will bill one call per prompt with no transcript and write a transcript. If a prompt has a
transcript, it will be replayed for free, even on another page. But a page might need more calls for
different shoppers, because transcripts have to match the model id and prompt. To replace a
transcript, you have to delete the file first (the runbook below walks you through it).

In record mode, expect the first render with a new prompt to be slow. We give the model 60 seconds
instead of core's 1.5-second default, because this model reasons first and then answers. Its specs
don't come back inside a second and a half. You couldn't make any recording with that default,
because a transcript is only written once the call returns. Once a prompt has a transcript there's
no more waiting.

Next will load `examples/shop/.env.local` by itself. That way a key in that file will be picked up
without you exporting it. To create this file, just copy `.env.example` to `.env.local`.
`.env.local` is gitignored; `.env.example` isn't.

## Environment

| Variable                 | What it does                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`      | The key record mode calls the model with. Record mode won't start without one; replay mode ignores it.                           |
| `ANTHROPIC_WORKSPACE_ID` | Sent as the workspace header. An identity-linked key belongs to a person across several workspaces, and is rejected without it.  |
| `RUDRA_SHOP_MODE`        | `replay` (the default when unset) or `record`. Any other value and the shop won't start.                                         |
| `RUDRA_REPLAY_ONLY`      | A hard stop on spending: the shop won't start if a key is set or the mode is `record`. The test run and the crawler both set it. |
| `RUDRA_SHOP_RECORDINGS`  | Where transcripts live. Defaults to `recordings/` under the working directory; the test run points it at this folder.            |

## Re-recording a transcript

All transcript filenames are hashes of the model id and both halves of the prompt. This means that
editing the prompt will orphan all transcripts at once. This applies to `SYSTEM_PROMPT` in
`packages/core/src/model-prompt.ts` and to anything that changes the user half.
`replay-miss.test.ts` will fail if the page it guards has no transcript. It will also name the path
it looked for.

1. Find the hash: run `npm test`. `replay-miss.test.ts` will fail and name the path it wanted.
   That's your new hash. Whatever file is in `recordings/` under another name is the orphan. Delete
   this file: `rm examples/shop/recordings/<old hash>.json`.
2. Run just that page in record mode: `RUDRA_SHOP_MODE=record npm run dev --workspace @rudra-js/example-shop`, then visit it.
3. Check that `git status --short examples/shop/recordings/` shows one deletion and one new file.
   Also check that the new name is the hash from step 1.
4. Run `npm test`. `replay-miss.test.ts` will check just the RJ-00001 / S-0001 page.
5. Commit the file.

You will find the whole prompt in a transcript: the system half, the user half and the model's
answer. This is plain JSON that will be committed to the repository. That's why you need to record
against demo shoppers and demo catalogs only. Don't record real traffic. Don't record in
`per-shopper` mode either, because this mode puts a real person's likes, basket, views and searches
into the prompt. All of this will end up in a file you then commit.
