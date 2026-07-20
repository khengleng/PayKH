import type { Metadata, Viewport } from 'next';
import './miniapp.css';

export const metadata: Metadata = {
  title: 'PayKH Rewards',
  // Treat as a standalone app when added to the home screen (iOS/Android).
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'PayKH Rewards' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#4f46e5',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover', // draw under the notch; we pad with safe-area insets
};

export default function MiniAppLayout({ children }: { children: React.ReactNode }) {
  return <div className="miniapp-root">{children}</div>;
}
