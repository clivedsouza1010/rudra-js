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

export function buildCaveats(shoppersPerPage: number): string[] {
  return [
    'Median ms, p95 and p99 come from the stub, not from a real model call.',
    'Input/output tokens and cost are one real recorded call, replayed for every model call — not what the model actually said each time.',
    `Cache hit rate is set by this fixture: ${shoppersPerPage} shoppers to a page and four shopper segments. A different population or segment count moves it.`,
  ];
}

export function buildReport(input: ReportInput): BenchReport {
  return {
    generatedAt: input.generatedAt,
    prices: input.prices,
    population: input.population,
    shoppersPerPage: input.shoppersPerPage,
    caveats: buildCaveats(input.shoppersPerPage),
    arms: input.arms,
  };
}

export function formatTable(results: readonly ArmResult[]): string {
  const lines: string[] = [];
  lines.push(
    '| Arm | Mode | Views | Model calls | LLM/Cache/Fallback | Cache hits | Cost / 1k views | Median ms | p95 | p99 |',
  );
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const result of results) {
    const hits = `${(result.cacheHitRate * 100).toFixed(1)}%`;
    const cost = `$${result.costPerThousandViews.toFixed(2)}`;
    const mix = `${result.sources.llm}/${result.sources.cache}/${result.sources.fallback}`;
    lines.push(
      `| ${result.arm} | ${result.mode} | ${result.views} | ${result.modelCalls} | ${mix} | ${hits} | ${cost} | ` +
        `${result.elapsedMs.median} | ${result.elapsedMs.p95} | ${result.elapsedMs.p99} |`,
    );
  }
  return lines.join('\n');
}
