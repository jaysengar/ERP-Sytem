# Verification record

## Supabase PostgreSQL preparation — 8 November 2026

- Production build and TypeScript: **passed**.
- `npm.cmd test`: **48 passing tests** — 21 backend/payment/import tests, 18 domain tests, 4 startup tests and 5 storage/adapter tests.
- `npm.cmd run test:e2e` with installed Chrome: **19 passed**, 42.7 seconds. The isolated SQLite test backend stopped afterward. No extra development server was left running.
- Existing signup/authentication, tenant isolation, retail transactions, payment/refund behavior and browser routes pass after converting the database boundary to asynchronous transactions.
- Storage tests cover TLS verification, rejection of transaction poolers, scoped SQL conflict targets, hidden uncommitted SQLite writes, rollback, PostgreSQL role/workspace configuration, and committing refund state before provider calls. PostgreSQL driver responses are simulated in these tests.
- The local import preview read **3 workspaces and 2,225 business records** without connecting to a cloud database. A separate fixture test checks record/refund preservation and rejection of a nonempty import target. No existing records were imported or modified.
- `npm.cmd run test:postgres`: **1 skipped**, because `TEST_DATABASE_URL` and the optional driver were unavailable. The test is prepared for real migrations, RLS, two backend instances, stock races and refund locks against a separate test database.
- **Not executed:** hosted PostgreSQL connection/schema migration/RLS enforcement, actual PostgreSQL import, backup configuration or Supabase deployment. Package installation and `npm audit` requests were blocked by network access (`EACCES`); the optional `pg` driver remains to be installed.
- JavaScript syntax checks and `git diff --check`: passed. No secrets were printed or added to frontend configuration.
- Configuration and remaining provider checks: [server/SUPABASE.md](server/SUPABASE.md).

## Upfront payment and seven-day refunds — 8 November 2026

- Production build and TypeScript: **passed**.
- Final `npm.cmd test`: **41 passing tests** — 20 backend/payment tests, 18 domain tests and 3 startup tests.
- Full browser suite during this change: **19 passing tests** in installed Chrome. After the final refund retry and resubscription refinements, reran the four tests in `saas.spec.ts`: **4 passed**, including the extended refund → resubscribe → cancel-renewal flow.
- New payment coverage: immediate subscription creation without a future start date, no editing before capture, verified first invoice/payment binding, a fixed seven-day deadline, full early refunds, late cancellation without refunds, and legacy trial preservation.
- Refund recovery coverage: concurrent requests, restart persistence, timely cancellation across an outage, a payment arriving after cancellation, partial refunds, pending amounts reserved by the provider, explicit failed-attempt retries, lost responses, older failed attempts not authorizing a duplicate newer attempt, cross-workspace isolation, and signed refund webhooks.
- Browser coverage includes signup consent and simulated hosted payment, paid access, cancellation confirmation, refund reference after reload, resubscription without another guarantee, and cancellation of its future renewal. The gateway and webhook signatures are simulated locally; tests never load private `.env` credentials or call real Razorpay.
- Reviewed signup and Billing at desktop and 375px phone width, plus the mobile refund state. Screenshots in `artifacts/backend/`: `registration-desktop.png`, `registration-mobile.png`, `billing-desktop.png`, `billing-mobile.png`, `refund-mobile.png`. Screenshot capture disables transitions to avoid recording the mobile drawer during a viewport resize. No horizontal document overflow in the tested mobile flows.
- **Still requires a Razorpay test-account check:** hosted checkout/mandate behavior, actual invoice/payment response fields, refund processing and public HTTPS webhook delivery. No real money was charged or refunded. See `server/README.md` for setup and recovery.
- The isolated browser test backend stopped after the run. No development server was left running; restart an existing dev session to load the new backend.

## Startup port handling — 8 November 2026

- Stopped the assistant-started development instance that occupied ports 3001 and 5173.
- The dev launcher checks both ports before spawning either server. The backend also handles a bind failure without an unhandled error, covering direct startup and port races.
- `npm test`: **28 passing tests**, including occupied backend/frontend ports and direct backend startup failure. Startup tests use temporary directories and do not load the user's `.env`.
- Smoke check: both health endpoints returned HTTP 200 after launch; a duplicate `npm run dev` exited with a readable message. Stopping the owned backend child also stopped its sibling frontend. Both development ports were released after verification.

## Backend and SaaS — 8 November 2026

