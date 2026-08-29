import { z } from 'zod';
import type {
  ComponentProvider,
  ProviderRequest,
  ProviderResult,
  TokenUsage,
} from '@rudra-js/core';

export interface AnthropicProviderOptions {
  apiKey: string;
  /** Defaults to the current Claude model this package was written against. */
  model?: string;
  maxTokens?: number;
  baseUrl?: string;
  /**
   * Required when the key is identity-linked rather than workspace-scoped —
   * such a key belongs to a person across several workspaces, so the API cannot
   * infer which one a request acts in and rejects it with a 400.
   */
  workspaceId?: string;
  /** Injected so the adapter is testable without a network or an SDK. */
  fetch?: typeof globalThis.fetch;
}

const TOOL_NAME = 'emit_component_spec';

/**
 * This model runs adaptive thinking by default, and thinking draws on the
 * same output budget as the tool call. A cap too close to what reasoning
 * alone can spend leaves no room for the tool block, so the default is well
 * above a typical spec's size rather than tuned to it.
 */
const DEFAULT_MAX_TOKENS = 8192;

interface ToolUseBlock {
  type: 'tool_use';
  name: string;
  input: unknown;
}

function isToolUseBlock(candidate: unknown): candidate is ToolUseBlock {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    (candidate as Record<string, unknown>)['type'] === 'tool_use' &&
    (candidate as Record<string, unknown>)['name'] === TOOL_NAME
  );
}

/**
 * Adapts the Anthropic Messages API to `ComponentProvider`.
 *
 * The tool schema is derived from the schema core exports rather than restated
 * here: a second copy is a second vocabulary, and the drift shows up as
 * unexplained `invalid-generation` events.
 */
