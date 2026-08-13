import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import type { ComponentProvider, ProviderRequest, ProviderResult } from '@rudra/core';

/**
 * OpenAI adapter for the LLM Component.
 *
 * Exists so the architecture's LLM Component can be swapped without touching
 * the BackEnd Layer — and so generation latency and output quality can be
 * compared across vendors on identical prompts and an identical output schema,
 * which is what a credible evaluation section needs.
 *
 * Uses strict JSON-schema structured outputs, so the model is constrained to
 * the same spec contract the Anthropic adapter is held to. The shared schema
 * is written to satisfy strict mode: no recursion, no length or numeric
 * constraints, and optionality expressed as nullable rather than optional.
 */

export interface OpenAIProviderOptions {
  /** Falls back to the OPENAI_API_KEY environment variable. */
  apiKey?: string;
  /**
   * Must be a model that supports strict JSON-schema structured outputs.
   * Defaults to 'gpt-4.1'; override to whatever your account is provisioned for.
   */
  model?: string;
  /** Output ceiling. The spec is small; 2048 is comfortable headroom. */
  maxTokens?: number;
  /** Supply a pre-configured client to control retries, base URL, or timeouts. */
  client?: OpenAI;
}

const DEFAULT_MODEL = 'gpt-4.1';
const SCHEMA_NAME = 'rudra_component_spec';

/** Distinguishes "the model declined" from "the call failed". */
export class OpenAIRefusalError extends Error {
  constructor(refusal: string) {
    super(`model refused the request: ${refusal}`);
    this.name = 'OpenAIRefusalError';
  }
}

export function createOpenAIProvider(options: OpenAIProviderOptions = {}): ComponentProvider {
  const model = options.model ?? DEFAULT_MODEL;
  const maxTokens = options.maxTokens ?? 2048;

  const client =
    options.client ??
    new OpenAI({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      // The generator owns the wall-clock budget and aborts; leaving SDK
      // retries on would let a retry outlive the render it was for.
      maxRetries: 0,
    });

  return {
    name: 'openai',
    model,

    async generate(request: ProviderRequest): Promise<ProviderResult> {
      const completion = await client.chat.completions.parse(
        {
          model,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          response_format: zodResponseFormat(request.schema, SCHEMA_NAME),
        },
        { signal: request.signal },
      );

      const message = completion.choices[0]?.message;
      if (!message) {
        throw new Error('openai returned no choices');
      }
      if (message.refusal) {
        throw new OpenAIRefusalError(message.refusal);
      }
      if (!message.parsed) {
        throw new Error(
          `openai returned no parsed output (finish_reason: ${completion.choices[0]?.finish_reason})`,
        );
      }

      return {
        spec: message.parsed,
        usage: {
          inputTokens: completion.usage?.prompt_tokens,
          outputTokens: completion.usage?.completion_tokens,
          cacheReadTokens: completion.usage?.prompt_tokens_details?.cached_tokens,
        },
      };
    },
  };
}
