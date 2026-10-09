import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { generateCatalog } from '../../../fixtures/catalog';
import type { Shopper } from '../../../fixtures/shoppers';
import { shoppers } from '../../../shop-context';
import ProductPage from './page';
import { ProductPageContent } from '../../../product-page';

const SKU = 'RJ-00001';

const render = async (sku: string, shopper: string) =>
  renderToStaticMarkup(await ProductPageContent({ sku, shopperId: shopper }));

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

    expect(markup).toContain('data-rudra-slot="recommendations"');
  });

  it('takes every product fact in the recommendation area from the catalog', async () => {
    const markup = await render(SKU, richShopper.id);

    const slotAt = markup.indexOf('data-rudra-slot=');
    expect(slotAt).toBeGreaterThan(-1);
    const recommendations = markup.slice(slotAt);

    const recommendedSku = /data-rudra-sku="([^"]+)"/.exec(recommendations)?.[1];
    expect(recommendedSku).toBeDefined();

    const product = generateCatalog(1).find((candidate) => candidate.sku === recommendedSku);
    expect(product, `${String(recommendedSku)} is not a SKU this catalog has`).toBeDefined();

    expect(recommendations).toContain(
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: product!.currency,
      }).format(product!.price),
    );
  });

  it('renders for a cold-start shopper as well as a rich one', async () => {
    for (const shopper of [coldStartShopper, richShopper]) {
      // eslint-disable-next-line no-await-in-loop
      expect(await render(SKU, shopper.id)).toContain('data-rudra-slot');
    }
  });

  it('renders when the shopper is unknown', async () => {
    expect(await render(SKU, 'NOT-A-SHOPPER')).toContain('data-rudra-slot');
  });
});

it('renders nothing for a SKU the catalog does not have, so the route can answer 404', () => {
  return expect(ProductPageContent({ sku: 'NOT-A-SKU', shopperId: undefined })).resolves.toBeNull();
});

const route = (sku: string) =>
  ProductPage({ params: Promise.resolve({ sku }), searchParams: Promise.resolve({}) });

describe('the route itself', () => {
  it('answers a SKU the catalog does not have with a 404', async () => {
    await expect(route('NOT-A-SKU')).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND|404/);
  });

  it('does not 404 a product that exists', async () => {
    await expect(route(SKU)).resolves.toBeTruthy();
  });
});

const STYLESHEET = '<link rel="stylesheet" href="/demo-styles.css"';

const renderRoute = async (searchParams: { shopper?: string; styles?: string }) =>
  renderToStaticMarkup(
    await ProductPage({
      params: Promise.resolve({ sku: SKU }),
      searchParams: Promise.resolve(searchParams),
    }),
  );

const toggleHref = (markup: string): string => {
  const match = /<a href="([^"]*)">(?:Show it unstyled|Apply the example’s styles)<\/a>/.exec(
    markup,
  );
  expect(match, 'the page has no styles toggle').not.toBeNull();
  return match![1]!.replaceAll('&amp;', '&');
};

describe('the styles toggle', () => {
  it('links the stylesheet by default and offers to turn it off', async () => {
    const markup = await renderRoute({ shopper: richShopper.id });

    expect(markup).toContain(STYLESHEET);
    expect(markup).toContain('Show it unstyled');
    expect(toggleHref(markup)).toBe(`?shopper=${richShopper.id}&styles=off`);
  });

  it('drops the stylesheet when styles=off and offers to put it back', async () => {
    const markup = await renderRoute({ shopper: richShopper.id, styles: 'off' });

    expect(markup).not.toContain(STYLESHEET);
    expect(markup).toContain('Apply the example’s styles');
    expect(toggleHref(markup)).toBe(`?shopper=${richShopper.id}`);
  });
});
