'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Logo } from '@/lib/logo';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

interface Product { id: string; name: string; emoji: string; price: number }
interface ShopInfo {
  store_id: string;
  store_name: string;
  primary_color: string;
  currency: 'USD' | 'KHR';
  loyalty_active: boolean;
  points_per_unit: string;
  bank_connected: boolean;
  products: Product[];
}

export default function ShopPage({ params }: { params: { storeId: string } }) {
  const { storeId } = params;
  const [info, setInfo] = useState<ShopInfo | null>(null);
  const [error, setError] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/shop/${storeId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setInfo)
      .catch(() => setError('Shop not found.'));
  }, [storeId]);

  const fmt = useCallback(
    (n: number) => (info?.currency === 'KHR' ? `${Math.round(n).toLocaleString()}៛` : `$${n.toFixed(2)}`),
    [info?.currency],
  );

  const add = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
  const dec = (id: string) =>
    setCart((c) => {
      const q = (c[id] ?? 0) - 1;
      const n = { ...c };
      if (q <= 0) delete n[id];
      else n[id] = q;
      return n;
    });

  const lines = useMemo(
    () => (info?.products ?? []).filter((p) => cart[p.id]).map((p) => ({ ...p, qty: cart[p.id] })),
    [info?.products, cart],
  );
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const points = info?.loyalty_active ? Math.floor(total * Number(info.points_per_unit || 0)) : 0;

  const checkout = async () => {
    if (!count) return;
    setBusy(true); setError('');
    try {
      const r = await fetch(`${API_BASE}/shop/${storeId}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: lines.map((l) => ({ id: l.id, qty: l.qty })),
          phone: phone.trim() || undefined,
          name: name.trim() || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.message || 'Could not start checkout'); setBusy(false); return; }
      window.location.href = data.checkout_url; // hand off to hosted KHQR checkout
    } catch {
      setError('Could not start checkout — try again.');
      setBusy(false);
    }
  };

  const accent = info?.primary_color || '#1E5BD6';

  if (error && !info) {
    return <main className="flex min-h-screen items-center justify-center p-6 text-slate-600">{error}</main>;
  }
  if (!info) {
    return <main className="flex min-h-screen items-center justify-center p-6 text-slate-400">Loading shop…</main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-40">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Logo />
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">Demo shop</span>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4">
        <div className="py-6">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{info.store_name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Add items, then pay with any Bakong app.{' '}
            {info.loyalty_active && <span className="text-slate-700">Add your phone to earn loyalty points.</span>}
          </p>
          {!info.bank_connected && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              This shop hasn’t connected a bank account yet, so the QR is a sandbox one — the flow works end to end for the demo.
            </p>
          )}
        </div>

        {/* Products */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {info.products.map((p) => {
            const qty = cart[p.id] ?? 0;
            return (
              <div key={p.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-4xl">{p.emoji}</div>
                <div className="mt-2 flex-1 font-medium text-slate-800">{p.name}</div>
                <div className="mb-3 text-sm text-slate-500">{fmt(p.price)}</div>
                {qty === 0 ? (
                  <button
                    onClick={() => add(p.id)}
                    className="rounded-lg py-2 text-sm font-semibold text-white"
                    style={{ background: accent }}
                  >
                    Add
                  </button>
                ) : (
                  <div className="flex items-center justify-between rounded-lg border border-slate-200">
                    <button onClick={() => dec(p.id)} className="px-3 py-2 text-lg font-semibold text-slate-600">−</button>
                    <span className="font-semibold text-slate-800">{qty}</span>
                    <button onClick={() => add(p.id)} className="px-3 py-2 text-lg font-semibold text-slate-600">+</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Cart bar */}
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white shadow-[0_-8px_24px_rgba(0,0,0,0.06)]">
          <div className="mx-auto max-w-3xl px-4 py-3">
            <div className="mb-2 max-h-24 space-y-1 overflow-y-auto text-sm">
              {lines.map((l) => (
                <div key={l.id} className="flex justify-between text-slate-600">
                  <span>{l.emoji} {l.name} × {l.qty}</span>
                  <span className="tabular-nums">{fmt(l.price * l.qty)}</span>
                </div>
              ))}
            </div>
            <div className="mb-2 flex items-center justify-between border-t border-slate-100 pt-2">
              <span className="font-semibold text-slate-800">Total</span>
              <span className="text-lg font-bold text-slate-900">{fmt(total)}</span>
            </div>
            {info.loyalty_active && points > 0 && (
              <div className="mb-2 text-xs font-medium" style={{ color: accent }}>🎁 Earn {points.toLocaleString()} points with this order</div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                placeholder={info.loyalty_active ? 'Phone (optional — earns points)' : 'Phone (optional)'}
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
              />
              <button
                onClick={checkout}
                disabled={busy}
                className="rounded-lg px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
                style={{ background: accent }}
              >
                {busy ? 'Starting…' : `Pay ${fmt(total)}`}
              </button>
            </div>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </div>
        </div>
      )}
    </main>
  );
}
