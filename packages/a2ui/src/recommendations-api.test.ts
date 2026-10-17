import { describe, expect, it } from 'vitest';
import { Catalog, MessageProcessor, type A2uiMessage } from '@a2ui/web_core/v0_9';
import { FIELD_LIMITS } from '@rudra-js/core';
import {
  RUDRA_RECOMMENDATIONS_INSTRUCTIONS,
  rudraRecommendationsApi,
} from './recommendations-api.js';

const CATALOG_ID = 'https://shop.example/a2ui/catalog.json';
const HINTS = ['currentCategory', 'currentSku', 'maxItems', 'searchQuery'];

type CatalogJson = {
  instructions?: string;
  components: { RudraRecommendations: { properties: Record<string, Record<string, unknown>> } };
};

const catalogJson = new Catalog(CATALOG_ID, 'v0.9', [rudraRecommendationsApi], [], {
  instructions: RUDRA_RECOMMENDATIONS_INSTRUCTIONS,
}).toJson() as CatalogJson;

const component = catalogJson.components.RudraRecommendations;

describe('the catalog JSON an agent is prompted with', () => {
  it('offers the agent only the hints, with nowhere to put a title, a price or copy', () => {
    expect(component).toMatchObject({ unevaluatedProperties: false });
    expect(Object.keys(component.properties).toSorted()).toStrictEqual(['component', ...HINTS]);
  });

  it('tells the agent what each hint is for', () => {
    for (const hint of HINTS) {
      expect(component.properties[hint]?.description, hint).toEqual(expect.any(String));
    }
  });

  it('lets every hint be bound to the data model', () => {
    for (const hint of HINTS) {
      expect(component.properties[hint]?.oneOf, hint).toContainEqual({
        $ref: expect.stringMatching(/#\/\$defs\/DataBinding$/),
      });
    }
  });

  it('requires no hint, so the agent can place the block with any of them', () => {
    expect(component).toMatchObject({ required: ['component'] });
  });

  it('tells the agent the range maxItems takes', () => {
    expect(component.properties.maxItems?.description).toContain(
      `from 1 to ${FIELD_LIMITS.maxItems}`,
    );
  });

  it('carries the instructions that tell the agent not to write facts around it', () => {
    expect(catalogJson.instructions).toMatch(/do not write product names, prices/i);
  });
});

describe('the server entry', () => {
  it('loads where there is no DOM, as on an agent backend or a shop endpoint', async () => {
    expect(typeof globalThis.HTMLElement).toBe('undefined');

    const server = await import('./server.js');

    expect(Object.keys(server).toSorted()).toStrictEqual([
      'RUDRA_RECOMMENDATIONS_INSTRUCTIONS',
      'fitRecommendationRequest',
      'parseRecommendationRequest',
      'rudraRecommendationsApi',
    ]);
  });
});

describe('what A2UI does with a hint before the component sees it', () => {
  const placing = (properties: Record<string, unknown>): A2uiMessage[] => [
    { version: 'v0.9', createSurface: { surfaceId: 'chat', catalogId: CATALOG_ID } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'chat',
        components: [{ id: 'root', component: 'RudraRecommendations', ...properties }],
      },
    },
  ];
  const processorFor = () =>
    new MessageProcessor([new Catalog(CATALOG_ID, 'v0.9', [rudraRecommendationsApi])]);

  it.each([
    ['a maxItems out of range', { maxItems: 40 }],
    ['an empty SKU', { currentSku: '' }],
    ['an over-long search', { searchQuery: 'x'.repeat(FIELD_LIMITS.searchQuery + 1) }],
  ])('accepts %s, for the component to leave out', (_, properties) => {
    expect(() => processorFor().processMessages(placing(properties))).not.toThrow();
  });

  it.each([
    ['a SKU written as a number', { currentSku: 12345 }],
    ['a maxItems written as text', { maxItems: '4' }],
  ])('refuses the whole message for %s', (_, properties) => {
    expect(() => processorFor().processMessages(placing(properties))).toThrow(
      /Validation failed for component 'RudraRecommendations'/,
    );
  });
});
