# bench

This is a single cold pass of 500 seeded shoppers (ten to a page) in each generation mode, with the
cost of each mode. It's a measurement of the framework, not of a model. Nothing here will make a
billed call.

## The arms

- `b deterministic`: no provider at all. All views will be the deterministic fallback component. If
  a model gets called even once, this arm will fail.
- `c cohort`: a stub provider in `cohort` mode with a memory cache. Because shoppers who match on
  page, segment and whether they have any history share a single generation, this is the arm the
  cache hit rate comes from.
- `d per-shopper`: the same stub, but in `per-shopper` mode. With a single generation per shopper,
  there's almost nothing left to share.

An arm may only be answered by the stub or by nothing at all. If a real provider answers, the run
will refuse to publish that arm.

## Running it

```sh
ANTHROPIC_API_KEY= RUDRA_REPLAY_ONLY=1 npm run bench
```

There's a separate process for each arm. You'll see the table on the console. Those numbers will
also be written to `bench/results/<timestamp>.json`, along with the prices charged and all the
caveats. That directory is gitignored.

## The columns

- **Views**, **Model calls**: the number of shoppers served and how many of them reached the
  provider.
- **LLM/Cache/Fallback**: where each view's component came from.
- **Cache hits**: the share of views served from the cache. Remember that it's a single cold pass at
  ten views per page. This number would go up with more views per page and down with more pages.
- **Cost / 1k views (ceiling)**: a cold-call ceiling. At bench start the token counts are read from
  the single committed transcript in `examples/shop/recordings/`. In this bench the cached prefix
  read back by the recorded call is billed as written. But a real run writes this prefix once and
  reads it back for less. This is why the number is close to twice a steady-state cost. Read it as a
  ceiling, _not_ as what a run would cost you.
- **CPU ms**: user plus system time for the arm's process (parse, digest, select, reconcile and
  render). There's no model call in it.

There are no timing columns. Because the stub answers far below the millisecond `Date.now()` can
see, a median would just be a 0 or a 1 written down as a result.
