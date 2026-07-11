'use client';

import { useCallback, useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

interface Wallet {
  name: string | null;
  store_name: string;
  loyalty_active: boolean;
  points_balance: number;
  lifetime_points: number;
  tier: { name: string; multiplier: string } | null;
  referrals: number;
  referral: { code: string; share_url: string; qr_png_data_url: string } | null;
  scratch_cards: { play_id: string; game: string; play_url: string }[];
}

export default function WalletPage({ params }: { params: { customerId: string } }) {
  const [w, setW] = useState<Wallet | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await fetch(`${API_BASE}/wallet/${params.customerId}`, { cache: 'no-store' });
    if (!r.ok) { setError('Wallet not found.'); return; }
    setW(await r.json());
  }, [params.customerId]);
  useEffect(() => { load(); }, [load]);

  return (
    <main style={s.wrap}>
      <div style={s.card}>
        {error && <p style={{ color: '#dc2626' }}>{error}</p>}
        {w && (
          <>
            <div style={s.head}>
              <div>
                <div style={s.store}>{w.store_name}</div>
                <div style={s.name}>{w.name ?? 'Member'}</div>
              </div>
              {w.tier && <span style={s.tier}>{w.tier.name} ×{w.tier.multiplier}</span>}
            </div>

            <div style={s.points}>
              <div style={s.bignum}>{w.points_balance.toLocaleString()}</div>
              <div style={s.pointsLabel}>points · {w.lifetime_points.toLocaleString()} lifetime</div>
            </div>

            {w.scratch_cards.length > 0 && (
              <div style={s.section}>
                <div style={s.secTitle}>🎟️ Scratch cards ({w.scratch_cards.length})</div>
                {w.scratch_cards.map((c) => (
                  <a key={c.play_id} href={c.play_url} style={s.cardLink}>{c.game} — tap to scratch →</a>
                ))}
              </div>
            )}

            {w.referral && (
              <div style={s.section}>
                <div style={s.secTitle}>👥 Refer friends ({w.referrals})</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.referral.qr_png_data_url} alt="Referral QR" style={s.qr} />
                <div style={s.code}>{w.referral.code}</div>
              </div>
            )}
            <p style={s.foot}>Powered by <b>PayKH</b></p>
          </>
        )}
      </div>
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#1e5bd6,#0a1f44)', padding: 16 },
  card: { background: '#fff', borderRadius: 20, padding: 24, width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,.3)' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  store: { fontSize: 13, color: '#64748b' },
  name: { fontSize: 20, fontWeight: 700 },
  tier: { background: '#fef3c7', color: '#b45309', fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999 },
  points: { textAlign: 'center', background: 'linear-gradient(135deg,#eff6ff,#dbeafe)', borderRadius: 16, padding: 24, marginBottom: 16 },
  bignum: { fontSize: 44, fontWeight: 800, color: '#1e5bd6' },
  pointsLabel: { fontSize: 13, color: '#64748b' },
  section: { borderTop: '1px solid #f1f5f9', paddingTop: 16, marginBottom: 8 },
  secTitle: { fontSize: 14, fontWeight: 600, marginBottom: 8 },
  cardLink: { display: 'block', padding: '10px 14px', background: '#f8fafc', borderRadius: 10, marginBottom: 6, color: '#1e5bd6', textDecoration: 'none', fontSize: 14 },
  qr: { width: 160, height: 160, display: 'block', margin: '0 auto', borderRadius: 12 },
  code: { textAlign: 'center', fontFamily: 'monospace', color: '#475569', marginTop: 8 },
  foot: { textAlign: 'center', marginTop: 16, fontSize: 12, color: '#94a3b8' },
};
