import {
  createComponentGenerator,
  type ComponentGeneratorOptions,
  type ComponentProvider,
  type GeneratedSpec,
  type GenerationEvent,
  type Product,
  type ProductReference,
  type TokenUsage,
} from '@rudra-js/core';
import { buildTrackingInput } from '../examples/shop/src/fixtures/tracking-input.js';
import type { Shopper } from '../examples/shop/src/fixtures/shoppers.js';

export interface TokenPrices {
  inputPerMillion: number;
  outputPerMillion: number;
  /** A cached prefix is written once at a premium and read back cheaply. */
  cacheWritePerMillion: number;
  cacheReadPerMillion: number;
}

/**
 * Where an arm's numbers came from.
 *
 * 'stub' is a fixed answer with a recorded call's token counts. 'replay' is a
 * recording of real answers. 'live' is a real model, on the network, billing.
 * The numbers read the same in all three, which is why the run has to say
 * which one it was.
 */
export type ArmMode = 'stub' | 'replay' | 'live';

/** What an arm claims about itself, next to what actually answered it. */
export interface ArmIdentity {
  name: string;
  mode: ArmMode;
  /** Null when the arm runs without a provider at all. */
  providerName: string | null;
  providerModel: string | null;
}

export interface ArmResult {
  arm: string;
  mode: ArmMode;
  providerName: string | null;
  providerModel: string | null;
  views: number;
  sources: { llm: number; cache: number; fallback: number };
  cacheHitRate: number;
  modelCalls: number;
  modelCallsPerThousand: number;
  inputTokens: number;
  outputTokens: number;
  // Kept apart from the input tokens rather than folded in, so a reader can
  // re-price the cached prefix at read rates instead of write rates.
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costPerThousandViews: number;
  // Absent for a stub run. The stub answers far below the millisecond that
  // Date.now() can see, so its median is a 0 dressed up as a measurement.
  elapsedMs?: { median: number; p95: number; p99: number };
  violations: Record<string, number>;
}

// Nearest-rank on a sorted list. Small samples make interpolation a fiction.
function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[index]!;
}

export function summarise(
  identity: ArmIdentity,
  events: readonly GenerationEvent[],
  prices: TokenPrices,
): ArmResult {
  const sources = { llm: 0, cache: 0, fallback: 0 };
  const violations: Record<string, number> = {};
  const timings: number[] = [];
  let modelCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;

  for (const event of events) {
    sources[event.source] += 1;
    timings.push(event.elapsedMs);

    // Only the request that was sent is billed. One that joined an in-flight
    // generation carries the same usage and would double the bill.
    if (event.calledModel) {
      modelCalls += 1;
      inputTokens += event.usage?.inputTokens ?? 0;
      outputTokens += event.usage?.outputTokens ?? 0;
      cacheWriteTokens += event.usage?.cacheWriteTokens ?? 0;
      cacheReadTokens += event.usage?.cacheReadTokens ?? 0;
    }

    for (const violation of event.violations ?? []) {
      const colon = violation.indexOf(':');
      const kind = colon === -1 ? violation : violation.slice(0, colon);
      violations[kind] = (violations[kind] ?? 0) + 1;
    }
  }

  const views = events.length;
  const cost =
    (inputTokens / 1_000_000) * prices.inputPerMillion +
    (outputTokens / 1_000_000) * prices.outputPerMillion +
    (cacheWriteTokens / 1_000_000) * prices.cacheWritePerMillion +
    (cacheReadTokens / 1_000_000) * prices.cacheReadPerMillion;
  timings.sort((left, right) => left - right);

  return {
    arm: identity.name,
    mode: identity.mode,
    providerName: identity.providerName,
    providerModel: identity.providerModel,
    views,
    sources,
    cacheHitRate: views === 0 ? 0 : sources.cache / views,
    modelCalls,
    modelCallsPerThousand: views === 0 ? 0 : (modelCalls / views) * 1000,
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    costPerThousandViews: views === 0 ? 0 : (cost / views) * 1000,
    ...(identity.mode === 'stub'
      ? {}
      : {
          elapsedMs: {
            median: percentile(timings, 0.5),
            p95: percentile(timings, 0.95),
            p99: percentile(timings, 0.99),
          },
        }),
    violations,
  };
}

