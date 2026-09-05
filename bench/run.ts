import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateShoppers } from '../examples/shop/src/fixtures/shoppers.js';
import { generateCatalog } from '../examples/shop/src/fixtures/catalog.js';
import { ARM_NAMES, PRICES } from './arms.js';
import { SHOPPERS_PER_PAGE, type ArmResult } from './measure-arm.js';
import { buildReport, formatTable } from './report.js';

async function main(): Promise<void> {
  // Only to report the population; each arm builds its own.
  const shoppers = generateShoppers(2, generateCatalog(1));

  // One process per arm, so the CPU figure is that arm's work and not the
  // JIT and garbage left behind by the arm before it.
  const results: ArmResult[] = [];
  for (const name of ARM_NAMES) {
    const output = execFileSync('npx', ['tsx', 'bench/run-arm.ts', name], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    results.push(JSON.parse(output) as ArmResult);
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
