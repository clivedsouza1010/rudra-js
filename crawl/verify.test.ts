import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./entry-point.js', () => ({ isEntryPoint: () => true }));
vi.mock('./shop-server.js', () => ({
  freePort: () => Promise.resolve(3999),
  startShop: () => ({ shop: {}, ready: Promise.resolve(), seen: () => '' }),
  stopShop: () => Promise.resolve(),
}));

const IN_PLACE = `<!DOCTYPE html><html><body><main><h1>Trail Shoe</h1>
<section class="rudra" data-rudra-slot="recommendations" data-rudra-source="llm"></section></main></body></html>`;

async function verifying(
  html: string,
): Promise<{ exitCode: number | string | undefined; errors: unknown[] }> {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(html)));
  vi.resetModules();
  process.exitCode = undefined;

  try {
    await import('./verify.js');
    return { exitCode: process.exitCode, errors: errors.mock.calls.map((call) => call[0]) };
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
    expect((await verifying(IN_PLACE)).exitCode).toBeUndefined();
  });

  it('fails a page whose only problem is a slot after </main>', async () => {
    const late = `<!DOCTYPE html><html><body><main><h1>Trail Shoe</h1></main>
<section class="rudra" data-rudra-slot="recommendations" data-rudra-source="llm"></section></body></html>`;

    expect((await verifying(late)).exitCode).toBe(1);
  });

  it('fails a page that parks its slot in a hidden div', async () => {
    const deferred = `<!DOCTYPE html><html><body><main><h1>Trail Shoe</h1></main>
<div hidden id="S:0"><section class="rudra" data-rudra-slot="recommendations" data-rudra-source="llm"></section></div>
<script>$RC("B:0","S:0")</script></body></html>`;

    expect((await verifying(deferred)).exitCode).toBe(1);
  });

  it('fails the deterministic fallback, which is server-rendered and so passes every check', async () => {
    const fallback = IN_PLACE.replace('data-rudra-source="llm"', 'data-rudra-source="fallback"');

    expect((await verifying(fallback)).exitCode).toBe(1);
  });

  it('fails a page that does not say where its component came from', async () => {
    const unnamed = IN_PLACE.replace(' data-rudra-source="llm"', '');

    expect((await verifying(unnamed)).exitCode).toBe(1);
  });

  it('reports a missing slot before asking where the component came from', async () => {
    const empty = '<!DOCTYPE html><html><body><main><h1>Trail Shoe</h1></main></body></html>';

    const { exitCode, errors } = await verifying(empty);

    expect(exitCode).toBe(1);
    expect(errors).toContain('  - the page has no recommendation slot at all');
  });
});
