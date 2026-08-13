import type { ProductRef } from '@rudra/core';
import type { RenderCtx } from '../context.js';
import { styles } from '../theme.js';

/**
 * The atomic unit of a generated component.
 *
 * The model supplies only `sku`, `reason`, `badge` and `emphasis`. Everything
 * the shopper actually reads as fact — title, price, image, link — is read from
 * the host catalog here.
 */
export function ProductCard({ item, ctx }: { item: ProductRef; ctx: RenderCtx }) {
  const product = ctx.products.get(item.sku);
  // Reconciliation guarantees this resolves, but a renderer that can be dropped
  // into an arbitrary host should not assume its caller upheld the contract.
  if (!product) return null;

  const s = styles(ctx.theme);
  const featured = item.emphasis === 'featured';

  return (
    <a
      href={ctx.hrefForSku(product.sku)}
      style={featured ? { ...s.card, ...s.cardFeatured } : s.card}
      data-rudra-sku={product.sku}
      data-rudra-emphasis={item.emphasis}
    >
      {product.imageUrl ? (
        <img src={product.imageUrl} alt={product.title} style={s.cardMedia} loading="lazy" />
      ) : (
        <span style={s.cardMedia} aria-hidden="true" />
      )}

      {item.badge ? <span style={s.badge}>{item.badge}</span> : null}

      <span style={s.cardTitle}>{product.title}</span>
      <span style={s.cardPrice}>{ctx.formatPrice(product)}</span>
      <span style={s.cardReason}>{item.reason}</span>
    </a>
  );
}
