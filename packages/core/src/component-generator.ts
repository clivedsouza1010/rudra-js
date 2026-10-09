import { z } from 'zod';
import {
  SPEC_VERSION,
  generatedSpecSchema,
  type ComponentSpec,
  type DegradedReason,
  type GeneratedSpec,
  type SpecSource,
} from './component-spec.js';
import { buildFallbackSpec } from './fallback-component.js';
import { buildPrompt } from './model-prompt.js';
import type { ComponentProvider, TokenUsage } from './provider.js';
import { bundleForShopper, capBlocks, placeableHeroSkus, reconcileSpec } from './reconciliation.js';
import { selectProducts, type RankOrder } from './product-selection.js';
import { fitToShopper, type FittedSpec } from './fit-to-shopper.js';
import { buildDigest, toCohortDigest, type SignalDigest } from './signal-digest.js';
import {
  createMemorySpecCache,
  cohortCacheKey,
  specCacheKey,
  type CachedSpec,
  type SpecCache,
} from './spec-cache.js';
import {
  parseTrackingInput,
  type TrackingInput,
  type TrackingInputDraft,
} from './tracking-input.js';

export interface GenerationEvent {
  key: string | null;
  source: SpecSource;
  elapsedMs: number;
  calledModel: boolean;
  violations?: string[];
  usage?: TokenUsage;
  degradedReason?: DegradedReason;
  error?: unknown;
  cache?: 'hit' | 'miss' | 'error' | 'timeout';
}

export interface ComponentGeneratorOptions {
  provider?: ComponentProvider | null;
  cache?: SpecCache;
  modelTimeoutMs?: number;
  cacheTimeoutMs?: number;
  generation?: 'cohort' | 'per-shopper';
  rank?: RankOrder;
  onEvent?: (event: GenerationEvent) => void;
}

export interface ComponentGenerator {
  generate(input: TrackingInputDraft): Promise<ComponentSpec>;
  generateDeterministic(input: TrackingInputDraft): ComponentSpec;
}

export class TimeoutError extends Error {
  constructor(label: string, milliseconds: number) {
    super(`${label} exceeded ${milliseconds}ms`);
    this.name = 'TimeoutError';
  }
}

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

const cachedSpecSchema = z.object({
  spec: generatedSpecSchema,
  generatedAt: z.number(),
});

interface CacheRead {
  outcome: NonNullable<GenerationEvent['cache']>;
  entry?: CachedSpec;
}

interface ModelCall {
  spec: GeneratedSpec | null;
  usage?: TokenUsage;
}

function fitCohortSpec(
  spec: GeneratedSpec,
  input: TrackingInput,
  digest: SignalDigest,
  rank: RankOrder,
): FittedSpec {
  const picks = selectProducts(input, digest, { rank });
  const blocks = capBlocks(spec.blocks);

  const bundleAt = blocks.findIndex((block) => block.kind === 'bundle');
  if (bundleAt === -1) return fitToShopper(spec, picks, digest.maxItems);

  const heroesAbove = placeableHeroSkus(blocks.slice(0, bundleAt), input);
  const bundle = bundleForShopper(input, digest, heroesAbove);
  if (!bundle) return fitToShopper(spec, picks, digest.maxItems);

  const spokenFor = new Set<string>(bundle.skus);
  for (const sku of placeableHeroSkus(blocks, input)) spokenFor.add(sku);

  const roomLeft = digest.maxItems - spokenFor.size;
  if (roomLeft <= 0) return fitToShopper(spec, picks, digest.maxItems);

  const forGrid = picks.filter((pick) => !spokenFor.has(pick.product.sku));
  return fitToShopper(spec, forGrid, roomLeft);
}

