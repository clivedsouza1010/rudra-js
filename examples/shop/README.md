# The example shop

A small Next.js storefront that puts the architecture through a real page. The product page asks a
language model for a recommendation component and server-renders the answer into the same HTML
response, rather than fetching it after the page loads. The model chooses the layout, the ordering,
the emphasis and the wording. Every product fact on the page comes from the shop's own catalog:
title, price, image.

The catalog, the bundles and the shoppers all come from fixed seeds, so every clone sees the same
shop. We save the model's answers as transcripts under `recordings/` and commit them, so a clone
with no API key still exercises generation, deterministically and for free. If a page has no
transcript it degrades the way any model failure does, to a deterministic fallback component. You
still get a page.

The stylesheet is the example's own, written against the class table in the `@rudra-js/react`
README. The package ships no CSS. Add `?styles=off` to any product URL and you'll see the markup it
emits, unstyled.

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

This bills one call per uncached page and writes a transcript for it. A page that already has a
transcript is replayed instead of called again, so browsing costs nothing after the first time. If
you want to replace a transcript, delete the file first; the runbook below walks you through it.

Expect the first render of a page in record mode to be slow. We give the model 60 seconds instead of
core's 1.5-second default, because this model reasons before it answers and a spec doesn't come back
inside a second and a half. A transcript is only written once the call returns, so with that default
no recording could ever be made. Nothing after that first render waits.

Next loads `examples/shop/.env.local` by itself, so a key sitting in that file gets picked up
without you exporting it. Copy `.env.example` to `.env.local` to start one. `.env.local` is
gitignored; `.env.example` isn't.

## Environment

| Variable                 | What it does                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`      | The key record mode calls the model with. Record mode won't start without one; replay mode ignores it.                           |
| `ANTHROPIC_WORKSPACE_ID` | Sent as the workspace header. An identity-linked key belongs to a person across several workspaces, and is rejected without it.  |
| `RUDRA_SHOP_MODE`        | `replay` (the default when unset) or `record`. Any other value and the shop won't start.                                         |
| `RUDRA_REPLAY_ONLY`      | A hard stop on spending: the shop won't start if a key is set or the mode is `record`. The test run and the crawler both set it. |
| `RUDRA_SHOP_RECORDINGS`  | Where transcripts live. Defaults to `recordings/` under the working directory; the test run points it at this folder.            |

## Re-recording a transcript

A transcript's filename is a hash of the model id and both halves of the prompt. So editing the
prompt orphans every transcript at once. That means `SYSTEM_PROMPT` in
`packages/core/src/model-prompt.ts`, or anything that changes the user half. `replay-miss.test.ts`
fails when the page it guards has no transcript, and it names the path it looked for.

1. Find the hash: run `npm test`. `replay-miss.test.ts` fails and names the path it wanted, and
   that's your new hash. Whatever file is sitting in `recordings/` under another name is the orphan.
   Delete that one: `rm examples/shop/recordings/<old hash>.json`.
2. Run that one page in record mode: `RUDRA_SHOP_MODE=record npm run dev --workspace @rudra-js/example-shop`, then visit it.
3. Confirm `git status --short examples/shop/recordings/` shows one deletion and one new file, and
   that the new name is the hash step 1 named.
4. Run `npm test`. `replay-miss.test.ts` checks the RJ-00001 / S-0001 page, and no others.
5. Commit the file.

A transcript is the whole prompt: the system half, the user half and the model's answer, in plain
JSON, committed to the repository. So record against demo shoppers and demo catalogs only. Don't
record real traffic, and don't record in `per-shopper` mode — that mode puts a real person's likes,
basket, views and searches into the prompt, and all of it lands in a file you then commit.
