import type { ProductReference } from '@rudra-js/core';
import { sellableProduct, type BlockRenderContext } from '../render-context.js';

export function ProductCard({
  reference,
  context,
}: {
  reference: ProductReference;
  context: BlockRenderContext;
}) {
  const product = sellableProduct(context.products, reference.sku);
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
        {reference.badge ? <span className="rudra-card__badge">{reference.badge}</span> : null}{' '}
        <span className="rudra-card__title">{product.title}</span>{' '}
        <span className="rudra-card__price">{context.formatPrice(product)}</span>{' '}
        {reference.reason ? <span className="rudra-card__reason">{reference.reason}</span> : null}
      </span>
    </a>
  );
}
