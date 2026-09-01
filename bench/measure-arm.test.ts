import { describe, expect, it } from 'vitest';
import type { GenerationEvent } from '@rudra-js/core';
import {
  assertSourceMix,
  summarise,
  type ArmResult,
  type SourceRule,
  type TokenPrices,
} from './measure-arm.js';

const PRICES: TokenPrices = { inputPerMillion: 15, outputPerMillion: 75 };

const event = (overrides: Partial<GenerationEvent> = {}): GenerationEvent => ({
  key: 'k',
  source: 'llm',
  elapsedMs: 10,
  calledModel: true,
  ...overrides,
});

describe('summarising a run', () => {
  it('counts each source', () => {
    const result = summarise(
      'c',
      [
        event(),
        event({ source: 'cache' }),
        event({ source: 'cache' }),
        event({ source: 'fallback' }),
      ],
      PRICES,
    );

    expect(result.sources).toEqual({ llm: 1, cache: 2, fallback: 1 });
    expect(result.views).toBe(4);
  });

  it('reads the cache hit rate off every view, not just the model ones', () => {
    const result = summarise(
      'c',
      [event({ source: 'cache' }), event({ calledModel: false })],
      PRICES,
    );

    expect(result.cacheHitRate).toBe(0.5);
  });

  it('counts only the requests that were sent', () => {
    // A request that joined an in-flight generation did not call the model.
    const result = summarise('c', [event(), event({ calledModel: false })], PRICES);

    expect(result.modelCalls).toBe(1);
  });

  it('bills a shared answer once', () => {
    // Both events carry the same usage, because the second joined the first.
    // Summing both would double the bill.
    const usage = { inputTokens: 1_000_000, outputTokens: 0 };
    const result = summarise('c', [event({ usage }), event({ calledModel: false, usage })], PRICES);

    expect(result.inputTokens).toBe(1_000_000);
    expect(result.costPerThousandViews).toBe(7500);
  });

  it('reports the middle and the tail of the timings', () => {
    const events: GenerationEvent[] = [];
    for (let ms = 1; ms <= 33; ms += 1) events.push(event({ elapsedMs: ms }));

    const result = summarise('c', events, PRICES);

    expect(result.elapsedMs.median).toBe(17);
    expect(result.elapsedMs.p95).toBe(32);
    expect(result.elapsedMs.p99).toBe(33);
  });

  it('groups violations by their kind', () => {
    const result = summarise(
      'c',
      [
        event({ violations: ['unknown-sku:A', 'unknown-sku:B', 'empty-block:grid'] }),
        event({ violations: ['no-bundle'] }),
      ],
      PRICES,
    );

    expect(result.violations).toEqual({ 'unknown-sku': 2, 'empty-block': 1, 'no-bundle': 1 });
  });

  it('reports zeroes for a run that called no model', () => {
    const result = summarise('b', [event({ source: 'fallback', calledModel: false })], PRICES);

    expect(result.modelCalls).toBe(0);
    expect(result.costPerThousandViews).toBe(0);
    expect(result.cacheHitRate).toBe(0);
  });
});

const resultWith = (sources: ArmResult['sources']): ArmResult => {
  const views = sources.llm + sources.cache + sources.fallback;
  return {
    arm: 'test',
    views,
    sources,
    cacheHitRate: views === 0 ? 0 : sources.cache / views,
    modelCalls: sources.llm,
    modelCallsPerThousand: 0,
    inputTokens: 0,
    outputTokens: 0,
    costPerThousandViews: 0,
    elapsedMs: { median: 0, p95: 0, p99: 0 },
    violations: {},
  };
};

describe('refusing a mislabelled arm', () => {
  const cohort: SourceRule = { fallback: 'none', minCacheHitRate: 0.5 };

  it('accepts a cohort run that used the model and the cache', () => {
    expect(() =>
      assertSourceMix(resultWith({ llm: 10, cache: 90, fallback: 0 }), cohort),
    ).not.toThrow();
  });

  it('refuses a cohort run that was really the deterministic arm', () => {
    // The whole point: this is arm (b) wearing arm (c)'s label.
    expect(() => assertSourceMix(resultWith({ llm: 0, cache: 0, fallback: 100 }), cohort)).toThrow(
      /fallback/,
    );
  });

  it('refuses a cohort run whose cache barely worked', () => {
    expect(() => assertSourceMix(resultWith({ llm: 90, cache: 10, fallback: 0 }), cohort)).toThrow(
      /cache/,
    );
  });

  it('refuses a per-shopper run that was really the cohort arm', () => {
    const perShopper: SourceRule = { fallback: 'none', maxCacheHitRate: 0.1 };

    expect(() =>
      assertSourceMix(resultWith({ llm: 10, cache: 90, fallback: 0 }), perShopper),
    ).toThrow(/cache/);
  });

  it('accepts a deterministic run with nothing but fallbacks', () => {
    expect(() =>
      assertSourceMix(resultWith({ llm: 0, cache: 0, fallback: 100 }), { fallback: 'all' }),
    ).not.toThrow();
  });

  it('refuses a deterministic run that reached a model', () => {
    expect(() =>
      assertSourceMix(resultWith({ llm: 1, cache: 0, fallback: 99 }), { fallback: 'all' }),
    ).toThrow(/fallback/);
  });
});
