import { describe, expect, it } from 'vitest';
import {
  createComponentGenerator,
  generatedSpecSchema,
  type ComponentProvider,
  type GenerationEvent,
  type ProviderRequest,
} from '@rudra-js/core';
import {
  assertSourceMix,
  createStubProvider,
  measureArm,
  skuFor,
  summarise,
  type ArmIdentity,
  type ArmResult,
  type ArmSpec,
  type SourceRule,
  type TokenPrices,
} from './measure-arm.js';
import { buildTrackingInput } from '../examples/shop/src/fixtures/tracking-input.js';
import { generateCatalog } from '../examples/shop/src/fixtures/catalog.js';
import { generateShoppers } from '../examples/shop/src/fixtures/shoppers.js';

// Four different numbers, so a cost test cannot pass with two of them swapped.
const PRICES: TokenPrices = {
  inputPerMillion: 5,
  outputPerMillion: 25,
  cacheWritePerMillion: 6.25,
  cacheReadPerMillion: 0.5,
};

const event = (overrides: Partial<GenerationEvent> = {}): GenerationEvent => ({
  key: 'k',
  source: 'llm',
  elapsedMs: 10,
  calledModel: true,
  ...overrides,
});

const identity = (name: string, overrides: Partial<ArmIdentity> = {}): ArmIdentity => ({
  name,
  mode: 'stub',
  providerName: 'stub',
  providerModel: 'stub',
  ...overrides,
});

describe('summarising a run', () => {
  it('counts each source', () => {
    const result = summarise(
      identity('c'),
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
      identity('c'),
      [event({ source: 'cache' }), event({ calledModel: false })],
      PRICES,
    );

    expect(result.cacheHitRate).toBe(0.5);
  });

  it('counts only the requests that were sent', () => {
    // A request that joined an in-flight generation did not call the model.
    const result = summarise(identity('c'), [event(), event({ calledModel: false })], PRICES);

    expect(result.modelCalls).toBe(1);
  });

  it('scales the model calls to a thousand views', () => {
    // One call in four views is 250 calls per thousand. This number is written
    // into the result file, so it needs an assertion of its own.
    const result = summarise(
      identity('c'),
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
    const result = summarise(
      identity('c'),
      [event({ usage }), event({ calledModel: false, usage })],
      PRICES,
    );

    expect(result.inputTokens).toBe(1_000_000);
    // One million input tokens over two views: $5 spread over 2 views is
    // $2,500 per thousand.
    expect(result.costPerThousandViews).toBe(2500);
  });

  it('bills the cached prefix as well as the plain input', () => {
    // A real call marks the system prompt as a cached prefix, so it reports
    // four token counts and only two of them used to be billed.
    // A different count for each field, so the four prices cannot be swapped
    // around and still add up.
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 2_000_000,
      cacheWriteTokens: 4_000_000,
      cacheReadTokens: 8_000_000,
    };
    const result = summarise(identity('c'), [event({ usage })], PRICES);

    expect(result.cacheWriteTokens).toBe(4_000_000);
    expect(result.cacheReadTokens).toBe(8_000_000);
    // 1x5 + 2x25 + 4x6.25 + 8x0.5 is $84, over a single view.
    expect(result.costPerThousandViews).toBe(84_000);
  });

  it('leaves the cache token counts at zero when the call reports none', () => {
    const result = summarise(
      identity('c'),
      [event({ usage: { inputTokens: 10, outputTokens: 2 } })],
      PRICES,
    );

    expect(result.cacheWriteTokens).toBe(0);
    expect(result.cacheReadTokens).toBe(0);
  });

  it('reports the middle and the tail of the timings', () => {
    const events: GenerationEvent[] = [];
    for (let ms = 1; ms <= 33; ms += 1) events.push(event({ elapsedMs: ms }));

    const result = summarise(
      identity('c', { mode: 'replay', providerName: 'recording', providerModel: 'claude-opus-5' }),
      events,
      PRICES,
    );

    expect(result.elapsedMs?.median).toBe(17);
    expect(result.elapsedMs?.p95).toBe(32);
    expect(result.elapsedMs?.p99).toBe(33);
  });

  it('reports no timings at all for a stub run', () => {
    // The stub answers far below a millisecond, so Date.now() reads 0 or 1 for
    // every view. Writing that down as a median is writing down a result the
    // run did not measure.
    const events: GenerationEvent[] = [];
    for (let ms = 0; ms <= 5; ms += 1) events.push(event({ elapsedMs: ms }));

    const result = summarise(identity('c'), events, PRICES);

    expect(result.elapsedMs).toBe(undefined);
  });

  it('groups violations by their kind', () => {
    const result = summarise(
      identity('c'),
      [
        event({ violations: ['unknown-sku:A', 'unknown-sku:B', 'empty-block:grid'] }),
        event({ violations: ['no-bundle'] }),
      ],
      PRICES,
    );

    expect(result.violations).toEqual({ 'unknown-sku': 2, 'empty-block': 1, 'no-bundle': 1 });
  });

  it('reports zeroes for a run that called no model', () => {
    const result = summarise(
      identity('b'),
      [event({ source: 'fallback', calledModel: false })],
      PRICES,
    );

    expect(result.modelCalls).toBe(0);
    expect(result.costPerThousandViews).toBe(0);
    expect(result.cacheHitRate).toBe(0);
  });
});

