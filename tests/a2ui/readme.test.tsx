// @vitest-environment jsdom
/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { A2uiSurface } from '@a2ui/react/v0_9';
import type { A2uiMessage } from '@a2ui/web_core/v0_9';
import { RUDRA_RECOMMENDATIONS_COMPONENT } from '@rudra-js/a2ui';
import { agentCatalog } from './agent-catalog.js';
import { processor } from './browser.js';
import { POST } from './endpoint.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom replaces URL with its own, which fileURLToPath refuses, so this passes it a string.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SHOP_ORIGIN = 'https://shop.example';

const between = (text: string, start: string, end: string): string => {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  expect(from, `${start} is missing`).toBeGreaterThan(-1);
  expect(to, `${end} is missing`).toBeGreaterThan(from);
  return text.slice(from + start.length, to).trim();
};

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

/** Lets the surface render and the component's load resolve, over a few turns. */
async function settle(turns = 10): Promise<void> {
  if (turns === 0) return;
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  return settle(turns - 1);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the examples in the @rudra-js/a2ui README', () => {
  it.each([
    ['agent-catalog.ts', 'agent catalog'],
    ['endpoint.ts', 'endpoint'],
    ['browser.tsx', 'browser'],
  ])('shows %s exactly as it runs', (file, marker) => {
    const readme = readFileSync(join(REPO_ROOT, 'packages/a2ui/README.md'), 'utf8');
    const source = readFileSync(join(REPO_ROOT, 'tests/a2ui', file), 'utf8');

    const run = between(source, `// --- ${marker} ---`, `// --- end ${marker} ---`);

    expect(codeBlocksIn(readme), 'the README shows code the test does not run').toContain(run);
  });
});

describe('the README endpoint', () => {
  it('answers a request with a result the component accepts', async () => {
    const response = await post(JSON.stringify({ currentSku: 'A-1' }));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.spec.headline).toBe('Goes with your cart');
    expect(result.products.map((product: { sku: string }) => product.sku)).toStrictEqual([
      'A-1',
      'A-2',
      'A-3',
    ]);
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
    const schema = agentCatalog.toJson() as {
      instructions?: string;
      components: Record<string, unknown>;
    };

    expect(schema.components[RUDRA_RECOMMENDATIONS_COMPONENT]).toBeDefined();
    expect(schema.instructions).toContain(RUDRA_RECOMMENDATIONS_COMPONENT);
  });
});

describe('the README, end to end', () => {
  it('renders what the agent placed, with the products and prices the endpoint chose', async () => {
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
            { id: 'picks', component: RUDRA_RECOMMENDATIONS_COMPONENT, currentSku: 'A-1' },
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
    await settle();

    const block = container.querySelector('section.rudra');
    expect(block?.textContent).toContain('Goes with your cart');
    expect(block?.textContent).toContain('Chef knife');
    expect(block?.textContent).toContain('$55.00');

    act(() => root.unmount());
    container.remove();
  });
});
