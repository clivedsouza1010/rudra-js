import { describe, expect, it } from 'vitest';
import {
  createComponentGenerator,
  generatedSpecSchema,
  type ComponentProvider,
  type GenerationEvent,
  type ProviderRequest,
} from '@rudra-js/core';
import { createStubProvider } from './arms.js';
import {
  assertSourceMix,
  measureArm,
  skuForEachShopper,
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
    const result = summarise(identity('c'), [event(), event({ calledModel: false })], PRICES);

    expect(result.modelCalls).toBe(1);
  });

  it('scales the model calls to a thousand views', () => {
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
    const usage = { inputTokens: 1_000_000, outputTokens: 0 };
    const result = summarise(
      identity('c'),
      [event({ usage }), event({ calledModel: false, usage })],
      PRICES,
    );

    expect(result.inputTokens).toBe(1_000_000);
    expect(result.costPerThousandViews).toBe(2500);
  });

  it('bills the cached prefix as well as the plain input', () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 2_000_000,
      cacheWriteTokens: 4_000_000,
      cacheReadTokens: 8_000_000,
    };
    const result = summarise(identity('c'), [event({ usage })], PRICES);

    expect(result.cacheWriteTokens).toBe(4_000_000);
    expect(result.cacheReadTokens).toBe(8_000_000);
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

  it('groups a violation that carries more than one colon by its first word', () => {
    const result = summarise(
      identity('c'),
      [
        event({
          violations: [
            'unverifiable-claim:quantity:headline',
            'unverifiable-claim:wording:subheadline',
          ],
        }),
      ],
      PRICES,
    );

    expect(result.violations).toEqual({ 'unverifiable-claim': 2 });
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
    expect(() => assertSourceMix(resultWith({ llm: 0, cache: 0, fallback: 100 }), cohort)).toThrow(
      /fell back/,
    );
  });

  it('refuses a cohort run where a single view fell back', () => {
    expect(() => assertSourceMix(resultWith({ llm: 40, cache: 59, fallback: 1 }), cohort)).toThrow(
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

  it('refuses a run labelled stub that a real provider answered', () => {
    const result = resultWith(
      { llm: 100, cache: 0, fallback: 0 },
      { providerName: 'anthropic', providerModel: 'claude-opus-5' },
    );

    expect(() => assertSourceMix(result, { fallback: 'none' })).toThrow(/provider anthropic/);
  });

  it('accepts the no-model arm as a stub run', () => {
    const result = resultWith(
      { llm: 0, cache: 0, fallback: 100 },
      { providerName: null, providerModel: null },
    );

    expect(() => assertSourceMix(result, { fallback: 'all' })).not.toThrow();
  });

  it('refuses a run where every view fell back but the model was still called', () => {
    const result: ArmResult = { ...resultWith({ llm: 0, cache: 0, fallback: 100 }), modelCalls: 5 };

    expect(() => assertSourceMix(result, { fallback: 'all', modelCalls: 'none' })).toThrow(
      /called a model/,
    );
  });

  it('refuses a no-model run that made a single billed call', () => {
    const result: ArmResult = { ...resultWith({ llm: 0, cache: 0, fallback: 100 }), modelCalls: 1 };

    expect(() => assertSourceMix(result, { fallback: 'all', modelCalls: 'none' })).toThrow(
      /called a model/,
    );
  });
});

const catalog = generateCatalog(7, 40);
const shoppers = generateShoppers(11, catalog).slice(0, 5);
const stub = () => createStubProvider({ inputTokens: 1000, outputTokens: 200 });

describe('choosing which page a shopper looks at', () => {
  it('opens more pages when fewer shoppers share one', () => {
    const shopperCount = 20;

    const skusAtFive = new Set(skuForEachShopper(shopperCount, catalog, 5));
    const skusAtTwenty = new Set(skuForEachShopper(shopperCount, catalog, 20));

    expect(skusAtFive.size).toBe(4);
    expect(skusAtTwenty.size).toBe(1);
  });

  it('puts ten shoppers on a page when nobody says otherwise', () => {
    const skus = new Set(skuForEachShopper(20, catalog));

    expect(skus.size).toBe(2);
  });

  it('drops a part page rather than opening one for the remainder', () => {
    const skus = new Set(skuForEachShopper(25, catalog));

    expect(skus.size).toBe(2);
  });

  it('spreads a population bigger than the catalog evenly, one page per product', () => {
    const inStockSkus: string[] = [];
    for (const product of catalog) {
      if (product.isInStock) inStockSkus.push(product.sku);
    }
    const shopperCount = inStockSkus.length * 10 + 30;

    const shopperCountPerSku = new Map<string, number>();
    for (const sku of skuForEachShopper(shopperCount, catalog)) {
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
      options: { provider: null },
      rule: { fallback: 'all' },
    };
    const result = await measureArm(arm, shoppers, catalog, PRICES);

    expect(result.views).toBe(5);
  });

  it('calls no model on the deterministic arm', async () => {
    const arm: ArmSpec = {
      name: 'b',
      options: { provider: null },
      rule: { fallback: 'all' },
    };
    const result = await measureArm(arm, shoppers, catalog, PRICES);

    expect(result.modelCalls).toBe(0);
    expect(result.sources.fallback).toBe(5);
  });

  it('serves later shoppers in a cohort from the cache', async () => {
    const cohortShoppers = generateShoppers(11, catalog).slice(0, 20);
    const arm: ArmSpec = {
      name: 'c',
      options: { provider: stub(), generation: 'cohort' },
      rule: { fallback: 'none' },
    };
    const result = await measureArm(arm, cohortShoppers, catalog, PRICES);

    expect(result.sources.fallback).toBe(0);
    expect(result.modelCalls).toBe(9);
  });

  it('records the provider that answered', async () => {
    const arm: ArmSpec = {
      name: 'd',
      options: { provider: stub(), generation: 'per-shopper' },
      rule: { fallback: 'none' },
    };
    const result = await measureArm(arm, shoppers, catalog, PRICES);

    expect(result.providerName).toBe('stub');
    expect(result.providerModel).toBe('stub');
  });

  it('records no provider for the arm that runs without one', async () => {
    const arm: ArmSpec = {
      name: 'b',
      options: { provider: null },
      rule: { fallback: 'all' },
    };
    const result = await measureArm(arm, shoppers, catalog, PRICES);

    expect(result.providerName).toBe(null);
    expect(result.providerModel).toBe(null);
  });

  it('hands the shoppers-per-page down to the run', async () => {
    const cohortShoppers = generateShoppers(11, catalog).slice(0, 20);
    const arm: ArmSpec = {
      name: 'c',
      options: { provider: stub(), generation: 'cohort' },
      rule: { fallback: 'none' },
    };
    const result = await measureArm(arm, cohortShoppers, catalog, PRICES, 5);

    expect(result.modelCalls).toBe(14);
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
    const arm: ArmSpec = {
      name: 'c',
      options: { provider: null },
      rule: { fallback: 'none' },
    };

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

    const input = buildTrackingInput(shopper!, smallCatalog[0]!.sku, smallCatalog, []);
    await Promise.all([generator.generate(input), generator.generate(input)]);

    expect(calls()).toBe(1);
    expect(events.filter((one) => one.calledModel)).toHaveLength(1);
    expect(events.map((one) => one.source)).toEqual(['llm', 'llm']);
    expect(summarise(identity('c'), events, PRICES).inputTokens).toBe(1_000_000);
  });
});
