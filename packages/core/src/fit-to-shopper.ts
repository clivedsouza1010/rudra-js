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
  const limit = Math.min(picks.length, maxItems);
  const ourReasons = new Map<string, string>();
  const blocks: Block[] = [];
  let used = 0;

  for (const block of spec.blocks) {
    if (block.kind !== 'grid' && block.kind !== 'carousel') {
      blocks.push(block);
      continue;
    }

    const items: ProductReference[] = [];
    for (const item of block.items) {
      if (used >= limit) break;
      const pick = picks[used]!;
      ourReasons.set(pick.product.sku, pick.reason);
      items.push({
        sku: pick.product.sku,
        basis: pick.basis,
        reason: pick.reason,
        badge: null,
        emphasis: item.emphasis,
      });
      used += 1;
    }
    blocks.push({ ...block, items });
  }

  return { spec: { ...spec, blocks }, ourReasons };
}
