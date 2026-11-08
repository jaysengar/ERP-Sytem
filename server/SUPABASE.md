# Connect Smart Retail to Supabase PostgreSQL

The Node backend is prepared to use Supabase's managed PostgreSQL database. The browser continues calling your Node API. Existing staff passwords, roles and cookie sessions remain in this backend; Supabase Auth and its Data API are not used.

**The cloud database is not connected yet.** Local SQLite remains active until PostgreSQL is configured. No existing records have been uploaded.

## Configure your project

1. Create your own Supabase project near your customers' region.
2. Open **Connect** and copy the PostgreSQL **Session pooler** connection string, normally port **5432**. A direct connection works if your host supports its address. Do not use transaction pooling on port 6543: billing uses session advisory locks.
3. Add these settings to the private project-root `.env`. URL-encode special characters in the database password. Never commit this file or use `VITE_` variables for credentials.

```dotenv
DATABASE_DRIVER=postgres
DATABASE_URL="postgresql://postgres.PROJECT_REF:URL_ENCODED_DATABASE_PASSWORD@SESSION_POOLER_HOST:5432/postgres"
DATABASE_SSL=verify-full
DATABASE_POOL_MODE=session
DATABASE_POOL_SIZE=10
```

A Supabase publishable/anon key or service-role API key is **not needed**. If your provider supplies a CA certificate, set `DATABASE_CA_FILE` to its local path. Certificate verification stays enabled.

4. Install the optional driver, create the schema and check the connection:

```powershell
npm.cmd run db:install
npm.cmd run db:migrate
npm.cmd run db:check
```

The driver has a pinned dependency in `server/postgres-runtime/package.json`; installation generates its lockfile. Migrations use the database administrator from the connection string to create the private `retail` schema and restricted `retail_app` role. That account needs schema/table/role creation privileges. Repeated migration runs check the stored version without recreating tables.

5. Stop your current dev session with **Ctrl+C**, then run `npm.cmd run dev`. Startup should report `database: postgres`. Invalid PostgreSQL configuration fails startup without silently falling back to SQLite.

Razorpay credentials are separate. Signup still requires the configured ₹1,500 plan and webhook secret; connecting the database alone does not enable payment checkout.

## Move the current local records

A fresh cloud database starts empty. Local records are not copied automatically.

```powershell
npm.cmd run db:import
```

This only previews counts in `DATA_DIR`, without connecting to PostgreSQL or writing records. To select another source, append `-- --source "C:\path\to\server\data"`.

For the actual import, stop the source ERP server, keep destination registration closed, and back up the full local data directory. Configure PostgreSQL and run migrations first. The target must have no workspaces.

```powershell
npm.cmd run db:import -- --apply --source-stopped
```

Import reads the source files without modifying them. Workspace IDs, records, password hashes, revisions, retry/audit history, subscription/payment IDs, the original refund deadline and cancellation/refund history commit in one PostgreSQL transaction. Existing target workspaces cause rejection. Sessions are not copied; staff sign in again.

After switching, PostgreSQL is authoritative. Keep the SQLite copy as a backup; do not run the old backend against it concurrently with the cloud service.

## Database design

- Business tables share a database, with `workspace_id` on every row and tenant-scoped unique SKU, barcode, staff-email and invoice indexes.
- Transactions switch to `retail_app`, a non-login role that cannot bypass row-level security. The workspace is set internally after the server's lookup; staff authorization is enforced by the Node API.
- Tables live in the private `retail` schema, outside the default Supabase Data API schema. No browser-role access is granted. Do not expose this schema through the Data API.
- Store commands commit records, stock, revision, retry result and audit event together. Transaction locks serialize edits to one business.
- Billing uses a session lock across independently committed updates. Refund requests become durable before the provider call, protecting against duplicate refunds after a crash.
- Business objects use indexed JSONB rows to preserve the existing domain model. Large histories still need narrower read endpoints and server aggregates; the full snapshot API is retained.

## Verification and hosting

Local API/domain/startup tests and browser workflows use isolated SQLite databases. Adapter tests simulate the PostgreSQL driver to check TLS, transaction/role/scoping calls and refund ordering. They do not verify the hosted schema or RLS engine.

An opt-in integration test is provided for a **separate test database**:

```powershell
$env:TEST_DATABASE_URL = 'YOUR_PRIVATE_TEST_DATABASE_CONNECTION_STRING'
npm.cmd run test:postgres
Remove-Item Env:TEST_DATABASE_URL
```

It migrates that database, creates isolated test workspaces, tests RLS and cross-process stock/refund races with simulated Razorpay, then removes its own workspace rows. It never loads the app's `.env`. Without `TEST_DATABASE_URL` it reports skipped. Use `TEST_DATABASE_CA_FILE` for a custom CA if needed.

Package downloads and audit requests were blocked during implementation. The driver could not be installed, and no Supabase connection, migration, import or real PostgreSQL integration test was executed. Run the commands above once network access and credentials are available.

Deploy the Node 24 server with the built frontend, HTTPS, `NODE_ENV=production`, `APP_ORIGIN` and server secrets. PostgreSQL mode needs no persistent local SQLite disk. Choose pool sizes within the provider's total connection limit across instances. Public multi-instance hosting still needs shared/edge rate limiting.

Enable and verify backup/restore features included in your Supabase plan; retention varies by plan. No hosted backup setting was changed here. Email verification/recovery, legal pages, monitoring and real Razorpay tests remain separate launch requirements.
