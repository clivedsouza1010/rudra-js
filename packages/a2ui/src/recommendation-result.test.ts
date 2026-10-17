import { describe, expect, it } from 'vitest';
import { createComponentGenerator, parseTrackingInput } from '@rudra-js/core';
import { parseRecommendationResult } from './recommendation-result.js';

const CATALOG = [
  { sku: 'A-1', title: 'Cast iron skillet', category: 'Cookware', price: 39, currency: 'USD' },
  { sku: 'A-2', title: 'Enamel dutch oven', category: 'Cookware', price: 89, currency: 'USD' },
  { sku: 'A-3', title: 'Chef knife', category: 'Knives', price: 55, currency: 'USD' },
];

const BUNDLES = [{ id: 'B-1', skus: ['A-1', 'A-2'], price: 110, label: 'Cookware set' }];

async function sentAsJson() {
  const input = parseTrackingInput({
    user: { id: 'shopper-1' },
    context: { surface: 'assistant', currentSku: 'A-1' },
    candidates: CATALOG,
    bundles: BUNDLES,
  });
  const spec = await createComponentGenerator({ provider: null }).generate(input);
  const result = { spec, products: input.candidates, bundles: input.bundles };
  const json: SentJson = JSON.parse(JSON.stringify(result));
  return { result, json };
}

type Json = Record<string, unknown>;

interface SentJson {
  spec: Json;
  products: Json[];
  bundles: Json[];
}

describe('parseRecommendationResult', () => {
  it('returns what the endpoint sent, unchanged by the trip through JSON', async () => {
    const { result, json } = await sentAsJson();

    expect(parseRecommendationResult(json)).toStrictEqual(result);
  });

  it('reads a result without bundles as having none', async () => {
    const { json } = await sentAsJson();
    const { bundles: _bundles, ...withoutBundles } = json;

    expect(parseRecommendationResult(withoutBundles).bundles).toStrictEqual([]);
  });

  it.each([null, 'spec', 42])('rejects a result that is %j', (value) => {
    expect(() => parseRecommendationResult(value)).toThrow(/not an object/);
  });

  it.each([
    [
      'a spec from another version',
      (json: SentJson) => ({ ...json, spec: { ...json.spec, specVersion: '2' } }),
    ],
    [
      'a product with a protocol-relative image',
      (json: SentJson) => ({
        ...json,
        products: [{ ...json.products[0], imageUrl: '//elsewhere.example/pixel.png' }],
      }),
    ],
    [
      'a bundle that is not a bundle',
      (json: SentJson) => ({ ...json, bundles: [{ id: 'B-1', skus: ['A-1'] }] }),
    ],
  ])('rejects a result with %s', async (_, change) => {
    const { json } = await sentAsJson();

    expect(() => parseRecommendationResult(change(json))).toThrow();
  });
});
