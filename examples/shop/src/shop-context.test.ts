import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatedSpecSchema, type GeneratedSpec } from '@rudra-js/core';
import { transcriptPath } from './provider/recording-provider';

vi.mock('@rudra-js/anthropic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rudra-js/anthropic')>();
  return { ...actual, createAnthropicProvider: vi.fn(actual.createAnthropicProvider) };
});

const KEY = 'ANTHROPIC_API_KEY';
const REPLAY_ONLY = 'RUDRA_REPLAY_ONLY';
const MODE = 'RUDRA_SHOP_MODE';
const WORKSPACE = 'ANTHROPIC_WORKSPACE_ID';
const CI = 'CI';
const RECORDINGS = 'RUDRA_SHOP_RECORDINGS';

// So afterEach can put this back instead of erasing it - a pool sharing one process across files needs that.
const AMBIENT_REPLAY_ONLY = process.env[REPLAY_ONLY];
const AMBIENT_CI = process.env[CI];
const AMBIENT_RECORDINGS = process.env[RECORDINGS];

const restore = (name: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
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
  delete process.env[KEY];
  delete process.env[MODE];
  delete process.env[WORKSPACE];
  restore(REPLAY_ONLY, AMBIENT_REPLAY_ONLY);
  restore(CI, AMBIENT_CI);
  restore(RECORDINGS, AMBIENT_RECORDINGS);
  vi.clearAllMocks();
  // The module reads the environment once, so each case needs a fresh copy.
  vi.resetModules();
});

const anthropicFactory = async () =>
  vi.mocked((await import('@rudra-js/anthropic')).createAnthropicProvider);

const missingRequest = () => ({
  system: 'no recording exists for this',
  user: 'no recording exists for this',
  schema: generatedSpecSchema,
  signal: AbortSignal.timeout(1000),
});

const recordedSpec: GeneratedSpec = {
  tone: 'neutral',
  headline: 'Picked for you',
  subheadline: null,
  blocks: [{ kind: 'copy', title: null, body: 'Built for wet rock.' }],
  rationale: 'Test fixture.',
};

