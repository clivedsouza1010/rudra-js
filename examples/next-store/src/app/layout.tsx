import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'rudra-js — AI-driven SSR components',
  description:
    'Reference storefront for server-rendered components generated in real time from user tracking data.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: '#f7f8fa',
          color: '#16181d',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <main style={{ maxWidth: 1040, margin: '0 auto', padding: '32px 20px 64px' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
