import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startDemo } from './demo-server.js';

vi.mock('./demo-server.js', () => ({ freePort: vi.fn(), startDemo: vi.fn(), stopDemo: vi.fn() }));

describe('importing a crawl entry point', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('verify.ts starts no demo', async () => {
    let failure: unknown;
    await import('./verify.js').catch((error: unknown) => {
      failure = error;
    });

    expect(startDemo).not.toHaveBeenCalled();
    expect(failure).toBeUndefined();
  });
});
