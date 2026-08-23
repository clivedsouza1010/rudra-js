import { describe, expect, it } from 'vitest';
import {
  createComponentGenerator,
  type ComponentGeneratorOptions,
  type GenerationEvent,
} from './component-generator.js';
import type { GeneratedSpec } from './component-spec.js';
import type { ComponentProvider } from './provider.js';
import { createMemorySpecCache, createNullSpecCache } from './spec-cache.js';
import type { TrackingInputDraft } from './tracking-input.js';

const product = (sku: string, overrides: Record<string, unknown> = {}) => ({
  sku,
  title: `Product ${sku}`,
  category: 'Trail Running',
  price: 100,
  ...overrides,
});

const payload = (overrides: Partial<TrackingInputDraft> = {}): TrackingInputDraft => ({
  user: { id: 'shopper-1' },
  context: { surface: 'pdp' },
  candidates: [product('TR-101'), product('TR-102')],
  ...overrides,
});

const modelSpec = (skus: string[]): GeneratedSpec => ({
  tone: 'neutral',
  headline: 'Picked for you',
  subheadline: null,
  blocks: [
    {
      kind: 'grid',
      title: null,
      columns: 2,
      items: skus.map((sku) => ({
        sku,
        basis: 'popular' as const,
        reason: 'A dependable pick',
        badge: null,
        emphasis: 'normal' as const,
      })),
    },
  ],
  rationale: 'Test fixture.',
});

