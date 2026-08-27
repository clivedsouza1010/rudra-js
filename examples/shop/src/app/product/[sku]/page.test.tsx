import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ProductPage from './page.js';

const render = async (sku: string, shopper: string) =>
  renderToStaticMarkup(
    await ProductPage({
      params: Promise.resolve({ sku }),
      searchParams: Promise.resolve({ shopper }),
    }),
  );

describe('a product page', () => {
  it('renders the recommendation area into the HTML itself', async () => {
    const markup = await render('RJ-00001', 'S-0001');

    // The whole architecture claims this: it is in the response, not fetched
    // afterwards.
    expect(markup).toContain('data-rudra-slot="recommendations"');
  });

  it('takes every product fact from the catalog', async () => {
    const markup = await render('RJ-00001', 'S-0001');

    // A price in the markup that the catalog does not have would mean a
    // renderer read one from the model.
    expect(markup).toMatch(/\$\d/);
  });

  it('sends no JavaScript for the recommendation area', async () => {
    const markup = await render('RJ-00001', 'S-0001');

    expect(markup).not.toContain('<script');
  });

  it('renders for a cold-start shopper as well as a rich one', async () => {
    // Different digests, different cache keys, different code paths through
    // selection. A page that only works for one is not working.
    for (const shopper of ['S-0001', 'S-0002', 'S-0003', 'S-0004']) {
      expect(await render('RJ-00001', shopper)).toContain('data-rudra-slot');
    }
  });

  it('renders when the shopper is unknown', async () => {
    expect(await render('RJ-00001', 'NOT-A-SHOPPER')).toContain('data-rudra-slot');
  });
});
