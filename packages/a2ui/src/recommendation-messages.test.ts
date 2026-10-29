import { describe, expect, it } from 'vitest';
import { MessageProcessor, STRICT_VALIDATION, type A2uiMessage } from '@a2ui/web_core/v0_9';
import { basicCatalog } from '@a2ui/web_core/v0_9/basic_catalog';
import type { Block, Bundle, ComponentSpec, Product } from '@rudra-js/core';
import { buildRecommendationMessages } from './recommendation-messages.js';

const SURFACE_ID = 'rudra_recommendations';
const SHOP_URL = 'https://shop.example';

const CATALOG: Product[] = [
  {
    sku: 'A-1',
    title: 'Cast iron skillet',
    category: 'Cookware',
    price: 39,
    currency: 'USD',
    imageUrl: '/images/a-1.jpg',
    isInStock: true,
    tags: [],
  },
  {
    sku: 'A-2',
    title: 'Enamel dutch oven',
    category: 'Cookware',
    price: 89,
    currency: 'USD',
    imageUrl: 'https://cdn.example/a-2.jpg',
    isInStock: true,
    tags: [],
  },
  {
    sku: 'A-3',
    title: 'Chef knife',
    category: 'Knives',
    price: 55,
    currency: 'USD',
    isInStock: true,
    tags: [],
  },
  {
    sku: 'A-4',
    title: 'Sold-out pan',
    category: 'Cookware',
    price: 20,
    currency: 'USD',
    isInStock: false,
    tags: [],
  },
];

const BUNDLES: Bundle[] = [
  { id: 'B-1', skus: ['A-1', 'A-2'], price: 110, currency: 'USD', label: 'Cookware set' },
  { id: 'B-2', skus: ['A-1', 'A-4'], price: 50, currency: 'USD' },
];

const item = (sku: string, reason: string | null = null, badge: string | null = null) => ({
  sku,
  basis: 'popular' as const,
  reason,
  badge,
  emphasis: 'normal' as const,
});

function specWith(blocks: Block[]): ComponentSpec {
  return {
    tone: 'neutral',
    headline: 'Goes with your cart',
    subheadline: 'Picked from what you have',
    blocks,
    rationale: 'Internal note for engineers',
    specVersion: '1',
    slot: 'assistant',
    source: 'llm',
    generatedAt: 0,
    latencyMs: 12,
    provider: 'anthropic',
    model: 'secret-model',
  };
}

const messagesFor = (blocks: Block[], products: Product[] = CATALOG) =>
  buildRecommendationMessages(
    { spec: specWith(blocks), products, bundles: BUNDLES },
    { surfaceId: SURFACE_ID, shopUrl: SHOP_URL, locale: 'en-US' },
  );

type SentComponent = Record<string, any>;

function componentsOf(messages: A2uiMessage[]): SentComponent[] {
  for (const message of messages) {
    if ('updateComponents' in message) return message.updateComponents.components;
  }
  return [];
}

function describeComponent(component: SentComponent): string {
  switch (component['component']) {
    case 'Text':
      return `${component['variant']} ${component['text']}`;
    case 'Image':
      return `image ${component['url']}`;
    case 'Button':
      return `${component['variant']} link to ${component['action'].functionCall.args.url}`;
    case 'Card':
      return component['weight'] === undefined ? 'card' : `card weight ${component['weight']}`;
    case 'List':
      return `${component['direction']} list`;
    default:
      return String(component['component']).toLowerCase();
  }
}

function outline(messages: A2uiMessage[]): string[] {
  const byId = new Map(componentsOf(messages).map((component) => [component['id'], component]));
  const lines: string[] = [];
  const visit = (id: string, depth: number) => {
    const component = byId.get(id);
    if (!component) throw new Error(`no component has the id ${id}`);
    lines.push(`${'  '.repeat(depth)}${describeComponent(component)}`);
    const children: string[] = component['children'] ?? [component['child']].filter(Boolean);
    for (const child of children) visit(child, depth + 1);
  };
  visit('root', 0);
  if (lines.length !== byId.size) throw new Error('some components are not reachable from root');
  return lines;
}

const blockOutline = (messages: A2uiMessage[]) => outline(messages).slice(3);

