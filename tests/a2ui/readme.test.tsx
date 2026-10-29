// @vitest-environment jsdom
/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { A2uiSurface } from '@a2ui/react/v0_9';
import { MessageProcessor, STRICT_VALIDATION, type A2uiMessage } from '@a2ui/web_core/v0_9';
import { basicCatalog } from '@a2ui/web_core/v0_9/basic_catalog';
import { agentCatalog } from './agent-catalog.js';
import { messagesFor } from './basic-catalog.js';
import { processor } from './browser.js';
import { POST } from './endpoint.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const trackingInputs = vi.hoisted((): unknown[] => []);
vi.mock('@rudra-js/core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@rudra-js/core')>();
  return {
    ...core,
    parseTrackingInput: (value: unknown) => {
      trackingInputs.push(value);
      return core.parseTrackingInput(value);
    },
  };
});

const REPO_ROOT = join(import.meta.dirname, '../..');
const SHOP_ORIGIN = 'https://shop.example';

const codeBlocksIn = (markdown: string): string[] =>
  [...markdown.matchAll(/^```tsx?\n([\s\S]*?)^```$/gm)].map((match) => (match[1] ?? '').trim());

const post = (body: string) =>
  POST(
    new Request(`${SHOP_ORIGIN}/api/recommendations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the examples in the @rudra-js/a2ui README', () => {
  it('are the code this test runs', () => {
    const readme = readFileSync(join(REPO_ROOT, 'packages/a2ui/README.md'), 'utf8');
    const run = ['agent-catalog.ts', 'endpoint.ts', 'browser.tsx', 'basic-catalog.ts'].map((file) =>
      readFileSync(join(import.meta.dirname, file), 'utf8').trim(),
    );

    expect(codeBlocksIn(readme), 'the README shows code the test does not run').toStrictEqual(run);
  });
});

describe('the README install command', () => {
  it.each(['@a2ui/react', '@a2ui/web_core'])(
    'asks for the %s release the package peers on',
    (name) => {
      const readme = readFileSync(join(REPO_ROOT, 'packages/a2ui/README.md'), 'utf8');
      const manifest: { peerDependencies: Record<string, string> } = JSON.parse(
        readFileSync(join(REPO_ROOT, 'packages/a2ui/package.json'), 'utf8'),
      );
      const release = readme.match(new RegExp(`^npm install .*${name}@(\\S+)`, 'm'))?.[1];

      expect(`^${release}.0`).toBe(manifest.peerDependencies[name]);
    },
  );
});

describe('the README endpoint', () => {
  it('keeps a SKU the shop sells, drops a category it does not, and sets the rest itself', async () => {
    const response = await post(
      JSON.stringify({ currentSku: 'A-1', currentCategory: 'Not one of ours' }),
    );

    expect(response.status).toBe(200);
    expect(trackingInputs.at(-1)).toMatchObject({
      user: { id: 'shopper-1' },
      context: { surface: 'assistant', locale: 'en-US', currentSku: 'A-1' },
    });
    expect(trackingInputs.at(-1)).not.toHaveProperty('context.currentCategory');
  });

  it.each([
    ['a body that names the shopper', JSON.stringify({ user: { id: 'someone-else' } })],
    ['a body that brings its own products', JSON.stringify({ candidates: [] })],
    ['a body that is not JSON', 'currentSku=A-1'],
  ])('turns away %s', async (_, body) => {
    expect((await post(body)).status).toBe(400);
  });
});

describe('the README agent catalog', () => {
  it('offers the agent the component, with its instructions', () => {
    expect(agentCatalog.toJson()).toMatchObject({
      components: { RudraRecommendations: expect.any(Object) },
      instructions: expect.stringContaining('RudraRecommendations'),
    });
  });
});

describe('the README, end to end', () => {
  it('renders what the agent placed, with the products and prices the endpoint chose', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('fetch', (url: string, init: RequestInit) =>
      POST(new Request(new URL(url, SHOP_ORIGIN), init)),
    );

    const messages: A2uiMessage[] = [
      { version: 'v0.9', createSurface: { surfaceId: 'chat', catalogId: agentCatalog.id } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'chat',
          components: [
            { id: 'root', component: 'Column', children: ['picks'] },
            { id: 'picks', component: 'RudraRecommendations', currentSku: 'A-1' },
          ],
        },
      },
    ];
    processor.processMessages(messages);
    const surface = processor.model.surfacesMap.get('chat');
    if (!surface) throw new Error('the agent messages created no surface');

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<A2uiSurface surface={surface} />));
    await act(() => vi.runAllTimersAsync());

    const block = container.querySelector('section.rudra');
    expect(block?.textContent).toContain('Goes with your cart');
    expect(block?.textContent).toContain('Chef knife');
    expect(block?.textContent).toContain('$55.00');

    act(() => root.unmount());
    container.remove();
  });
});

describe('the README messages for other renderers', () => {
  it('carry the block the endpoint built, on the basic catalog, with links into the shop', async () => {
    const response = await post(JSON.stringify({ currentSku: 'A-1' }));
    const messages = messagesFor(await response.json(), 'en-US');
    const basicProcessor = new MessageProcessor([basicCatalog], undefined, {
      validationConfig: STRICT_VALIDATION,
    });

    expect(() => basicProcessor.processMessages(messages)).not.toThrow();
    const sent = JSON.stringify(messages);
    for (const expected of [
      'Goes with your cart',
      'Chef knife',
      '$55.00',
      'https://shop.example/product/A-3',
    ]) {
      expect(sent).toContain(expected);
    }
  });
});
