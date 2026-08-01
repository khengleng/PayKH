'use client';

import { useMemo, useState } from 'react';
import './wallet.css';

type Screen = 'home' | 'pay' | 'activity' | 'rewards' | 'profile';
type Sheet = 'send' | 'receive' | 'insight' | 'security' | null;

const transactions = [
  { mark: 'M', color: 'orange', title: 'Malis Coffee', time: 'Today · 10:42', amount: '−៛ 12,500', note: 'Paid with KHQR' },
  { mark: 'S', color: 'blue', title: 'Sokha Vannak', time: 'Yesterday · 18:20', amount: '−៛ 35,000', note: 'Sent money' },
  { mark: 'B', color: 'green', title: 'ABA Bank', time: '24 Jul · 09:15', amount: '+៛ 150,000', note: 'Cash in' },
  { mark: 'G', color: 'purple', title: 'Grab Cambodia', time: '23 Jul · 19:06', amount: '−៛ 9,000', note: 'Transport' },
];

const actions = [
  { icon: '↗', label: 'Send', sheet: 'send' as const },
  { icon: '⌁', label: 'Scan', sheet: null },
  { icon: '↓', label: 'Receive', sheet: 'receive' as const },
  { icon: '＋', label: 'Top up', sheet: null },
];

export default function WalletPrototype() {
  const [screen, setScreen] = useState<Screen>('home');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [sent, setSent] = useState(false);
  const [dark, setDark] = useState(false);
  const [lang, setLang] = useState<'EN' | 'ខ្មែរ'>('EN');
  const [query, setQuery] = useState('');
  const visibleTransactions = useMemo(() => transactions.filter(t => t.title.toLowerCase().includes(query.toLowerCase())), [query]);

  const openAction = (action: typeof actions[number]) => {
    if (action.sheet) setSheet(action.sheet);
    else if (action.label === 'Scan') setScreen('pay');
  };

  return <div className={dark ? 'paykh-prototype is-dark' : 'paykh-prototype'}>
    <aside className="prototype-brief">
      <div className="brief-brand"><span className="brief-dot" /> PayKH <small>Consumer wallet</small></div>
      <p className="eyebrow">Mobile product system · v1.0</p>
      <h1>Built for the way Cambodia moves money.</h1>
      <p className="brief-copy">A high-fidelity consumer wallet direction that makes everyday money feel calm, clear and instantly useful.</p>
      <div className="brief-flow"><span>Open</span><i /> <span>Scan or send</span><i /> <span>Confirm</span><i /> <span>Feel certain</span></div>
      <section className="tokens">
        <div><b>Royal</b><span className="token royal" />#1649E8</div>
        <div><b>Gold</b><span className="token gold" />#F5B942</div>
        <div><b>Emerald</b><span className="token emerald" />#0A9B6D</div>
        <div><b>Radius</b><strong>20 / 28</strong></div>
      </section>
      <div className="brief-note">Tap through the bottom navigation, action buttons, reward card and profile controls. Every control has a 44px+ target, visible focus state, and reduced-motion-safe animation.</div>
    </aside>

    <main className="phone-shell" aria-label="PayKH consumer wallet prototype">
      <div className="phone-top"><span>9:41</span><div className="island" /><span>▮▮▮ ᴡɪꜰɪ ▰</span></div>
      <div className="app-view">
        {screen === 'home' && <Home onAction={openAction} onInsight={() => setSheet('insight')} onRewards={() => setScreen('rewards')} lang={lang} />}
        {screen === 'pay' && <Scan onBack={() => setScreen('home')} onSuccess={() => setSent(true)} />}
        {screen === 'activity' && <Activity query={query} setQuery={setQuery} items={visibleTransactions} />}
        {screen === 'rewards' && <Rewards onBack={() => setScreen('home')} />}
        {screen === 'profile' && <Profile dark={dark} setDark={setDark} lang={lang} setLang={setLang} onSecurity={() => setSheet('security')} />}
      </div>
      {screen !== 'pay' && <Nav active={screen} setScreen={setScreen} />}
      {sheet && <Sheet kind={sheet} dismiss={() => setSheet(null)} sent={sent} setSent={setSent} />}
    </main>
  </div>;
}

