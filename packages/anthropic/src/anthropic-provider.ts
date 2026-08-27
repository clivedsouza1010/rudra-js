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
 * The tool schema is derived from the schema core exports rather than written
 * out here. A second copy would be a second vocabulary: the reconciler would
 * enforce one thing and the model would be told another, and the drift would
 * show up as unexplained `invalid-generation` events.
 */
export function createAnthropicProvider(options: AnthropicProviderOptions): ComponentProvider {
  const model = options.model ?? 'claude-opus-5';
  const call = options.fetch ?? globalThis.fetch;
  // Trimmed once so a caller-supplied `baseUrl` ending in `/` cannot turn into
  // `//v1/messages`.
  const baseUrl = (options.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    name: 'anthropic',
    model,

    async generate(request: ProviderRequest): Promise<ProviderResult> {
      const response = await call(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': options.apiKey,
          'anthropic-version': '2023-06-01',
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
        // Read failure must not swallow the status that already told us this
        // failed, and the body itself is untrusted: Anthropic's 400s echo the
        // offending field back, which for us can be `request.user` — a
        // shopper's own content — so it is capped rather than logged whole.
        const detail = await response.text().catch(() => '<unreadable>');
        throw new Error(`anthropic responded ${response.status}: ${detail.slice(0, 500)}`);
      }

      const body = (await response.json()) as {
        content?: unknown;
        usage?: Record<string, unknown>;
        stop_reason?: string;
      };

      // Checked before the tool block: both of these are ordinary 200s with
      // no tool_use, and reporting them as "no tool use" would blame the
      // model for a budget or a policy this adapter controls. Thinking is
      // left on — turning it off is a product decision, not a transport one.
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
