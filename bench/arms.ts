import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMemorySpecCache, type TokenUsage } from '@rudra-js/core';
import { createStubProvider, type ArmSpec, type TokenPrices } from './measure-arm.js';

export const PRICES: TokenPrices = {
  inputPerMillion: 5,
  outputPerMillion: 25,
  cacheWritePerMillion: 6.25,
  cacheReadPerMillion: 0.5,
};

const RECORDINGS_DIRECTORY =
  process.env['RUDRA_SHOP_RECORDINGS'] ?? join(process.cwd(), 'examples/shop/recordings');

export function loadColdUsage(directory: string = RECORDINGS_DIRECTORY): TokenUsage {
  const transcripts: string[] = [];
  if (existsSync(directory)) {
    for (const file of readdirSync(directory)) {
      if (file.endsWith('.json')) transcripts.push(file);
    }
  }
  if (transcripts.length !== 1) {
    throw new Error(
      `expected one transcript in ${directory} and found ${transcripts.length}, so there is nothing to bill from`,
    );
  }

  const path = join(directory, transcripts[0]!);
  const transcript = JSON.parse(readFileSync(path, 'utf8')) as {
    result?: { usage?: TokenUsage };
  };
  const usage = transcript.result?.usage;
  if (usage === undefined) {
    throw new Error(`the transcript at ${path} reports no usage, so there is nothing to bill from`);
  }

  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens: 0,
    cacheWriteTokens: (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
  };
}

let cachedColdUsage: TokenUsage | null = null;

function coldUsage(): TokenUsage {
  if (cachedColdUsage === null) cachedColdUsage = loadColdUsage();
  return cachedColdUsage;
}

const CACHE_TTL_MS = 60 * 60 * 1000;

export const ARM_NAMES = ['b deterministic', 'c cohort', 'd per-shopper'] as const;

export type ArmName = (typeof ARM_NAMES)[number];

export function isArmName(value: string): value is ArmName {
  return (ARM_NAMES as readonly string[]).includes(value);
}

export function buildArm(name: ArmName): ArmSpec {
  switch (name) {
    case 'b deterministic':
      return {
        name,
        mode: 'stub',
        options: { provider: null },
        rule: { fallback: 'all', modelCalls: 'none' },
      };
    case 'c cohort':
      return {
        name,
        mode: 'stub',
        options: {
          provider: createStubProvider(coldUsage()),
          generation: 'cohort',
          cache: createMemorySpecCache({ ttlMs: CACHE_TTL_MS }),
        },
        rule: { fallback: 'none', minCacheHitRate: 0.45, maxCacheHitRate: 0.65 },
      };
    case 'd per-shopper':
      return {
        name,
        mode: 'stub',
        options: {
          provider: createStubProvider(coldUsage()),
          generation: 'per-shopper',
          cache: createMemorySpecCache({ ttlMs: CACHE_TTL_MS }),
        },
        rule: { fallback: 'none', maxCacheHitRate: 0.1 },
      };
  }
}
