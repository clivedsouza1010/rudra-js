import type { Block, GeneratedSpec, ProductReference } from './component-spec.js';
import type { ProductPick } from './product-selection.js';

// The model picks the shape of the component. Selection picks the products and
// what may be said about them, so a shared component still fits one shopper.
export function fitToShopper(
  spec: GeneratedSpec,
  picks: readonly ProductPick[],
  maxItems: number,
): GeneratedSpec {
  // Picks are ordered best first. Every slot takes the next one.
  let next = 0;
  const limit = Math.min(picks.length, maxItems);

  const blocks: Block[] = [];
  for (const block of spec.blocks) {
    // A hero is left alone. Its headline and body were written about the
    // product it names, so swapping the product would leave copy that describes
    // something else. Reconciliation drops the link if this shopper cannot see
    // that product, and the words stay.

    if (block.kind === 'grid' || block.kind === 'carousel') {
      const items: ProductReference[] = [];
      for (const item of block.items) {
        if (next >= limit) break; // shrink, never pad
        const chosen = picks[next]!;
        items.push({
          sku: chosen.product.sku,
          basis: chosen.basis,
          reason: chosen.reason,
          // The badge was written about a different product.
          badge: null,
          emphasis: item.emphasis,
        });
        next += 1;
      }
      blocks.push({ ...block, items });
      continue;
    }

    blocks.push(block);
  }

  return { ...spec, blocks };
}
