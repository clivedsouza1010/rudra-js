import type { Block, GeneratedSpec, ProductReference } from './component-spec.js';
import type { ProductPick } from './product-selection.js';

export interface FittedSpec {
  spec: GeneratedSpec;
  ourReasons: Map<string, string>;
}

export function fitToShopper(
  spec: GeneratedSpec,
  picks: readonly ProductPick[],
  maxItems: number,
): FittedSpec {
  let next = 0;
  const limit = Math.min(picks.length, maxItems);

  const ourReasons = new Map<string, string>();
  const blocks: Block[] = [];
  for (const block of spec.blocks) {
    if (block.kind === 'grid' || block.kind === 'carousel') {
      const items: ProductReference[] = [];
      for (const item of block.items) {
        if (next >= limit) break;
        const chosen = picks[next]!;

        ourReasons.set(chosen.product.sku, chosen.reason);
        items.push({
          sku: chosen.product.sku,
          basis: chosen.basis,
          reason: chosen.reason,

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

  return { spec: { ...spec, blocks }, ourReasons };
}
