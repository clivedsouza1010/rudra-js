import type { Product } from '@rudra/core';
import type { RudraTheme } from './theme.js';

/**
 * Everything a block renderer needs that does not come from the spec.
 *
 * Note what is absent: the spec never carries a URL, a price, an image, or a
 * product title. Those are resolved here, from the host's own catalog, keyed by
 * a SKU that reconciliation has already proven exists. A generated component
 * therefore cannot link somewhere unexpected or state a price that is not real.
 */
export interface RenderCtx {
  products: Map<string, Product>;
  /** Host-owned link construction. Defaults to `/product/{sku}`. */
  hrefForSku: (sku: string) => string;
  formatPrice: (product: Product) => string;
  theme: RudraTheme;
  /** Rendered onto the wrapper for click attribution and benchmark scraping. */
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
    // An unrecognised currency code must not take down the render.
    return `${product.currency} ${product.price.toFixed(2)}`;
  }
}
