import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatedSpecSchema, type ComponentProvider, type GeneratedSpec } from '@rudra-js/core';
import { createRecordingProvider, createReplayProvider } from './recording-provider.js';

const spec: GeneratedSpec = {
  tone: 'neutral',
  headline: 'Picked for you',
  subheadline: null,
  blocks: [{ kind: 'copy', title: null, body: 'Built for wet rock.' }],
  rationale: 'Test fixture.',
};

const directories: string[] = [];
const scratch = () => {
  const directory = mkdtempSync(join(tmpdir(), 'rudra-recordings-'));
  directories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const inner = (): ComponentProvider & { calls: number } => {
  const provider = {
    name: 'test',
    model: 'test-model',
    calls: 0,
    async generate() {
      provider.calls += 1;
      return { spec, usage: { inputTokens: 5 } };
    },
  };
  return provider;
};

const request = () => ({
  system: 'SYSTEM',
  user: 'USER',
  schema: generatedSpecSchema,
  signal: new AbortController().signal,
});

describe('recording a provider', () => {
  it('returns what the inner provider returned', async () => {
    const directory = scratch();
    const provider = createRecordingProvider(inner(), directory);

    await expect(provider.generate(request())).resolves.toMatchObject({ spec });
  });

  it('writes one transcript per distinct request', async () => {
    const directory = scratch();
    const provider = createRecordingProvider(inner(), directory);

    await provider.generate(request());
    await provider.generate({ ...request(), user: 'A DIFFERENT SHOPPER' });

    expect(readdirSync(directory)).toHaveLength(2);
  });
});

describe('replaying a provider', () => {
  it('serves a recorded answer without calling through', async () => {
    const directory = scratch();
    const recorded = inner();
    await createRecordingProvider(recorded, directory).generate(request());

    const replay = createReplayProvider({ directory, model: 'test-model', onMiss: 'throw' });

    await expect(replay.generate(request())).resolves.toMatchObject({
      spec,
      usage: { inputTokens: 5 },
    });
    expect(recorded.calls).toBe(1);
  });

  it('throws on a miss when asked to, so a run cannot silently measure the fallback', async () => {
    // Degrading quietly here is how a benchmark reports one arm under another
    // arm's label — the failure ADR-0005 exists to prevent. A CI miss must
    // stay silent, unlike the 'fallback' mode below — a warning here would be
    // as easy to miss in CI output as no signal at all.
    const replay = createReplayProvider({
      directory: scratch(),
      model: 'test-model',
      onMiss: 'throw',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(replay.generate(request())).rejects.toThrow(/no recording/i);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reports a miss as a provider failure when asked to fall back', async () => {
    const replay = createReplayProvider({
      directory: scratch(),
      model: 'test-model',
      onMiss: 'fallback',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(replay.generate(request())).rejects.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
