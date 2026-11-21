import { describe, expect, it } from 'vitest';
import { GET } from './route.js';

const image = async (file: string): Promise<string> => {
  const response = await GET(new Request('http://demo/images/x'), {
    params: Promise.resolve({ file }),
  });
  return response.text();
};

describe('the placeholder image', () => {
  it('has a size of its own, so an unstyled page does not stretch it to the viewport', async () => {
    expect(await image('rj-00001.webp')).toMatch(/<svg [^>]*width="\d+" height="\d+"/);
  });

  it('is revalidated on every load, so a changed placeholder cannot sit in a browser cache for a year', async () => {
    const response = await GET(new Request('http://demo/images/x'), {
      params: Promise.resolve({ file: 'rj-00001.webp' }),
    });
    expect(response.headers.get('cache-control')).toBe('no-cache');
  });

  it('gives the same product the same colour every time', async () => {
    expect(await image('rj-00001.webp')).toBe(await image('rj-00001.webp'));
    expect(await image('rj-00001.webp')).not.toBe(await image('rj-00002.webp'));
  });

  it('draws the product in the color a swatch asks for', async () => {
    const response = await GET(new Request('http://demo/images/rj-00001.webp?tone=2'), {
      params: Promise.resolve({ file: 'rj-00001.webp' }),
    });

    expect(await response.text()).toContain('#33658a');
  });

  it('draws a different picture for each gallery view', async () => {
    const views = await Promise.all(
      ['rj-00001.webp', 'rj-00001-2.webp', 'rj-00001-3.webp', 'rj-00001-4.webp'].map(image),
    );

    expect(new Set(views).size).toBe(4);
  });

  it('still answers with a picture for a file it does not know', async () => {
    expect(await image('not-a-product.webp')).toMatch(/^<svg /);
  });
});
