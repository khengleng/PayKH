'use client';

import { useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle } from '@/components/ui';
import { api } from '@/lib/api';

export default function CopilotPage() {
  return <Shell>{({ activeStore }) => (activeStore ? <Content storeId={activeStore.id} /> : <Card className="text-slate-600">Create a store first.</Card>)}</Shell>;
}

interface Out { text: string; source: 'ai' | 'computed' }

function Content({ storeId }: { storeId: string }) {
  return (
    <>
      <PageTitle title="AI Copilot" subtitle="Marketing copy, campaign ideas, plain-English analytics, fraud insight and a merchant assistant. Uses Claude when configured; otherwise a computed fallback." />
      <div className="grid gap-6 md:grid-cols-2">
        <MarketingTool storeId={storeId} />
        <Assistant storeId={storeId} />
        <InsightCard storeId={storeId} title="Campaign suggestion" path="ai/campaign-suggest" cta="Suggest a promotion" />
        <InsightCard storeId={storeId} title="Analytics summary" path="ai/analytics-summary" cta="Summarize performance" />
        <InsightCard storeId={storeId} title="Fraud insights" path="ai/fraud-insights" cta="Analyze risk cases" />
      </div>
      <UsageCard storeId={storeId} />
    </>
  );
}

function UsageCard({ storeId }: { storeId: string }) {
  const [u, setU] = useState<any>(null);
  useEffect(() => { api<any>(`/dashboard/stores/${storeId}/ai/usage`).then(setU).catch(() => {}); }, [storeId]);
  if (!u) return null;
  return (
    <Card className="mt-6">
      <h3 className="mb-2 font-semibold">AI governance — last 30 days</h3>
      <div className="flex flex-wrap gap-4 text-sm text-slate-600">
        <span>Calls <b>{u.total_calls}</b></span>
        <span>Est. cost <b>{u.total_cost}</b></span>
        <span>Blocked <b className={u.by_source?.blocked ? 'text-red-500' : ''}>{u.by_source?.blocked ?? 0}</b></span>
        <span>Live AI <b>{u.by_source?.ai ?? 0}</b></span>
        <span>Fallback <b>{u.by_source?.fallback ?? 0}</b></span>
      </div>
      <p className="mt-2 text-xs text-slate-400">Every call is screened by guardrails (prompt-injection/PII) and logged for cost management.</p>
    </Card>
  );
}

function SourceTag({ source }: { source: string }) {
  return <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${source === 'ai' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500'}`}>{source === 'ai' ? '✨ Claude' : 'computed'}</span>;
}

function InsightCard({ storeId, title, path, cta }: { storeId: string; title: string; path: string; cta: string }) {
  const [out, setOut] = useState<Out | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { setOut(await api<Out>(`/dashboard/stores/${storeId}/${path}`)); } catch { /* noop */ } setBusy(false); };
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">{title}{out && <SourceTag source={out.source} />}</h3>
        <Button variant="secondary" onClick={run} disabled={busy}>{busy ? '…' : cta}</Button>
      </div>
      {out && <p className="whitespace-pre-wrap text-sm text-slate-700">{out.text}</p>}
    </Card>
  );
}

function MarketingTool({ storeId }: { storeId: string }) {
  const [product, setProduct] = useState('');
  const [tone, setTone] = useState('friendly');
  const [channel, setChannel] = useState('sms');
  const [out, setOut] = useState<Out | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => { if (!product) return; setBusy(true); try { setOut(await api<Out>(`/dashboard/stores/${storeId}/ai/marketing-copy`, { method: 'POST', body: { product, tone, channel } })); } catch { /* noop */ } setBusy(false); };
  return (
    <Card>
      <h3 className="mb-2 font-semibold">Marketing copy{out && <SourceTag source={out.source} />}</h3>
      <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="What are you promoting? e.g. Iced latte 20% off" className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      <div className="mb-2 flex gap-2">
        <select value={tone} onChange={(e) => setTone(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">{['friendly', 'professional', 'playful', 'urgent'].map((t) => <option key={t}>{t}</option>)}</select>
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">{['sms', 'telegram', 'email', 'social'].map((c) => <option key={c}>{c}</option>)}</select>
        <Button onClick={run} disabled={busy}>{busy ? '…' : 'Generate'}</Button>
      </div>
      {out && <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{out.text}</p>}
    </Card>
  );
}

function Assistant({ storeId }: { storeId: string }) {
  const [q, setQ] = useState('');
  const [out, setOut] = useState<Out | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => { if (!q) return; setBusy(true); try { setOut(await api<Out>(`/dashboard/stores/${storeId}/ai/assistant`, { method: 'POST', body: { question: q } })); } catch { /* noop */ } setBusy(false); };
  return (
    <Card>
      <h3 className="mb-2 font-semibold">Merchant assistant{out && <SourceTag source={out.source} />}</h3>
      <div className="mb-2 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="Ask about your store…" className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        <Button onClick={run} disabled={busy}>{busy ? '…' : 'Ask'}</Button>
      </div>
      {out && <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{out.text}</p>}
    </Card>
  );
}
