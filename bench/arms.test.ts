import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { generatedSpecSchema, type TokenUsage } from '@rudra-js/core';
import { buildArm, loadColdUsage, type ArmName } from './arms.js';

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
