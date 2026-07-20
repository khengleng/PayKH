'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

/**
 * PayKH loyalty mini-app — embedded in a bank's app. The bank opens this URL
 * with `?partner=<id>&token=<signed-handoff>`; we exchange it for a session and
 * show the customer's loyalty across every merchant they shop at.
 */
interface Backing { type: string; trustee_bank: string | null; label: string }
interface Merchant { customer_id: string; store_id: string; merchant_name: string; logo_url: string | null; points: number; tier: string | null; backing: Backing }
interface Me { consumer: { id: string; name: string | null; phone: string | null }; total_points: number; merchants: Merchant[] }

async function apiGet<T>(path: string, token: string): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || `HTTP ${r.status}`);
  return r.json();
}

function MiniApp() {
  const params = useSearchParams();
  const [session, setSession] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noEntry, setNoEntry] = useState(false);
  const [view, setView] = useState<'home' | 'qr' | 'history'>('home');
  const [detail, setDetail] = useState<Merchant | null>(null);

  // 1) Exchange the bank's signed handoff token for a mini-app session.
  useEffect(() => {
    const partner = params.get('partner');
    const token = params.get('token');
    if (!partner || !token) { setNoEntry(true); return; }
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/miniapp/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ partner_id: partner, token }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || 'Sign-in failed');
        const s = await r.json();
        setSession(s.session_token);
      } catch (e) { setError(e instanceof Error ? e.message : 'Sign-in failed'); }
    })();
  }, [params]);

  const loadMe = useCallback(async (t: string) => {
    try { setMe(await apiGet<Me>('/miniapp/me', t)); } catch (e) { setError(e instanceof Error ? e.message : 'Load failed'); }
  }, []);
  useEffect(() => { if (session) loadMe(session); }, [session, loadMe]);

  if (noEntry) return (
    <Screen>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 text-2xl font-extrabold text-white">KH</div>
        <h1 className="mt-4 text-xl font-bold text-slate-900">PayKH Rewards</h1>
        <p className="mt-2 max-w-xs text-sm text-slate-500">Open PayKH Rewards from your bank app to see your points and rewards across every merchant.</p>
      </div>
    </Screen>
  );
  if (error) return <Screen><div className="mt-24"><Card><p className="text-center text-sm text-red-600">{error}</p></Card></div></Screen>;
  if (!session || !me) return <Screen><HomeSkeleton /></Screen>;
  if (detail && session) return <MerchantView merchant={detail} token={session} onBack={() => { setDetail(null); loadMe(session); }} />;
  if (view === 'qr') return <MemberQR token={session} onBack={() => setView('home')} />;
  if (view === 'history') return <History token={session} onBack={() => setView('home')} />;

  return (
    <Screen>
      <div className="pt-6 text-center">
        <div className="text-sm text-slate-500">Hi{me.consumer.name ? `, ${me.consumer.name}` : ''} 👋</div>
        <div className="mt-1 text-4xl font-bold tracking-tight text-slate-900">{me.total_points.toLocaleString()}</div>
        <div className="text-xs uppercase tracking-wide text-slate-400">total points</div>
      </div>
      <div className="mt-6 flex gap-2">
        <button onClick={() => setView('qr')} className="tap flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white">My member QR</button>
        <button onClick={() => setView('history')} className="tap flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600">History</button>
      </div>
      <div className="mt-5 space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Your merchants</div>
        {me.merchants.length === 0 && <Card><p className="text-sm text-slate-400">No loyalty yet — pay a PayKH merchant to start earning.</p></Card>}
        {me.merchants.map((m) => (
          <button key={m.customer_id} onClick={() => setDetail(m)} className="tap flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 text-left shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-sm font-bold text-slate-500">
              {m.logo_url ? <img src={m.logo_url} alt="" className="h-full w-full object-cover" /> : m.merchant_name.slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-slate-800">{m.merchant_name}</div>
              <BackingBadge backing={m.backing} />
            </div>
            <div className="text-right">
              <div className="font-bold text-slate-900">{m.points.toLocaleString()}</div>
              <div className="text-[10px] uppercase text-slate-400">points</div>
            </div>
          </button>
        ))}
      </div>
    </Screen>
  );
}

function BackingBadge({ backing }: { backing: Backing }) {
  // Trustee-backed stablecoin shows the bank name (trust); otherwise plain points.
  if (backing.type === 'stablecoin' && backing.trustee_bank) {
    return <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">🛡️ {backing.label}</span>;
  }
  return <span className="mt-0.5 block text-[11px] text-slate-400">{backing.label}</span>;
}

