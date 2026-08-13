import type { Block, GeneratedSpec, ProductRef } from './spec.js';
import type { SignalDigest } from './digest.js';
import type { TrackingInput } from './tracking-input.js';

/**
 * Reconciliation: the boundary between "what the model said" and "what we render".
 *
 * Schema validation guarantees shape, not truth. This pass guarantees the rest:
 * every SKU resolves to a real, in-stock, merchandised product; nothing the
 * shopper disliked survives; no product appears twice; copy cannot overflow its
 * container; and the item budget is respected no matter what the model returned.
 *
 * Nothing here trusts the model. A generation that violates every rule
 * degrades to `usable: false` and the caller renders the deterministic fallback.
 */

/**
 * Length ceilings, applied by truncation rather than rejection — a slightly
 * clipped headline is a better outcome than a discarded generation.
 */
const CLAMP = {
  headline: 90,
  subheadline: 140,
  blockTitle: 80,
  reason: 120,
  badge: 24,
  ctaLabel: 32,
  bannerText: 160,
  copyBody: 420,
  rationale: 300,
} as const;

const MAX_BLOCKS = 4;

export interface ReconcileResult {
  spec: GeneratedSpec;
  /** True when at least one block survived and the component is worth rendering. */
  usable: boolean;
  /** Machine-readable notes about what was removed, for logging and evaluation. */
  violations: string[];
}

function clamp(value: string, max: number): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= max) return trimmed;
  // Cut on a word boundary where one is available near the limit.
  const hard = trimmed.slice(0, max);
  const lastSpace = hard.lastIndexOf(' ');
  const base = lastSpace > max * 0.6 ? hard.slice(0, lastSpace) : hard;
  return `${base.replace(/[.,;:!?-]+$/, '')}…`;
}

function clampNullable(value: string | null, max: number): string | null {
  if (value === null) return null;
  const clamped = clamp(value, max);
  return clamped.length === 0 ? null : clamped;
}

interface Allowlist {
  /** SKUs the model may place. */
  allowed: Set<string>;
  /** SKUs that must never be placed, whatever the model decided. */
  blocked: Set<string>;
}

function buildAllowlist(input: TrackingInput, digest: SignalDigest): Allowlist {
  const allowed = new Set<string>();
  for (const product of input.candidates) {
    // An out-of-stock candidate is not a recommendation, it is a dead end.
    if (product.inStock) allowed.add(product.sku);
  }

  const blocked = new Set<string>(digest.dislikedSkus);
  // The product the shopper is already looking at is never a recommendation.
  if (digest.currentSku) blocked.add(digest.currentSku);

  return { allowed, blocked };
}

/**
 * Filters a block's product references against the allowlist and the running
 * budget, mutating neither the input block nor the caller's counters directly.
 */
function reconcileItems(
  items: ProductRef[],
  allowlist: Allowlist,
  placed: Set<string>,
  remaining: { count: number },
  violations: string[],
): ProductRef[] {
  const out: ProductRef[] = [];

  for (const item of items) {
    if (remaining.count <= 0) {
      violations.push(`budget:dropped:${item.sku}`);
      continue;
    }
    if (!allowlist.allowed.has(item.sku)) {
      // Either hallucinated or out of stock. Either way it cannot render.
      violations.push(`unknown-sku:${item.sku}`);
      continue;
    }
    if (allowlist.blocked.has(item.sku)) {
      violations.push(`blocked-sku:${item.sku}`);
      continue;
    }
    if (placed.has(item.sku)) {
      violations.push(`duplicate-sku:${item.sku}`);
      continue;
    }

    placed.add(item.sku);
    remaining.count -= 1;
    out.push({
      sku: item.sku,
      reason: clamp(item.reason, CLAMP.reason),
      badge: clampNullable(item.badge, CLAMP.badge),
      emphasis: item.emphasis,
    });
  }

  return out;
}

