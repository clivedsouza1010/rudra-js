import { describe, expect, it, vi } from 'vitest';
import { reportFailure } from './verify.js';

describe('reporting why the check failed', () => {
  it('prints the error, then everything the demo said, then the safe build line', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    reportFailure(new Error('fetch failed'), '[rudra] fallback (provider-error): boom in 3ms\n');

    expect(spy).toHaveBeenNthCalledWith(1, 'fetch failed');
    expect(spy).toHaveBeenNthCalledWith(
      2,
      'the demo said:\n[rudra] fallback (provider-error): boom in 3ms',
    );
    expect(spy).toHaveBeenNthCalledWith(
      3,
      'if there is no production build yet, the safe way to make one is:\n' +
        '  ANTHROPIC_API_KEY= RUDRA_REPLAY_ONLY=1 npm run build --workspace @rudra-js/example-demo',
    );
    spy.mockRestore();
  });

  it('names the safe build line even when the demo said nothing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    reportFailure(new Error('the demo did not start within 60 seconds'), '');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 'the demo did not start within 60 seconds');
    expect(spy).toHaveBeenNthCalledWith(
      2,
      'if there is no production build yet, the safe way to make one is:\n' +
        '  ANTHROPIC_API_KEY= RUDRA_REPLAY_ONLY=1 npm run build --workspace @rudra-js/example-demo',
    );
    spy.mockRestore();
  });

  it('stringifies a rejection that is not an Error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    reportFailure('a plain string rejection', '');

    expect(spy).toHaveBeenNthCalledWith(1, 'a plain string rejection');
    spy.mockRestore();
  });
});
