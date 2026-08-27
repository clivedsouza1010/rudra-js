import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { generatedSpecSchema, type GeneratedSpec } from '@rudra-js/core';
import { createAnthropicProvider } from './anthropic-provider.js';

const spec: GeneratedSpec = {
  tone: 'neutral',
  headline: 'Picked for you',
  subheadline: null,
  blocks: [
    {
      kind: 'grid',
      title: null,
      columns: 2,
      items: [
        {
          sku: 'RJ-00001',
          basis: 'popular',
          reason: 'A dependable pick',
          badge: null,
          emphasis: 'normal',
        },
      ],
    },
  ],
  rationale: 'Test fixture.',
};

const answer = (body: unknown, status = 200): typeof globalThis.fetch =>
  vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof globalThis.fetch;

const toolAnswer = (input: unknown, usage?: Record<string, number>) => ({
  content: [{ type: 'tool_use', name: 'emit_component_spec', input }],
  usage: usage ?? { input_tokens: 11, output_tokens: 3 },
});

const request = (signal = new AbortController().signal) => ({
  system: 'SYSTEM',
  user: 'USER',
  schema: generatedSpecSchema,
  signal,
});

describe('the Anthropic adapter', () => {
  it('returns the spec the model produced', async () => {
    const provider = createAnthropicProvider({ apiKey: 'k', fetch: answer(toolAnswer(spec)) });

    await expect(provider.generate(request())).resolves.toMatchObject({ spec });
  });

  it('reports what the call cost', async () => {
    // Cost is summed over these; an adapter that drops them makes every cost
    // figure downstream silently zero.
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer(toolAnswer(spec, { input_tokens: 11, output_tokens: 3 })),
    });

    await expect(provider.generate(request())).resolves.toMatchObject({
      usage: { inputTokens: 11, outputTokens: 3 },
    });
  });

  it('asks for the schema core defines, not a copy of it', async () => {
    const fetch = answer(toolAnswer(spec));
    const provider = createAnthropicProvider({ apiKey: 'k', fetch });

    await provider.generate(request());

    const [, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    const sent = JSON.parse(String(init.body)) as { tools: { input_schema: unknown }[] };

    // Restating the shape here is how a vocabulary drifts: the reconciler would
    // enforce one thing and the model would be told another.
    expect(sent.tools[0]!.input_schema).toEqual(z.toJSONSchema(generatedSpecSchema));
  });

  it('rejects when the vendor errors, rather than returning a broken spec', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer({ error: { message: 'overloaded' } }, 529),
    });

    await expect(provider.generate(request())).rejects.toThrow(/529/);
  });

  it('rejects when the answer carries no tool use', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer({ content: [{ type: 'text', text: 'sorry' }] }),
    });

    await expect(provider.generate(request())).rejects.toThrow(/tool/i);
  });

  it('stops when the caller aborts', async () => {
    // Obligation three of the ComponentProvider contract. An adapter that
    // ignores it keeps a request alive past the deadline that gave up on it.
    const controller = new AbortController();
    const fetch = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof globalThis.fetch;

    const provider = createAnthropicProvider({ apiKey: 'k', fetch });
    const pending = provider.generate(request(controller.signal));
    controller.abort();

    await expect(pending).rejects.toThrow();
  });

  it('names itself and its model, because both are recorded on every spec', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      model: 'claude-opus-5',
      fetch: answer(toolAnswer(spec)),
    });

    expect(provider.name).toBe('anthropic');
    expect(provider.model).toBe('claude-opus-5');
  });
});
