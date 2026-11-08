import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { collections } from './database.mjs';

const workspaceFields = ['id','slug','name','owner_email','trial_end','subscription_id','subscription_status','paid_until','checkout_url','created_at','cancel_pending','billing_policy','first_payment_id','first_subscription_id','first_paid_at','refund_deadline'];
const refundFields = ['workspace_id','subscription_id','payment_id','requested_at','status','receipt','provider_refund_id','attempted_amount','updated_at'];
const cancellationFields = ['workspace_id','subscription_id','requested_at','kind','completed'];
const tableExists = (db, table) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
const records = (db, table) => tableExists(db, table) ? db.prepare('SELECT * FROM ' + table).all() : [];

export function readSqliteImport(sourceDir) {
  const platform = new DatabaseSync(resolve(sourceDir, 'platform.sqlite'), { readOnly: true });
  try {
    const workspaces = records(platform, 'workspaces').map(row => {
      if (!/^[a-f0-9-]{36}$/.test(row.id)) throw new Error('The source contains an invalid internal workspace ID.');
      const tenant = new DatabaseSync(resolve(sourceDir, row.id + '.sqlite'), { readOnly: true });
      try {
        const meta = tenant.prepare('SELECT * FROM metadata WHERE id=1').get();
        if (!meta) throw new Error('A source workspace is missing its records.');
        const db = { version: 1, revision: meta.revision, settings: JSON.parse(meta.settings) };
        for (const kind of collections) db[kind] = [];
        for (const record of tenant.prepare('SELECT kind,data FROM records ORDER BY kind,position').all()) {
          if (!collections.includes(record.kind)) throw new Error('Unsupported source record type.');
          db[record.kind].push(JSON.parse(record.data));
        }
        return { row: { cancel_pending: 0, billing_policy: 'legacy_trial', ...row }, db,
          credentials: records(tenant, 'credentials'), requests: records(tenant, 'requests'), audit: records(tenant, 'audit') };
      } finally { tenant.close(); }
    });
    return { workspaces, refunds: records(platform, 'refund_requests'), cancellations: records(platform, 'cancellation_requests'), events: records(platform, 'webhook_events') };
  } finally { platform.close(); }
}

export async function importIntoPostgres(backend, source) {
  const insert = async (sql, table, fields, row) => sql.prepare('INSERT INTO ' + table + '(' + fields.join(',') + ') VALUES(' + fields.map(() => '?').join(',') + ')').run(...fields.map(field => row[field] ?? null));
  await backend.registry.atomic(async () => {
    // An import is an offline operation into an empty target. All imported
    // tables commit together; the source files are opened read-only.
    if (await backend.registry.prepare('SELECT 1 FROM workspaces LIMIT 1').get()) throw new Error('Import requires an empty PostgreSQL target. Existing workspaces will not be overwritten.');
    for (const workspace of source.workspaces) {
      await insert(backend.registry, 'workspaces', workspaceFields, workspace.row);
      const store = backend.tenant(workspace.row.id);
      await store.atomic(async () => {
        await store.write(workspace.db);
        for (const row of workspace.credentials) await insert(store.sql, 'credentials', ['staff_id','password_hash'], row);
        for (const row of workspace.requests) await insert(store.sql, 'requests', ['actor','key','fingerprint','result'], row);
        for (const row of workspace.audit) await insert(store.sql, 'audit', ['actor','action','revision','created_at'], row);
      });
    }
    for (const row of source.refunds) await insert(backend.registry, 'refund_requests', refundFields, row);
    for (const row of source.cancellations) await insert(backend.registry, 'cancellation_requests', cancellationFields, row);
    for (const row of source.events) await insert(backend.registry, 'webhook_events', ['id','received_at'], row);
  });
}
