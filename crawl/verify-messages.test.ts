import { describe, expect, it, vi } from 'vitest';
import { exitedBeforeServing, reportFailure } from './verify-messages.js';

describe('the message for a shop that exited before serving', () => {
  it('names the safe build line, so the operator knows what to run instead of guessing', () => {
    expect(exitedBeforeServing(1)).toEqual(
      'the shop exited with 1 before serving anything. If there is no production build yet, run:\n' +
        '  ANTHROPIC_API_KEY= RUDRA_REPLAY_ONLY=1 npm run build --workspace @rudra-js/example-shop',
    );
  });

  it('still names the exit code when next was killed rather than exiting on its own', () => {
    expect(exitedBeforeServing(null)).toEqual(
      'the shop exited with null before serving anything. If there is no production build yet, run:\n' +
        '  ANTHROPIC_API_KEY= RUDRA_REPLAY_ONLY=1 npm run build --workspace @rudra-js/example-shop',
    );
  });
});

describe('reporting why the check failed', () => {
  it('prints the error, then everything the shop said', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    reportFailure(new Error('the shop answered 500'), '[rudra] provider failed: boom\n');

    expect(spy).toHaveBeenNthCalledWith(1, 'the shop answered 500');
    expect(spy).toHaveBeenNthCalledWith(2, 'the shop said:\n[rudra] provider failed: boom');
    spy.mockRestore();
  });

  it('prints only the error when the shop said nothing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    reportFailure(new Error('the shop did not start within 60 seconds'), '');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('the shop did not start within 60 seconds');
    spy.mockRestore();
  });

  it('stringifies a rejection that is not an Error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    reportFailure('a plain string rejection', '');

    expect(spy).toHaveBeenCalledWith('a plain string rejection');
    spy.mockRestore();
  });
});
