import type { Block, ComponentSpec, Product } from '@rudra/core';
import {
  defaultFormatPrice,
  defaultHrefForSku,
  type BlockRenderContext,
} from './render-context.js';
import { defaultRegistry, type BlockRegistry } from './registry.js';

export interface RudraComponentProps {
  spec: ComponentSpec;
  /**
   * The host catalog. Every product fact on the page comes from here rather
   * than from the specification.
   *
   * Validate them with `productSchema` from `@rudra/core` — the same schema
   * your candidates already passed — not with `parseTrackingInput`, which
   * parses a whole tracking payload and will reject a bare catalog.
   *
   * This is a second door into the framework. `imageUrl` lands in an
   * `<img src>`, and `productSchema` is the only thing that rejects a
   * protocol-relative `//evil.example/pixel.png` or a `data:` URL — React
   * neutralises `javascript:` on its own, but not those. A price that is not a
   * finite number throws rather than rendering as free.
   */
  products: ProductCatalog;
  registry?: BlockRegistry;
  hrefForSku?: (sku: string) => string;
  formatPrice?: (product: Product) => string;
  /**
   * The shopper's locale, used to punctuate prices. Defaults to the server's,
   * which is almost never the shopper's — pass it if the shop serves more than
   * one. Ignored when `formatPrice` is supplied.
   */
  locale?: string;
  /**
   * Adds the model's own reasoning, the provider and the model name to the
   * markup. Useful while developing and while benchmarking; it publishes which
   * vendor a shop uses and whether the component is currently degraded, so it
   * is off unless asked for.
   */
  hasDiagnostics?: boolean;
  className?: string;
}

type ProductCatalog = readonly Product[] | ReadonlyMap<string, Product>;

// A bare `instanceof Map` narrows the true branch but not the false one, since a
// ReadonlyMap need not be a Map. Array.isArray has the mirror problem with a
// readonly array. Naming the predicate settles both branches.
function isKeyedBySku(catalog: ProductCatalog): catalog is ReadonlyMap<string, Product> {
  return catalog instanceof Map;
}

function toProductMap(catalog: ProductCatalog): ReadonlyMap<string, Product> {
  if (isKeyedBySku(catalog)) return catalog;
  return new Map(catalog.map((product) => [product.sku, product]));
}

/**
 * Whether a block still has anything to say once the catalog is applied.
 *
 * Only the two product blocks can come up empty: reconciliation ran against the
 * catalog as it was when the spec was generated, and a SKU can sell out between
 * then and this render. The rest carry their own words.
 */
function hasContent(block: Block, products: ReadonlyMap<string, Product>): boolean {
  switch (block.kind) {
    case 'grid':
    case 'carousel':
      return block.items.some((reference) => products.has(reference.sku));
    case 'hero':
    case 'banner':
    case 'copy':
      return true;
    default:
      // A kind this renderer predates renders nothing, so it counts as nothing.
      block satisfies never;
      return false;
  }
}

function renderBlock(
  block: Block,
  context: BlockRenderContext,
  registry: BlockRegistry,
  index: number,
) {
  switch (block.kind) {
    case 'hero':
      return <registry.hero key={index} block={block} context={context} />;
    case 'grid':
      return <registry.grid key={index} block={block} context={context} />;
    case 'carousel':
      return <registry.carousel key={index} block={block} context={context} />;
    case 'banner':
      return <registry.banner key={index} block={block} context={context} />;
    case 'copy':
      return <registry.copy key={index} block={block} context={context} />;
    default:
      // A newer core carrying a block kind this renderer predates loses that
      // block rather than the page. In this repo the assertion below fails the
      // build instead, which is the moment it is cheap to notice.
      block satisfies never;
      return null;
  }
}

/**
 * Renders a component specification.
 *
 * A Server Component: no hooks, no state, no effects, and therefore no client
 * bundle and no hydration for the recommendation area. The whole component
 * arrives in the initial HTML response, which is what removes the pop-in a
 * client-fetched recommendation rail has — and what makes the content visible
 * to a crawler that does not run JavaScript.
 *
 * Renders nothing at all when no block produced markup.
 */
export function RudraComponent({
  spec,
  products,
  registry = defaultRegistry,
  hrefForSku = defaultHrefForSku,
  formatPrice,
  locale,
  hasDiagnostics = false,
  className,
}: RudraComponentProps) {
  const context: BlockRenderContext = {
    products: toProductMap(products),
    hrefForSku,
    formatPrice: formatPrice ?? ((product) => defaultFormatPrice(product, locale)),
  };

  // An empty recommendation area is worse than none: it takes up space and
  // tells the shopper the page is broken. That includes the subtler version —
  // a headline and an empty box, because every product in the spec has sold out
  // since it was generated — which is why this asks what is left rather than
  // how many blocks arrived.
  const visible = spec.blocks.filter((block) => hasContent(block, context.products));
  if (visible.length === 0) return null;

  // React omits a data-* attribute whose value is undefined, so degradedReason
  // needs no branch of its own.
  const diagnosticAttributes = hasDiagnostics
    ? {
        'data-rudra-provider': spec.provider ?? 'none',
        'data-rudra-model': spec.model ?? 'none',
        'data-rudra-latency-ms': String(spec.latencyMs),
        'data-rudra-degraded': spec.degradedReason,
      }
    : undefined;

  return (
    <section
      // Extended rather than replaced: every child class is namespaced under
      // `rudra`, and the package ships no stylesheet, so a host will pass one.
      className={className ? `rudra ${className}` : 'rudra'}
      data-rudra-slot={spec.slot}
      // Where the component came from travels with the markup on purpose, so
      // hit rate and fallback share can be read off a rendered page — which
      // means `source="fallback"` is public. What stays behind the diagnostics
      // flag is everything more specific than that: which vendor, which model,
      // how slow, and why it fell back.
      data-rudra-source={spec.source}
      data-rudra-tone={spec.tone}
      {...diagnosticAttributes}
    >
      <header className="rudra__header">
        <h2 className="rudra__headline">{spec.headline}</h2>
        {spec.subheadline ? <p className="rudra__subheadline">{spec.subheadline}</p> : null}
      </header>

      {visible.map((block, index) => renderBlock(block, context, registry, index))}

      {hasDiagnostics ? <p className="rudra__rationale">{spec.rationale}</p> : null}
    </section>
  );
}
