import test from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite } from '../server/sqlite.mjs';
import { postgresConfig, postgresStatement, openPostgres } from '../server/postgres.mjs';

test('Supabase configuration verifies TLS, strips URL TLS overrides and rejects transaction pooling', () => {
  const config = postgresConfig({ DATABASE_URL: 'postgresql://postgres.project:secret@db.example.test:5432/postgres?sslmode=no-verify' });
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(new URL(config.connectionString).searchParams.has('sslmode'), false);
  assert.throws(() => postgresConfig({ DATABASE_URL: 'postgresql://user:secret@db.example.test:6543/postgres' }), /session pooler/);
  assert.throws(() => postgresConfig({ DATABASE_URL: 'postgresql://user:secret@db.example.test/postgres', DATABASE_SSL: 'disable' }), /requires/);
  assert.throws(() => postgresConfig({}), /Set DATABASE_URL/);
  assert.equal(postgresConfig({ DATABASE_URL: 'postgresql://user:secret@127.0.0.1/test' }).ssl, false);
});

test('PostgreSQL statements scope conflict targets and keep values parameterized', () => {
  assert.equal(postgresStatement('INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data', true),
    'INSERT INTO records(kind,id,data) VALUES($1,$2,$3) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET data=excluded.data');
  assert.equal(postgresStatement('INSERT OR IGNORE INTO webhook_events VALUES(?,?)'),
    'INSERT INTO webhook_events VALUES($1,$2) ON CONFLICT DO NOTHING');
  assert.equal(postgresStatement("SELECT data FROM records WHERE lower(json_extract(data,'$.email'))=?"),
    "SELECT data FROM records WHERE lower((data->>'email'))=$1");
});

test('SQLite does not expose an async transaction before commit and rolls back failed writes', async () => {
  const sql = openSqlite(':memory:');
  try {
    await sql.exec('CREATE TABLE example(id INTEGER)');
    let entered, release;
    const started = new Promise(resolve => { entered = resolve; });
    const resume = new Promise(resolve => { release = resolve; });
    const writing = sql.atomic(async () => {
      await sql.prepare('INSERT INTO example VALUES(?)').run(1);
      entered(); await resume;
      throw new Error('rollback this transaction');
    });
    await started;
    let observed = false;
    const reading = sql.prepare('SELECT * FROM example').all().then(rows => { observed = true; return rows; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(observed, false);
    release();
    await assert.rejects(writing, /rollback/);
    assert.deepEqual(await reading, []);
    await sql.atomic(async () => { await sql.prepare('INSERT INTO example VALUES(?)').run(2); });
    assert.equal((await sql.prepare('SELECT * FROM example').get()).id, 2);
  } finally { await sql.close(); }
});

function fakePool() {
  const calls = [], released = [];
  let sequence = 0;
  return {
    calls, released, ended: false,
    async connect() {
      const id = ++sequence;
      return {
        query: async (text, args = []) => {
          calls.push({ id, text, args });
          if (text === 'FAIL') throw new Error('simulated statement failure');
          return { rows: [], rowCount: 1 };
        },
        release: discard => released.push({ id, discard }),
      };
    },
    async end() { this.ended = true; },
  };
}

test('PostgreSQL transactions set restricted role and workspace for every query, and roll back on failure', async () => {
  const pool = fakePool(), backend = await openPostgres({ pool, checkSchema: false });
  const id = '11111111-1111-4111-8111-111111111111';
  const sql = backend.tenant(id).sql;
  await assert.rejects(sql.atomic(async () => {
    await sql.prepare('SELECT data FROM records WHERE id=?').all('bound-value');
    await sql.prepare('FAIL').run();
  }), /simulated statement failure/);
  assert.equal(pool.calls.filter(call => call.text === 'BEGIN').length, 1);
  assert.ok(pool.calls.some(call => call.text === 'SET LOCAL ROLE retail_app'));
  assert.ok(pool.calls.some(call => call.text.includes('advisory_xact_lock')));
  assert.ok(pool.calls.some(call => call.text.includes('set_config') && call.args[0] === id));
  assert.ok(pool.calls.some(call => call.text.includes('WHERE id=$1') && call.args[0] === 'bound-value'));
  assert.equal(pool.calls.at(-1).text, 'ROLLBACK');
  assert.equal(pool.released.length, 1);
  await backend.registry.prepare('SELECT id FROM workspaces').all();
  assert.ok(pool.calls.some(call => call.text.includes('set_config') && call.args[0] === ''));
  await backend.close();
});

test('PostgreSQL billing locks keep refund status committed before the provider call', async () => {
  const pool = fakePool(), backend = await openPostgres({ pool, checkSchema: false });
  await backend.registry.withLock('workspace', async () => {
    await backend.registry.prepare('UPDATE refund_requests SET status=? WHERE workspace_id=?').run('submitting', 'workspace');
    assert.equal(pool.calls.at(-1).text, 'COMMIT');
    assert.equal(pool.calls.filter(call => call.text.includes('advisory_unlock')).length, 0);
    pool.calls.push({ text: 'PROVIDER_REFUND' });
    await backend.registry.prepare('UPDATE refund_requests SET status=? WHERE workspace_id=?').run('processed', 'workspace');
  });
  assert.ok(pool.calls[0].text.includes('pg_advisory_lock'));
  assert.ok(pool.calls.at(-1).text.includes('pg_advisory_unlock'));
  assert.equal(new Set(pool.calls.filter(call => call.id).map(call => call.id)).size, 1);
  assert.equal(pool.released.length, 1);
  await backend.close();
});
