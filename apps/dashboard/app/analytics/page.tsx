'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Card, PageTitle } from '@/components/ui';
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
          <Chart history={series.daily} forecast={forecast?.forecast ?? []} />
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
    </>
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

function Chart({ history, forecast }: { history: { date: string; revenue: number }[]; forecast: { date: string; projected_revenue: string }[] }) {
  const points = [...history.map((h) => ({ v: h.revenue, f: false })), ...forecast.map((f) => ({ v: Number(f.projected_revenue), f: true }))];
  if (points.length === 0) return <p className="text-sm text-slate-400">No data yet.</p>;
  const max = Math.max(...points.map((p) => p.v), 1);
  const W = 100, H = 40, bw = W / points.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 160 }} preserveAspectRatio="none">
      {points.map((p, i) => {
        const h = (p.v / max) * (H - 2);
        return <rect key={i} x={i * bw + 0.4} y={H - h} width={bw - 0.8} height={h} fill={p.f ? '#93c5fd' : '#1e5bd6'} opacity={p.f ? 0.7 : 1} rx={0.3} />;
      })}
    </svg>
  );
}