function reconcileBlock(
  block: Block,
  allowlist: Allowlist,
  placed: Set<string>,
  remaining: { count: number },
  violations: string[],
): Block | null {
  switch (block.kind) {
    case 'hero': {
      let sku = block.sku;
      if (sku !== null) {
        const placeable =
          allowlist.allowed.has(sku) && !allowlist.blocked.has(sku) && !placed.has(sku);
        if (!placeable || remaining.count <= 0) {
          if (!allowlist.allowed.has(sku)) violations.push(`unknown-sku:${sku}`);
          else if (allowlist.blocked.has(sku)) violations.push(`blocked-sku:${sku}`);
          else if (placed.has(sku)) violations.push(`duplicate-sku:${sku}`);
          else violations.push(`budget:dropped:${sku}`);
          // A hero without its product is still a legitimate headline block.
          sku = null;
        } else {
          placed.add(sku);
          remaining.count -= 1;
        }
      }
      return {
        kind: 'hero',
        headline: clamp(block.headline, CLAMP.headline),
        body: clampNullable(block.body, CLAMP.subheadline),
        sku,
        ctaLabel: clampNullable(block.ctaLabel, CLAMP.ctaLabel),
      };
    }

    case 'grid': {
      const items = reconcileItems(block.items, allowlist, placed, remaining, violations);
      if (items.length === 0) {
        violations.push('empty-block:grid');
        return null;
      }
      // Never leave a grid wider than it has items to fill.
      const columns = Math.min(block.columns, Math.max(2, items.length)) as 2 | 3 | 4;
      return {
        kind: 'grid',
        title: clampNullable(block.title, CLAMP.blockTitle),
        columns,
        items,
      };
    }

    case 'carousel': {
      const items = reconcileItems(block.items, allowlist, placed, remaining, violations);
      if (items.length === 0) {
        violations.push('empty-block:carousel');
        return null;
      }
      return {
        kind: 'carousel',
        title: clampNullable(block.title, CLAMP.blockTitle),
        items,
      };
    }

    case 'banner': {
      const text = clamp(block.text, CLAMP.bannerText);
      if (text.length === 0) {
        violations.push('empty-block:banner');
        return null;
      }
      return {
        kind: 'banner',
        tone: block.tone,
        text,
        ctaLabel: clampNullable(block.ctaLabel, CLAMP.ctaLabel),
      };
    }

    case 'copy': {
      const body = clamp(block.body, CLAMP.copyBody);
      if (body.length === 0) {
        violations.push('empty-block:copy');
        return null;
      }
      return {
        kind: 'copy',
        title: clampNullable(block.title, CLAMP.blockTitle),
        body,
      };
    }
  }
}

/** True when a spec contains at least one product-bearing block. */
function hasProducts(blocks: Block[]): boolean {
  return blocks.some(
    (block) =>
      (block.kind === 'grid' && block.items.length > 0) ||
      (block.kind === 'carousel' && block.items.length > 0) ||
      (block.kind === 'hero' && block.sku !== null),
  );
}

export function reconcileSpec(
  generated: GeneratedSpec,
  input: TrackingInput,
  digest: SignalDigest,
): ReconcileResult {
  const violations: string[] = [];
  const allowlist = buildAllowlist(input, digest);
  const placed = new Set<string>();
  const remaining = { count: digest.maxItems };

  const candidateBlocks = generated.blocks.slice(0, MAX_BLOCKS);
  if (generated.blocks.length > MAX_BLOCKS) {
    violations.push(`too-many-blocks:${generated.blocks.length}`);
  }

  const blocks: Block[] = [];
  for (const block of candidateBlocks) {
    const reconciled = reconcileBlock(block, allowlist, placed, remaining, violations);
    if (reconciled !== null) blocks.push(reconciled);
  }

  const spec: GeneratedSpec = {
    tone: generated.tone,
    headline: clamp(generated.headline, CLAMP.headline),
    subheadline: clampNullable(generated.subheadline, CLAMP.subheadline),
    blocks,
    rationale: clamp(generated.rationale, CLAMP.rationale),
  };

  // A component that recommends nothing is worse than no component at all —
  // the caller renders the deterministic fallback instead.
  const usable = blocks.length > 0 && hasProducts(blocks) && spec.headline.length > 0;
  if (!usable) violations.push('unusable:no-products');

  return { spec, usable, violations };
}
