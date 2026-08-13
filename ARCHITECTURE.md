# Architecture

How this codebase maps onto *AI-Driven Server Side Rendering of Web Components Using Real-Time Data*.

## Building blocks (§III.A)

| Paper | Implementation | Notes |
| --- | --- | --- |
| **Web Client** | Any browser | The SSR arm needs no JavaScript to display the generated component. |
| **Web Server** | `examples/next-store` (Next.js 15, App Router) | `/product/[sku]` is the AI-SSR arm; `/product-csr/[sku]` is the client-rendered control. |
| **BackEnd Layer** | `@rudra/core` | Validates the payload, builds the prompt, calls the model under a budget, reconciles the result, caches it. |
| **Tracking Layer** | *Host-owned* | Deliberately out of scope — see below. |
| **LLM Component** | `@rudra/provider-anthropic`, `@rudra/provider-openai` | Behind a `ComponentProvider` port so core carries no vendor SDK. |
| *(added)* **Rendering Layer** | `@rudra/react` | A registry of React Server Components. Implicit in the paper; explicit here because it is what makes generated output safe to embed. |

### Departure: the Tracking Layer is not built

The paper describes the Tracking Layer as ingesting, cleaning and storing interaction data in a
low-latency store. rudra-js does not implement it. Retailers already run this — an event stream, a
CDP, a warehouse — and a framework that shipped its own would be one more thing to migrate off.

What rudra-js defines instead is the **contract at the boundary**: one validated JSON object per
render (`packages/core/src/tracking-input.ts`) carrying likes, dislikes, most-viewed items, last
purchases, cart, searches, and an open-vocabulary `interactions` array for everything else. The
framework stores nothing between calls.

The companion paper's event-driven pipeline (Kafka + Avro + Elasticsearch) sits upstream of this
boundary and produces the payload. Nothing here presumes it — a warehouse query works equally well.

### Departure: a UI spec, not generated markup

§III.A.5 has the LLM "output the desired UI component code directly", returned "as a string, ready
to be embedded". This implementation constrains the model to a JSON schema instead. The reasoning
is in the README under *Why a spec instead of generated markup*; the short version is that once
model output is on the critical rendering path, "cannot inject markup" and "cannot invent a product"
have to be structural guarantees rather than prompt instructions.

The model still designs the component: layout, block ordering, emphasis, headline and per-product
copy, tone, and which SKUs to surface from the candidate set.

## Request flow (§III.B)

```
   Web Client
       │  1. GET /product/TR-104
       ▼
   Web Server ── Next.js server render begins
       │  2. host assembles the tracking payload (its own data, its own rules)
       ▼
   BackEnd Layer (@rudra/core)
       │  3. parseTrackingInput   — reject malformed payloads loudly
       │  4. buildDigest          — bound and order the signals
       │  5. cacheKey + lookup    — hit? return, no model call
       │  6. buildPrompt          — stable system prefix / volatile user turn
       ▼
   LLM Component ── single-flight, AbortController, raced against timeoutMs
       │  7. structured output → GeneratedSpec
       ▼
   BackEnd Layer
       │  8. reconcileSpec        — SKU allowlist, dislikes, dedupe, budget, clamps
       │     └─ unusable / timeout / error → buildFallbackSpec (pure, cannot fail)
       ▼
   Rendering Layer (@rudra/react)
       │  9. spec → React Server Components → HTML
       ▼
   Web Server ── complete personalised HTML in the initial response
```

Steps 3–8 have no I/O other than the single model call, and that call is bounded. The worst case is
a fallback render at roughly the cost of the deterministic scorer.

## Where each risk in §VI.A is handled

| Paper's stated challenge | Mechanism |
| --- | --- |
| "Any significant delay in the recommendation engine or data fetching will block the page rendering" | `timeoutMs` + `AbortController`, raced rather than trusted; `buildFallbackSpec` is pure and synchronous |
| "Moving rendering logic to the server increases the computational load" | Generation cache keyed on output-affecting fields only, with logarithmically bucketed view counts; single-flight collapses concurrent cold-key requests |
| "Basic interactivity is present" (vs CSR's high interactivity) | The registry is host-owned — swap any block renderer for an interactive client component without changing the spec contract |

## Evaluation (§V)

`bench/ttfb.mjs` and `bench/fcp.mjs` produce the table §V is currently a placeholder for: TTFB,
FCP, LCP, time-to-recommendation, transfer size, and a direct check of whether the recommendation
markup exists in the server response at all. Both arms run the *same* generator over the *same*
payload, so the only variable is where and when the component is produced.

Three controls worth using when generating publication numbers:

- `RUDRA_PROVIDER=none` isolates framework overhead from model latency.
- `createNoopCache()` measures uncached generation rather than steady-state.
- `--throttle fast-3g|slow-3g` matters: on a fast local connection the extra client round trip costs
  almost nothing, which flatters CSR in a way real traffic does not.

Server CPU load, which §V also asks for, is not instrumented here.
