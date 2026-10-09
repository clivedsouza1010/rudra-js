import { describe, expect, expectTypeOf, it } from 'vitest';
import { generatedSpecSchema, type GeneratedSpec } from './component-spec.js';
import {
  createFixedSpecProvider,
  type ComponentProvider,
  type ProviderRequest,
  type ProviderResult,
} from './provider.js';

const SPEC: GeneratedSpec = {
  tone: 'neutral',
  headline: 'Back to the trail',
  subheadline: null,
  blocks: [],
  rationale: 'Fixed spec for testing.',
};

const abortedSignal = (reason?: unknown): AbortSignal => {
  const controller = new AbortController();
  controller.abort(reason);
  return controller.signal;
};

const request = (): ProviderRequest => ({
  system: 'system prompt',
  user: 'user turn',
  schema: generatedSpecSchema,
  signal: new AbortController().signal,
});

describe('createFixedSpecProvider', () => {
  it('returns exactly the spec it was given', async () => {
    const result = await createFixedSpecProvider(SPEC).generate(request());

    expect(result.spec).toEqual(SPEC);
  });

  it('identifies itself, so a rendered spec records where it came from', () => {
    const provider = createFixedSpecProvider(SPEC);

    expect(provider.name).toBe('fixed');
    expect(provider.model).toBe('none');
  });

  it('ignores the prompt, which is what makes it a control', async () => {
    const provider = createFixedSpecProvider(SPEC);

    const [first, second] = await Promise.all([
      provider.generate({ ...request(), user: 'one shopper' }),
      provider.generate({ ...request(), user: 'a completely different shopper' }),
    ]);

    expect(first?.spec).toEqual(second?.spec);
  });

  it('reports no token usage, having spent none', async () => {
    const result = await createFixedSpecProvider(SPEC).generate(request());

    expect(result.usage).toBeUndefined();
  });
});

describe('an aborted request', () => {
  it('is rejected rather than answered', async () => {
    const provider = createFixedSpecProvider(SPEC);

    await expect(provider.generate({ ...request(), signal: abortedSignal() })).rejects.toThrow();
  });

  it('rejects with an AbortError, which is what a caller keys on', async () => {
    const provider = createFixedSpecProvider(SPEC);

    await expect(
      provider.generate({ ...request(), signal: abortedSignal() }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it("propagates the caller's own reason rather than inventing one", async () => {
    const provider = createFixedSpecProvider(SPEC);
    const reason = new Error('generation budget elapsed');

    await expect(provider.generate({ ...request(), signal: abortedSignal(reason) })).rejects.toBe(
      reason,
    );
  });

  it('does not reject a request whose signal is still live', async () => {
    const provider = createFixedSpecProvider(SPEC);

    await expect(provider.generate(request())).resolves.toMatchObject({ spec: SPEC });
  });
});

describe('the port contract', () => {
  it('is satisfied by the reference implementation', () => {
    expectTypeOf(createFixedSpecProvider(SPEC)).toExtend<ComponentProvider>();
  });

  it('hands an adapter a cancellation signal', () => {
    expectTypeOf<ProviderRequest['signal']>().toEqualTypeOf<AbortSignal>();
  });

  it('keeps the cached prefix and the per-request turn as separate fields', () => {
    expectTypeOf<ProviderRequest['system']>().toEqualTypeOf<string>();
    expectTypeOf<ProviderRequest['user']>().toEqualTypeOf<string>();
  });

  it('requires a parsed spec back, not a string to parse later', () => {
    expectTypeOf<ProviderResult['spec']>().toEqualTypeOf<GeneratedSpec>();
  });

  it('treats usage as optional, so an adapter that cannot report it still conforms', () => {
    expectTypeOf<ProviderResult>().toExtend<{ usage?: unknown }>();
  });

  it('lets an adapter be async only', () => {
    expectTypeOf<ComponentProvider['generate']>().returns.toEqualTypeOf<Promise<ProviderResult>>();
  });
});