export function createComponentGenerator(
  options: ComponentGeneratorOptions = {},
): ComponentGenerator {
  const provider = options.provider ?? null;
  const cache = options.cache ?? createMemorySpecCache();
  const generation = options.generation ?? 'cohort';
  const rank = options.rank ?? 'signals';
  const modelTimeoutMs = options.modelTimeoutMs ?? 1_500;
  const cacheTimeoutMs = options.cacheTimeoutMs ?? 50;
  const inFlight = new Map<string, Promise<ModelCall>>();

  const report = (event: GenerationEvent): void => {
    if (!options.onEvent) return;
    try {
      options.onEvent(event);
    } catch {}
  };

  const serveFallback = (
    input: TrackingInput,
    digest: SignalDigest,
    startedAt: number,
    key: string | null,
    degradedReason: DegradedReason,
    details: Pick<GenerationEvent, 'calledModel' | 'usage' | 'violations' | 'cache' | 'error'> = {
      calledModel: false,
    },
  ): ComponentSpec => {
    const finishedAt = Date.now();
    report({
      key,
      source: 'fallback',
      elapsedMs: finishedAt - startedAt,
      ...details,
      degradedReason,
    });

    return {
      ...buildFallbackSpec(input, digest, { rank }),
      specVersion: SPEC_VERSION,
      slot: digest.slot,
      source: 'fallback',
      generatedAt: finishedAt,
      latencyMs: finishedAt - startedAt,
      provider: null,
      model: null,
      degradedReason,
    };
  };

  const readCache = async (key: string): Promise<CacheRead> => {
    try {
      const stored = await withinBudget('cache read', cacheTimeoutMs, () => cache.get(key));
      const parsed = cachedSpecSchema.safeParse(stored);
      return parsed.success ? { outcome: 'hit', entry: parsed.data } : { outcome: 'miss' };
    } catch (error) {
      return { outcome: error instanceof TimeoutError ? 'timeout' : 'error' };
    }
  };

  const storeInBackground = (key: string, cached: CachedSpec): void => {
    void Promise.resolve()
      .then(() => cache.set(key, cached))
      .catch(() => {});
  };

  const askModel = async (
    active: ComponentProvider,
    input: TrackingInput,
    promptDigest: SignalDigest,
  ): Promise<ModelCall> => {
    const { system, user } = buildPrompt(input, promptDigest);
    const result = await withinBudget('generation', modelTimeoutMs, (signal) =>
      active.generate({ system, user, schema: generatedSpecSchema, signal }),
    );
    const parsed = generatedSpecSchema.safeParse(result.spec);
    return {
      spec: parsed.success ? parsed.data : null,
      ...(result.usage ? { usage: result.usage } : {}),
    };
  };

  const sharedCall = (key: string, ask: () => Promise<ModelCall>): Promise<ModelCall> => {
    const running = inFlight.get(key);
    if (running) return running;
    const started = ask().finally(() => inFlight.delete(key));
    inFlight.set(key, started);
    return started;
  };

  return {
    generateDeterministic(draft) {
      const startedAt = Date.now();
      const input = parseTrackingInput(draft);
      return serveFallback(input, buildDigest(input), startedAt, null, 'requested');
    },

    async generate(draft) {
      const startedAt = Date.now();
      const input = parseTrackingInput(draft);
      const digest = buildDigest(input);
      if (!provider) return serveFallback(input, digest, startedAt, null, 'no-provider');

      const identity = { name: provider.name, model: provider.model };
      const skus = input.candidates.map((product) => product.sku);
      const key =
        generation === 'cohort'
          ? cohortCacheKey(digest, skus, identity)
          : specCacheKey(digest, skus, identity);

      const read = await readCache(key);
      const cached = read.entry;
      let calledModel = false;
      let spec: GeneratedSpec;
      let usage: TokenUsage | undefined;
      let generatedAt: number;

      if (cached) {
        spec = cached.spec;
        generatedAt = cached.generatedAt;
      } else {
        calledModel = !inFlight.has(key);
        let call: ModelCall;
        try {
          call = await sharedCall(key, () =>
            askModel(provider, input, generation === 'cohort' ? toCohortDigest(digest) : digest),
          );
        } catch (error) {
          const reason = error instanceof TimeoutError ? 'timeout' : 'provider-error';
          return serveFallback(input, digest, startedAt, key, reason, {
            calledModel,
            cache: read.outcome,
            error,
          });
        }

        if (!call.spec) {
          return serveFallback(input, digest, startedAt, key, 'invalid-generation', {
            calledModel,
            cache: read.outcome,
            ...(call.usage ? { usage: call.usage } : {}),
          });
        }

        spec = call.spec;
        usage = call.usage;
        generatedAt = Date.now();
        if (calledModel) storeInBackground(key, { spec, generatedAt });
      }

      const { spec: served, ourReasons } =
        generation === 'cohort'
          ? fitCohortSpec(spec, input, digest, rank)
          : { spec, ourReasons: new Map<string, string>() };

      const reconciled = reconcileSpec(served, input, digest, ourReasons);
      if (!reconciled.isUsable) {
        return serveFallback(input, digest, startedAt, key, 'unusable-on-serve', {
          calledModel,
          cache: read.outcome,
          violations: reconciled.violations,
          ...(usage ? { usage } : {}),
        });
      }

      const finishedAt = Date.now();
      const source: SpecSource = cached ? 'cache' : 'llm';
      report({
        key,
        source,
        elapsedMs: finishedAt - startedAt,
        calledModel,
        cache: read.outcome,
        violations: reconciled.violations,
        ...(usage ? { usage } : {}),
      });

      return {
        ...reconciled.spec,
        specVersion: SPEC_VERSION,
        slot: digest.slot,
        source,
        generatedAt,
        latencyMs: finishedAt - startedAt,
        provider: provider.name,
        model: provider.model,
      };
    },
  };
}
