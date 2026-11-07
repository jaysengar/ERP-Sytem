import type { Database, Page, Product, ProductQuery } from '../domain/types';
import { seedDatabase } from './seed';
import { queryProducts } from '../domain/transactions';

export const STORAGE_KEY = 'smart-retail-demo:v1';
export interface RetailRepository {
  load(): Promise<Database>;
  listProducts(query: ProductQuery): Promise<Page<Product>>;
  transaction<T>(operation: (draft: Database) => T): Promise<{ data: Database; result: T }>;
}
function read(): Database {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) { const db = seedDatabase(); localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); return db; }
  try {
    const db = JSON.parse(saved) as Database;
    if (db.version !== 1 || !Number.isInteger(db.revision) || !db.settings || !['products', 'sales', 'purchases', 'customers', 'suppliers', 'expenses', 'staff', 'movements'].every(k => Array.isArray(db[k as keyof Database]))) throw new Error();
    return db;
  } catch { throw new Error('Saved demo data could not be read. Export or clear this site’s data in browser settings to start again. Your saved data has not been overwritten.'); }
}
// A single atomic document is suitable for this local demo. Future API endpoints
// replace this adapter; production transactions and authorization belong on the server.
class LocalRetailRepository implements RetailRepository {
  private queue: Promise<unknown> = Promise.resolve();
  async load() { return read(); }
  async listProducts(query: ProductQuery) { return queryProducts(read(), query); }
  async transaction<T>(operation: (draft: Database) => T) {
    const run = () => {
      const draft = read(); const result = operation(draft); draft.revision++;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(draft)); } catch { throw new Error('This browser could not save the change. Check available storage; no changes have been applied.'); }
      return { data: draft, result };
    };
    const task = this.queue.then(() => navigator.locks ? navigator.locks.request(STORAGE_KEY, run) : run());
    this.queue = task.catch(() => undefined); return task;
  }
}
export const repository: RetailRepository = new LocalRetailRepository();
