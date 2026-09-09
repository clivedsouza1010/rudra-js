# The example shop

A small Next.js storefront that puts the architecture through a real page. The product page asks a
language model for a recommendation component and server-renders the answer into the same HTML
response, rather than fetching it after the page loads. The model chooses layout, ordering, emphasis
and wording; every product fact on the page — title, price, image — comes from the shop's own
catalog.

The catalog, the bundles and the shoppers are generated from fixed seeds, so every clone sees the
same shop. Model answers are saved as transcripts under `recordings/` and committed, so a clone with
no API key still exercises generation, deterministically and for free. A page with no transcript
degrades the way any model failure does, to a deterministic fallback component, so it still renders.

The stylesheet is the example's own, written against the class table in the `@rudra-js/react`
README. The package ships no CSS. Add `?styles=off` to any product URL to see the markup it emits
unstyled.

## Running it

```sh
npm run dev --workspace @rudra-js/example-shop
# then visit http://localhost:3000/product/RJ-00001?shopper=S-0001
```

That is replay mode, the default. It bills nothing, whatever keys are in your environment.

To call the model:

```sh
RUDRA_SHOP_MODE=record npm run dev --workspace @rudra-js/example-shop
```

This bills one call per uncached page and writes a transcript for it. A page that already has a
transcript is replayed rather than called again, so browsing costs nothing after the first time. To
replace a transcript, delete the file — see below.

Expect the first render of a page in record mode to be slow. The shop gives the model 60 seconds
rather than core's 1.5-second default, because this model reasons before it answers and a spec does
not come back inside a second and a half — and a transcript is only written once the call returns,
so that default would mean no recording could ever be made. Nothing after that first render waits.

Next loads `examples/shop/.env.local` by itself, so a key sitting in that file is picked up without
being exported. Copy `.env.example` to `.env.local` to start one. `.env.local` is gitignored;
`.env.example` is not.

## Environment

| Variable                 | What it does                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`      | The key record mode calls the model with. Record mode refuses to start without one; replay mode ignores it.                      |
| `ANTHROPIC_WORKSPACE_ID` | Sent as the workspace header. An identity-linked key belongs to a person across several workspaces and is rejected without this. |
| `RUDRA_SHOP_MODE`        | `replay` (the default when unset) or `record`. Any other value refuses to start.                                                 |
| `RUDRA_REPLAY_ONLY`      | A hard stop on spending: the shop refuses to start if a key is set or the mode is `record`. The test run and the crawler set it. |
| `RUDRA_SHOP_RECORDINGS`  | Where transcripts live. Defaults to `recordings/` under the working directory; the test run points it at this folder.            |
| `CI`                     | When set, a replay miss throws instead of degrading, so a CI run cannot quietly measure the fallback component.                  |

## Re-recording a transcript

A transcript's filename is a hash of the model id and both halves of the prompt, so editing the
prompt orphans every transcript at once — `SYSTEM_PROMPT` in `packages/core/src/model-prompt.ts`, or
anything that changes the user half. `replay-miss.test.ts` fails when the page it guards has no
transcript, and names the path it looked for.

1. Delete the old file: `rm examples/shop/recordings/<hash>.json`.
2. Run that one page in record mode: `RUDRA_SHOP_MODE=record npm run dev --workspace @rudra-js/example-shop`, then visit it.
3. Confirm exactly one new file appeared: `git status --short examples/shop/recordings/`.
4. Run `npm test`. `replay-miss.test.ts` is the check that the page is served from the new file.
5. Commit the file.

A transcript is the whole prompt: the system half, the user half and the model's answer, in plain
JSON, committed to the repository. So record against demo shoppers and demo catalogs only. Do not
record real traffic, and do not record in `per-shopper` mode — that mode puts a real person's likes,
basket, views and searches into the prompt, and all of it lands in a file you then commit.
