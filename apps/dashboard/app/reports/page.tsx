'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle, Stat } from '@/components/ui';
import { api } from '@/lib/api';

interface Report {
  from: string; to: string; total_payments: number; paid_count: number;
  paid_volume: string; success_rate: number;
  by_status: Record<string, number>;
  daily: { day: string; paid_count: number; volume: string }[];
}

export default function ReportsPage() {
  return (
    <Shell>
      {({ activeStore }) =>
        activeStore ? <ReportsContent storeId={activeStore.id} /> : <Card className="text-slate-600">Create a store first.</Card>
      }
    </Shell>
  );
}

function isoDaysAgo(n: number) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }

function ReportsContent({ storeId }: { storeId: string }) {
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [report, setReport] = useState<Report | null>(null);

  const load = useCallback(async () => {
    const r = await api<Report>(`/dashboard/stores/${storeId}/report?from=${from}T00:00:00Z&to=${to}T23:59:59Z`);
    setReport(r);
  }, [storeId, from, to]);
  useEffect(() => { load(); }, [load]);

  const exportCsv = () => {
    if (!report) return;
    const rows = [['day', 'paid_count', 'volume'], ...report.daily.map((d) => [d.day, String(d.paid_count), d.volume])];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `report-${storeId}-${from}_${to}.csv`;
    a.click();
  };

  const maxCount = report ? Math.max(1, ...report.daily.map((d) => d.paid_count)) : 1;

  return (
    <>
      <PageTitle title="Reports" action={<Button variant="secondary" onClick={exportCsv}>Export CSV</Button>} />
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label><div className="mb-1 text-slate-600">From</div>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2" /></label>
          <label><div className="mb-1 text-slate-600">To</div>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2" /></label>
          <Button variant="secondary" onClick={load}>Run</Button>
        </div>
      </Card>

      {!report ? <div className="text-slate-400">Loading…</div> : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Total payments" value={report.total_payments} />
            <Stat label="Paid" value={report.paid_count} />
            <Stat label="Paid volume" value={`$${report.paid_volume}`} />
            <Stat label="Success rate" value={`${report.success_rate}%`} />
          </div>

          <Card className="mt-4">
            <div className="mb-3 text-sm font-medium">Paid payments / day</div>
            {report.daily.length === 0 ? (
              <p className="text-sm text-slate-400">No paid payments in this range.</p>
            ) : (
              <div className="flex h-40 items-end gap-1">
                {report.daily.map((d) => (
                  <div key={d.day} className="flex flex-1 flex-col items-center" title={`${d.day}: ${d.paid_count} ($${d.volume})`}>
                    <div className="w-full rounded-t bg-brand-500" style={{ height: `${(d.paid_count / maxCount) * 100}%` }} />
                    <div className="mt-1 rotate-45 text-[9px] text-slate-400">{d.day.slice(5)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
