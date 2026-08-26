import type { ProductReference } from '@rudra-js/core';
import type { BlockRenderContext } from '../render-context.js';

/**
 * One product.
 *
 * Every fact here — the title, the price, the image, the link — is read from
 * the catalog, not from the specification. The only things the model
 * contributes are `reason`, `badge` and `emphasis`, and React escapes all three
 * on the way into the markup.
 */
export function ProductCard({
  reference,
  context,
}: {
  reference: ProductReference;
  context: BlockRenderContext;
}) {
  const product = context.products.get(reference.sku);
  // Reconciliation drops a SKU the catalog does not have, so this should be
  // unreachable. Rendering nothing beats rendering a card with holes in it.
  if (!product) return null;

  const isFeatured = reference.emphasis === 'featured';

  return (
    <a
      href={context.hrefForSku(product.sku)}
      data-rudra-sku={product.sku}
      data-rudra-basis={reference.basis}
      className={isFeatured ? 'rudra-card rudra-card--featured' : 'rudra-card'}
    >
      {product.imageUrl ? (
        <img className="rudra-card__image" src={product.imageUrl} alt="" loading="lazy" />
      ) : null}

      <span className="rudra-card__body">
        {reference.badge ? <span className="rudra-card__badge">{reference.badge}</span> : null}
        <span className="rudra-card__title">{product.title}</span>
        <span className="rudra-card__price">{context.formatPrice(product)}</span>
        {reference.reason ? <span className="rudra-card__reason">{reference.reason}</span> : null}
      </span>
    </a>
  );
}
