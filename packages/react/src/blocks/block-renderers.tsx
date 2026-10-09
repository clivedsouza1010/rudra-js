import type {
  BannerBlock,
  BundleBlock,
  CarouselBlock,
  CopyBlock,
  GridBlock,
  HeroBlock,
  Product,
} from '@rudra-js/core';
import { sellableProduct, type BlockRenderContext } from '../render-context.js';
import { ProductCard } from './product-card.js';

export function HeroRenderer({
  block,
  context,
}: {
  block: HeroBlock;
  context: BlockRenderContext;
}) {
  const product = block.sku ? sellableProduct(context.products, block.sku) : undefined;

  return (
    <section className="rudra-hero">
      {block.headline ? <h3 className="rudra-hero__headline">{block.headline}</h3> : null}
      {block.body ? <p className="rudra-hero__body">{block.body}</p> : null}
      {product ? (
        <a
          className="rudra-hero__link"
          href={context.hrefForSku(product.sku)}
          data-rudra-sku={product.sku}
        >
          {product.title} <span className="rudra-hero__price">{context.formatPrice(product)}</span>{' '}
          {block.ctaLabel ? <span className="rudra-hero__cta">{block.ctaLabel}</span> : null}
        </a>
      ) : null}
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
      <span className="rudra-banner__text">{block.text}</span>{' '}
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
    const product = sellableProduct(context.products, sku);
    if (!product) return null;
    products.push(product);
  }

  return (
    <section className="rudra-bundle">
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
