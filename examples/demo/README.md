# The demo

This is a small Next.js site that tries out rudra-js on a realistic product page. Larchmere
Outfitters is a made-up outdoor store. Its product page has a gallery, a buy box, details, specs and
reviews, and four recommendation sections that rudra-js fills on the server, in the same HTML
response. Nothing is fetched after the page loads.

In each section the model chooses the layout, the order of the blocks, the emphasis and the
wording. Core picks the products in a grid or carousel, their order and the line under each. Every
product fact comes from the demo's own catalog: title, price, image. The brand, specs, colors and
reviews on the page are made up per product in `src/fixtures/product-details.ts`. They never reach
the model.

We use fixed seeds for the catalog, the bundles and the shoppers. That way all clones will see the
same demo. We save the model's answers as transcripts under `recordings/` and commit them. This
means that a clone with no API key still exercises generation. It will be deterministic and free.
If there is no transcript for a prompt, it will degrade the way any model failure does and fall
back to core's own picks. You still get a page.

## The four sections

Each section is its own slot, with its own candidates, so each one gets its own prompt and its own
transcript.

| Section               | Slot                    | Candidates                                                        | Items |
| --------------------- | ----------------------- | ----------------------------------------------------------------- | ----- |
| Discover more options | `recommendations`       | In stock, in the same category                                    | 4     |
| Compare similar items | `compare-similar-items` | The same category, nearest in price                               | 4     |
| More to consider      | `more-to-consider`      | Related categories, such as tents and headlamps next to backpacks | 8     |
| Customers also viewed | `customers-also-viewed` | What other shoppers who browsed this category viewed              | 8     |

"Compare similar items" swaps the grid and carousel renderers for a comparison table with
`extendRegistry` (see `src/components/compare-table.tsx`). The other three use the package's own
renderers, styled by `public/demo-styles.css`. A note under each heading says whether the model laid
it out or core picked the products without one.

The demo bar at the top lets you switch shoppers to see the sections change, and its link turns off
`public/demo-styles.css`. That stylesheet was written against the class table in the
`@rudra-js/react` README, and there is no CSS in the package. With it off you see the markup the
package emits inside an otherwise styled page. `?styles=off` on any product URL does the same.

## Recording the three new sections

Only `recommendations` has a transcript today, for RJ-00001 and shopper S-0001. The other three
sections show core's own picks until you record them. To record them for that page, run record mode
once and visit it:

```sh
RUDRA_DEMO_MODE=record npm run dev --workspace @rudra-js/example-demo
# then visit http://localhost:3000/product/RJ-00001?shopper=S-0001
```

That bills three model calls and writes three new files under `recordings/`. The existing
`recommendations` transcript is replayed, not billed again. Commit the three files. Then add the
three slots to the check in `replay-miss.test.ts`, so a prompt change that orphans one of them
fails the test too.

## Running it

```sh
npm run dev --workspace @rudra-js/example-demo
# then visit http://localhost:3000/product/RJ-00001?shopper=S-0001
```

That's replay mode, the default. It bills nothing, whatever keys you have in your environment.

To call the model:

```sh
RUDRA_DEMO_MODE=record npm run dev --workspace @rudra-js/example-demo
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

Next will load `examples/demo/.env.local` by itself. That way a key in that file will be picked up
without you exporting it. To create this file, just copy `.env.example` to `.env.local`.
`.env.local` is gitignored; `.env.example` isn't.

## Environment

| Variable                 | What it does                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`      | The key record mode calls the model with. Record mode won't start without one; replay mode ignores it.                           |
| `ANTHROPIC_WORKSPACE_ID` | Sent as the workspace header. An identity-linked key belongs to a person across several workspaces, and is rejected without it.  |
| `RUDRA_DEMO_MODE`        | `replay` (the default when unset) or `record`. Any other value and the demo won't start.                                         |
| `RUDRA_REPLAY_ONLY`      | A hard stop on spending: the demo won't start if a key is set or the mode is `record`. The test run and the crawler both set it. |
| `RUDRA_DEMO_RECORDINGS`  | Where transcripts live. Defaults to `recordings/` under the working directory; the test run points it at this folder.            |

## Re-recording a transcript

All transcript filenames are hashes of the model id and both halves of the prompt. Editing
`SYSTEM_PROMPT` in `packages/core/src/model-prompt.ts`, or anything every section shares (the
catalog, the shoppers, `buildSlotInput`), orphans every transcript at once. A change to one
section's builder, such as its candidates, orphans only that section's transcript.
`replay-miss.test.ts` will fail if a section it checks has no transcript. It names the path of each
section that missed. A section that still replays prints nothing.

1. Find the hashes: run `npx vitest run 'examples/demo/src/app/product/[sku]/replay-miss.test.ts'`.
   It will fail with a `no recording for this request at <path>` line for each section that has no
   transcript. Those file names are your new hashes. If every section printed a path, every other
   file in `recordings/` is an orphan. If only some did, the rest still replay, so delete only the
   old file of each section that printed one. `grep -lF 'slot \"more-to-consider\"' examples/demo/recordings/*.json` finds a
   section's file. Delete it with `rm examples/demo/recordings/<old hash>.json`.
2. Run just that page in record mode: `RUDRA_DEMO_MODE=record npm run dev --workspace @rudra-js/example-demo`, then visit it.
3. Check that `git status --short examples/demo/recordings/` shows each orphan from step 1
   deleted, and one new file for each `no recording` path step 1 printed, with the same names.
4. Run `npm test`. `replay-miss.test.ts` will check just the RJ-00001 / S-0001 page.
5. Commit the new files and the deletions.

You will find the whole prompt in a transcript: the system half, the user half and the model's
answer. This is plain JSON that will be committed to the repository. That's why you need to record
against demo shoppers and demo catalogs only. Don't record real traffic. Don't record in
`per-shopper` mode either, because this mode puts a real person's likes, basket, views and searches
into the prompt. All of this will end up in a file you then commit.
