import type { Bundle, Product } from '@rudra-js/core';

/**
 * Everything a block renderer needs that does not come from the specification.
 *
 * Note what is absent from the spec and present here: a price, a title, an
 * image, a link. Those are resolved from the host's own catalog, keyed by a SKU
 * that `selectProducts` drew from that same catalog and `reconcileSpec` proved
 * the model did not invent — both in stock at the time. A bundle member's SKU
 * takes a different road to the same place: it comes from the set the shop
 * itself supplied, and the model never names one. That division
 * is the whole reason a generated component is safe to put in a page — the
 * model decides what to show and how to describe it, and the shop decides what
 * is true about a product.
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
  // A price that is not a finite number is a broken catalog, not a formatting
  // problem, and Intl will happily render it: null becomes 0 and prints as a
  // free product, undefined prints as NaN. Neither belongs on a shop page, and
  // both mean the catalog skipped the validation this package documents as a
  // precondition. Failing here is a bug report; rendering it is an incident.
  if (!Number.isFinite(product.price)) {
    throw new TypeError(
      `price for SKU ${product.sku} is ${String(product.price)}, not a finite number — ` +
        'catalog objects must satisfy productSchema from @rudra-js/core',
    );
  }

  let formatter: Intl.NumberFormat;
  try {
    // Only the constructor is guarded. Wrapping format() as well would swallow
    // a throwing getter on a host's own Product object and render the resulting
    // mess as a price.
    formatter = new Intl.NumberFormat(locale, { style: 'currency', currency: product.currency });
  } catch {
    // Two things reach this. A malformed `locale`, which is a host prop nothing
    // validates. And a malformed `currency` — which productSchema would have
    // rejected, but this package takes a catalog directly, so a hand-built
    // object can carry one. Intl accepts any three-letter code it does not
    // know, so 'ZZZ' formats; 'us$' and '' do not. A price nobody can
    // punctuate is still a price worth showing.
    return `${product.currency} ${product.price}`;
  }

  return formatter.format(product.price);
}

/**
 * Formats the shop's own bundle price, the same way `defaultFormatPrice` does.
 *
 * A bundle carries no currency of its own — only an id, its SKUs and a price —
 * so this reads the currency off its members, and they all have to agree.
 * Guessing was worse than failing in both directions it could guess: a member
 * missing from the catalog used to make the set dollars, and a set holding one
 * dollar product and one euro one used to print the euro price under a dollar
 * sign. A price under the wrong symbol is a false claim about money, and only
 * the shop that mixed them can say what it should read — which it now can,
 * through the `formatBundlePrice` prop.
 */
export function defaultFormatBundlePrice(
  bundle: Bundle,
  products: ReadonlyMap<string, Product>,
  locale?: string,
): string {
  let currency: string | undefined;
  for (const sku of bundle.skus) {
    const product = products.get(sku);
    if (!product) {
      throw new TypeError(
        `bundle ${bundle.id} names SKU ${sku}, which the catalog does not have — ` +
          'a bundle price can only be formatted in the currency of its own members',
      );
    }
    if (currency !== undefined && product.currency !== currency) {
      throw new TypeError(
        `bundle ${bundle.id} mixes ${currency} and ${product.currency} — ` +
          'pass `formatBundlePrice` to say how a set priced in two currencies should read',
      );
    }
    currency = product.currency;
  }

  if (currency === undefined) {
    throw new TypeError(`bundle ${bundle.id} holds no products, so it has no price to show`);
  }

  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(bundle.price);
  } catch {
    // Same reasoning as defaultFormatPrice: a malformed locale must not take
    // the page down over punctuation.
    return `${currency} ${bundle.price}`;
  }
}
