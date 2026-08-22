import {
  SPEC_VERSION,
  generatedSpecSchema,
  type ComponentSpec,
  type GeneratedSpec,
  type SpecSource,
} from './component-spec.js';
import { buildFallbackSpec } from './fallback-component.js';
import { buildPrompt } from './model-prompt.js';
import type { ComponentProvider, TokenUsage } from './provider.js';
import { reconcileSpec } from './reconciliation.js';
import { buildDigest, type SignalDigest } from './signal-digest.js';
import { createMemorySpecCache, specCacheKey, type SpecCache } from './spec-cache.js';
import {
  parseTrackingInput,
  type TrackingInput,
  type TrackingInputDraft,
} from './tracking-input.js';

/**
 * Turns one tracking payload into one renderable component.
 *
 * Everything else in this package is a piece of that sentence; this module is
 * the order they go in. It is deliberately the only place that knows the whole
 * sequence, and it is written as a straight line so the sequence is readable:
 *
 *   validate → digest → cache → generate → reconcile → render
 *
 * The single promise it makes to a caller is that `generate` always returns
 * something renderable. A model that is slow, refusing, erroring, rate-limited
 * or simply not configured produces the deterministic component instead. The
 * only way it rejects is a malformed payload, which is a caller bug and should
 * be loud.
 */

/** Reported for every generation, so cost and hit rate are measurable. */
export type GenerationEvent =
  | { type: 'cache_hit'; key: string; elapsedMs: number }
  | {
      type: 'generated';
      key: string;
      elapsedMs: number;
      provider: string;
      model: string;
      violations: string[];
      usage?: TokenUsage;
    }
  | { type: 'fallback'; key: string | null; elapsedMs: number; reason: string };

export interface ComponentGeneratorOptions {
  /**
   * Omit to run without a model. That is a supported configuration rather than
   * a stub: it is the control arm of the benchmark, and the right setting for
   * anyone who has not yet decided on a provider.
   */
  provider?: ComponentProvider | null;
  /** Defaults to an in-process cache. Pass `createNullSpecCache()` to disable. */
  cache?: SpecCache;
  /**
   * How long the model gets. Past this the deterministic component renders and
   * the request is aborted. Defaults to 1500ms.
   */
  modelTimeoutMs?: number;
  /**
   * How long the cache gets. The shipped caches cannot exceed it, but the store
   * is a port a host implements — a hung Redis read on the render path would
   * hold the page open, which is exactly what this module exists to prevent.
   */
  cacheTimeoutMs?: number;
  /** Observability. Never allowed to break a render. */
  onEvent?: (event: GenerationEvent) => void;
}

export interface ComponentGenerator {
  generate(input: TrackingInputDraft): Promise<ComponentSpec>;
  /** The deterministic component, without consulting a model or a cache. */
  generateDeterministic(input: TrackingInputDraft): ComponentSpec;
}