describe('the replay-only switch', () => {
  it('is already on by default, so a key alone in the shell cannot bill during npm test', async () => {
    // vitest.config.ts turns this on for every test file. Not setting it here
    // on purpose - this proves the config protects a run, not this test.
    process.env[KEY] = 'sk-ant-not-a-real-key';

    await expect(import('./shop-context')).rejects.toThrow(/replay only/i);
  });

  it('refuses to load when a key is present as well', async () => {
    process.env[REPLAY_ONLY] = '1';
    process.env[KEY] = 'sk-ant-not-a-real-key';

    await expect(import('./shop-context')).rejects.toThrow(/replay only/i);
  });

  it('loads when the switch is on and no key is set', async () => {
    process.env[REPLAY_ONLY] = '1';

    await expect(import('./shop-context')).resolves.toBeDefined();
  });

  it('refuses record mode even when no key is set', async () => {
    process.env[REPLAY_ONLY] = '1';
    process.env[MODE] = 'record';

    await expect(import('./shop-context')).rejects.toThrow(/replay only/i);
  });

  it('refuses record mode with a key as well', async () => {
    process.env[REPLAY_ONLY] = '1';
    process.env[MODE] = 'record';
    process.env[KEY] = 'sk-ant-not-a-real-key';

    await expect(import('./shop-context')).rejects.toThrow(/RUDRA_SHOP_MODE is record/);
  });

  it('treats a missing recording as an error, not something to paper over', async () => {
    process.env[REPLAY_ONLY] = '1';

    const { chooseProvider } = await import('./shop-context');
    const provider = chooseProvider();
    // A miss under 'fallback' also rejects, but warns first — 'throw' does
    // not. This is the only observable difference, so it is what pins the mode.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      provider.generate({
        system: 'no recording exists for this',
        user: 'no recording exists for this',
        schema: generatedSpecSchema,
        signal: AbortSignal.timeout(1000),
      }),
    ).rejects.toThrow(/no recording/i);
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  it('holds a page for an hour and lets it go after that', async () => {
    vi.useFakeTimers();
    try {
      const { specCache } = await import('./shop-context');
      const cached = { spec: { blocks: [] } as never, generatedAt: Date.now() };

      await specCache.set('k', cached);
      vi.advanceTimersByTime(59 * 60 * 1000);
      expect(await specCache.get('k')).toStrictEqual(cached);

      vi.advanceTimersByTime(2 * 60 * 1000);
      expect(await specCache.get('k')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives the generator that cache, not a copy of it', async () => {
    const { getShopContext, specCache } = await import('./shop-context');
    const { buildTrackingInput } = await import('./fixtures/tracking-input');
    const { catalog, bundles, findShopper, generator } = getShopContext();
    const get = vi.spyOn(specCache, 'get');

    await generator.generate(
      buildTrackingInput(findShopper('S-0001'), catalog[0]!.sku, catalog, bundles),
    );

    expect(get).toHaveBeenCalled();
  });
});

describe('the mode switch', () => {
  it('replays by default even with a key set, and builds no Anthropic provider', async () => {
    delete process.env[REPLAY_ONLY];
    process.env[KEY] = 'sk-ant-not-a-real-key';

    const { chooseProvider } = await import('./shop-context');
    const factory = await anthropicFactory();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(chooseProvider().generate(missingRequest())).rejects.toThrow(/no recording/i);
    expect(factory).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  it('replays when the mode is set but empty, the way an empty .env.local row leaves it', async () => {
    delete process.env[REPLAY_ONLY];
    process.env[MODE] = '';
    process.env[KEY] = 'sk-ant-not-a-real-key';

    const { chooseProvider } = await import('./shop-context');
    const factory = await anthropicFactory();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(chooseProvider().generate(missingRequest())).rejects.toThrow(/no recording/i);
    expect(factory).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  it('refuses record mode without a key', async () => {
    delete process.env[REPLAY_ONLY];
    process.env[MODE] = 'record';

    await expect(import('./shop-context')).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it('refuses a mode it does not know, naming the two it does', async () => {
    delete process.env[REPLAY_ONLY];
    process.env[MODE] = 'live';

    await expect(import('./shop-context')).rejects.toThrow(/"replay" or "record"/);
  });

  it('records with a key, and hands the workspace to the Anthropic provider', async () => {
    delete process.env[REPLAY_ONLY];
    process.env[MODE] = 'record';
    process.env[KEY] = 'sk-ant-not-a-real-key';
    process.env[WORKSPACE] = 'wrkspc_not_a_real_workspace';

    await expect(import('./shop-context')).resolves.toBeDefined();

    const factory = await anthropicFactory();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-ant-not-a-real-key',
        workspaceId: 'wrkspc_not_a_real_workspace',
      }),
    );
  });

  it('keeps a transcript of the call record mode paid for', async () => {
    const directory = scratch();
    process.env[RECORDINGS] = directory;
    delete process.env[REPLAY_ONLY];
    process.env[MODE] = 'record';
    process.env[KEY] = 'sk-ant-not-a-real-key';

    const { chooseProvider, MODEL_ID } = await import('./shop-context');
    const factory = await anthropicFactory();
    factory.mockReturnValue({
      name: 'anthropic',
      model: MODEL_ID,
      generate: async () => ({ spec: recordedSpec }),
    });

    await expect(chooseProvider().generate(missingRequest())).resolves.toMatchObject({
      spec: recordedSpec,
    });
    expect(readdirSync(directory)).toHaveLength(1);
  });

  it('says why a replay failed in record mode, as it does for a call', async () => {
    const directory = scratch();
    process.env[RECORDINGS] = directory;
    delete process.env[REPLAY_ONLY];
    process.env[MODE] = 'record';
    process.env[KEY] = 'sk-ant-not-a-real-key';

    const { chooseProvider, MODEL_ID } = await import('./shop-context');
    const factory = await anthropicFactory();
    factory.mockReturnValue({
      name: 'anthropic',
      model: MODEL_ID,
      generate: async () => {
        throw new Error('record mode called the model for a page it already had');
      },
    });
    const request = missingRequest();
    writeFileSync(transcriptPath(directory, MODEL_ID, request), 'not json');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(chooseProvider().generate(request)).rejects.toThrow(/not valid JSON/);
    expect(error).toHaveBeenCalled();

    error.mockRestore();
  });
});

describe('a replay miss outside replay-only', () => {
  it('rejects without a warning in CI', async () => {
    delete process.env[REPLAY_ONLY];
    process.env[CI] = '1';

    const { chooseProvider } = await import('./shop-context');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(chooseProvider().generate(missingRequest())).rejects.toThrow(/no recording/i);
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  it('warns, then rejects, outside CI', async () => {
    delete process.env[REPLAY_ONLY];
    delete process.env[CI];

    const { chooseProvider } = await import('./shop-context');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(chooseProvider().generate(missingRequest())).rejects.toThrow(/no recording/i);
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });
});

describe('the recordings directory', () => {
  it('falls back to the default when the variable is set but empty, as an empty .env.local row leaves it', async () => {
    process.env[RECORDINGS] = '';

    const { RECORDINGS_DIRECTORY } = await import('./shop-context');

    expect(RECORDINGS_DIRECTORY).toBe(join(process.cwd(), 'recordings'));
  });

  it('uses the variable when it names a directory', async () => {
    process.env[RECORDINGS] = '/somewhere/else';

    const { RECORDINGS_DIRECTORY } = await import('./shop-context');

    expect(RECORDINGS_DIRECTORY).toBe('/somewhere/else');
  });
});
