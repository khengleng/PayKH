import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PayKH Dashboard',
  description: 'Manage your Bakong KHQR payments, API keys, and stores.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