/** A provider that answers with a fixed spec and counts how often it was asked. */
function countingProvider(spec: GeneratedSpec = modelSpec(['TR-101'])) {
  let calls = 0;
  const provider: ComponentProvider = {
    name: 'test',
    model: 'test-model',
    generate: async () => {
      calls += 1;
      return { spec, usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
  return {
    provider,
    get calls() {
      return calls;
    },
  };
}

/** A provider that never answers, to exercise the deadline. */
const hangingProvider = (): ComponentProvider => ({
  name: 'slow',
  model: 'slow-model',
  generate: () => new Promise(() => {}),
});

const throwingProvider = (error: Error = new Error('upstream is down')): ComponentProvider => ({
  name: 'broken',
  model: 'broken-model',
  generate: async () => {
    throw error;
  },
});

const respondingWith = (spec: unknown): ComponentProvider => ({
  name: 'odd',
  model: 'odd-model',
  generate: async () => ({ spec: spec as GeneratedSpec }),
});

/** Every SKU that survived into a rendered component. */
const placedSkus = (spec: { blocks: GeneratedSpec['blocks'] }): string[] =>
  spec.blocks.flatMap((block) =>
    block.kind === 'grid' || block.kind === 'carousel' ? block.items.map((item) => item.sku) : [],
  );

const generatorWith = (options: ComponentGeneratorOptions = {}) =>
  createComponentGenerator({ cache: createNullSpecCache(), ...options });

/**
 * The one promise this module makes. Everything a model can do wrong ends in a
 * component rather than an error, because a page that renders nothing is worse
 * than a page that renders something plain.
 */
describe('always returns something renderable', () => {
  it.each([
    ['there is no provider', {}],
    ['the provider throws', { provider: throwingProvider() }],
    ['the provider never answers', { provider: hangingProvider(), modelTimeoutMs: 20 }],
    ['the provider answers with nonsense', { provider: respondingWith({ not: 'a spec' }) }],
    ['the provider answers with null', { provider: respondingWith(null) }],
    [
      'the provider names only products that do not exist',
      { provider: respondingWith(modelSpec(['GHOST-1'])) },
    ],
  ])('falls back to the deterministic component when %s', async (_label, options) => {
    const spec = await generatorWith(options).generate(payload());

    expect(spec.source).toBe('fallback');
    expect(spec.blocks.length).toBeGreaterThan(0);
    expect(spec.degradedReason).toBeTruthy();
  });

  it('names a different reason for each way of failing', async () => {
    const reasonFor = async (options: ComponentGeneratorOptions) =>
      (await generatorWith(options).generate(payload())).degradedReason;

    expect(await reasonFor({})).toBe('no-provider');
    expect(await reasonFor({ provider: throwingProvider() })).toBe('provider-error');
    expect(await reasonFor({ provider: hangingProvider(), modelTimeoutMs: 20 })).toBe('timeout');
    // A malformed answer is the adapter's fault; an answer that names nothing
    // this shopper can be shown is the model's. They want different responses,
    // so they get different reasons.
    expect(await reasonFor({ provider: respondingWith({ bad: true }) })).toBe('invalid-generation');
    expect(await reasonFor({ provider: respondingWith(modelSpec(['GHOST-1'])) })).toBe(
      'unusable-on-serve',
    );
  });

  it('rejects only for a malformed payload, which is a caller bug', async () => {
    await expect(generatorWith().generate({ user: { id: '' } } as never)).rejects.toThrow();
  });

  it('serves the model when it answers properly', async () => {
    const spec = await generatorWith({ provider: countingProvider().provider }).generate(payload());

    expect(spec.source).toBe('llm');
    expect(spec.degradedReason).toBeUndefined();
  });
});

describe('the deadline', () => {
  it('does not wait longer than it was given', async () => {
    const startedAt = Date.now();

    await generatorWith({ provider: hangingProvider(), modelTimeoutMs: 30 }).generate(payload());

    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it('tells the provider to stop, rather than only ignoring it', async () => {
    let seen: AbortSignal | undefined;
    const provider: ComponentProvider = {
      name: 'watcher',
      model: 'watcher-model',
      generate: ({ signal }) => {
        seen = signal;
        return new Promise(() => {});
      },
    };

    await generatorWith({ provider, modelTimeoutMs: 20 }).generate(payload());

    expect(seen?.aborted).toBe(true);
  });
});

describe('the cache', () => {
  it('asks the model once, then serves the same shopper from the cache', async () => {
    const counted = countingProvider();
    const generator = createComponentGenerator({
      provider: counted.provider,
      cache: createMemorySpecCache(),
    });

    const first = await generator.generate(payload());
    const second = await generator.generate(payload());

    expect(counted.calls).toBe(1);
    expect(first.source).toBe('llm');
    expect(second.source).toBe('cache');
  });

  it('asks again for a different shopper', async () => {
    const counted = countingProvider();
    const generator = createComponentGenerator({
      provider: counted.provider,
      cache: createMemorySpecCache(),
    });

    await generator.generate(payload({ user: { id: 'a' } }));
    await generator.generate(payload({ user: { id: 'b', segment: 'endurance' } }));

    expect(counted.calls).toBe(2);
  });

  /**
   * The reason a cached component is reconciled on the way out rather than the
   * way in. Stock moves independently of the cache key, so a component checked
   * a minute ago can be wrong now.
   */
  it('never serves a cached product that has since sold out', async () => {
    const counted = countingProvider(modelSpec(['TR-101', 'TR-102']));
    const generator = createComponentGenerator({
      provider: counted.provider,
      cache: createMemorySpecCache(),
    });

    const before = await generator.generate(payload());
    const after = await generator.generate(
      payload({ candidates: [product('TR-101', { isInStock: false }), product('TR-102')] }),
    );

    expect(placedSkus(before)).toContain('TR-101');
    expect(placedSkus(after)).not.toContain('TR-101');
    expect(after.source).toBe('cache');
    expect(counted.calls).toBe(1);
  });

  it('picks a restocked product back up, without asking the model again', async () => {
    const counted = countingProvider(modelSpec(['TR-101', 'TR-102']));
    const generator = createComponentGenerator({
      provider: counted.provider,
      cache: createMemorySpecCache(),
    });

    // This is why the cache holds what the model said rather than what was
    // servable at the time. Storing the narrowed form would lose TR-101 for the
    // life of the entry, and no test would have noticed.
    const soldOut = await generator.generate(
      payload({ candidates: [product('TR-101', { isInStock: false }), product('TR-102')] }),
    );
    const restocked = await generator.generate(payload());

    expect(placedSkus(soldOut)).not.toContain('TR-101');
    expect(placedSkus(restocked)).toContain('TR-101');
    expect(restocked.source).toBe('cache');
    expect(counted.calls).toBe(1);
  });

  it('falls back when a cached spec has nothing left this shopper can see', async () => {
    const counted = countingProvider(modelSpec(['TR-101']));
    const generator = createComponentGenerator({
      provider: counted.provider,
      cache: createMemorySpecCache(),
    });

    await generator.generate(payload());
    const after = await generator.generate(
      payload({ candidates: [product('TR-101', { isInStock: false }), product('TR-102')] }),
    );

    expect(after.source).toBe('fallback');
    expect(after.degradedReason).toBe('unusable-on-serve');
  });

  it.each([
    [
      'a store that hangs on write',
      { get: async () => undefined, set: () => new Promise<void>(() => {}) },
    ],
    [
      'a store that throws synchronously on write',
      {
        get: async () => undefined,
        set: () => {
          throw new Error('cannot serialise');
        },
      },
    ],
    [
      'a store returning an entry of the wrong shape',
      {
        get: async () => ({ tone: 'neutral', headline: 'H', blocks: 'not-an-array' }),
        set: async () => {},
      },
    ],
  ])('still renders against %s', async (_label, brokenCache) => {
    const generator = createComponentGenerator({
      provider: countingProvider().provider,
      cache: brokenCache as never,
      cacheTimeoutMs: 20,
    });

    await expect(generator.generate(payload())).resolves.toMatchObject({ source: 'llm' });
  });

  it('never serves a cached product the shopper has since disliked', async () => {
    const counted = countingProvider(modelSpec(['TR-101', 'TR-102']));
    const generator = createComponentGenerator({
      provider: counted.provider,
      cache: createMemorySpecCache(),
    });

    await generator.generate(payload());
    const after = await generator.generate(payload({ signals: { dislikes: [{ sku: 'TR-101' }] } }));

    expect(placedSkus(after)).not.toContain('TR-101');
  });

  it('generates rather than failing when the store is broken', async () => {
    const counted = countingProvider();
    const brokenCache = {
      get: async () => {
        throw new Error('redis is down');
      },
      set: async () => {
        throw new Error('redis is down');
      },
    };

    const spec = await createComponentGenerator({
      provider: counted.provider,
      cache: brokenCache,
    }).generate(payload());

    expect(spec.source).toBe('llm');
  });

  it('does not wait forever on a store that hangs', async () => {
    const hangingCache = { get: () => new Promise<undefined>(() => {}), set: async () => {} };
    const startedAt = Date.now();

    const spec = await createComponentGenerator({
      provider: countingProvider().provider,
      cache: hangingCache,
      cacheTimeoutMs: 20,
    }).generate(payload());

    expect(spec.source).toBe('llm');
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});

describe('concurrent requests for the same shopper', () => {
  it('ask the model once, not once each', async () => {
    let calls = 0;
    const provider: ComponentProvider = {
      name: 'slow',
      model: 'slow-model',
      generate: async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { spec: modelSpec(['TR-101']) };
      },
    };
    const generator = createComponentGenerator({ provider, cache: createMemorySpecCache() });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => generator.generate(payload())),
    );

    // Eight shoppers arriving together on a cold key would otherwise buy the
    // same answer eight times.
    expect(calls).toBe(1);
    expect(results.every((spec) => spec.source === 'llm')).toBe(true);
  });

  it('lets the next request try again after a failure', async () => {
    let calls = 0;
    const provider: ComponentProvider = {
      name: 'flaky',
      model: 'flaky-model',
      generate: async () => {
        calls += 1;
        if (calls === 1) throw new Error('first attempt fails');
        return { spec: modelSpec(['TR-101']) };
      },
    };
    const generator = createComponentGenerator({ provider, cache: createMemorySpecCache() });

    const first = await generator.generate(payload());
    const second = await generator.generate(payload());

    expect(first.source).toBe('fallback');
    expect(second.source).toBe('llm');
  });
});

describe('provenance', () => {
  it('records which model answered', async () => {
    const spec = await generatorWith({ provider: countingProvider().provider }).generate(payload());

    expect(spec.provider).toBe('test');
    expect(spec.model).toBe('test-model');
    expect(spec.specVersion).toBe('1');
    expect(spec.slot).toBe('recommendations');
  });

  it('records no model on the deterministic path', async () => {
    const spec = await generatorWith().generate(payload());

    expect(spec.provider).toBeNull();
    expect(spec.model).toBeNull();
  });

  it('reports how long it actually took', async () => {
    const slow: ComponentProvider = {
      name: 'slow',
      model: 'slow-model',
      generate: async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { spec: modelSpec(['TR-101']) };
      },
    };

    const before = Date.now();
    const spec = await generatorWith({ provider: slow }).generate(payload());
    const after = Date.now();

    // A hardcoded zero satisfies "at least zero", so the figure has to be
    // pinned against something that actually elapsed.
    expect(spec.latencyMs).toBeGreaterThanOrEqual(35);
    // Stamped when the spec was produced, not when the request arrived — so it
    // has to be past the time the model spent, not merely inside the window.
    expect(spec.generatedAt).toBeGreaterThanOrEqual(before + 35);
    expect(spec.generatedAt).toBeLessThanOrEqual(after);
  });
});

describe('what it reports', () => {
  const collect = async (options: ComponentGeneratorOptions, runs = 1) => {
    const events: GenerationEvent[] = [];
    const generator = createComponentGenerator({
      cache: createMemorySpecCache(),
      onEvent: (event) => events.push(event),
      ...options,
    });
    for (let run = 0; run < runs; run += 1) await generator.generate(payload());
    return events;
  };

  it.each([
    ['a generation', { provider: countingProvider().provider }, 1],
    ['a fallback', { provider: throwingProvider() }, 1],
    ['no provider at all', {}, 1],
    ['two runs, one cached', { provider: countingProvider().provider }, 2],
  ])('reports exactly one event for %s', async (_label, options, runs) => {
    // Every ratio the evaluation computes is over all calls, so a call that
    // reports nothing makes every one of them wrong.
    expect(await collect(options, runs)).toHaveLength(runs);
  });

  it('reports what a generation cost, and that it was a real model call', async () => {
    const [event] = await collect({ provider: countingProvider().provider });

    expect(event).toMatchObject({ source: 'llm', calledModel: true, usage: { inputTokens: 10 } });
  });

  it('does not count a cache hit as a model call', async () => {
    const events = await collect({ provider: countingProvider().provider }, 2);

    expect(events[1]).toMatchObject({ source: 'cache', calledModel: false });
  });

  it('still counts the model call when the answer turns out unusable', async () => {
    const [event] = await collect({
      provider: respondingWith(modelSpec(['GHOST-1'])),
    });

    // The model was asked and billed. Reporting calledModel: false here would
    // hide exactly the calls worth knowing about — the ones that produced
    // nothing renderable.
    expect(event).toMatchObject({
      source: 'fallback',
      degradedReason: 'unusable-on-serve',
      calledModel: true,
    });
    expect(event?.violations).toContain('unknown-sku:GHOST-1');
  });

  it('reports a fallback with its reason, and no model call', async () => {
    const [event] = await collect({ provider: throwingProvider() });

    expect(event).toMatchObject({
      source: 'fallback',
      calledModel: false,
      degradedReason: 'provider-error',
    });
  });

  it('reports what reconciliation removed', async () => {
    const [event] = await collect({
      provider: respondingWith(modelSpec(['TR-101', 'GHOST-1'])),
    });

    expect(event?.violations).toContain('unknown-sku:GHOST-1');
  });

  it('counts one model call when eight requests share one generation', async () => {
    const events: GenerationEvent[] = [];
    const provider: ComponentProvider = {
      name: 'slow',
      model: 'slow-model',
      generate: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { spec: modelSpec(['TR-101']), usage: { outputTokens: 7 } };
      },
    };
    const generator = createComponentGenerator({
      provider,
      cache: createMemorySpecCache(),
      onEvent: (event) => events.push(event),
    });

    await Promise.all(Array.from({ length: 8 }, () => generator.generate(payload())));

    // Eight events, because eight callers asked. One model call, because seven
    // of them shared the first one's answer — cost is summed over the flag, not
    // over the events.
    expect(events).toHaveLength(8);
    expect(events.filter((event) => event.calledModel)).toHaveLength(1);
  });

  it('survives a reporting hook that throws', async () => {
    const generator = createComponentGenerator({
      provider: countingProvider().provider,
      cache: createNullSpecCache(),
      onEvent: () => {
        throw new Error('metrics pipeline is down');
      },
    });

    // A broken metrics hook must not take down a page.
    await expect(generator.generate(payload())).resolves.toMatchObject({ source: 'llm' });
  });
});

describe('when the component was generated', () => {
  it('reports the original moment on a cache hit, not the moment it was served', async () => {
    const generator = createComponentGenerator({
      provider: countingProvider().provider,
      cache: createMemorySpecCache(),
    });

    const first = await generator.generate(payload());
    await new Promise((resolve) => setTimeout(resolve, 60));
    const cached = await generator.generate(payload());

    // A cached component is not newly generated. Stamping it with the serve
    // time makes any measure of how stale a page is showing read as zero.
    expect(cached.source).toBe('cache');
    expect(cached.generatedAt).toBe(first.generatedAt);
  });

  it('still reports the real time spent serving it', async () => {
    const generator = createComponentGenerator({
      provider: countingProvider().provider,
      cache: createMemorySpecCache(),
    });

    await generator.generate(payload());
    const cached = await generator.generate(payload());

    // generatedAt is about the spec; latencyMs is about this request.
    expect(cached.latencyMs).toBeGreaterThanOrEqual(0);
    expect(cached.latencyMs).toBeLessThan(100);
  });
});

describe('generateDeterministic', () => {
  it('never consults the model, even when one is configured', async () => {
    const counted = countingProvider();

    const spec = createComponentGenerator({ provider: counted.provider }).generateDeterministic(
      payload(),
    );

    expect(counted.calls).toBe(0);
    expect(spec.source).toBe('fallback');
    expect(spec.degradedReason).toBe('requested');
  });

  it('is synchronous, so it can be used where awaiting is not an option', () => {
    const spec = createComponentGenerator().generateDeterministic(payload());

    expect(spec.headline.length).toBeGreaterThan(0);
  });
});
