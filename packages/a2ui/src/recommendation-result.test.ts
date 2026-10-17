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
  return { result, json: JSON.parse(JSON.stringify(result)) as Record<string, unknown> };
}

type Json = Record<string, unknown>;

const withSpec = (json: Json, change: (spec: Json) => Json): Json => ({
  ...json,
  spec: change(json.spec as Json),
});

const withFirstProduct = (json: Json, change: (product: Json) => Json): Json => {
  const [first, ...rest] = json.products as Json[];
  return { ...json, products: [change(first as Json), ...rest] };
};

describe('parseRecommendationResult', () => {
  it('returns what the endpoint sent, unchanged by the trip through JSON', async () => {
    const { result, json } = await sentAsJson();

    expect(parseRecommendationResult(json)).toStrictEqual(result);
  });

  it('keeps the reason a degraded spec gives', async () => {
    const { json } = await sentAsJson();
    const degraded = withSpec(json, (spec) => ({ ...spec, degradedReason: 'timeout' }));

    expect(parseRecommendationResult(degraded).spec.degradedReason).toBe('timeout');
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
    ['has no blocks list', (spec: Json) => ({ ...spec, blocks: 'grid' })],
    [
      'has a block of a kind core never makes',
      (spec: Json) => ({
        ...spec,
        blocks: [{ kind: 'iframe', src: 'https://elsewhere.example' }],
      }),
    ],
    ['has no headline', (spec: Json) => ({ ...spec, headline: undefined })],
  ])('rejects a spec that %s', async (_, change) => {
    const { json } = await sentAsJson();

    expect(() => parseRecommendationResult(withSpec(json, change))).toThrow();
  });

  it.each([
    ['comes from another spec version', (spec: Json) => ({ ...spec, specVersion: '2' })],
    ['has no slot', (spec: Json) => ({ ...spec, slot: undefined })],
    ['names a source core never sets', (spec: Json) => ({ ...spec, source: 'agent' })],
    [
      'gives a degraded reason core never gives',
      (spec: Json) => ({
        ...spec,
        degradedReason: 'because',
      }),
    ],
    // JSON writes NaN as null.
    ['lost its latency on the way', (spec: Json) => ({ ...spec, latencyMs: null })],
    ['has a timestamp that is not a number', (spec: Json) => ({ ...spec, generatedAt: 'now' })],
    ['names its model with a number', (spec: Json) => ({ ...spec, model: 5 })],
  ])('rejects a spec that %s', async (_, change) => {
    const { json } = await sentAsJson();

    expect(() => parseRecommendationResult(withSpec(json, change))).toThrow(
      /not a version 1 ComponentSpec/,
    );
  });

  it.each([
    ['a protocol-relative image', { imageUrl: '//elsewhere.example/pixel.png' }],
    ['a data: image', { imageUrl: 'data:image/png;base64,AAAA' }],
    ['a negative price', { price: -1 }],
    ['a field the product schema does not have', { href: 'https://elsewhere.example' }],
  ])('rejects a product with %s', async (_, change) => {
    const { json } = await sentAsJson();

    expect(() =>
      parseRecommendationResult(withFirstProduct(json, (product) => ({ ...product, ...change }))),
    ).toThrow();
  });

  it('rejects a bundle that is not a bundle', async () => {
    const { json } = await sentAsJson();

    expect(() =>
      parseRecommendationResult({ ...json, bundles: [{ id: 'B-1', skus: ['A-1'] }] }),
    ).toThrow();
  });
});
