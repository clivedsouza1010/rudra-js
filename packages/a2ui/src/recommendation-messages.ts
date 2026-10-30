import type { A2uiMessage } from '@a2ui/web_core/v0_9';
import type {
  BannerBlock,
  Block,
  Bundle,
  BundleBlock,
  CopyBlock,
  HeroBlock,
  Product,
  ProductReference,
} from '@rudra-js/core';
import type { RecommendationResult } from './recommendation-result.js';

export interface RecommendationMessagesOptions {
  surfaceId: string;
  shopUrl: string;
  catalogId?: string | undefined;
  hrefForSku?: ((sku: string) => string) | undefined;
  formatPrice?: ((product: Product) => string) | undefined;
  formatBundlePrice?: ((bundle: Bundle) => string) | undefined;
  locale?: string | undefined;
}

const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
const CARDS_PER_ROW = 2;

type TextVariant = 'h2' | 'h3' | 'h4' | 'h5' | 'caption';

interface OpenUrlAction {
  functionCall: { call: 'openUrl'; args: { url: string }; returnType: 'void' };
}

type BasicComponent =
  | { id: string; component: 'Text'; text: string; variant: TextVariant }
  | { id: string; component: 'Image'; url: string; fit: 'cover'; variant: 'mediumFeature' }
  | { id: string; component: 'Row'; children: string[]; align: 'start' }
  | { id: string; component: 'Column'; children: string[]; align?: 'start'; weight?: number }
  | { id: string; component: 'Card'; child: string; weight?: number }
  | {
      id: string;
      component: 'Button';
      child: string;
      variant: 'borderless';
      action: OpenUrlAction;
    };

interface BuildContext {
  readonly products: ReadonlyMap<string, Product>;
  readonly bundles: ReadonlyMap<string, Bundle>;
  readonly shopUrl: string;
  readonly linkFor: (sku: string) => string;
  readonly formatPrice: (product: Product) => string;
  readonly formatBundlePrice: (bundle: Bundle) => string;
  readonly add: (component: BasicComponent) => string;
}

function defaultHrefForSku(sku: string): string {
  return `/product/${encodeURIComponent(sku)}`;
}

function formatMoney(price: number, currency: string, locale: string | undefined): string {
  let formatter: Intl.NumberFormat;
  try {
    formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  } catch {
    return `${currency} ${price}`;
  }
  return formatter.format(price);
}

function defaultFormatPrice(product: Product, locale: string | undefined): string {
  if (!Number.isFinite(product.price)) {
    throw new TypeError(
      `price for SKU ${product.sku} is ${String(product.price)}, not a finite number. ` +
        'Catalog objects must satisfy productSchema from @rudra-js/core',
    );
  }
  return formatMoney(product.price, product.currency, locale);
}

function defaultFormatBundlePrice(bundle: Bundle, locale: string | undefined): string {
  if (!Number.isFinite(bundle.price)) {
    throw new TypeError(
      `price for bundle ${bundle.id} is ${String(bundle.price)}, not a finite number. ` +
        'Bundle objects must satisfy bundleSchema from @rudra-js/core',
    );
  }
  return formatMoney(bundle.price, bundle.currency, locale);
}

