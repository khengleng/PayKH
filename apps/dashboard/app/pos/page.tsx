'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import jsQR from 'jsqr';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle } from '@/components/ui';
import { api } from '@/lib/api';
import { PayeeCard, Payee } from '@/lib/bank';

export default function PosPage() {
  return <Shell>{({ activeStore }) => (activeStore ? <Content storeId={activeStore.id} /> : <Card className="text-slate-600">Create a store first.</Card>)}</Shell>;
}

type Charge = { id: string; status: string; amount: string; currency: string; qr_string: string | null; payee?: Payee | null; wallet_url?: string | null };

function Content({ storeId }: { storeId: string }) {
  const [tab, setTab] = useState<'charge' | 'counter' | 'redeem'>('charge');
  const labels = { charge: 'Charge', counter: 'Counter QR', redeem: 'Redeem voucher' } as const;
  return (
    <>
      <PageTitle title="Point of Sale" subtitle="Take a payment at the counter — charge an amount, print a reusable counter QR, or redeem a loyalty voucher." />
      <div className="mb-5 inline-flex rounded-lg bg-slate-100 p-0.5 text-sm">
        {(['charge', 'counter', 'redeem'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md px-4 py-1.5 font-medium ${tab === t ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'}`}>
            {labels[t]}
          </button>
        ))}
      </div>
      {tab === 'charge' ? <ChargeTab storeId={storeId} /> : tab === 'counter' ? <CounterTab storeId={storeId} /> : <RedeemTab storeId={storeId} />}
    </>
  );
}

function ChargeTab({ storeId }: { storeId: string }) {
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('KHR');
  const [connected, setConnected] = useState<('USD' | 'KHR')[]>([]);
  const [charge, setCharge] = useState<Charge | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
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
  // A scanned mini-app member (from their bank app's member QR).
  const [member, setMember] = useState<{ name: string | null; phone: string; points: number } | null>(null);
  const [scanning, setScanning] = useState(false);

  const onMemberToken = async (token: string) => {
    setScanning(false); setErr('');
    try {
      const m = await api<{ phone: string; name: string | null; points: number; is_new_here: boolean }>(
        `/dashboard/stores/${storeId}/pos/resolve-member`,
        { method: 'POST', body: { member_token: token } },
      );
      setMember({ name: m.name, phone: m.phone, points: m.points });
      setPhone(m.phone); // the charge attaches to this customer → loyalty accrues
    } catch (e) { setErr((e as Error).message); }
  };

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

  // Manual confirmation: the cashier has seen the money land (bank app / SMS)
  // and marks it received. Fires the same paid side-effects (loyalty, receipt).
  const confirmManually = async () => {
    if (!charge) return;
    if (!window.confirm("Mark this payment as received?\n\nOnly do this after you've confirmed the money arrived in your bank account.")) return;
    setConfirming(true);
    try {
      await api(`/dashboard/payments/${charge.id}/confirm`, { method: 'POST', body: {} });
      setCharge((c) => (c ? { ...c, status: 'paid' } : c));
      setDetection(null);
    } finally { setConfirming(false); }
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
            {charge.wallet_url && (
              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-medium text-slate-700">Show the customer their rewards</div>
                <div className="mx-auto mt-3 inline-block rounded-xl border border-slate-200 bg-white p-3">
                  <QRCodeSVG value={charge.wallet_url} size={132} />
                </div>
                <div className="mt-2 text-xs text-slate-500">Scan to see points earned &amp; what they can redeem.</div>
              </div>
            )}
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
            <button
              onClick={confirmManually}
              disabled={confirming}
              className="mt-4 w-full rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-600 hover:border-brand-300 hover:text-brand-700 disabled:opacity-50"
            >
              {confirming ? 'Marking…' : "Mark as paid — I've received the money"}
            </button>
            <div className="mt-1 text-xs text-slate-400">Use this once you see the payment in your bank app.</div>
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
      {member ? (
        <div className="mb-3 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <span>👤 <span className="font-medium">{member.name || member.phone}</span> · {member.points.toLocaleString()} pts</span>
          <button onClick={() => { setMember(null); setPhone(''); }} className="text-emerald-500 hover:text-emerald-700">✕</button>
        </div>
      ) : (
        <button onClick={() => setScanning(true)} className="mb-3 w-full rounded-lg border border-dashed border-slate-300 py-2 text-sm text-slate-500 hover:border-brand-400 hover:text-brand-600">
          📷 Scan member QR (earns loyalty)
        </button>
      )}
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
      {scanning && <MemberScanner onToken={onMemberToken} onClose={() => setScanning(false)} />}
    </Card>
  );
}

/** Scans the customer's mini-app member QR. Cross-platform: native
 *  BarcodeDetector fast-path (Android/Chrome), jsQR fallback (iOS/Safari and
 *  everywhere else), plus a paste-the-code fallback if the camera is unavailable. */
function MemberScanner({ onToken, onClose }: { onToken: (t: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [manual, setManual] = useState('');
  const [camError, setCamError] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const hasNative = typeof window !== 'undefined' && 'BarcodeDetector' in window;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detector = hasNative ? new (window as any).BarcodeDetector({ formats: ['qr_code'] }) : null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const v = videoRef.current;
        if (v) { v.srcObject = stream; await v.play(); }
        const scan = async () => {
          if (stopped || !v) return;
          try {
            if (detector) {
              const codes = await detector.detect(v);
              if (codes[0]?.rawValue) { onToken(codes[0].rawValue); return; }
            } else if (ctx && v.videoWidth) {
              canvas.width = v.videoWidth; canvas.height = v.videoHeight;
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(img.data, img.width, img.height);
              if (code?.data) { onToken(code.data); return; }
            }
          } catch { /* keep scanning */ }
          raf = requestAnimationFrame(scan);
        };
        scan();
      } catch { setCamError(true); }
    })();
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onToken]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Scan member QR</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        {camError ? (
          <p className="text-sm text-slate-500">Camera unavailable — paste the member code below.</p>
        ) : (
          <video ref={videoRef} className="aspect-square w-full rounded-xl bg-black object-cover" muted playsInline />
        )}
        <div className="mt-3 flex gap-2">
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="or paste member code" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <button onClick={() => manual.trim() && onToken(manual.trim())} className="rounded-lg bg-brand-500 px-3 text-sm font-medium text-white">Use</button>
        </div>
      </div>
    </div>
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

