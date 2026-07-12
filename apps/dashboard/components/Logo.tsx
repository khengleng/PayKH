export function LogoMark({ size = 32, className = '' }: { size?: number; className?: string }) {
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
      <LogoMark size={30} />
      <span className="text-[17px] font-bold tracking-tight">
        pay<span className="text-brand-600">KH</span>
      </span>
    </span>
  );
}