export interface SourceRule {
  /** 'all' means every view must be a fallback, 'none' means no view may be. */
  fallback: 'none' | 'all';
  minCacheHitRate?: number;
  maxCacheHitRate?: number;
  /**
   * 'none' means the arm must not have called a model at all. This is a
   * different check than `fallback: 'all'`: a call that timed out or errored
   * still counts as `calledModel`, and still bills, even though its source
   * comes back as fallback. `fallback: 'all'` alone would not catch that.
   */
  modelCalls?: 'none';
}

// A run whose sources do not match its arm is a different arm under the wrong
// name. Throwing is the only way a benchmark can refuse to publish that.
export function assertSourceMix(result: ArmResult, rule: SourceRule): void {
  // A run that measured nothing cannot be evidence of anything.
  if (result.views === 0) {
    throw new Error(`arm ${result.arm}: no views were measured`);
  }

  // The mode is typed into the arm by hand; the provider name comes off
  // whatever object answered the calls. Two different sources, so they can
  // disagree — and a run labelled live that a stub answered is the exact
  // mistake this benchmark was written after.
  const stubbed = result.providerName === null || result.providerName === 'stub';
  if (result.mode !== 'stub' && stubbed) {
    throw new Error(
      `arm ${result.arm}: this arm says '${result.mode}', but nothing but a stub answered it`,
    );
  }
  if (result.mode === 'stub' && !stubbed) {
    throw new Error(
      `arm ${result.arm}: this arm says 'stub', but the provider ${result.providerName} answered it, which is a real one and bills`,
    );
  }
  const { fallback } = result.sources;
  if (rule.fallback === 'none' && fallback > 0) {
    throw new Error(
      `arm ${result.arm}: ${fallback} of ${result.views} views fell back, so this is not the arm it says it is`,
    );
  }
  if (rule.fallback === 'all' && fallback !== result.views) {
    throw new Error(
      `arm ${result.arm}: ${result.views - fallback} of ${result.views} views reached a model, but this arm runs without one`,
    );
  }
  if (rule.modelCalls === 'none' && result.modelCalls > 0) {
    throw new Error(
      `arm ${result.arm}: ${result.modelCalls} of ${result.views} views called a model, but this arm must not call one at all`,
    );
  }
  if (rule.minCacheHitRate !== undefined && result.cacheHitRate < rule.minCacheHitRate) {
    throw new Error(
      `arm ${result.arm}: cache hit rate ${result.cacheHitRate.toFixed(3)} is below ${rule.minCacheHitRate}`,
    );
  }
  if (rule.maxCacheHitRate !== undefined && result.cacheHitRate > rule.maxCacheHitRate) {
    throw new Error(
      `arm ${result.arm}: cache hit rate ${result.cacheHitRate.toFixed(3)} is above ${rule.maxCacheHitRate}`,
    );
  }
}

// Up to four, because one product that the shopper already has in their cart
// is dropped by reconciliation and a single-item grid would empty.
function candidateSkus(userPrompt: string, limit: number): string[] {
  // Only read the candidates section, so nothing else in the prompt can be
  // mistaken for one.
  const start = userPrompt.indexOf('## Candidates');
  if (start < 0) throw new Error('the stub found no candidates section in the prompt');
  const candidates = userPrompt.slice(start);
  const skus: string[] = [];
  for (const line of candidates.split('\n')) {
    const match = line.match(/^- "([^"]+)"/);
    if (match) skus.push(match[1]!);
    if (skus.length === limit) break;
  }
  if (skus.length === 0) throw new Error('the stub found no candidate in the prompt');
  return skus;
}