function MerchantView({ merchant, token, onBack }: { merchant: Merchant; token: string; onBack: () => void }) {
  const [w, setW] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => apiGet<any>(`/miniapp/merchants/${merchant.customer_id}`, token).then(setW).catch(() => {}), [merchant.customer_id, token]);
  useEffect(() => { load(); }, [load]);

  const redeem = async (rewardId: string) => {
    setBusy(rewardId); setMsg(null);
    try {
      const r = await fetch(`${API_BASE}/miniapp/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ customer_id: merchant.customer_id, reward_id: rewardId }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message || 'Redeem failed');
      setMsg(`Redeemed! Show code: ${body.code ?? body.voucher_code ?? 'issued'}`);
      load();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Redeem failed'); }
    finally { setBusy(null); }
  };

  return (
    <Screen>
      <Header title={merchant.merchant_name} onBack={onBack} />
      <div className="mt-4 rounded-xl bg-indigo-50 p-4 text-center">
        <div className="text-3xl font-bold text-indigo-700">{(w?.points_balance ?? merchant.points).toLocaleString()}</div>
        <div className="text-xs uppercase text-indigo-500">points here</div>
        <div className="mt-1"><BackingBadge backing={merchant.backing} /></div>
      </div>
      {msg && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</p>}
      <div className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-400">Rewards</div>
      <div className="mt-2 space-y-2">
        {(w?.rewards ?? []).length === 0 && <Card><p className="text-sm text-slate-400">No rewards available.</p></Card>}
        {(w?.rewards ?? []).map((r: any) => (
          <div key={r.id} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-slate-800">{r.name}</div>
              <div className="text-xs text-slate-400">{r.points_cost.toLocaleString()} pts{r.description ? ` · ${r.description}` : ''}</div>
            </div>
            <button disabled={!r.affordable || !r.in_stock || busy === r.id} onClick={() => redeem(r.id)} className="tap rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
              {busy === r.id ? '…' : r.affordable ? 'Redeem' : 'Not enough'}
            </button>
          </div>
        ))}
      </div>
      {(w?.redemptions ?? []).filter((x: any) => x.status === 'issued').length > 0 && (
        <>
          <div className="mt-5 text-xs font-medium uppercase tracking-wide text-slate-400">Your vouchers</div>
          <div className="mt-2 space-y-2">
            {(w?.redemptions ?? []).filter((x: any) => x.status === 'issued').map((v: any) => (
              <div key={v.id} className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50 p-3 text-center">
                <div className="text-xs text-emerald-700">{v.reward_name}</div>
                <div className="font-mono text-lg font-bold tracking-wider text-emerald-800">{v.code}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </Screen>
  );
}

function MemberQR({ token, onBack }: { token: string; onBack: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => { apiGet<{ qr_png_data_url: string }>('/miniapp/member-qr', token).then((r) => setQr(r.qr_png_data_url)).catch(() => {}); }, [token]);
  return (
    <Screen>
      <Header title="My member QR" onBack={onBack} />
      <Card className="mt-4 text-center">
        <p className="text-sm text-slate-500">Show this to the cashier to earn or redeem.</p>
        {qr ? <img src={qr} alt="member QR" className="mx-auto mt-4 h-56 w-56" /> : <p className="mt-6 text-slate-400">Generating…</p>}
        <p className="mt-3 text-xs text-slate-400">Refreshes every few minutes for security.</p>
      </Card>
    </Screen>
  );
}

function History({ token, onBack }: { token: string; onBack: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { apiGet<{ payments: any[] }>('/miniapp/history', token).then((r) => setRows(r.payments)).catch(() => setRows([])); }, [token]);
  return (
    <Screen>
      <Header title="History" onBack={onBack} />
      <div className="mt-4 space-y-2">
        {!rows ? <p className="text-slate-400">Loading…</p> : rows.length === 0 ? <Card><p className="text-sm text-slate-400">No payments yet.</p></Card> : rows.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-white p-3">
            <div><div className="font-medium text-slate-800">{p.merchant}</div><div className="text-xs text-slate-400">{p.paid_at ? new Date(p.paid_at).toLocaleString() : ''}</div></div>
            <div className="font-semibold tabular-nums text-slate-900">{p.amount} {p.currency}</div>
          </div>
        ))}
      </div>
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <main className="miniapp-view miniapp-safe-bottom mx-auto flex min-h-[100dvh] max-w-md flex-col bg-slate-50 px-4">{children}</main>;
}

function HomeSkeleton() {
  return (
    <div className="pt-6">
      <div className="mx-auto miniapp-skel h-10 w-32" />
      <div className="mx-auto mt-2 miniapp-skel h-3 w-20" />
      <div className="mt-6 flex gap-2"><div className="miniapp-skel h-10 flex-1" /><div className="miniapp-skel h-10 flex-1" /></div>
      <div className="mt-5 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="miniapp-skel h-16 w-full" />)}</div>
    </div>
  );
}
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-100 bg-white p-4 shadow-sm ${className}`}>{children}</div>;
}
function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 pt-5">
      <button onClick={onBack} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100">←</button>
      <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
    </div>
  );
}

export default function MiniAppPage() {
  return (
    <Suspense fallback={<Screen><p className="mt-20 text-center text-slate-400">Loading…</p></Screen>}>
      <MiniApp />
    </Suspense>
  );
}
