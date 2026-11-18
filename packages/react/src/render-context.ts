import type { Bundle, Product } from '@rudra-js/core';

export {
  defaultFormatBundlePrice,
  defaultFormatPrice,
  defaultHrefForSku,
  findSellableProduct,
} from '@rudra-js/core/schemas';

export interface BlockRenderContext {
  readonly products: ReadonlyMap<string, Product>;
  readonly bundles: ReadonlyMap<string, Bundle>;
  readonly hrefForSku: (sku: string) => string;
  readonly formatPrice: (product: Product) => string;
  readonly formatBundlePrice: (bundle: Bundle) => string;
}
