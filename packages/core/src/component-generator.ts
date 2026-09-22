import { z } from 'zod';
import {
  SPEC_VERSION,
  generatedSpecSchema,
  type Block,
  type ComponentSpec,
  type DegradedReason,
  type GeneratedSpec,
  type SpecSource,
} from './component-spec.js';
import { buildFallbackSpec } from './fallback-component.js';
import { buildPrompt } from './model-prompt.js';
import type { ComponentProvider, TokenUsage } from './provider.js';
import { bundleForShopper, capBlocks, placeableHeroSkus, reconcileSpec } from './reconciliation.js';
import { selectProducts, type RankOrder, type ProductPick } from './product-selection.js';
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

function createSingleFlight() {
  const inFlight = new Map<string, Promise<ModelCall>>();

  return {
    isRunning: (key: string) => inFlight.has(key),

    run(key: string, task: () => Promise<ModelCall>): Promise<ModelCall> {
      const existing = inFlight.get(key);
      if (existing) return existing;

      const started = task().finally(() => inFlight.delete(key));
      inFlight.set(key, started);
      return started;
    },
  };
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

  let hasBundleBlock = false;
  const aboveBundle: Block[] = [];
  for (const block of blocks) {
    if (block.kind === 'bundle') {
      hasBundleBlock = true;
      break;
    }
    aboveBundle.push(block);
  }
  if (!hasBundleBlock) return fitToShopper(spec, picks, digest.maxItems);

  const chosen = bundleForShopper(input, digest, placeableHeroSkus(aboveBundle, input));
  if (!chosen) return fitToShopper(spec, picks, digest.maxItems);

  const spokenFor = new Set<string>(chosen.skus);
  for (const sku of placeableHeroSkus(blocks, input)) spokenFor.add(sku);

  const roomLeft = digest.maxItems - spokenFor.size;

  if (roomLeft <= 0) return fitToShopper(spec, picks, digest.maxItems);

  const forGrid: ProductPick[] = [];
  for (const pick of picks) {
    if (!spokenFor.has(pick.product.sku)) forGrid.push(pick);
  }

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
  const singleFlight = createSingleFlight();

  const report = (event: GenerationEvent): void => {
    if (!options.onEvent) return;
    try {
      options.onEvent(event);
    } catch {
    }
  };

  const buildDeterministic = (
    input: TrackingInput,
    digest: SignalDigest,
    startedAt: number,
    key: string | null,
    degradedReason: DegradedReason,
    modelCall: Pick<GenerationEvent, 'calledModel' | 'usage' | 'violations' | 'cache' | 'error'> = {
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
      .catch(() => {
      });
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

  return {
    generateDeterministic(draft) {
      const startedAt = Date.now();
      const input = parseTrackingInput(draft);
      return buildDeterministic(input, buildDigest(input), startedAt, null, 'requested');
    },

    async generate(draft) {
      const startedAt = Date.now();

      const input = parseTrackingInput(draft);
      const digest = buildDigest(input);

      if (!provider) {
        return buildDeterministic(input, digest, startedAt, null, 'no-provider');
      }

      const identity = { name: provider.name, model: provider.model };
      const candidateSkus = input.candidates.map((product) => product.sku);
      const key =
        generation === 'cohort'
          ? cohortCacheKey(digest, candidateSkus, identity)
          : specCacheKey(digest, candidateSkus, identity);

      const read = await readCache(key);
      const cached = read.entry;
      let calledModel = false;
      let answer: { spec: GeneratedSpec; usage?: TokenUsage };

      let generatedAt: number;

      if (cached) {
        answer = { spec: cached.spec };
        generatedAt = cached.generatedAt;
      } else {
        calledModel = !singleFlight.isRunning(key);

        let call: ModelCall;
        try {
          call = await singleFlight.run(key, () =>
            askModel(provider, input, generation === 'cohort' ? toCohortDigest(digest) : digest),
          );
        } catch (error) {
          const reason = error instanceof TimeoutError ? 'timeout' : 'provider-error';
          return buildDeterministic(input, digest, startedAt, key, reason, {
            calledModel,
            cache: read.outcome,
            error,
          });
        }

        if (!call.spec) {
          return buildDeterministic(input, digest, startedAt, key, 'invalid-generation', {
            calledModel,
            cache: read.outcome,
            ...(call.usage ? { usage: call.usage } : {}),
          });
        }

        answer = { spec: call.spec, ...(call.usage ? { usage: call.usage } : {}) };
        generatedAt = Date.now();

        if (calledModel) storeInBackground(key, { spec: answer.spec, generatedAt });
      }

      const { spec: served, ourReasons } =
        generation === 'cohort'
          ? fitCohortSpec(answer.spec, input, digest, rank)
          : { spec: answer.spec, ourReasons: new Map<string, string>() };

      const reconciled = reconcileSpec(served, input, digest, ourReasons);
      if (!reconciled.isUsable) {
        return buildDeterministic(input, digest, startedAt, key, 'unusable-on-serve', {
          calledModel,
          cache: read.outcome,
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
        cache: read.outcome,
        violations: reconciled.violations,
        ...(answer.usage ? { usage: answer.usage } : {}),
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
