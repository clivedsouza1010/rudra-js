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

/** Both the schema test and the cache_control test need the sent request body. */
const sentBodyOf = (fetch: typeof globalThis.fetch) =>
  JSON.parse(
    String(
      (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1].body,
    ),
  ) as {
    system: { cache_control?: unknown }[];
    tools: { input_schema: { type?: string; required?: string[] } }[];
  };

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

    const sent = sentBodyOf(fetch);

    // Restating the shape here is how a vocabulary drifts: the reconciler would
    // enforce one thing and the model would be told another.
    expect(sent.tools[0]!.input_schema).toEqual(
      z.toJSONSchema(generatedSpecSchema, { io: 'input' }),
    );
    // Assertions that hold whatever core's schema evolves into, so this test
    // still means something if the two ever drift apart.
    expect(sent.tools[0]!.input_schema).toMatchObject({ type: 'object' });
    expect(sent.tools[0]!.input_schema.required).toEqual(
      expect.arrayContaining(['tone', 'headline', 'blocks']),
    );
  });

  it('marks the system prompt as the cached prefix', async () => {
    // Nothing else here would notice a dropped cache_control: the response
    // still parses, and a higher bill is the only symptom.
    const fetch = answer(toolAnswer(spec));
    const provider = createAnthropicProvider({ apiKey: 'k', fetch });

    await provider.generate(request());

    expect(sentBodyOf(fetch).system[0]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('rejects when the vendor errors, rather than returning a broken spec', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer({ error: { message: 'overloaded' } }, 529),
    });

    await expect(provider.generate(request())).rejects.toThrow(/529/);
  });

  it('keeps the status code even when the error body fails to read', async () => {
    // The read sits inside the throw; if it rejects, that rejection must not
    // replace the status error and erase which HTTP code this was.
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 529,
      text: () => Promise.reject(new Error('stream reset')),
    })) as unknown as typeof globalThis.fetch;

    const provider = createAnthropicProvider({ apiKey: 'k', fetch });

    await expect(provider.generate(request())).rejects.toThrow(/529/);
  });

  it('rejects when the body is null rather than reading a field off it', async () => {
    // `null` is valid JSON. Reading `stop_reason` off it throws a TypeError
    // naming this adapter, when the fault is the vendor's.
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
    // On this model, thinking runs by default and shares the same output
    // budget as the tool call — a low cap can be spent reasoning before the
    // tool block is ever emitted. That is a budget setting, not the model
    // declining to use the tool, so it must not read as "no tool use".
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
    // Seen for real: the model returned the whole spec under "body". The spec
    // itself was right - correct tone, real SKUs, valid basis values - just one
    // level too deep. Rejecting a good answer over its envelope costs a paid
    // call and gives the shopper the fallback.
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
    // Two candidates means no single obvious payload, so this stays an error.
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer(toolAnswer({ body: spec, other: spec })),
    });

    await expect(provider.generate(request())).rejects.toThrow(/does not fit the schema/i);
  });

  it('says what the model actually sent when the tool input does not fit', async () => {
    // A rejected generation costs a real call. Zod alone says which fields are
    // wrong but not what arrived, so the next step is another paid call to
    // find out. The message carries the input instead.
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer({
        content: [{ type: 'tool_use', name: 'emit_component_spec', input: { tone: 'chatty' } }],
      }),
    });

    await expect(provider.generate(request())).rejects.toThrow(/chatty/);
  });

  it('rejects distinctly when the model refuses', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetch: answer({ content: [], stop_reason: 'refusal' }),
    });

    await expect(provider.generate(request())).rejects.toThrow(/refusal/i);
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

    // A matcher, not a bare `.rejects.toThrow()`: without one this test could
    // pass on any unrelated rejection, or on a 5-second timeout instead of an
    // actual assertion.
    await expect(pending).rejects.toThrow(/abort/i);
  });

  it('does not call out when the caller has already given up', async () => {
    // The other direction of obligation three. `fetch` covers this on its own
    // when it is the platform's, but this adapter takes an injected one — and
    // every test here, plus any caller-supplied transport, is exactly that.
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
});

describe('what reaches the caller on a failure', () => {
  it('keeps the vendor error category but not the body it came in', async () => {
    // Anthropic's 400s quote the offending field back, and for this framework
    // that field carries a shopper's own search terms. An adopter doing the
    // ordinary thing with a rejection would otherwise log them.
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
    // Without it the API answers 400: such a key belongs to a person across
    // several workspaces, so it cannot infer which one.
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
    // undici reports every transport fault as `TypeError: fetch failed` and puts
    // the reason in `cause`, so a refused connection and a DNS failure read
    // identically in a log.
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
    // A deadline that fired means something specific upstream; dressing it as a
    // transport fault would lose that.
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

    // Asserted as the whole message, not a substring: a wrapped error would
    // still contain these words, so `toThrow(/aborted by caller/)` would pass
    // whether the abort travelled through or not.
    await expect(pending).rejects.toThrow(
      expect.objectContaining({ message: 'aborted by caller' }),
    );
  });
});
