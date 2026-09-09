import type { Bundle, Product } from '@rudra-js/core';
import { describe, expect, it, vi } from 'vitest';
import { defaultFormatBundlePrice, defaultFormatPrice } from './render-context.js';

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

function withThrowingIntl(run: () => string): string {
  const constructor = vi.spyOn(Intl, 'NumberFormat').mockImplementation(() => {
    throw new RangeError('no formatter here');
  });

  try {
    return run();
  } finally {
    constructor.mockRestore();
  }
}

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

describe('formatting a price when Intl will not build a formatter', () => {
  it('falls back to the currency and the number for a product', () => {
    expect(withThrowingIntl(() => defaultFormatPrice(PRODUCT))).toBe('USD 129.5');
  });

  it('falls back to the currency and the number for a bundle', () => {
    expect(withThrowingIntl(() => defaultFormatBundlePrice(BUNDLE))).toBe('USD 250');
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
    expect(() => defaultFormatPrice({ ...PRODUCT, price: Number.NaN })).toThrow(TypeError);
  });

  it('throws for a bundle', () => {
    expect(() => defaultFormatBundlePrice({ ...BUNDLE, price: Number.NaN })).toThrow(TypeError);
  });
});
