import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { generateCatalog } from '../../../fixtures/catalog';
import type { Shopper } from '../../../fixtures/shoppers';
import { getShopContext } from '../../../shop';
import ProductPage from './page';

const SKU = 'RJ-00001';

const render = async (sku: string, shopper: string) =>
  renderToStaticMarkup(
    await ProductPage({
      params: Promise.resolve({ sku }),
      searchParams: Promise.resolve({ shopper }),
    }),
  );

/**
 * Shoppers are chosen by what they have done, never by id.
 *
 * Naming `S-0001` pins a test to one seed: the four ids this file used to
 * iterate all had a browsing history, so the case named for the cold-start path
 * never took it. Selecting by property keeps the meaning when the seed or the
 * cold-start rate moves, and fails loudly rather than quietly if the population
 * ever stops containing one.
 */
const { shoppers } = getShopContext();

function shopperWho(description: string, matches: (shopper: Shopper) => boolean): Shopper {
  const shopper = shoppers.find(matches);
  if (!shopper) throw new Error(`the shopper population has nobody who ${description}`);
  return shopper;
}

const coldStartShopper = shopperWho(
  'has viewed nothing',
  (shopper) => shopper.viewedSkus.length === 0,
);
const richShopper = shopperWho(
  'has viewed at least five products',
  (shopper) => shopper.viewedSkus.length >= 5,
);

describe('a product page', () => {
  it('renders the recommendation area into the HTML itself', async () => {
    const markup = await render(SKU, richShopper.id);

    // The whole architecture claims this: it is in the response, not fetched
    // afterwards.
    expect(markup).toContain('data-rudra-slot="recommendations"');
  });

  it('takes every product fact in the recommendation area from the catalog', async () => {
    const markup = await render(SKU, richShopper.id);

    // Sliced from the recommendation area onwards. The page's own <article>
    // renders the current product's price above it, so a bare "there is a
    // price in the markup" assertion passes even when this area rendered
    // nothing at all.
    const slotAt = markup.indexOf('data-rudra-slot=');
    expect(slotAt).toBeGreaterThan(-1);
    const recommendations = markup.slice(slotAt);

    const recommendedSku = /data-rudra-sku="([^"]+)"/.exec(recommendations)?.[1];
    expect(recommendedSku).toBeDefined();

    // 1 is the shop's catalog seed. Generated here rather than read back off
    // the shop, so the price below is the fixture's, not the page's own.
    const product = generateCatalog(1).find((candidate) => candidate.sku === recommendedSku);
    expect(product, `${String(recommendedSku)} is not a SKU this catalog has`).toBeDefined();

    // The exact string the renderer produces from the catalog's price and
    // currency. A renderer that ever read a price out of the model's spec
    // would put a different one here.
    expect(recommendations).toContain(
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: product!.currency,
      }).format(product!.price),
    );
  });

  it('sends no JavaScript for the recommendation area', async () => {
    // This cannot fail. `render` calls the page function directly and pipes
    // its output through `renderToStaticMarkup` — a bootstrap `<script>` tag
    // is something Next's own pipeline adds, and that pipeline never runs
    // here. The page genuinely ships no client JavaScript for this area
    // today, but this test is not what proves it; see the README for the
    // check that would.
    const markup = await render(SKU, richShopper.id);

    expect(markup).not.toContain('<script');
  });

  it('renders for a cold-start shopper as well as a rich one', async () => {
    // Different digests, different cache keys, different code paths through
    // selection. A page that only works for one is not working.
    for (const shopper of [coldStartShopper, richShopper]) {
      expect(await render(SKU, shopper.id)).toContain('data-rudra-slot');
    }
  });

  it('renders when the shopper is unknown', async () => {
    expect(await render(SKU, 'NOT-A-SHOPPER')).toContain('data-rudra-slot');
  });
});
