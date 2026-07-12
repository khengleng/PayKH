'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Card, PageTitle } from '@/components/ui';
import { AreaChart } from '@/components/Charts';
import { api } from '@/lib/api';

interface Series { total_revenue: string; total_count: number; avg_order_value: string; daily: { date: string; revenue: number; count: number }[] }
interface Forecast { trailing_30d_revenue: string; daily_trend: string; moving_avg_7d: string; projected_next_period: string; forecast: { date: string; projected_revenue: string }[] }
interface Exec { stores: number; revenue: string; revenue_growth_pct: number | null; paid_count: number; success_rate: number; customers: number; outstanding_points: number; referral_commissions: string; game_plays: number; top_stores: { store: string; revenue: string; count: number }[]; empty?: boolean }

export default function AnalyticsPage() {
  return <Shell>{({ activeStore }) => (activeStore ? <Content storeId={activeStore.id} orgId={activeStore.organization_id} /> : <Card className="text-slate-600">Create a store first.</Card>)}</Shell>;
}

function Content({ storeId, orgId }: { storeId: string; orgId: string }) {
  const [series, setSeries] = useState<Series | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [exec, setExec] = useState<Exec | null>(null);

  const load = useCallback(async () => {
    setSeries(await api<Series>(`/dashboard/stores/${storeId}/analytics/timeseries`));
    setForecast(await api<Forecast>(`/dashboard/stores/${storeId}/analytics/forecast?days=7`));
    setExec(await api<Exec>(`/dashboard/orgs/${orgId}/analytics/executive`));
  }, [storeId, orgId]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <PageTitle title="Analytics" subtitle="Revenue trends, a 7-day forecast, and an org-level executive summary." />

      {exec && !exec.empty && (
        <Card className="mb-6">
          <h3 className="mb-3 font-semibold">Executive summary — last 30 days</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Revenue" value={`$${exec.revenue}`} sub={exec.revenue_growth_pct != null ? `${exec.revenue_growth_pct >= 0 ? '▲' : '▼'} ${Math.abs(exec.revenue_growth_pct)}% vs prev` : undefined} up={(exec.revenue_growth_pct ?? 0) >= 0} />
            <Metric label="Success rate" value={`${exec.success_rate}%`} sub={`${exec.paid_count} paid`} />
            <Metric label="Customers" value={exec.customers} />
            <Metric label="Points liability" value={exec.outstanding_points} />
            <Metric label="Referral commission" value={`$${exec.referral_commissions}`} />
            <Metric label="Game plays" value={exec.game_plays} />
            <Metric label="Stores" value={exec.stores} />
          </div>
          {exec.top_stores.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 text-sm font-medium text-slate-600">Top stores</div>
              <ul className="divide-y divide-slate-100 text-sm">
                {exec.top_stores.map((s) => <li key={s.store} className="flex justify-between py-1.5"><span>{s.store}</span><span>${s.revenue} <span className="text-xs text-slate-400">· {s.count}</span></span></li>)}
              </ul>
            </div>
          )}
        </Card>
      )}

      {series && (
        <Card className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Revenue — last 30 days + forecast</h3>
            <div className="text-sm text-slate-500">Total ${series.total_revenue} · AOV ${series.avg_order_value}</div>
          </div>
          <AreaChart
            data={series.daily.map((d) => ({ label: d.date.slice(5), value: d.revenue }))}
            forecast={(forecast?.forecast ?? []).map((f) => ({ label: f.date.slice(5), value: Number(f.projected_revenue) }))}
          />
          {forecast && (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
              <Metric label="7d moving avg" value={`$${forecast.moving_avg_7d}`} />
              <Metric label="Daily trend" value={`${Number(forecast.daily_trend) >= 0 ? '+' : ''}${forecast.daily_trend}`} up={Number(forecast.daily_trend) >= 0} />
              <Metric label="Projected next 7d" value={`$${forecast.projected_next_period}`} />
              <Metric label="Trailing 30d" value={`$${forecast.trailing_30d_revenue}`} />
            </div>
          )}
        </Card>
      )}

      <MonetizationCard storeId={storeId} />
    </>
  );
}

interface Ledger { fee_bps: number; paid_count: number; net_earnings: string; entries: { account: string; type: string; amount: string }[]; revenue_share_breakdown: { partner: string; share_bps: number; amount: string }[] }
interface Share { id: string; partner_name: string; share_bps: number; active: boolean }

function MonetizationCard({ storeId }: { storeId: string }) {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [name, setName] = useState('');
  const [pct, setPct] = useState('10');

  const load = useCallback(async () => {
    setLedger(await api<Ledger>(`/dashboard/stores/${storeId}/ledger`));
    setShares(await api<Share[]>(`/dashboard/stores/${storeId}/revenue-shares`));
  }, [storeId]);
  useEffect(() => { load(); }, [load]);

  const add = async () => { if (!name) return; await api(`/dashboard/stores/${storeId}/revenue-shares`, { method: 'POST', body: { partnerName: name, shareBps: Math.round(Number(pct) * 100) } }); setName(''); await load(); };
  const del = async (id: string) => { await api(`/dashboard/revenue-shares/${id}`, { method: 'DELETE' }); await load(); };

  return (
    <Card className="mb-6">
      <h3 className="mb-1 font-semibold">Accounting & revenue share</h3>
      <p className="mb-3 text-sm text-slate-500">Derived P&amp;L over the last 30 days (fee {ledger ? (ledger.fee_bps / 100) : 0}%).</p>
      {ledger && (
        <>
          <table className="mb-3 w-full text-sm">
            <tbody>
              {ledger.entries.map((e) => (
                <tr key={e.account} className="border-b border-slate-50">
                  <td className="py-1.5">{e.account}</td>
                  <td className={`py-1.5 text-right ${e.type === 'credit' ? 'text-emerald-600' : 'text-red-500'}`}>{e.type === 'credit' ? '+' : '−'}${e.amount}</td>
                </tr>
              ))}
              <tr className="font-semibold"><td className="py-2">Net earnings</td><td className="py-2 text-right">${ledger.net_earnings}</td></tr>
            </tbody>
          </table>
          {ledger.revenue_share_breakdown.length > 0 && (
            <div className="mb-3 text-xs text-slate-500">Revenue share: {ledger.revenue_share_breakdown.map((r) => `${r.partner} $${r.amount}`).join(' · ')}</div>
          )}
        </>
      )}
      <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        <label className="text-sm"><div className="mb-1 text-xs text-slate-600">Partner</div><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Partners" className="w-40 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></label>
        <label className="text-sm"><div className="mb-1 text-xs text-slate-600">% of fees</div><input value={pct} onChange={(e) => setPct(e.target.value)} className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></label>
        <button onClick={add} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white">Add partner</button>
        {shares.map((s) => <span key={s.id} className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs">{s.partner_name} {s.share_bps / 100}% <button onClick={() => del(s.id)} className="text-red-500">×</button></span>)}
      </div>
    </Card>
  );
}

function Metric({ label, value, sub, up }: { label: string; value: React.ReactNode; sub?: string; up?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <div className={`text-xs ${up ? 'text-emerald-600' : 'text-red-500'}`}>{sub}</div>}
    </div>
  );
}