export function createAnthropicProvider(options: AnthropicProviderOptions): ComponentProvider {
  const model = options.model ?? 'claude-opus-5';
  const call = options.fetch ?? globalThis.fetch;
  // Trimmed so a caller-supplied `baseUrl` ending in `/` cannot turn into
  // `//v1/messages`. Done with a loop rather than `/\/+$/`: that pattern
  // backtracks on a string of many trailing slashes, which is a denial of
  // service in a published package even though the value comes from the caller
  // rather than from a request.
  let baseUrl = options.baseUrl ?? 'https://api.anthropic.com';
  while (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    name: 'anthropic',
    model,

    async generate(request: ProviderRequest): Promise<ProviderResult> {
      // The half of obligation three that `fetch` does not cover. The real
      // `fetch` rejects an already-aborted signal on its own, but `fetch` is an
      // injected seam here, and a caller's own transport has no such duty — so
      // without this, a call the caller has already given up on goes out.
      request.signal.throwIfAborted();

      const response = await send(call, `${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': options.apiKey,
          'anthropic-version': '2023-06-01',
          ...(options.workspaceId ? { 'anthropic-workspace-id': options.workspaceId } : {}),
        },
        // The caller's deadline, handed straight to the transport: the contract
        // asks an adapter to stop, not merely to stop caring about the answer.
        signal: request.signal,
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          // Marked as the cached prefix. Anything per-shopper interpolated here
          // would destroy the prompt cache hit rate.
          system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: request.user }],
          tools: [
            {
              name: TOOL_NAME,
              description: 'Return the component specification.',
              // "input" — a tool's input_schema describes what the model must
              // produce as the tool call's argument, not core's own output.
              // Identical to the default today because nothing in
              // generatedSpecSchema uses `.default()` or `.transform()`; the
              // day one does, "output" would silently send the wrong shape.
              input_schema: z.toJSONSchema(request.schema, { io: 'input' }),
            },
          ],
          tool_choice: { type: 'tool', name: TOOL_NAME },
        }),
      });

      if (!response.ok) {
        // Status and the vendor's error category only. Its message quotes the
        // request back, and for this framework that can be a shopper's own search
        // terms — which an adopter's `console.error(err)` would then capture.
        const category = await errorCategory(response);

        throw new Error(`anthropic responded ${response.status}${category}`);
      }

      const parsed: unknown = await response.json();

      // `response.json()` yields whatever the body held, and `null` is valid
      // JSON — reading `stop_reason` off it would throw a TypeError naming this
      // adapter rather than the vendor that sent it.
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error(
          `anthropic returned ${parsed === null ? 'null' : typeof parsed}, not an object`,
        );
      }

      const body = parsed as {
        content?: unknown;
        usage?: Record<string, unknown>;
        stop_reason?: string;
      };

      // Before the tool-block lookup: both are ordinary 200s with no tool_use,
      // and reporting them as "no tool use" blames the model for a budget or a
      // policy this adapter controls.
      if (body.stop_reason === 'max_tokens') {
        throw new Error(
          `anthropic stopped at the max_tokens budget (${maxTokens}) before returning a tool use`,
        );
      }
      if (body.stop_reason === 'refusal') {
        throw new Error('anthropic refused to answer (stop_reason: refusal)');
      }

      // `content` and each of its entries are untrusted shapes from here on:
      // a malformed response should name the vendor, not crash on the
      // adapter's own `.find`/`.type` access.
      const blocks = Array.isArray(body.content) ? body.content : [];
      const block = blocks.find(isToolUseBlock);

      if (!block) {
        throw new Error(`anthropic returned no ${TOOL_NAME} tool use`);
      }

      // Parsed against the caller's own schema. generatedSpecSchema has no
      // refinements, so this catches type and enum violations — a block kind
      // outside the closed set, a non-string headline — not refinement logic.
      const spec = request.schema.parse(block.input);
      const usage = toUsage(body.usage);

      return { spec, ...(usage ? { usage } : {}) };
    },
  };
}

/**
 * Calls the transport, and says what went wrong when it never answered.
 *
 * `fetch` reports every transport fault as the same `TypeError: fetch failed`
 * and hides the reason in `cause` — so a refused connection, a DNS failure and
 * a socket reset are indistinguishable in a log. An operator needs to tell
 * those apart, and none of them carries request content.
 */
async function send(call: typeof globalThis.fetch, url: string, init: RequestInit) {
  try {
    return await call(url, init);
  } catch (error) {
    // The caller's own deadline. It means something specific upstream, so it
    // travels unchanged.
    if (init.signal?.aborted) throw error;

    const cause = error instanceof Error ? (error.cause ?? error) : error;
    const detail =
      cause && typeof cause === 'object' && 'code' in cause
        ? String((cause as { code: unknown }).code)
        : String(cause instanceof Error ? cause.message : cause);

    throw new Error(`anthropic did not answer: ${detail}`, { cause: error });
  }
}

/** The vendor's error category, never its message — the message quotes the request. */
async function errorCategory(response: Response): Promise<string> {
  try {
    const body: unknown = JSON.parse(await response.text());
    const type = (body as { error?: { type?: unknown } })?.error?.type;
    return typeof type === 'string' ? ` (${type})` : '';
  } catch {
    // A body that is unreadable or not JSON tells us nothing extra. The status
    // is still in the message.
    return '';
  }
}

function toUsage(usage: Record<string, unknown> | undefined): TokenUsage | undefined {
  if (!usage) return undefined;

  // A JSON body is untrusted: `"input_tokens": "11"` must not become part of
  // a cost figure that downstream code adds instead of concatenates.
  const numberAt = (key: string): number | undefined => {
    const value = usage[key];
    return typeof value === 'number' ? value : undefined;
  };

  const inputTokens = numberAt('input_tokens');
  const outputTokens = numberAt('output_tokens');
  const cacheReadTokens = numberAt('cache_read_input_tokens');
  const cacheWriteTokens = numberAt('cache_creation_input_tokens');

  const mapped = {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
  };

  return Object.keys(mapped).length > 0 ? mapped : undefined;
}
