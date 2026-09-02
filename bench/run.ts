import { mkdirSync, writeFileSync } from 'node:fs';
import { createMemorySpecCache } from '@rudra-js/core';
import { generateCatalog } from '../examples/shop/src/fixtures/catalog.js';
import { generateShoppers } from '../examples/shop/src/fixtures/shoppers.js';
import {
  createStubProvider,
  measureArm,
  type ArmResult,
  type ArmSpec,
  type TokenPrices,
} from './measure-arm.js';

// Claude Opus list price, and the only place a price appears.
const PRICES: TokenPrices = { inputPerMillion: 15, outputPerMillion: 75 };

// Copied from a real recorded call, so the stub bills like the model does.
const RECORDED_USAGE = { inputTokens: 1539, outputTokens: 542 };

// The default cache TTL is 60 seconds, tuned for a live page render. A real
// run with hundreds of model calls can take longer than that, and an entry
// expiring mid-run would fail an arm for a reason that has nothing to do with
// cohorting. Long enough that the measurement never depends on the clock.
const CACHE_TTL_MS = 60 * 60 * 1000;

function table(results: readonly ArmResult[]): string {
  const lines: string[] = [];
  lines.push(
    '| Arm | Views | Model calls | LLM/Cache/Fallback | Cache hits | Cost / 1k views | Median ms | p95 | p99 |',
  );
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const result of results) {
    const hits = `${(result.cacheHitRate * 100).toFixed(1)}%`;
    const cost = `$${result.costPerThousandViews.toFixed(2)}`;
    const mix = `${result.sources.llm}/${result.sources.cache}/${result.sources.fallback}`;
    lines.push(
      `| ${result.arm} | ${result.views} | ${result.modelCalls} | ${mix} | ${hits} | ${cost} | ` +
        `${result.elapsedMs.median} | ${result.elapsedMs.p95} | ${result.elapsedMs.p99} |`,
    );
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const catalog = generateCatalog(1);
  const shoppers = generateShoppers(2, catalog);

  const arms: ArmSpec[] = [
    {
      name: 'b deterministic',
      options: { provider: null },
      rule: { fallback: 'all', modelCalls: 'none' },
    },
    {
      name: 'c cohort',
      options: {
        provider: createStubProvider(RECORDED_USAGE),
        generation: 'cohort',
        cache: createMemorySpecCache({ ttlMs: CACHE_TTL_MS }),
      },
      // Both a floor and a ceiling: this fixture (ten shoppers per page,
      // four shopper segments) lands cohort caching around 54%. A run that
      // collapsed back to one page per cohort would print ~98% and pass a
      // floor alone — a ceiling is what would have caught that.
      rule: { fallback: 'none', minCacheHitRate: 0.45, maxCacheHitRate: 0.65 },
    },
    {
      name: 'd per-shopper',
      options: {
        provider: createStubProvider(RECORDED_USAGE),
        generation: 'per-shopper',
        cache: createMemorySpecCache({ ttlMs: CACHE_TTL_MS }),
      },
      rule: { fallback: 'none', maxCacheHitRate: 0.1 },
    },
  ];

  const results: ArmResult[] = [];
  for (const arm of arms) {
    // A failed assertion stops the run. A wrong number is worse than none.
    results.push(await measureArm(arm, shoppers, catalog, PRICES));
  }

  mkdirSync('bench/results', { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-');
  writeFileSync(`bench/results/${stamp}.json`, `${JSON.stringify(results, null, 2)}\n`);

  console.log(table(results));
  console.log();
  console.log('Median ms, p95 and p99 come from the stub, not from a real model call.');
  console.log(
    'Input/output tokens and cost are one real recorded call, replayed for every model call — not what the model actually said each time.',
  );
  console.log(
    'Cache hit rate is set by this fixture: ten shoppers per page and four shopper segments. A different population or segment count moves it.',
  );
  for (const result of results) {
    console.log(`\n${result.arm} violations:`, result.violations);
  }
}

await main();
