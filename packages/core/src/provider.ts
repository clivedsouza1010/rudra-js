import type { z } from 'zod';
import type { GeneratedSpec } from './component-spec.js';

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ProviderRequest {
  system: string;

  user: string;

  schema: z.ZodType<GeneratedSpec>;

  signal: AbortSignal;
}

export interface ProviderResult {
  spec: GeneratedSpec;
  usage?: TokenUsage;
}

export interface ComponentProvider {
  readonly name: string;

  readonly model: string;
  generate(request: ProviderRequest): Promise<ProviderResult>;
}

export function createFixedSpecProvider(spec: GeneratedSpec): ComponentProvider {
  return {
    name: 'fixed',
    model: 'none',
    generate: async ({ signal }) => {
      signal.throwIfAborted();
      return { spec };
    },
  };
}
