'use client';
import { useEffect, useMemo, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://api.paykh.cambobia.com';
const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete'];

interface Op { method: string; path: string; summary: string; tag: string }

export default function Page() {
  const [ops, setOps] = useState<Op[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/docs-json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((spec) => {
        const out: Op[] = [];
        for (const [path, item] of Object.entries<any>(spec.paths ?? {})) {
          for (const method of METHOD_ORDER) {
            const op = item[method];
            if (!op) continue;
            out.push({ method, path, summary: op.summary ?? '', tag: (op.tags && op.tags[0]) || 'Other' });
          }
        }
        setOps(out);
      })
      .catch((e) => setErr(String(e)));
  }, []);

  const grouped = useMemo(() => {
    if (!ops) return [];
    const term = q.trim().toLowerCase();
    const filtered = term ? ops.filter((o) => (o.path + ' ' + o.summary + ' ' + o.method).toLowerCase().includes(term)) : ops;
    const map = new Map<string, Op[]>();
    for (const o of filtered) { if (!map.has(o.tag)) map.set(o.tag, []); map.get(o.tag)!.push(o); }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [ops, q]);

  return (
    <>
      <h1>API reference</h1>
      <p>
        Every endpoint in the PayKH API, generated live from the OpenAPI specification. For an interactive
        playground where you can authenticate and send requests, open the{' '}
        <a href={`${API_BASE}/docs`} target="_blank" rel="noreferrer">Swagger explorer</a> or import the{' '}
        <a href={`${API_BASE}/docs-json`} target="_blank" rel="noreferrer">OpenAPI JSON</a>.
      </p>

      <div className="not-prose my-6 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter endpoints…"
          className="w-full max-w-xs rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 sm:w-64"
        />
        <a href={`${API_BASE}/docs`} target="_blank" rel="noreferrer" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700">Open interactive explorer →</a>
      </div>

      {err && (
        <div className="not-prose rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Couldn&rsquo;t load the live spec ({err}). You can still browse it at{' '}
          <a className="underline" href={`${API_BASE}/docs`}>{API_BASE}/docs</a>.
        </div>
      )}
      {!ops && !err && <div className="not-prose text-sm text-slate-400">Loading endpoints…</div>}

      {grouped.map(([tag, list]) => (
        <div key={tag} className="not-prose mb-8">
          <h2 className="mb-3 mt-8 border-b border-slate-100 pb-2 text-lg font-semibold capitalize text-slate-900">{tag}</h2>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
            {list.map((o, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                <span className={`pill-${o.method} inline-flex w-16 shrink-0 justify-center rounded-md px-2 py-0.5 text-xs font-bold uppercase ring-1 ring-inset`}>{o.method}</span>
                <code className="shrink-0 font-mono text-[13px] text-slate-800">{o.path}</code>
                <span className="truncate text-sm text-slate-500">{o.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