// The stub answers like a model does, with products from the list it was
// shown. A SKU the shopper was never offered is dropped by reconciliation,
// and the arm would fall back.
export function createStubProvider(usage: TokenUsage): ComponentProvider {
  return {
    name: 'stub',
    model: 'stub',
    async generate(request) {
      return { spec: buildStubSpec(candidateSkus(request.user, 4)), usage };
    },
  };
}

export interface ArmSpec {
  name: string;
  /** Checked against the provider that answers, so a wrong one throws. */
  mode: ArmMode;
  options: ComponentGeneratorOptions;
  rule: SourceRule;
}

/**
 * How many shoppers look at the same page.
 *
 * This one number sets the headline cache hit rate: it decides how many
 * shoppers can share a cohort, and nothing else in the run moves it as much.
 * Ten is an assumption about traffic, not a measurement — an earlier
 * ten-per-cohort figure was withdrawn because it counted a different page
 * assignment. It is a parameter and it goes into the result file so whoever
 * writes the numbers up can say what was assumed, or sweep it.
 */
export const SHOPPERS_PER_PAGE = 10;

// Real traffic puts many shoppers on the same page, and the cohort key
// includes the page's category — a unique product per shopper would mean a
// unique cohort per shopper, and nothing would ever be shared.
export function skuFor(
  index: number,
  shopperCount: number,
  catalog: readonly Product[],
  shoppersPerPage: number = SHOPPERS_PER_PAGE,
): string {
  const inStock: Product[] = [];
  for (const product of catalog) {
    if (product.isInStock) inStock.push(product);
  }
  if (inStock.length === 0) throw new Error('the catalog has nothing in stock');

  // Clamped rather than folded: folding a page count bigger than the catalog
  // back onto it (with a second modulo) hands the wrapped-around pages a
  // second helping of shoppers, which merges cohorts and inflates the cache
  // hit rate — the exact distortion this whole benchmark exists to measure
  // honestly. Once there are more pages than products, one page per product
  // is the most pages there can honestly be.
  const pages = Math.min(Math.max(1, Math.floor(shopperCount / shoppersPerPage)), inStock.length);
  return inStock[index % pages]!.sku;
}

// The stub always answers with this, one grid item per SKU it picked from the
// prompt.
export function buildStubSpec(skus: readonly string[]): GeneratedSpec {
  const items: ProductReference[] = [];
  for (const sku of skus) {
    items.push({ sku, basis: 'popular', reason: null, badge: null, emphasis: 'normal' });
  }

  return {
    tone: 'neutral',
    headline: 'More to see',
    subheadline: null,
    blocks: [
      {
        kind: 'grid',
        title: 'Picked for you',
        columns: 3,
        items,
      },
    ],
    rationale: 'A fixed spec, so the numbers measure the framework and not the model.',
  };
}

export async function measureArm(
  arm: ArmSpec,
  shoppers: readonly Shopper[],
  catalog: readonly Product[],
  prices: TokenPrices,
  shoppersPerPage: number = SHOPPERS_PER_PAGE,
): Promise<ArmResult> {
  const events: GenerationEvent[] = [];
  const generator = createComponentGenerator({
    ...arm.options,
    onEvent: (event) => {
      events.push(event);
    },
  });

  // In population order on a cold cache: the first shopper of a cohort misses
  // and the rest hit, which is what really happens.
  for (let index = 0; index < shoppers.length; index += 1) {
    const shopper = shoppers[index]!;
    const sku = skuFor(index, shoppers.length, catalog, shoppersPerPage);
    await generator.generate(buildTrackingInput(shopper, sku, catalog, []));
  }

  const provider = arm.options.provider ?? null;
  const result = summarise(
    {
      name: arm.name,
      mode: arm.mode,
      providerName: provider === null ? null : provider.name,
      providerModel: provider === null ? null : provider.model,
    },
    events,
    prices,
  );
  assertSourceMix(result, arm.rule);
  return result;
}
