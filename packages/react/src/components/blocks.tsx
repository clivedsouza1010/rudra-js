import type {
  BannerBlock,
  CarouselBlock,
  CopyBlock,
  GridBlock,
  HeroBlock,
} from '@rudra/core';
import type { RenderCtx } from '../context.js';
import { gridColumns, styles } from '../theme.js';
import { ProductCard } from './ProductCard.js';

/**
 * The block renderers.
 *
 * Each maps one spec block kind to trusted markup. They are plain server
 * components — no hooks, no event handlers, no client bundle — so the whole
 * generated component ships as HTML in the initial response, which is the
 * property the architecture depends on for both first paint and crawlability.
 */

export function HeroRenderer({ block, ctx }: { block: HeroBlock; ctx: RenderCtx }) {
  const s = styles(ctx.theme);
  const product = block.sku ? ctx.products.get(block.sku) : undefined;
  const href = product ? ctx.hrefForSku(product.sku) : undefined;

  return (
    <section style={s.hero} data-rudra-block="hero">
      {product?.imageUrl ? (
        <img src={product.imageUrl} alt={product.title} style={s.heroMedia} />
      ) : null}

      <div style={s.heroBody}>
        <h3 style={s.heroHeadline}>{block.headline}</h3>
        {block.body ? <p style={s.heroText}>{block.body}</p> : null}
        {product ? (
          <p style={s.heroText}>
            <strong>{product.title}</strong> · {ctx.formatPrice(product)}
          </p>
        ) : null}
        {href ? (
          <a href={href} style={s.cta} data-rudra-sku={product?.sku}>
            {block.ctaLabel ?? 'View product'}
          </a>
        ) : null}
      </div>
    </section>
  );
}

export function GridRenderer({ block, ctx }: { block: GridBlock; ctx: RenderCtx }) {
  const s = styles(ctx.theme);
  return (
    <section data-rudra-block="grid">
      {block.title ? <h3 style={s.blockTitle}>{block.title}</h3> : null}
      <div style={{ ...s.grid, ...gridColumns(block.columns) }}>
        {block.items.map((item) => (
          <ProductCard key={item.sku} item={item} ctx={ctx} />
        ))}
      </div>
    </section>
  );
}

export function CarouselRenderer({ block, ctx }: { block: CarouselBlock; ctx: RenderCtx }) {
  const s = styles(ctx.theme);
  return (
    <section data-rudra-block="carousel">
      {block.title ? <h3 style={s.blockTitle}>{block.title}</h3> : null}
      {/* Horizontal scroll is CSS-only so the block stays a server component. */}
      <div style={s.carousel}>
        {block.items.map((item) => (
          <div key={item.sku} style={s.carouselItem}>
            <ProductCard item={item} ctx={ctx} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function BannerRenderer({ block, ctx }: { block: BannerBlock; ctx: RenderCtx }) {
  const s = styles(ctx.theme);
  const palette = ctx.theme.banner[block.tone];

  return (
    <aside
      style={{ ...s.banner, background: palette.bg, color: palette.fg }}
      data-rudra-block="banner"
      data-rudra-tone={block.tone}
    >
      <span>{block.text}</span>
      {/* The model supplies label text only; the destination is host-owned. */}
      {block.ctaLabel ? (
        <a href="/cart" style={s.bannerCta}>
          {block.ctaLabel}
        </a>
      ) : null}
    </aside>
  );
}

export function CopyRenderer({ block, ctx }: { block: CopyBlock; ctx: RenderCtx }) {
  const s = styles(ctx.theme);
  return (
    <section style={s.copy} data-rudra-block="copy">
      {block.title ? <h3 style={s.blockTitle}>{block.title}</h3> : null}
      <p style={{ margin: 0 }}>{block.body}</p>
    </section>
  );
}
