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

describe('formatting a price when Intl will not build a formatter', () => {
  it('falls back to the currency and the number for a product', () => {
    expect(withThrowingIntl(() => defaultFormatPrice(PRODUCT))).toBe('USD 129.5');
  });

  it('falls back to the currency and the number for a bundle', () => {
    expect(withThrowingIntl(() => defaultFormatBundlePrice(BUNDLE))).toBe('USD 250');
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
