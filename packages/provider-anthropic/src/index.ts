import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { ComponentProvider, ProviderRequest, ProviderResult } from '@rudra/core';

/**
 * Anthropic adapter for the LLM Component.
 *
 * Two things matter on this path, both of them latency:
 *
 *  - Structured outputs. The schema is enforced server-side and parsed by the
 *    SDK, so there is no parse-retry loop on the critical rendering path. This
 *    lives on `client.beta.messages.parse`, which also sets the required beta
 *    header for us.
 *  - Prompt caching. The system prompt is byte-stable per deployment and is
 *    marked as a cache breakpoint, so only the per-shopper segment is billed
 *    and processed at full rate. `@rudra/core` builds the prompt with exactly
 *    this split in mind.
 *
 * SDK retries are disabled: the generator owns the wall-clock budget, and a
 * retry that outlives the render it was issued for is pure cost.
 */

export interface AnthropicProviderOptions {
  /** Falls back to the ANTHROPIC_API_KEY environment variable. */
  apiKey?: string;
  /** Defaults to 'claude-opus-5'. */
  model?: string;
  /** Output ceiling. The spec is small; 2048 is comfortable headroom. */
  maxTokens?: number;
  /** Supply a pre-configured client to control retries, base URL, or timeouts. */
  client?: Anthropic;
}

const DEFAULT_MODEL = 'claude-opus-5';

/**
 * Raised when safety classifiers decline the request. Distinct from a transport
 * failure: the call succeeded, the model declined to answer. The generator
 * treats it as a degraded generation and renders the deterministic fallback.
 */
export class AnthropicRefusalError extends Error {
  constructor() {
    super('model refused the request');
    this.name = 'AnthropicRefusalError';
  }
}

export function createAnthropicProvider(
  options: AnthropicProviderOptions = {},
): ComponentProvider {
  const model = options.model ?? DEFAULT_MODEL;
  const maxTokens = options.maxTokens ?? 2048;

  const client =
    options.client ??
    new Anthropic({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      maxRetries: 0,
    });

  return {
    name: 'anthropic',
    model,

    async generate(request: ProviderRequest): Promise<ProviderResult> {
      const response = await client.beta.messages.parse(
        {
          model,
          max_tokens: maxTokens,
          // Array form so the stable prefix can carry a cache breakpoint.
          // Everything volatile is in the user turn, after this boundary.
          system: [
            {
              type: 'text',
              text: request.system,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: request.user }],
          output_format: betaZodOutputFormat(request.schema),
        },
        { signal: request.signal },
      );

      // Check the stop reason before touching content: a refusal returns a
      // successful HTTP response whose content is empty or partial.
      if (response.stop_reason === 'refusal') {
        throw new AnthropicRefusalError();
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
