'use client';

import { useCallback, useEffect, useState } from 'react';
import './member-wallet.css';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
type Tab = 'home' | 'rewards' | 'pass' | 'profile';

interface Reward { id: string; name: string; description: string | null; points_cost: number; in_stock: boolean; affordable: boolean }
interface Redemption { id: string; reward_name: string | null; points_spent: number; code: string; status: string; created_at: string }
interface Wallet { name: string | null; store_name: string; loyalty_active: boolean; points_balance: number; lifetime_points: number; tier: { name: string; multiplier: string } | null; referrals: number; referral: { code: string; share_url: string; qr_png_data_url: string } | null; scratch_cards: { play_id: string; game: string; play_url: string }[]; rewards: Reward[]; redemptions: Redemption[]; gift_cards: { code: string; currency: string; balance: string }[]; paychain: { wallet_id: string; asset_code: string | null; balance: string | null; secured: boolean } | null }

function initials(name: string | null) { return (name ?? 'Member').split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase(); }
function giftValue(g: Wallet['gift_cards'][number]) { return g.currency === 'KHR' ? `៛ ${Math.round(Number(g.balance)).toLocaleString()}` : `$${Number(g.balance).toFixed(2)}`; }

export default function WalletPage({ params }: { params: { customerId: string } }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const [showReferral, setShowReferral] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await fetch(`${API_BASE}/wallet/${params.customerId}`, { cache: 'no-store' });
      if (!result.ok) throw new Error(result.status === 404 ? 'Wallet not found.' : 'We could not refresh your wallet.');
      setWallet(await result.json());
    } catch (e) {
      setError(!navigator.onLine ? 'You’re offline. Reconnect to refresh your wallet.' : e instanceof Error ? e.message : 'We could not load your wallet.');
    }
  }, [params.customerId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setDark(localStorage.getItem('paykh-wallet-theme') === 'dark'); }, []);
  const toggleDark = () => setDark(value => { const next = !value; localStorage.setItem('paykh-wallet-theme', next ? 'dark' : 'light'); return next; });

  const redeem = async (reward: Reward) => {
    if (!confirm(`Redeem ${reward.points_cost.toLocaleString()} points for “${reward.name}”?`)) return;
    setBusy(reward.id); setNotice('');
    try {
      const result = await fetch(`${API_BASE}/wallet/${params.customerId}/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reward_id: reward.id }) });
      const data = await result.json();
      if (!result.ok) throw new Error(data.message || 'Could not redeem this reward.');
      setNotice(`Reward ready — show voucher ${data.code} to the merchant.`);
      await load(); setTab('pass');
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Could not redeem this reward.'); }
    finally { setBusy(null); }
  };

  const share = async () => {
    if (!wallet?.referral) return;
    try { await navigator.share?.({ title: `Join ${wallet.store_name}`, text: `Use my ${wallet.store_name} referral code: ${wallet.referral.code}`, url: wallet.referral.share_url }); }
    catch { await navigator.clipboard?.writeText(wallet.referral.share_url); setNotice('Invite link copied to your clipboard.'); }
  };

  if (!wallet && !error) return <LoadingWallet />;
  if (!wallet) return <main className="member-wallet"><StatusCard title="Let’s try that again" body={error} action="Retry" onAction={load} /></main>;

  return <main className={dark ? 'member-wallet dark' : 'member-wallet'}>
    <div className="mw-shell">
      <header className="mw-header"><div className="brand"><span>◆</span>PayKH</div><button className="icon-button" aria-label="Refresh wallet" onClick={load}>↻</button></header>
      {notice && <button className="notice" onClick={() => setNotice('')}><span>✓</span>{notice}<b>×</b></button>}
      {error && <button className="offline" onClick={load}><span>⌁</span>{error}<b>Retry</b></button>}
      {tab === 'home' && <Home wallet={wallet} setTab={setTab} openReferral={() => setShowReferral(true)} />}
      {tab === 'rewards' && <Rewards wallet={wallet} redeem={redeem} busy={busy} />}
      {tab === 'pass' && <Pass wallet={wallet} openReferral={() => setShowReferral(true)} />}
      {tab === 'profile' && <Profile wallet={wallet} dark={dark} toggleDark={toggleDark} />}
      <nav className="mw-nav" aria-label="Wallet navigation">
        <TabButton active={tab === 'home'} onClick={() => setTab('home')} icon="⌂" label="Home" />
        <TabButton active={tab === 'rewards'} onClick={() => setTab('rewards')} icon="✦" label="Rewards" />
        <TabButton active={tab === 'pass'} onClick={() => setTab('pass')} icon="▦" label="My pass" />
        <TabButton active={tab === 'profile'} onClick={() => setTab('profile')} icon="◉" label="Profile" />
      </nav>
      {showReferral && wallet.referral && <ReferralModal wallet={wallet} close={() => setShowReferral(false)} share={share} />}
    </div>
  </main>;
}

function Home({ wallet, setTab, openReferral }: { wallet: Wallet; setTab: (tab: Tab) => void; openReferral: () => void }) {
  return <div className="mw-content"><section className="welcome"><div><p>Welcome back</p><h1>{wallet.name ?? 'Member'} <span>👋</span></h1></div><div className="avatar">{initials(wallet.name)}</div></section>
    <section className="points-card"><div className="points-card-top"><span>{wallet.store_name}</span>{wallet.tier && <b>{wallet.tier.name} · ×{wallet.tier.multiplier}</b>}</div><strong>{wallet.points_balance.toLocaleString()}</strong><p>available points</p><div className="points-card-bottom"><span>{wallet.lifetime_points.toLocaleString()} lifetime points</span><button onClick={() => setTab('pass')}>View pass <i>→</i></button></div><i className="ring ring-one" /><i className="ring ring-two" /></section>
    <section className="quick-grid"><button onClick={() => setTab('pass')}><span>▦</span><b>My pass</b><small>Show at checkout</small></button><button onClick={() => setTab('rewards')}><span>✦</span><b>Rewards</b><small>{wallet.rewards.length} available</small></button><button onClick={openReferral}><span>♢</span><b>Invite</b><small>{wallet.referrals} friends</small></button></section>
    {wallet.paychain?.secured && <section className="trust-card"><span>◇</span><div><b>Secured on PayChain</b><p>{wallet.paychain.balance != null ? `${Number(wallet.paychain.balance).toLocaleString()} ${wallet.paychain.asset_code ?? 'points'} recorded` : 'Your loyalty wallet is linked'}</p></div><i>›</i></section>}
    {wallet.gift_cards.length > 0 && <section className="mw-section"><div className="section-title"><h2>Gift cards</h2><button onClick={() => setTab('pass')}>View all</button></div><div className="gift-scroll">{wallet.gift_cards.map(g => <div className="gift-card" key={g.code}><span>PAYKH GIFT</span><b>{giftValue(g)}</b><small>Store credit · {wallet.store_name}</small><i>{g.code.slice(-4)}</i></div>)}</div></section>}
    <section className="mw-section"><div className="section-title"><h2>Ready for you</h2><button onClick={() => setTab('rewards')}>Explore</button></div>{wallet.rewards.length ? <div className="reward-preview">{wallet.rewards.slice(0, 2).map(r => <button onClick={() => setTab('rewards')} key={r.id}><span className={r.affordable ? 'reward-icon ready' : 'reward-icon'}>✦</span><div><b>{r.name}</b><small>{r.points_cost.toLocaleString()} points</small></div><i>›</i></button>)}</div> : <Empty title="More rewards are on their way" detail="Keep earning points with your next purchase." />}</section>
    {wallet.scratch_cards.length > 0 && <section className="scratch-home"><div><span>YOUR LUCKY DRAW</span><b>{wallet.scratch_cards.length} scratch {wallet.scratch_cards.length === 1 ? 'card' : 'cards'} waiting</b><small>Reveal your next surprise</small></div><a href={wallet.scratch_cards[0].play_url}>Play <i>→</i></a></section>}
  </div>;
}

function Rewards({ wallet, redeem, busy }: { wallet: Wallet; redeem: (reward: Reward) => void; busy: string | null }) { return <div className="mw-content"><div className="page-heading"><p>USE YOUR POINTS</p><h1>Rewards</h1><span>{wallet.points_balance.toLocaleString()} points available</span></div>{wallet.rewards.length ? <div className="rewards-list">{wallet.rewards.map(reward => <article key={reward.id} className="reward-row"><span className={reward.affordable && reward.in_stock ? 'reward-icon ready' : 'reward-icon'}>✦</span><div><h2>{reward.name}</h2><p>{reward.description ?? 'A reward from your favourite merchant'}</p><b>{reward.points_cost.toLocaleString()} points</b></div><button onClick={() => redeem(reward)} disabled={!reward.affordable || !reward.in_stock || busy === reward.id}>{busy === reward.id ? '…' : !reward.in_stock ? 'Sold out' : reward.affordable ? 'Redeem' : 'More points'}</button></article>)}</div> : <Empty title="No rewards available" detail="Check back soon for offers from this merchant." />}</div> }

function Pass({ wallet, openReferral }: { wallet: Wallet; openReferral: () => void }) { return <div className="mw-content"><div className="page-heading"><p>YOUR WALLET</p><h1>My pass</h1><span>Keep your rewards close</span></div><section className="member-pass"><div><span>{wallet.store_name}</span><b>{wallet.name ?? 'Member'}</b><small>{wallet.tier?.name ?? 'Member'} · PayKH loyalty</small></div><strong>{wallet.points_balance.toLocaleString()}<small> points</small></strong><i>◆</i></section>{wallet.redemptions.length > 0 && <section className="mw-section"><div className="section-title"><h2>Ready to use</h2><span>{wallet.redemptions.filter(x => x.status === 'issued').length} active</span></div><div className="vouchers">{wallet.redemptions.map(v => <article key={v.id}><span className={v.status === 'issued' ? 'ticket-icon active' : 'ticket-icon'}>✓</span><div><h3>{v.reward_name ?? 'Reward'}</h3><code>{v.code}</code><small>{v.status === 'issued' ? 'Show this code to the merchant' : v.status}</small></div><b>{v.status === 'issued' ? 'Ready' : v.status}</b></article>)}</div></section>}{wallet.scratch_cards.length > 0 && <section className="mw-section"><div className="section-title"><h2>Lucky draw</h2><span>{wallet.scratch_cards.length} to reveal</span></div>{wallet.scratch_cards.map(card => <a className="scratch-row" key={card.play_id} href={card.play_url}><span>✦</span><div><b>{card.game}</b><small>Tap to reveal your surprise</small></div><i>→</i></a>)}</section>}{wallet.referral && <button className="invite-card" onClick={openReferral}><span>♢</span><div><b>Invite friends, earn together</b><small>Share your code and grow your circle</small></div><i>→</i></button>}</div> }

function Profile({ wallet, dark, toggleDark }: { wallet: Wallet; dark: boolean; toggleDark: () => void }) { return <div className="mw-content"><div className="page-heading"><p>ACCOUNT</p><h1>Profile</h1></div><section className="profile-card"><div className="avatar large">{initials(wallet.name)}</div><div><h2>{wallet.name ?? 'PayKH member'}</h2><p>{wallet.store_name} loyalty member</p></div></section><section className="settings"><p>APPEARANCE</p><button onClick={toggleDark}><span>◐</span><b>Dark mode</b><small>{dark ? 'On' : 'Off'}</small><i className={dark ? 'toggle on' : 'toggle'}><em /></i></button><p>MEMBERSHIP</p><div><span>✦</span><b>Current level</b><small>{wallet.tier?.name ?? 'Member'}</small></div><div><span>◇</span><b>Wallet security</b><small>{wallet.paychain?.secured ? 'Secured' : 'Standard'}</small></div><p>SUPPORT</p><a href="mailto:support@paykh.cambobia.com"><span>?</span><b>Get help</b><small>Contact PayKH</small><i>›</i></a></section><p className="powered">Powered by <b>PayKH</b></p></div> }

function ReferralModal({ wallet, close, share }: { wallet: Wallet; close: () => void; share: () => void }) { return <div className="modal-backdrop" role="presentation" onClick={close}><section className="referral-modal" role="dialog" aria-modal="true" aria-labelledby="invite-title" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="Close" onClick={close}>×</button><span className="modal-icon">♢</span><p>GROW THE CIRCLE</p><h2 id="invite-title">Invite friends to {wallet.store_name}</h2><small>They scan your code to get started.</small>{wallet.referral && <><img src={wallet.referral.qr_png_data_url} alt="Referral QR code" /><code>{wallet.referral.code}</code><button className="share-button" onClick={share}>Share invite <span>↑</span></button></>}</section></div> }
function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: string; label: string }) { return <button className={active ? 'active' : ''} onClick={onClick}><span>{icon}</span>{label}</button> }
function Empty({ title, detail }: { title: string; detail: string }) { return <div className="empty-state"><span>✦</span><b>{title}</b><p>{detail}</p></div> }
function StatusCard({ title, body, action, onAction }: { title: string; body: string; action: string; onAction: () => void }) { return <div className="mw-shell status-card"><span>⌁</span><h1>{title}</h1><p>{body}</p><button onClick={onAction}>{action}</button></div> }
function LoadingWallet() { return <main className="member-wallet"><div className="mw-shell loading"><div className="loading-brand">◆ PayKH</div><i /><i /><i /><i /></div></main> }
