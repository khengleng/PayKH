'use client';

import { useCallback, useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

interface Game { id: string; name: string; type: string; active: boolean; prizes: { label: string; type: string }[] }
interface Result { won: boolean | null; prize: { label: string; type: string; points_value: number } | null; status: string }

export default function InstantPlayPage({ params, searchParams }: { params: { gameId: string }; searchParams: { c?: string } }) {
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState('');
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`${API_BASE}/play/game/${params.gameId}`, { cache: 'no-store' });
    if (!r.ok) { setError('This game could not be found.'); return; }
    setGame(await r.json());
  }, [params.gameId]);
  useEffect(() => { load(); }, [load]);

  const play = async () => {
    setSpinning(true); setResult(null);
    const q = searchParams.c ? `?c=${encodeURIComponent(searchParams.c)}` : '';
    const r = await fetch(`${API_BASE}/play/game/${params.gameId}/play${q}`, { method: 'POST' });
    const data = await r.json();
    setTimeout(() => { setResult(r.ok ? data : { won: null, prize: null, status: 'error' }); setSpinning(false); }, 1800);
  };

  const isWheel = game?.type === 'spin_wheel';
  return (
    <main style={styles.wrap}>
      <div style={styles.card}>
        {error && <p style={styles.err}>{error}</p>}
        {game && (
          <>
            <div style={styles.badge}>{game.name}</div>
            <div style={{ ...styles.wheel, ...(spinning ? styles.spin : {}) }}>
              <span style={styles.icon}>{isWheel ? '🎡' : '🎁'}</span>
            </div>
            {result ? (
              <div style={{ ...styles.res, background: result.won ? '#dcfce7' : '#f1f5f9' }}>
                {result.won ? <><b style={{ color: '#15803d' }}>🎉 {result.prize?.label}</b>{result.prize?.type === 'points' ? <span> (+{result.prize.points_value} pts)</span> : null}</>
                  : <span style={{ color: '#475569' }}>🍀 No win — try again next time</span>}
              </div>
            ) : (
              <button onClick={play} disabled={spinning || !game.active} style={styles.btn}>
                {!game.active ? 'Game not available' : spinning ? (isWheel ? 'Spinning…' : 'Drawing…') : (isWheel ? 'Spin' : 'Draw')}
              </button>
            )}
            <p style={styles.foot}>Powered by <b>PayKH</b></p>
          </>
        )}
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#1e5bd6,#0a1f44)', padding: 20 },
  card: { background: '#fff', borderRadius: 20, padding: 32, width: '100%', maxWidth: 380, textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,.3)' },
  badge: { display: 'inline-block', fontSize: 13, fontWeight: 600, color: '#1e5bd6', background: '#eff6ff', padding: '4px 12px', borderRadius: 999, marginBottom: 20 },
  wheel: { height: 180, width: 180, margin: '0 auto 20px', borderRadius: '50%', border: '8px solid #1e5bd6', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle,#fff,#dbeafe)' },
  spin: { animation: 'spin 1.8s cubic-bezier(.2,.8,.2,1)' },
  icon: { fontSize: 64 },
  res: { padding: 16, borderRadius: 12, marginBottom: 16, fontSize: 16 },
  btn: { width: '100%', padding: 14, borderRadius: 12, border: 'none', background: '#1e5bd6', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer' },
  err: { color: '#dc2626' },
  foot: { marginTop: 20, fontSize: 12, color: '#94a3b8' },
};