class TimeoutError extends Error {
  constructor(label: string, milliseconds: number) {
    super(`${label} exceeded ${milliseconds}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Races a promise against a deadline.
 *
 * The deadline is enforced here rather than trusted to the thing being waited
 * on. A provider that ignores its abort signal, or a store that never settles,
 * must still not hold a page open.
 */
async function withinBudget<T>(
  label: string,
  milliseconds: number,
  start: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(label, milliseconds));
    }, milliseconds);
  });

  try {
    return await Promise.race([start(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Collapses concurrent work for the same key into one execution.
 *
 * Without this, a key that is not yet cached fans out into one model call per
 * concurrent request — the same answer, bought many times over. The entry is
 * removed as soon as it settles, so one failure does not poison the next
 * attempt.
 */
function createSingleFlight<T>() {
  const inFlight = new Map<string, Promise<T>>();

  return {
    run(key: string, task: () => Promise<T>): Promise<T> {
      const existing = inFlight.get(key);
      if (existing) return existing;

      const started = task().finally(() => inFlight.delete(key));
      inFlight.set(key, started);
      return started;
    },
  };
}

/** Attaches the provenance the server owns. The model never supplies any of it. */
function withProvenance(
  spec: GeneratedSpec,
  provenance: Omit<ComponentSpec, keyof GeneratedSpec | 'specVersion'>,
): ComponentSpec {
  return { ...spec, specVersion: SPEC_VERSION, ...provenance };
}

export function createComponentGenerator(
  options: ComponentGeneratorOptions = {},
): ComponentGenerator {
  const provider = options.provider ?? null;
  const cache = options.cache ?? createMemorySpecCache();
  const modelTimeoutMs = options.modelTimeoutMs ?? 1_500;
  const cacheTimeoutMs = options.cacheTimeoutMs ?? 50;
  const singleFlight = createSingleFlight<GeneratedSpec | null>();

  const report = (event: GenerationEvent): void => {
    if (!options.onEvent) return;
    try {
      options.onEvent(event);
    } catch {
      // A broken metrics hook must not take down a page.
    }
  };

  const deterministic = (
    input: TrackingInput,
    digest: SignalDigest,
    startedAt: number,
    key: string | null,
    reason: string,
  ): ComponentSpec => {
    const elapsedMs = Date.now() - startedAt;
    report({ type: 'fallback', key, elapsedMs, reason });

    return withProvenance(buildFallbackSpec(input, digest), {
      slot: digest.slot,
      source: 'fallback',
      generatedAt: Date.now(),
      latencyMs: elapsedMs,
      provider: null,
      model: null,
      degradedReason: reason,
    });
  };

  /** Reads the cache, treating any failure as a miss. */
  const readCache = async (key: string): Promise<GeneratedSpec | undefined> => {
    try {
      return await withinBudget('cache read', cacheTimeoutMs, () => cache.get(key));
    } catch {
      // A store that is down or slow degrades to generating, not to an error
      // page. Nothing here is worth failing a render over.
      return undefined;
    }
  };

  /**
   * Asks the model, and returns null when it produced nothing usable — which is
   * different from throwing, which means it failed.
   */
  const askModel = async (
    active: ComponentProvider,
    input: TrackingInput,
    digest: SignalDigest,
    key: string,
  ): Promise<GeneratedSpec | null> => {
    const { system, user } = buildPrompt(input, digest);
    const askedAt = Date.now();

    const result = await withinBudget('generation', modelTimeoutMs, (signal) =>
      active.generate({ system, user, schema: generatedSpecSchema, signal }),
    );

    // Providers return parsed objects, but the shape is still model output.
    const parsed = generatedSpecSchema.safeParse(result.spec);
    if (!parsed.success) return null;

    const reconciled = reconcileSpec(parsed.data, input, digest);
    report({
      type: 'generated',
      key,
      elapsedMs: Date.now() - askedAt,
      provider: active.name,
      model: active.model,
      violations: reconciled.violations,
      ...(result.usage ? { usage: result.usage } : {}),
    });

    return reconciled.isUsable ? parsed.data : null;
  };

  return {
    generateDeterministic(draft) {
      const startedAt = Date.now();
      const input = parseTrackingInput(draft);
      return deterministic(input, buildDigest(input), startedAt, null, 'requested');
    },

    async generate(draft) {
      const startedAt = Date.now();
      // Deliberately unguarded: an invalid payload is a caller bug, not a
      // degraded render.
      const input = parseTrackingInput(draft);
      const digest = buildDigest(input);

      if (!provider) {
        return deterministic(input, digest, startedAt, null, 'no-provider');
      }

      const key = specCacheKey(
        digest,
        input.candidates.map((product) => product.sku),
        `${provider.name}:${provider.model}`,
      );

      let spec = await readCache(key);
      let source: SpecSource = 'cache';

      if (spec) {
        report({ type: 'cache_hit', key, elapsedMs: Date.now() - startedAt });
      } else {
        source = 'llm';
        try {
          spec =
            (await singleFlight.run(key, () => askModel(provider, input, digest, key))) ??
            undefined;
        } catch (error) {
          const reason = error instanceof TimeoutError ? 'timeout' : 'provider-error';
          return deterministic(input, digest, startedAt, key, reason);
        }

        if (!spec) {
          return deterministic(input, digest, startedAt, key, 'unusable-generation');
        }

        // Stored unreconciled on purpose. Reconciliation checks stock and the
        // shopper's live signals, and both move independently of this key — a
        // product can sell out without the candidate list changing. Reconciling
        // on the way out rather than on the way in means a cached component can
        // never outlive the facts it was checked against.
        await cache.set(key, spec).catch(() => {
          // A store that cannot be written is not a reason to fail a render.
        });
      }

      // One place where anything is served, whether it came from the model a
      // moment ago or from the cache a minute ago. Both are checked against the
      // same live facts.
      const reconciled = reconcileSpec(spec, input, digest);
      if (!reconciled.isUsable) {
        return deterministic(input, digest, startedAt, key, 'unusable-on-serve');
      }

      return withProvenance(reconciled.spec, {
        slot: digest.slot,
        source,
        generatedAt: Date.now(),
        latencyMs: Date.now() - startedAt,
        provider: provider.name,
        model: provider.model,
      });
    },
  };
}
