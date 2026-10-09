import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

// --- quickstart ---
import { createComponentGenerator, parseTrackingInput } from '@rudra-js/core';
import { RudraComponent } from '@rudra-js/react';

const catalog = [
  { sku: 'A-1', title: 'Cast iron skillet', category: 'Cookware', price: 39, currency: 'USD' },
  { sku: 'A-2', title: 'Enamel dutch oven', category: 'Cookware', price: 89, currency: 'USD' },
  { sku: 'A-3', title: 'Chef knife', category: 'Knives', price: 55, currency: 'USD' },
];

async function recommendations() {
  // Passing no provider means no API key and no spend.
  // You get a reliable, deterministic component.
  const generator = createComponentGenerator({ provider: null });

  // Parsing fills in what you left out and strips anything that doesn't belong.
  // Always pass the parsed candidates to the renderer, not your raw objects.
  const input = parseTrackingInput({
    user: { id: 'shopper-1' },
    context: { surface: 'pdp', currentSku: 'A-1', currentCategory: 'Cookware' },
    candidates: catalog,
    signals: { cart: [{ sku: 'A-2', at: Date.now() }] },
  });

  const spec = await generator.generate(input);

  return <RudraComponent spec={spec} products={input.candidates} locale="en-US" />;
}
// --- end quickstart ---

describe('the quickstart', () => {
  it('renders a recommendation block', async () => {
    const markup = renderToStaticMarkup(await recommendations());

    expect(markup).toContain('data-rudra-slot="recommendations"');
    expect(markup).toContain('Chef knife');
    expect(markup).toContain('$55.00');
    expect(markup).toContain('Goes with your cart');
    expect(markup).not.toContain('Cast iron skillet');
    expect(markup).not.toContain('Enamel dutch oven');
  });
});
