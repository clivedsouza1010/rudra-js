import type { Block, ComponentSpec, Product } from '@rudra/core';
import {
  defaultFormatPrice,
  defaultHrefForSku,
  type BlockRenderContext,
} from './render-context.js';
import { defaultRegistry, type BlockRegistry } from './registry.js';

/**
 * Renders a component specification.
 *
 * These are Server Components: no hooks, no state, no effects, and therefore no
 * client bundle and no hydration for the recommendation area. The whole
 * component arrives in the initial HTML response, which is what removes the
 * pop-in a client-fetched recommendation rail has — and what makes the content
 * visible to a crawler that does not run JavaScript.
 */

export interface RudraComponentProps {
  spec: ComponentSpec;
  /** The host catalog. Every SKU in the spec is resolved against this. */
  products: readonly Product[] | Map<string, Product>;
  registry?: BlockRegistry;
  hrefForSku?: (sku: string) => string;
  formatPrice?: (product: Product) => string;
  /**
   * Adds the model's own reasoning, the provider and the model name to the
   * markup. Useful while developing and while benchmarking; it publishes which
   * vendor a shop uses and whether the component is currently degraded, so it
   * is off unless asked for.
   */
  showDiagnostics?: boolean;
  className?: string;
}

function toProductMap(products: readonly Product[] | Map<string, Product>): Map<string, Product> {
  if (products instanceof Map) return products;
  return new Map(products.map((product) => [product.sku, product]));
}

function renderBlock(
  block: Block,
  context: BlockRenderContext,
  registry: BlockRegistry,
  key: number,
) {
  switch (block.kind) {
    case 'hero':
      return <registry.hero key={key} block={block} context={context} />;
    case 'grid':
      return <registry.grid key={key} block={block} context={context} />;
    case 'carousel':
      return <registry.carousel key={key} block={block} context={context} />;
    case 'banner':
      return <registry.banner key={key} block={block} context={context} />;
    case 'copy':
      return <registry.copy key={key} block={block} context={context} />;
    default:
      // Unreachable for a validated spec, but a host with a partial custom
      // registry should lose one block rather than the whole page.
      return null;
  }
}

export function RudraComponent({
  spec,
  products,
  registry = defaultRegistry,
  hrefForSku = defaultHrefForSku,
  formatPrice = defaultFormatPrice,
  showDiagnostics = false,
  className,
}: RudraComponentProps) {
  // An empty recommendation area is worse than none: it takes up space and
  // tells the shopper the page is broken.
  if (spec.blocks.length === 0) return null;

  const context: BlockRenderContext = {
    products: toProductMap(products),
    hrefForSku,
    formatPrice,
    slot: spec.slot,
  };

  return (
    <section
      className={className ?? 'rudra'}
      data-rudra-slot={spec.slot}
      // Where the component came from travels with the markup, so hit rate and
      // fallback share can be read off a rendered page. The vendor's name and
      // the degradation state do not, unless diagnostics are asked for — those
      // tell a visitor which model a shop uses and when it is not working.
      data-rudra-source={spec.source}
      data-rudra-tone={spec.tone}
      {...(showDiagnostics
        ? {
            'data-rudra-provider': spec.provider ?? 'none',
            'data-rudra-model': spec.model ?? 'none',
            'data-rudra-latency-ms': String(spec.latencyMs),
            ...(spec.degradedReason ? { 'data-rudra-degraded': spec.degradedReason } : {}),
          }
        : {})}
    >
      <header className="rudra__header">
        <h2 className="rudra__headline">{spec.headline}</h2>
        {spec.subheadline ? <p className="rudra__subheadline">{spec.subheadline}</p> : null}
      </header>

      {spec.blocks.map((block, index) => renderBlock(block, context, registry, index))}

      {showDiagnostics ? <p className="rudra__rationale">{spec.rationale}</p> : null}
    </section>
  );
}
