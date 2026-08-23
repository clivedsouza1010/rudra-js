import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ComponentSpec, GeneratedSpec, Product } from '@rudra/core';
import { RudraComponent } from './render.js';
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
    [
      'a block title',
      () => spec([{ kind: 'grid', title: hostile, columns: 2, items: [reference('TR-101')] }]),
    ],
    ['a product reason', () => gridSpec([reference('TR-101', { reason: hostile })])],
    ['a product badge', () => gridSpec([reference('TR-101', { badge: hostile })])],
    ['banner text', () => spec([{ kind: 'banner', tone: 'info', text: hostile, ctaLabel: null }])],
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

    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('onclick');
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
    const markup = render(gridSpec(), { showDiagnostics: true });

    expect(markup).toContain('data-rudra-model="claude-opus-5"');
    expect(markup).toContain('data-rudra-latency-ms="42"');
  });

  it('keeps the model reasoning off the page by default', () => {
    expect(render(gridSpec())).not.toContain('Leaned on the category affinity');
    expect(render(gridSpec(), { showDiagnostics: true })).toContain(
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
