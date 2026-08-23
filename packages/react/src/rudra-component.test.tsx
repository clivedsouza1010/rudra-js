import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ComponentSpec, GeneratedSpec, Product } from '@rudra/core';
import { RudraComponent } from './rudra-component.js';
import { extendRegistry } from './registry.js';

const product = (sku: string, overrides: Partial<Product> = {}): Product => ({
  sku,
  title: `Product ${sku}`,
  category: 'Trail Running',
  price: 174,
  currency: 'USD',
  isInStock: true,
  tags: [],
  ...overrides,
});

const CATALOG = [product('TR-101'), product('TR-102')];

const reference = (sku: string, overrides = {}) => ({
  sku,
  basis: 'popular' as const,
  reason: 'A dependable pick',
  badge: null,
  emphasis: 'normal' as const,
  ...overrides,
});

const spec = (
  blocks: GeneratedSpec['blocks'],
  overrides: Partial<ComponentSpec> = {},
): ComponentSpec => ({
  tone: 'neutral',
  headline: 'Picked for you',
  subheadline: null,
  blocks,
  rationale: 'Leaned on the category affinity.',
  specVersion: '1',
  slot: 'recommendations',
  source: 'llm',
  generatedAt: 1_700_000_000_000,
  latencyMs: 42,
  provider: 'anthropic',
  model: 'claude-opus-5',
  ...overrides,
});

const gridSpec = (items = [reference('TR-101')], overrides: Partial<ComponentSpec> = {}) =>
  spec([{ kind: 'grid', title: 'For you', columns: 2, items }], overrides);

const html = (element: ReactElement) => renderToStaticMarkup(element);
const render = (componentSpec: ComponentSpec, props = {}) =>
  html(<RudraComponent spec={componentSpec} products={CATALOG} {...props} />);

/**
 * The claim the whole design rests on: model output reaches the page as text
 * and nothing else. These assert the rendered HTML rather than the component
 * tree, because the string is what a browser actually receives.
 */
describe('what generated text can do to the page', () => {
  const hostile = '<script>alert(1)</script>';

  it.each([
    ['a headline', () => gridSpec([reference('TR-101')], { headline: hostile })],
    ['a subheadline', () => gridSpec([reference('TR-101')], { subheadline: hostile })],
    [
      'a grid title',
      () => spec([{ kind: 'grid', title: hostile, columns: 2, items: [reference('TR-101')] }]),
    ],
    ['a product reason', () => gridSpec([reference('TR-101', { reason: hostile })])],
    ['a product badge', () => gridSpec([reference('TR-101', { badge: hostile })])],
    [
      'a hero headline',
      () => spec([{ kind: 'hero', headline: hostile, body: null, sku: null, ctaLabel: null }]),
    ],
    [
      'a hero body',
      () => spec([{ kind: 'hero', headline: 'Trail', body: hostile, sku: null, ctaLabel: null }]),
    ],
    [
      'a hero call to action',
      () => spec([{ kind: 'hero', headline: 'Trail', body: null, sku: null, ctaLabel: hostile }]),
    ],
    [
      'a carousel title',
      () => spec([{ kind: 'carousel', title: hostile, items: [reference('TR-101')] }]),
    ],
    ['banner text', () => spec([{ kind: 'banner', tone: 'info', text: hostile, ctaLabel: null }])],
    [
      'a banner call to action',
      () => spec([{ kind: 'banner', tone: 'info', text: 'Free returns', ctaLabel: hostile }]),
    ],
    ['a copy title', () => spec([{ kind: 'copy', title: hostile, body: 'Built for rock.' }])],
    ['copy body', () => spec([{ kind: 'copy', title: null, body: hostile }])],
  ])('escapes markup in %s', (_label, build) => {
    const markup = render(build());

    expect(markup).not.toContain('<script>');
    expect(markup).toContain('&lt;script&gt;');
  });

  it('renders no script tag of its own, so the area needs no JavaScript', () => {
    const markup = render(
      spec([
        { kind: 'grid', title: null, columns: 2, items: [reference('TR-101')] },
        { kind: 'carousel', title: null, items: [reference('TR-102')] },
        { kind: 'banner', tone: 'promo', text: 'Free returns', ctaLabel: 'See more' },
        { kind: 'copy', title: null, body: 'Built for wet rock.' },
      ]),
    );

    // Both of these bind: a real <script> tag and a real javascript: href do
    // appear in the output when the source emits them. An `onclick` check would
    // not — renderToStaticMarkup drops handlers whatever the source says.
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('javascript:');
  });
});

/**
 * The other half of the same claim. The specification carries no price, title,
 * image or link — a renderer that read one from it would hand the model the
 * ability to lie about a product.
 */
