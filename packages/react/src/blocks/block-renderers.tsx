/**
 * Five of the six block renderers. The bundle one is next door, in
 * `bundle-block.tsx`, because it draws a set the shop supplied rather than
 * products the model picked.
 *
 * Each takes a block the model produced and a context the host owns. None of
 * them interpolate markup, and none of them read a product fact from the block
 * — that is what keeps generated output to the role of deciding layout, order
 * and wording.
 */

import type { BannerBlock, CarouselBlock, CopyBlock, GridBlock, HeroBlock } from '@rudra-js/core';
import type { BlockRenderContext } from '../render-context.js';
import { ProductCard } from './product-card.js';

export function HeroRenderer({
  block,
  context,
}: {
  block: HeroBlock;
  context: BlockRenderContext;
}) {
  const product = block.sku ? context.products.get(block.sku) : undefined;

  return (
    <section className="rudra-hero">
      <h3 className="rudra-hero__headline">{block.headline}</h3>
      {block.body ? <p className="rudra-hero__body">{block.body}</p> : null}
      {product ? (
        <a
          className="rudra-hero__link"
          href={context.hrefForSku(product.sku)}
          data-rudra-sku={product.sku}
        >
          {product.title}
          <span className="rudra-hero__price">{context.formatPrice(product)}</span>
        </a>
      ) : null}
      {/* Only alongside a product: a "Shop now" with no destination is worse
          than no call to action, and the model can set one for a SKU the
          catalog does not have. */}
      {product && block.ctaLabel ? <span className="rudra-hero__cta">{block.ctaLabel}</span> : null}
    </section>
  );
}

export function GridRenderer({
  block,
  context,
}: {
  block: GridBlock;
  context: BlockRenderContext;
}) {
  return (
    <section className="rudra-grid" data-rudra-columns={block.columns}>
      {block.title ? <h3 className="rudra-grid__title">{block.title}</h3> : null}
      <div className="rudra-grid__items">
        {block.items.map((reference) => (
          <ProductCard key={reference.sku} reference={reference} context={context} />
        ))}
      </div>
    </section>
  );
}

export function CarouselRenderer({
  block,
  context,
}: {
  block: CarouselBlock;
  context: BlockRenderContext;
}) {
  return (
    <section className="rudra-carousel">
      {block.title ? <h3 className="rudra-carousel__title">{block.title}</h3> : null}
      {/* Scrolls with CSS overflow rather than JavaScript, so the whole
          component still needs no client bundle. */}
      <div className="rudra-carousel__track">
        {block.items.map((reference) => (
          <ProductCard key={reference.sku} reference={reference} context={context} />
        ))}
      </div>
    </section>
  );
}

export function BannerRenderer({ block }: { block: BannerBlock }) {
  return (
    <aside className="rudra-banner" data-rudra-banner-tone={block.tone}>
      <span className="rudra-banner__text">{block.text}</span>
      {block.ctaLabel ? <span className="rudra-banner__cta">{block.ctaLabel}</span> : null}
    </aside>
  );
}

export function CopyRenderer({ block }: { block: CopyBlock }) {
  return (
    <section className="rudra-copy">
      {block.title ? <h3 className="rudra-copy__title">{block.title}</h3> : null}
      <p className="rudra-copy__body">{block.body}</p>
    </section>
  );
}
