import type { BundleBlock, Product } from '@rudra-js/core';
import type { BlockRenderContext } from '../render-context.js';

export function BundleRenderer({
  block,
  context,
}: {
  block: BundleBlock;
  context: BlockRenderContext;
}) {
  const bundle = block.bundleId === null ? undefined : context.bundles.get(block.bundleId);
  if (!bundle) return null;

  const products: Product[] = [];
  for (const sku of bundle.skus) {
    const product = context.products.get(sku);
    // A set missing one of its parts is not that set.
    if (!product) return null;
    products.push(product);
  }

  return (
    <section className="rudra-bundle">
      {/* The shop's label is the one name here anyone can check, so it leads. */}
      {bundle.label ? <h3 className="rudra-bundle__label">{bundle.label}</h3> : null}
      {block.title ? <p className="rudra-bundle__title">{block.title}</p> : null}
      {block.body ? <p className="rudra-bundle__body">{block.body}</p> : null}

      <ul className="rudra-bundle__items">
        {products.map((product) => (
          <li key={product.sku} className="rudra-bundle__item" data-rudra-sku={product.sku}>
            <a className="rudra-bundle__link" href={context.hrefForSku(product.sku)}>
              {product.title}
            </a>
          </li>
        ))}
      </ul>

      <p className="rudra-bundle__price">{context.formatBundlePrice(bundle)}</p>
      {block.ctaLabel ? <span className="rudra-bundle__cta">{block.ctaLabel}</span> : null}
    </section>
  );
}
