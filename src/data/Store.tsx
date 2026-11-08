import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Database, Role, Staff } from '../domain/types';
import type { Commands } from '../domain/commands';
import { ApiError, repository, request } from './repository';
import type { Session, Snapshot, Workspace } from './repository';
import { Auth } from '../components/Auth';
interface StoreValue {
  db: Database; role: Role; user: Staff; connected: boolean; workspace?: Workspace;
  mutate: <K extends keyof Commands>(type: K, input: Commands[K]['input'], expectedRevision?: number) => Promise<Commands[K]['result']>;
  logout: () => Promise<void>; refresh: () => Promise<void>;
  toast: (message: string, error?: boolean) => void;
}
const Store = createContext<StoreValue | null>(null);
export function StoreProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const current = useRef<Snapshot | null>(null); const generation = useRef(0);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState(''); const [connected, setConnected] = useState(true);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const toast = (message: string, isError = false) => setNotice({ message, error: isError });
  const accept = useCallback((next: Snapshot) => {
    if (!current.current || next.data.revision >= current.current.data.revision) { current.current = next; setSnapshot(next); }
    setConnected(true);
  }, []);
  const refresh = useCallback(async (changedOnly = false) => {
    const epoch = generation.current;
    try {
      const next = await repository.load(changedOnly ? current.current?.data.revision : undefined);
      if (epoch !== generation.current) return;
      if (next) accept(next); else setConnected(true);
    } catch (e) { if (epoch === generation.current) setConnected(false); throw e; }
  }, [accept]);
  const boot = useCallback(async () => {
    setError('');
    try { const next = await repository.session(); setSession(next); if (next.user) await refresh(); }
    catch (e) { setError((e as Error).message); }
  }, [refresh]);
  useEffect(() => { void boot(); }, [boot]);
  useEffect(() => {
    const expired = () => { generation.current++; current.current = null; setSnapshot(null); setSession({ user: null, setupRequired: false, setupKeyRequired: false }); setNotice(null); };
    window.addEventListener('retail-session-expired', expired);
    return () => window.removeEventListener('retail-session-expired', expired);
  }, []);
  useEffect(() => {
    if (!session?.user) return;
    const reload = () => { if (document.visibilityState === 'visible') void refresh(true).catch(() => undefined); };
    const timer = setInterval(reload, 15000);
    window.addEventListener('focus', reload); document.addEventListener('visibilitychange', reload);
    return () => { clearInterval(timer); window.removeEventListener('focus', reload); document.removeEventListener('visibilitychange', reload); };
  }, [session?.user, refresh]);
  useEffect(() => { if (!notice) return; const timeout = setTimeout(() => setNotice(null), 6000); return () => clearTimeout(timeout); }, [notice]);
  async function mutate<K extends keyof Commands>(type: K, input: Commands[K]['input'], expectedRevision?: number): Promise<Commands[K]['result']> {
    const state = current.current; const epoch = generation.current;
    if (!state) throw new Error('Please sign in again.');
    try { const next = await repository.command(state.user.id, type, input, expectedRevision ?? state.data.revision); if (epoch === generation.current) accept(next); return next.result; }
    catch (e) {
      if (e instanceof ApiError && (e.status === 409 || e.status === 402)) await refresh().catch(() => undefined);
      if (e instanceof ApiError && e.status === 0) setConnected(false);
      throw e;
    }
  }
  async function logout() {
    try { await request('/auth/logout', {}); }
    catch (e) { toast((e as Error).message, true); return; }
    generation.current++; current.current = null; setSnapshot(null); setNotice(null);
    sessionStorage.removeItem('smart-retail-cart');
    setSession({ user: null, setupRequired: false, setupKeyRequired: false });
  }
  if (error) return <div className="boot-error"><h1>Could not connect to your store</h1><p>{error}</p><button className="btn primary" onClick={() => void boot()}>Try again</button></div>;
  if (session && !session.user) return <Auth onSuccess={boot} />;
  if (!snapshot) return <div className="loading-screen" role="status"><div className="skeleton" /><div className="skeleton" /><p>Opening your store...</p></div>;
  return <Store.Provider value={{ db: snapshot.data, role: snapshot.user.role, user: snapshot.user, workspace: snapshot.workspace, connected, mutate, logout, refresh, toast }}>{children}{notice && <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.message}<button aria-label="Dismiss notification" onClick={() => setNotice(null)}>&times;</button></div>}</Store.Provider>;
}
export function useStore() { const store = useContext(Store); if (!store) throw new Error('StoreProvider is missing.'); return store; }