describe('where product facts come from', () => {
  it('takes the title and price from the catalog', () => {
    const markup = render(gridSpec(), {
      products: [
        product('TR-101', { title: 'Switchback Trail Shoe', price: 199, currency: 'GBP' }),
      ],
    });

    expect(markup).toContain('Switchback Trail Shoe');
    expect(markup).toContain('199');
  });

  it('links using the catalog function the host supplied, not the spec', () => {
    const markup = render(gridSpec(), { hrefForSku: (sku: string) => `/shop/${sku}?ref=rudra` });

    expect(markup).toContain('/shop/TR-101?ref=rudra');
  });

  it('formats the price using the function the host supplied', () => {
    const markup = render(gridSpec(), { formatPrice: () => 'FROM £99' });

    expect(markup).toContain('FROM £99');
  });

  it('takes the image from the catalog, and only from the catalog', () => {
    const markup = render(gridSpec(), {
      products: [product('TR-101', { imageUrl: 'https://cdn.example.com/tr-101.png' })],
    });

    // <img src> is the highest-risk sink here. The payload contract is what
    // rejects a javascript: or an empty one, and nothing in the spec can reach
    // this attribute at all.
    expect(markup).toContain('src="https://cdn.example.com/tr-101.png"');
  });

  it('renders no image element when the catalog has no image', () => {
    expect(render(gridSpec())).not.toContain('<img');
  });

  it('renders nothing for a SKU the catalog does not have', () => {
    // Reconciliation should have removed it, so this is the second line of
    // defence rather than the first.
    const markup = render(gridSpec([reference('GHOST-1')]));

    expect(markup).not.toContain('GHOST-1');
  });

  it('escapes a SKU on its way into a link', () => {
    const markup = render(gridSpec([reference('TR/101?x=1')]), {
      products: [product('TR/101?x=1')],
    });

    expect(markup).toContain('TR%2F101%3Fx%3D1');
  });
});

describe('what the markup says about itself', () => {
  it('records the slot and where the component came from', () => {
    const markup = render(gridSpec());

    expect(markup).toContain('data-rudra-slot="recommendations"');
    expect(markup).toContain('data-rudra-source="llm"');
  });

  it('keeps the vendor and the degradation state out of the page by default', () => {
    const markup = render(
      gridSpec([reference('TR-101')], { source: 'fallback', degradedReason: 'timeout' }),
    );

    // These tell a visitor which model a shop uses and when it is not working.
    expect(markup).not.toContain('claude-opus-5');
    expect(markup).not.toContain('anthropic');
    expect(markup).not.toContain('timeout');
  });

  it('includes them when diagnostics are asked for', () => {
    const markup = render(gridSpec(), { hasDiagnostics: true });

    expect(markup).toContain('data-rudra-model="claude-opus-5"');
    expect(markup).toContain('data-rudra-latency-ms="42"');
  });

  it('keeps the model reasoning off the page by default', () => {
    expect(render(gridSpec())).not.toContain('Leaned on the category affinity');
    expect(render(gridSpec(), { hasDiagnostics: true })).toContain(
      'Leaned on the category affinity',
    );
  });

  it('records why each product was chosen, for click attribution', () => {
    const markup = render(gridSpec([reference('TR-101', { basis: 'most_viewed' })]));

    expect(markup).toContain('data-rudra-basis="most_viewed"');
  });
});

describe('the component as a whole', () => {
  it('renders nothing at all when there is nothing to show', () => {
    expect(render(spec([]))).toBe('');
  });

  it('renders every block kind', () => {
    const markup = render(
      spec([
        { kind: 'hero', headline: 'Trail season', body: null, sku: 'TR-101', ctaLabel: 'Shop' },
        { kind: 'grid', title: 'For you', columns: 3, items: [reference('TR-102')] },
        { kind: 'carousel', title: 'Start here', items: [reference('TR-101')] },
        { kind: 'banner', tone: 'restock', text: 'Back in stock', ctaLabel: null },
        { kind: 'copy', title: 'Why these', body: 'Built for wet rock.' },
      ]),
    );

    for (const marker of [
      'rudra-hero',
      'rudra-grid',
      'rudra-carousel',
      'rudra-banner',
      'rudra-copy',
    ]) {
      expect(markup).toContain(marker);
    }
  });

  it('omits an optional part rather than rendering it empty', () => {
    const markup = render(gridSpec([reference('TR-101', { badge: null, reason: null })]));

    expect(markup).not.toContain('rudra-card__badge');
    expect(markup).not.toContain('rudra-card__reason');
    expect(markup).not.toContain('rudra__subheadline');
  });

  it('accepts a catalog as a map as well as a list', () => {
    const asMap = new Map(CATALOG.map((entry) => [entry.sku, entry]));

    expect(render(gridSpec(), { products: asMap })).toContain('Product TR-101');
  });

  it('loses only the unknown block when a spec carries a kind it does not know', () => {
    const fromTheFuture = spec([
      { kind: 'timeline', title: null } as never,
      { kind: 'grid', title: null, columns: 2, items: [reference('TR-101')] },
    ]);

    // A newer core could add a block kind an older renderer predates. Losing
    // that block beats losing the page.
    expect(render(fromTheFuture)).toContain('rudra-grid');
  });

  it('lets a host replace one renderer and keep the rest', () => {
    const registry = extendRegistry({
      grid: ({ block }) => <div className="my-own-grid">{block.items.length} items</div>,
    });

    const markup = render(
      spec([
        { kind: 'grid', title: null, columns: 2, items: [reference('TR-101')] },
        { kind: 'copy', title: null, body: 'Still the default renderer.' },
      ]),
      { registry },
    );

    expect(markup).toContain('my-own-grid');
    expect(markup).toContain('Still the default renderer.');
  });
});

