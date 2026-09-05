import { describe, expect, it } from 'vitest';
import { buildCaveats, buildReport, formatTable } from './report.js';
import type { ArmResult, TokenPrices } from './measure-arm.js';

const PRICES: TokenPrices = {
  inputPerMillion: 5,
  outputPerMillion: 25,
  cacheWritePerMillion: 6.25,
  cacheReadPerMillion: 0.5,
};

const armResult = (overrides: Partial<ArmResult> = {}): ArmResult => ({
  arm: 'c cohort',
  mode: 'stub',
  providerName: 'stub',
  providerModel: 'stub',
  views: 500,
  sources: { llm: 230, cache: 270, fallback: 0 },
  cacheHitRate: 0.54,
  modelCalls: 230,
  modelCallsPerThousand: 460,
  inputTokens: 353_970,
  outputTokens: 124_660,
  cacheWriteTokens: 741_290,
  cacheReadTokens: 0,
  costPerThousandViews: 19.04,
  violations: {},
  ...overrides,
});

const hasLine = (lines: readonly string[], text: string): boolean => {
  for (const line of lines) {
    if (line.includes(text)) return true;
  }
  return false;
};

describe('the result file', () => {
  it('says when it was written, what it charged and how it was set up', () => {
    const report = buildReport({
      arms: [armResult()],
      prices: PRICES,
      population: 500,
      shoppersPerPage: 10,
      generatedAt: '2026-09-01T12:00:00.000Z',
    });

    expect(report.generatedAt).toBe('2026-09-01T12:00:00.000Z');
    expect(report.prices).toEqual(PRICES);
    expect(report.population).toBe(500);
    expect(report.shoppersPerPage).toBe(10);
    expect(report.arms).toEqual([armResult()]);
  });

  it('carries the same caveats the console prints', () => {
    const report = buildReport({
      arms: [armResult()],
      prices: PRICES,
      population: 500,
      shoppersPerPage: 10,
      generatedAt: '2026-09-01T12:00:00.000Z',
    });

    // The file is what somebody reads months later, so a caveat that lives
    // only in the console is a caveat nobody sees.
    expect(hasLine(report.caveats, 'one real recorded call')).toBe(true);
    expect(hasLine(report.caveats, '10 shoppers to a page')).toBe(true);
  });
});

describe('the caveats a stub run needs', () => {
  const caveatsFor = (mode: ArmResult['mode']): readonly string[] =>
    buildCaveats([armResult({ mode })], 10);

  it('says the violation counts cannot be anything but zero', () => {
    // Every arm prints an empty violations object, and under the stub that is
    // not a measurement: nothing it answers can break a rule.
    expect(hasLine(caveatsFor('stub'), 'no violation the stub can produce')).toBe(true);
  });

  it('says there are no timings and why', () => {
    expect(hasLine(caveatsFor('stub'), 'No timings are reported')).toBe(true);
  });

  it('drops the stub caveats when a real model answered', () => {
    expect(hasLine(caveatsFor('live'), 'no violation the stub can produce')).toBe(false);
    expect(hasLine(caveatsFor('live'), 'No timings are reported')).toBe(false);
    expect(hasLine(caveatsFor('live'), 'one real recorded call')).toBe(false);
  });

  it('says the cost is a ceiling and how far off a real run it is', () => {
    // A reader who quotes the cost column is out by about half unless the
    // caveat says so — every call here pays a fresh cache write.
    expect(hasLine(caveatsFor('stub'), 'close to twice a steady-state run')).toBe(true);
    expect(hasLine(caveatsFor('stub'), 'ceiling')).toBe(true);
  });

  it('says the hit rate is one cold pass and not a steady state', () => {
    // 54% can be quoted as a ceiling or as a floor by anyone who does not
    // know the run was a single cold pass at ten views per page.
    expect(hasLine(caveatsFor('stub'), 'one cold pass')).toBe(true);
    expect(hasLine(caveatsFor('live'), 'one cold pass')).toBe(true);
  });
});

describe('the printed table', () => {
  it('calls the cost column a ceiling', () => {
    // The number is a cold-cache worst case, so the heading has to say so.
    expect(formatTable([armResult()])).toContain('Cost / 1k views (ceiling)');
  });

  it('prints the mode right after the arm', () => {
    const table = formatTable([armResult({ arm: 'c cohort', mode: 'stub' })]);

    expect(table).toContain('| c cohort | stub |');
  });

  it('prints n/a where a stub run has no timings', () => {
    const table = formatTable([armResult({ mode: 'stub' })]);

    expect(table).toContain('| n/a | n/a | n/a |');
  });

  it('prints the timings a timed run does have', () => {
    const table = formatTable([
      armResult({ mode: 'live', elapsedMs: { median: 820, p95: 1400, p99: 1490 } }),
    ]);

    expect(table).toContain('| 820 | 1400 | 1490 |');
  });

  it('prints the mode a live run would carry', () => {
    const table = formatTable([armResult({ arm: 'c cohort', mode: 'live' })]);

    expect(table).toContain('| c cohort | live |');
  });

  it('says what the cpu figure leaves out when there is one', () => {
    const withCpu = [{ ...armResult(), cpuUserMs: 134, cpuSystemMs: 2 }];

    expect(buildCaveats(withCpu, 10).join(' ')).toMatch(/no model call is in it/i);
  });

  it('says nothing about cpu when no arm measured it', () => {
    expect(buildCaveats([armResult()], 10).join(' ')).not.toMatch(/cpu/i);
  });
});
