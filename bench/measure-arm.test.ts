import { describe, expect, it } from 'vitest';
import { generatedSpecSchema, type GenerationEvent, type ProviderRequest } from '@rudra-js/core';
import {
  assertSourceMix,
  createStubProvider,
  measureArm,
  skuFor,
  summarise,
  type ArmResult,
  type ArmSpec,
  type SourceRule,
  type TokenPrices,
} from './measure-arm.js';
import { generateCatalog } from '../examples/shop/src/fixtures/catalog.js';
import { generateShoppers } from '../examples/shop/src/fixtures/shoppers.js';

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

  it('scales the model calls to a thousand views', () => {
    // One call in four views is 250 calls per thousand. This number is written
    // into the result file, so it needs an assertion of its own.
    const result = summarise(
      'c',
      [
        event(),
        event({ calledModel: false }),
        event({ calledModel: false }),
        event({ calledModel: false }),
      ],
      PRICES,
    );

    expect(result.modelCallsPerThousand).toBe(250);
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
      /fell back/,
    );
  });

  it('refuses a cohort run whose cache barely worked', () => {
    expect(() => assertSourceMix(resultWith({ llm: 90, cache: 10, fallback: 0 }), cohort)).toThrow(
      /below/,
    );
  });

  it('refuses a per-shopper run that was really the cohort arm', () => {
    const perShopper: SourceRule = { fallback: 'none', maxCacheHitRate: 0.1 };

    expect(() =>
      assertSourceMix(resultWith({ llm: 10, cache: 90, fallback: 0 }), perShopper),
    ).toThrow(/above/);
  });

  it('refuses a run that measured nothing', () => {
    expect(() =>
      assertSourceMix(resultWith({ llm: 0, cache: 0, fallback: 0 }), { fallback: 'all' }),
    ).toThrow(/no views/);
  });

  it('accepts a deterministic run with nothing but fallbacks', () => {
    expect(() =>
      assertSourceMix(resultWith({ llm: 0, cache: 0, fallback: 100 }), { fallback: 'all' }),
    ).not.toThrow();
  });

  it('refuses a deterministic run that reached a model', () => {
    expect(() =>
      assertSourceMix(resultWith({ llm: 1, cache: 0, fallback: 99 }), { fallback: 'all' }),
    ).toThrow(/reached a model/);
  });

  it('refuses a run where every view fell back but the model was still called', () => {
    // A provider that times out or errors still calls the model and still
    // bills for it, even though its source comes back as fallback.
    // `fallback: 'all'` alone does not see this; `modelCalls: 'none'` does.
    const result: ArmResult = { ...resultWith({ llm: 0, cache: 0, fallback: 100 }), modelCalls: 5 };

    expect(() => assertSourceMix(result, { fallback: 'all', modelCalls: 'none' })).toThrow(
      /called a model/,
    );
  });
});

const catalog = generateCatalog(7, 40);
const shoppers = generateShoppers(11, catalog).slice(0, 5);
// The stub reads its SKU from the prompt, so it always answers with a
// product the shopper was actually offered.
const stub = () => createStubProvider({ inputTokens: 1000, outputTokens: 200 });

describe('choosing which page a shopper looks at', () => {
  it('spreads a population bigger than the catalog evenly, one page per product', () => {
    const inStockSkus: string[] = [];
    for (const product of catalog) {
      if (product.isInStock) inStockSkus.push(product.sku);
    }
    // Comfortably past the point where shopperCount / 10 exceeds the number
    // of in-stock products, which is where folding the page count back onto
    // the catalog used to double up on some of them.
    const shopperCount = inStockSkus.length * 10 + 30;

    const shopperCountPerSku = new Map<string, number>();
    for (let index = 0; index < shopperCount; index += 1) {
      const sku = skuFor(index, shopperCount, catalog);
      shopperCountPerSku.set(sku, (shopperCountPerSku.get(sku) ?? 0) + 1);
    }

    expect(shopperCountPerSku.size).toBe(inStockSkus.length);

    let fewest = Infinity;
    let most = -Infinity;
    for (const count of shopperCountPerSku.values()) {
      if (count < fewest) fewest = count;
      if (count > most) most = count;
    }
    expect(most - fewest).toBeLessThanOrEqual(1);
  });
});

