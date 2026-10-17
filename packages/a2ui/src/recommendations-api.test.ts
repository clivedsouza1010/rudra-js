import { describe, expect, it } from 'vitest';
import { Catalog, MessageProcessor, type A2uiMessage } from '@a2ui/web_core/v0_9';
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
    components: Record<
      string,
      { properties: Record<string, Record<string, unknown>>; required?: string[] }
    >;
  };
}

describe('the component name', () => {
  it('is the one agents and catalogs already use', () => {
    expect(RUDRA_RECOMMENDATIONS_COMPONENT).toBe('RudraRecommendations');
    expect(rudraRecommendationsApi.name).toBe(RUDRA_RECOMMENDATIONS_COMPONENT);
  });
});

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

  it('lets every hint be bound to the data model', () => {
    const { properties } = agentCatalog().components[RUDRA_RECOMMENDATIONS_COMPONENT] ?? {};

    for (const hint of ['currentSku', 'currentCategory', 'searchQuery', 'maxItems']) {
      expect(properties?.[hint]?.oneOf, hint).toContainEqual({
        $ref: expect.stringMatching(/#\/\$defs\/DataBinding$/),
      });
    }
  });

  it('requires no hint, so the agent can place the block with any of them', () => {
    const component = agentCatalog().components[RUDRA_RECOMMENDATIONS_COMPONENT];

    expect(component).toMatchObject({ required: ['component'] });
  });

  it('tells the agent the range maxItems takes', () => {
    const { properties } = agentCatalog().components[RUDRA_RECOMMENDATIONS_COMPONENT] ?? {};

    expect(properties?.maxItems?.description).toContain(`from 1 to ${FIELD_LIMITS.maxItems}`);
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
        components: [{ id: 'root', component: RUDRA_RECOMMENDATIONS_COMPONENT, ...properties }],
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
