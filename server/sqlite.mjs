import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Serialize complete async transactions, not just individual statements.
// A second request must never read another request's uncommitted changes.
export function openSqlite(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const raw = new DatabaseSync(filename);
  raw.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const context = new AsyncLocalStorage();
  const locks = new Map();
  let queue = Promise.resolve();
  function exclusive(action) {
    if (context.getStore()) return action();
    const task = queue.catch(() => undefined).then(() => context.run(true, action));
    queue = task;
    return task;
  }
  return {
    dialect: 'sqlite',
    prepare(statement) {
      const prepared = raw.prepare(statement);
      return Object.fromEntries(['get', 'all', 'run'].map(method => [method, (...args) => exclusive(() => prepared[method](...args))]));
    },
    exec: statement => exclusive(() => raw.exec(statement)),
    async atomic(action) {
      if (context.getStore()) return action();
      return exclusive(async () => {
        raw.exec('BEGIN IMMEDIATE');
        try { const result = await action(); raw.exec('COMMIT'); return result; }
        catch (error) { raw.exec('ROLLBACK'); throw error; }
      });
    },
    async withLock(key, action) {
      const previous = locks.get(key) || Promise.resolve();
      const task = previous.catch(() => undefined).then(action);
      locks.set(key, task);
      try { return await task; } finally { if (locks.get(key) === task) locks.delete(key); }
    },
    close: () => exclusive(() => raw.close()),
  };
}
