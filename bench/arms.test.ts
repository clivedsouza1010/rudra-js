import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatedSpecSchema, type TokenUsage } from '@rudra-js/core';
import {
  buildArm,
  loadColdUsage,
  PRICES,
  recommendationsTranscripts,
  type ArmName,
} from './arms.js';

const RECORDINGS = fileURLToPath(new URL('../examples/demo/recordings/', import.meta.url));
const RECOMMENDATIONS = 'Page: "pdp", slot "recommendations", locale "en-US"';

function committedColdUsages(): TokenUsage[] {
  return recommendationsTranscripts(RECORDINGS).map(([, transcript]) => {
    const usage = transcript.result!.usage as Required<TokenUsage>;
    return {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: usage.cacheReadTokens + usage.cacheWriteTokens,
    };
  });
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
    it(`${name} bills a committed transcript as a cold call`, async () => {
      const billed = await billedBy(name);

      expect(billed?.inputTokens).toBeGreaterThan(0);
      expect(billed?.cacheWriteTokens).toBeGreaterThan(0);
      expect(committedColdUsages()).toContainEqual(billed);
    });
  }
});

describe('how each arm is set up', () => {
  it('b deterministic runs without a provider and must not call a model', () => {
    const arm = buildArm('b deterministic');

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
    expect(() => loadColdUsage(scratch())).toThrow(/no recommendations transcript/);
  });

  it('bills from the dearest of several recommendations transcripts', () => {
    const directory = scratch();
    const usage = { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const write = (file: string, outputTokens: number) =>
      writeFileSync(
        join(directory, file),
        JSON.stringify({ user: RECOMMENDATIONS, result: { usage: { ...usage, outputTokens } } }),
      );
    write('a.json', 20);
    write('b.json', 30);
    write('c.json', 25);

    expect(loadColdUsage(directory)).toMatchObject({ outputTokens: 30 });
  });

  it('bills from the recommendations transcript and ignores the other sections', () => {
    const directory = scratch();
    const usage = { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 };
    writeFileSync(
      join(directory, 'a.json'),
      JSON.stringify({ user: RECOMMENDATIONS, result: { usage } }),
    );
    writeFileSync(
      join(directory, 'b.json'),
      JSON.stringify({
        user: 'Page: "pdp", slot "more-to-consider"',
        result: { usage: { ...usage, outputTokens: 1000 } },
      }),
    );

    expect(loadColdUsage(directory)).toMatchObject({ inputTokens: 10, outputTokens: 20 });
  });

  it('refuses a transcript that reports no usage', () => {
    const directory = scratch();
    writeFileSync(
      join(directory, 'a.json'),
      JSON.stringify({ user: RECOMMENDATIONS, result: { spec: {} } }),
    );

    expect(() => loadColdUsage(directory)).toThrow(/reports no usage/);
  });
});

describe('the recordings directory', () => {
  const ambient = process.env['RUDRA_DEMO_RECORDINGS'];

  afterEach(() => {
    if (ambient === undefined) {
      delete process.env['RUDRA_DEMO_RECORDINGS'];
    } else {
      process.env['RUDRA_DEMO_RECORDINGS'] = ambient;
    }
    vi.resetModules();
  });

  it('falls back to the committed recordings when the variable is set but empty', async () => {
    process.env['RUDRA_DEMO_RECORDINGS'] = '';
    vi.resetModules();

    const fresh = await import('./arms.js');

    expect(fresh.loadColdUsage()).toEqual(loadColdUsage(RECORDINGS));
  });
});
