import type { Bundle, Product } from '@rudra-js/core';

export interface BlockRenderContext {
  readonly products: ReadonlyMap<string, Product>;

  readonly bundles: ReadonlyMap<string, Bundle>;

  readonly hrefForSku: (sku: string) => string;
  readonly formatPrice: (product: Product) => string;
  readonly formatBundlePrice: (bundle: Bundle) => string;
}

export function defaultHrefForSku(sku: string): string {
  return `/product/${encodeURIComponent(sku)}`;
}

export function sellableProduct(
  products: ReadonlyMap<string, Product>,
  sku: string,
): Product | undefined {
  const product = products.get(sku);
  return product?.isInStock === false ? undefined : product;
}

export function defaultFormatPrice(product: Product, locale?: string): string {
  if (!Number.isFinite(product.price)) {
    throw new TypeError(
      `price for SKU ${product.sku} is ${String(product.price)}, not a finite number — ` +
        'catalog objects must satisfy productSchema from @rudra-js/core',
    );
  }

  let formatter: Intl.NumberFormat;
  try {
    formatter = new Intl.NumberFormat(locale, { style: 'currency', currency: product.currency });
  } catch {
    return `${product.currency} ${product.price}`;
  }

  return formatter.format(product.price);
}

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
