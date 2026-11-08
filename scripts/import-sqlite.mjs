import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSqliteImport, importIntoPostgres } from '../server/import-sqlite.mjs';
import { openPostgres } from '../server/postgres.mjs';

let backend;
try {
  const args = process.argv.slice(2);
  const sourceFlag = args.indexOf('--source');
  if (sourceFlag !== -1 && !args[sourceFlag + 1]) throw new Error('Provide a folder after --source.');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const sourceDir = resolve(root, sourceFlag === -1 ? process.env.DATA_DIR || 'server/data' : args[sourceFlag + 1]);
  if (args.includes('--apply') && !args.includes('--source-stopped')) throw new Error('Stop the source ERP server and destination registration before importing, then add --source-stopped.');
  const source = readSqliteImport(sourceDir);
  const recordCount = source.workspaces.reduce((count, workspace) => count + Object.values(workspace.db).filter(Array.isArray).reduce((sum, records) => sum + records.length, 0), 0);
  console.log('Source: ' + source.workspaces.length + ' workspaces, ' + recordCount + ' business records, ' + source.refunds.length + ' refund requests.');
  if (!args.includes('--apply')) console.log('Read-only preview. To import into an empty PostgreSQL database after stopping the source server: npm.cmd run db:import -- --apply --source-stopped');
  else {
    backend = await openPostgres();
    await importIntoPostgres(backend, source);
    console.log('Import committed. Original SQLite files are unchanged. Staff must sign in again; sessions were not copied.');
  }
} catch (error) {
  const known = /^(Import requires|Stop the source|Provide a folder|PostgreSQL |Set DATABASE_URL|DATABASE_|Hosted PostgreSQL|Use )/.test(error.message);
  console.error(known ? error.message : 'Import failed. Verify the source folder, empty destination and database configuration. No source files were changed.');
  process.exitCode = 1;
} finally { if (backend) await backend.close(); }
