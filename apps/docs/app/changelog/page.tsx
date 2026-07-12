import { PageNav } from '../../components/ui';

export const metadata = { title: 'Changelog' };

const RELEASES = [
  {
    date: '2026-07',
    tag: 'Platform',
    items: [
      'Payment links & invoices, static QR + POS, and hosted customer receipts.',
      'Khmer / English localization across checkout and dashboard.',
      'Persisted double-entry ledger with reconciliation, merchant payouts, and per-plan default fees.',
      'Operational alerting (Telegram / email / Sentry) and in-app system settings for integration keys.',
    ],
  },
  {
    date: '2026-07',
    tag: 'API v1',
    items: [
      'Payments: create, retrieve, list, cancel, refund (full & partial), simulate (test mode).',
      'Signed webhooks with retries, delivery logs, resend, and secret rotation.',
      'Idempotency-Key support on payment creation.',
      'Redis-backed rate limiting and MFA (TOTP).',
      'Official SDKs for Node.js, PHP, and Python.',
    ],
  },
];

export default function Page() {
  return (
    <>
      <h1>Changelog</h1>
      <p>Notable changes to the PayKH API and platform. The API is versioned under <code>/v1</code>; breaking changes ship under a new version.</p>

      {RELEASES.map((r, i) => (
        <div key={i} className="not-prose mb-8 mt-6 border-l-2 border-brand-100 pl-5">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">{r.tag}</span>
            <span className="text-sm text-slate-400">{r.date}</span>
          </div>
          <ul className="list-disc space-y-1.5 pl-5 text-[15px] text-slate-700">
            {r.items.map((it, j) => <li key={j}>{it}</li>)}
          </ul>
        </div>
      ))}

      <PageNav prev={{ title: 'SDKs', href: '/sdks' }} />
    </>
  );
}