const resultWith = (
  sources: ArmResult['sources'],
  overrides: Partial<ArmResult> = {},
): ArmResult => {
  const views = sources.llm + sources.cache + sources.fallback;
  return {
    arm: 'test',
    mode: 'stub',
    providerName: 'stub',
    providerModel: 'stub',
    views,
    sources,
    cacheHitRate: views === 0 ? 0 : sources.cache / views,
    modelCalls: sources.llm,
    modelCallsPerThousand: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    costPerThousandViews: 0,
    elapsedMs: { median: 0, p95: 0, p99: 0 },
    violations: {},
    ...overrides,
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

  it('refuses a run labelled live that the stub answered', () => {
    // The failure this whole benchmark exists to catch: numbers measured with
    // the model switched off, published under a heading saying it was on. The
    // label is written by hand in the arm; the name comes off whatever object
    // actually answered, so the two can disagree.
    const result = resultWith(
      { llm: 10, cache: 90, fallback: 0 },
      { mode: 'live', providerName: 'stub', providerModel: 'stub' },
    );

    expect(() => assertSourceMix(result, { fallback: 'none' })).toThrow(/nothing but a stub/);
  });

  it('refuses a run labelled live that had no provider at all', () => {
    const result = resultWith(
      { llm: 0, cache: 0, fallback: 100 },
      { mode: 'replay', providerName: null, providerModel: null },
    );

    expect(() => assertSourceMix(result, { fallback: 'all' })).toThrow(/nothing but a stub/);
  });

  it('refuses a run labelled stub that a real provider answered', () => {
    // The other direction, which bills money: whoever runs this expects a
    // stub and gets an invoice.
    const result = resultWith(
      { llm: 100, cache: 0, fallback: 0 },
      { mode: 'stub', providerName: 'anthropic', providerModel: 'claude-opus-5' },
    );

    expect(() => assertSourceMix(result, { fallback: 'none' })).toThrow(/provider anthropic/);
  });

  it('accepts the no-model arm as a stub run', () => {
    const result = resultWith(
      { llm: 0, cache: 0, fallback: 100 },
      { mode: 'stub', providerName: null, providerModel: null },
    );

    expect(() => assertSourceMix(result, { fallback: 'all' })).not.toThrow();
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
  it('opens more pages when fewer shoppers share one', () => {
    // Shoppers per page is the whole cache hit rate, so it has to be a knob
    // and not a number buried in the middle of the function.
    const shopperCount = 20;

    const skusAtFive = new Set<string>();
    for (let index = 0; index < shopperCount; index += 1) {
      skusAtFive.add(skuFor(index, shopperCount, catalog, 5));
    }

    const skusAtTwenty = new Set<string>();
    for (let index = 0; index < shopperCount; index += 1) {
      skusAtTwenty.add(skuFor(index, shopperCount, catalog, 20));
    }

    expect(skusAtFive.size).toBe(4);
    expect(skusAtTwenty.size).toBe(1);
  });

  it('puts ten shoppers on a page when nobody says otherwise', () => {
    const shopperCount = 20;

    const skus = new Set<string>();
    for (let index = 0; index < shopperCount; index += 1) {
      skus.add(skuFor(index, shopperCount, catalog));
    }

    expect(skus.size).toBe(2);
  });

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
    const arm: ArmSpec = {
      name: 'b',
      mode: 'stub',
      options: { provider: null },
      rule: { fallback: 'all' },
    };
    const result = await measureArm(arm, shoppers, catalog, PRICES);

    expect(result.views).toBe(5);
  });

  it('calls no model on the deterministic arm', async () => {
    const arm: ArmSpec = {
      name: 'b',
      mode: 'stub',
      options: { provider: null },
      rule: { fallback: 'all' },
    };
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
      mode: 'stub',
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

  it('records the mode and the provider that answered', async () => {
    const arm: ArmSpec = {
      name: 'd',
      mode: 'stub',
      options: { provider: stub(), generation: 'per-shopper' },
      rule: { fallback: 'none' },
    };
    const result = await measureArm(arm, shoppers, catalog, PRICES);

    expect(result.mode).toBe('stub');
    expect(result.providerName).toBe('stub');
    expect(result.providerModel).toBe('stub');
  });

  it('records no provider for the arm that runs without one', async () => {
    const arm: ArmSpec = {
      name: 'b',
      mode: 'stub',
      options: { provider: null },
      rule: { fallback: 'all' },
    };
    const result = await measureArm(arm, shoppers, catalog, PRICES);

    expect(result.providerName).toBe(null);
    expect(result.providerModel).toBe(null);
  });

  it('hands the shoppers-per-page down to the run', async () => {
    // The same twenty shoppers as the cohort test above, five to a page
    // instead of ten: four pages instead of two, so more cohorts form and the
    // model is called more often. Fourteen is what this seeded population
    // forms at five to a page.
    const cohortShoppers = generateShoppers(11, catalog).slice(0, 20);
    const arm: ArmSpec = {
      name: 'c',
      mode: 'stub',
      options: { provider: stub(), generation: 'cohort' },
      rule: { fallback: 'none' },
    };
    const result = await measureArm(arm, cohortShoppers, catalog, PRICES, 5);

    expect(result.modelCalls).toBe(14);
  });

  it('calls the model for every shopper in per-shopper mode', async () => {
    const arm: ArmSpec = {
      name: 'd',
      mode: 'stub',
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
    const arm: ArmSpec = {
      name: 'c',
      mode: 'stub',
      options: { provider: null },
      rule: { fallback: 'none' },
    };

    await expect(measureArm(arm, shoppers, catalog, PRICES)).rejects.toThrow(/fell back/);
  });

  it('gives the same numbers twice', async () => {
    const build = (): ArmSpec => ({
      name: 'c',
      mode: 'stub',
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

function countingProvider(usage: { inputTokens: number; outputTokens: number }): {
  provider: ComponentProvider;
  calls: () => number;
} {
  const inner = createStubProvider(usage);
  let calls = 0;

  return {
    provider: {
      name: 'stub',
      model: 'stub',
      async generate(request: ProviderRequest) {
        calls += 1;
        return inner.generate(request);
      },
    },
    calls: () => calls,
  };
}

describe('two requests for one key, in flight together', () => {
  it('sends one request and bills it once', async () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0 };
    const { provider, calls } = countingProvider(usage);
    const smallCatalog = generateCatalog(1, 20);
    const [shopper] = generateShoppers(2, smallCatalog, 1);
    const events: GenerationEvent[] = [];
    const generator = createComponentGenerator({
      provider,
      generation: 'cohort',
      onEvent: (generationEvent) => events.push(generationEvent),
    });

    // Both start before either resolves, so the second reaches the key while
    // the first is still running. No cache entry exists yet for it to hit.
    const input = buildTrackingInput(shopper!, smallCatalog[0]!.sku, smallCatalog, []);
    await Promise.all([generator.generate(input), generator.generate(input)]);

    expect(calls()).toBe(1);
    expect(events.filter((one) => one.calledModel)).toHaveLength(1);
    // The joiner has to get the answer, not a fallback. That is what sharing
    // one generation means, and billing once is worthless without it.
    expect(events.map((one) => one.source)).toEqual(['llm', 'llm']);
    expect(summarise(identity('c'), events, PRICES).inputTokens).toBe(1_000_000);
  });
});
