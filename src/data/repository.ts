import type { Database, Page, Product, ProductQuery, Staff } from '../domain/types';
import type { Commands } from '../domain/commands';
export const STORAGE_KEY = 'smart-retail-demo:v1';
export interface Session { user: Staff | null; setupRequired: boolean; setupKeyRequired: boolean }
export interface Workspace {
  name: string; slug: string; amount: number; currency: string; policy: string; legacyTrial: boolean;
  trialEndsAt: string; paidUntil: string | null; status: string; canWrite: boolean; configured: boolean;
  hasSubscription: boolean; checkoutUrl: string | null; cancelPending: boolean;
  refundEligible: boolean; refundDeadline: string | null; refundStatus: string | null; refundId: string | null; refundAmount: number; refundForCurrentSubscription: boolean;
}
export interface Snapshot { data: Database; user: Staff; workspace?: Workspace }
// Freeze the workspace per page/tab. Switching accounts in another tab must
// never silently send an open form to that other business.
let activeWorkspace = (() => { try { return localStorage.getItem('retail-workspace') || ''; } catch { return ''; } })();
export function getWorkspace() { return activeWorkspace; }
export function setWorkspace(slug: string) { activeWorkspace = slug; localStorage.setItem('retail-workspace', slug); }
function apiPath(path: string) {
  if (path.startsWith('/public/')) return `/api${path}`;
  const workspace = getWorkspace();
  if (!workspace && path === '/auth/session') return '/api/public/session';
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(workspace)) throw new ApiError(400, 'Enter your workspace ID to sign in.');
  return `/api/w/${encodeURIComponent(workspace)}${path}`;
}
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export async function request<T>(path: string, payload?: unknown, headers?: Record<string, string>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiPath(path), { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000),
      method: payload === undefined ? 'GET' : 'POST',
      headers: payload === undefined ? undefined : { 'Content-Type': 'application/json', 'X-Retail-Request': '1', ...headers },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch { throw new ApiError(0, 'The store server could not be reached. Check the connection and try again. If a save was interrupted, retry the same action to check its result.'); }
  if (response.status === 204) return null as T;
  const value = await response.json().catch(() => ({ error: 'The store server is unavailable. Start the backend and try again.' }));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('retail-session-expired'));
    throw new ApiError(response.status, value.error || 'The request could not be completed.');
  }
  return value as T;
}
const pending = new Map<string, string>();
export const repository = {
  session: async () => { try { return await request<Session>('/auth/session'); } catch (e) { if (e instanceof ApiError && e.status === 404) return { user: null, setupRequired: false, setupKeyRequired: false }; throw e; } },
  load: (revision?: number) => request<Snapshot | null>(`/state${revision === undefined ? '' : `?since=${revision}`}`),
  listProducts: (query: ProductQuery) => request<Page<Product>>(`/products?${new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))}`),
  async command<K extends keyof Commands>(actor: string, type: K, input: Commands[K]['input'], expectedRevision: number) {
    const signature = JSON.stringify({ workspace: getWorkspace(), actor, type, input });
    // Keep uncertain request keys across reloads, but never persist passwords.
    const storageKey = type === 'staff.save' ? null : `retail-pending:${getWorkspace()}:${actor}:${type}`;
    let saved: { signature: string; key: string } | null = null;
    try { saved = storageKey ? JSON.parse(sessionStorage.getItem(storageKey) || 'null') : null; } catch { /* Optional draft storage. */ }
    const key = pending.get(signature) || (saved?.signature === signature ? saved.key : crypto.randomUUID());
    pending.set(signature, key);
    try { if (storageKey) sessionStorage.setItem(storageKey, JSON.stringify({ signature, key })); } catch { /* In-memory retries remain available. */ }
    const clear = () => { pending.delete(signature); try { if (storageKey) sessionStorage.removeItem(storageKey); } catch { /* Optional storage. */ } };
    try {
      const result = await request<Snapshot & { result: Commands[K]['result'] }>('/commands', { type, input, expectedRevision }, { 'Idempotency-Key': key });
      clear(); return result;
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) clear();
      throw error;
    }
  },
};
