import { describe, expect, it, vi } from 'vitest';
import { exitedBeforeServing, reportFailure } from './verify-messages.js';

describe('the message for a shop that exited before serving', () => {
  it('names the exit code', () => {
    expect(exitedBeforeServing(1)).toEqual('the shop exited with 1 before serving anything');
  });

  it('still names the exit code when next was killed rather than exiting on its own', () => {
    expect(exitedBeforeServing(null)).toEqual('the shop exited with null before serving anything');
  });
});

describe('reporting why the check failed', () => {
  it('prints the error, then everything the shop said, then the safe build line', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    reportFailure(new Error('fetch failed'), '[rudra] provider failed: boom\n');

    expect(spy).toHaveBeenNthCalledWith(1, 'fetch failed');
    expect(spy).toHaveBeenNthCalledWith(2, 'the shop said:\n[rudra] provider failed: boom');
    expect(spy).toHaveBeenNthCalledWith(
      3,
      'if there is no production build yet, the safe way to make one is:\n' +
        '  ANTHROPIC_API_KEY= RUDRA_REPLAY_ONLY=1 npm run build --workspace @rudra-js/example-shop',
    );
    spy.mockRestore();
  });

  it('names the safe build line even when the shop said nothing', () => {
    // A build so broken that next never even prints — nothing to point to
    // except the one command that is safe to run next.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    reportFailure(new Error('the shop did not start within 60 seconds'), '');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 'the shop did not start within 60 seconds');
    expect(spy).toHaveBeenNthCalledWith(
      2,
      'if there is no production build yet, the safe way to make one is:\n' +
        '  ANTHROPIC_API_KEY= RUDRA_REPLAY_ONLY=1 npm run build --workspace @rudra-js/example-shop',
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
