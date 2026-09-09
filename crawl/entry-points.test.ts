import { describe, expect, it, vi } from 'vitest';
import { startShop } from './shop-server.js';

vi.mock('./shop-server.js', () => ({ freePort: vi.fn(), startShop: vi.fn(), stopShop: vi.fn() }));

describe('importing a crawl entry point', () => {
  it('verify.ts starts no shop', async () => {
    await import('./verify.js');

    expect(startShop).not.toHaveBeenCalled();
  });

  it('run-matrix.ts starts no shop', async () => {
    await import('./run-matrix.js');

    expect(startShop).not.toHaveBeenCalled();
  });
});
