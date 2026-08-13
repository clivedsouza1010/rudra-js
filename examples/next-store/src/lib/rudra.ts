import 'server-only';
import { createGenerator, createMemoryCache, type ComponentProvider } from '@rudra/core';

/**
 * Wires the BackEnd Layer from the environment.
 *
 * Provider selection is deliberately runtime, not build-time: the same image
 * runs the Anthropic arm, the OpenAI arm, and the fallback-only control arm of
 * the benchmark by changing one variable.
 */

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function resolveProvider(): Promise<ComponentProvider | null> {
  const choice = (process.env.RUDRA_PROVIDER ?? 'none').toLowerCase();

  if (choice === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn('[rudra] RUDRA_PROVIDER=anthropic but ANTHROPIC_API_KEY is unset; using fallback only.');
      return null;
    }
    const { createAnthropicProvider } = await import('@rudra/provider-anthropic');
    return createAnthropicProvider({
      ...(process.env.RUDRA_ANTHROPIC_MODEL ? { model: process.env.RUDRA_ANTHROPIC_MODEL } : {}),
    });
  }

  if (choice === 'openai') {
    if (!process.env.OPENAI_API_KEY) {
      console.warn('[rudra] RUDRA_PROVIDER=openai but OPENAI_API_KEY is unset; using fallback only.');
      return null;
    }
    const { createOpenAIProvider } = await import('@rudra/provider-openai');
    return createOpenAIProvider({
      ...(process.env.RUDRA_OPENAI_MODEL ? { model: process.env.RUDRA_OPENAI_MODEL } : {}),
    });
  }

  return null;
}

/**
 * One generator per process. The cache and the single-flight map live on it,
 * so constructing it per request would defeat both.
 */
let generatorPromise: ReturnType<typeof build> | undefined;

async function build() {
  const provider = await resolveProvider();

  return createGenerator({
    provider,
    cache: createMemoryCache({ ttlMs: readInt('RUDRA_CACHE_TTL_MS', 60_000) }),
    timeoutMs: readInt('RUDRA_TIMEOUT_MS', 1_200),
    onEvent(event) {
      // Structured, one line per generation: this is what the benchmark reads
      // to separate cache hits from live generations from degraded renders.
      if (event.type === 'generated') {
        console.log(
          `[rudra] generated key=${event.key} ${event.provider}/${event.model} ${event.latencyMs}ms` +
            (event.violations.length ? ` violations=${event.violations.join(',')}` : ''),
        );
      } else if (event.type === 'fallback') {
        console.log(`[rudra] fallback reason=${event.reason} ${event.latencyMs}ms`);
      } else if (event.type === 'error') {
        console.error(`[rudra] error reason=${event.reason}`, event.error);
      }
    },
  });
}

export function getGenerator() {
  generatorPromise ??= build();
  return generatorPromise;
}
