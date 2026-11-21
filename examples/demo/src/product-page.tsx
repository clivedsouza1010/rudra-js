import type { ComponentSpec, Product } from '@rudra-js/core';
import {
  RudraComponent,
  defaultFormatPrice,
  extendRegistry,
  type BlockRegistry,
} from '@rudra-js/react';
import { CompareTable } from './components/compare-table';
import { ProductTop } from './components/product-top';
import { RowScroller } from './components/row-scroller';
import { Stars } from './components/stars';
import { HOME_HREF, firstSkuIn } from './components/store-header';
import { bundles, catalog, findShopper, generator, shoppers } from './demo-context';
import { SWATCHES, detailsFor, type ProductDetails } from './fixtures/product-details';
import {
  buildAlsoViewedInput,
  buildCompareInput,
  buildMoreToConsiderInput,
  buildTrackingInput,
} from './fixtures/tracking-input';

function sourceNote(spec: ComponentSpec, credit: string): string {
  return spec.source === 'fallback' ? 'No model answer here, so rudra-js built all of it' : credit;
}

function RecommendationRow({
  id,
  heading,
  spec,
  hrefForSku,
  registry,
  credit = 'Layout and copy by the model. Products and the line under each by rudra-js',
}: {
  id: string;
  heading: string;
  spec: ComponentSpec;
  hrefForSku: (sku: string) => string;
  registry?: BlockRegistry;
  credit?: string;
}) {
  if (spec.blocks.length === 0) return null;

  return (
    <section className="store-row" aria-labelledby={id}>
      <div className="store-row__head">
        <h2 className="store-row__title" id={id}>
          {heading}
        </h2>
        <p className="store-row__source">{sourceNote(spec, credit)}</p>
      </div>
      <RowScroller label={heading}>
        <RudraComponent
          spec={spec}
          products={catalog}
          bundles={bundles}
          locale="en-US"
          hrefForSku={hrefForSku}
          {...(registry ? { registry } : {})}
        />
      </RowScroller>
    </section>
  );
}

function AboutThisItem({ product, details }: { product: Product; details: ProductDetails }) {
  return (
    <section className="about" aria-labelledby="about-heading">
      <h2 className="section-title" id="about-heading">
        About this item
      </h2>
      <div className="about__columns">
        <div>
          <h3 className="about__heading">Highlights</h3>
          <ul className="about__highlights">
            {details.highlights.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <h3 className="about__heading">Description</h3>
          <p className="about__description">{details.description}</p>
        </div>
        <div>
          <h3 className="about__heading">Specifications</h3>
          <dl className="specs">
            {[['Brand', details.brand], ['Category', product.category], ...details.specs].map(
              ([label, value]) => (
                <div className="specs__row" key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ),
            )}
          </dl>
          <h3 className="about__heading">Shipping and returns</h3>
          <p className="about__description">
            Free standard shipping on orders over $50. Return it within 90 days, used or not.
          </p>
        </div>
      </div>
    </section>
  );
}

function Reviews({ product, details }: { product: Product; details: ProductDetails }) {
  const rating = product.rating ?? 0;

  return (
    <section className="reviews" id="reviews" aria-labelledby="reviews-heading">
      <h2 className="section-title" id="reviews-heading">
        Ratings and reviews
      </h2>
      {details.reviewCount === 0 ? (
        <p className="reviews__empty">No ratings or reviews yet.</p>
      ) : (
        <div className="reviews__layout">
          <div className="reviews__summary">
            <p className="reviews__score">{rating.toFixed(1)}</p>
            <Stars rating={rating} />
            <p className="reviews__count">{details.reviewCount} ratings</p>
            <ol className="reviews__bars" aria-label="How the ratings split">
              {details.ratingCounts.map((count, index) => (
                <li key={5 - index}>
                  <span>
                    {5 - index} {index === 4 ? 'star' : 'stars'}
                  </span>
                  <span className="reviews__bar">
                    <span
                      className="reviews__bar-fill"
                      style={{ width: `${(count / details.reviewCount) * 100}%` }}
                    />
                  </span>
                  <span>{count}</span>
                </li>
              ))}
            </ol>
          </div>
          <ul className="reviews__list">
            {details.reviews.map((review) => (
              <li className="review" key={review.author + review.title}>
                <Stars rating={review.rating} />
                <h3 className="review__title">{review.title}</h3>
                <p className="review__body">{review.body}</p>
                <p className="review__meta">
                  {review.author}, {review.when}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export async function ProductPageContent({
  sku,
  shopperId,
  linkQuery = shopperId ? `?shopper=${encodeURIComponent(shopperId)}` : '',
}: {
  sku: string;
  shopperId: string | undefined;
  linkQuery?: string;
}) {
  const product = catalog.find((candidate) => candidate.sku === sku);
  if (!product) return null;

  const shopper = findShopper(shopperId);
  const details = detailsFor(product);
  const [discover, compare, consider, alsoViewed] = await Promise.all([
    generator.generate(buildTrackingInput(shopper, product.sku, catalog, bundles)),
    generator.generate(buildCompareInput(shopper, product, catalog, bundles)),
    generator.generate(buildMoreToConsiderInput(shopper, product, catalog, bundles)),
    generator.generate(buildAlsoViewedInput(shopper, product, catalog, bundles, shoppers)),
  ]);

  const compareRegistry = extendRegistry({
    grid: ({ block, context }) => (
      <CompareTable items={block.items} context={context} current={product} />
    ),
    carousel: ({ block, context }) => (
      <CompareTable items={block.items} context={context} current={product} />
    ),
  });
  const categoryHref = `/product/${firstSkuIn(product.category) ?? product.sku}${linkQuery}`;
  const hrefForSku = (target: string) => `/product/${encodeURIComponent(target)}${linkQuery}`;

  return (
    <main className="page" id="main">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <ol>
          <li>
            <a href={`${HOME_HREF}${linkQuery}`}>Home</a>
          </li>
          <li>{details.department}</li>
          <li>
            <a href={categoryHref}>{product.category}</a>
          </li>
        </ol>
      </nav>

      <ProductTop
        sku={product.sku}
        title={product.title}
        brand={details.brand}
        price={defaultFormatPrice(product, 'en-US')}
        rating={product.rating ?? 0}
        reviewCount={details.reviewCount}
        swatches={details.swatches.map((swatch) => ({
          ...swatch,
          tone: SWATCHES.findIndex((known) => known.name === swatch.name) + 1,
        }))}
        isInStock={product.isInStock}
      />

      <RecommendationRow
        id="discover-more"
        heading="Discover more options"
        spec={discover}
        hrefForSku={hrefForSku}
      />
      <AboutThisItem product={product} details={details} />
      <RecommendationRow
        id="compare-similar"
        heading="Compare similar items"
        spec={compare}
        hrefForSku={hrefForSku}
        registry={compareRegistry}
        credit="Copy by the model. Products by rudra-js"
      />
      <RecommendationRow
        id="more-to-consider"
        heading="More to consider"
        spec={consider}
        hrefForSku={hrefForSku}
      />
      <Reviews product={product} details={details} />
      <RecommendationRow
        id="customers-also-viewed"
        heading="Customers also viewed"
        spec={alsoViewed}
        hrefForSku={hrefForSku}
      />
    </main>
  );
}
