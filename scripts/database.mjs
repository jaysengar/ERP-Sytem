import { createPostgresPool, openPostgres } from '../server/postgres.mjs';
import { migratePostgres } from '../server/migrate.mjs';

let pool;
try {
  const action = process.argv[2];
  if (!['migrate', 'check'].includes(action)) throw new Error('Use npm.cmd run db:migrate or npm.cmd run db:check.');
  pool = createPostgresPool();
  if (action === 'migrate') console.log(await migratePostgres(pool) ? 'PostgreSQL schema version 1 installed.' : 'PostgreSQL schema is already current.');
  const backend = await openPostgres({ pool });
  const status = await backend.registry.prepare('SELECT current_user AS role, version FROM schema_migrations WHERE version=1').get();
  if (status.role !== 'retail_app') throw new Error('The database must use the restricted retail_app role.');
  console.log('PostgreSQL connected; schema version ' + status.version + '; restricted server role verified.');
} catch (error) {
  // A connection string or raw provider error can contain credentials.
  const known = /^(Set DATABASE_URL|DATABASE_|Hosted PostgreSQL|Use |PostgreSQL |The database|The PostgreSQL)/.test(error.message);
  console.error(known ? error.message : 'Database setup failed. Check the connection, database privileges and provider availability. No credentials were printed.');
  process.exitCode = 1;
} finally { if (pool && !pool.ended) await pool.end(); }
