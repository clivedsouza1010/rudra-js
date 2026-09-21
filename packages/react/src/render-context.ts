import type { Bundle, Product } from '@rudra-js/core';

/**
 * Everything a block renderer needs that does not come from the specification.
 *
 * Note what is absent from the spec and present here: a price, a title, an
 * image, a link. Those are resolved from the host's own catalog, keyed by a SKU
 * that `selectProducts` drew from that same catalog and `reconcileSpec` proved
 * the model did not invent — both in stock at the time. A bundle member's SKU
 * comes from the set the shop supplied, not from the model. That division
 * is the whole reason a generated component is safe to put in a page — the
 * model decides how the component reads, and the shop decides what is true
 * about a product.
 */
export interface BlockRenderContext {
  /** The host's catalog, keyed by SKU. Read-only: it is the caller's own map. */
  readonly products: ReadonlyMap<string, Product>;
  /** Sets the shop sells together, keyed by id. */
  readonly bundles: ReadonlyMap<string, Bundle>;
  /** Host-owned link construction. */
  readonly hrefForSku: (sku: string) => string;
  readonly formatPrice: (product: Product) => string;
  readonly formatBundlePrice: (bundle: Bundle) => string;
}

export function defaultHrefForSku(sku: string): string {
  return `/product/${encodeURIComponent(sku)}`;
}

/**
 * The product to draw for a SKU, or nothing.
 *
 * A row the catalog flags out of stock counts as absent. Core only ever names
 * an in-stock candidate, but the catalog passed here is read later and can be
 * the fresher of the two — and a card that prices and links something the shop
 * cannot sell is worse than one card fewer. A catalog that leaves the field
 * off renders as it always did.
 */
export function sellableProduct(
  products: ReadonlyMap<string, Product>,
  sku: string,
): Product | undefined {
  const product = products.get(sku);
  return product?.isInStock === false ? undefined : product;
}

/**
 * Formats a price the way the currency itself is written.
 *
 * No digit count is specified on purpose. Two decimal places is a dollar-and-
 * cent assumption, and forcing it is wrong in both directions: Kuwaiti dinar and
 * Bahraini dinar have three, so a real digit of the price disappears, and yen has
 * none, so a price gains a fraction that does not exist. Intl already knows the
 * right number for each currency.
 *
 * `locale` decides how the number is punctuated and where the symbol sits.
 * Left undefined it falls back to the server's locale, which is almost never
 * the shopper's — a shop serving more than one should pass the shopper's.
 */
export function defaultFormatPrice(product: Product, locale?: string): string {
  if (!Number.isFinite(product.price)) {
    throw new TypeError(
      `price for SKU ${product.sku} is ${String(product.price)}, not a finite number — ` +
        'catalog objects must satisfy productSchema from @rudra-js/core',
    );
  }

  let formatter: Intl.NumberFormat;
  try {
    // Only the constructor: guarding format() too would swallow a throwing
    // getter on a host's own Product and render the mess as a price.
    formatter = new Intl.NumberFormat(locale, { style: 'currency', currency: product.currency });
  } catch {
    return `${product.currency} ${product.price}`;
  }

  return formatter.format(product.price);
}

/**
 * Formats a bundle's price, in the currency the shop put on the bundle.
 *
 * The price and the currency come from the same object, so a set whose members
 * are priced in another currency still shows the shop's own price correctly.
 */
export function defaultFormatBundlePrice(bundle: Bundle, locale?: string): string {
  if (!Number.isFinite(bundle.price)) {
    throw new TypeError(
      `price for bundle ${bundle.id} is ${String(bundle.price)}, not a finite number — ` +
        'bundle objects must satisfy bundleSchema from @rudra-js/core',
    );
  }

  let formatter: Intl.NumberFormat;
  try {
    formatter = new Intl.NumberFormat(locale, { style: 'currency', currency: bundle.currency });
  } catch {
    return `${bundle.currency} ${bundle.price}`;
  }

  return formatter.format(bundle.price);
}
