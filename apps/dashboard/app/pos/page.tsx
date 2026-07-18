'use client';

import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle } from '@/components/ui';
import { api } from '@/lib/api';
import { PayeeCard, Payee } from '@/lib/bank';

export default function PosPage() {
  return <Shell>{({ activeStore }) => (activeStore ? <Content storeId={activeStore.id} /> : <Card className="text-slate-600">Create a store first.</Card>)}</Shell>;
}

type Charge = { id: string; status: string; amount: string; currency: string; qr_string: string | null; payee?: Payee | null };

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
  const [currency, setCurrency] = useState('KHR');
  const [connected, setConnected] = useState<('USD' | 'KHR')[]>([]);
  const [charge, setCharge] = useState<Charge | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Offer only currencies the store can actually be paid in, and default to
  // one — charging a currency with no connected account just 400s.
  useEffect(() => {
    api<{ imported: boolean; accounts?: { currency: 'USD' | 'KHR' }[] }>(`/dashboard/stores/${storeId}/khqr`)
      .then((r) => {
        const list = r.imported && r.accounts ? r.accounts.map((a) => a.currency) : [];
        setConnected(list);
        if (list.length) setCurrency(list.includes('KHR') ? 'KHR' : list[0]);
      })
      .catch(() => setConnected([]));
  }, [storeId]);

  const press = (k: string) => setAmount((a) => {
    if (k === '⌫') return a.slice(0, -1);
    if (k === '.' && a.includes('.')) return a;
    return (a + k).replace(/^0+(?=\d)/, '');
  });

  // Optional: attach a customer by phone so the sale earns loyalty points.
  const [phone, setPhone] = useState('');

  const start = async () => {
    if (!amount || Number(amount) <= 0) return;
    setBusy(true); setErr('');
    try {
      setCharge(await api<Charge>(`/dashboard/stores/${storeId}/pos/charge`, {
        method: 'POST',
        body: { amount, currency, ...(phone.trim() ? { customer_phone: phone.trim() } : {}) },
      }));
    }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  // While a charge is open, also watch for a Telegram-detected bank payment
  // that matches it — so the cashier can one-tap confirm without waiting on
  // on-chain status. Assist mode: this only *offers* confirm, never auto-marks.
  const [detection, setDetection] = useState<{ id: string; amount: string | null; currency: string | null } | null>(null);

  // Poll for payment status + a matching detection until it settles.
  useEffect(() => {
    if (!charge || ['paid', 'expired', 'failed', 'cancelled'].includes(charge.status)) return;
    const t = setInterval(async () => {
      const p = await api<{ status: string }>(`/dashboard/payments/${charge.id}`).catch(() => null);
      if (p) setCharge((c) => (c ? { ...c, status: p.status } : c));
      const dets = await api<{ id: string; payment_id: string | null; amount: string | null; currency: string | null; confirmed: boolean }[]>(
        `/dashboard/stores/${storeId}/telegram-detection/recent`,
      ).catch(() => null);
      const m = dets?.find((d) => d.payment_id === charge.id && !d.confirmed);
      if (m) setDetection({ id: m.id, amount: m.amount, currency: m.currency });
    }, 2500);
    return () => clearInterval(t);
  }, [charge, storeId]);

  const confirmDetected = async () => {
    if (!detection) return;
    await api(`/dashboard/stores/${storeId}/telegram-detection/confirm`, { method: 'POST', body: { detection_id: detection.id } }).catch(() => {});
    setCharge((c) => (c ? { ...c, status: 'paid' } : c));
    setDetection(null);
  };

  const reset = () => { setCharge(null); setAmount(''); setDetection(null); setPhone(''); };

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
            {charge.payee && <div className="mt-4"><PayeeCard payee={charge.payee} /></div>}
            <div className="mt-3 flex items-center justify-center gap-2 text-sm text-slate-500">
              <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" /> Ask the customer to scan with any Bakong app…
            </div>
            {detection && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-sm font-medium text-emerald-800">
                  Looks received: {detection.amount} {detection.currency}
                </div>
                <div className="mt-0.5 text-xs text-emerald-700">Your bank alert matched this charge. Confirm to mark it paid.</div>
                <Button className="mt-2" onClick={confirmDetected}>Confirm payment</Button>
              </div>
            )}
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
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-sm">{(connected.length ? connected : ['USD','KHR']).map((c) => <option key={c}>{c}</option>)}</select>
      </div>
      <div className="my-4 grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => (
          <button key={k} onClick={() => press(k)} className="rounded-xl bg-slate-50 py-4 text-xl font-semibold text-slate-700 hover:bg-slate-100 active:bg-slate-200">{k}</button>
        ))}
      </div>
      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Customer phone (optional — earns loyalty)"
        inputMode="tel"
        className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
      <button onClick={start} disabled={busy || !amount} className="w-full rounded-xl bg-brand-500 py-3.5 text-lg font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
        {busy ? 'Generating QR…' : 'Charge'}
      </button>
      {err && <p className="mt-3 text-center text-sm text-red-600">{err}</p>}
    </Card>
  );
}

