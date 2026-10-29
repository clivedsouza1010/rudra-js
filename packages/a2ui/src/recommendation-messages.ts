import type { A2uiMessage } from '@a2ui/web_core/v0_9';
import type {
  BannerBlock,
  Block,
  Bundle,
  BundleBlock,
  CarouselBlock,
  CopyBlock,
  GridBlock,
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

type TextVariant = 'h2' | 'h3' | 'h4' | 'h5' | 'caption';

interface OpenUrlAction {
  functionCall: { call: 'openUrl'; args: { url: string }; returnType: 'void' };
}

type BasicComponent =
  | { id: string; component: 'Text'; text: string; variant: TextVariant }
  | { id: string; component: 'Image'; url: string; fit: 'cover'; variant: 'mediumFeature' }
  | { id: string; component: 'Column' | 'Row'; children: string[]; align: 'start' }
  | { id: string; component: 'List'; children: string[]; direction: 'horizontal'; align: 'start' }
  | { id: string; component: 'Card'; child: string; weight?: number }
  | {
      id: string;
      component: 'Button';
      child: string;
      variant: 'borderless' | 'primary';
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
    throw new TypeError(`price for SKU ${product.sku} is ${String(product.price)}, not a number`);
  }
  return formatMoney(product.price, product.currency, locale);
}

function defaultFormatBundlePrice(bundle: Bundle, locale: string | undefined): string {
  if (!Number.isFinite(bundle.price)) {
    throw new TypeError(`price for bundle ${bundle.id} is ${String(bundle.price)}, not a number`);
  }
  return formatMoney(bundle.price, bundle.currency, locale);
}

function toWebUrl(value: string, base: string | undefined, name: string): string {
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
    .replace(/[\t\n\v\f\r \u2028\u2029]+/g, ' ')
    .trim()
    .replaceAll('[', '(')
    .replaceAll(']', ')');
}

function present(ids: readonly (string | undefined)[]): string[] {
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

function addColumn(context: BuildContext, id: string, children: readonly (string | undefined)[]) {
  return context.add({ id, component: 'Column', align: 'start', children: present(children) });
}

function addLink(
  context: BuildContext,
  id: string,
  sku: string,
  child: string,
  variant: 'borderless' | 'primary',
): string {
  const url = context.linkFor(sku);
  const action: OpenUrlAction = {
    functionCall: { call: 'openUrl', args: { url }, returnType: 'void' },
  };
  return context.add({ id, component: 'Button', child, variant, action });
}

function addProductCard(
  context: BuildContext,
  id: string,
  reference: ProductReference,
  product: Product,
  weight: number | undefined,
): string {
  const image =
    product.imageUrl === undefined
      ? undefined
      : context.add({
          id: `${id}_image`,
          component: 'Image',
          url: toWebUrl(product.imageUrl, context.shopUrl, `the image for SKU ${product.sku}`),
          fit: 'cover',
          variant: 'mediumFeature',
        });
  const body = addColumn(context, `${id}_body`, [
    image,
    addText(context, `${id}_badge`, reference.badge, 'caption'),
    addText(context, `${id}_title`, product.title, 'h4'),
    addText(context, `${id}_price`, context.formatPrice(product), 'h5'),
    addText(context, `${id}_reason`, reference.reason, 'caption'),
  ]);
  const link = addLink(context, `${id}_link`, product.sku, body, 'borderless');
  return context.add({
    id,
    component: 'Card',
    child: link,
    ...(weight === undefined ? {} : { weight }),
  });
}

function sellableCards(context: BuildContext, items: readonly ProductReference[]) {
  return items.flatMap((reference) => {
    const product = sellableProduct(context, reference.sku);
    return product ? [{ reference, product }] : [];
  });
}

function addGrid(context: BuildContext, id: string, block: GridBlock): string | undefined {
  const cards = sellableCards(context, block.items);
  if (cards.length === 0) return undefined;

  const rows: string[] = [];
  for (let start = 0; start < cards.length; start += block.columns) {
    const row = cards
      .slice(start, start + block.columns)
      .map(({ reference, product }, offset) =>
        addProductCard(context, `${id}_item${start + offset}`, reference, product, 1),
      );
    rows.push(
      context.add({
        id: `${id}_row${rows.length}`,
        component: 'Row',
        align: 'start',
        children: row,
      }),
    );
  }
  return addColumn(context, id, [addText(context, `${id}_title`, block.title, 'h3'), ...rows]);
}

function addCarousel(context: BuildContext, id: string, block: CarouselBlock): string | undefined {
  const cards = sellableCards(context, block.items);
  if (cards.length === 0) return undefined;

  const track = context.add({
    id: `${id}_track`,
    component: 'List',
    direction: 'horizontal',
    align: 'start',
    children: cards.map(({ reference, product }, index) =>
      addProductCard(context, `${id}_item${index}`, reference, product, undefined),
    ),
  });
  return addColumn(context, id, [addText(context, `${id}_title`, block.title, 'h3'), track]);
}

function addHero(context: BuildContext, id: string, block: HeroBlock): string | undefined {
  const product = block.sku === null ? undefined : sellableProduct(context, block.sku);
  const headline = addText(context, `${id}_headline`, block.headline, 'h3');
  const body = addText(context, `${id}_body`, block.body, 'caption');
  if (!headline && !body && !product) return undefined;

  const link = product
    ? addLink(
        context,
        `${id}_link`,
        product.sku,
        addColumn(context, `${id}_link_body`, [
          addText(context, `${id}_title`, product.title, 'h4'),
          addText(context, `${id}_price`, context.formatPrice(product), 'h5'),
          addText(context, `${id}_cta`, block.ctaLabel, 'h5'),
        ]),
        'primary',
      )
    : undefined;
  return addColumn(context, id, [headline, body, link]);
}

function addBanner(context: BuildContext, id: string, block: BannerBlock): string {
  const body = addColumn(context, `${id}_body`, [
    addText(context, `${id}_text`, block.text, 'h5'),
    addText(context, `${id}_cta`, block.ctaLabel, 'h5'),
  ]);
  return context.add({ id, component: 'Card', child: body });
}

function addCopy(context: BuildContext, id: string, block: CopyBlock): string {
  return addColumn(context, id, [
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

  const items = addColumn(
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
          text: plainText(product.title),
          variant: 'h5',
        }),
        'borderless',
      ),
    ),
  );
  const body = addColumn(context, `${id}_body`, [
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
      return addGrid(context, id, block);
    case 'carousel':
      return addCarousel(context, id, block);
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

  const blocks = present(
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
