import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ProductPage from './page';

const SKU = 'RJ-00001';
const SHOPPER = 'S-0001';
const SLOTS = [
  'recommendations',
  'compare-similar-items',
  'more-to-consider',
  'customers-also-viewed',
];

describe('the replay-miss rule', () => {
  it.each(SLOTS)('serves %s from its recorded transcript, not the fallback', async (slot) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const markup = renderToStaticMarkup(
      await ProductPage({
        params: Promise.resolve({ sku: SKU }),
        searchParams: Promise.resolve({ shopper: SHOPPER }),
      }),
    );

    const source = new RegExp(`data-rudra-slot="${slot}" data-rudra-source="([a-z]+)"`).exec(
      markup,
    )?.[1];
    const misses = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(source, `${misses}\nsee examples/demo/README.md`).toMatch(/^(llm|cache)$/);
  });
});
