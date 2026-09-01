import { describe, expect, it } from 'vitest';
import type { GenerationEvent } from '@rudra-js/core';
import { summarise, type TokenPrices } from './measure-arm.js';

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
    const result = summarise('c', [event({ source: 'cache' }), event()], PRICES);

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
    for (let ms = 1; ms <= 100; ms += 1) events.push(event({ elapsedMs: ms }));

    const result = summarise('c', events, PRICES);

    expect(result.elapsedMs.median).toBe(50);
    expect(result.elapsedMs.p95).toBe(95);
    expect(result.elapsedMs.p99).toBe(99);
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