function Home({ onAction, onInsight, onRewards, lang }: { onAction: (a: typeof actions[number]) => void; onInsight: () => void; onRewards: () => void; lang: string }) {
  return <>
    <header className="home-header"><div><p>Good morning,</p><h2>Serey <span>👋</span></h2></div><button className="notification" aria-label="Notifications">♢<i /></button></header>
    <button className="balance-card" aria-label="View wallet balance"><div className="balance-head"><span>Available balance</span><span className="eye">◉</span></div><strong>៛ 1,248,500</strong><div className="balance-foot"><span>≈ $304.51</span><span>● Active</span></div><div className="card-orb one" /><div className="card-orb two" /></button>
    <div className="quick-actions">{actions.map(a => <button key={a.label} onClick={() => onAction(a)}><span>{a.icon}</span>{a.label}</button>)}</div>
    <section className="section"><div className="section-title"><h3>Spend smarter</h3><button onClick={onInsight}>View insights</button></div><button className="insight-card" onClick={onInsight}><div className="insight-icon">✦</div><div><b>You&apos;re doing well</b><p>Your food spend is 12% lower than last month.</p></div><span>›</span></button></section>
    <section className="section recent"><div className="section-title"><h3>Recent activity</h3><button>See all</button></div>{transactions.slice(0, 3).map(t => <Transaction key={t.title} item={t} />)}</section>
    <button className="reward-banner" onClick={onRewards}><div className="reward-sun">✦</div><div><span>PAYKH REWARDS</span><b>2,450 points waiting for you</b><small>Unlock a treat from your everyday payments</small></div><strong>→</strong></button>
    <div className="language-pill">{lang}</div>
  </>;
}

function Scan({ onBack, onSuccess }: { onBack: () => void; onSuccess: () => void }) {
  return <div className="scan-page"><header><button onClick={onBack} aria-label="Back">‹</button><h2>Scan to pay</h2><button aria-label="Flashlight">☼</button></header><p>Align the KHQR code within the frame</p><div className="scan-area"><div className="scan-frame"><i /><i /><i /><i /><div className="scan-line" /></div><div className="scan-merchant"><div className="merchant-mark">M</div><div><b>Malis Coffee</b><span>Verified merchant</span></div><button onClick={onSuccess}>Pay</button></div></div><div className="scan-bottom"><button><span>▧</span>My QR</button><button><span>⌁</span>Enter amount</button><button><span>▣</span>Photos</button></div></div>;
}

function Activity({ query, setQuery, items }: { query: string; setQuery: (s: string) => void; items: typeof transactions }) {
  return <><header className="plain-header"><div><p>Everything, in one place</p><h2>Activity</h2></div><button aria-label="Filter">☷</button></header><label className="search"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search transactions" /></label><div className="filter-row"><button className="selected">All</button><button>Money in</button><button>Money out</button><button>July</button></div><section className="activity-list"><p className="date-label">TODAY</p>{items.length ? items.map(t => <Transaction key={t.title} item={t} long />) : <div className="empty"><b>No transactions found</b><span>Try a merchant name, category, or amount.</span></div>}<p className="date-label">EARLIER</p><div className="timeline-card"><span className="timeline-icon">▣</span><div><b>July spending summary</b><p>Review where your money went</p></div><strong>→</strong></div></section></>;
}

function Rewards({ onBack }: { onBack: () => void }) { return <><header className="rewards-header"><button onClick={onBack}>‹</button><span>Rewards</span><button>⋯</button></header><div className="reward-hero"><p>PAYKH CIRCLE</p><h2>2,450 <small>points</small></h2><div className="progress"><i /></div><span>550 more points to reach <b>Gold</b></span></div><section className="section"><div className="section-title"><h3>Made for you</h3><button>Explore</button></div><div className="offer-row"><Offer badge="2×" title="Double points" sub="Coffee & tea, every Friday" color="orange" /><Offer badge="15%" title="Save on rides" sub="Grab · until 31 Aug" color="blue" /></div></section><section className="section"><h3 className="section-alone">Your next badges</h3><div className="badge-row"><div><span>☀</span><b>Early bird</b><small>3/5 mornings</small></div><div><span>♡</span><b>Local love</b><small>6/10 stores</small></div><div className="locked"><span>✦</span><b>Explorer</b><small>Locked</small></div></div></section></> }

function Offer({ badge, title, sub, color }: { badge: string; title: string; sub: string; color: string }) { return <button className={`offer ${color}`}><span>{badge}</span><b>{title}</b><small>{sub}</small><i>→</i></button> }

function Profile({ dark, setDark, lang, setLang, onSecurity }: { dark: boolean; setDark: (x:boolean) => void; lang: string; setLang: (x:'EN'|'ខ្មែរ') => void; onSecurity: () => void }) { return <><header className="plain-header profile-head"><h2>Profile</h2><button aria-label="Settings">⚙</button></header><div className="identity"><div className="avatar">S<span /></div><div><h3>Serey Chenda</h3><p>+855 12 345 678 <i>✓</i></p></div><button>›</button></div><section className="profile-section"><p>WALLET</p><Row icon="▣" text="Cards & bank accounts" info="2 linked" /><Row icon="▧" text="Saved places" info="3 favorites" /><Row icon="◷" text="Scheduled payments" info="None due" /></section><section className="profile-section"><p>PREFERENCES</p><Row icon="◎" text="Language" info={lang} action={() => setLang(lang === 'EN' ? 'ខ្មែរ' : 'EN')} /><Row icon="◐" text="Appearance" info="Dark mode" toggle={dark} action={() => setDark(!dark)} /></section><section className="profile-section"><p>TRUST & SUPPORT</p><Row icon="◇" text="Security center" info="All clear" action={onSecurity} /><Row icon="?" text="Help center" info="Chat with us" /></section></> }

