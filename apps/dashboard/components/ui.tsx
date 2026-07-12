'use client';

import React from 'react';

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200/70 bg-white p-5 shadow-card transition-shadow hover:shadow-card-hover ${className}`}>
      {children}
    </div>
  );
}

const STAT_ACCENT: Record<string, string> = {
  brand: 'bg-brand-50 text-brand-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
  slate: 'bg-slate-100 text-slate-500',
};

export function Stat({
  label,
  value,
  hint,
  icon,
  accent = 'brand',
  trend,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  accent?: keyof typeof STAT_ACCENT;
  trend?: { value: string; up: boolean };
}) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-card transition-shadow hover:shadow-card-hover">
      <div className="flex items-start justify-between">
        <div className="text-sm font-medium text-slate-500">{label}</div>
        {icon && <div className={`flex h-9 w-9 items-center justify-center rounded-xl text-lg ${STAT_ACCENT[accent]}`}>{icon}</div>}
      </div>
      <div className="mt-2 text-[26px] font-semibold leading-none tracking-tight text-slate-900">{value}</div>
      <div className="mt-1.5 flex items-center gap-2">
        {trend && (
          <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${trend.up ? 'text-emerald-600' : 'text-red-500'}`}>
            {trend.up ? '▲' : '▼'} {trend.value}
          </span>
        )}
        {hint && <span className="text-xs text-slate-400">{hint}</span>}
      </div>
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled,
  type = 'button',
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  const variants = {
    primary: 'bg-brand-500 text-white shadow-sm hover:bg-brand-600 active:bg-brand-700',
    secondary: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300',
    danger: 'border border-red-200 bg-white text-red-600 hover:bg-red-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
  }[variant];
  const sizes = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-4 py-2 text-sm' }[size];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60 ${sizes} ${variants} ${className}`}
    >
      {children}
    </button>
  );
}

const STATUS_COLORS: Record<string, string> = {
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  scanned: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  expired: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  failed: 'bg-red-50 text-red-700 ring-red-600/20',
  refunded: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  cancelled: 'bg-slate-100 text-slate-500 ring-slate-500/20',
};
const STATUS_DOT: Record<string, string> = {
  paid: 'bg-emerald-500', completed: 'bg-emerald-500', pending: 'bg-amber-500', scanned: 'bg-brand-500',
  expired: 'bg-slate-400', failed: 'bg-red-500', refunded: 'bg-violet-500', cancelled: 'bg-slate-400',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-600 ring-slate-500/20'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status] ?? 'bg-slate-400'}`} />
      {status}
    </span>
  );
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** Shimmer skeleton for loading states. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function StatSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-card">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-7 w-16" />
    </div>
  );
}