- Production build and TypeScript: **passed**.
- `npm test`: **25 passing tests** (18 existing domain tests and 7 API/SaaS tests). The three old browser-storage adapter tests were replaced by real persistence, transaction and retry coverage.
- `npm run test:e2e`, installed Chrome: **18 passing tests**, 38.8 seconds, against a separate temporary SQLite backend at port 5191. The test runner starts and stops its own server; no user database or real Razorpay account is used.
- API coverage: separate-workspace isolation, cross-tenant cookie rejection, restart persistence, hashed-password login, CSRF/origin checks, role redaction, password/session revocation, stock races, idempotency, rollback, purchase receiving, settings, expenses, SQL pagination, trial expiry, price validation, webhook signatures and event deduplication.
- Browser coverage: registration, sign-out/sign-in, Billing, responsive forms, all previous retail workflows, retry after a checkout response is lost, and preventing another tab's workspace preference from redirecting requests.
- Visually reviewed registration and Billing at desktop and 375px phone width. Fixed the signup form's mobile footer and checkbox alignment. Existing catalogue/checkout checks include 320px width and landscape with touch emulation.
- Screenshots: `artifacts/backend/registration-desktop.png`, `registration-mobile.png`, `billing-desktop.png`, `billing-mobile.png`.
- **Not verified:** real Razorpay checkout, mandate authorization and webhook delivery. Tests use simulated provider responses; external network access was blocked. Test credentials and a public HTTPS webhook host are still required.
- **Hosting boundary:** one Node process with persistent SQLite storage. No live deployment, email verification/recovery service, production backup automation or large-history scaling validation was performed. See `server/README.md`.

## Earlier frontend verification

Date: 7 November 2026. Impeccable refinement followed by a UI/UX Pro Max refinement of the existing single-store frontend demo.

## Results

- `npm run build`: **passed**. Full TypeScript check and Vite production bundle.
- `npm test`: **21 passing domain and repository tests**.
- `npm run test:e2e`: **15 passing browser tests**, run in installed desktop Chrome against the production preview at `http://127.0.0.1:5180`.
- Reviewed rendered screens at **1440 × 1000**, **1024 × 900** and **375 × 812**. All 11 routes fit the tested phone width without horizontal document overflow; wider tables scroll within their own containers.
- Catalogue and checkout were also tested at **320 × 740** and **812 × 375**, with touch emulation and reduced motion. Product links meet the intended 44px height in these modes.
- The screenshot inspection recorded **no JavaScript page errors**. The custom text-contrast sampling script found no failures on the 11 default desktop page states. This sampled check is not a complete accessibility audit.
- Generated the invoice print PDF and checked that print styling hides the app shell. Mobile invoice actions remain fully inside the dialog.

## Coverage

Domain/repository tests cover seed consistency, unique identifiers, stock deduction, cost snapshots, customer reuse, discounts and GST rounding, overselling, role gates, one-time purchase receiving, weighted purchase costs, rollback, stock adjustments, product editing/deletion rules, search/filter/pagination, date ranges, cost-known profit calculations, settings, last-owner protection, CSV parsing, concurrent writes, persistence, corrupt data preservation and quota failures.

Browser tests cover billing and persistence after reload; receiving stock once; product search, filters and validation; cashier restrictions; navigation; invoice print styling; preserved form values and linked errors; mobile navigation focus containment and restoration; the keyboard skip link; mobile checkout and visible invoice actions; rapid filter changes; profile navigation; and page overflow. Mobile error links were checked against the sticky dialog header and footer so focused fields stay visible.

The four added tests cover removing one filter while preserving other selections and sort order; exposing sort direction; opening a collapsed optional field from an error summary; contextual cart updates; recovering from an invalid mobile number without losing the bill; and narrow/landscape interaction. The final CSS adjustment reduces select padding so the chosen sort label is fully visible on phones; this was visually checked after the browser suite.

## Evidence

- [Desktop dashboard](artifacts/ui-pro-max/dashboard-desktop.png)
- [Tablet dashboard](artifacts/ui-pro-max/dashboard-tablet.png)
- [Mobile dashboard](artifacts/ui-pro-max/dashboard-mobile.png)
- [Grouped product form](artifacts/ui-pro-max/product-form-desktop.png)
- [Mobile product filters](artifacts/ui-pro-max/product-filters-mobile.png)
- [Mobile POS bill](artifacts/ui-pro-max/pos-bill-mobile.png)
- [Mobile checkout validation](artifacts/ui-pro-max/pos-phone-validation-mobile.png)
- [Mobile invoice](artifacts/ui-pro-max/invoice-mobile.png)
- [Invoice print PDF](artifacts/ui-pro-max/invoice-print.pdf)
- [Screenshot inspection results](artifacts/ui-pro-max/review.json)

The original screenshots are retained in `artifacts/ui-before/` and the first refinement in `artifacts/ui-after/` for comparison.

## Reproduce

```powershell
npm run build
npm test
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm run test:e2e
```

The current `npm.cmd run test:e2e` builds the app and starts/stops its own temporary SQLite backend at port 5191. It does not reuse the user's development server. The inspection commands below belong to the historical frontend demo checks and are not the current authenticated SaaS test runner.

```powershell
node scripts/inspect-ui.mjs artifacts/ui-pro-max
node scripts/check-contrast.mjs
```

The inspection scripts use installed Chrome and respect `RETAIL_PREVIEW_URL`. Browser tests use isolated contexts and do not touch the user's existing browser data.

## Scope of verification

Tablet and phone layouts were tested through desktop Chrome viewport emulation, not physical devices. Other browser engines, screen readers and a physical printer have not been exercised. The earlier frontend results describe the original local demo; the current backend and payment checks above do not establish readiness for live commercial operation without the remaining provider and hosting verification.