function CounterTab({ storeId }: { storeId: string }) {
  const [currencies, setCurrencies] = useState<('USD' | 'KHR')[] | null>(null);
  const [currency, setCurrency] = useState<'USD' | 'KHR'>('KHR');
  const [khqr, setKhqr] = useState<string | null>(null);
  const [payee, setPayee] = useState<Payee | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [err, setErr] = useState('');

  // Which currencies the store has connected — only those can be a real KHQR.
  useEffect(() => {
    api<{ imported: boolean; accounts?: { currency: 'USD' | 'KHR' }[] }>(`/dashboard/stores/${storeId}/khqr`)
      .then((r) => {
        const list = r.imported && r.accounts ? r.accounts.map((a) => a.currency) : [];
        setCurrencies(list);
        if (list.length) setCurrency(list.includes('KHR') ? 'KHR' : list[0]);
      })
      .catch(() => setCurrencies([]));
  }, [storeId]);

  // A real, static KHQR of the connected account for the chosen currency — a
  // banking app scans it and the customer types the amount. Falls back to the
  // checkout link only when no bank account is connected.
  const load = useCallback(async () => {
    setErr(''); setKhqr(null); setPayee(null); setFallbackUrl(null);
    if (currencies === null) return;
    if (currencies.length === 0) {
      const r = await api<{ url: string }>(`/dashboard/stores/${storeId}/pos/counter-qr`).catch(() => null);
      setFallbackUrl(r?.url ?? null);
      return;
    }
    try {
      const r = await api<{ qr_string: string; payee?: Payee | null }>(`/dashboard/stores/${storeId}/khqr/counter?currency=${currency}`);
      setKhqr(r.qr_string);
      setPayee(r.payee ?? null);
    } catch (e) { setErr((e as Error).message); }
  }, [storeId, currency, currencies]);
  useEffect(() => { load(); }, [load]);

  if (currencies === null) return <Card className="mx-auto max-w-sm text-center text-slate-400">Loading…</Card>;

  return (
    <Card className="mx-auto max-w-sm text-center">
      <h3 className="font-semibold">Counter QR</h3>
      <p className="mb-4 text-sm text-slate-500">Print this and place it at your counter. Customers scan with their banking app and enter the amount.</p>

      {currencies.length > 1 && (
        <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-0.5 text-sm">
          {currencies.map((c) => (
            <button key={c} onClick={() => setCurrency(c)} className={`rounded-md px-4 py-1.5 font-medium ${currency === c ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'}`}>{c}</button>
          ))}
        </div>
      )}

      {khqr ? (
        <>
          {currencies.length === 1 && <p className="mb-2 text-xs font-medium text-emerald-700">{currencies[0]} account</p>}
          <div className="mx-auto inline-block rounded-2xl border border-slate-200 bg-white p-4"><QRCodeSVG value={khqr} size={220} level="M" includeMargin /></div>
          {payee && <div className="mt-4"><PayeeCard payee={payee} /></div>}
          <p className="mt-2 text-xs text-slate-400">Pays your connected {currency} account directly.</p>
          <Button className="mt-4" variant="secondary" onClick={() => window.print()}>Print</Button>
        </>
      ) : fallbackUrl ? (
        <>
          <div className="mx-auto inline-block rounded-2xl border border-slate-200 bg-white p-4"><QRCodeSVG value={fallbackUrl} size={220} /></div>
          <p className="mt-3 text-xs text-amber-600">No bank account connected — this opens a checkout page instead of paying you directly. Connect your KHQR in Stores → Bank account for payments so a banking app can pay you.</p>
          <Button className="mt-4" variant="secondary" onClick={() => window.print()}>Print</Button>
        </>
      ) : (
        <p className="text-sm text-red-600">{err || 'Could not build the counter QR.'}</p>
      )}
    </Card>
  );
}
