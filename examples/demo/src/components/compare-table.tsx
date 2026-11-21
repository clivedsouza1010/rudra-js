import type { ReactNode } from 'react';
import type { Product, ProductReference } from '@rudra-js/core';
import type { BlockRenderContext } from '@rudra-js/react';
import { detailsFor } from '../fixtures/product-details';
import { Stars } from './stars';

interface Column {
  product: Product;
  isCurrent: boolean;
}

const ROWS: { label: string; value: (column: Column, context: BlockRenderContext) => ReactNode }[] =
  [
    { label: 'Price', value: ({ product }, context) => context.formatPrice(product) },
    {
      label: 'Rating',
      value: ({ product }) =>
        product.rating !== undefined && product.rating >= 1 ? (
          <>
            <Stars rating={product.rating} /> {product.rating.toFixed(1)}
          </>
        ) : (
          'No ratings yet'
        ),
    },
    { label: 'Brand', value: ({ product }) => detailsFor(product).brand },
    { label: 'Material', value: ({ product }) => detailsFor(product).specs[0]?.[1] },
    { label: 'Weight', value: ({ product }) => detailsFor(product).specs[1]?.[1] },
  ];

export function CompareTable({
  items,
  context,
  current,
}: {
  items: readonly ProductReference[];
  context: BlockRenderContext;
  current: Product;
}) {
  const picked = items.flatMap((item) => {
    const product = context.products.get(item.sku);
    return product && product.isInStock !== false ? [{ product, isCurrent: false }] : [];
  });
  if (picked.length === 0) return null;

  const columns: Column[] = [{ product: current, isCurrent: true }, ...picked];

  return (
    <div className="compare">
      <table className="compare__table">
        <thead>
          <tr>
            <td />
            {columns.map((column) => (
              <th key={column.product.sku} scope="col" className="compare__product">
                {column.isCurrent ? <span className="compare__this">This item</span> : null}
                <a
                  href={context.hrefForSku(column.product.sku)}
                  data-rudra-sku={column.isCurrent ? undefined : column.product.sku}
                >
                  {column.product.imageUrl ? (
                    <img
                      src={column.product.imageUrl}
                      alt=""
                      width={400}
                      height={300}
                      loading="lazy"
                    />
                  ) : null}
                  <span className="compare__title">{column.product.title}</span>
                </a>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {columns.map((column) => (
                <td key={column.product.sku}>{row.value(column, context)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
