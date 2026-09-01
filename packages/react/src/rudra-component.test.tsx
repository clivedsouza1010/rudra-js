import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ComponentSpec, GeneratedSpec, Product } from '@rudra-js/core';
import { RudraComponent } from './rudra-component.js';
import { defaultFormatBundlePrice } from './render-context.js';
import { extendRegistry, type BlockRegistry } from './registry.js';

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
      // With a SKU: a call to action is only rendered next to a product it can
      // lead to.
      'a hero call to action',
      () =>
        spec([{ kind: 'hero', headline: 'Trail', body: null, sku: 'TR-101', ctaLabel: hostile }]),
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

    // <img src> is the highest-risk sink here. `productSchema` is what rejects a
    // protocol-relative or `data:` URL on the way in, and nothing in the spec
    // can reach this attribute at all.
    expect(markup).toContain('src="https://cdn.example.com/tr-101.png"');
  });

  it('renders no image element when the catalog has no image', () => {
    expect(render(gridSpec())).not.toContain('<img');
  });

  it('ignores product facts carried on the spec itself', () => {
    // Nothing in the schema allows these, so a spec carrying them is either a
    // newer core or a tampered cache entry. Either way the catalog wins: this
    // is the assertion that a renderer never learned to read a price from the
    // model.
    const markup = render(
      gridSpec([
        reference('TR-101', {
          title: 'Free Trail Shoe',
          price: 0,
          imageUrl: 'https://evil.example/pixel.png',
        }),
      ]),
      { products: [product('TR-101', { title: 'Switchback', price: 199 })], locale: 'en-US' },
    );

    expect(markup).toContain('Switchback');
    expect(markup).toContain('199.00');
    expect(markup).not.toContain('Free Trail Shoe');
    expect(markup).not.toContain('evil.example');
  });

  it('renders nothing for a SKU the catalog does not have, and keeps the rest', () => {
    // Reconciliation should have removed it, so this is the second line of
    // defence rather than the first.
    const markup = render(gridSpec([reference('GHOST-1'), reference('TR-102')]));

    expect(markup).not.toContain('GHOST-1');
    expect(markup).toContain('Product TR-102');
    // One card, not two with a hole in one of them.
    expect(markup.match(/rudra-card"/g)).toHaveLength(1);
  });

  it('links a hero product with the host function too, not only a card', () => {
    const markup = render(
      spec([{ kind: 'hero', headline: 'Trail season', body: null, sku: 'TR-101', ctaLabel: null }]),
      { hrefForSku: (sku: string) => `/shop/${sku}` },
    );

    expect(markup).toContain('href="/shop/TR-101"');
    expect(markup).toContain('data-rudra-sku="TR-101"');
  });

  it('marks each card with its SKU, so a click can be attributed to it', () => {
    expect(render(gridSpec())).toContain('data-rudra-sku="TR-101"');
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

  it('publishes that it fell back, without saying which model or why', () => {
    const markup = render(
      gridSpec([reference('TR-101')], { source: 'fallback', degradedReason: 'timeout' }),
    );

    // Where the component came from is deliberately public: fallback share is
    // readable off a rendered page. Which vendor, which model and why it fell
    // back are not — those tell a visitor what a shop runs and when it is down.
    expect(markup).toContain('data-rudra-source="fallback"');
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

  it('says nothing about degradation for a healthy spec under diagnostics', () => {
    const markup = render(gridSpec([reference('TR-101')]), { hasDiagnostics: true });

    expect(markup).not.toContain('data-rudra-degraded');
  });

  it('separates a banner tone from the tone of the component', () => {
    const markup = render(
      spec([{ kind: 'banner', tone: 'promo', text: 'Free returns', ctaLabel: null }], {
        tone: 'urgent',
      }),
    );

    // Two different vocabularies. Sharing one attribute name would make a
    // stylesheet rule written for one silently match the other.
    expect(markup).toContain('data-rudra-tone="urgent"');
    expect(markup).toContain('data-rudra-banner-tone="promo"');
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

  it('renders blocks in the order the model chose', () => {
    const markup = render(
      spec([
        { kind: 'copy', title: null, body: 'First' },
        { kind: 'banner', tone: 'info', text: 'Second', ctaLabel: null },
        { kind: 'copy', title: null, body: 'Third' },
      ]),
    );

    // Order is the model's main lever over what a shopper sees first, so it has
    // to survive rendering.
    expect(markup.indexOf('First')).toBeLessThan(markup.indexOf('Second'));
    expect(markup.indexOf('Second')).toBeLessThan(markup.indexOf('Third'));
  });

  it('renders products in the order the model ranked them', () => {
    const markup = render(gridSpec([reference('TR-102'), reference('TR-101')]));

    expect(markup.indexOf('Product TR-102')).toBeLessThan(markup.indexOf('Product TR-101'));
  });

  it('renders nothing at all when every product in the spec has left the catalog', () => {
    // A headline over an empty box reads as a broken page, which is worse than
    // no recommendation area.
    expect(render(gridSpec([reference('GHOST-1'), reference('GHOST-2')]))).toBe('');
    expect(
      render(spec([{ kind: 'carousel', title: 'Start here', items: [reference('GHOST-1')] }])),
    ).toBe('');
  });

  it('renders no call to action on a hero with no product to lead to', () => {
    const markup = render(
      spec([{ kind: 'hero', headline: 'Trail season', body: null, sku: null, ctaLabel: 'Shop' }]),
    );

    expect(markup).toContain('Trail season');
    expect(markup).not.toContain('Shop');
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

  it('keeps the default renderer when an override is present but undefined', () => {
    // `extendRegistry({ grid: overrides.grid })` with an optional value. A
    // spread would put the undefined over the default and render every grid as
    // nothing.
    // Written this way because `exactOptionalPropertyTypes` will not let this
    // file pass an explicit undefined directly. A JavaScript consumer has no
    // such protection, and neither does a TypeScript one without that flag.
    const overrides: Partial<BlockRegistry> = {};
    Object.assign(overrides, { grid: undefined });

    const registry = extendRegistry(overrides);

    expect(render(gridSpec(), { registry })).toContain('rudra-grid');
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

  it('shows an unfamiliar currency code as itself, with the amount intact', () => {
    // Intl accepts any three-letter code it does not know, so this formats
    // rather than throwing — the payload contract already guarantees three
    // letters.
    const markup = priceOf('ZZZ', 1234.5, 'en-US');

    expect(markup).toContain('ZZZ');
    expect(markup).toContain('1,234.50');
  });

  it('refuses a price that is not a number rather than pricing it at zero', () => {
    // The failure this prevents is the expensive one: Intl renders null as
    // 0 and undefined as NaN, so a catalog built by hand puts a free product on
    // a live page. A hand-built catalog is exactly what skips `productSchema`.
    expect(() => priceOf('USD', null as unknown as number)).toThrow(TypeError);
    expect(() => priceOf('USD', undefined as unknown as number)).toThrow(/not a finite number/);
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

/** Exported, so this is called with bundles `RudraComponent` would never build. */
describe('formatting a bundle price', () => {
  const bundle = { id: 'BUN-1', skus: ['TR-101', 'TR-102'], price: 300, currency: 'USD' };

  it('prices the set in the currency the shop put on the set', () => {
    // Intl puts a non-breaking space between the number and the symbol.
    expect(defaultFormatBundlePrice({ ...bundle, currency: 'EUR' }, 'de-DE')).toBe('300,00 €');
  });

  it('prices a set in a currency that has no decimals', () => {
    // Yen has none, so a forced two places would invent a fraction that does not exist.
    expect(defaultFormatBundlePrice({ ...bundle, currency: 'JPY' }, 'en-US')).toBe('¥300');
  });

  it('still shows a price when the host passes a locale Intl rejects', () => {
    expect(defaultFormatBundlePrice(bundle, 'not a locale')).toBe('USD 300');
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

/**
 * The class names are a published contract: a shop writes a stylesheet against
 * them, and renaming one silently breaks that shop's page. Reading the README
 * back is what keeps the contract and the markup from drifting apart.
 */
describe('the styling contract', () => {
  const everything = () =>
    render(
      spec(
        [
          {
            kind: 'hero',
            headline: 'Trail season',
            body: 'Wet rock',
            sku: 'TR-101',
            ctaLabel: 'Shop',
          },
          {
            kind: 'grid',
            title: 'For you',
            columns: 3,
            items: [reference('TR-101', { emphasis: 'featured', badge: 'New' })],
          },
          { kind: 'carousel', title: 'Start here', items: [reference('TR-102')] },
          { kind: 'banner', tone: 'restock', text: 'Back in stock', ctaLabel: 'See more' },
          { kind: 'copy', title: 'Why these', body: 'Built for wet rock.' },
          {
            kind: 'bundle',
            title: 'Get set up in one go',
            body: 'Both together.',
            ctaLabel: 'Add both',
            bundleId: 'BUN-1',
          },
        ],
        // Degraded as well as diagnostic: `data-rudra-degraded` is emitted
        // only in this state, so a healthy fixture never sees it and the
        // README could drop it unnoticed.
        { subheadline: 'Based on what you viewed', source: 'fallback', degradedReason: 'timeout' },
      ),
      {
        products: [
          product('TR-101', { imageUrl: 'https://cdn.example.com/a.png' }),
          product('TR-102'),
        ],
        bundles: [
          { id: 'BUN-1', skus: ['TR-101', 'TR-102'], price: 300, label: 'Trail starter set' },
        ],
        hasDiagnostics: true,
      },
    );

  it('documents every class it emits', () => {
    const emitted = new Set(
      [...everything().matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1]!.split(' ')),
    );
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

    expect(emitted.size).toBeGreaterThan(20);
    for (const className of emitted) {
      expect(readme, `.${className} is emitted but not documented`).toContain(`\`.${className}\``);
    }
  });

  it('documents every attribute it emits', () => {
    const emitted = new Set([...everything().matchAll(/(data-rudra-[a-z-]+)=/g)].map((m) => m[1]!));
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

    for (const attribute of emitted) {
      expect(readme, `${attribute} is emitted but not documented`).toContain(`\`${attribute}\``);
    }
  });
});

/**
 * The `products` prop has always been typed `readonly Product[] | ReadonlyMap`,
 * and `ReadonlyMap` is an interface: plenty of things satisfy it without being
 * a `Map`. Getting this wrong does not degrade the component — it throws while
 * the render context is being built, which takes down the host's whole page.
 */
describe('what a catalog may be', () => {
  /** Implements the interface the prop asks for, and nothing more. */
  class SkuIndex implements ReadonlyMap<string, Product> {
    readonly #entries: Map<string, Product>;

    constructor(products: readonly Product[]) {
      this.#entries = new Map(products.map((entry) => [entry.sku, entry]));
    }

    get size() {
      return this.#entries.size;
    }
    get(sku: string) {
      return this.#entries.get(sku);
    }
    has(sku: string) {
      return this.#entries.has(sku);
    }
    keys() {
      return this.#entries.keys();
    }
    values() {
      return this.#entries.values();
    }
    entries() {
      return this.#entries.entries();
    }
    forEach(callback: (value: Product, key: string, map: ReadonlyMap<string, Product>) => void) {
      this.#entries.forEach(callback);
    }
    [Symbol.iterator]() {
      return this.#entries[Symbol.iterator]();
    }
  }

  it('takes a catalog that satisfies ReadonlyMap without being a Map', () => {
    // A shop with a million SKUs indexes its own way rather than copying the
    // catalog into a Map on every request.
    expect(render(gridSpec(), { products: new SkuIndex(CATALOG) })).toContain('Product TR-101');
  });

  it('takes a Map built in another realm', () => {
    // `instanceof` is per-realm, so a Map that arrives from a vm context, a
    // worker or a plugin sandbox is not `instanceof Map` here. This is the
    // sharp version of the test above: it cannot be satisfied by accident.
    const foreign = runInNewContext('new Map(entries)', {
      entries: CATALOG.map((entry) => [entry.sku, entry]),
    }) as ReadonlyMap<string, Product>;

    expect(foreign instanceof Map).toBe(false);
    expect(render(gridSpec(), { products: foreign })).toContain('Product TR-101');
  });

  it('reads a collection that answers both `get` and `map` as the keyed one', () => {
    // Immutable.js maps have a `map` method. Treated as a list, every value in
    // the resulting catalog is a `[sku, product]` pair, and the page renders a
    // product with no title at `$undefined` rather than failing.
    const keyedAndMappable = {
      get: (sku: string) => CATALOG.find((entry) => entry.sku === sku),
      has: (sku: string) => CATALOG.some((entry) => entry.sku === sku),
      map: (project: (entry: Product) => unknown) => CATALOG.map(project),
    } as unknown as ReadonlyMap<string, Product>;

    const markup = render(gridSpec(), { products: keyedAndMappable });

    expect(markup).toContain('Product TR-101');
    expect(markup).not.toContain('undefined');
  });

  it.each([
    ['a set of products', () => new Set(CATALOG)],
    ['a plain object keyed by SKU', () => Object.fromEntries(CATALOG.map((e) => [e.sku, e]))],
    ['a map that has been through JSON', () => JSON.parse(JSON.stringify(new Map())) as unknown],
  ])('refuses %s, naming the prop', (_label, build) => {
    // Each of these is a plausible misreading of "keyed by SKU", and each one
    // carried through would render a grid as nothing and a banner as a page
    // that looks fine. The shop should hear about it on the first request.
    expect(() => render(gridSpec(), { products: build() })).toThrow(TypeError);
    expect(() => render(gridSpec(), { products: build() })).toThrow(/`products` prop/);
  });
});

describe('a bundle', () => {
  const bundleSpec = () =>
    spec([
      {
        kind: 'bundle',
        title: 'Get set up in one go',
        body: 'Both together.',
        ctaLabel: 'Add both',
        bundleId: 'BUN-1',
      },
    ]);

  const BUNDLES = [{ id: 'BUN-1', skus: ['TR-101', 'TR-102'], price: 300, currency: 'USD' }];

  it('shows the price the shop set, not the sum of the parts', () => {
    // TR-101 and TR-102 are 174 each. The saving is the whole point.
    const markup = render(bundleSpec(), { bundles: BUNDLES });

    expect(markup).toContain('$300.00');
    expect(markup).not.toContain('$348.00');
  });

  it('shows every product in the set', () => {
    const markup = render(bundleSpec(), { bundles: BUNDLES });

    expect(markup).toContain('Product TR-101');
    expect(markup).toContain('Product TR-102');
  });

  it('prices the set in the currency the shop gave the set, not a member currency', () => {
    // A member may be priced in another currency. The set says what its own
    // price is in, so nothing has to read that off a part.
    const markup = render(bundleSpec(), {
      bundles: BUNDLES,
      products: [product('TR-101', { currency: 'EUR' }), product('TR-102', { currency: 'EUR' })],
    });

    expect(markup).toContain('$300.00');
    expect(markup).not.toContain('€300.00');
  });

  it('renders nothing when the host passed no such bundle', () => {
    expect(render(bundleSpec(), { bundles: [] })).toBe('');
  });

  it('keeps the words the model wrote', () => {
    const markup = render(bundleSpec(), { bundles: BUNDLES });

    expect(markup).toContain('Get set up in one go');
    expect(markup).toContain('Add both');
  });

  it('names the set with the shop own label, ahead of the words the model wrote', () => {
    // The shop's label identifies the set; the model's title is the pitch under it.
    const markup = render(bundleSpec(), {
      bundles: [{ ...BUNDLES[0]!, label: 'Trail starter set' }],
    });

    expect(markup).toContain(
      '<section class="rudra-bundle">' +
        '<h3 class="rudra-bundle__label">Trail starter set</h3>' +
        '<p class="rudra-bundle__title">Get set up in one go</p>',
    );
  });

  it('keeps the model words when the shop gave the set no name', () => {
    const markup = render(bundleSpec(), { bundles: BUNDLES });

    expect(markup).toContain('<p class="rudra-bundle__title">Get set up in one go</p>');
    expect(markup).not.toContain('rudra-bundle__label');
  });

  it('lets the host format a bundle price itself', () => {
    const markup = render(bundleSpec(), {
      bundles: BUNDLES,
      formatBundlePrice: () => 'TWO FOR 250',
    });

    expect(markup).toContain('TWO FOR 250');
  });

  it('renders nothing at all when a member of the set has left the catalog', () => {
    // A set missing a part is not that set — same as an empty grid or carousel.
    expect(
      render(bundleSpec(), {
        bundles: BUNDLES,
        products: [product('TR-101')],
      }),
    ).toBe('');
  });
});
