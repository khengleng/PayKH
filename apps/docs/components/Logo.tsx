export function LogoMark({ size = 30, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" className={className} aria-hidden>
      <rect width="512" height="512" rx="112" fill="#1E5BD6" />
      <path d="M170 128h118c62 0 104 40 104 98 0 60-44 100-108 100h-56v58h-58V128zm58 52v96h50c30 0 48-18 48-48s-18-48-48-48h-50z" fill="#fff" />
      <path d="M300 210l58 34-58 34z" fill="#1E5BD6" />
    </svg>
  );
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <LogoMark size={28} />
      <span className="text-[16px] font-bold tracking-tight text-slate-900">
        pay<span className="text-brand-600">KH</span>
      </span>
      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Docs</span>
    </span>
  );
}
