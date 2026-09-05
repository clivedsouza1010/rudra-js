import type { ArmResult, TokenPrices } from './measure-arm.js';

/**
 * What the run writes to disk.
 *
 * The file outlives the console, and it is what somebody reads when they write
 * the numbers up. So it carries the setting as well as the numbers: when it
 * was made, what prices were charged, how many shoppers, how many to a page,
 * and every caveat the console prints. A bare list of numbers reads like a
 * measurement of a real model, which is exactly the mistake this branch is
 * here to stop repeating.
 */
export interface BenchReport {
  generatedAt: string;
  prices: TokenPrices;
  population: number;
  shoppersPerPage: number;
  caveats: string[];
  arms: readonly ArmResult[];
}

export interface ReportInput {
  arms: readonly ArmResult[];
  prices: TokenPrices;
  population: number;
  shoppersPerPage: number;
  /** Passed in rather than read off the clock, so a test can pin it. */
  generatedAt: string;
}

/**
 * The lines that have to travel with the numbers.
 *
 * Which ones apply depends on what answered the arms: under a stub the
 * timings, the tokens and the violation counts all say more about the harness
 * than about a model, and under a live run those same lines would be false.
 */
export function buildCaveats(arms: readonly ArmResult[], shoppersPerPage: number): string[] {
  let anyStub = false;
  for (const arm of arms) {
    if (arm.mode === 'stub') anyStub = true;
  }

  const caveats: string[] = [];
  if (anyStub) {
    caveats.push(
      'No timings are reported for a stub run. The stub answers far below the millisecond Date.now() can see, so a median would be a 0 or a 1 written down as a result.',
    );

    let anyCpu = false;
    for (const arm of arms) {
      if (arm.cpuUserMs !== undefined) anyCpu = true;
    }
    if (anyCpu) {
      caveats.push(
        'CPU is one process per arm, and it is the framework doing parse, digest, select, reconcile and render. No model call is in it, and under the stub no network wait is either.',
      );
    }
    caveats.push(
      'Input/output tokens and cost are one real recorded call, replayed for every model call — not what the model actually said each time. That call was a cold one, so every call here is billed for writing the cached prefix. A real run writes the prefix once and reads it back at a tenth of the price, which makes this cost close to twice a steady-state run rather than a small overstatement. Read the column as a ceiling, not as what the model would cost.',
    );
  }

  caveats.push(
    `Cache hit rate is set by this fixture: ${shoppersPerPage} shoppers to a page and four shopper segments. It is also one cold pass with exactly ${shoppersPerPage} views per page, so the rate is what a single cold window produces and not a steady state — in production a page is viewed far more than ${shoppersPerPage} times before the cache entry expires and the rate goes up, while spreading the same shoppers over more pages pushes it down.`,
  );

  if (anyStub) {
    caveats.push(
      "Violation counts below are zero and there is no violation the stub can produce. In cohort mode every grid item is replaced by the shopper's own products, and in per-shopper mode the stub echoes SKUs straight out of the prompt. The count means something only under a replay or a live run.",
    );
  }

  return caveats;
}

export function buildReport(input: ReportInput): BenchReport {
  return {
    generatedAt: input.generatedAt,
    prices: input.prices,
    population: input.population,
    shoppersPerPage: input.shoppersPerPage,
    caveats: buildCaveats(input.arms, input.shoppersPerPage),
    arms: input.arms,
  };
}

export function formatTable(results: readonly ArmResult[]): string {
  const lines: string[] = [];
  lines.push(
    '| Arm | Mode | Views | Model calls | LLM/Cache/Fallback | Cache hits | Cost / 1k views (ceiling) | CPU ms (user+sys) | Median ms | p95 | p99 |',
  );
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const result of results) {
    const hits = `${(result.cacheHitRate * 100).toFixed(1)}%`;
    const cost = `$${result.costPerThousandViews.toFixed(2)}`;
    const mix = `${result.sources.llm}/${result.sources.cache}/${result.sources.fallback}`;
    // A stub run has no timings, and 'n/a' is the honest column for it.
    const timings = result.elapsedMs;
    const median = timings === undefined ? 'n/a' : String(timings.median);
    const p95 = timings === undefined ? 'n/a' : String(timings.p95);
    const p99 = timings === undefined ? 'n/a' : String(timings.p99);
    const cpu =
      result.cpuUserMs === undefined || result.cpuSystemMs === undefined
        ? 'n/a'
        : `${result.cpuUserMs}+${result.cpuSystemMs}`;
    lines.push(
      `| ${result.arm} | ${result.mode} | ${result.views} | ${result.modelCalls} | ${mix} | ${hits} | ${cost} | ` +
        `${cpu} | ${median} | ${p95} | ${p99} |`,
    );
  }
  return lines.join('\n');
}
