/**
 * Lightweight AI guardrails: screen user input for prompt-injection and
 * oversized payloads before it reaches the model, and scrub model output of
 * anything that looks like leaked secrets. Deterministic and dependency-free.
 */

const INJECTION_PATTERNS = [
  /ignore (all )?(previous|prior|above) (instructions|prompts)/i,
  /disregard (the )?(system|above) (prompt|instructions)/i,
  /you are now (a|an|in) /i,
  /reveal (your|the) (system prompt|instructions)/i,
  /\bDAN\b.*mode/i,
];

const MAX_INPUT_CHARS = 2000;

export interface Screen {
  allowed: boolean;
  reason?: string;
  text: string;
}

export function screenInput(text: string): Screen {
  const t = (text ?? '').trim();
  if (t.length === 0) return { allowed: false, reason: 'empty_input', text: t };
  if (t.length > MAX_INPUT_CHARS) return { allowed: false, reason: 'input_too_long', text: t.slice(0, MAX_INPUT_CHARS) };
  for (const p of INJECTION_PATTERNS) {
    if (p.test(t)) return { allowed: false, reason: 'prompt_injection', text: t };
  }
  return { allowed: true, text: t };
}

// Redact obvious secret shapes an over-eager model might echo.
const SECRET_PATTERNS: [RegExp, string][] = [
  [/\b(sk-[a-zA-Z0-9]{20,})\b/g, '[redacted-key]'],
  [/\bbk_(test|live)_[a-zA-Z0-9]{10,}\b/g, '[redacted-key]'],
  [/\b[A-Fa-f0-9]{64}\b/g, '[redacted-hash]'],
];

export function scrubOutput(text: string): string {
  let out = text;
  for (const [re, repl] of SECRET_PATTERNS) out = out.replace(re, repl);
  return out;
}
