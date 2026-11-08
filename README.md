# Smart Retail ERP

A connected retail ERP with separate business workspaces, staff login and Razorpay subscriptions: **₹1,500/month, paid upfront, with a 7-day money-back guarantee on the first payment**.

The React interface uses a Node.js API. **Supabase PostgreSQL support is prepared for SaaS hosting**, with business records isolated by row-level security. Until your private database connection is configured, local development continues using the existing SQLite files. No records have been uploaded to the cloud.

Follow the [Supabase setup guide](server/SUPABASE.md) when your project is available. It covers the private database connection string, driver installation, migrations and optional import of existing records. Supabase browser API keys are not required by this backend.

## Run locally

Use Node.js 24 or later. In Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

```powershell
cd C:\Users\jayxj\Documents\smart-retail-erp
npm.cmd install
npm.cmd run dev
```

Open **http://127.0.0.1:5173**. This starts the frontend and backend together. Configure Razorpay test credentials as described below, choose **New business? Get started**, create a workspace ID and owner account, and continue to Razorpay to pay ₹1,500. After payment is confirmed, add staff from **Staff & access**. There are no default passwords. Staff sign in with their workspace ID, email and assigned password.

Run `npm run dev` in one terminal at a time. Press **Ctrl+C** there to stop both servers before restarting. If a port is occupied, startup now identifies it and exits before starting either server. Backend port: `PORT` in `.env`; frontend port: Vite's `--port` option. Update `APP_ORIGIN` if you change browser ports.

Registration starts an empty store unless you select fictional sample data. Set your shop address, phone and invoice details in Settings before issuing bills. The previous browser demo is not overwritten or automatically imported; Settings can download those records for reference.

For a build served directly by Node:

```powershell
npm.cmd run build
npm.cmd start
```

Without production environment settings this runs locally at http://127.0.0.1:3001. See the [server guide](server/README.md) for HTTPS hosting.

## Database setup

Later, set `DATABASE_DRIVER=postgres` and `DATABASE_URL` in `.env`, using your Supabase session-pooler connection on port 5432, then run:

```powershell
npm.cmd run db:install
npm.cmd run db:migrate
npm.cmd run db:check
```

Restart the server afterward. Production requires PostgreSQL; local SQLite remains available with `DATABASE_DRIVER=sqlite`. Package downloads were blocked during implementation, so the optional PostgreSQL driver is not installed yet and the hosted database has not been tested.

Use `npm.cmd run db:import` for a read-only preview of your existing local records. The [import guide](server/SUPABASE.md#move-the-current-local-records) explains the explicit transfer into an empty cloud database.

## Razorpay

Use `.env.example` as a template and fill in the private, Git-ignored `.env` file:

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_PLAN_ID`
- `RAZORPAY_WEBHOOK_SECRET`

Use test keys and a matching plan: **INR 150000 paise, monthly, interval 1**. Restart the server after configuration changes. The backend checks the plan price before creating a subscription.

Set the webhook URL to `https://YOUR-HOST/api/webhooks/razorpay`. Real test webhooks need a public HTTPS development host; Razorpay cannot reach localhost. Follow the [Razorpay setup guide](server/README.md#razorpay).

The owner authorizes the first ₹1,500 payment and monthly renewals on Razorpay's hosted checkout. Editing activates only after the backend verifies the captured monthly payment and its subscription invoice. A checkout redirect or mandate authorization alone does not activate access. Missing payment configuration blocks signup; an interrupted checkout can be resumed from Billing.

Cancel from **Billing & subscription** within seven days of the first confirmed payment to end editing access immediately and request a full ₹1,500 refund to the original payment method. After seven days, cancellation stops future renewals and access continues through the paid period. Saved records remain available. Renewals and later subscriptions do not restart the guarantee. Existing accounts created under the previous free-trial policy keep their original trial terms.

Billing shows pending, processed or failed refund status and the provider reference. Bank credit times vary. Refunds with an uncertain provider response require reconciliation or support review before another attempt; repeated clicks do not blindly send another refund. See the [server guide](server/README.md#refund-recovery) for recovery details.

## Connected workflows

- Products, SQL search/pagination, atomic CSV import and stock adjustments.
- POS checkout, inventory deductions, customers and invoice snapshots.
- Suppliers, purchase orders, one-time receiving and payment status updates.
- Expenses, dashboards/reports, customers, sales history and shop settings.
- Owner, cashier and inventory roles, enforced by the API with restricted data redacted.
- Staff credentials, sign-out and password changes, salted hashes and HttpOnly sessions.
- Refresh every 15 seconds/on focus, connection warnings and retries for uncertain saves.
- Revision checks for stale updates; idempotency keys for duplicate prevention.
- Business registration, upfront subscription checkout, a fixed seven-day refund window and renewal cancellation.

POS methods record payments received outside this app. Razorpay pays for the **ERP subscription**, not shoppers' purchases. The simplified GST/accounting model remains: one GST rate, no returns/refunds or GST compliance certification. Sample invoices remain labelled as demonstrations.

## Checks

```powershell
npm.cmd test
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm.cmd run test:e2e
```

The browser command builds the app and runs a temporary isolated backend. Tests never load your `.env`, call real Razorpay, or change your local workspace databases. Without installed Chrome, install Playwright Chromium and omit `PLAYWRIGHT_CHANNEL`.

See [VERIFICATION.md](VERIFICATION.md). Real provider checkout, refunds and webhook delivery require a separate check with your Razorpay test account.

## Structure and current limits

`src/data/repository.ts` is the typed HTTP client; `src/domain/commands.ts` defines commands. `server/saas.mjs` handles workspaces and routes; `server/subscriptions.mjs` verifies payments and manages cancellation/refund state; `server/app.mjs` handles staff and transactions; `server/database.mjs` is the shared record repository; `server/postgres.mjs` connects PostgreSQL; `server/sqlite.mjs` supports local storage; `server/billing.mjs` connects Razorpay. Local database files live in `server/data/` and are ignored by Git.

The full snapshot provider is retained for dashboards, POS and reports. Product listings paginate in SQL, but large catalogues and long histories need paginated read models and server aggregates before scaling. Public commercial launch also needs email verification/recovery, legal pages, operational backups and monitoring; those are not implemented by this integration.
