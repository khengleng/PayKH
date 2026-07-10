'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, tokenStore } from '@/lib/api';
import { Button, Card, Stat, StatusBadge } from '@/components/ui';

interface Org { id: string; name: string; status: string; plan: string; members: number; stores: number; month_paid: number }
interface Metrics { organizations: number; suspended: number; stores: number; total_payments: number; paid_count: number; paid_volume: string; success_rate: number }

export default function AdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [email, setEmail] = useState('');
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [verifs, setVerifs] = useState<any[]>([]);
  const [search, setSearch] = useState('');

  const loadData = useCallback(async () => {
    const [m, o, v] = await Promise.all([
      api<Metrics>('/admin/metrics'),
      api<Org[]>(`/admin/orgs${search ? `?search=${encodeURIComponent(search)}` : ''}`),
      api<any[]>('/admin/verifications'),
    ]);
    setMetrics(m); setOrgs(o); setVerifs(v);
  }, [search]);

  const reviewVerif = async (orgId: string, approve: boolean) => {
    if (!approve) {
      const reason = prompt('Rejection reason?') || 'Not specified';
      await api(`/admin/verifications/${orgId}/reject`, { method: 'POST', body: { reason } });
    } else {
      await api(`/admin/verifications/${orgId}/approve`, { method: 'POST' });
    }
    await loadData();
  };

  useEffect(() => {
    if (!tokenStore.get()) { router.replace('/login?next=/admin'); return; }
    (async () => {
      try {
        const me = await api<{ is_platform_admin: boolean; email: string }>('/admin/me');
        setEmail(me.email);
        if (me.is_platform_admin) { setAllowed(true); await loadData(); }
      } catch { /* not admin */ }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const suspend = async (id: string, on: boolean) => {
    await api(`/admin/orgs/${id}/${on ? 'suspend' : 'reactivate'}`, { method: 'POST' });
    await loadData();
  };

  if (!ready) return <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>;
  if (!allowed) return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="max-w-sm text-center">
        <h1 className="text-lg font-semibold">Admin console</h1>
        <p className="mt-2 text-sm text-slate-500">{email || 'This account'} is not a platform admin.</p>
        <div className="mt-4"><Button variant="secondary" onClick={() => router.replace('/overview')}>Back to dashboard</Button></div>
      </Card>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Platform Admin</h1>
          <p className="text-sm text-slate-500">{email}</p>
        </div>
        <Button variant="secondary" onClick={() => { tokenStore.clear(); router.replace('/login'); }}>Sign out</Button>
      </div>

      {metrics && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Merchants" value={metrics.organizations} hint={`${metrics.suspended} suspended`} />
          <Stat label="Stores" value={metrics.stores} />
          <Stat label="Payments" value={metrics.total_payments} hint={`${metrics.success_rate}% success`} />
          <Stat label="Paid volume" value={`$${metrics.paid_volume}`} />
        </div>
      )}

      {verifs.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-lg font-semibold">Verifications pending review ({verifs.length})</h2>
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 text-left text-slate-500">
                <tr><th className="px-4 py-3">Organization</th><th className="px-4 py-3">Legal name</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Contact</th><th className="px-4 py-3"></th></tr>
              </thead>
              <tbody>
                {verifs.map((v) => (
                  <tr key={v.organization_id} className="border-b border-slate-50">
                    <td className="px-4 py-3">{v.organization_name}</td>
                    <td className="px-4 py-3">{v.legal_name}</td>
                    <td className="px-4 py-3 text-slate-500">{v.business_type}</td>
                    <td className="px-4 py-3 text-slate-500">{v.contact_name}{v.contact_phone ? ` · ${v.contact_phone}` : ''}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => reviewVerif(v.organization_id, true)} className="text-emerald-600 hover:underline">Approve</button>
                        <button onClick={() => reviewVerif(v.organization_id, false)} className="text-red-600 hover:underline">Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      <div className="mb-3 mt-6 flex items-center gap-2">
        <h2 className="text-lg font-semibold">Merchants</h2>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="ml-auto rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
        <Button variant="secondary" onClick={loadData}>Search</Button>
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-slate-500">
            <tr><th className="px-4 py-3">Organization</th><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Members</th><th className="px-4 py-3">Stores</th><th className="px-4 py-3">Paid (mo)</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} className="border-b border-slate-50">
                <td className="px-4 py-3">{o.name}<div className="font-mono text-[10px] text-slate-400">{o.id}</div></td>
                <td className="px-4 py-3">{o.plan}</td>
                <td className="px-4 py-3">{o.members}</td>
                <td className="px-4 py-3">{o.stores}</td>
                <td className="px-4 py-3">{o.month_paid}</td>
                <td className="px-4 py-3">{o.status === 'suspended' ? <StatusBadge status="failed" /> : <StatusBadge status="paid" />}</td>
                <td className="px-4 py-3 text-right">
                  {o.status === 'suspended'
                    ? <button onClick={() => suspend(o.id, false)} className="text-emerald-600 hover:underline">Reactivate</button>
                    : <button onClick={() => suspend(o.id, true)} className="text-red-600 hover:underline">Suspend</button>}
                </td>
              </tr>
            ))}
            {orgs.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No merchants</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
