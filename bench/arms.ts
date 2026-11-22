import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createMemorySpecCache,
  type ComponentProvider,
  type GeneratedSpec,
  type ProductReference,
  type TokenUsage,
} from '@rudra-js/core';
import { costOf, type ArmSpec, type TokenPrices } from './measure-arm.js';

export const PRICES: TokenPrices = {
  inputPerMillion: 5,
  outputPerMillion: 25,
  cacheWritePerMillion: 6.25,
  cacheReadPerMillion: 0.5,
};

const RECORDINGS_DIRECTORY =
  process.env['RUDRA_DEMO_RECORDINGS'] ||
  fileURLToPath(new URL('../examples/demo/recordings', import.meta.url));

const RECOMMENDATIONS_SLOT = 'slot "recommendations"';

interface Transcript {
  user?: string;
  result?: { usage?: TokenUsage };
}

export function recommendationsTranscripts(directory: string): [string, Transcript][] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .map((file): [string, Transcript] => {
      const path = join(directory, file);
      return [path, JSON.parse(readFileSync(path, 'utf8')) as Transcript];
    })
    .filter(([, transcript]) => transcript.user?.includes(RECOMMENDATIONS_SLOT));
}

function coldUsage(path: string, transcript: Transcript): TokenUsage {
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

export function loadColdUsage(directory: string = RECORDINGS_DIRECTORY): TokenUsage {
  const usages = recommendationsTranscripts(directory).map(([path, transcript]) =>
    coldUsage(path, transcript),
  );
  if (usages.length === 0) {
    throw new Error(
      `found no recommendations transcript in ${directory}, so there is nothing to bill from`,
    );
  }

  return usages.reduce((dearest, usage) =>
    costOf(usage, PRICES) > costOf(dearest, PRICES) ? usage : dearest,
  );
}

const STUB_GRID_ITEMS = 4;

function candidateSkus(userPrompt: string, limit: number): string[] {
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

function buildStubSpec(skus: readonly string[]): GeneratedSpec {
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

export function createStubProvider(usage: TokenUsage): ComponentProvider {
  return {
    name: 'stub',
    model: 'stub',
    async generate(request) {
      return { spec: buildStubSpec(candidateSkus(request.user, STUB_GRID_ITEMS)), usage };
    },
  };
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
        options: { provider: null },
        rule: { fallback: 'all', modelCalls: 'none' },
      };
    case 'c cohort':
      return {
        name,
        options: {
          provider: createStubProvider(loadColdUsage()),
          generation: 'cohort',
          cache: createMemorySpecCache({ ttlMs: CACHE_TTL_MS }),
        },
        rule: { fallback: 'none', minCacheHitRate: 0.45, maxCacheHitRate: 0.65 },
      };
    case 'd per-shopper':
      return {
        name,
        options: {
          provider: createStubProvider(loadColdUsage()),
          generation: 'per-shopper',
          cache: createMemorySpecCache({ ttlMs: CACHE_TTL_MS }),
        },
        rule: { fallback: 'none', maxCacheHitRate: 0.1 },
      };
  }
}
