export interface NavItem {
  title: string;
  href: string;
  keywords?: string;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Single source of truth for the sidebar + client-side search. */
export const NAV: NavGroup[] = [
  {
    label: 'Get started',
    items: [
      { title: 'Introduction', href: '/', keywords: 'overview home paykh bakong khqr gateway' },
      { title: 'Quickstart', href: '/quickstart', keywords: 'first payment curl 5 minutes hello world' },
      { title: 'Authentication', href: '/authentication', keywords: 'api key bk_test bk_live bearer secret' },
      { title: 'Test mode & sandbox', href: '/testing', keywords: 'simulate mock sandbox test bk_test' },
    ],
  },
  {
    label: 'Core concepts',
    items: [
      { title: 'Payments', href: '/payments', keywords: 'create khqr charge status lifecycle state machine' },
      { title: 'Payment links & invoices', href: '/payment-links', keywords: 'link invoice hosted no-code' },
      { title: 'Refunds', href: '/refunds', keywords: 'refund partial reverse' },
      { title: 'Webhooks', href: '/webhooks', keywords: 'events signature hmac callback notifications' },
      { title: 'Errors', href: '/errors', keywords: 'error codes http status envelope idempotency' },
    ],
  },
  {
    label: 'Reference',
    items: [
      { title: 'API reference', href: '/api-reference', keywords: 'endpoints openapi swagger schema' },
      { title: 'SDKs', href: '/sdks', keywords: 'node php python library packages' },
      { title: 'Changelog', href: '/changelog', keywords: 'releases versions updates' },
    ],
  },
];

export const FLAT_NAV: NavItem[] = NAV.flatMap((g) => g.items);
