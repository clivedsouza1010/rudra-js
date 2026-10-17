import { describe, expect, it } from 'vitest';
import { Catalog } from '@a2ui/web_core/v0_9';
import { FIELD_LIMITS } from '@rudra-js/core';
import {
  RUDRA_RECOMMENDATIONS_COMPONENT,
  RUDRA_RECOMMENDATIONS_INSTRUCTIONS,
  rudraRecommendationsApi,
} from './recommendations-api.js';

const CATALOG_ID = 'https://shop.example/a2ui/catalog.json';

function agentCatalog() {
  return new Catalog(CATALOG_ID, 'v0.9', [rudraRecommendationsApi], [], {
    instructions: RUDRA_RECOMMENDATIONS_INSTRUCTIONS,
  }).toJson() as {
    instructions?: string;
    components: Record<string, { properties: Record<string, Record<string, unknown>> }>;
  };
}

describe('the catalog JSON an agent is prompted with', () => {
  it('offers the agent only the hints, with nowhere to put a title, a price or copy', () => {
    const component = agentCatalog().components[RUDRA_RECOMMENDATIONS_COMPONENT];

    expect(component).toMatchObject({ unevaluatedProperties: false });
    // The document leaves `id` to the common component envelope, so only `component` joins them.
    expect(Object.keys(component?.properties ?? {}).toSorted()).toStrictEqual([
      'component',
      'currentCategory',
      'currentSku',
      'maxItems',
      'searchQuery',
    ]);
  });

  it('tells the agent what each hint is for', () => {
    const { properties } = agentCatalog().components[RUDRA_RECOMMENDATIONS_COMPONENT] ?? {};

    for (const hint of ['currentSku', 'currentCategory', 'searchQuery', 'maxItems']) {
      expect(properties?.[hint]?.description, hint).toEqual(expect.any(String));
    }
  });

  it('lets a hint be bound to the data model', () => {
    const { properties } = agentCatalog().components[RUDRA_RECOMMENDATIONS_COMPONENT] ?? {};

    expect(properties?.currentSku?.oneOf).toContainEqual({
      $ref: expect.stringMatching(/#\/\$defs\/DataBinding$/),
    });
  });

  it('caps maxItems where a render context does', () => {
    const { properties } = agentCatalog().components[RUDRA_RECOMMENDATIONS_COMPONENT] ?? {};

    expect(properties?.maxItems).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: FIELD_LIMITS.maxItems,
    });
  });

  it('carries the instructions that tell the agent not to write facts around it', () => {
    const { instructions } = agentCatalog();

    expect(instructions).toBe(RUDRA_RECOMMENDATIONS_INSTRUCTIONS);
    expect(instructions).toContain(RUDRA_RECOMMENDATIONS_COMPONENT);
    expect(instructions).toMatch(/do not write product names, prices/i);
  });
});

describe('the server entry', () => {
  it('loads where there is no DOM, as on an agent backend or a shop endpoint', async () => {
    expect(typeof globalThis.HTMLElement).toBe('undefined');

    const server = await import('./server.js');

    expect(Object.keys(server).toSorted()).toStrictEqual([
      'RUDRA_RECOMMENDATIONS_COMPONENT',
      'RUDRA_RECOMMENDATIONS_INSTRUCTIONS',
      'parseRecommendationRequest',
      'rudraRecommendationsApi',
    ]);
  });
});
