'use client';

import { useCallback, useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

interface Play {
  id: string;
  status: string;
  game: { name: string; type: string };
  won: boolean | null;
  prize: { label: string; type: string; points_value: number } | null;
}

export default function ScratchPlayPage({ params }: { params: { id: string } }) {
  const [play, setPlay] = useState<Play | null>(null);
  const [error, setError] = useState('');
  const [revealing, setRevealing] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`${API_BASE}/play/${params.id}`, { cache: 'no-store' });
    if (!r.ok) { setError('This card could not be found.'); return; }
    setPlay(await r.json());
  }, [params.id]);
  useEffect(() => { load(); }, [load]);

  const reveal = async () => {
    setRevealing(true);
    const r = await fetch(`${API_BASE}/play/${params.id}/reveal`, { method: 'POST' });
    if (r.ok) setPlay(await r.json());
    setTimeout(() => setRevealing(false), 600);
  };

  return (
    <main style={styles.wrap}>
      <div style={styles.card}>
        {error && <p style={styles.err}>{error}</p>}
        {play && (
          <>
            <div style={styles.badge}>{play.game.name}</div>
            {play.status === 'issued' ? (
              <>
                <div style={{ ...styles.panel, ...(revealing ? styles.panelShake : {}) }}>
                  <span style={styles.q}>?</span>
                </div>
                <button onClick={reveal} disabled={revealing} style={styles.btn}>
                  {revealing ? 'Revealing…' : 'Scratch to reveal'}
                </button>
              </>
            ) : (
              <div style={{ ...styles.panel, background: play.won ? '#dcfce7' : '#f1f5f9' }}>
                {play.won ? (
                  <>
                    <span style={styles.trophy}>🎉</span>
                    <div style={styles.win}>You won!</div>
                    <div style={styles.prize}>{play.prize?.label}{play.prize?.type === 'points' ? ` (+${play.prize.points_value} pts)` : ''}</div>
                  </>
                ) : (
                  <>
                    <span style={styles.trophy}>🍀</span>
                    <div style={styles.lose}>No win this time</div>
                    <div style={styles.sub}>Better luck next time!</div>
                  </>
                )}
              </div>
            )}
          </>
        )}
        <p style={styles.foot}>Powered by <b>PayKH</b></p>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#1e5bd6,#0a1f44)', padding: 20 },
  card: { background: '#fff', borderRadius: 20, padding: 32, width: '100%', maxWidth: 380, textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,.3)' },
  badge: { display: 'inline-block', fontSize: 13, fontWeight: 600, color: '#1e5bd6', background: '#eff6ff', padding: '4px 12px', borderRadius: 999, marginBottom: 20 },
  panel: { height: 180, borderRadius: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#cbd5e1,#94a3b8)', marginBottom: 20 },
  panelShake: { animation: 'none', opacity: 0.7 },
  q: { fontSize: 64, color: '#fff', fontWeight: 800 },
  trophy: { fontSize: 48 },
  win: { fontSize: 22, fontWeight: 800, color: '#15803d', marginTop: 8 },
  prize: { fontSize: 16, color: '#166534', marginTop: 4 },
  lose: { fontSize: 20, fontWeight: 700, color: '#475569', marginTop: 8 },
  sub: { fontSize: 14, color: '#94a3b8', marginTop: 4 },
  btn: { width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: '#1e5bd6', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer' },
  err: { color: '#dc2626' },
  foot: { marginTop: 20, fontSize: 12, color: '#94a3b8' },
};
