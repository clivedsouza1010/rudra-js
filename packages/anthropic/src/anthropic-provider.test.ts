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

const answerText = (body: string, status: number): typeof globalThis.fetch =>
  vi.fn(async () => new Response(body, { status })) as unknown as typeof globalThis.fetch;

const toolAnswer = (input: unknown, usage?: Record<string, unknown>) => ({
  content: [{ type: 'tool_use', name: 'emit_component_spec', input }],
  usage: usage ?? { input_tokens: 11, output_tokens: 3 },
});

const request = (signal = new AbortController().signal) => ({
  system: 'SYSTEM',
  user: 'USER',
  schema: generatedSpecSchema,
  signal,
});

const sentBodyOf = (fetch: typeof globalThis.fetch) =>
  JSON.parse(
    String(
      (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1].body,
    ),
  ) as {
    system: { text?: string; cache_control?: unknown }[];
    tools: { input_schema: { type?: string; required?: string[] } }[];
    tool_choice?: unknown;
    thinking?: { type: string };
  };

describe('the Anthropic adapter', () => {
  it('returns the spec the model produced', async () => {
    const provider = createAnthropicProvider({ apiKey: 'k', fetch: answer(toolAnswer(spec)) });

    await expect(provider.generate(request())).resolves.toMatchObject({ spec });
  });

  it('reports what the call cost', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer(toolAnswer(spec, { input_tokens: 11, output_tokens: 3 })),
    });

    await expect(provider.generate(request())).resolves.toMatchObject({
      usage: { inputTokens: 11, outputTokens: 3 },
    });
  });

  it('maps all four usage fields to the names core reads, each a different number', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer(
        toolAnswer(spec, {
          input_tokens: 1537,
          output_tokens: 577,
          cache_read_input_tokens: 3223,
          cache_creation_input_tokens: 1024,
        }),
      ),
    });

    const result = await provider.generate(request());

    expect(result.usage).toEqual({
      inputTokens: 1537,
      outputTokens: 577,
      cacheReadTokens: 3223,
      cacheWriteTokens: 1024,
    });
  });

  it('drops a token count that arrived as a string and keeps the rest', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer(
        toolAnswer(spec, {
          input_tokens: '11',
          output_tokens: 577,
          cache_read_input_tokens: 3223,
          cache_creation_input_tokens: 1024,
        }),
      ),
    });

    const result = await provider.generate(request());

    expect(result.usage).toEqual({
      outputTokens: 577,
      cacheReadTokens: 3223,
      cacheWriteTokens: 1024,
    });
  });

  it('asks for the schema core defines, not a copy of it', async () => {
    const fetch = answer(toolAnswer(spec));
    const provider = createAnthropicProvider({ apiKey: 'k', fetch });

    await provider.generate(request());

    const sent = sentBodyOf(fetch);

    expect(sent.tools[0]!.input_schema).toEqual(
      z.toJSONSchema(generatedSpecSchema, { io: 'input' }),
    );
    expect(sent.tools[0]!.input_schema).toMatchObject({ type: 'object' });
    expect(sent.tools[0]!.input_schema.required).toEqual(
      expect.arrayContaining(['tone', 'headline', 'blocks']),
    );
  });

  it('marks the system prompt as the cached prefix', async () => {
    const fetch = answer(toolAnswer(spec));
    const provider = createAnthropicProvider({ apiKey: 'k', fetch });

    await provider.generate(request());

    expect(sentBodyOf(fetch).system[0]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('asks for the tool call instead of forcing it', async () => {
    const fetch = answer(toolAnswer(spec));
    const provider = createAnthropicProvider({ apiKey: 'k', fetch });

    await provider.generate(request());

    const sent = sentBodyOf(fetch);
    expect(sent.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
    expect(sent.system[1]?.text).toContain('emit_component_spec');
  });

  it('rejects when the vendor errors, rather than returning a broken spec', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer({ error: { message: 'overloaded' } }, 529),
    });

    await expect(provider.generate(request())).rejects.toThrow(/529/);
  });

  it('keeps the status code even when the error body fails to read', async () => {
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 529,
      text: () => Promise.reject(new Error('stream reset')),
    })) as unknown as typeof globalThis.fetch;

    const provider = createAnthropicProvider({ apiKey: 'k', fetch });

    await expect(provider.generate(request())).rejects.toThrow(/529/);
  });

  it('rejects when the body is null rather than reading a field off it', async () => {
    const provider = createAnthropicProvider({ apiKey: 'k', fetch: answer(null) });

    await expect(provider.generate(request())).rejects.toThrow(/null, not an object/);
  });

  it('rejects when the answer carries no tool use', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer({ content: [{ type: 'text', text: 'sorry' }] }),
    });

    await expect(provider.generate(request())).rejects.toThrow(/tool/i);
  });

  it('names the vendor, not its own internals, when content is not an array', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer({ content: 'not-an-array' }),
    });

    await expect(provider.generate(request())).rejects.toThrow(/tool/i);
  });

  it('names the vendor, not its own internals, when a content block is not an object', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer({ content: [null] }),
    });

    await expect(provider.generate(request())).rejects.toThrow(/tool/i);
  });

  it('rejects distinctly when the model hits its max_tokens budget mid-answer', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer({
        content: [{ type: 'text', text: 'thinking out loud...' }],
        stop_reason: 'max_tokens',
      }),
    });

    await expect(provider.generate(request())).rejects.toThrow(/max_tokens/i);
  });

  it('takes the spec when the model wraps it in a single key', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer(toolAnswer({ body: spec })),
    });

    await expect(provider.generate(request())).resolves.toMatchObject({ spec });
  });

  it('does not guess when the wrapper holds something that is not a spec', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer(toolAnswer({ body: { tone: 'chatty' } })),
    });

    await expect(provider.generate(request())).rejects.toThrow(/does not fit the schema/i);
  });

  it('does not guess when there is more than one key to choose from', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer(toolAnswer({ body: spec, other: spec })),
    });

    await expect(provider.generate(request())).rejects.toThrow(/does not fit the schema/i);
  });

  it('names the shape the model sent, not what was in it', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer(toolAnswer({ body: { headline: 'a shopper searched for this' } })),
    });

    const failure = provider.generate(request());

    await expect(failure).rejects.toThrow(/keys body/);
    await expect(failure).rejects.not.toThrow(/shopper searched/);
  });

  it('names the vendor when the tool use carries no input at all', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer({ content: [{ type: 'tool_use', name: 'emit_component_spec' }] }),
    });

    await expect(provider.generate(request())).rejects.toThrow(/does not fit the schema/i);
  });

  it('rejects distinctly when the model refuses', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer({ content: [], stop_reason: 'refusal' }),
    });

    await expect(provider.generate(request())).rejects.toThrow(/refusal/i);
  });

  it('stops when the caller aborts', async () => {
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

    await expect(pending).rejects.toThrow(/abort/i);
  });

  it('does not call out when the caller has already given up', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn(
      async () => new Response(JSON.stringify(toolAnswer(spec))),
    ) as unknown as typeof globalThis.fetch;

    const provider = createAnthropicProvider({ apiKey: 'k', fetch });

    await expect(provider.generate(request(controller.signal))).rejects.toThrow(/abort/i);
    expect(fetch).not.toHaveBeenCalled();
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

  it("defaults to a model that fits core's request-path budget", async () => {
    const provider = createAnthropicProvider({ apiKey: 'k', fetch: answer(toolAnswer(spec)) });

    expect(provider.model).toBe('claude-sonnet-5');
  });

  it('turns thinking off by default, because core budgets 1500ms', async () => {
    const fetch = answer(toolAnswer(spec));
    await createAnthropicProvider({ apiKey: 'k', fetch }).generate(request());

    expect(sentBodyOf(fetch).thinking).toEqual({ type: 'disabled' });
  });

  it('sends no thinking at all when the caller passes null', async () => {
    const fetch = answer(toolAnswer(spec));
    await createAnthropicProvider({ apiKey: 'k', thinking: null, fetch }).generate(request());

    expect(sentBodyOf(fetch).thinking).toBeUndefined();
  });
});

