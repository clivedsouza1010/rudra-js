# bench

One cold pass of 500 seeded shoppers, ten to a page, through each generation mode, reporting what
each one costs. It measures the framework, not a model: nothing here makes a billed call.

## The arms

- `b deterministic` — no provider. Every view is the deterministic fallback component, and the arm
  fails if a model was called at all.
- `c cohort` — a stub provider in `cohort` mode with a memory cache. Shoppers on the same page in
  the same segment share one generation, so this arm is where the cache hit rate comes from.
- `d per-shopper` — the same stub in `per-shopper` mode. One generation per shopper, so almost
  nothing is shared.

## Running it

```sh
ANTHROPIC_API_KEY= RUDRA_REPLAY_ONLY=1 npm run bench
```

Each arm runs in its own process. The table prints to the console, and the same numbers, with the
prices charged and every caveat, go to `bench/results/<timestamp>.json`, which is gitignored.

## The columns

- **Mode** — what answered the arm: `stub`, `replay` or `live`. The run refuses to publish an arm
  whose provider does not match its label.
- **Views**, **Model calls** — shoppers served, and how many of them reached the provider.
- **LLM/Cache/Fallback** — where each view's component came from.
- **Cache hits** — the share of views served from the cache. It is one cold pass at ten views per
  page: more views per page would push it up, more pages would push it down.
- **Cost / 1k views (ceiling)** — a cold-call ceiling. At bench start the token counts are read
  from the one committed transcript in `examples/shop/recordings/`, and the cached prefix that call
  read back is billed as written. A real run writes the prefix once and reads it back cheaper, so
  this is close to twice a steady-state cost.
- **CPU ms** — user plus system time for the arm's own process: parse, digest, select, reconcile
  and render, with no model call in it.
- **Median, p95, p99** — `n/a` for a stub run. The stub answers far below the millisecond
  `Date.now()` can see, so a median would be a 0 or a 1 written down as a result.
