import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createStore } from './database.mjs';

export function postgresConfig(env = process.env) {
  let url;
  try { url = new URL(env.DATABASE_URL || ''); } catch { throw new Error('Set DATABASE_URL to your private PostgreSQL connection string.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2) throw new Error('DATABASE_URL must be a PostgreSQL connection string with a database name.');
  if (url.port === '6543' || env.DATABASE_POOL_MODE === 'transaction') throw new Error('Use the direct connection or session pooler (normally port 5432). Billing locks require session pooling.');
  // libpq URL options can override node-postgres TLS options. Configure TLS
  // explicitly here instead; never disable certificate verification.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl', 'uselibpqcompat']) url.searchParams.delete(key);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const sslMode = env.DATABASE_SSL || (local ? 'disable' : 'verify-full');
  if (!['disable', 'verify-full'].includes(sslMode) || (!local && sslMode === 'disable')) throw new Error('Hosted PostgreSQL requires DATABASE_SSL=verify-full.');
  const max = Number(env.DATABASE_POOL_SIZE || 10);
  if (!Number.isInteger(max) || max < 2 || max > 50) throw new Error('DATABASE_POOL_SIZE must be between 2 and 50.');
  return {
    connectionString: url.toString(), max, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
    ssl: sslMode === 'disable' ? false : { rejectUnauthorized: true, ...(env.DATABASE_CA_FILE ? { ca: readFileSync(env.DATABASE_CA_FILE, 'utf8') } : {}) },
    application_name: 'smart-retail-erp',
  };
}

export function createPostgresPool(env = process.env) {
  const options = postgresConfig(env);
  let pg;
  try { pg = createRequire(new URL('./postgres-runtime/package.json', import.meta.url))('pg'); }
  catch { throw new Error('PostgreSQL driver is not installed. Run npm.cmd run db:install, then retry.'); }
  const pool = new pg.Pool({ ...options, types: {
    // Existing domain records are serialized JSON at the repository boundary.
    getTypeParser(oid, format) {
      if (oid === 20) return value => {
        const number = Number(value);
        if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds the supported range.');
        return number;
      };
      if (oid === 114 || oid === 3802) return value => value;
      return pg.types.getTypeParser(oid, format);
    },
  } });
  pool.on('error', () => console.error('An idle PostgreSQL connection was lost. New requests will reconnect.'));
  return pool;
}

// Only fixed, parameterized statements from the server pass through this
// adapter. These are the few dialect differences in the shared repository.
export function postgresStatement(statement, tenant = false) {
  let text = statement.trim().replace(/;$/, '');
  const ignore = /^INSERT OR IGNORE INTO /i.test(text);
  text = text.replace(/^INSERT OR IGNORE INTO /i, 'INSERT INTO ');
  if (ignore) text += ' ON CONFLICT DO NOTHING';
  text = text.replace(/json_extract\(([\w.]+),\s*'\$\.(\w+)'\)/g, "($1->>'$2')");
  text = text.replace(/\bmax\(paid_until,\?\)/g, 'greatest(paid_until,?)');
  if (tenant) text = text.replace(/ON CONFLICT\(([^)]+)\)/g, 'ON CONFLICT(workspace_id,$1)');
  let parameter = 0;
  return text.replace(/\?/g, () => '$' + (++parameter));
}

export async function openPostgres({ pool = createPostgresPool(), checkSchema = true } = {}) {
  const context = new AsyncLocalStorage();
  async function connection(action) {
    const existing = context.getStore();
    if (existing) return action(existing);
    const client = await pool.connect();
    const state = { client, transaction: false, discard: false };
    try { return await context.run(state, () => action(state)); }
    finally { client.release(state.discard); }
  }
  async function transaction(action) {
    return connection(async state => {
      if (state.transaction) return action(state.client);
      await state.client.query('BEGIN');
      try {
        await state.client.query('SET LOCAL ROLE retail_app');
        await state.client.query("SET LOCAL search_path = pg_catalog, retail");
        const result = await context.run({ ...state, transaction: true }, () => action(state.client));
        await state.client.query('COMMIT');
        return result;
      } catch (error) { await state.client.query('ROLLBACK').catch(() => { state.discard = true; }); throw error; }
    });
  }
  function sqlFor(workspaceId = '') {
    if (workspaceId && !/^[a-f0-9-]{36}$/.test(workspaceId)) throw new Error('Invalid internal workspace ID.');
    const query = (statement, args) => transaction(async client => {
      await client.query("SELECT set_config('retail.workspace_id', $1, true)", [workspaceId]);
      return client.query(postgresStatement(statement, Boolean(workspaceId)), args);
    });
    return {
      dialect: 'postgres',
      prepare(statement) {
        return {
          get: async (...args) => (await query(statement, args)).rows[0],
          all: async (...args) => (await query(statement, args)).rows,
          run: async (...args) => ({ changes: (await query(statement, args)).rowCount }),
        };
      },
      atomic: action => transaction(async client => {
        if (workspaceId) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['records:' + workspaceId]);
        return action();
      }),
      // Keep the session lock across independently committed billing writes.
      // Wrapping refunds in one transaction could lose a submitted request
      // on a process crash and allow a duplicate refund.
      withLock: (key, action) => connection(async state => {
        if (state.transaction) throw new Error('Billing locks cannot run inside a database transaction.');
        await state.client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', ['billing:' + key]);
        try { return await action(); }
        finally {
          try { await state.client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', ['billing:' + key]); }
          catch { state.discard = true; }
        }
      }),
      close: async () => {},
    };
  }
  const registry = sqlFor();
  try {
    if (checkSchema) {
      const row = await registry.prepare('SELECT version FROM schema_migrations WHERE version=1').get();
      if (!row) throw new Error('Missing schema version.');
    }
  } catch { await pool.end(); throw new Error('PostgreSQL is not ready. Check DATABASE_URL and run npm.cmd run db:migrate.'); }
  return { registry, tenant: id => createStore(sqlFor(id)), close: () => pool.end(), pool };
}
