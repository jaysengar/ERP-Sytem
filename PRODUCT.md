# Smart Retail ERP

## Current SaaS scope (8 November 2026)

The user requested a backend, separate workspaces for each business and Razorpay subscriptions. The confirmed price is **INR 1,500/month, paid upfront**. Cancellation within seven days of the first confirmed payment returns the full INR 1,500 and ends editing access immediately. Later cancellation stops renewals without a refund and keeps access through the paid period. New accounts have a seven-day money-back guarantee; previous free-trial accounts retain their original terms. Renewals and resubscriptions do not restart the guarantee.

The implementation uses the existing React interface, a Node 24 API, staff authentication, verified payment access and persisted cancellation/refund recovery. The user selected **Supabase PostgreSQL** for hosted storage. Its adapter, private schema, tenant row-level security, migrations and optional local-data import are prepared. SQLite remains active for local development until credentials and the PostgreSQL driver are available. Provider checkout/refunds are tested with simulated responses; real Supabase/Razorpay verification and deployment remain separate steps.

## Original frontend demo brief (historical)

A frontend demonstration of daily operations for one Indian clothing store, moving from paper notebooks to connected digital records. The owner needs plain language, reliable calculations and a simple demonstration from dashboard to billing, inventory, purchasing, customer history and reports.

## Confirmed requirements
- React and TypeScript, Tailwind, Lucide and Recharts; future Node/Express and MongoDB integration.
- One physical store, INR, 100+ clothing variants; architecture must support future server pagination for 10,000+ products.
- Products, stock, POS, invoices, purchases, suppliers, sales, customers, expenses, reports, role permissions and settings.
- White/light surfaces, navy primary, sidebar and top search; responsive desktop, tablet and mobile.
- Persistent local demo transactions; sales reduce stock and received purchases increase it.
- Configurable GST, disabled initially; distinguish revenue and estimated gross profit with stored cost basis.
- Demonstration only, no real authentication, payment processing or backend.

## Demo decisions
- Example shop: Urban Thread, Bengaluru. Editable in settings. Names and records are fictional.
- Local browser storage behind an asynchronous repository boundary. No data leaves the browser.
- Owner is initial role; role switching explicitly previews demo permissions.
- Products are individual SKU variants grouped by a shared style identifier.
- User approved creating smart-retail-erp; Documents is used because the user root denies writes.

## Stack
Vite, React, TypeScript, Tailwind CSS, Lucide React, Recharts. Node's test runner for transaction invariants and Playwright for browser workflows.
