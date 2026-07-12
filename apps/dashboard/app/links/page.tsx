'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle } from '@/components/ui';
import { api } from '@/lib/api';

interface Link {
  id: string; type: string; title: string; amount: string | null; currency: string;
  active: boolean; single_use: boolean; times_paid: number; customer_name: string | null; url: string;
}

export default function LinksPage() {
  return <Shell>{({ activeStore }) => (activeStore ? <Content storeId={activeStore.id} /> : <Card className="text-slate-600">Create a store first.</Card>)}</Shell>;
}

function Content({ storeId }: { storeId: string }) {
  const [links, setLinks] = useState<Link[]>([]);
  const [type, setType] = useState<'LINK' | 'INVOICE'>('LINK');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [customerName, setCustomerName] = useState('');
  const [singleUse, setSingleUse] = useState(false);
  const [copied, setCopied] = useState('');

  const load = useCallback(async () => { setLinks(await api<Link[]>(`/dashboard/stores/${storeId}/links`)); }, [storeId]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!title) return;
    await api(`/dashboard/stores/${storeId}/links`, { method: 'POST', body: {
      type, title, amount: amount || undefined, currency,
      customerName: type === 'INVOICE' ? customerName || undefined : undefined,
      singleUse: type === 'INVOICE' ? true : singleUse,
    } });
    setTitle(''); setAmount(''); setCustomerName(''); await load();
  };
  const toggle = async (id: string, active: boolean) => { await api(`/dashboard/links/${id}`, { method: 'PUT', body: { active } }); await load(); };
  const del = async (id: string) => { if (!confirm('Delete this link?')) return; await api(`/dashboard/links/${id}`, { method: 'DELETE' }); await load(); };
  const copy = (url: string, id: string) => { navigator.clipboard.writeText(url); setCopied(id); setTimeout(() => setCopied(''), 1500); };

  return (
    <>
      <PageTitle title="Payment Links & Invoices" subtitle="Get paid without code — create a link or invoice, share it, and the customer pays with KHQR." />

      <Card className="mb-6">
        <div className="mb-3 inline-flex rounded-lg bg-slate-100 p-0.5 text-sm">
          {(['LINK', 'INVOICE'] as const).map((t) => (
            <button key={t} onClick={() => setType(t)} className={`rounded-md px-3 py-1.5 font-medium ${type === t ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'}`}>
              {t === 'LINK' ? 'Payment link' : 'Invoice'}
            </button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm"><div className="mb-1 text-slate-600">{type === 'INVOICE' ? 'Invoice title' : 'What’s it for?'}</div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type === 'INVOICE' ? 'Invoice #1001' : 'Iced latte'} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm"><div className="mb-1 text-slate-600">Amount (blank = customer enters)</div>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
            <label className="text-sm"><div className="mb-1 text-slate-600">Currency</div>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"><option>USD</option><option>KHR</option></select></label>
          </div>
          {type === 'INVOICE' && (
            <label className="text-sm"><div className="mb-1 text-slate-600">Customer name</div>
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Sok Dara" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
          )}
          {type === 'LINK' && (
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={singleUse} onChange={(e) => setSingleUse(e.target.checked)} /> Single use (deactivate after first payment)</label>
          )}
        </div>
        <div className="mt-3"><Button onClick={create}>Create {type === 'INVOICE' ? 'invoice' : 'link'}</Button></div>
      </Card>

      <div className="space-y-2">
        {links.map((l) => (
          <Card key={l.id} className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{l.title}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{l.type}</span>
                {!l.active && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-400">inactive</span>}
              </div>
              <div className="text-sm text-slate-500">{l.amount ? `${l.amount} ${l.currency}` : 'Customer enters amount'}{l.customer_name ? ` · ${l.customer_name}` : ''} · paid {l.times_paid}×</div>
              <a href={l.url} target="_blank" rel="noreferrer" className="break-all text-xs text-brand-600 hover:underline">{l.url}</a>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => copy(l.url, l.id)} className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50">{copied === l.id ? 'Copied ✓' : 'Copy link'}</button>
              <button onClick={() => toggle(l.id, !l.active)} className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50">{l.active ? 'Deactivate' : 'Activate'}</button>
              <button onClick={() => del(l.id)} className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">Delete</button>
            </div>
          </Card>
        ))}
        {links.length === 0 && <Card className="text-center text-slate-400">No payment links yet. Create one above.</Card>}
      </div>
    </>
  );
}
