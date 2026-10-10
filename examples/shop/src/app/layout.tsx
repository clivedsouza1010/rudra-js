import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'rudra-js demo shop',
  description:
    'A demo shop for rudra-js, an open-source TypeScript library. The products and prices are made up.',
  robots: { index: false, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <p>
          Demo of rudra-js, an open-source TypeScript library.{' '}
          <a href="https://rudrajs.com">rudrajs.com</a> ·{' '}
          <a href="https://github.com/clivedsouza1010/rudra-js">GitHub</a>
        </p>
        {children}
      </body>
    </html>
  );
}
