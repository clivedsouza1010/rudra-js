import { CATALOG } from '@/data/catalog';
import { DEFAULT_SHOPPER_ID, SHOPPERS } from '@/data/shoppers';

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e3e6ec',
  borderRadius: 12,
  padding: 20,
};

export default function HomePage() {
  const featured = CATALOG.slice(0, 8);

  return (
    <>
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: '1.8rem' }}>rudra-js reference storefront</h1>
        <p style={{ margin: 0, color: '#646b78', lineHeight: 1.6, maxWidth: 720 }}>
          Every product page below renders a recommendation component that was generated for one
          shopper at request time, from that shopper&rsquo;s tracking payload. Each page has a
          client-rendered twin at <code>/product-csr/…</code> so the two strategies can be measured
          against each other.
        </p>
      </header>

      <section style={{ ...card, marginBottom: 28 }}>
        <h2 style={{ margin: '0 0 12px', fontSize: '1.05rem' }}>Sample tracking payloads</h2>
        <ul style={{ margin: 0, paddingLeft: 18, color: '#646b78', lineHeight: 1.7, fontSize: '0.92rem' }}>
          {SHOPPERS.map((shopper) => (
            <li key={shopper.id}>
              <strong style={{ color: '#16181d' }}>{shopper.label}</strong> — {shopper.description}
            </li>
          ))}
        </ul>
      </section>

      <section style={card}>
        <h2 style={{ margin: '0 0 16px', fontSize: '1.05rem' }}>Products</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: 16,
          }}
        >
          {featured.map((product) => (
            <a
              key={product.sku}
              href={`/product/${product.sku}?shopper=${DEFAULT_SHOPPER_ID}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: 12,
                border: '1px solid #e3e6ec',
                borderRadius: 10,
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt={product.title}
                  style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 6 }}
                />
              ) : null}
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{product.title}</span>
              <span style={{ fontSize: '0.85rem', color: '#646b78' }}>
                {product.currency} {product.price.toFixed(2)}
              </span>
            </a>
          ))}
        </div>
      </section>
    </>
  );
}
