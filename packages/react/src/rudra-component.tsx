import type { Block, Bundle, ComponentSpec, Product } from '@rudra-js/core';
import {
  defaultFormatBundlePrice,
  defaultFormatPrice,
  defaultHrefForSku,
  sellableProduct,
  type BlockRenderContext,
} from './render-context.js';
import { defaultRegistry, type BlockRegistry } from './registry.js';

export interface RudraComponentProps {
  spec: ComponentSpec;
  /**
   * The host catalog. Every product fact on the page comes from here rather
   * than from the specification.
   *
   * A list of products, or anything keyed by SKU — a `Map`, or your own view
   * over a catalog too large to hold in one. The renderers only ever call
   * `get(sku)` and `has(sku)`, so a view needs nothing else to be fast.
   *
   * Validate them with `productSchema` from `@rudra-js/core` — the same schema
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
  /** Sets the shop sells together. Only needed if a spec can carry a bundle block. */
  bundles?: readonly Bundle[];
  registry?: BlockRegistry;
  hrefForSku?: (sku: string) => string;
  formatPrice?: (product: Product) => string;
  /** Same as `formatPrice`, but for a bundle — the shop's price, not a sum of the parts. */
  formatBundlePrice?: (bundle: Bundle) => string;
  /**
   * The shopper's locale, used to punctuate prices. Defaults to the server's,
   * which is almost never the shopper's — pass it if the shop serves more than
   * one. Ignored when `formatPrice` and `formatBundlePrice` are supplied.
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

/** A list of products, or anything keyed by SKU that answers `get` and `has`. */
export type ProductCatalog = readonly Product[] | ReadonlyMap<string, Product>;

// Asks what the renderers call rather than which class the host built, since
// `instanceof Map` is per-realm. Checked before the list branch because a
// collection can answer both: an Immutable.js map has `map`, and converting
// through it yields `[sku, product]` pairs rather than products.
function isKeyedBySku(catalog: ProductCatalog): catalog is ReadonlyMap<string, Product> {
  const candidate = catalog as { get?: unknown; has?: unknown };
  return typeof candidate.get === 'function' && typeof candidate.has === 'function';
}

function toProductMap(catalog: ProductCatalog): ReadonlyMap<string, Product> {
  if (isKeyedBySku(catalog)) return catalog;
  if (typeof (catalog as { map?: unknown }).map !== 'function') {
    throw new TypeError(
      'the `products` prop must be a list of products, or keyed by SKU with `get` and `has` — ' +
        `received ${Object.prototype.toString.call(catalog)}`,
    );
  }
  return new Map(catalog.map((product) => [product.sku, product]));
}

// Whether a block still has anything to say once the catalog is applied. A SKU
// can sell out between generating a spec and rendering it — the row goes, or it
// is flagged out of stock, and both read the same here: grid and carousel lose
// the products that did, a bundle loses itself if any one member did.
function hasContent(
  block: Block,
  products: ReadonlyMap<string, Product>,
  bundles: ReadonlyMap<string, Bundle>,
): boolean {
  switch (block.kind) {
    case 'grid':
    case 'carousel':
      return block.items.some(
        (reference) => sellableProduct(products, reference.sku) !== undefined,
      );
    case 'hero':
    case 'banner':
    case 'copy':
      return true;
    case 'bundle': {
      if (block.bundleId === null) return false;
      const bundle = bundles.get(block.bundleId);
      return (
        bundle !== undefined &&
        bundle.skus.every((sku) => sellableProduct(products, sku) !== undefined)
      );
    }
    default:
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
    case 'bundle':
      return <registry.bundle key={index} block={block} context={context} />;
    default:
      // A block kind this renderer predates loses that block, not the page.
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
  bundles,
  registry = defaultRegistry,
  hrefForSku = defaultHrefForSku,
  formatPrice,
  formatBundlePrice,
  locale,
  hasDiagnostics = false,
  className,
}: RudraComponentProps) {
  const productMap = toProductMap(products);
  const bundlesById = new Map((bundles ?? []).map((bundle) => [bundle.id, bundle]));

  const context: BlockRenderContext = {
    products: productMap,
    bundles: bundlesById,
    hrefForSku,
    formatPrice: formatPrice ?? ((product) => defaultFormatPrice(product, locale)),
    formatBundlePrice: formatBundlePrice ?? ((bundle) => defaultFormatBundlePrice(bundle, locale)),
  };

  const visible = spec.blocks.filter((block) =>
    hasContent(block, context.products, context.bundles),
  );
  if (visible.length === 0) return null;

  // React drops a data-* attribute whose value is undefined, so degradedReason
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
      className={className ? `rudra ${className}` : 'rudra'}
      data-rudra-slot={spec.slot}
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
