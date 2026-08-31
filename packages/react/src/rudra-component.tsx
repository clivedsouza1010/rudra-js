import type { Block, Bundle, ComponentSpec, Product } from '@rudra-js/core';
import {
  defaultFormatBundlePrice,
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

/** A list of products, or anything keyed by SKU that answers `get` and `has`. */
export type ProductCatalog = readonly Product[] | ReadonlyMap<string, Product>;

/**
 * Whether the catalog is already keyed by SKU.
 *
 * Asks what the renderers actually call rather than which class the host
 * happened to construct. `instanceof Map` was wrong twice over: a Map that
 * crossed a realm boundary — a `node:vm` context, a worker — fails it, and so
 * does a host's own `ReadonlyMap`, which the prop type has always allowed. Both
 * then fell into the list branch, where `catalog.map is not a function` throws
 * while the render context is being built, before any block renders. That takes
 * down the whole page, not just this component.
 *
 * Keyed before list, because a collection can answer both: an Immutable.js map
 * has `map`, and converting through it yields a catalog whose every value is a
 * `[sku, product]` pair rather than a product.
 */
function isKeyedBySku(catalog: ProductCatalog): catalog is ReadonlyMap<string, Product> {
  const candidate = catalog as { get?: unknown; has?: unknown };
  return typeof candidate.get === 'function' && typeof candidate.has === 'function';
}

function toProductMap(catalog: ProductCatalog): ReadonlyMap<string, Product> {
  if (isKeyedBySku(catalog)) return catalog;
  if (typeof (catalog as { map?: unknown }).map !== 'function') {
    // A Set of products, a plain object keyed by SKU, a Map that has been
    // through JSON. Refusing here names the prop while the stack still points
    // at it. Carried through instead, a grid renders nothing and a banner
    // renders a healthy-looking page, and the shop finds out from a dashboard.
    throw new TypeError(
      'the `products` prop must be a list of products, or keyed by SKU with `get` and `has` — ' +
        `received ${Object.prototype.toString.call(catalog)}`,
    );
  }
  return new Map(catalog.map((product) => [product.sku, product]));
}

/**
 * Whether a block still has anything to say once the catalog is applied.
 *
 * Three block kinds can come up empty: reconciliation ran against the catalog
 * as it was when the spec was generated, and a SKU can sell out between then
 * and this render. Grid and carousel lose just the products that did; a
 * bundle loses itself entirely if any one of its members did. The rest carry
 * their own words.
 */
function hasContent(
  block: Block,
  products: ReadonlyMap<string, Product>,
  bundles: ReadonlyMap<string, Bundle>,
): boolean {
  switch (block.kind) {
    case 'grid':
    case 'carousel':
      return block.items.some((reference) => products.has(reference.sku));
    case 'hero':
    case 'banner':
    case 'copy':
      return true;
    case 'bundle': {
      if (block.bundleId === null) return false;
      const bundle = bundles.get(block.bundleId);
      return bundle !== undefined && bundle.skus.every((sku) => products.has(sku));
    }
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
    case 'bundle':
      return <registry.bundle key={index} block={block} context={context} />;
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
  bundles,
  registry = defaultRegistry,
  hrefForSku = defaultHrefForSku,
  formatPrice,
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
    formatBundlePrice: (bundle) => defaultFormatBundlePrice(bundle, productMap, locale),
  };

  // An empty recommendation area is worse than none: it takes up space and
  // tells the shopper the page is broken. That includes the subtler version —
  // a headline and an empty box, because every product in the spec has sold out
  // since it was generated — which is why this asks what is left rather than
  // how many blocks arrived.
  const visible = spec.blocks.filter((block) =>
    hasContent(block, context.products, context.bundles),
  );
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
