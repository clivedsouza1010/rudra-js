import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ComponentProvider, ProviderRequest, ProviderResult } from '@rudra/core';

/**
 * Anthropic adapter for the LLM Component.
 *
 * Three things matter on this path, all of them latency:
 *
 *  - Structured outputs. The schema is enforced server-side, so there is no
 *    parse-retry loop on the critical rendering path.
 *  - Prompt caching. The system prompt is byte-stable per deployment and is
 *    marked as a cache breakpoint, so only the per-shopper segment is billed
 *    and processed at full rate.
 *  - Effort. Defaults to `low`. Component selection is a judgement call over a
 *    small candidate set, not a reasoning problem, and TTFB is the point of the
 *    whole architecture.
 */

export interface AnthropicProviderOptions {
  /** Falls back to the ANTHROPIC_API_KEY environment variable. */
  apiKey?: string;
  /** Defaults to 'claude-opus-5'. */
  model?: string;
  /**
   * Thinking depth and overall token spend. 'low' is the default here because
   * this call sits inside a server-render budget; raise it if you find the
   * model under-reasoning about which products to pair.
   */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Output ceiling. The spec is small; 2048 is comfortable headroom. */
  maxTokens?: number;
  /** Supply a pre-configured client to control retries, base URL, or timeouts. */
  client?: Anthropic;
}

const DEFAULT_MODEL = 'claude-opus-5';

/** Distinguishes "the model declined" from "the call failed". */
export class AnthropicRefusalError extends Error {
  readonly category: string | null;
  constructor(category: string | null, explanation?: string) {
    super(`model refused the request${explanation ? `: ${explanation}` : ''}`);
    this.name = 'AnthropicRefusalError';
    this.category = category;
  }
}

export function createAnthropicProvider(
  options: AnthropicProviderOptions = {},
): ComponentProvider {
  const model = options.model ?? DEFAULT_MODEL;
  const maxTokens = options.maxTokens ?? 2048;
  const effort = options.effort ?? 'low';

  const client =
    options.client ??
    new Anthropic({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      // The generator owns the wall-clock budget and aborts; leaving SDK
      // retries on would let a retry outlive the render it was for.
      maxRetries: 0,
    });

  return {
    name: 'anthropic',
    model,

    async generate(request: ProviderRequest): Promise<ProviderResult> {
      const response = await client.messages.parse(
        {
          model,
          max_tokens: maxTokens,
          // Array form so the stable prefix can carry a cache breakpoint.
          system: [
            {
              type: 'text',
              text: request.system,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: request.user }],
          output_config: {
            effort,
            format: zodOutputFormat(request.schema),
          },
        },
        { signal: request.signal },
      );

      // Check the stop reason before touching content: a refusal returns a
      // successful HTTP response with empty or partial content.
      if (response.stop_reason === 'refusal') {
        throw new AnthropicRefusalError(
          response.stop_details?.category ?? null,
          response.stop_details?.explanation,
        );
      }

      if (!response.parsed_output) {
        throw new Error(
          `anthropic returned no parsed output (stop_reason: ${response.stop_reason})`,
        );
      }

      return {
        spec: response.parsed_output,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? undefined,
          cacheWriteTokens: response.usage.cache_creation_input_tokens ?? undefined,
        },
      };
    },
  };
}
