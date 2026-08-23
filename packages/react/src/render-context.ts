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
  /** Rendered onto the wrapper, for click attribution and benchmarks. */
  slot: string;
}

export function defaultHrefForSku(sku: string): string {
  return `/product/${encodeURIComponent(sku)}`;
}

export function defaultFormatPrice(product: Product): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: product.currency,
      maximumFractionDigits: 2,
    }).format(product.price);
  } catch {
    // A currency code Intl does not recognise must not take down a page.
    return `${product.currency} ${product.price.toFixed(2)}`;
  }
}
