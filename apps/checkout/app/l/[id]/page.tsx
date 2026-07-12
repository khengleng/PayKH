'use client';

import { useCallback, useEffect, useState } from 'react';
import { useT, money, LangToggle } from '@/lib/i18n';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

interface Link {
  id: string; type: string; title: string; description: string | null;
  amount: string | null; currency: string; allows_custom_amount: boolean;
  active: boolean; store_name: string; customer_name: string | null; paid: boolean;
  line_items: { name: string; qty: number; price: number }[];
}

export default function PayLinkPage({ params }: { params: { id: string } }) {
  const t = useT();
  const [link, setLink] = useState<Link | null>(null);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`${API_BASE}/links/${params.id}`, { cache: 'no-store' });
    if (!r.ok) { setError('This payment link could not be found.'); return; }
    setLink(await r.json());
  }, [params.id]);
  useEffect(() => { load(); }, [load]);

  const pay = async () => {
    setBusy(true); setError('');
    const body: Record<string, string> = {};
    if (link?.allows_custom_amount) body.amount = amount;
    if (name) body.name = name;
    const r = await fetch(`${API_BASE}/links/${params.id}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) { setError(data.message || 'Could not start payment'); setBusy(false); return; }
    window.location.href = data.checkout_url; // hand off to hosted checkout
  };

  return (
    <main style={s.wrap}>
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}><LangToggle className="text-slate-500 !border-slate-200" /></div>
        {error && <p style={{ color: '#dc2626', marginBottom: 12 }}>{error}</p>}
        {link && (
          <>
            <div style={s.store}>{link.store_name}</div>
            {link.type === 'invoice' && <div style={s.badge}>{t('invoice')}{link.customer_name ? ` · ${link.customer_name}` : ''}</div>}
            <h1 style={s.title}>{link.title}</h1>
            {link.description && <p style={s.desc}>{link.description}</p>}

            {link.line_items?.length > 0 && (
              <div style={s.items}>
                {link.line_items.map((it, i) => (
                  <div key={i} style={s.itemRow}><span>{it.name} × {it.qty}</span><span>{(it.qty * it.price).toFixed(2)}</span></div>
                ))}
              </div>
            )}

            {link.paid ? (
              <div style={{ ...s.paidBox }}>✅ {t('paid_already')}</div>
            ) : !link.active ? (
              <div style={s.paidBox}>{t('not_active')}</div>
            ) : (
              <>
                {link.allows_custom_amount ? (
                  <label style={{ display: 'block', marginBottom: 12 }}>
                    <span style={s.label}>{t('amount')} ({link.currency})</span>
                    <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" style={s.input} />
                  </label>
                ) : (
                  <div style={s.amount}>{money(link.amount ?? '0', link.currency)}</div>
                )}
                <label style={{ display: 'block', marginBottom: 16 }}>
                  <span style={s.label}>{t('your_name')}</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('name')} style={s.input} />
                </label>
                <button onClick={pay} disabled={busy || (link.allows_custom_amount && !amount)} style={{ ...s.btn, opacity: busy ? 0.7 : 1 }}>
                  {busy ? t('starting') : t('pay_with_khqr')}
                </button>
              </>
            )}
            <p style={s.foot}>{t('secured_by')} <b>PayKH</b> · Bakong KHQR</p>
          </>
        )}
      </div>
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#1e5bd6,#0a1f44)', padding: 16 },
  card: { background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,.3)' },
  store: { fontSize: 13, color: '#64748b', fontWeight: 600 },
  badge: { display: 'inline-block', marginTop: 6, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#1e5bd6', background: '#eff6ff', padding: '3px 8px', borderRadius: 6 },
  title: { fontSize: 22, fontWeight: 700, marginTop: 8 },
  desc: { color: '#475569', fontSize: 14, marginTop: 4 },
  items: { margin: '14px 0', borderTop: '1px solid #f1f5f9', paddingTop: 10 },
  itemRow: { display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#475569', padding: '4px 0' },
  amount: { fontSize: 40, fontWeight: 800, color: '#0f172a', margin: '16px 0' },
  label: { fontSize: 13, fontWeight: 500, color: '#334155' },
  input: { marginTop: 4, width: '100%', boxSizing: 'border-box', borderRadius: 10, border: '1px solid #e2e8f0', padding: '12px 14px', fontSize: 16 },
  btn: { width: '100%', padding: 14, borderRadius: 12, border: 'none', background: '#1e5bd6', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' },
  paidBox: { background: '#f0fdf4', color: '#15803d', borderRadius: 12, padding: 16, textAlign: 'center', fontWeight: 600 },
  foot: { textAlign: 'center', marginTop: 18, fontSize: 12, color: '#94a3b8' },
};