const EVERY_KIND: Block[] = [
  { kind: 'hero', headline: 'A pan for life', body: 'Heats evenly', sku: 'A-1', ctaLabel: 'Shop' },
  { kind: 'grid', title: 'More cookware', columns: 2, items: [item('A-2'), item('A-3')] },
  { kind: 'carousel', title: null, items: [item('A-3')] },
  { kind: 'banner', tone: 'info', text: 'Free returns', ctaLabel: null },
  { kind: 'copy', title: null, body: 'Each piece is tested.' },
  { kind: 'bundle', title: 'Better together', body: null, ctaLabel: 'Add set', bundleId: 'B-1' },
];

describe('buildRecommendationMessages', () => {
  it('creates a surface on the basic catalog and fills it with a tree A2UI accepts', () => {
    const messages = messagesFor(EVERY_KIND);
    const processor = new MessageProcessor([basicCatalog], undefined, {
      validationConfig: STRICT_VALIDATION,
    });

    expect(messages[0]).toStrictEqual({
      version: 'v0.9',
      createSurface: { surfaceId: SURFACE_ID, catalogId: basicCatalog.id },
    });
    expect(() => processor.processMessages(messages)).not.toThrow();
    expect(processor.getSurface(SURFACE_ID)?.componentsModel.get('root')).toBeDefined();
  });

  it('heads the block with its headline and subheadline', () => {
    expect(outline(messagesFor([{ kind: 'copy', title: null, body: 'Tested.' }]))).toStrictEqual([
      'column',
      '  h2 Goes with your cart',
      '  caption Picked from what you have',
      '  column',
      '    caption Tested.',
    ]);
  });

  it('lays a grid out in rows of its column count, each card a link to its product', () => {
    const grid: Block = {
      kind: 'grid',
      title: 'More cookware',
      columns: 2,
      items: [item('A-1', 'Goes with your cart', 'New'), item('A-2'), item('A-3')],
    };

    expect(blockOutline(messagesFor([grid]))).toStrictEqual([
      '  column',
      '    h3 More cookware',
      '    row',
      '      card weight 1',
      '        borderless link to https://shop.example/product/A-1',
      '          column',
      '            image https://shop.example/images/a-1.jpg',
      '            caption New',
      '            h4 Cast iron skillet',
      '            h5 $39.00',
      '            caption Goes with your cart',
      '      card weight 1',
      '        borderless link to https://shop.example/product/A-2',
      '          column',
      '            image https://cdn.example/a-2.jpg',
      '            h4 Enamel dutch oven',
      '            h5 $89.00',
      '    row',
      '      card weight 1',
      '        borderless link to https://shop.example/product/A-3',
      '          column',
      '            h4 Chef knife',
      '            h5 $55.00',
    ]);
  });

  it('shows a carousel as a horizontal list of cards with no weight', () => {
    const carousel: Block = { kind: 'carousel', title: null, items: [item('A-3'), item('A-2')] };

    expect(blockOutline(messagesFor([carousel]))).toStrictEqual([
      '  column',
      '    horizontal list',
      '      card',
      '        borderless link to https://shop.example/product/A-3',
      '          column',
      '            h4 Chef knife',
      '            h5 $55.00',
      '      card',
      '        borderless link to https://shop.example/product/A-2',
      '          column',
      '            image https://cdn.example/a-2.jpg',
      '            h4 Enamel dutch oven',
      '            h5 $89.00',
    ]);
  });

  it('shows a hero with its words and one link holding the title, price and call to action', () => {
    expect(blockOutline(messagesFor([EVERY_KIND[0] as Block]))).toStrictEqual([
      '  column',
      '    h3 A pan for life',
      '    caption Heats evenly',
      '    primary link to https://shop.example/product/A-1',
      '      column',
      '        h4 Cast iron skillet',
      '        h5 $39.00',
      '        h5 Shop',
    ]);
  });

  it("keeps a hero's words but drops its link when its product can't be sold", () => {
    const hero: Block = {
      kind: 'hero',
      headline: 'Back soon',
      body: null,
      sku: 'A-4',
      ctaLabel: 'Shop',
    };

    expect(blockOutline(messagesFor([hero]))).toStrictEqual(['  column', '    h3 Back soon']);
  });

  it('shows a banner in a card and a copy block as text', () => {
    const blocks: Block[] = [
      { kind: 'banner', tone: 'promo', text: 'Free returns', ctaLabel: 'See how' },
      { kind: 'copy', title: 'Why cast iron', body: 'It lasts.' },
    ];

    expect(blockOutline(messagesFor(blocks))).toStrictEqual([
      '  card',
      '    column',
      '      h5 Free returns',
      '      h5 See how',
      '  column',
      '    h3 Why cast iron',
      '    caption It lasts.',
    ]);
  });

  it('shows a bundle with its label, a link to each member, its price and call to action', () => {
    expect(blockOutline(messagesFor([EVERY_KIND[5] as Block]))).toStrictEqual([
      '  card',
      '    column',
      '      h3 Cookware set',
      '      h4 Better together',
      '      column',
      '        borderless link to https://shop.example/product/A-1',
      '          h5 Cast iron skillet',
      '        borderless link to https://shop.example/product/A-2',
      '          h5 Enamel dutch oven',
      '      h5 $110.00',
      '      h5 Add set',
    ]);
  });

  it.each<[string, Block]>([
    [
      'a grid whose products are sold out or missing',
      { kind: 'grid', title: 'Gone', columns: 2, items: [item('A-4'), item('NOPE')] },
    ],
    [
      'a carousel whose products are sold out or missing',
      { kind: 'carousel', title: 'Gone', items: [item('A-4'), item('NOPE')] },
    ],
    [
      'a hero with no words and a sold-out product',
      { kind: 'hero', headline: '', body: null, sku: 'A-4', ctaLabel: 'Shop' },
    ],
    [
      'a bundle with a sold-out member',
      { kind: 'bundle', title: 'Set', body: null, ctaLabel: null, bundleId: 'B-2' },
    ],
    [
      'a bundle the result does not have',
      { kind: 'bundle', title: 'Set', body: null, ctaLabel: null, bundleId: 'B-9' },
    ],
    [
      'a bundle with no id',
      { kind: 'bundle', title: 'Set', body: null, ctaLabel: null, bundleId: null },
    ],
  ])('leaves out %s', (_, block) => {
    const messages = messagesFor([block, { kind: 'copy', title: null, body: 'Still here.' }]);

    expect(blockOutline(messages)).toStrictEqual(['  column', '    caption Still here.']);
  });

  it('leaves out a sold-out or missing card and keeps the rest of its grid', () => {
    const grid: Block = {
      kind: 'grid',
      title: null,
      columns: 3,
      items: [item('A-4'), item('NOPE'), item('A-3')],
    };

    expect(blockOutline(messagesFor([grid]))).toStrictEqual([
      '  column',
      '    row',
      '      card weight 1',
      '        borderless link to https://shop.example/product/A-3',
      '          column',
      '            h4 Chef knife',
      '            h5 $55.00',
    ]);
  });

  it('sends no messages when nothing in the block can be shown', () => {
    const grid: Block = { kind: 'grid', title: 'Gone', columns: 2, items: [item('A-4')] };

    expect(messagesFor([grid])).toStrictEqual([]);
    expect(messagesFor([])).toStrictEqual([]);
  });

  it('formats prices on the server, for the locale it is given', () => {
    const messages = buildRecommendationMessages(
      {
        spec: specWith([
          EVERY_KIND[5] as Block,
          { kind: 'carousel', title: null, items: [item('A-3')] },
        ]),
        products: CATALOG.map((product) => ({ ...product, price: 1234.5, currency: 'EUR' })),
        bundles: BUNDLES,
      },
      { surfaceId: SURFACE_ID, shopUrl: SHOP_URL, locale: 'de-DE' },
    );

    expect(outline(messages)).toContain('      h5 110,00 $');
    expect(outline(messages)).toContain('            h5 1.234,50 €');
  });

  it('uses the price formatters and the link builder it is given', () => {
    const messages = buildRecommendationMessages(
      { spec: specWith([EVERY_KIND[5] as Block]), products: CATALOG, bundles: BUNDLES },
      {
        surfaceId: SURFACE_ID,
        shopUrl: 'https://shop.example/store/',
        hrefForSku: (sku) => (sku === 'A-1' ? `items/${sku}` : `https://other.example/${sku}`),
        formatPrice: (product) => `price of ${product.sku}`,
        formatBundlePrice: (bundle) => `price of ${bundle.id}`,
      },
    );

    expect(blockOutline(messages)).toStrictEqual([
      '  card',
      '    column',
      '      h3 Cookware set',
      '      h4 Better together',
      '      column',
      '        borderless link to https://shop.example/store/items/A-1',
      '          h5 Cast iron skillet',
      '        borderless link to https://other.example/A-2',
      '          h5 Enamel dutch oven',
      '      h5 price of B-1',
      '      h5 Add set',
    ]);
  });

  it.each([
    ['a shop URL with no scheme', { shopUrl: 'shop.example' }, /the shop URL is not a URL/],
    ['a shop URL that is a path', { shopUrl: '/store' }, /the shop URL is not a URL/],
    [
      'a shop URL on another scheme',
      { shopUrl: 'ftp://shop.example' },
      /the shop URL is not an http/,
    ],
    [
      'a link on another scheme',
      { hrefForSku: () => 'javascript:alert(1)' },
      /the link for SKU A-3 is not an http/,
    ],
    [
      'a link to an app',
      { hrefForSku: () => 'intent://shop#Intent;end' },
      /the link for SKU A-3 is not an http/,
    ],
  ])('refuses %s', (_, options, message) => {
    const build = () =>
      buildRecommendationMessages(
        {
          spec: specWith([{ kind: 'carousel', title: null, items: [item('A-3')] }]),
          products: CATALOG,
        },
        { surfaceId: SURFACE_ID, shopUrl: SHOP_URL, ...options },
      );

    expect(build).toThrow(message);
  });

  it('refuses a price that is not a number rather than show it', () => {
    const products = CATALOG.map((product) => ({ ...product, price: Number.NaN }));

    expect(() =>
      messagesFor([{ kind: 'carousel', title: null, items: [item('A-3')] }], products),
    ).toThrow(/price for SKU A-3 is NaN, not a number/);
  });

  it('turns brackets into parentheses and line breaks into spaces, so no text becomes a link or an image', () => {
    const products = CATALOG.map((product) =>
      product.sku === 'A-3' ? { ...product, title: '![x](https://evil.example/p.png)' } : product,
    );
    const carousel: Block = {
      kind: 'carousel',
      title: 'Line one\n\n# Line two',
      items: [item('A-3', '[Free](https://evil.example)', null)],
    };

    expect(blockOutline(messagesFor([carousel], products))).toStrictEqual([
      '  column',
      '    h3 Line one # Line two',
      '    horizontal list',
      '      card',
      '        borderless link to https://shop.example/product/A-3',
      '          column',
      '            h4 !(x)(https://evil.example/p.png)',
      '            h5 $55.00',
      '            caption (Free)(https://evil.example)',
    ]);
  });

  it('puts no text in the body variant, which renderers read as markdown', () => {
    const variants = componentsOf(messagesFor(EVERY_KIND))
      .filter((component) => component['component'] === 'Text')
      .map((component) => component['variant']);

    expect(new Set(variants)).toStrictEqual(new Set(['h2', 'h3', 'h4', 'h5', 'caption']));
  });

  it('never sends the rationale or how the block was generated', () => {
    const sent = JSON.stringify(messagesFor(EVERY_KIND));

    for (const hidden of ['Internal note for engineers', 'anthropic', 'secret-model', 'llm']) {
      expect(sent).not.toContain(hidden);
    }
  });

  it('creates the surface on the catalog id it is given', () => {
    const legacyId = 'https://a2ui.org/specification/v0_9/basic_catalog.json';
    const [createSurface] = buildRecommendationMessages(
      { spec: specWith([{ kind: 'copy', title: null, body: 'Tested.' }]), products: CATALOG },
      { surfaceId: 'picks', shopUrl: SHOP_URL, catalogId: legacyId },
    );

    expect(createSurface).toStrictEqual({
      version: 'v0.9',
      createSurface: { surfaceId: 'picks', catalogId: legacyId },
    });
  });
});
