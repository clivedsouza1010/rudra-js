import { mkdirSync, writeFileSync } from 'node:fs';
import { createMemorySpecCache } from '@rudra-js/core';
import { generateCatalog } from '../examples/shop/src/fixtures/catalog.js';
import { generateShoppers } from '../examples/shop/src/fixtures/shoppers.js';
import {
  createStubProvider,
  measureArm,
  SHOPPERS_PER_PAGE,
  type ArmResult,
  type ArmSpec,
  type TokenPrices,
} from './measure-arm.js';
import { buildReport, formatTable } from './report.js';

// claude-opus-5 list price, checked 2026-09-01. The only place a price
// appears, and it goes into the result file so a stale one is visible there
// and not only here. A cached prefix is written at 1.25x input and read back
// at 0.1x.
const PRICES: TokenPrices = {
  inputPerMillion: 5,
  outputPerMillion: 25,
  cacheWritePerMillion: 6.25,
  cacheReadPerMillion: 0.5,
};

// Copied whole from a real recorded claude-opus-5 call, so the stub bills like
// the model does. That call is a cold one: it wrote the cached prefix and read
// nothing back, and replaying it makes every call here a cold one too.
const RECORDED_USAGE = {
  inputTokens: 1539,
  outputTokens: 542,
  cacheWriteTokens: 3223,
  cacheReadTokens: 0,
};

// The default cache TTL is 60 seconds, tuned for a live page render. A real
// run with hundreds of model calls can take longer than that, and an entry
// expiring mid-run would fail an arm for a reason that has nothing to do with
// cohorting. Long enough that the measurement never depends on the clock.
const CACHE_TTL_MS = 60 * 60 * 1000;

async function main(): Promise<void> {
  const catalog = generateCatalog(1);
  const shoppers = generateShoppers(2, catalog);

  const arms: ArmSpec[] = [
    {
      name: 'b deterministic',
      mode: 'stub',
      options: { provider: null },
      rule: { fallback: 'all', modelCalls: 'none' },
    },
    {
      name: 'c cohort',
      mode: 'stub',
      options: {
        provider: createStubProvider(RECORDED_USAGE),
        generation: 'cohort',
        cache: createMemorySpecCache({ ttlMs: CACHE_TTL_MS }),
      },
      // Both a floor and a ceiling: this fixture (ten shoppers to a page,
      // four shopper segments) lands cohort caching around 54%. A run that
      // collapsed back to one page per cohort would print ~98% and pass a
      // floor alone — a ceiling is what would have caught that.
      rule: { fallback: 'none', minCacheHitRate: 0.45, maxCacheHitRate: 0.65 },
    },
    {
      name: 'd per-shopper',
      mode: 'stub',
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
    // Arms run one after another so each gets its own cold cache.
    // oxlint-disable-next-line no-await-in-loop
    results.push(await measureArm(arm, shoppers, catalog, PRICES));
  }

  const generatedAt = new Date().toISOString();
  const report = buildReport({
    arms: results,
    prices: PRICES,
    population: shoppers.length,
    shoppersPerPage: SHOPPERS_PER_PAGE,
    generatedAt,
  });

  mkdirSync('bench/results', { recursive: true });
  const stamp = generatedAt.replaceAll(':', '-');
  writeFileSync(`bench/results/${stamp}.json`, `${JSON.stringify(report, null, 2)}\n`);

  console.log(formatTable(report.arms));
  console.log();
  for (const caveat of report.caveats) {
    console.log(caveat);
  }
  for (const result of results) {
    console.log(`\n${result.arm} violations:`, result.violations);
  }
}

await main();
