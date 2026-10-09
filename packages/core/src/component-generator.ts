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

interface Settings {
  options: ComponentGeneratorOptions;
  provider: ComponentProvider | null;
  cache: SpecCache;
  generation: 'cohort' | 'per-shopper';
  rank: RankOrder;
  modelTimeoutMs: number;
  cacheTimeoutMs: number;
  inFlight: Map<string, Promise<ModelCall>>;
}

interface Run {
  input: TrackingInput;
  digest: SignalDigest;
  startedAt: number;
}

interface Trace {
  calledModel: boolean;
  cache: CacheRead['outcome'];
  usage: TokenUsage | undefined;
  error?: unknown;
}

type Found =
  | { spec: GeneratedSpec; generatedAt: number; source: 'cache' | 'llm'; trace: Trace }
  | { failed: DegradedReason; trace: Trace };

type EventDetails = Pick<
  GenerationEvent,
  'calledModel' | 'usage' | 'violations' | 'cache' | 'error'
>;

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
  const settings: Settings = {
    options,
    provider: options.provider ?? null,
    cache: options.cache ?? createMemorySpecCache(),
    generation: options.generation ?? 'cohort',
    rank: options.rank ?? 'signals',
    modelTimeoutMs: options.modelTimeoutMs ?? 1_500,
    cacheTimeoutMs: options.cacheTimeoutMs ?? 50,
    inFlight: new Map(),
  };

  return {
    generate: (draft) => generate(settings, draft),
    generateDeterministic: (draft) => generateDeterministic(settings, draft),
  };
}

async function generate(settings: Settings, draft: TrackingInputDraft): Promise<ComponentSpec> {
  const run = startRun(draft);
  const provider = settings.provider;
  if (!provider) return fallback(settings, run, null, 'no-provider');

  const key = cacheKeyFor(settings, provider, run);
  const found = await findSpec(settings, provider, run, key);
  if ('failed' in found)
    return fallback(settings, run, key, found.failed, eventDetails(found.trace));

  const reconciled = shapeForShopper(settings, run, found.spec);
  const details = eventDetails(found.trace, reconciled.violations);
  if (!reconciled.isUsable) return fallback(settings, run, key, 'unusable-on-serve', details);

  const finishedAt = Date.now();
  report(settings, {
    key,
    source: found.source,
    elapsedMs: finishedAt - run.startedAt,
    ...details,
  });

  return {
    ...reconciled.spec,
    specVersion: SPEC_VERSION,
    slot: run.digest.slot,
    source: found.source,
    generatedAt: found.generatedAt,
    latencyMs: finishedAt - run.startedAt,
    provider: provider.name,
    model: provider.model,
  };
}

function generateDeterministic(settings: Settings, draft: TrackingInputDraft): ComponentSpec {
  return fallback(settings, startRun(draft), null, 'requested');
}

function startRun(draft: TrackingInputDraft): Run {
  const startedAt = Date.now();
  const input = parseTrackingInput(draft);
  return { input, digest: buildDigest(input), startedAt };
}

function cacheKeyFor(settings: Settings, provider: ComponentProvider, run: Run): string {
  const identity = { name: provider.name, model: provider.model };
  const skus = run.input.candidates.map((product) => product.sku);
  if (settings.generation === 'cohort') return cohortCacheKey(run.digest, skus, identity);
  return specCacheKey(run.digest, skus, identity);
}

