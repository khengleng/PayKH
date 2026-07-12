import Link from 'next/link';

const TONES: Record<string, string> = {
  info: 'border-brand-200 bg-brand-50/50 text-brand-900',
  warn: 'border-amber-200 bg-amber-50/60 text-amber-900',
  success: 'border-emerald-200 bg-emerald-50/60 text-emerald-900',
};
const ICONS: Record<string, string> = { info: 'ℹ️', warn: '⚠️', success: '✅' };

export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'success'; title?: string; children: React.ReactNode }) {
  return (
    <div className={`my-6 rounded-xl border px-4 py-3 text-sm ${TONES[tone]}`}>
      {title && <div className="mb-1 flex items-center gap-2 font-semibold">{ICONS[tone]} {title}</div>}
      <div className="[&_a]:underline">{children}</div>
    </div>
  );
}

export function Cards({ children }: { children: React.ReactNode }) {
  return <div className="not-prose my-6 grid gap-4 sm:grid-cols-2">{children}</div>;
}

export function LinkCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  const external = href.startsWith('http');
  const cls = 'block rounded-xl border border-slate-200 p-4 transition hover:border-brand-300 hover:shadow-card';
  const inner = (
    <>
      <div className="font-semibold text-slate-900">{title} <span className="text-brand-500">→</span></div>
      <div className="mt-1 text-sm text-slate-500">{desc}</div>
    </>
  );
  return external ? <a href={href} className={cls}>{inner}</a> : <Link href={href} className={cls}>{inner}</Link>;
}

export function PageNav({ prev, next }: { prev?: { title: string; href: string }; next?: { title: string; href: string } }) {
  return (
    <div className="not-prose mt-12 flex items-stretch justify-between gap-4 border-t border-slate-100 pt-6">
      {prev ? (
        <Link href={prev.href} className="flex-1 rounded-xl border border-slate-200 p-3 hover:border-brand-300">
          <div className="text-xs text-slate-400">← Previous</div>
          <div className="font-medium text-slate-800">{prev.title}</div>
        </Link>
      ) : <div className="flex-1" />}
      {next ? (
        <Link href={next.href} className="flex-1 rounded-xl border border-slate-200 p-3 text-right hover:border-brand-300">
          <div className="text-xs text-slate-400">Next →</div>
          <div className="font-medium text-slate-800">{next.title}</div>
        </Link>
      ) : <div className="flex-1" />}
    </div>
  );
}
