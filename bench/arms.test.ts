import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { generatedSpecSchema, type TokenUsage } from '@rudra-js/core';
import { buildArm, loadColdUsage, PRICES, type ArmName } from './arms.js';

const RECORDINGS = fileURLToPath(new URL('../examples/shop/recordings/', import.meta.url));

function committedUsage(): Required<TokenUsage> {
  const transcripts: string[] = [];
  for (const file of readdirSync(RECORDINGS)) {
    if (file.endsWith('.json')) transcripts.push(file);
  }
  expect(transcripts).toHaveLength(1);
  const transcript = JSON.parse(readFileSync(join(RECORDINGS, transcripts[0]!), 'utf8')) as {
    result: { usage: Required<TokenUsage> };
  };
  return transcript.result.usage;
}

async function billedBy(name: ArmName): Promise<TokenUsage | undefined> {
  const provider = buildArm(name).options.provider;
  if (!provider) throw new Error(`arm ${name} has no provider`);
  const result = await provider.generate({
    system: '',
    user: '## Candidates\n- "RJ-00001" | "Talus Ripstop Backpacks" | "Backpacks"\n',
    schema: generatedSpecSchema,
    signal: new AbortController().signal,
  });
  return result.usage;
}

describe('what the stub bills', () => {
  const armsWithAModel: ArmName[] = ['c cohort', 'd per-shopper'];

  for (const name of armsWithAModel) {
    it(`${name} bills the committed transcript as a cold call`, async () => {
      const recorded = committedUsage();
      expect(recorded.inputTokens).toBeGreaterThan(0);
      expect(recorded.cacheReadTokens + recorded.cacheWriteTokens).toBeGreaterThan(0);

      expect(await billedBy(name)).toEqual({
        inputTokens: recorded.inputTokens,
        outputTokens: recorded.outputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: recorded.cacheReadTokens + recorded.cacheWriteTokens,
      });
    });
  }
});

describe('how each arm is set up', () => {
  it('b deterministic runs without a provider and must not call a model', () => {
    const arm = buildArm('b deterministic');

    expect(arm.mode).toBe('stub');
    expect(arm.options.provider).toBe(null);
    expect(arm.rule).toEqual({ fallback: 'all', modelCalls: 'none' });
  });

  it('c cohort generates per cohort and pins the hit rate from both sides', () => {
    const arm = buildArm('c cohort');

    expect(arm.options.generation).toBe('cohort');
    expect(arm.rule).toEqual({ fallback: 'none', minCacheHitRate: 0.45, maxCacheHitRate: 0.65 });
  });

  it('d per-shopper generates per shopper and caps the hit rate', () => {
    const arm = buildArm('d per-shopper');

    expect(arm.options.generation).toBe('per-shopper');
    expect(arm.rule).toEqual({ fallback: 'none', maxCacheHitRate: 0.1 });
  });
});

describe('the price table the run bills at', () => {
  it('bills at the list price it says it checked', () => {
    expect(PRICES).toEqual({
      inputPerMillion: 5,
      outputPerMillion: 25,
      cacheWritePerMillion: 6.25,
      cacheReadPerMillion: 0.5,
    });
  });
});

describe('reading the committed transcript', () => {
  const directories: string[] = [];
  const scratch = () => {
    const directory = mkdtempSync(join(tmpdir(), 'rudra-bench-'));
    directories.push(directory);
    return directory;
  };

  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  it('refuses a recordings directory with no transcript', () => {
    expect(() => loadColdUsage(scratch())).toThrow(/one transcript.*found 0/);
  });

  it('refuses a recordings directory with more than one transcript', () => {
    const directory = scratch();
    writeFileSync(join(directory, 'a.json'), '{}');
    writeFileSync(join(directory, 'b.json'), '{}');

    expect(() => loadColdUsage(directory)).toThrow(/one transcript.*found 2/);
  });

  it('refuses a transcript that reports no usage', () => {
    const directory = scratch();
    writeFileSync(join(directory, 'a.json'), JSON.stringify({ result: { spec: {} } }));

    expect(() => loadColdUsage(directory)).toThrow(/reports no usage/);
  });
});