function toWebUrl(value: unknown, base: string | undefined, name: string): string {
  if (typeof value !== 'string') throw new TypeError(`${name} is not a string`);
  if (value.trim() === '') throw new TypeError(`${name} is empty`);
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    throw new TypeError(`${name} is not a URL: ${value}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError(`${name} is not an http or https URL: ${value}`);
  }
  return url.href;
}

function plainText(value: string): string {
  return value
    .replace(/[\t\n\v\f\r \u0085\u2028\u2029]+/g, ' ')
    .trim()
    .replaceAll('[', '(')
    .replaceAll(']', ')')
    .replaceAll('<', '‹')
    .replaceAll('>', '›');
}

function defined(ids: readonly (string | undefined)[]): string[] {
  return ids.filter((id): id is string => id !== undefined);
}

function sellableProduct(context: BuildContext, sku: string): Product | undefined {
  const product = context.products.get(sku);
  return product?.isInStock === false ? undefined : product;
}

function addText(
  context: BuildContext,
  id: string,
  value: string | null,
  variant: TextVariant,
): string | undefined {
  const text = value === null ? '' : plainText(value);
  return text ? context.add({ id, component: 'Text', text, variant }) : undefined;
}

function addStartColumn(
  context: BuildContext,
  id: string,
  children: readonly (string | undefined)[],
) {
  return context.add({ id, component: 'Column', align: 'start', children: defined(children) });
}

function addColumn(context: BuildContext, id: string, children: readonly (string | undefined)[]) {
  return context.add({ id, component: 'Column', children: defined(children) });
}

function addLink(context: BuildContext, id: string, sku: string, child: string): string {
  const url = context.linkFor(sku);
  return context.add({
    id,
    component: 'Button',
    child,
    variant: 'borderless',
    action: { functionCall: { call: 'openUrl', args: { url }, returnType: 'void' } },
  });
}

function addLinkedCard(
  context: BuildContext,
  id: string,
  sku: string,
  children: readonly (string | undefined)[],
  weight: number | undefined,
): string {
  const link = addLink(context, `${id}_link`, sku, addStartColumn(context, `${id}_body`, children));
  return context.add({
    id,
    component: 'Card',
    child: link,
    ...(weight === undefined ? {} : { weight }),
  });
}

function addProductCard(
  context: BuildContext,
  id: string,
  reference: ProductReference,
  product: Product,
): string {
  const image = product.imageUrl?.trim()
    ? context.add({
        id: `${id}_image`,
        component: 'Image',
        url: toWebUrl(product.imageUrl, context.shopUrl, `the image for SKU ${product.sku}`),
        fit: 'cover',
        variant: 'mediumFeature',
      })
    : undefined;
  return addLinkedCard(
    context,
    id,
    product.sku,
    [
      image,
      addText(context, `${id}_badge`, reference.badge, 'caption'),
      addText(context, `${id}_title`, product.title, 'h5'),
      addText(context, `${id}_price`, context.formatPrice(product), 'h5'),
      addText(context, `${id}_reason`, reference.reason, 'caption'),
    ],
    1,
  );
}

function addCardRows(
  context: BuildContext,
  id: string,
  title: string | null,
  items: readonly ProductReference[],
): string | undefined {
  const cards: string[] = [];
  for (const reference of items) {
    const product = sellableProduct(context, reference.sku);
    if (product) {
      cards.push(addProductCard(context, `${id}_item${cards.length}`, reference, product));
    }
  }
  if (cards.length === 0) return undefined;

  const rows: string[] = [];
  for (let start = 0; start < cards.length; start += CARDS_PER_ROW) {
    const rowId = `${id}_row${rows.length}`;
    const row = cards.slice(start, start + CARDS_PER_ROW);
    while (row.length < CARDS_PER_ROW) {
      row.push(
        context.add({
          id: `${rowId}_space${row.length}`,
          component: 'Column',
          children: [],
          weight: 1,
        }),
      );
    }
    rows.push(context.add({ id: rowId, component: 'Row', align: 'start', children: row }));
  }
  return addColumn(context, id, [addText(context, `${id}_title`, title, 'h3'), ...rows]);
}

function addHero(context: BuildContext, id: string, block: HeroBlock): string | undefined {
  const product = block.sku === null ? undefined : sellableProduct(context, block.sku);
  const headline = addText(context, `${id}_headline`, block.headline, 'h3');
  const body = addText(context, `${id}_body`, block.body, 'caption');
  if (!headline && !body && !product) return undefined;

  const card = product
    ? addLinkedCard(
        context,
        `${id}_product`,
        product.sku,
        [
          addText(context, `${id}_product_title`, product.title, 'h4'),
          addText(context, `${id}_product_price`, context.formatPrice(product), 'h5'),
          addText(context, `${id}_product_cta`, block.ctaLabel, 'h5'),
        ],
        undefined,
      )
    : undefined;
  return addStartColumn(context, id, [headline, body, card]);
}

function addBanner(context: BuildContext, id: string, block: BannerBlock): string {
  const body = addStartColumn(context, `${id}_body`, [
    addText(context, `${id}_text`, block.text, 'h5'),
    addText(context, `${id}_cta`, block.ctaLabel, 'h5'),
  ]);
  return context.add({ id, component: 'Card', child: body });
}

function addCopy(context: BuildContext, id: string, block: CopyBlock): string {
  return addStartColumn(context, id, [
    addText(context, `${id}_title`, block.title, 'h3'),
    addText(context, `${id}_body`, block.body, 'caption'),
  ]);
}

function addBundle(context: BuildContext, id: string, block: BundleBlock): string | undefined {
  const bundle = block.bundleId === null ? undefined : context.bundles.get(block.bundleId);
  if (!bundle) return undefined;

  const products: Product[] = [];
  for (const sku of bundle.skus) {
    const product = sellableProduct(context, sku);
    if (!product) return undefined;
    products.push(product);
  }

  const items = addStartColumn(
    context,
    `${id}_items`,
    products.map((product, index) =>
      addLink(
        context,
        `${id}_item${index}`,
        product.sku,
        context.add({
          id: `${id}_item${index}_title`,
          component: 'Text',
          text: plainText(product.title) || plainText(product.sku),
          variant: 'h5',
        }),
      ),
    ),
  );
  const body = addStartColumn(context, `${id}_body`, [
    addText(context, `${id}_label`, bundle.label ?? null, 'h3'),
    addText(context, `${id}_title`, block.title, 'h4'),
    addText(context, `${id}_text`, block.body, 'caption'),
    items,
    addText(context, `${id}_price`, context.formatBundlePrice(bundle), 'h5'),
    addText(context, `${id}_cta`, block.ctaLabel, 'h5'),
  ]);
  return context.add({ id, component: 'Card', child: body });
}

function addBlock(context: BuildContext, id: string, block: Block): string | undefined {
  switch (block.kind) {
    case 'hero':
      return addHero(context, id, block);
    case 'grid':
    case 'carousel':
      return addCardRows(context, id, block.title, block.items);
    case 'banner':
      return addBanner(context, id, block);
    case 'copy':
      return addCopy(context, id, block);
    case 'bundle':
      return addBundle(context, id, block);
    default:
      block satisfies never;
      return undefined;
  }
}

export function buildRecommendationMessages(
  result: RecommendationResult,
  options: RecommendationMessagesOptions,
): A2uiMessage[] {
  const shopUrl = toWebUrl(options.shopUrl, undefined, 'the shop URL');
  const hrefForSku = options.hrefForSku ?? defaultHrefForSku;
  const components: BasicComponent[] = [];
  const context: BuildContext = {
    products: new Map(result.products.map((product) => [product.sku, product])),
    bundles: new Map((result.bundles ?? []).map((bundle) => [bundle.id, bundle])),
    shopUrl,
    linkFor: (sku) => toWebUrl(hrefForSku(sku), shopUrl, `the link for SKU ${sku}`),
    formatPrice: options.formatPrice ?? ((product) => defaultFormatPrice(product, options.locale)),
    formatBundlePrice:
      options.formatBundlePrice ?? ((bundle) => defaultFormatBundlePrice(bundle, options.locale)),
    add: (component) => {
      components.push(component);
      return component.id;
    },
  };

  const blocks = defined(
    result.spec.blocks.map((block, index) => addBlock(context, `block${index}`, block)),
  );
  if (blocks.length === 0) return [];

  addColumn(context, 'root', [
    addText(context, 'headline', result.spec.headline, 'h2'),
    addText(context, 'subheadline', result.spec.subheadline, 'caption'),
    ...blocks,
  ]);
  const { surfaceId } = options;
  return [
    {
      version: 'v0.9',
      createSurface: { surfaceId, catalogId: options.catalogId ?? BASIC_CATALOG_ID },
    },
    { version: 'v0.9', updateComponents: { surfaceId, components } },
  ];
}
