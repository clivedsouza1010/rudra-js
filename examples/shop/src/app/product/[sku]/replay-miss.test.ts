import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ProductPage from './page';

const SKU = 'RJ-00001';
const SHOPPER = 'S-0001';

describe('the replay-miss rule', () => {
  it('serves the recorded transcript rather than the fallback component', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const markup = renderToStaticMarkup(
      await ProductPage({
        params: Promise.resolve({ sku: SKU }),
        searchParams: Promise.resolve({ shopper: SHOPPER }),
      }),
    );

    expect(markup, `${String(warn.mock.calls[0]?.[0] ?? '')}, see examples/shop/README.md`).toMatch(
      /data-rudra-source="(llm|cache)"/,
    );
  });
});
