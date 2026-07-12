'use client';

import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle } from '@/components/ui';
import { api } from '@/lib/api';

export default function PosPage() {
  return <Shell>{({ activeStore }) => (activeStore ? <Content storeId={activeStore.id} /> : <Card className="text-slate-600">Create a store first.</Card>)}</Shell>;
}

type Charge = { id: string; status: string; amount: string; currency: string; qr_string: string | null };

function Content({ storeId }: { storeId: string }) {
  const [tab, setTab] = useState<'charge' | 'counter'>('charge');
  return (
    <>
      <PageTitle title="Point of Sale" subtitle="Take a payment at the counter — charge an amount for a one-time QR, or print a reusable counter QR." />
      <div className="mb-5 inline-flex rounded-lg bg-slate-100 p-0.5 text-sm">
        {(['charge', 'counter'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md px-4 py-1.5 font-medium ${tab === t ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'}`}>
            {t === 'charge' ? 'Charge' : 'Counter QR'}
          </button>
        ))}
      </div>
      {tab === 'charge' ? <ChargeTab storeId={storeId} /> : <CounterTab storeId={storeId} />}
    </>
  );
}

function ChargeTab({ storeId }: { storeId: string }) {
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [charge, setCharge] = useState<Charge | null>(null);
  const [busy, setBusy] = useState(false);

  const press = (k: string) => setAmount((a) => {
    if (k === '⌫') return a.slice(0, -1);
    if (k === '.' && a.includes('.')) return a;
    return (a + k).replace(/^0+(?=\d)/, '');
  });

  const start = async () => {
    if (!amount || Number(amount) <= 0) return;
    setBusy(true);
    try { setCharge(await api<Charge>(`/dashboard/stores/${storeId}/pos/charge`, { method: 'POST', body: { amount, currency } })); }
    finally { setBusy(false); }
  };

  // Poll for payment until it settles.
  useEffect(() => {
    if (!charge || ['paid', 'expired', 'failed', 'cancelled'].includes(charge.status)) return;
    const t = setInterval(async () => {
      const p = await api<{ status: string }>(`/dashboard/payments/${charge.id}`).catch(() => null);
      if (p) setCharge((c) => (c ? { ...c, status: p.status } : c));
    }, 2500);
    return () => clearInterval(t);
  }, [charge]);

  const reset = () => { setCharge(null); setAmount(''); };

  if (charge) {
    const done = charge.status === 'paid';
    const dead = ['expired', 'failed', 'cancelled'].includes(charge.status);
    return (
      <Card className="mx-auto max-w-sm text-center">
        <div className="text-sm text-slate-500">Charging</div>
        <div className="text-3xl font-bold">{charge.amount} <span className="text-lg text-slate-400">{charge.currency}</span></div>
        {done ? (
          <div className="my-8">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-4xl text-emerald-600">✓</div>
            <div className="mt-3 text-lg font-semibold text-emerald-700">Payment received</div>
          </div>
        ) : dead ? (
          <div className="my-8 text-slate-500">Payment {charge.status}.</div>
        ) : (
          <div className="my-6">
            <div className="mx-auto inline-block rounded-2xl border border-slate-200 bg-white p-4">
              {charge.qr_string ? <QRCodeSVG value={charge.qr_string} size={220} /> : <span className="text-slate-400">No QR</span>}
            </div>
            <div className="mt-3 flex items-center justify-center gap-2 text-sm text-slate-500">
              <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" /> Ask the customer to scan with any Bakong app…
            </div>
          </div>
        )}
        <Button variant={done ? 'primary' : 'secondary'} onClick={reset}>{done || dead ? 'New charge' : 'Cancel'}</Button>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-4xl font-bold tracking-tight">{amount || '0'} <span className="text-xl text-slate-400">{currency}</span></div>
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-sm"><option>USD</option><option>KHR</option></select>
      </div>
      <div className="my-4 grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => (
          <button key={k} onClick={() => press(k)} className="rounded-xl bg-slate-50 py-4 text-xl font-semibold text-slate-700 hover:bg-slate-100 active:bg-slate-200">{k}</button>
        ))}
      </div>
      <button onClick={start} disabled={busy || !amount} className="w-full rounded-xl bg-brand-500 py-3.5 text-lg font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
        {busy ? 'Generating QR…' : 'Charge'}
      </button>
    </Card>
  );
}

function CounterTab({ storeId }: { storeId: string }) {
  const [qr, setQr] = useState<{ url: string } | null>(null);
  const load = useCallback(async () => { setQr(await api<{ url: string }>(`/dashboard/stores/${storeId}/pos/counter-qr`)); }, [storeId]);
  useEffect(() => { load(); }, [load]);
  if (!qr) return <Card className="mx-auto max-w-sm text-center text-slate-400">Loading…</Card>;
  return (
    <Card className="mx-auto max-w-sm text-center">
      <h3 className="font-semibold">Counter QR</h3>
      <p className="mb-4 text-sm text-slate-500">Print this and place it at your counter. Customers scan, enter the amount, and pay.</p>
      <div className="mx-auto inline-block rounded-2xl border border-slate-200 bg-white p-4"><QRCodeSVG value={qr.url} size={220} /></div>
      <a href={qr.url} target="_blank" rel="noreferrer" className="mt-3 block break-all text-xs text-brand-600 hover:underline">{qr.url}</a>
      <Button className="mt-4" variant="secondary" onClick={() => window.print()}>Print</Button>
    </Card>
  );
}
