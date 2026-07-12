'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { Card, Stat, StatSkeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { Overview } from '@/lib/types';

export default function OverviewPage() {
  return (
    <Shell>
      {({ activeStore, me }) => {
        if (!activeStore) {
          return (
            <Card className="mx-auto max-w-lg text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-2xl">🏬</div>
              <h2 className="text-lg font-semibold">Let’s set up your first store</h2>
              <p className="mt-1 text-sm text-slate-500">Create a store to start accepting KHQR payments.</p>
              <Link href="/stores" className="mt-4 inline-flex rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600">Create a store →</Link>
            </Card>
          );
        }
        return <OverviewContent storeId={activeStore.id} live={activeStore.live_mode} storeName={activeStore.name} email={me.email} />;
      }}
    </Shell>
  );
}

const QUICK_ACTIONS = [
  { href: '/payments', icon: '💳', label: 'Payments', desc: 'View & refund' },
  { href: '/customers', icon: '👤', label: 'Customers', desc: 'Customer 360' },
  { href: '/campaigns', icon: '📣', label: 'Campaigns', desc: 'Run a promo' },
  { href: '/copilot', icon: '✨', label: 'AI Copilot', desc: 'Get insights' },
];

function OverviewContent({ storeId, live, storeName, email }: { storeId: string; live: boolean; storeName: string; email: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null); setError(null);
    api<Overview>(`/dashboard/stores/${storeId}/overview`).then(setData).catch((e) => setError(e.message));
  }, [storeId]);

  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; })();
  const firstName = (email ?? '').split('@')[0].split('.')[0];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight capitalize text-slate-900">{greeting}, {firstName} 👋</h1>
          <p className="mt-1 text-sm text-slate-500">Here’s how <span className="font-medium text-slate-700">{storeName}</span> is doing today.</p>
        </div>
      </div>

      {!live && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <span>🧪</span> You’re in <b>test mode</b> — payments use the mock provider. Activate live mode in <Link href="/stores" className="font-medium underline">Stores</Link>.
        </div>
      )}

      {error && <Card className="text-red-600">{error}</Card>}

      {!data ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Paid volume" value={`$${data.paid_volume}`} icon="💰" accent="emerald" hint="all time" />
            <Stat label="Paid payments" value={data.paid_count} icon="✅" accent="brand" trend={{ value: `${data.success_rate}%`, up: data.success_rate >= 80 }} hint="success rate" />
            <Stat label="This month" value={data.month_paid_count} icon="📅" accent="brand" hint="paid" />
            <Stat label="Total payments" value={data.total_payments} icon="💳" accent="slate" />
          </div>

          <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-slate-400">Payment status</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Pending" value={data.pending_count} icon="⏳" accent="amber" />
            <Stat label="Failed" value={data.failed_count} icon="⚠️" accent="red" />
            <Stat label="Expired" value={data.expired_count} icon="⌛" accent="slate" />
            <Stat label="Webhook failures" value={data.recent_webhook_failures} icon="🔔" accent={data.recent_webhook_failures > 0 ? 'red' : 'slate'} />
          </div>

          <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-slate-400">Quick actions</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {QUICK_ACTIONS.map((a) => (
              <Link key={a.href} href={a.href} className="group rounded-2xl border border-slate-200/70 bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-xl">{a.icon}</div>
                <div className="mt-3 font-semibold text-slate-900">{a.label}</div>
                <div className="text-xs text-slate-500">{a.desc}</div>
                <div className="mt-2 text-sm text-brand-600 opacity-0 transition-opacity group-hover:opacity-100">Open →</div>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
