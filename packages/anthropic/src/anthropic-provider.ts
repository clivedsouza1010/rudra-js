import { z } from 'zod';
import type { ComponentProvider, ProviderRequest, ProviderResult } from '@rudra-js/core';

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

interface ToolUseBlock {
  type: string;
  name?: string;
  input?: unknown;
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
  const baseUrl = options.baseUrl ?? 'https://api.anthropic.com';

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
          max_tokens: options.maxTokens ?? 2048,
          // Marked as the cached prefix. Anything per-shopper interpolated here
          // would destroy the prompt cache hit rate.
          system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: request.user }],
          tools: [
            {
              name: TOOL_NAME,
              description: 'Return the component specification.',
              input_schema: z.toJSONSchema(request.schema),
            },
          ],
          tool_choice: { type: 'tool', name: TOOL_NAME },
        }),
      });

      if (!response.ok) {
        throw new Error(`anthropic responded ${response.status}: ${await response.text()}`);
      }

      const body = (await response.json()) as {
        content?: ToolUseBlock[];
        usage?: Record<string, number>;
      };

      const block = body.content?.find(
        (candidate) => candidate.type === 'tool_use' && candidate.name === TOOL_NAME,
      );

      if (!block) {
        throw new Error(`anthropic returned no ${TOOL_NAME} tool use`);
      }

      // Parsed against the caller's own schema, so a spec that satisfies the
      // JSON Schema but not the Zod refinements is caught here rather than
      // reaching reconciliation as a surprise.
      const spec = request.schema.parse(block.input);
      const usage = toUsage(body.usage);

      return { spec, ...(usage ? { usage } : {}) };
    },
  };
}

function toUsage(usage: Record<string, number> | undefined) {
  if (!usage) return undefined;

  const mapped = {
    ...(usage['input_tokens'] === undefined ? {} : { inputTokens: usage['input_tokens'] }),
    ...(usage['output_tokens'] === undefined ? {} : { outputTokens: usage['output_tokens'] }),
    ...(usage['cache_read_input_tokens'] === undefined
      ? {}
      : { cacheReadTokens: usage['cache_read_input_tokens'] }),
    ...(usage['cache_creation_input_tokens'] === undefined
      ? {}
      : { cacheWriteTokens: usage['cache_creation_input_tokens'] }),
  };

  return Object.keys(mapped).length > 0 ? mapped : undefined;
}
