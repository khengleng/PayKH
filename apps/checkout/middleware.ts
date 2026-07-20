import { NextResponse, type NextRequest } from 'next/server';

/**
 * The dedicated mobile domain (mobile.paykh.cambobia.com) serves ONLY the loyalty
 * mini-app — keeping it cleanly separate from the public checkout content
 * (payment pages, wallet, shop) that also lives in this app on checkout.*.
 * Any other path on mobile.* is sent to the mini-app.
 */
export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  if (host.startsWith('mobile.')) {
    const p = req.nextUrl.pathname;
    const isMiniApp =
      p === '/m' ||
      p.startsWith('/m/') ||
      p.startsWith('/miniapp-icon') ||
      p === '/manifest.webmanifest' ||
      p === '/apple-icon' ||
      p === '/icon' ||
      p === '/favicon.ico';
    if (!isMiniApp) {
      const url = req.nextUrl.clone();
      url.pathname = '/m';
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals/assets.
  matcher: ['/((?!_next).*)'],
};
