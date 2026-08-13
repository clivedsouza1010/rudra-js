'use client';

import { useEffect, useState } from 'react';
import type { ComponentSpec, Product } from '@rudra/core';
import { RudraComponent } from '@rudra/react';

/**
 * The client-side rendering control arm.
 *
 * This is the prevailing pattern the manuscript compares against: the page
 * ships with a placeholder, JavaScript loads and hydrates, a request goes out
 * to a personalisation endpoint, and only then does the recommendation content
 * appear. The visible consequence is "pop-in" — and because the content never
 * exists in the server response, a crawler never sees it.
 *
 * It renders the exact same `RudraComponent` as the SSR arm. `@rudra/react`
 * imports only types from core, so the renderer runs unchanged on the client;
 * that keeps the markup identical and isolates the timing difference.
 */

const placeholderStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e3e6ec',
  borderRadius: 12,
  padding: 20,
  minHeight: 320,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#646b78',
  fontSize: '0.9rem',
};

export function CsrRecommendations({
  sku,
  shopperId,
  products,
}: {
  sku: string;
  shopperId: string;
  products: Product[];
}) {
  const [spec, setSpec] = useState<ComponentSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const startedAt = performance.now();

    const query = new URLSearchParams({ sku, shopper: shopperId });
    fetch(`/api/component?${query.toString()}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`request failed: ${response.status}`);
        return response.json() as Promise<ComponentSpec>;
      })
      .then((data) => {
        setSpec(data);
        setElapsedMs(Math.round(performance.now() - startedAt));
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'unknown error');
      });

    return () => controller.abort();
  }, [sku, shopperId]);

  if (error) {
    return (
      <div style={placeholderStyle} data-rudra-csr="error">
        Could not load recommendations: {error}
      </div>
    );
  }

  if (!spec) {
    // The reserved-space placeholder every CSR rail needs in order to avoid
    // layout shift — and which still leaves the region empty at first paint.
    return (
      <div style={placeholderStyle} data-rudra-csr="pending">
        Loading recommendations…
      </div>
    );
  }

  return (
    <>
      <RudraComponent
        spec={spec}
        products={products}
        showRationale
        style={{ background: '#fff', border: '1px solid #e3e6ec', borderRadius: 12, padding: 20 }}
      />
      <p
        style={{ marginTop: 20, fontSize: '0.78rem', color: '#646b78', fontFamily: 'ui-monospace, monospace' }}
        data-rudra-csr="ready"
        data-rudra-csr-elapsed-ms={elapsedMs ?? undefined}
      >
        client-rendered after hydration · source={spec.source} · server {spec.latencyMs}ms · round trip{' '}
        {elapsedMs}ms
      </p>
    </>
  );
}
