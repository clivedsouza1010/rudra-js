import { z } from 'zod';
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
import {
  createMemorySpecCache,
  specCacheKey,
  type CachedSpec,
  type SpecCache,
} from './spec-cache.js';
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

/**
 * Reported exactly once per call to `generate`, whatever happened.
 *
 * One flat shape rather than a variant per outcome, because the numbers the
 * evaluation needs are ratios over all calls — hit rate, fallback share, model
 * calls and cost per thousand views. A variant that some callers do not emit
 * makes every one of those ratios wrong by however many it skipped, which is
 * what happened when requests that joined an in-flight generation reported
 * nothing at all.
 */
export interface GenerationEvent {
  /** Null when no key was computed, which means no provider was configured. */
  key: string | null;
  source: SpecSource;
  /** Wall-clock milliseconds for the whole call. */
  elapsedMs: number;
  /**
   * True for the caller that sent the request, on every outcome — including a
   * call that timed out, errored or came back unparseable. Requests that joined
   * an in-flight generation share its answer and its usage figures, so cost
   * must be summed over this flag rather than over every event.
   *
   * It counts requests sent, which is an upper bound on requests billed: an
   * adapter that throws before it reaches the vendor looks the same from here
   * as one that throws after. An upper bound is the useful direction — the
   * calls that produce nothing are the ones worth seeing, and reporting them as
   * no call at all hides them completely.
   */
  calledModel: boolean;
  /** What reconciliation removed. Absent when no spec was reconciled. */
  violations?: string[];
  usage?: TokenUsage;
  degradedReason?: string;
}

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
 *
 * Once the deadline has fired the caller is told so, whatever the race
 * actually settled with. Aborting is what makes that necessary: a provider
 * honouring its half of the contract rejects from inside the `abort()` below,
 * so its rejection reaches the race first and the deadline's own never wins.
 * Reporting the error that happened to arrive would blame the vendor for the
 * caller's deadline — and blame it most often on the best-behaved adapters.
 */
async function withinBudget<T>(
  label: string,
  milliseconds: number,
  start: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired: TimeoutError | undefined;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      expired = new TimeoutError(label, milliseconds);
      controller.abort();
      reject(expired);
    }, milliseconds);
  });

  try {
    return await Promise.race([start(controller.signal), deadline]);
  } catch (error) {
    throw expired ?? error;
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
    isRunning: (key: string) => inFlight.has(key),

    run(key: string, task: () => Promise<T>): Promise<T> {
      const existing = inFlight.get(key);
      if (existing) return existing;

      const started = task().finally(() => inFlight.delete(key));
      inFlight.set(key, started);
      return started;
    },
  };
}

/** A cache entry is no more trustworthy than model output, so it is parsed too. */
const cachedSpecSchema = z.object({
  spec: generatedSpecSchema,
  generatedAt: z.number(),
});

/** What the model said, plus what it cost. */
/**
 * What one call to the model produced.
 *
 * `spec` is null when the answer did not satisfy the schema. `usage` is carried
 * either way: the request went out and was paid for whether or not anything
 * usable came back, and those are the calls most worth seeing.
 */
interface ModelCall {
  spec: GeneratedSpec | null;
  usage?: TokenUsage;
}

/** A model call whose answer can be reconciled and served. */
interface ModelAnswer extends ModelCall {
  spec: GeneratedSpec;
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
  const singleFlight = createSingleFlight<ModelCall>();

  const report = (event: GenerationEvent): void => {
    if (!options.onEvent) return;
    try {
      options.onEvent(event);
    } catch {
      // A broken metrics hook must not take down a page.
    }
  };

  const buildDeterministic = (
    input: TrackingInput,
    digest: SignalDigest,
    startedAt: number,
    key: string | null,
    degradedReason: string,
    /**
     * What the model call cost, when there was one. A generation that is
     * unusable for this shopper was still asked for and still billed, so
     * omitting it here would hide the calls that produce nothing — exactly the
     * ones worth knowing about.
     */
    modelCall: Pick<GenerationEvent, 'calledModel' | 'usage' | 'violations'> = {
      calledModel: false,
    },
  ): ComponentSpec => {
    const finishedAt = Date.now();
    report({
      key,
      source: 'fallback',
      elapsedMs: finishedAt - startedAt,
      ...modelCall,
      degradedReason,
    });

    return withProvenance(buildFallbackSpec(input, digest), {
      slot: digest.slot,
      source: 'fallback',
      generatedAt: finishedAt,
      latencyMs: finishedAt - startedAt,
      provider: null,
      model: null,
      degradedReason,
    });
  };

  /**
   * Reads the cache, treating anything unexpected as a miss.
   *
   * The value is re-validated because a store is a port a host implements, and
   * what comes back is no more trustworthy than what a model returns — a shared
   * store outlives a deploy, so it can hold entries written by an older shape of
   * the spec. Generating again is always safe; handing an unvalidated object to
   * reconciliation is not.
   */
  const readCache = async (key: string): Promise<CachedSpec | undefined> => {
    try {
      const stored = await withinBudget('cache read', cacheTimeoutMs, () => cache.get(key));
      const parsed = cachedSpecSchema.safeParse(stored);
      return parsed.success ? parsed.data : undefined;
    } catch {
      // A store that is down or slow degrades to generating, not to an error
      // page. Nothing here is worth failing a render over.
      return undefined;
    }
  };

