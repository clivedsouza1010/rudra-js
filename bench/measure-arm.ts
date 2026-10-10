import {
  createComponentGenerator,
  type ComponentGeneratorOptions,
  type GenerationEvent,
  type Product,
} from '@rudra-js/core';
import { buildTrackingInput } from '../examples/shop/src/fixtures/tracking-input.js';
import type { Shopper } from '../examples/shop/src/fixtures/shoppers.js';

export interface TokenPrices {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheWritePerMillion: number;
  cacheReadPerMillion: number;
}

export interface ArmIdentity {
  name: string;
  providerName: string | null;
  providerModel: string | null;
}

export interface ArmResult {
  arm: string;
  providerName: string | null;
  providerModel: string | null;
  views: number;
  sources: { llm: number; cache: number; fallback: number };
  cacheHitRate: number;
  modelCalls: number;
  modelCallsPerThousand: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costPerThousandViews: number;
  cpuUserMs?: number;
  cpuSystemMs?: number;
  violations: Record<string, number>;
}

export function summarise(
  identity: ArmIdentity,
  events: readonly GenerationEvent[],
  prices: TokenPrices,
): ArmResult {
  const sources = { llm: 0, cache: 0, fallback: 0 };
  const violations: Record<string, number> = {};
  let modelCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;

  for (const event of events) {
    sources[event.source] += 1;

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

  return {
    arm: identity.name,
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
    violations,
  };
}

export interface SourceRule {
  fallback: 'none' | 'all';
  minCacheHitRate?: number;
  maxCacheHitRate?: number;
  modelCalls?: 'none';
}

export function assertSourceMix(result: ArmResult, rule: SourceRule): void {
  if (result.views === 0) {
    throw new Error(`arm ${result.arm}: no views were measured`);
  }

  if (result.providerName !== null && result.providerName !== 'stub') {
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

export interface ArmSpec {
  name: string;
  options: ComponentGeneratorOptions;
  rule: SourceRule;
}

export const SHOPPERS_PER_PAGE = 10;

export function skuForEachShopper(
  shopperCount: number,
  catalog: readonly Product[],
  shoppersPerPage: number = SHOPPERS_PER_PAGE,
): string[] {
  if (shopperCount === 0) return [];

  const inStock = catalog.filter((product) => product.isInStock);
  if (inStock.length === 0) throw new Error('the catalog has nothing in stock');

  const pageCount = Math.max(1, Math.floor(shopperCount / shoppersPerPage));
  const pages = inStock.slice(0, pageCount);
  return Array.from({ length: shopperCount }, (_unused, index) => pages[index % pages.length]!.sku);
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

  const skus = skuForEachShopper(shoppers.length, catalog, shoppersPerPage);
  for (let index = 0; index < shoppers.length; index += 1) {
    const shopper = shoppers[index]!;
    const sku = skus[index]!;
    // oxlint-disable-next-line no-await-in-loop
    await generator.generate(buildTrackingInput(shopper, sku, catalog, []));
  }

  const provider = arm.options.provider ?? null;
  const result = summarise(
    {
      name: arm.name,
      providerName: provider === null ? null : provider.name,
      providerModel: provider === null ? null : provider.model,
    },
    events,
    prices,
  );
  assertSourceMix(result, arm.rule);
  return result;
}
