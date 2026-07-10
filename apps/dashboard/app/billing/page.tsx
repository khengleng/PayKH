'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle } from '@/components/ui';
import { api } from '@/lib/api';

interface Plan { id: string; name: string; monthly_quota: number; price_usd_cents: number }
interface BillingOverview {
  organization_id: string;
  status: string;
  plan: Plan | null;
  usage: {
    paid_count: number; quota: number; remaining: number | null;
    usage_percent: number | null; warning_level: number | null; plan_name: string;
    period_start: string;
  };
}
interface Invoice { id: string; amount_usd_cents: number; status: string; period_start: string; created_at: string }

export default function BillingPage() {
  return <Shell>{({ me }) => <BillingContent orgId={me.organizations[0]?.id} />}</Shell>;
}

function BillingContent({ orgId }: { orgId?: string }) {
  const [ov, setOv] = useState<BillingOverview | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    const [o, p, inv] = await Promise.all([
      api<BillingOverview>(`/billing?org_id=${orgId}`),
      api<Plan[]>(`/billing/plans`),
      api<Invoice[]>(`/billing/${orgId}/invoices`),
    ]);
    setOv(o); setPlans(p); setInvoices(inv);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const changePlan = async (planId: string) => {
    if (!orgId || !confirm('Switch to this plan?')) return;
    setBusy(true);
    try { await api(`/billing/${orgId}/plan`, { method: 'POST', body: { planId } }); await load(); }
    finally { setBusy(false); }
  };

  if (!ov) return <div className="text-slate-400">Loading billing…</div>;
  const u = ov.usage;
  const pct = u.usage_percent ?? 0;
  const barColor = pct >= 100 ? 'bg-red-500' : pct >= 90 ? 'bg-amber-500' : pct >= 70 ? 'bg-yellow-400' : 'bg-brand-500';

  return (
    <>
      <PageTitle title="Billing" subtitle={`Current plan: ${ov.plan?.name ?? 'Free'} · status ${ov.status}`} />

      <Card className="mb-4">
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="font-medium">Monthly usage (successful payments)</span>
          <span className="text-slate-500">
            {u.paid_count}{u.quota < 0 ? '' : ` / ${u.quota}`} {u.quota < 0 && '(unlimited)'}
          </span>
        </div>
        {u.quota >= 0 && (
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
        )}
        {u.warning_level && (
          <p className={`mt-2 text-sm ${u.warning_level >= 100 ? 'text-red-600' : 'text-amber-600'}`}>
            {u.warning_level >= 100
              ? 'Quota reached — new payments are blocked (HTTP 402). Upgrade to continue.'
              : `You've used ${pct}% of your monthly quota.`}
          </p>
        )}
      </Card>

      <h2 className="mb-2 mt-6 text-lg font-semibold">Plans</h2>
      <div className="grid gap-4 md:grid-cols-4">
        {plans.map((p) => {
          const current = ov.plan?.id === p.id;
          return (
            <Card key={p.id} className={current ? 'ring-2 ring-brand-500' : ''}>
              <div className="font-semibold">{p.name}</div>
              <div className="mt-1 text-2xl font-bold">
                ${(p.price_usd_cents / 100).toFixed(0)}<span className="text-sm font-normal text-slate-400">/mo</span>
              </div>
              <div className="mt-1 text-sm text-slate-500">
                {p.monthly_quota < 0 ? 'Unlimited' : `${p.monthly_quota.toLocaleString()}`} payments/mo
              </div>
              <div className="mt-3">
                {current ? (
                  <span className="text-sm font-medium text-brand-600">Current plan</span>
                ) : (
                  <Button variant="secondary" onClick={() => changePlan(p.id)} disabled={busy}>Switch</Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <h2 className="mb-2 mt-6 text-lg font-semibold">Invoices</h2>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-slate-500">
            <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Period</th><th className="px-4 py-3">Status</th></tr>
          </thead>
          <tbody>
            {invoices.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">No invoices</td></tr>}
            {invoices.map((i) => (
              <tr key={i.id} className="border-b border-slate-50">
                <td className="px-4 py-3">{new Date(i.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3">${(i.amount_usd_cents / 100).toFixed(2)}</td>
                <td className="px-4 py-3 text-slate-500">{new Date(i.period_start).toLocaleDateString()}</td>
                <td className="px-4 py-3">{i.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