describe('what reaches the caller on a failure', () => {
  it('keeps the vendor error category but not the body it came in', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer(
        {
          type: 'error',
          error: { type: 'invalid_request_error', message: 'user said: SHOPPER-SEARCH-TERM' },
        },
        400,
      ),
    });

    await expect(provider.generate(request())).rejects.toThrow(/400 \(invalid_request_error\)/);
    await expect(provider.generate(request())).rejects.not.toThrow(/SHOPPER-SEARCH-TERM/);
  });

  it('still names the status when the body is not JSON at all', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answerText('<html>502</html>', 502),
    });

    await expect(provider.generate(request())).rejects.toThrow(/anthropic responded 502/);
  });
});

describe('the base URL', () => {
  it('trims every trailing slash, not just one', async () => {
    const fetch = answer(toolAnswer(spec));
    const provider = createAnthropicProvider({
      apiKey: 'k',
      baseUrl: 'https://proxy.internal///',
      fetch,
    });

    await provider.generate(request());

    const [url] = (fetch as unknown as { mock: { calls: [string][] } }).mock.calls[0]!;
    expect(url).toBe('https://proxy.internal/v1/messages');
  });
});

const headersOf = (fetch: typeof globalThis.fetch) =>
  ((fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1].headers ??
    {}) as Record<string, string>;

describe('an identity-linked key', () => {
  it('sends the workspace the request acts in, when one is configured', async () => {
    const fetch = answer(toolAnswer(spec));
    const provider = createAnthropicProvider({ apiKey: 'k', workspaceId: 'wrkspc_1', fetch });

    await provider.generate(request());

    expect(headersOf(fetch)['anthropic-workspace-id']).toBe('wrkspc_1');
  });

  it('sends no workspace header when none is configured', async () => {
    const fetch = answer(toolAnswer(spec));
    const provider = createAnthropicProvider({ apiKey: 'k', fetch });

    await provider.generate(request());

    expect(headersOf(fetch)).not.toHaveProperty('anthropic-workspace-id');
  });
});

describe('when the call never reaches the vendor', () => {
  it('names the transport fault instead of reporting a bare fetch failure', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: async () => {
        throw Object.assign(new TypeError('fetch failed'), {
          cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
        });
      },
    });

    await expect(provider.generate(request())).rejects.toThrow(/did not answer: ECONNREFUSED/);
  });

  it("lets the caller's own abort through unchanged", async () => {
    const controller = new AbortController();
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted by caller'))),
        ),
    });

    const pending = provider.generate(request(controller.signal));
    controller.abort();

    await expect(pending).rejects.toThrow(
      expect.objectContaining({ message: 'aborted by caller' }),
    );
  });
});