/**
 * Money is the one thing on the page that has to be exactly right, and it comes
 * from the catalog. Two decimal places is a dollar-and-cent assumption that is
 * wrong in both directions.
 */
describe('formatting a price', () => {
  const priceOf = (currency: string, price: number, locale?: string) =>
    render(gridSpec(), { products: [product('TR-101', { currency, price })], locale });

  it.each([
    ['a three-decimal currency keeps its third digit', 'KWD', 1.234, '1.234'],
    ['a three-decimal currency gains its third digit', 'BHD', 174, '174.000'],
    ['a currency with no subunit gains no decimals', 'JPY', 1200, '1,200'],
    ['a two-decimal currency is unchanged', 'USD', 174, '174.00'],
  ])('%s', (_label, currency, price, expected) => {
    expect(priceOf(currency, price, 'en-US')).toContain(expected);
  });

  it('punctuates in the locale the host asked for', () => {
    // A German shopper reads 1.234,50 €, not €1,234.50.
    expect(priceOf('EUR', 1234.5, 'de-DE')).toContain('1.234,50');
  });

  it('shows an unfamiliar currency code as itself', () => {
    // Intl accepts any three-letter code it does not know, so this formats
    // rather than throwing — the payload contract already guarantees three
    // letters.
    expect(priceOf('ZZZ', 42, 'en-US')).toContain('ZZZ');
  });

  it('still shows a price when the host passes a locale Intl rejects', () => {
    // `locale` is a host prop and nothing validates it. Intl throws on a
    // malformed language tag, and a page must not go down over punctuation.
    const markup = priceOf('USD', 42, 'not a locale');

    expect(markup).toContain('USD');
    expect(markup).toContain('42');
  });

  it('lets the host format prices itself', () => {
    expect(render(gridSpec(), { formatPrice: () => 'FROM 99' })).toContain('FROM 99');
  });
});

describe('a few behaviours the code asserts', () => {
  it('marks a featured product differently from an ordinary one', () => {
    const featured = render(gridSpec([reference('TR-101', { emphasis: 'featured' })]));

    expect(featured).toContain('rudra-card--featured');
    expect(render(gridSpec())).not.toContain('rudra-card--featured');
  });

  it('records the column count the model chose', () => {
    const markup = render(
      spec([{ kind: 'grid', title: null, columns: 4, items: [reference('TR-101')] }]),
    );

    expect(markup).toContain('data-rudra-columns="4"');
  });

  it('says why it fell back, but only under diagnostics', () => {
    const degraded = gridSpec([reference('TR-101')], {
      source: 'fallback',
      degradedReason: 'timeout',
    });

    expect(render(degraded, { hasDiagnostics: true })).toContain('data-rudra-degraded="timeout"');
    expect(render(degraded)).not.toContain('data-rudra-degraded');
  });

  it('names the vendor only under diagnostics', () => {
    expect(render(gridSpec(), { hasDiagnostics: true })).toContain(
      'data-rudra-provider="anthropic"',
    );
  });

  it('resolves the hero product from the catalog, price and all', () => {
    const markup = render(
      spec([{ kind: 'hero', headline: 'Trail season', body: null, sku: 'TR-101', ctaLabel: null }]),
      {
        products: [product('TR-101', { title: 'Switchback', price: 199, currency: 'USD' })],
        locale: 'en-US',
      },
    );

    expect(markup).toContain('Switchback');
    expect(markup).toContain('199.00');
  });

  it('adds a host class without losing the namespace the child classes hang off', () => {
    const markup = render(gridSpec(), { className: 'my-rail' });

    expect(markup).toContain('class="rudra my-rail"');
  });
});
