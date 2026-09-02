import { describe, expect, it } from 'vitest';
import { buildReport, formatTable } from './report.js';
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
  elapsedMs: { median: 0, p95: 1, p99: 1 },
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

describe('the printed table', () => {
  it('prints the mode right after the arm', () => {
    const table = formatTable([armResult({ arm: 'c cohort', mode: 'stub' })]);

    expect(table).toContain('| c cohort | stub |');
  });

  it('prints the mode a live run would carry', () => {
    const table = formatTable([armResult({ arm: 'c cohort', mode: 'live' })]);

    expect(table).toContain('| c cohort | live |');
  });
});
