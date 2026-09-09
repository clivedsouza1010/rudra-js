import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startShop } from './shop-server.js';

vi.mock('./shop-server.js', () => ({ freePort: vi.fn(), startShop: vi.fn(), stopShop: vi.fn() }));

describe('importing a crawl entry point', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('verify.ts starts no shop', async () => {
    let failure: unknown;
    await import('./verify.js').catch((error: unknown) => {
      failure = error;
    });

    expect(startShop).not.toHaveBeenCalled();
    expect(failure).toBeUndefined();
  });

  it('run-matrix.ts starts no shop', async () => {
    let failure: unknown;
    await import('./run-matrix.js').catch((error: unknown) => {
      failure = error;
    });

    expect(startShop).not.toHaveBeenCalled();
    expect(failure).toBeUndefined();
  });
});
