// @vitest-environment jsdom
/// <reference lib="dom" />
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { A2uiSurface, type ReactCatalogComponent } from '@a2ui/react/v0_9';
import { Catalog, MessageProcessor, type A2uiMessage } from '@a2ui/web_core/v0_9';
import { basicCatalog } from '@a2ui/web_core/v0_9/basic_catalog';
import { createComponentGenerator, parseTrackingInput } from '@rudra-js/core';
import {
  createRudraRecommendationsComponent,
  type RecommendationLoader,
  type RudraRecommendationsOptions,
} from './recommendations-component.js';
import type { RecommendationRequest } from './recommendation-request.js';
import type { RecommendationResult } from './recommendation-result.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CATALOG_ID = 'https://shop.example/a2ui/catalog.json';
const SURFACE_ID = 'chat';
const AGENT_TEXT = 'Here are a few things that go with it';

const SHOP_CATALOG = [
  { sku: 'A-1', title: 'Cast iron skillet', category: 'Cookware', price: 39, currency: 'USD' },
  { sku: 'A-2', title: 'Enamel dutch oven', category: 'Cookware', price: 89, currency: 'USD' },
  { sku: 'A-3', title: 'Chef knife', category: 'Knives', price: 55, currency: 'USD' },
];

const BUNDLES = [{ id: 'B-1', skus: ['A-2', 'A-3'], price: 120, label: 'Dinner party set' }];

async function shopResultFor(request: RecommendationRequest): Promise<RecommendationResult> {
  const input = parseTrackingInput({
    user: { id: 'shopper-1' },
    context: { surface: 'assistant', ...request },
    candidates: SHOP_CATALOG,
    bundles: BUNDLES,
  });
  const spec = await createComponentGenerator({ provider: null }).generate(input);
  return JSON.parse(JSON.stringify({ spec, products: input.candidates, bundles: input.bundles }));
}

const recommendationsComponent = (properties: Record<string, unknown>) => ({
  id: 'recommendations',
  component: 'RudraRecommendations',
  ...properties,
});

function agentMessages(
  recommendationProperties: Record<string, unknown>,
  dataModel?: Record<string, unknown>,
): A2uiMessage[] {
  const messages: A2uiMessage[] = [
    { version: 'v0.9', createSurface: { surfaceId: SURFACE_ID, catalogId: CATALOG_ID } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: SURFACE_ID,
        components: [
          { id: 'root', component: 'Column', children: ['intro', 'recommendations'] },
          { id: 'intro', component: 'Text', text: AGENT_TEXT },
          recommendationsComponent(recommendationProperties),
        ],
      },
    },
  ];
  if (dataModel) messages.push(dataModelUpdate('/', dataModel));
  return messages;
}

function dataModelUpdate(path: string, value: unknown): A2uiMessage {
  return { version: 'v0.9', updateDataModel: { surfaceId: SURFACE_ID, path, value } };
}

function componentUpdate(properties: Record<string, unknown>): A2uiMessage {
  return {
    version: 'v0.9',
    updateComponents: { surfaceId: SURFACE_ID, components: [recommendationsComponent(properties)] },
  };
}

let mounted: { root: Root; container: HTMLElement } | null = null;

function unmount() {
  if (!mounted) return;
  const { root, container } = mounted;
  act(() => root.unmount());
  container.remove();
  mounted = null;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  unmount();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function renderSurface(messages: A2uiMessage[], options: RudraRecommendationsOptions) {
  const catalog = new Catalog<ReactCatalogComponent>(
    CATALOG_ID,
    'v0.9',
    [...basicCatalog.components.values(), createRudraRecommendationsComponent(options)],
    [...basicCatalog.functions.values()],
  );
  const processor = new MessageProcessor<ReactCatalogComponent>([catalog]);
  processor.processMessages(messages);

  const surface = processor.model.surfacesMap.get(SURFACE_ID);
  if (!surface) throw new Error('the agent messages created no surface');

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () =>
    root.render(
      <StrictMode>
        <A2uiSurface surface={surface} />
      </StrictMode>,
    ),
  );

  const send = (message: A2uiMessage) => act(async () => processor.processMessages([message]));
  return { container, send };
}

const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const flush = () => wait(0);
const settle = async () => {
  await wait(300);
  await flush();
};

function heldLoader() {
  const resolvers = new Map<string, (result: RecommendationResult) => void>();
  const loadRecommendations = vi.fn<RecommendationLoader>(
    (request) =>
      new Promise((resolve) => {
        resolvers.set(request.currentSku ?? '', resolve);
      }),
  );
  const finish = async (sku: string) => {
    const resolve = resolvers.get(sku);
    if (!resolve) throw new Error(`no load was asked for ${sku}`);
    resolve(await shopResultFor({ currentSku: sku }));
    await flush();
  };
  return { loadRecommendations, finish };
}

