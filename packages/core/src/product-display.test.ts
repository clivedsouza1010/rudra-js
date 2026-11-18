import { describe, expect, it, vi } from 'vitest';
import {
  defaultFormatBundlePrice,
  defaultFormatPrice,
  defaultHrefForSku,
  findSellableProduct,
} from './product-display.js';
import type { Bundle, Product } from './tracking-input.js';

const PRODUCT: Product = {
  sku: 'TR-101',
  title: 'Trail Shoe',
  category: 'Trail Running',
  price: 129.5,
  currency: 'USD',
  isInStock: true,
  tags: [],
};

const BUNDLE: Bundle = {
  id: 'BUN-1',
  skus: ['TR-101', 'TR-102'],
  price: 250,
  currency: 'USD',
};

class ThrowingFormatter {
  format(): string {
    throw new RangeError('no digits for this currency');
  }
}

function withThrowingFormat(run: () => string): string {
  const constructor = vi.spyOn(Intl, 'NumberFormat').mockImplementation(function () {
    return new ThrowingFormatter() as unknown as Intl.NumberFormat;
  });

  try {
    return run();
  } finally {
    constructor.mockRestore();
  }
}

describe('defaultHrefForSku', () => {
  it('links to the product page under /product/', () => {
    expect(defaultHrefForSku('TR-101')).toBe('/product/TR-101');
  });

  it('encodes a slash, a space and a hash in the SKU', () => {
    expect(defaultHrefForSku('../A 3#x')).toBe('/product/..%2FA%203%23x');
  });
});

describe('findSellableProduct', () => {
  const soldOut: Product = { ...PRODUCT, sku: 'TR-102', isInStock: false };
  const products = new Map([
    [PRODUCT.sku, PRODUCT],
    [soldOut.sku, soldOut],
  ]);

  it('finds a product that is in stock', () => {
    expect(findSellableProduct(products, 'TR-101')).toBe(PRODUCT);
  });

  it('leaves out a product that is out of stock', () => {
    expect(findSellableProduct(products, 'TR-102')).toBeUndefined();
  });

  it('finds nothing for a SKU the catalog does not have', () => {
    expect(findSellableProduct(products, 'TR-999')).toBeUndefined();
  });

  it('finds a product with no stock flag, as the schema reads it as in stock', () => {
    const unflagged = { ...PRODUCT, sku: 'TR-103', isInStock: undefined } as unknown as Product;

    expect(findSellableProduct(new Map([[unflagged.sku, unflagged]]), 'TR-103')).toBe(unflagged);
  });
});

describe('formatting a price', () => {
  it('formats a product price for the locale it is given', () => {
    expect(defaultFormatPrice({ ...PRODUCT, currency: 'EUR' }, 'de-DE')).toBe('129,50\u00A0€');
  });

  it('formats a bundle price for the locale it is given', () => {
    expect(defaultFormatBundlePrice({ ...BUNDLE, currency: 'JPY' }, 'de-DE')).toBe('250\u00A0¥');
  });
});

describe('formatting a price for a locale Intl rejects', () => {
  it('falls back to the currency and the number for a product', () => {
    expect(defaultFormatPrice(PRODUCT, 'not a locale')).toBe('USD 129.5');
  });
});

describe('formatting a price when the formatter itself throws', () => {
  it('lets the throw out for a product', () => {
    expect(() => withThrowingFormat(() => defaultFormatPrice(PRODUCT))).toThrow(RangeError);
  });

  it('lets the throw out for a bundle', () => {
    expect(() => withThrowingFormat(() => defaultFormatBundlePrice(BUNDLE))).toThrow(RangeError);
  });
});

describe('a price that is not a finite number', () => {
  it('throws for a product', () => {
    expect(() => defaultFormatPrice({ ...PRODUCT, price: Number.NaN })).toThrow(
      'price for SKU TR-101 is NaN, not a finite number. Catalog objects must satisfy productSchema from @rudra-js/core',
    );
  });

  it('throws for a bundle', () => {
    expect(() => defaultFormatBundlePrice({ ...BUNDLE, price: Number.NaN })).toThrow(
      'price for bundle BUN-1 is NaN, not a finite number. Bundle objects must satisfy bundleSchema from @rudra-js/core',
    );
  });
});
