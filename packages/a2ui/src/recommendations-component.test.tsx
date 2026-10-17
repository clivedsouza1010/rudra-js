// @vitest-environment jsdom
/// <reference lib="dom" />
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { A2uiSurface, type ReactCatalogComponent } from '@a2ui/react/v0_9';
import { Catalog, MessageProcessor, type A2uiMessage } from '@a2ui/web_core/v0_9';
import { basicCatalog } from '@a2ui/web_core/v0_9/basic_catalog';
import { createComponentGenerator, parseTrackingInput } from '@rudra-js/core';
import { RUDRA_RECOMMENDATIONS_COMPONENT } from './recommendations-api.js';
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

const SHOP_CATALOG = [
  { sku: 'A-1', title: 'Cast iron skillet', category: 'Cookware', price: 39, currency: 'USD' },
  { sku: 'A-2', title: 'Enamel dutch oven', category: 'Cookware', price: 89, currency: 'USD' },
  { sku: 'A-3', title: 'Chef knife', category: 'Knives', price: 55, currency: 'USD' },
];

/** What a shop endpoint does with a request, sent back through JSON as it would be over HTTP. */
async function shopResultFor(request: RecommendationRequest): Promise<RecommendationResult> {
  const input = parseTrackingInput({
    user: { id: 'shopper-1' },
    context: { surface: 'assistant', ...request },
    candidates: SHOP_CATALOG,
  });
  const spec = await createComponentGenerator({ provider: null }).generate(input);
  return JSON.parse(JSON.stringify({ spec, products: input.candidates, bundles: input.bundles }));
}

function agentMessages(
  recommendationProperties: Record<string, unknown>,
  dataModel: Record<string, unknown> = {},
): A2uiMessage[] {
  return [
    { version: 'v0.9', createSurface: { surfaceId: SURFACE_ID, catalogId: CATALOG_ID } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: SURFACE_ID,
        components: [
          { id: 'root', component: 'Column', children: ['recommendations'] },
          {
            id: 'recommendations',
            component: RUDRA_RECOMMENDATIONS_COMPONENT,
            ...recommendationProperties,
          },
        ],
      },
    },
    { version: 'v0.9', updateDataModel: { surfaceId: SURFACE_ID, path: '/', value: dataModel } },
  ];
}

let mounted: { root: Root; container: HTMLElement } | null = null;

afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
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
  await act(async () => root.render(<A2uiSurface surface={surface} />));

  return { container, processor };
}

/**
 * Lets pending loads settle and React commit what they set. A2UI renders a surface over a few
 * turns, and each load resolves on a later one, so this yields a few times rather than once.
 */
async function settle(turns = 5): Promise<void> {
  if (turns === 0) return;
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  return settle(turns - 1);
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe('the RudraRecommendations component in an A2UI surface', () => {
  it('renders recommendations whose titles and prices come from the shop', async () => {
    const loadRecommendations = vi.fn<RecommendationLoader>(shopResultFor);

    const { container } = await renderSurface(agentMessages({ currentSku: 'A-1' }), {
      loadRecommendations,
      locale: 'en-US',
    });
    await settle();

    const block = container.querySelector('section.rudra');
    expect(block).not.toBeNull();
    expect(block?.textContent).toContain('Enamel dutch oven');
    expect(block?.textContent).toContain('$89.00');
    expect(block?.textContent).not.toContain('Cast iron skillet');
  });

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

    expect(loadRecommendations).toHaveBeenCalledTimes(1);
    expect(loadRecommendations.mock.calls[0]?.[0]).toStrictEqual({ currentSku: 'A-1' });
    expect(container.textContent).toContain('$89.00');
    expect(container.textContent).not.toContain('Only $1 today');
    expect(container.textContent).not.toContain('Free dutch oven');
  });

  it('reads a hint bound to the data model, and asks again when the model changes', async () => {
    const loadRecommendations = vi.fn<RecommendationLoader>(shopResultFor);

    const { container, processor } = await renderSurface(
      agentMessages({ currentSku: { path: '/viewing/sku' } }, { viewing: { sku: 'A-1' } }),
      { loadRecommendations, locale: 'en-US' },
    );
    await settle();

    const [firstRequest, firstSignal] = loadRecommendations.mock.lastCall ?? [];
    expect(firstRequest).toStrictEqual({ currentSku: 'A-1' });
    expect(container.textContent).not.toContain('Cast iron skillet');

    await act(async () =>
      processor.processMessages([
        {
          version: 'v0.9',
          updateDataModel: { surfaceId: SURFACE_ID, path: '/viewing/sku', value: 'A-3' },
        },
      ]),
    );
    await settle();

    expect(loadRecommendations.mock.lastCall?.[0]).toStrictEqual({ currentSku: 'A-3' });
    expect(firstSignal?.aborted).toBe(true);
    expect(container.textContent).toContain('Cast iron skillet');
    expect(container.textContent).not.toContain('Chef knife');
  });

  it('shows the placeholder while recommendations load, and then the block', async () => {
    const pending = deferred<RecommendationResult>();

    const { container } = await renderSurface(agentMessages({ currentSku: 'A-1' }), {
      loadRecommendations: () => pending.promise,
      placeholder: <p className="loading">Finding something that goes with it</p>,
      locale: 'en-US',
    });
    await settle();

    expect(container.querySelector('.loading')).not.toBeNull();
    expect(container.querySelector('section.rudra')).toBeNull();

    pending.resolve(await shopResultFor({ currentSku: 'A-1' }));
    await settle();

    expect(container.querySelector('.loading')).toBeNull();
    expect(container.querySelector('section.rudra')).not.toBeNull();
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
    expect(container.querySelector('section.rudra')).toBeNull();
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
    expect(container.querySelector('section.rudra')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('cancels a load when the component leaves the page, and reports nothing for it', async () => {
    const pending = deferred<RecommendationResult>();
    const signals: AbortSignal[] = [];
    const onError = vi.fn();

    await renderSurface(agentMessages({ currentSku: 'A-1' }), {
      loadRecommendations: (_, signal) => {
        signals.push(signal);
        return pending.promise;
      },
      onError,
    });
    await settle();

    const { root, container } = mounted ?? {};
    act(() => root?.unmount());
    container?.remove();
    mounted = null;

    expect(signals.at(-1)?.aborted).toBe(true);
    pending.reject(new DOMException('The operation was aborted.', 'AbortError'));
    await settle();
    expect(onError).not.toHaveBeenCalled();
  });
});