const blockIn = (container: HTMLElement) => container.querySelector('section.rudra');

const requestsSent = (loader: Mock<RecommendationLoader>) =>
  loader.mock.calls.map(([request]) => request);

describe('the RudraRecommendations component in an A2UI surface', () => {
  it('never sends or shows what the agent wrote beyond the hints', async () => {
    const loadRecommendations = vi.fn<RecommendationLoader>(shopResultFor);

    const { container } = await renderSurface(
      agentMessages({
        currentSku: 'A-1',
        headline: 'Only $1 today',
        price: 1,
        products: [{ sku: 'A-2', title: 'Free dutch oven', price: 0 }],
      }),
      { loadRecommendations, locale: 'en-US' },
    );
    await settle();

    expect(requestsSent(loadRecommendations)).toStrictEqual([{ currentSku: 'A-1' }]);
    const block = blockIn(container);
    expect(block?.textContent).toContain('Enamel dutch oven');
    expect(block?.textContent).toContain('$89.00');
    expect(container.textContent).not.toContain('Only $1 today');
    expect(container.textContent).not.toContain('Free dutch oven');
  });

  it('loads without a SKU, from a search alone', async () => {
    const loadRecommendations = vi.fn<RecommendationLoader>(shopResultFor);

    const { container } = await renderSurface(
      agentMessages({ searchQuery: 'something to sear steak in', maxItems: 2 }),
      { loadRecommendations },
    );
    await settle();

    expect(requestsSent(loadRecommendations)).toStrictEqual([
      { searchQuery: 'something to sear steak in', maxItems: 2 },
    ]);
    expect(blockIn(container)).not.toBeNull();
  });

  it('reads every hint bound to the data model', async () => {
    const loadRecommendations = vi.fn<RecommendationLoader>(shopResultFor);

    await renderSurface(
      agentMessages(
        {
          currentSku: { path: '/viewing/sku' },
          currentCategory: { path: '/viewing/category' },
          searchQuery: { path: '/asked' },
          maxItems: { path: '/count' },
        },
        { viewing: { sku: 'A-1', category: 'Cookware' }, asked: 'a lid for it', count: 3 },
      ),
      { loadRecommendations },
    );
    await settle();

    expect(requestsSent(loadRecommendations)).toStrictEqual([
      { currentSku: 'A-1', currentCategory: 'Cookware', searchQuery: 'a lid for it', maxItems: 3 },
    ]);
  });

  it('asks without a maxItems the shop would refuse, and keeps the agent message', async () => {
    const loadRecommendations = vi.fn<RecommendationLoader>(shopResultFor);

    const { container } = await renderSurface(agentMessages({ currentSku: 'A-1', maxItems: 40 }), {
      loadRecommendations,
    });
    await settle();

    expect(requestsSent(loadRecommendations)).toStrictEqual([{ currentSku: 'A-1' }]);
    expect(blockIn(container)).not.toBeNull();
    expect(container.textContent).toContain(AGENT_TEXT);
  });

  it('puts a data model that arrives in the next agent message into the first request', async () => {
    const loadRecommendations = vi.fn<RecommendationLoader>(shopResultFor);

    const { container, send } = await renderSurface(
      agentMessages({ currentSku: { path: '/viewing/sku' } }),
      { loadRecommendations },
    );
    await send(dataModelUpdate('/viewing', { sku: 'A-1' }));
    await settle();

    expect(requestsSent(loadRecommendations)).toStrictEqual([{ currentSku: 'A-1' }]);
    expect(blockIn(container)).not.toBeNull();
  });

  it('waits for the hints to hold still for 300 ms before asking', async () => {
    const loadRecommendations = vi.fn<RecommendationLoader>(shopResultFor);

    const { send } = await renderSurface(
      agentMessages({ currentSku: { path: '/viewing/sku' } }, { viewing: { sku: 'A-1' } }),
      { loadRecommendations },
    );
    await wait(200);
    await send(dataModelUpdate('/viewing/sku', 'A-3'));
    await wait(299);
    expect(loadRecommendations).not.toHaveBeenCalled();
    await wait(1);

    expect(requestsSent(loadRecommendations)).toStrictEqual([{ currentSku: 'A-3' }]);
  });

  it('keeps the last block up until the next one arrives', async () => {
    const { loadRecommendations, finish } = heldLoader();

    const { container, send } = await renderSurface(
      agentMessages({ currentSku: { path: '/viewing/sku' } }, { viewing: { sku: 'A-1' } }),
      { loadRecommendations, placeholder: <p className="loading">Loading</p> },
    );
    await settle();
    await finish('A-1');

    await send(dataModelUpdate('/viewing/sku', 'A-2'));
    await send(dataModelUpdate('/viewing/sku', 'A-3'));
    await flush();

    expect(container.querySelector('.loading')).toBeNull();
    expect(blockIn(container)?.textContent).toContain('Chef knife');

    await settle();

    expect(requestsSent(loadRecommendations)).toStrictEqual([
      { currentSku: 'A-1' },
      { currentSku: 'A-3' },
    ]);
    expect(blockIn(container)?.textContent).toContain('Chef knife');

    await finish('A-3');

    expect(blockIn(container)?.textContent).toContain('Cast iron skillet');
    expect(blockIn(container)?.textContent).not.toContain('Chef knife');
  });

  it('does not ask again when the hints come back to the ones on screen', async () => {
    const loadRecommendations = vi.fn<RecommendationLoader>(shopResultFor);

    const { send } = await renderSurface(
      agentMessages({ currentSku: { path: '/viewing/sku' } }, { viewing: { sku: 'A-1' } }),
      { loadRecommendations },
    );
    await settle();
    await send(dataModelUpdate('/viewing/sku', 'A-2'));
    await send(dataModelUpdate('/viewing/sku', 'A-1'));
    await settle();

    expect(loadRecommendations).toHaveBeenCalledTimes(1);
  });

  it('asks again for a data model that comes after the hints settled', async () => {
    const loadRecommendations = vi.fn<RecommendationLoader>(shopResultFor);

    const { send } = await renderSurface(agentMessages({ currentSku: { path: '/viewing/sku' } }), {
      loadRecommendations,
    });
    await settle();
    await send(dataModelUpdate('/viewing', { sku: 'A-1' }));
    await settle();

    expect(requestsSent(loadRecommendations)).toStrictEqual([{}, { currentSku: 'A-1' }]);
  });

  it('stops sending a bound hint once the data model clears it', async () => {
    const loadRecommendations = vi.fn<RecommendationLoader>(shopResultFor);

    const { container, send } = await renderSurface(
      agentMessages(
        { currentSku: { path: '/viewing/sku' }, currentCategory: { path: '/viewing/category' } },
        { viewing: { sku: 'A-1', category: 'Cookware' } },
      ),
      { loadRecommendations },
    );
    await settle();
    await send(dataModelUpdate('/viewing', { sku: 'A-3' }));
    await settle();

    expect(requestsSent(loadRecommendations)).toStrictEqual([
      { currentSku: 'A-1', currentCategory: 'Cookware' },
      { currentSku: 'A-3' },
    ]);
    expect(blockIn(container)?.textContent).not.toContain('Chef knife');
  });

  it('stops sending a hint the agent no longer writes', async () => {
    const loadRecommendations = vi.fn<RecommendationLoader>(shopResultFor);

    const { send } = await renderSurface(
      agentMessages({ currentSku: 'A-1', searchQuery: 'pans' }),
      { loadRecommendations },
    );
    await settle();
    await send(componentUpdate({ currentSku: 'A-1' }));
    await settle();

    expect(requestsSent(loadRecommendations)).toStrictEqual([
      { currentSku: 'A-1', searchQuery: 'pans' },
      { currentSku: 'A-1' },
    ]);
  });

  it('shows nothing when a reload fails, and asks again when the hints change back', async () => {
    const failure = new Error('recommendations: 503');
    const onError = vi.fn();
    const loadRecommendations: RecommendationLoader = (request) =>
      request.currentSku === 'A-3' ? Promise.reject(failure) : shopResultFor(request);

    const { container, send } = await renderSurface(
      agentMessages({ currentSku: { path: '/viewing/sku' } }, { viewing: { sku: 'A-1' } }),
      { loadRecommendations, onError },
    );
    await settle();
    expect(blockIn(container)).not.toBeNull();

    await send(dataModelUpdate('/viewing/sku', 'A-3'));
    await settle();

    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(blockIn(container)).toBeNull();

    await send(dataModelUpdate('/viewing/sku', 'A-1'));
    await settle();
    expect(blockIn(container)).not.toBeNull();
  });

  it('drops a result that arrives after the hints changed', async () => {
    const { loadRecommendations, finish } = heldLoader();
    const onError = vi.fn();

    const { container, send } = await renderSurface(
      agentMessages({ currentSku: { path: '/viewing/sku' } }, { viewing: { sku: 'A-1' } }),
      { loadRecommendations, onError },
    );
    await settle();
    await send(dataModelUpdate('/viewing/sku', 'A-3'));
    await settle();
    expect(loadRecommendations.mock.calls[0]?.[1].aborted).toBe(true);

    await finish('A-3');
    await finish('A-1');

    expect(blockIn(container)?.textContent).toContain('Cast iron skillet');
    expect(blockIn(container)?.textContent).not.toContain('Chef knife');
    expect(onError).not.toHaveBeenCalled();
  });

  it('shows the placeholder until the first recommendations arrive', async () => {
    const { loadRecommendations, finish } = heldLoader();

    const { container } = await renderSurface(agentMessages({ currentSku: 'A-1' }), {
      loadRecommendations,
      placeholder: <p className="loading">Finding something that goes with it</p>,
    });
    await settle();

    expect(container.querySelector('.loading')).not.toBeNull();
    expect(blockIn(container)).toBeNull();

    await finish('A-1');

    expect(container.querySelector('.loading')).toBeNull();
    expect(blockIn(container)).not.toBeNull();
  });

  it('passes the RudraComponent props it was given to the block', async () => {
    const { container } = await renderSurface(agentMessages({ currentSku: 'A-1' }), {
      loadRecommendations: shopResultFor,
      formatPrice: (product) => `${product.price} dollars`,
      hrefForSku: (sku) => `/p/${sku}`,
      className: 'assistant-picks',
    });
    await settle();

    expect(container.querySelector('section.rudra.assistant-picks')).not.toBeNull();
    expect(container.querySelector('a[href="/p/A-2"]')).not.toBeNull();
    expect(container.textContent).toContain('89 dollars');
  });

  it('renders a bundle from the bundles the result carries', async () => {
    const loadRecommendations: RecommendationLoader = async (request) => {
      const result = await shopResultFor(request);
      const bundleBlock = {
        kind: 'bundle' as const,
        title: 'Cook for friends',
        body: null,
        ctaLabel: null,
        bundleId: 'B-1',
      };
      return { ...result, spec: { ...result.spec, blocks: [bundleBlock] } };
    };

    const { container } = await renderSurface(agentMessages({ currentSku: 'A-1' }), {
      loadRecommendations,
      locale: 'en-US',
    });
    await settle();

    expect(blockIn(container)?.textContent).toContain('Dinner party set');
    expect(blockIn(container)?.textContent).toContain('$120.00');
  });

  it('shows nothing when the load fails, and says why', async () => {
    const failure = new Error('recommendations: 503');
    const onError = vi.fn();

    const { container } = await renderSurface(agentMessages({ currentSku: 'A-1' }), {
      loadRecommendations: () => Promise.reject(failure),
      placeholder: <p className="loading">Loading</p>,
      onError,
    });
    await settle();

    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(container.querySelector('.loading')).toBeNull();
    expect(blockIn(container)).toBeNull();
    expect(container.textContent).toContain(AGENT_TEXT);
  });

  it('shows nothing from a result that fails its checks', async () => {
    const onError = vi.fn();
    const loadRecommendations: RecommendationLoader = async (request) => {
      const result = await shopResultFor(request);
      const products = result.products.map((product) => ({
        ...product,
        imageUrl: '//elsewhere.example/pixel.png',
      }));
      return { ...result, products };
    };

    const { container } = await renderSurface(agentMessages({ currentSku: 'A-1' }), {
      loadRecommendations,
      onError,
    });
    await settle();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(blockIn(container)).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows the next block after one that threw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onError = vi.fn();

    const { container, send } = await renderSurface(
      agentMessages({ currentSku: { path: '/viewing/sku' } }, { viewing: { sku: 'A-2' } }),
      {
        loadRecommendations: shopResultFor,
        hrefForSku: (sku) => {
          if (sku === 'A-3') throw new URIError('URI malformed');
          return `/product/${sku}`;
        },
        onError,
      },
    );
    await settle();
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.any(URIError));
    expect(blockIn(container)).toBeNull();
    expect(container.textContent).toContain(AGENT_TEXT);

    await send(dataModelUpdate('/viewing/sku', 'A-3'));
    await settle();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(blockIn(container)?.textContent).toContain('Cast iron skillet');
  });

  it('cancels a load when the component leaves the page, and reports nothing for it', async () => {
    const onError = vi.fn();
    const loadRecommendations = vi.fn<RecommendationLoader>(
      (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    );

    await renderSurface(agentMessages({ currentSku: 'A-1' }), { loadRecommendations, onError });
    await settle();
    unmount();
    await flush();

    expect(loadRecommendations.mock.calls[0]?.[1].aborted).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });
});
