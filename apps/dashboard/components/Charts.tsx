'use client';

import React, { useId } from 'react';

interface Point { label: string; value: number }

/**
 * Dependency-free area chart (inline SVG). Renders a gradient-filled trend line
 * with an optional dashed forecast overlay. Responsive via viewBox.
 */
export function AreaChart({ data, forecast = [], height = 180, currency = '$' }: { data: Point[]; forecast?: Point[]; height?: number; currency?: string }) {
  const id = useId().replace(/:/g, '');
  const all = [...data, ...forecast];
  if (all.length === 0) return <div className="flex h-40 items-center justify-center text-sm text-slate-400">No data yet</div>;

  const W = 600, H = 200, PAD = 8;
  const max = Math.max(...all.map((d) => d.value), 1);
  const stepX = (W - PAD * 2) / Math.max(all.length - 1, 1);
  const x = (i: number) => PAD + i * stepX;
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);

  const line = (pts: Point[], offset = 0) => pts.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i + offset).toFixed(1)} ${y(d.value).toFixed(1)}`).join(' ');
  const histLine = line(data);
  const areaPath = data.length ? `${histLine} L ${x(data.length - 1)} ${H - PAD} L ${x(0)} ${H - PAD} Z` : '';
  const fcLine = forecast.length ? `M ${x(data.length - 1)} ${y(data[data.length - 1]?.value ?? 0)} ${line(forecast, data.length).replace(/^M/, 'L')}` : '';

  const last = data[data.length - 1];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1E5BD6" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#1E5BD6" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={PAD} x2={W - PAD} y1={H * g} y2={H * g} stroke="#eef2f7" strokeWidth="1" />)}
        {areaPath && <path d={areaPath} fill={`url(#grad-${id})`} />}
        {histLine && <path d={histLine} fill="none" stroke="#1E5BD6" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {fcLine && <path d={fcLine} fill="none" stroke="#93bbfd" strokeWidth="2.5" strokeDasharray="5 5" strokeLinecap="round" />}
        {last && <circle cx={x(data.length - 1)} cy={y(last.value)} r="3.5" fill="#1E5BD6" stroke="#fff" strokeWidth="2" />}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-slate-400">
        <span>{data[0]?.label}</span>
        {forecast.length > 0 && <span className="text-brand-400">— — forecast</span>}
        <span>{(forecast[forecast.length - 1] ?? last)?.label}</span>
      </div>
    </div>
  );
}

/** Tiny inline sparkline for KPI cards. */
export function Sparkline({ values, width = 120, height = 32, color = '#1E5BD6' }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * stepX).toFixed(1)} ${(height - ((v - min) / range) * height).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
