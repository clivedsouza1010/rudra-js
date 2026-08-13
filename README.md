# rudra-js

A framework of server side components built dynamically and rendered in real time.

rudra-js takes a JSON payload describing what a shopper has done — likes, dislikes, most-viewed
items, last purchases, and any other site interaction — asks an LLM to design a UI component for
that specific shopper, and server-renders the result into the initial HTML response.

It is the reference implementation of the architecture in *AI-Driven Server Side Rendering of Web
Components Using Real-Time Data*. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the mapping between
the paper's building blocks and this codebase.

---

## The idea in one paragraph

Personalised recommendations are normally rendered on the client: the page arrives with a
placeholder, JavaScript hydrates, a request goes out to a personalisation service, and the content
pops in. rudra-js moves that decision to the server and into the render itself. The LLM does not
return markup — it returns a **validated JSON specification** naming a layout, an ordering, some
copy, and a set of SKUs drawn from a candidate list you supply. A registry of React Server
Components renders that specification. The component is therefore present in the first byte of HTML,
costs zero client JavaScript, and is visible to crawlers — while the model still has real latitude
over what the shopper sees.

## What it does not do

It does not collect, store, or aggregate tracking data. There is no ingest endpoint, no event
store, no profile service. You already have a tracking pipeline; rudra-js consumes one JSON object
per render and holds nothing.

---

## Quick start

```bash
npm install
npm run build          # build the four framework packages
npm run dev            # storefront on http://localhost:3000
```

With no API key configured the framework runs **fallback-only**: a deterministic, signals-driven
component. That is a supported production mode, not a stub. To enable generation:

```bash
cp .env.example examples/next-store/.env.local
# set RUDRA_PROVIDER=anthropic and ANTHROPIC_API_KEY=...
#  or RUDRA_PROVIDER=openai    and OPENAI_API_KEY=...
```

Then open `/product/TR-104` and its client-rendered twin at `/product-csr/TR-104`. The shopper
switcher at the top of each page swaps between three sample tracking payloads.

---

## The tracking input contract

This is the whole API surface between your system and the framework.

```ts
import { createGenerator } from '@rudra/core';
import { createAnthropicProvider } from '@rudra/provider-anthropic';

const generator = createGenerator({
  provider: createAnthropicProvider(),
  timeoutMs: 1200,
});

const spec = await generator.generate({
  user: { id: 'u-1042', segment: 'endurance', isReturning: true },

  context: {
    surface: 'pdp',
    slot: 'pdp-recommendations',
    currentSku: 'TR-104',
    currentCategory: 'Trail Running',
    maxItems: 4,
  },

  signals: {
    likes:         [{ sku: 'TR-102', at: 1755000000000 }],
    dislikes:      [{ sku: 'OW-303' }],
    mostViewed:    [{ sku: 'TR-104', views: 7, dwellMs: 96_000 }],
    lastPurchased: [{ sku: 'TR-101', at: 1752600000000, quantity: 1, price: 139 }],
    cart:          [{ sku: 'CP-401' }],
    recentSearches: ['hydration vest'],
    // Open vocabulary — whatever your pipeline already emits.
    interactions: [
      { type: 'size_guide_opened', sku: 'TR-104' },
      { type: 'scroll_depth', sku: 'TR-104', value: 0.92 },
    ],
  },

  // The only products the model may place. Merchandising rules belong here.
  candidates: [{ sku: 'TR-102', title: 'Switchback Trail Shoe GTX', category: 'Trail Running',
                 price: 174, currency: 'USD', inStock: true, tags: ['trail', 'waterproof'] }],
});
```

Only `user.id`, `context.surface` and a non-empty `candidates` array are required; every signal
category defaults to empty, which is the cold-start case rather than an error. A full example
payload is in [`docs/sample-tracking-input.json`](./docs/sample-tracking-input.json).

Rendering it:

```tsx
import { RudraComponent } from '@rudra/react';

<RudraComponent spec={spec} products={CATALOG} />
```

`generate()` never rejects for a model-side reason. The only way it throws is a malformed payload,
which is a caller bug and is meant to be loud.

---

## Why a spec instead of generated markup

The manuscript describes the LLM returning UI code as a string for embedding. That works, but it
puts model output directly into the HTML response. This implementation constrains the model to a
schema instead, which buys four properties that matter once the component is on the critical path:

| Property | How |
| --- | --- |
| Cannot inject markup | The model emits no HTML, URLs, or code — only enums, SKU references, and text that is length-clamped and escaped at render time |
| Cannot invent products | Every SKU is checked against the candidate set you supplied; unknown, out-of-stock and disliked SKUs are dropped in reconciliation |
| Cannot misstate facts | Titles, prices, images and links are resolved from your catalog at render time, never from the model |
| Degrades predictably | A generation that survives schema validation but produces nothing renderable is discarded in favour of the fallback |

Reconciliation (`packages/core/src/reconcile.ts`) is the boundary. Schema validation guarantees
shape; reconciliation guarantees truth.

## Latency model

Generation sits on the render path, which the manuscript correctly identifies as the central risk.
Four mechanisms bound it:

- **Hard wall-clock budget** (`timeoutMs`, default 1200ms). On expiry the in-flight request is
  aborted and the deterministic fallback renders. The generator races the budget rather than
  trusting the adapter to honour cancellation.
- **Deterministic fallback** — pure, synchronous, cannot fail. It reads the same signal digest the
  model reads, so a degraded render is a weaker version of the same decision, not an unrelated one.
- **Generation cache**, keyed on everything that can change the output and nothing else. View counts
  are bucketed logarithmically so a single extra page view does not evict the entry.
- **Single-flight de-duplication**, so a cold key under concurrency collapses into one model call
  instead of a stampede.

Every rendered component carries its own provenance as data attributes —
`data-rudra-source` (`llm` / `cache` / `fallback`), `data-rudra-latency-ms`, `data-rudra-degraded` —
so hit rate and degradation are observable from the page itself.

---

## Providers

Core has no vendor SDK. Adapters are separate packages, so a host installs exactly one.

```ts
createAnthropicProvider({ model: 'claude-opus-5' })  // structured outputs + prompt caching
createOpenAIProvider({ model: 'gpt-4.1' })           // strict JSON-schema structured outputs
```

Both are held to the same schema and receive an identical prompt, which is what makes a
cross-provider comparison meaningful. Implement `ComponentProvider` for anything else.

The prompt is deliberately split on the cache boundary: the system prompt is byte-stable per
deployment and marked as a cache breakpoint, and everything per-shopper lives in the user turn.
Interpolating the SKU or user id into the system prompt would silently destroy that.

---

## Benchmarks

```bash
npm run dev
node bench/ttfb.mjs --sku TR-104 --n 25              # TTFB, transfer size, server-payload check
node bench/fcp.mjs --sku TR-104 --throttle fast-3g   # FCP, LCP, time-to-recommendation
```

`bench/ttfb.mjs` needs no dependencies. `bench/fcp.mjs` needs Playwright
(`npm install --workspace @rudra/bench && npx playwright install chromium`).

Measured on this repo, Next.js 15 production build, localhost, fast-3G emulation, **fallback-only
mode** — that is, with model latency at zero, isolating the rendering strategy:

| Arm | TTFB p50 | FCP p50 | LCP p50 | Recommendations visible | Recs in server HTML | Route JS |
| --- | --- | --- | --- | --- | --- | --- |
| AI-driven SSR | 8.4ms | 208ms | **224ms** | **222ms** | **yes** | 133 B |
| Client-side rendering | 5.5ms | 200ms | 1104ms | 1499ms | no | 3.12 kB |

Read this honestly:

- **TTFB is worse for SSR**, and will get worse with a live model, bounded by `timeoutMs`. Moving
  work to the server is not free.
- **FCP is a tie**, because the product detail is server-rendered in both arms. Only the
  recommendation region differs.
- **LCP and time-to-recommendation are where the difference lives** — 4.9× and 6.7× here. That gap
  is the "pop-in" the manuscript describes, and it widens on slower networks and devices.
- **The SEO claim is settled by the content check, not by timing.** The SSR arm's response contains
  the recommendation markup; the CSR arm's contains none of it. A crawler that does not execute
  JavaScript sees exactly that.

Re-run with a provider configured to get the numbers that belong in a paper; the fallback-only
figures are the floor, not the result.

---

## Packages

| Package | Role |
| --- | --- |
| `@rudra/core` | Input contract, spec contract, prompt construction, digest, reconciliation, cache, fallback, generator. No React, no vendor SDK. |
| `@rudra/provider-anthropic` | Claude adapter — structured outputs, prompt caching, refusal handling. |
| `@rudra/provider-openai` | OpenAI adapter — strict JSON-schema structured outputs. |
| `@rudra/react` | RSC registry and renderer. No client JavaScript. |
| `examples/next-store` | Next.js storefront: SSR arm, CSR control arm, seeded catalog, sample payloads. |
| `bench` | TTFB / FCP / LCP / time-to-recommendation harness. |

## Customising the rendered output

The registry maps spec block kinds to components. Swap any of them for your own design system
without touching the model or the spec contract:

```tsx
import { extendRegistry, RudraComponent } from '@rudra/react';

const registry = extendRegistry({
  grid: ({ block, ctx }) => <MyProductGrid items={block.items} ctx={ctx} />,
});

<RudraComponent spec={spec} products={CATALOG} registry={registry} />
```

To change what the model may produce at all, edit the block vocabulary in
`packages/core/src/spec.ts` and the corresponding section of the system prompt in
`packages/core/src/prompt.ts`. They are the two halves of one contract.

## Status

Early. The spec and input contracts are versioned (`specVersion`, `schemaVersion`) but not yet
stable. The generation cache is in-process — implement `SpecCache` over Redis for a multi-instance
deployment. Server CPU load is not instrumented.

`npm run smoke` runs the documented sample payload through the real generator and asserts the
reconciliation guarantees above; it needs no API key and no network. It is the only test so far.

## Licence

MIT © Clive Dsouza
