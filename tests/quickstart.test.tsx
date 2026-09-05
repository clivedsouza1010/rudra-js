import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

// The code below is the quickstart in README.md. If you change one, change the
// other: readme-quickstart.test.ts fails when they drift apart.
// --- quickstart ---
import { createComponentGenerator, parseTrackingInput } from '@rudra-js/core';
import { RudraComponent } from '@rudra-js/react';

const catalog = [
  { sku: 'A-1', title: 'Cast iron skillet', category: 'Cookware', price: 39, currency: 'USD' },
  { sku: 'A-2', title: 'Enamel dutch oven', category: 'Cookware', price: 89, currency: 'USD' },
  { sku: 'A-3', title: 'Chef knife', category: 'Knives', price: 55, currency: 'USD' },
];

async function recommendations() {
  // No provider means no API key and no spend. It is a supported setting, not
  // a stub: you get the deterministic component.
  const generator = createComponentGenerator({ provider: null });

  // Parsing fills in what you left out and rejects what does not belong. Pass
  // the parsed candidates to the renderer, not your raw objects.
  const input = parseTrackingInput({
    user: { id: 'shopper-1' },
    context: { surface: 'pdp', currentSku: 'A-1', currentCategory: 'Cookware' },
    candidates: catalog,
    signals: { cart: [{ sku: 'A-2', at: Date.now() }] },
  });

  const spec = await generator.generate(input);

  return <RudraComponent spec={spec} products={input.candidates} />;
}
// --- end quickstart ---

describe('the quickstart', () => {
  it('renders a recommendation block', async () => {
    const markup = renderToStaticMarkup(await recommendations());

    expect(markup).toContain('data-rudra-slot="recommendations"');
    // The knife, because the skillet is the page and the dutch oven is already
    // in the cart. No model was asked.
    expect(markup).toContain('Chef knife');
    expect(markup).toContain('$55.00');
    expect(markup).toContain('Goes with your cart');
    expect(markup).not.toContain('Cast iron skillet');
    expect(markup).not.toContain('Enamel dutch oven');
  });
});
