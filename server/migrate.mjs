import { readFile } from 'node:fs/promises';

export async function migratePostgres(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smart-retail:migrations', 0))");
    const existing = await client.query("SELECT to_regclass('retail.schema_migrations') AS name");
    if (existing.rows[0].name) {
      const current = await client.query('SELECT version FROM retail.schema_migrations ORDER BY version DESC LIMIT 1');
      if (current.rows[0]?.version !== 1) throw new Error('The PostgreSQL schema version is unsupported.');
      await client.query('COMMIT');
      return false;
    }
    await client.query(await readFile(new URL('./migrations/001_postgres.sql', import.meta.url), 'utf8'));
    await client.query('COMMIT');
    return true;
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}
