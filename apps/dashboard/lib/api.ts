export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

const TOKEN_KEY = 'paykh_token';
const ORG_KEY = 'paykh_org';
const STORE_KEY = 'paykh_store';

export const tokenStore = {
  get: () => (typeof window === 'undefined' ? null : localStorage.getItem(TOKEN_KEY)),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ORG_KEY);
    localStorage.removeItem(STORE_KEY);
  },
};

export const orgStore = {
  get: () => (typeof window === 'undefined' ? null : localStorage.getItem(ORG_KEY)),
  set: (id: string) => localStorage.setItem(ORG_KEY, id),
};

export const storeStore = {
  get: () => (typeof window === 'undefined' ? null : localStorage.getItem(STORE_KEY)),
  set: (id: string) => localStorage.setItem(STORE_KEY, id),
};

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, auth = true } = options;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = tokenStore.get();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = data as { error?: string; message?: string };
    throw new ApiError(err?.error ?? 'error', err?.message ?? `HTTP ${res.status}`, res.status);
  }
  return data as T;
}
