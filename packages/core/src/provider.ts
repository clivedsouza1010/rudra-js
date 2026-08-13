import type { z } from 'zod';
import type { GeneratedSpec } from './spec.js';

/**
 * The LLM port.
 *
 * `@rudra/core` has no model-vendor dependency. Adapters live in their own
 * packages (`@rudra/provider-anthropic`, `@rudra/provider-openai`) and are the
 * only place a vendor SDK is imported, so a host installs exactly one.
 */

export interface ProviderRequest {
  /** Stable prefix. Adapters that support prompt caching should cache this. */
  system: string;
  /** Per-request content. Must not be merged into the cached prefix. */
  user: string;
  /**
   * The Zod schema the response must satisfy. Adapters convert this with their
   * own SDK helper (`zodOutputFormat`, `zodResponseFormat`, ...) so there is no
   * hand-maintained JSON Schema to drift out of sync.
   */
  schema: z.ZodType<GeneratedSpec>;
  /** Cooperative cancellation. Fires when the generator's budget elapses. */
  signal: AbortSignal;
}

export interface ProviderResult {
  spec: GeneratedSpec;
  /** Reported by the adapter; used for observability, not control flow. */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

export interface ComponentProvider {
  /** Short identifier recorded on every generated spec, e.g. 'anthropic'. */
  readonly name: string;
  /** Concrete model identifier, e.g. 'claude-opus-5'. */
  readonly model: string;
  generate(request: ProviderRequest): Promise<ProviderResult>;
}

/**
 * A provider that never calls a network. Returns whatever spec it is given,
 * which makes it the right baseline for the SSR-vs-CSR benchmark: it isolates
 * framework overhead from model latency.
 */
export function createStaticProvider(spec: GeneratedSpec): ComponentProvider {
  return {
    name: 'static',
    model: 'none',
    async generate() {
      return { spec };
    },
  };
}
