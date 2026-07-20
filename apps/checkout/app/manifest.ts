import type { MetadataRoute } from 'next';

/** PWA manifest so the loyalty mini-app installs as a standalone app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PayKH Rewards',
    short_name: 'PayKH',
    description: 'Your loyalty points and rewards across every PayKH merchant.',
    start_url: '/m',
    scope: '/m',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f8fafc',
    theme_color: '#4f46e5',
    icons: [
      { src: '/miniapp-icon?size=192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/miniapp-icon?size=512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/miniapp-icon?size=512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