type Voucher = { id: string; reward_name: string | null; points_spent: number; code: string; status: string; customer_name: string | null };

function RedeemTab({ storeId }: { storeId: string }) {
  const [code, setCode] = useState('');
  const [voucher, setVoucher] = useState<Voucher | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  const lookup = async () => {
    if (!code.trim()) return;
    setBusy(true); setErr(''); setVoucher(null); setDone(false);
    try {
      setVoucher(await api<Voucher>(`/dashboard/stores/${storeId}/redemptions/lookup?code=${encodeURIComponent(code.trim())}`));
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const fulfil = async () => {
    if (!voucher) return;
    setBusy(true); setErr('');
    try {
      await api(`/dashboard/redemptions/${voucher.id}/fulfill`, { method: 'POST' });
      setVoucher({ ...voucher, status: 'fulfilled' });
      setDone(true);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const reset = () => { setCode(''); setVoucher(null); setErr(''); setDone(false); };

  return (
    <Card className="mx-auto max-w-sm">
      <h3 className="font-semibold">Redeem a voucher</h3>
      <p className="mb-4 text-sm text-slate-500">Enter the code the customer shows from their loyalty wallet, then mark it used.</p>

      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && lookup()}
          placeholder="Voucher code"
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm uppercase tracking-wider"
        />
        <Button onClick={lookup} disabled={busy || !code.trim()}>{busy && !voucher ? '…' : 'Look up'}</Button>
      </div>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

      {voucher && (
        <div className="mt-4 rounded-xl border border-slate-200 p-4">
          <div className="text-lg font-semibold text-slate-800">{voucher.reward_name ?? 'Reward'}</div>
          <div className="mt-1 text-sm text-slate-500">{voucher.customer_name ?? 'Customer'} · {voucher.points_spent.toLocaleString()} pts</div>
          <div className="mt-1 font-mono text-xs text-slate-400">{voucher.code}</div>

          {done || voucher.status === 'fulfilled' ? (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
              <span>✓</span> Fulfilled — hand over the reward.
            </div>
          ) : voucher.status === 'issued' ? (
            <Button className="mt-4 w-full" onClick={fulfil} disabled={busy}>{busy ? 'Marking…' : 'Mark fulfilled'}</Button>
          ) : (
            <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">This voucher is {voucher.status} and can’t be fulfilled.</div>
          )}

          <button onClick={reset} className="mt-3 w-full text-center text-sm text-slate-500 hover:text-slate-700">Redeem another</button>
        </div>
      )}
    </Card>
  );
}
