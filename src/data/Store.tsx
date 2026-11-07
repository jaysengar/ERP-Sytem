import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Database, Role } from '../domain/types';
import { repository, STORAGE_KEY } from './repository';
interface StoreValue { db: Database; role: Role; setRole: (role: Role) => void; mutate: <T,>(operation: (draft: Database) => T) => Promise<T>; toast: (message: string, error?: boolean) => void }
const Store = createContext<StoreValue | null>(null);
export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Database | null>(null); const [role, setRole] = useState<Role>('Owner / Admin');
  const [error, setError] = useState(''); const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const toast = (message: string, isError = false) => setNotice({ message, error: isError });
  useEffect(() => { const reload = () => repository.load().then(setDb).catch(e => setError(e.message)); void reload(); const listen = (e: StorageEvent) => { if (e.key === STORAGE_KEY) void reload(); }; window.addEventListener('storage', listen); return () => window.removeEventListener('storage', listen); }, []);
  useEffect(() => { if (!notice) return; const timeout = setTimeout(() => setNotice(null), 5000); return () => clearTimeout(timeout); }, [notice]);
  async function mutate<T,>(operation: (draft: Database) => T) { const saved = await repository.transaction(operation); setDb(saved.data); return saved.result; }
  if (error) return <div className="boot-error"><h1>Let’s recover your demo</h1><p>{error}</p><button className="btn primary" onClick={() => window.location.reload()}>Try again</button></div>;
  if (!db) return <div className="loading-screen" role="status"><div className="skeleton" /><div className="skeleton" /><p>Opening your store…</p></div>;
  return <Store.Provider value={{ db, role, setRole, mutate, toast }}>{children}{notice && <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.message}<button aria-label="Dismiss notification" onClick={() => setNotice(null)}>×</button></div>}</Store.Provider>;
}
export function useStore() { const store = useContext(Store); if (!store) throw new Error('Store provider is missing'); return store; }
