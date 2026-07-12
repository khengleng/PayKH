'use client';
import { useState } from 'react';

/**
 * A copyable code block. Pass raw code as `code`. Optional `lang` label and
 * `title` (e.g. a filename or shell prompt) render in the header bar.
 */
export function CodeBlock({ code, lang, title }: { code: string; lang?: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="group my-5 overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-700/60 px-4 py-2">
        <span className="font-mono text-xs text-slate-400">{title ?? lang ?? 'code'}</span>
        <button
          onClick={copy}
          className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          aria-label="Copy code"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-4 text-[13px] leading-6">
        <code className="font-mono text-slate-100">{code}</code>
      </pre>
    </div>
  );
}
