import {
  SPEC_VERSION,
  generatedSpecSchema,
  type ComponentSpec,
  type DegradedReason,
  type GeneratedSpec,
  type SpecSource,
} from './component-spec.js';
import { buildFallbackSpec } from './fallback-component.js';
import { buildPrompt, type PromptPair } from './model-prompt.js';
import type { ComponentProvider, TokenUsage } from './provider.js';
import { reconcileSpec } from './reconciliation.js';
import type { RankOrder } from './product-selection.js';
import { fitCohortSpec } from './fit-to-shopper.js';
import { buildDigest, toCohortDigest, type SignalDigest } from './signal-digest.js';
import {
  cachedSpecSchema,
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
  background?: true;
}

export interface ComponentGeneratorOptions {
  provider?: ComponentProvider | null;
  cache?: SpecCache;
  modelTimeoutMs?: number;
  cacheTimeoutMs?: number;
  generation?: 'cohort' | 'per-shopper';
  rank?: RankOrder;
  waitForModel?: boolean;
  waitUntil?: (work: Promise<unknown>) => void;
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

interface CacheRead {
  outcome: NonNullable<GenerationEvent['cache']>;
  entry?: CachedSpec;
}

interface ModelCall {
  spec: GeneratedSpec | null;
  usage?: TokenUsage;
}

interface Settings {
  provider: ComponentProvider | null;
  cache: SpecCache;
  generation: NonNullable<ComponentGeneratorOptions['generation']>;
  rank: RankOrder;
  modelTimeoutMs: number;
  cacheTimeoutMs: number;
  waitForModel: boolean;
  waitUntil: ComponentGeneratorOptions['waitUntil'];
  onEvent: ComponentGeneratorOptions['onEvent'];
  inFlight: Map<string, Promise<ModelCall>>;
}

interface Run {
  input: TrackingInput;
  digest: SignalDigest;
  promptDigest: SignalDigest;
  startedAt: number;
}

type Found =
  | { spec: GeneratedSpec; generatedAt: number; source: 'cache' | 'llm'; details: EventDetails }
  | { failed: DegradedReason; details: EventDetails };

type EventDetails = Pick<
  GenerationEvent,
  'calledModel' | 'usage' | 'violations' | 'cache' | 'error'
>;

export function createComponentGenerator(
  options: ComponentGeneratorOptions = {},
): ComponentGenerator {
  const generation = options.generation ?? 'cohort';
  const waitForModel = options.waitForModel ?? true;
  if (!waitForModel && generation === 'per-shopper') {
    throw new RangeError(
      "waitForModel: false needs generation: 'cohort'. A per-shopper prompt changes with " +
        'almost every view, so the call it starts would almost never reach a page.',
    );
  }

  const settings: Settings = {
    provider: options.provider ?? null,
    cache: options.cache ?? createMemorySpecCache(),
    generation,
    rank: options.rank ?? 'signals',
    modelTimeoutMs: options.modelTimeoutMs ?? (waitForModel ? 1_500 : 30_000),
    cacheTimeoutMs: options.cacheTimeoutMs ?? 50,
    waitForModel,
    waitUntil: options.waitUntil,
    onEvent: options.onEvent,
    inFlight: new Map(),
  };

  return {
    generate: (draft) => generate(settings, draft),
    generateDeterministic: (draft) => generateDeterministic(settings, draft),
  };
}

async function generate(settings: Settings, draft: TrackingInputDraft): Promise<ComponentSpec> {
  const run = startRun(settings, draft);
  const provider = settings.provider;
  if (!provider) return fallback(settings, run, null, 'no-provider');

  const prompt = buildPrompt(run.input, run.promptDigest);
  const key = specCacheKey(prompt, provider);
  const found = await findSpec(settings, provider, prompt, key);
  if ('failed' in found) return fallback(settings, run, key, found.failed, found.details);

  const reconciled = shapeForShopper(settings, run, found.spec);
  const { usage, ...seen } = found.details;
  const details = { ...seen, violations: reconciled.violations, ...(usage ? { usage } : {}) };
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
  return fallback(settings, startRun(settings, draft), null, 'requested');
}

function startRun(settings: Settings, draft: TrackingInputDraft): Run {
  const startedAt = Date.now();
  const input = parseTrackingInput(draft);
  const digest = buildDigest(input);
  const promptDigest = settings.generation === 'cohort' ? toCohortDigest(digest) : digest;
  return { input, digest, promptDigest, startedAt };
}

async function findSpec(
  settings: Settings,
  provider: ComponentProvider,
  prompt: PromptPair,
  key: string,
): Promise<Found> {
  const read = await readCache(settings, key);
  if (read.entry) {
    const details = { calledModel: false, cache: read.outcome };
    return { spec: read.entry.spec, generatedAt: read.entry.generatedAt, source: 'cache', details };
  }

  if (!settings.waitForModel) {
    if (read.outcome === 'miss') fillInBackground(settings, provider, prompt, key);
    return { failed: 'not-cached', details: { calledModel: false, cache: read.outcome } };
  }

  const calledModel = !settings.inFlight.has(key);
  let call: ModelCall;
  try {
    call = await sharedCall(settings, key, () => askModel(settings, provider, prompt));
  } catch (error) {
    const failed = error instanceof TimeoutError ? 'timeout' : 'provider-error';
    return { failed, details: { calledModel, cache: read.outcome, error } };
  }

  const details: EventDetails = { calledModel, cache: read.outcome };
  if (call.usage) details.usage = call.usage;
  if (!call.spec) return { failed: 'invalid-generation', details };

  const generatedAt = Date.now();
  if (calledModel) storeInBackground(settings, key, { spec: call.spec, generatedAt });
  return { spec: call.spec, generatedAt, source: 'llm', details };
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
  prompt: PromptPair,
): Promise<ModelCall> {
  const result = await withinBudget('generation', settings.modelTimeoutMs, (signal) =>
    provider.generate({
      system: prompt.system,
      user: prompt.user,
      schema: generatedSpecSchema,
      signal,
    }),
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

function fillInBackground(
  settings: Settings,
  provider: ComponentProvider,
  prompt: PromptPair,
  key: string,
): void {
  if (settings.inFlight.has(key)) return;

  const startedAt = Date.now();
  const askAndStore = async () => {
    const call = await askModel(settings, provider, prompt);
    if (call.spec) {
      try {
        await settings.cache.set(key, { spec: call.spec, generatedAt: Date.now() });
      } catch {}
    }
    return call;
  };

  const work = sharedCall(settings, key, askAndStore).then(
    (call) => {
      const elapsedMs = Date.now() - startedAt;
      const usage = call.usage ? { usage: call.usage } : {};
      report(
        settings,
        call.spec
          ? { key, source: 'llm', elapsedMs, calledModel: true, ...usage, background: true }
          : {
              key,
              source: 'fallback',
              elapsedMs,
              calledModel: true,
              ...usage,
              degradedReason: 'invalid-generation',
              background: true,
            },
      );
    },
    (error: unknown) => {
      report(settings, {
        key,
        source: 'fallback',
        elapsedMs: Date.now() - startedAt,
        calledModel: true,
        error,
        degradedReason: error instanceof TimeoutError ? 'timeout' : 'provider-error',
        background: true,
      });
    },
  );

  try {
    settings.waitUntil?.(work);
  } catch {}
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

function report(settings: Settings, event: GenerationEvent): void {
  try {
    settings.onEvent?.(event);
  } catch {}
}
