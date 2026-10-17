import type { RecommendationRequest } from '@rudra-js/a2ui/server';

// Stands in for the session and catalog code a shop already has. The README example imports it
// as `./your-shop.js`.

const CATALOG = [
  { sku: 'A-1', title: 'Cast iron skillet', category: 'Cookware', price: 39, currency: 'USD' },
  { sku: 'A-2', title: 'Enamel dutch oven', category: 'Cookware', price: 89, currency: 'USD' },
  { sku: 'A-3', title: 'Chef knife', category: 'Knives', price: 55, currency: 'USD' },
];

export async function shopperFor(_request: Request) {
  return {
    id: 'shopper-1',
    locale: 'en-US',
    signals: { cart: [{ sku: 'A-2', at: Date.UTC(2026, 9, 1) }] },
  };
}

export async function candidatesFor(_asked: RecommendationRequest) {
  return CATALOG;
}