async function findSpec(
  settings: Settings,
  provider: ComponentProvider,
  run: Run,
  key: string,
): Promise<Found> {
  const read = await readCache(settings, key);
  if (read.entry) {
    const trace = { calledModel: false, cache: read.outcome, usage: undefined };
    return { spec: read.entry.spec, generatedAt: read.entry.generatedAt, source: 'cache', trace };
  }

  const calledModel = !settings.inFlight.has(key);
  let call: ModelCall;
  try {
    call = await sharedCall(settings, key, () => askModel(settings, provider, run));
  } catch (error) {
    const failed = error instanceof TimeoutError ? 'timeout' : 'provider-error';
    return { failed, trace: { calledModel, cache: read.outcome, usage: undefined, error } };
  }

  const trace = { calledModel, cache: read.outcome, usage: call.usage };
  if (!call.spec) return { failed: 'invalid-generation', trace };

  const generatedAt = Date.now();
  if (calledModel) storeInBackground(settings, key, { spec: call.spec, generatedAt });
  return { spec: call.spec, generatedAt, source: 'llm', trace };
}

async function readCache(settings: Settings, key: string): Promise<CacheRead> {
  try {
    const stored = await withinBudget('cache read', settings.cacheTimeoutMs, () =>
      settings.cache.get(key),
    );
    const parsed = cachedSpecSchema.safeParse(stored);
    return parsed.success ? { outcome: 'hit', entry: parsed.data } : { outcome: 'miss' };
  } catch (error) {
    return { outcome: error instanceof TimeoutError ? 'timeout' : 'error' };
  }
}

async function askModel(
  settings: Settings,
  provider: ComponentProvider,
  run: Run,
): Promise<ModelCall> {
  const promptDigest = settings.generation === 'cohort' ? toCohortDigest(run.digest) : run.digest;
  const { system, user } = buildPrompt(run.input, promptDigest);
  const result = await withinBudget('generation', settings.modelTimeoutMs, (signal) =>
    provider.generate({ system, user, schema: generatedSpecSchema, signal }),
  );
  const parsed = generatedSpecSchema.safeParse(result.spec);
  return {
    spec: parsed.success ? parsed.data : null,
    ...(result.usage ? { usage: result.usage } : {}),
  };
}

function sharedCall(
  settings: Settings,
  key: string,
  ask: () => Promise<ModelCall>,
): Promise<ModelCall> {
  const running = settings.inFlight.get(key);
  if (running) return running;
  const started = ask().finally(() => settings.inFlight.delete(key));
  settings.inFlight.set(key, started);
  return started;
}

function storeInBackground(settings: Settings, key: string, cached: CachedSpec): void {
  void Promise.resolve()
    .then(() => settings.cache.set(key, cached))
    .catch(() => {});
}

function shapeForShopper(settings: Settings, run: Run, spec: GeneratedSpec) {
  if (settings.generation !== 'cohort') {
    return reconcileSpec(spec, run.input, run.digest, new Map<string, string>());
  }
  const fitted = fitCohortSpec(spec, run.input, run.digest, settings.rank);
  return reconcileSpec(fitted.spec, run.input, run.digest, fitted.ourReasons);
}

function fallback(
  settings: Settings,
  run: Run,
  key: string | null,
  degradedReason: DegradedReason,
  details: EventDetails = { calledModel: false },
): ComponentSpec {
  const finishedAt = Date.now();
  report(settings, {
    key,
    source: 'fallback',
    elapsedMs: finishedAt - run.startedAt,
    ...details,
    degradedReason,
  });

  return {
    ...buildFallbackSpec(run.input, run.digest, { rank: settings.rank }),
    specVersion: SPEC_VERSION,
    slot: run.digest.slot,
    source: 'fallback',
    generatedAt: finishedAt,
    latencyMs: finishedAt - run.startedAt,
    provider: null,
    model: null,
    degradedReason,
  };
}

function eventDetails(trace: Trace, violations?: string[]): EventDetails {
  return {
    calledModel: trace.calledModel,
    cache: trace.cache,
    ...(violations ? { violations } : {}),
    ...(trace.usage ? { usage: trace.usage } : {}),
    ...('error' in trace ? { error: trace.error } : {}),
  };
}

function report(settings: Settings, event: GenerationEvent): void {
  if (!settings.options.onEvent) return;
  try {
    settings.options.onEvent(event);
  } catch {}
}
