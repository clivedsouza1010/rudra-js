# bench

One cold pass of 500 seeded shoppers, ten to a page, through each generation mode, with what each
one costs. It's a measurement of the framework, not of a model. Nothing here makes a billed call.

## The arms

- `b deterministic` — no provider at all. Every view is the deterministic fallback component, and if
  a model gets called even once, the arm fails.
- `c cohort` — a stub provider in `cohort` mode with a memory cache. Shoppers on the same page in
  the same segment share one generation, so this is the arm the cache hit rate comes from.
- `d per-shopper` — the same stub in `per-shopper` mode. One generation per shopper, so there's
  almost nothing left to share.

## Running it

```sh
ANTHROPIC_API_KEY= RUDRA_REPLAY_ONLY=1 npm run bench
```

Each arm gets its own process. You'll see the table on the console, and the same numbers land in
`bench/results/<timestamp>.json` along with the prices charged and every caveat. That directory is
gitignored.

## The columns

- **Mode** — what answered the arm: `stub`, `replay` or `live`. If an arm's provider doesn't match
  its label, the run refuses to publish it.
- **Views**, **Model calls** — shoppers served, and how many of them reached the provider.
- **LLM/Cache/Fallback** — where each view's component came from.
- **Cache hits** — the share of views served from the cache. Remember it's one cold pass at ten
  views per page. More views per page would push it up, more pages would push it down.
- **Cost / 1k views (ceiling)** — a cold-call ceiling. At bench start the token counts are read from
  the one committed transcript in `examples/shop/recordings/`, and the cached prefix that call read
  back is billed here as written. A real run writes that prefix once and reads it back cheaper, so
  this is close to twice a steady-state cost. Read it as a ceiling, _not_ as what a run would cost
  you.
- **CPU ms** — user plus system time for the arm's own process: parse, digest, select, reconcile and
  render. No model call is in it.
- **Median, p95, p99** — `n/a` for a stub run. The stub answers far below the millisecond
  `Date.now()` can see, so a median would just be a 0 or a 1 written down as a result.
