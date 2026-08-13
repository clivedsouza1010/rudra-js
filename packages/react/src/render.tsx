import type { CSSProperties } from 'react';
import type { Block, ComponentSpec, Product } from '@rudra/core';
import {
  defaultFormatPrice,
  defaultHrefForSku,
  type RenderCtx,
} from './context.js';
import { defaultRegistry, type BlockRegistry } from './registry.js';
import { defaultTheme, styles, type RudraTheme } from './theme.js';

export interface RudraComponentProps {
  /** The spec returned by `generator.generate()`. */
  spec: ComponentSpec;
  /** The host catalog. Any SKU in the spec is resolved against this. */
  products: Product[] | Map<string, Product>;
  registry?: BlockRegistry;
  theme?: RudraTheme;
  hrefForSku?: (sku: string) => string;
  formatPrice?: (product: Product) => string;
  /** Renders the model's rationale inline. For development, not production. */
  showRationale?: boolean;
  className?: string;
  style?: CSSProperties;
}

function toMap(products: Product[] | Map<string, Product>): Map<string, Product> {
  if (products instanceof Map) return products;
  return new Map(products.map((product) => [product.sku, product]));
}

function renderBlock(block: Block, ctx: RenderCtx, registry: BlockRegistry, key: number) {
  // The registry is keyed by the spec's own discriminant, so an unknown kind is
  // impossible for a validated spec — but a host with a partial custom registry
  // should get a skipped block rather than a thrown render.
  switch (block.kind) {
    case 'hero':
      return <registry.hero key={key} block={block} ctx={ctx} />;
    case 'grid':
      return <registry.grid key={key} block={block} ctx={ctx} />;
    case 'carousel':
      return <registry.carousel key={key} block={block} ctx={ctx} />;
    case 'banner':
      return <registry.banner key={key} block={block} ctx={ctx} />;
    case 'copy':
      return <registry.copy key={key} block={block} ctx={ctx} />;
    default:
      return null;
  }
}

/**
 * Renders a generated component spec as server-rendered HTML.
 *
 * This is a React Server Component: no hooks, no client bundle, no hydration
 * for the recommendation content. The whole component is present in the initial
 * HTML response, which is what removes the "pop-in" of a client-fetched
 * recommendation rail and what makes the content crawlable.
 *
 * A spec with no blocks renders nothing at all — an empty recommendation
 * section is worse than no section.
 */
export function RudraComponent({
  spec,
  products,
  registry = defaultRegistry,
  theme = defaultTheme,
  hrefForSku = defaultHrefForSku,
  formatPrice = defaultFormatPrice,
  showRationale = false,
  className,
  style,
}: RudraComponentProps) {
  if (spec.blocks.length === 0) return null;

  const s = styles(theme);
  const ctx: RenderCtx = {
    products: toMap(products),
    hrefForSku,
    formatPrice,
    theme,
    slot: spec.slot,
  };

  return (
    <section
      className={className}
      style={style ? { ...s.root, ...style } : s.root}
      // Provenance travels with the markup: it makes cache-hit rate, fallback
      // rate and generation latency observable from the rendered page alone,
      // which is what the benchmark harness scrapes.
      data-rudra-slot={spec.slot}
      data-rudra-source={spec.source}
      data-rudra-tone={spec.tone}
      data-rudra-latency-ms={spec.latencyMs}
      data-rudra-provider={spec.provider ?? 'none'}
      data-rudra-model={spec.model ?? 'none'}
      {...(spec.degradedReason ? { 'data-rudra-degraded': spec.degradedReason } : {})}
    >
      <header style={s.header}>
        <h2 style={s.headline}>{spec.headline}</h2>
        {spec.subheadline ? <p style={s.subheadline}>{spec.subheadline}</p> : null}
      </header>

      {spec.blocks.map((block, index) => renderBlock(block, ctx, registry, index))}

      {showRationale ? <p style={s.rationale}>{spec.rationale}</p> : null}
    </section>
  );
}
