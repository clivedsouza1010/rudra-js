import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ARM_NAMES, PRICES } from './arms.js';
import { SHOPPERS_PER_PAGE, type ArmResult } from './measure-arm.js';
import { buildReport, formatTable } from './report.js';

// Separated so it can be tested. The row label comes from the child, so it has
// to be checked against what was asked for, or one arm's numbers get published
// under another's name.
export function parseArmOutput(name: string, output: string): ArmResult {
  let result: ArmResult;
  try {
    result = JSON.parse(output) as ArmResult;
  } catch (cause) {
    throw new Error(`arm '${name}' did not return JSON. It wrote: ${output.slice(0, 200)}`, {
      cause,
    });
  }

  if (result.arm !== name) {
    throw new Error(`asked for arm '${name}' and got '${result.arm}' back`);
  }
  if (result.cpuUserMs === undefined || result.cpuSystemMs === undefined) {
    throw new Error(`arm '${name}' reported no cpu, which is the column this run is for`);
  }

  return result;
}

function main(): void {
  // One process per arm, so the CPU figure is that arm's own work.
  const results: ArmResult[] = [];
  for (const name of ARM_NAMES) {
    let output: string;
    try {
      output = execFileSync('node_modules/.bin/tsx', ['bench/run-arm.ts', name], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
      });
    } catch (cause) {
      const { status, signal } = cause as { status: number | null; signal: string | null };
      throw new Error(
        signal === null
          ? `arm '${name}' exited ${String(status)}. Its own error is printed above this line.`
          : `arm '${name}' was killed by ${signal}, so this run has no numbers for it`,
        { cause },
      );
    }

    results.push(parseArmOutput(name, output));
  }

  const generatedAt = new Date().toISOString();
  const report = buildReport({
    arms: results,
    prices: PRICES,
    population: results[0]!.views,
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

if (process.env['VITEST'] === undefined) main();
