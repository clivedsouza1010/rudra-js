import { buildDigest, type SignalDigest } from './digest.js';
import { buildFallbackSpec } from './fallback.js';
import { buildPrompt } from './prompt.js';
import { reconcileSpec } from './reconcile.js';
import {
  cacheKey,
  createMemoryCache,
  createSingleFlight,
  fingerprintPrompt,
  type SpecCache,
} from './cache.js';
import { generatedSpecSchema, SPEC_VERSION, type ComponentSpec, type GeneratedSpec } from './spec.js';
import type { ComponentProvider } from './provider.js';
import { parseTrackingInput, type TrackingInput, type TrackingInputDraft } from './tracking-input.js';

/**
 * The BackEnd Layer.
 *
 * Takes one tracking payload, returns one renderable component spec, and is
 * bounded on every axis that could otherwise block server-side rendering:
 *
 *   validate → digest → cache lookup → single-flight model call (under a hard
 *   wall-clock budget) → reconcile → render, with a deterministic fallback at
 *   every failure point.
 *
 * `generate()` never rejects for a model-side reason. The only way it throws is
 * a malformed tracking payload, which is a caller bug and should be loud.
 */

export type GenerationEvent =
  | { type: 'cache_hit'; key: string; latencyMs: number }
  | {
      type: 'generated';
      key: string;
      latencyMs: number;
      provider: string;
      model: string;
      violations: string[];
      usage?: Record<string, number | undefined>;
    }
  | { type: 'fallback'; key: string | null; latencyMs: number; reason: string }
  | { type: 'error'; key: string | null; reason: string; error: unknown };

export interface GeneratorOptions {
  /**
   * Omit (or pass null) to run fallback-only. That is a supported production
   * mode, not just a test stub: it is the control arm of the SSR benchmark and
   * the correct configuration when no API key is present.
   */
  provider?: ComponentProvider | null;
  /** Defaults to a 60s in-process TTL cache. Pass `createNoopCache()` to disable. */
  cache?: SpecCache;
  /**
   * Wall-clock budget for the model call. When it elapses the fallback spec is
   * returned and the in-flight request is aborted. Defaults to 1200ms — chosen
   * to sit under a typical SSR budget rather than to be generous to the model.
   */
  timeoutMs?: number;
  /** Observability hook. Never throws into the render path. */
  onEvent?: (event: GenerationEvent) => void;
}

export interface Generator {
  generate(input: TrackingInputDraft): Promise<ComponentSpec>;
  /** Signals-only spec. Synchronous, pure, and always available. */
  generateFallback(input: TrackingInputDraft): ComponentSpec;
  readonly provider: ComponentProvider | null;
  readonly cache: SpecCache;
}

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`generation exceeded ${ms}ms budget`);
    this.name = 'TimeoutError';
  }
}

function finalise(
  spec: GeneratedSpec,
  meta: Omit<ComponentSpec, keyof GeneratedSpec | 'specVersion'>,
): ComponentSpec {
  return { ...spec, specVersion: SPEC_VERSION, ...meta };
}

export function createGenerator(options: GeneratorOptions = {}): Generator {
  const provider = options.provider ?? null;
  const cache = options.cache ?? createMemoryCache();
  const timeoutMs = options.timeoutMs ?? 1_200;
  const singleFlight = createSingleFlight<GeneratedSpec | null>();

  const emit = (event: GenerationEvent): void => {
    if (!options.onEvent) return;
    try {
      options.onEvent(event);
    } catch {
      // An instrumentation bug must never take down a page render.
    }
  };

  const fallbackSpec = (
    input: TrackingInput,
    digest: SignalDigest,
    startedAt: number,
    key: string | null,
    reason: string,
  ): ComponentSpec => {
    const spec = buildFallbackSpec(input, digest);
    const latencyMs = Date.now() - startedAt;
    emit({ type: 'fallback', key, latencyMs, reason });
    return finalise(spec, {
      slot: digest.slot,
      source: 'fallback',
      generatedAt: Date.now(),
      latencyMs,
      provider: null,
      model: null,
      degradedReason: reason,
    });
  };

  /**
   * Runs the provider under a hard budget. Resolves to null when the model
   * produced nothing usable — distinct from throwing, which means it failed.
   */
  const callProvider = async (
    activeProvider: ComponentProvider,
    input: TrackingInput,
    digest: SignalDigest,
    system: string,
    user: string,
    key: string,
  ): Promise<GeneratedSpec | null> => {
    const calledAt = Date.now();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const budget = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new TimeoutError(timeoutMs));
      }, timeoutMs);
    });

    try {
      // Race rather than relying on the adapter to honour the signal — a
      // provider that ignores abort must still not hold the page open.
      const result = await Promise.race([
        activeProvider.generate({ system, user, schema: generatedSpecSchema, signal: controller.signal }),
        budget,
      ]);

      // Providers return parsed objects, but the shape is still model output.
      const parsed = generatedSpecSchema.safeParse(result.spec);
      if (!parsed.success) return null;

      const reconciled = reconcileSpec(parsed.data, input, digest);
      emit({
        type: 'generated',
        key,
        latencyMs: Date.now() - calledAt,
        provider: activeProvider.name,
        model: activeProvider.model,
        violations: reconciled.violations,
        ...(result.usage ? { usage: result.usage } : {}),
      });

      return reconciled.usable ? reconciled.spec : null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  return {
    provider,
    cache,

    generateFallback(draft) {
      const startedAt = Date.now();
      const input = parseTrackingInput(draft);
      const digest = buildDigest(input);
      return fallbackSpec(input, digest, startedAt, null, 'requested');
    },

    async generate(draft) {
      const startedAt = Date.now();
      // Deliberately unguarded: an invalid payload is a caller bug.
      const input = parseTrackingInput(draft);
      const digest = buildDigest(input);

      if (!provider) {
        return fallbackSpec(input, digest, startedAt, null, 'no-provider');
      }

      const { system, user } = buildPrompt(input, digest);
      const key = cacheKey(
        digest,
        input.candidates.map((c) => c.sku),
        `${provider.name}:${provider.model}`,
        fingerprintPrompt(system),
      );

      const cached = cache.get(key);
      if (cached) {
        const latencyMs = Date.now() - startedAt;
        emit({ type: 'cache_hit', key, latencyMs });
        return finalise(cached, {
          slot: digest.slot,
          source: 'cache',
          generatedAt: Date.now(),
          latencyMs,
          provider: provider.name,
          model: provider.model,
        });
      }

      let spec: GeneratedSpec | null;
      try {
        // Reconciliation depends only on fields already encoded in the cache
        // key, so every caller sharing a key would reconcile identically —
        // which is what makes it safe to cache the reconciled spec.
        spec = await singleFlight.run(key, () =>
          callProvider(provider, input, digest, system, user, key),
        );
      } catch (error) {
        const reason = error instanceof TimeoutError ? 'timeout' : 'provider-error';
        emit({ type: 'error', key, reason, error });
        return fallbackSpec(input, digest, startedAt, key, reason);
      }

      if (spec === null) {
        return fallbackSpec(input, digest, startedAt, key, 'unusable-generation');
      }

      cache.set(key, spec);
      return finalise(spec, {
        slot: digest.slot,
        source: 'llm',
        generatedAt: Date.now(),
        latencyMs: Date.now() - startedAt,
        provider: provider.name,
        model: provider.model,
      });
    },
  };
}
