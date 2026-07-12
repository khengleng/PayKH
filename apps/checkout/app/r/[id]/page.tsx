'use client';

import { useCallback, useEffect, useState } from 'react';
import { useT, money, LangToggle } from '@/lib/i18n';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

interface Receipt {
  id: string; receipt_number: string; store_name: string; support_email: string | null;
  amount: string; currency: string; status: string; reference: string | null;
  description: string | null; paid_at: string | null; created_at: string; refunded_amount: string;
}

export default function ReceiptPage({ params }: { params: { id: string } }) {
  const t = useT();
  const [r, setR] = useState<Receipt | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/receipts/${params.id}`, { cache: 'no-store' });
    if (!res.ok) { setError('Receipt not found.'); return; }
    setR(await res.json());
  }, [params.id]);
  useEffect(() => { load(); }, [load]);

  const paid = r?.status === 'paid';
  const refunded = r && Number(r.refunded_amount) > 0;

  return (
    <main style={s.wrap}>
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><LangToggle className="!border-slate-200 text-slate-500" /></div>
        {error && <p style={{ color: '#dc2626' }}>{error}</p>}
        {r && (
          <>
            <div style={{ textAlign: 'center' }}>
              <div style={{ ...s.badge, background: paid ? '#dcfce7' : '#f1f5f9', color: paid ? '#15803d' : '#475569' }}>
                {paid ? `✓ ${t('paid')}` : r.status}
              </div>
              <div style={s.store}>{r.store_name}</div>
              <div style={s.amount}>{money(r.amount, r.currency)}</div>
            </div>
            <div style={s.rows}>
              <Row k={t('receipt_no')} v={r.receipt_number} mono />
              {r.description && <Row k={t('reference')} v={r.description} />}
              {r.reference && <Row k={t('reference')} v={r.reference} mono />}
              <Row k={t('date')} v={new Date(r.paid_at ?? r.created_at).toLocaleString()} />
              <Row k="ID" v={r.id} mono small />
              {refunded && <Row k="Refunded" v={money(r.refunded_amount, r.currency)} />}
            </div>
            {r.support_email && <p style={s.support}>{t('questions_contact')} <a href={`mailto:${r.support_email}`} style={{ color: '#1E5BD6' }}>{r.support_email}</a></p>}
            <button onClick={() => window.print()} style={s.btn}>{t('print_save')}</button>
            <p style={s.foot}>Powered by <b>PayKH</b> · Bakong KHQR</p>
          </>
        )}
      </div>
    </main>
  );
}

function Row({ k, v, mono, small }: { k: string; v: string; mono?: boolean; small?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: small ? 12 : 14 }}>
      <span style={{ color: '#64748b' }}>{k}</span>
      <span style={{ color: '#0f172a', fontFamily: mono ? 'monospace' : undefined, textAlign: 'right', maxWidth: '60%', wordBreak: 'break-all' }}>{v}</span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', padding: 16 },
  card: { background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 400, boxShadow: '0 10px 40px rgba(0,0,0,.08)' },
  badge: { display: 'inline-block', padding: '4px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, textTransform: 'capitalize' },
  store: { marginTop: 10, fontSize: 15, fontWeight: 600, color: '#334155' },
  amount: { fontSize: 40, fontWeight: 800, color: '#0f172a', margin: '4px 0 16px' },
  rows: { marginTop: 8 },
  support: { marginTop: 14, fontSize: 13, color: '#64748b', textAlign: 'center' },
  btn: { marginTop: 16, width: '100%', padding: 12, borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', fontWeight: 600, cursor: 'pointer' },
  foot: { textAlign: 'center', marginTop: 16, fontSize: 12, color: '#94a3b8' },
};
