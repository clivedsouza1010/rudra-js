import { createMemorySpecCache } from '@rudra-js/core';
import { createStubProvider, type ArmSpec, type TokenPrices } from './measure-arm.js';

// claude-opus-5 list price, checked 2026-09-01.
export const PRICES: TokenPrices = {
  inputPerMillion: 5,
  outputPerMillion: 25,
  cacheWritePerMillion: 6.25,
  cacheReadPerMillion: 0.5,
};

// Copied from the committed transcript, so the stub bills what a real call did.
export const RECORDED_USAGE = {
  inputTokens: 1539,
  outputTokens: 542,
  cacheReadTokens: 0,
  cacheWriteTokens: 3223,
};

// A run with hundreds of model calls can take longer than core's default, and
// an entry expiring mid-run would fail an arm for a reason unrelated to
// cohorting.
const CACHE_TTL_MS = 60 * 60 * 1000;

export const ARM_NAMES = ['b deterministic', 'c cohort', 'd per-shopper'] as const;

export type ArmName = (typeof ARM_NAMES)[number];

export function isArmName(value: string): value is ArmName {
  return (ARM_NAMES as readonly string[]).includes(value);
}

// Built fresh each call: a provider and a cache are live objects, and an arm
// that reused another's cache would not be measuring a cold one.
export function buildArm(name: ArmName): ArmSpec {
  if (name === 'b deterministic') {
    return {
      name,
      mode: 'stub',
      options: { provider: null },
      rule: { fallback: 'all', modelCalls: 'none' },
    };
  }

  if (name === 'c cohort') {
    return {
      name,
      mode: 'stub',
      options: {
        provider: createStubProvider(RECORDED_USAGE),
        generation: 'cohort',
        cache: createMemorySpecCache({ ttlMs: CACHE_TTL_MS }),
      },
      // Both a floor and a ceiling: this fixture (ten shoppers to a page, four
      // shopper segments) lands cohort caching around 54%. A run that collapsed
      // back to one page per cohort would print ~98% and pass a floor alone.
      rule: { fallback: 'none', minCacheHitRate: 0.45, maxCacheHitRate: 0.65 },
    };
  }

  return {
    name,
    mode: 'stub',
    options: {
      provider: createStubProvider(RECORDED_USAGE),
      generation: 'per-shopper',
      cache: createMemorySpecCache({ ttlMs: CACHE_TTL_MS }),
    },
    rule: { fallback: 'none', maxCacheHitRate: 0.1 },
  };
}
