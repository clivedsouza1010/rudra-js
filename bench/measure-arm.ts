import type { GenerationEvent } from '@rudra-js/core';

export interface TokenPrices {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface ArmResult {
  arm: string;
  views: number;
  sources: { llm: number; cache: number; fallback: number };
  cacheHitRate: number;
  modelCalls: number;
  modelCallsPerThousand: number;
  inputTokens: number;
  outputTokens: number;
  costPerThousandViews: number;
  elapsedMs: { median: number; p95: number; p99: number };
  violations: Record<string, number>;
}

// Nearest-rank on a sorted list. Small samples make interpolation a fiction.
function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[index]!;
}

export function summarise(
  arm: string,
  events: readonly GenerationEvent[],
  prices: TokenPrices,
): ArmResult {
  const sources = { llm: 0, cache: 0, fallback: 0 };
  const violations: Record<string, number> = {};
  const timings: number[] = [];
  let modelCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const event of events) {
    sources[event.source] += 1;
    timings.push(event.elapsedMs);

    // Only the request that was sent is billed. One that joined an in-flight
    // generation carries the same usage and would double the bill.
    if (event.calledModel) {
      modelCalls += 1;
      inputTokens += event.usage?.inputTokens ?? 0;
      outputTokens += event.usage?.outputTokens ?? 0;
    }

    for (const violation of event.violations ?? []) {
      const colon = violation.indexOf(':');
      const kind = colon === -1 ? violation : violation.slice(0, colon);
      violations[kind] = (violations[kind] ?? 0) + 1;
    }
  }

  const views = events.length;
  const cost =
    (inputTokens / 1_000_000) * prices.inputPerMillion +
    (outputTokens / 1_000_000) * prices.outputPerMillion;
  timings.sort((left, right) => left - right);

  return {
    arm,
    views,
    sources,
    cacheHitRate: views === 0 ? 0 : sources.cache / views,
    modelCalls,
    modelCallsPerThousand: views === 0 ? 0 : (modelCalls / views) * 1000,
    inputTokens,
    outputTokens,
    costPerThousandViews: views === 0 ? 0 : (cost / views) * 1000,
    elapsedMs: {
      median: percentile(timings, 0.5),
      p95: percentile(timings, 0.95),
      p99: percentile(timings, 0.99),
    },
    violations,
  };
}

export interface SourceRule {
  /** 'all' means every view must be a fallback, 'none' means no view may be. */
  fallback: 'none' | 'all';
  minCacheHitRate?: number;
  maxCacheHitRate?: number;
}

// A run whose sources do not match its arm is a different arm under the wrong
// name. Throwing is the only way a benchmark can refuse to publish that.
export function assertSourceMix(result: ArmResult, rule: SourceRule): void {
  // A run that measured nothing cannot be evidence of anything.
  if (result.views === 0) {
    throw new Error(`arm ${result.arm}: no views were measured`);
  }
  const { fallback } = result.sources;
  if (rule.fallback === 'none' && fallback > 0) {
    throw new Error(
      `arm ${result.arm}: ${fallback} of ${result.views} views fell back, so this is not the arm it says it is`,
    );
  }
  if (rule.fallback === 'all' && fallback !== result.views) {
    throw new Error(
      `arm ${result.arm}: ${result.views - fallback} of ${result.views} views reached a model, but this arm runs without one`,
    );
  }
  if (rule.minCacheHitRate !== undefined && result.cacheHitRate < rule.minCacheHitRate) {
    throw new Error(
      `arm ${result.arm}: cache hit rate ${result.cacheHitRate.toFixed(3)} is below ${rule.minCacheHitRate}`,
    );
  }
  if (rule.maxCacheHitRate !== undefined && result.cacheHitRate > rule.maxCacheHitRate) {
    throw new Error(
      `arm ${result.arm}: cache hit rate ${result.cacheHitRate.toFixed(3)} is above ${rule.maxCacheHitRate}`,
    );
  }
}