  /**
   * Writes to the cache without the render waiting for it.
   *
   * The spec is already in hand; nothing downstream needs the write to finish.
   * Awaiting it put a second unbounded call to a host-implemented store on the
   * render path, which is the failure this module exists to prevent arriving
   * through the other door. The `Promise.resolve` wrapper is what catches a
   * store that throws synchronously rather than rejecting.
   */
  const storeInBackground = (key: string, cached: CachedSpec): void => {
    void Promise.resolve()
      .then(() => cache.set(key, cached))
      .catch(() => {
        // A store that cannot be written is not a reason to fail a render.
      });
  };

  /**
   * Asks the model.
   *
   * Deliberately does not decide whether the answer is usable. That depends on
   * the asking shopper's live facts — stock, dislikes, what is in their basket
   * — and none of those are in the cache key, so a verdict reached here would
   * be handed to every request that joined this one. A null `spec` in the
   * result means the answer did not satisfy the schema, which is a fault of the
   * adapter rather than a judgement about any shopper — and is still a call
   * that happened, so its usage comes back with it.
   */
  const askModel = async (
    active: ComponentProvider,
    input: TrackingInput,
    digest: SignalDigest,
  ): Promise<ModelCall> => {
    const { system, user } = buildPrompt(input, digest);

    const result = await withinBudget('generation', modelTimeoutMs, (signal) =>
      active.generate({ system, user, schema: generatedSpecSchema, signal }),
    );

    // Providers return parsed objects, but the shape is still model output.
    const parsed = generatedSpecSchema.safeParse(result.spec);

    return {
      spec: parsed.success ? parsed.data : null,
      ...(result.usage ? { usage: result.usage } : {}),
    };
  };

  return {
    generateDeterministic(draft) {
      const startedAt = Date.now();
      const input = parseTrackingInput(draft);
      return buildDeterministic(input, buildDigest(input), startedAt, null, 'requested');
    },

    async generate(draft) {
      const startedAt = Date.now();
      // Deliberately unguarded: an invalid payload is a caller bug, not a
      // degraded render.
      const input = parseTrackingInput(draft);
      const digest = buildDigest(input);

      if (!provider) {
        return buildDeterministic(input, digest, startedAt, null, 'no-provider');
      }

      const key = specCacheKey(
        digest,
        input.candidates.map((product) => product.sku),
        `${provider.name}:${provider.model}`,
      );

      const cached = await readCache(key);
      let calledModel = false;
      let answer: ModelAnswer;
      // When the model produced this, not when it was served. A cached
      // component is not newly generated, and pretending otherwise makes any
      // measure of how stale a page is showing read as zero.
      let generatedAt: number;

      if (cached) {
        answer = { spec: cached.spec };
        generatedAt = cached.generatedAt;
      } else {
        // Asked before joining, because by the time the shared promise settles
        // the entry is gone and there is no way to tell a leader from a
        // follower — and they must not both be counted as a model call.
        calledModel = !singleFlight.isRunning(key);

        let call: ModelCall;
        try {
          call = await singleFlight.run(key, () => askModel(provider, input, digest));
        } catch (error) {
          const reason = error instanceof TimeoutError ? 'timeout' : 'provider-error';
          // The request went out. Leaving `calledModel` to default here reported
          // every failed call as no call at all, so the calls that cost money
          // and produced nothing were the only ones missing from the count.
          return buildDeterministic(input, digest, startedAt, key, reason, { calledModel });
        }

        if (!call.spec) {
          return buildDeterministic(input, digest, startedAt, key, 'invalid-generation', {
            calledModel,
            ...(call.usage ? { usage: call.usage } : {}),
          });
        }

        answer = { spec: call.spec, ...(call.usage ? { usage: call.usage } : {}) };
        generatedAt = Date.now();

        // Stored unreconciled on purpose, and stored even when it is unusable
        // for this shopper. Reconciliation narrows a spec to one shopper's live
        // facts, and those move independently of the key — a product can sell
        // out and come back without the candidate list changing. Keeping what
        // the model said means the restock is picked up from cache rather than
        // paid for again.
        if (calledModel) storeInBackground(key, { spec: answer.spec, generatedAt });
      }

      // One place where anything is served, whichever side of the cache it came
      // from, and always against the facts of the shopper asking now.
      const reconciled = reconcileSpec(answer.spec, input, digest);
      if (!reconciled.isUsable) {
        return buildDeterministic(input, digest, startedAt, key, 'unusable-on-serve', {
          calledModel,
          violations: reconciled.violations,
          ...(answer.usage ? { usage: answer.usage } : {}),
        });
      }

      const finishedAt = Date.now();
      const source: SpecSource = cached ? 'cache' : 'llm';
      report({
        key,
        source,
        elapsedMs: finishedAt - startedAt,
        calledModel,
        violations: reconciled.violations,
        ...(answer.usage ? { usage: answer.usage } : {}),
      });

      return withProvenance(reconciled.spec, {
        slot: digest.slot,
        source,
        generatedAt,
        latencyMs: finishedAt - startedAt,
        provider: provider.name,
        model: provider.model,
      });
    },
  };
}