describe('measuring one arm', () => {
  it('reports a view for every shopper', async () => {
    const arm: ArmSpec = { name: 'b', options: { provider: null }, rule: { fallback: 'all' } };
    const result = await measureArm(arm, shoppers, catalog, PRICES);

    expect(result.views).toBe(5);
  });

  it('calls no model on the deterministic arm', async () => {
    const arm: ArmSpec = { name: 'b', options: { provider: null }, rule: { fallback: 'all' } };
    const result = await measureArm(arm, shoppers, catalog, PRICES);

    expect(result.modelCalls).toBe(0);
    expect(result.sources.fallback).toBe(5);
  });

  it('serves later shoppers in a cohort from the cache', async () => {
    // A bigger slice than the other tests: sharing a page is necessary for a
    // cohort to form, but not enough on its own — segment and cold-start
    // status still split shoppers into different cohorts, so a handful of
    // shoppers is too small a sample to reliably land two of them in the
    // same one. Twenty is also the point where a page holds more than one
    // page's worth of shoppers, which is what tells this test apart from a
    // run that puts everyone on a single page regardless of population size.
    const cohortShoppers = generateShoppers(11, catalog).slice(0, 20);
    const arm: ArmSpec = {
      name: 'c',
      options: { provider: stub(), generation: 'cohort' },
      rule: { fallback: 'none' },
    };
    const result = await measureArm(arm, cohortShoppers, catalog, PRICES);

    expect(result.sources.fallback).toBe(0);
    // The exact count, not just "fewer than everyone": a run that collapsed
    // every shopper onto one page would still show fewer calls than views,
    // so that relation alone cannot tell a spread-out population from a
    // squashed one. Nine is the number of distinct cohorts this seeded
    // population of twenty actually forms.
    expect(result.modelCalls).toBe(9);
  });

  it('calls the model for every shopper in per-shopper mode', async () => {
    const arm: ArmSpec = {
      name: 'd',
      options: { provider: stub(), generation: 'per-shopper' },
      rule: { fallback: 'none' },
    };
    const result = await measureArm(arm, shoppers, catalog, PRICES);

    expect(result.modelCalls).toBe(5);
    expect(result.sources.cache).toBe(0);
    expect(result.inputTokens).toBeGreaterThan(0);
  });

  it('throws rather than report a cohort run that never reached a model', async () => {
    // The mislabelling case, end to end: arm (b)'s options under arm (c)'s rule.
    const arm: ArmSpec = { name: 'c', options: { provider: null }, rule: { fallback: 'none' } };

    await expect(measureArm(arm, shoppers, catalog, PRICES)).rejects.toThrow(/fell back/);
  });

  it('gives the same numbers twice', async () => {
    const build = (): ArmSpec => ({
      name: 'c',
      options: { provider: stub(), generation: 'cohort' },
      rule: { fallback: 'none' },
    });

    const first = await measureArm(build(), shoppers, catalog, PRICES);
    const second = await measureArm(build(), shoppers, catalog, PRICES);

    expect(second.sources).toEqual(first.sources);
    expect(second.modelCalls).toBe(first.modelCalls);
  });

  it('throws when the prompt has no candidates section', async () => {
    const provider = createStubProvider({ inputTokens: 0, outputTokens: 0 });
    const request: ProviderRequest = {
      system: '',
      user: '## Shopper\n\nSegment: "loyalty"',
      schema: generatedSpecSchema,
      signal: new AbortController().signal,
    };

    // The whole message, not just "no candidate": the two guards below each
    // other read almost the same, and a loose matcher passes for either one.
    await expect(provider.generate(request)).rejects.toThrow(/no candidates section/);
  });

  it('throws when the candidates section is there but holds no candidate', async () => {
    const provider = createStubProvider({ inputTokens: 0, outputTokens: 0 });
    const request: ProviderRequest = {
      system: '',
      user: '## Candidates\n\nNothing in stock for this shopper.',
      schema: generatedSpecSchema,
      signal: new AbortController().signal,
    };

    await expect(provider.generate(request)).rejects.toThrow(/no candidate in the prompt/);
  });
});
