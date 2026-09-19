import { afterEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_MARKER } from './page.js';

// verify.ts works at import time, so this imports it with the shop and the fetch replaced.
vi.mock('./entry-point.js', () => ({ isEntryPoint: () => true }));
vi.mock('./shop-server.js', () => ({
  freePort: () => Promise.resolve(3999),
  startShop: () => ({ shop: {}, ready: Promise.resolve(), seen: () => '' }),
  stopShop: () => Promise.resolve(),
}));

const IN_PLACE = `<!DOCTYPE html><html><body><main><h1>Trail Shoe</h1>
<section class="rudra" data-rudra-slot="recommendations"></section></main></body></html>`;

async function verifying(html: string): Promise<number | string | undefined> {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(html)));
  vi.resetModules();
  process.exitCode = undefined;

  try {
    await import('./verify.js');
    return process.exitCode;
  } finally {
    errors.mockRestore();
    logs.mockRestore();
  }
}

describe('running the crawlability check over a served page', () => {
  afterEach(() => {
    process.exitCode = undefined;
    vi.unstubAllGlobals();
  });

  it('passes a page that writes the slot in place', async () => {
    expect(await verifying(IN_PLACE)).toBeUndefined();
  });

  it('fails a page whose only problem is a slot after </main>', async () => {
    const late = `<!DOCTYPE html><html><body><main><h1>Trail Shoe</h1></main>
<section class="rudra" data-rudra-slot="recommendations"></section></body></html>`;

    expect(await verifying(late)).toBe(1);
  });

  it('fails a page that parks its slot in a hidden div', async () => {
    const deferred = `<!DOCTYPE html><html><body><main><h1>Trail Shoe</h1></main>
<div hidden id="S:0"><section class="rudra" data-rudra-slot="recommendations"></section></div>
<script>$RC("B:0","S:0")</script></body></html>`;

    expect(await verifying(deferred)).toBe(1);
  });

  it('fails the deterministic fallback, which is server-rendered and so passes every check', async () => {
    const fallback = IN_PLACE.replace('<main>', `<main ${FALLBACK_MARKER}>`);

    expect(await verifying(fallback)).toBe(1);
  });
});
