import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Larchmere Outfitters, a rudra-js demo',
  description:
    'A demo of rudra-js, an open-source TypeScript library, on a made-up outdoor store. The products and prices are made up.',
  robots: { index: false, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
