'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Card, PageTitle } from '@/components/ui';
import { api } from '@/lib/api';

interface TB { in_balance: boolean; currency_totals: { currency: string; total_debit: string; total_credit: string; balanced: boolean }[]; accounts: { account: string; type: string; currency: string; debit: string; credit: string; balance: string }[] }
interface Recon { balanced: boolean; checks: { id: string; label: string; ok: boolean; detail?: string }[]; breaks: any[] }
interface Journal { id: string; event: string; reference: string | null; currency: string; created_at: string; lines: { account: string; direction: string; amount: string }[] }

export default function LedgerPage() {
  return <Shell>{({ activeStore }) => (activeStore ? <Content storeId={activeStore.id} /> : <Card className="text-slate-600">Create a store first.</Card>)}</Shell>;
}

function Content({ storeId }: { storeId: string }) {
  const [tb, setTb] = useState<TB | null>(null);
  const [recon, setRecon] = useState<Recon | null>(null);
  const [journals, setJournals] = useState<Journal[]>([]);

  const load = useCallback(async () => {
    setTb(await api<TB>(`/dashboard/stores/${storeId}/ledger/trial-balance`));
    setRecon(await api<Recon>(`/dashboard/stores/${storeId}/ledger/reconcile`));
    setJournals(await api<Journal[]>(`/dashboard/stores/${storeId}/ledger/journals`));
  }, [storeId]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <PageTitle title="General Ledger" subtitle="Immutable double-entry journals with automated reconciliation. Balances are computed from posted entries, not derived." />

      {recon && (
        <Card className={`mb-6 border-l-4 ${recon.balanced ? 'border-emerald-500' : 'border-red-500'}`}>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-lg">{recon.balanced ? '✅' : '⚠️'}</span>
            <h3 className="font-semibold">Reconciliation {recon.balanced ? 'clean' : `— ${recon.breaks.length} break(s)`}</h3>
          </div>
          <ul className="text-sm">
            {recon.checks.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-0.5">
                <span>{c.ok ? '🟢' : '🔴'}</span><span>{c.label}</span>{c.detail && <span className="text-xs text-slate-400">— {c.detail}</span>}
              </li>
            ))}
          </ul>
          {recon.breaks.length > 0 && <pre className="mt-2 overflow-x-auto rounded bg-red-50 p-2 text-xs text-red-700">{JSON.stringify(recon.breaks, null, 1)}</pre>}
        </Card>
      )}

      {tb && (
        <Card className="mb-6">
          <h3 className="mb-3 font-semibold">Trial balance {tb.in_balance ? <span className="text-sm text-emerald-600">· in balance</span> : <span className="text-sm text-red-600">· OUT OF BALANCE</span>}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Account</th><th>Type</th><th>Cur</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th></tr></thead>
              <tbody>
                {tb.accounts.map((a) => (
                  <tr key={a.account + a.currency} className="border-t border-slate-50">
                    <td className="py-1.5">{a.account.replace(/_/g, ' ')}</td>
                    <td className="text-xs text-slate-500">{a.type}</td>
                    <td>{a.currency}</td>
                    <td className="text-right">{a.debit}</td>
                    <td className="text-right">{a.credit}</td>
                    <td className="text-right font-medium">{a.balance}</td>
                  </tr>
                ))}
                {tb.currency_totals.map((c) => (
                  <tr key={c.currency} className="border-t-2 border-slate-200 font-semibold">
                    <td className="py-1.5" colSpan={3}>Total {c.currency}</td>
                    <td className="text-right">{c.total_debit}</td>
                    <td className="text-right">{c.total_credit}</td>
                    <td className={`text-right ${c.balanced ? 'text-emerald-600' : 'text-red-600'}`}>{c.balanced ? '✓' : '✗'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <h3 className="mb-3 font-semibold">Recent journals</h3>
        <ul className="divide-y divide-slate-100 text-sm">
          {journals.map((j) => (
            <li key={j.id} className="py-2">
              <div className="flex justify-between"><span className="font-medium">{j.event}</span><span className="font-mono text-xs text-slate-400">{j.reference}</span></div>
              <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-600">
                {j.lines.map((l, i) => <span key={i}>{l.direction === 'debit' ? 'Dr' : 'Cr'} {l.account.replace(/_/g, ' ')} {l.amount} {j.currency}</span>)}
              </div>
            </li>
          ))}
          {journals.length === 0 && <li className="py-2 text-slate-400">No journals yet.</li>}
        </ul>
      </Card>
    </>
  );
}
