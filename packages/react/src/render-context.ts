import type { Product } from '@rudra/core';

/**
 * Everything a block renderer needs that does not come from the specification.
 *
 * Note what is absent from the spec and present here: a price, a title, an
 * image, a link. Those are resolved from the host's own catalog, keyed by a SKU
 * that reconciliation has already proved exists and is in stock. That division
 * is the whole reason a generated component is safe to put in a page — the
 * model decides what to show and how to describe it, and the shop decides what
 * is true about a product.
 */
export interface BlockRenderContext {
  /** The host's catalog, keyed by SKU. */
  products: Map<string, Product>;
  /** Host-owned link construction. */
  hrefForSku: (sku: string) => string;
  formatPrice: (product: Product) => string;
}

export function defaultHrefForSku(sku: string): string {
  return `/product/${encodeURIComponent(sku)}`;
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
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: product.currency,
    }).format(product.price);
  } catch {
    // Reachable through `locale`, which is a host prop and is not validated
    // anywhere: Intl throws on a malformed language tag. A currency code cannot
    // get here — the payload contract already requires three letters, and Intl
    // accepts any three-letter code it does not know. A price nobody can
    // punctuate is still a price worth showing.
    return `${product.currency} ${product.price}`;
  }
}
