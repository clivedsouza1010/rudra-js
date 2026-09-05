import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatedSpecSchema } from '@rudra-js/core';

const KEY = 'ANTHROPIC_API_KEY';
const REPLAY_ONLY = 'RUDRA_REPLAY_ONLY';

// So afterEach can put this back instead of erasing it - a pool sharing one process across files needs that.
const AMBIENT_REPLAY_ONLY = process.env[REPLAY_ONLY];

afterEach(() => {
  delete process.env[KEY];
  if (AMBIENT_REPLAY_ONLY === undefined) {
    delete process.env[REPLAY_ONLY];
  } else {
    process.env[REPLAY_ONLY] = AMBIENT_REPLAY_ONLY;
  }
  // The module reads the environment once, so each case needs a fresh copy.
  vi.resetModules();
});

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

  it('leaves the normal path alone when the switch is off', async () => {
    // vitest.config.ts turns the switch on for every test by default, so this
    // case has to turn it back off itself to reach the path it names.
    delete process.env[REPLAY_ONLY];
    process.env[KEY] = 'sk-ant-not-a-real-key';

    // Building a provider sends nothing, so a fake key is safe here.
    await expect(import('./shop-context')).resolves.toBeDefined();
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

  it('still has the page an hour later, on the cache the generator uses', async () => {
    // Core defaults to 60 seconds, which sends the shop back to the model
    // about once a minute per cohort. That bills, and the repeat call rewrites
    // the same recording file, so no new file shows up to give it away.
    // Driving the real cache, because asserting the constant on its own passes
    // even with the wiring taken back out.
    vi.useFakeTimers();
    try {
      const { specCache } = await import('./shop-context');
      const cached = { spec: { blocks: [] } as never, generatedAt: Date.now() };

      await specCache.set('k', cached);
      vi.advanceTimersByTime(59 * 60 * 1000);

      expect(await specCache.get('k')).toStrictEqual(cached);
    } finally {
      vi.useRealTimers();
    }
  });
});