function Row({ icon, text, info, toggle, action }: { icon: string; text: string; info: string; toggle?: boolean; action?: () => void }) { return <button className="profile-row" onClick={action}><span className="row-icon">{icon}</span><b>{text}</b><small>{info}</small>{typeof toggle === 'boolean' ? <i className={toggle ? 'switch on' : 'switch'}><em /></i> : <i className="chev">›</i>}</button> }

function Transaction({ item, long }: { item: typeof transactions[number]; long?: boolean }) { return <button className="transaction"><span className={`merchant-mark ${item.color}`}>{item.mark}</span><div><b>{item.title}</b><p>{long ? item.note : item.time}</p></div><div><strong className={item.amount.startsWith('+') ? 'positive' : ''}>{item.amount}</strong>{long && <p>{item.time}</p>}</div></button> }

function Nav({ active, setScreen }: { active: Screen; setScreen: (s:Screen) => void }) { const tabs: { screen:Screen; icon:string; label:string }[] = [{screen:'home',icon:'⌂',label:'Home'},{screen:'activity',icon:'◷',label:'Activity'},{screen:'pay',icon:'⌁',label:'Pay'},{screen:'rewards',icon:'✦',label:'Rewards'},{screen:'profile',icon:'◉',label:'Profile'}]; return <nav className="bottom-nav">{tabs.map(t => <button key={t.screen} className={active===t.screen ? 'active' : ''} onClick={() => setScreen(t.screen)}><span>{t.icon}</span>{t.label}</button>)}</nav> }

function Sheet({ kind, dismiss, sent, setSent }: { kind: Exclude<Sheet,null>; dismiss: () => void; sent:boolean; setSent:(x:boolean)=>void }) {
  const [amount, setAmount] = useState('25,000');
  if (sent) return <div className="sheet-backdrop"><div className="sheet success-sheet"><div className="success-ring">✓</div><p>PAYMENT COMPLETE</p><h2>៛ 25,000</h2><span>Sent to Sokha Vannak</span><div className="receipt"><span>Reference</span><b>PKH-8X29-M3</b><span>From</span><b>PayKH Wallet</b></div><button className="primary" onClick={() => {setSent(false); dismiss()}}>Done</button></div></div>;
  if (kind === 'insight') return <div className="sheet-backdrop"><div className="sheet insight-sheet"><div className="handle"/><p className="sheet-kicker">JULY OVERVIEW</p><h2>Your money, clearly seen.</h2><div className="chart"><div><i style={{height:'44%'}}/><i style={{height:'72%'}}/><i style={{height:'55%'}}/><i style={{height:'82%'}}/><i style={{height:'65%'}}/><i style={{height:'91%'}}/><i style={{height:'48%'}}/></div><span>Mon&nbsp;&nbsp;&nbsp; Tue&nbsp;&nbsp;&nbsp; Wed&nbsp;&nbsp;&nbsp; Thu&nbsp;&nbsp;&nbsp; Fri&nbsp;&nbsp;&nbsp; Sat&nbsp;&nbsp;&nbsp; Sun</span></div><div className="insight-stat"><span>Food & drinks</span><b>៛ 172,000</b><small>12% less than June</small></div><button className="primary" onClick={dismiss}>Got it</button></div></div>;
  if (kind === 'security') return <div className="sheet-backdrop"><div className="sheet security-sheet"><div className="handle"/><div className="shield">◇</div><p className="sheet-kicker">SECURITY CENTER</p><h2>You&apos;re well protected.</h2><p>Face ID, a secure PIN, and real-time security alerts are active on this device.</p><div className="secure-line"><i>✓</i> No unusual activity detected</div><button className="primary" onClick={dismiss}>Manage security</button></div></div>;
  if (kind === 'receive') return <div className="sheet-backdrop"><div className="sheet receive-sheet"><div className="handle"/><p className="sheet-kicker">RECEIVE MONEY</p><h2>Your personal KHQR</h2><div className="qr"><span>▦</span><span>▦</span><span>▦</span><span>▦</span><span>▦</span><span>▦</span><span>▦</span><span>▦</span><span>▦</span></div><b>Serey Chenda</b><p>Anyone with a KHQR-supported app can scan to pay you.</p><button className="secondary" onClick={dismiss}>Share payment link</button></div></div>;
  return <div className="sheet-backdrop"><div className="sheet send-sheet"><div className="handle"/><p className="sheet-kicker">SEND MONEY</p><div className="recipient"><span className="avatar small">S</span><div><b>Sokha Vannak</b><p>PayKH wallet · Verified</p></div><button>Change</button></div><label className="amount-input"><span>៛</span><input aria-label="Amount" value={amount} onChange={e=>setAmount(e.target.value)} inputMode="numeric" /></label><p className="available">Available to send · ៛ 1,248,500</p><div className="message">Add a note <span>Optional</span></div><button className="primary" onClick={() => setSent(true)}>Review payment <span>→</span></button></div></div>;
}
