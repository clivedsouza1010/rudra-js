import type { Product } from '@rudra/core';
import { SHOPPERS, type Shopper } from '@/data/shoppers';

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e3e6ec',
  borderRadius: 12,
  padding: 20,
};

/**
 * The static half of the product page — the part that would be
 * server-rendered in any architecture. It is identical on the SSR and CSR
 * routes so the benchmark isolates the recommendation strategy and nothing else.
 */
export function ProductDetail({ product }: { product: Product }) {
  return (
    <section style={{ ...card, display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 28 }}>
      {product.imageUrl ? (
        <img
          src={product.imageUrl}
          alt={product.title}
          style={{ width: 220, height: 220, borderRadius: 10, objectFit: 'cover' }}
        />
      ) : null}
      <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: '0.78rem', letterSpacing: '0.05em', textTransform: 'uppercase', color: '#646b78' }}>
          {product.category}
        </span>
        <h1 style={{ margin: 0, fontSize: '1.6rem', lineHeight: 1.2 }}>{product.title}</h1>
        <strong style={{ fontSize: '1.25rem' }}>
          {product.currency} {product.price.toFixed(2)}
        </strong>
        {product.rating !== undefined ? (
          <span style={{ color: '#646b78', fontSize: '0.9rem' }}>{product.rating.toFixed(1)} / 5</span>
        ) : null}
        <span style={{ color: '#646b78', fontSize: '0.86rem' }}>{product.tags.join(' · ')}</span>
      </div>
    </section>
  );
}

/** Lets you flip between sample tracking payloads without editing code. */
export function ShopperSwitcher({
  active,
  sku,
  mode,
}: {
  active: Shopper;
  sku: string;
  mode: 'ssr' | 'csr';
}) {
  const base = mode === 'ssr' ? '/product' : '/product-csr';
  const other = mode === 'ssr' ? '/product-csr' : '/product';

  return (
    <section style={{ ...card, marginBottom: 28 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {SHOPPERS.map((shopper) => {
          const isActive = shopper.id === active.id;
          return (
            <a
              key={shopper.id}
              href={`${base}/${sku}?shopper=${shopper.id}`}
              style={{
                padding: '6px 12px',
                borderRadius: 999,
                fontSize: '0.85rem',
                textDecoration: 'none',
                border: `1px solid ${isActive ? '#1a5cff' : '#e3e6ec'}`,
                background: isActive ? '#1a5cff' : '#fff',
                color: isActive ? '#fff' : '#16181d',
              }}
            >
              {shopper.label}
            </a>
          );
        })}
      </div>
      <p style={{ margin: '0 0 12px', color: '#646b78', fontSize: '0.88rem', lineHeight: 1.5 }}>
        {active.description}
      </p>
      <a href={`${other}/${sku}?shopper=${active.id}`} style={{ fontSize: '0.85rem', color: '#1a5cff' }}>
        {mode === 'ssr'
          ? 'Compare against the client-rendered control →'
          : '← Back to the server-rendered version'}
      </a>
    </section>
  );
}
