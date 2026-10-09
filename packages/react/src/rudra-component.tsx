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
  products: ProductCatalog;
  bundles?: readonly Bundle[];
  registry?: BlockRegistry;
  hrefForSku?: (sku: string) => string;
  formatPrice?: (product: Product) => string;
  formatBundlePrice?: (bundle: Bundle) => string;
  locale?: string;
  hasDiagnostics?: boolean;
  className?: string;
}

export type ProductCatalog = readonly Product[] | ReadonlyMap<string, Product>;

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
      return (
        block.headline.length > 0 ||
        (block.body !== null && block.body.length > 0) ||
        (block.sku !== null && sellableProduct(products, block.sku) !== undefined)
      );
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
      block satisfies never;
      return null;
  }
}

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
