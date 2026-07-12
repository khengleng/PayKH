import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Shell } from '../components/Shell';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'PayKH Developer Docs', template: '%s · PayKH Docs' },
  description: 'Integrate Bakong KHQR payments with the PayKH API — quickstart, guides, API reference, and SDKs.',
  icons: { icon: '/icon.svg' },
  metadataBase: new URL('https://docs.paykh.cambobia.com'),
};

export const viewport: Viewport = { themeColor: '#1e5bd6' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
