# Backend and SaaS integration

## Architecture

The browser sends explicit commands. The server authenticates staff, determines their role, validates input, checks subscription and revision, then commits inventory and business records together.

For SaaS hosting, the backend supports **Supabase PostgreSQL**. A private `retail` schema holds workspace/subscription metadata and shared business tables. Business rows have a `workspace_id`, tenant-scoped composite indexes and row-level security. Every data transaction switches to the restricted `retail_app` role and sets the server-selected workspace. See [Supabase setup](SUPABASE.md) for connection and migration commands.

Local development can continue on SQLite: `platform.sqlite` holds workspace/subscription metadata and each `<random workspace UUID>.sqlite` holds its business records. Database paths come from server-generated UUIDs. SQLite uses WAL and serialized asynchronous transactions. A session for business A cannot authenticate against business B. Each open browser tab keeps its selected workspace fixed.

Checkout uses current server prices, stock and tax. Invoice, customer, stock movements, retry response and deductions commit together. Receiving updates an order once. Retry keys prevent duplicate mutations, and revision checks reject stale forms. PostgreSQL advisory transaction locks serialize business edits; session locks protect subscription/refund operations while retaining independently committed refund history.

SQLite mode supports one Node process with persistent local storage. PostgreSQL mode stores records and locks in the shared database, but real concurrent-instance verification is pending the provided integration test. Auth/registration abuse limits are still per process and need an edge/shared limiter before public scaling. Full snapshot reads remain an integration bridge for large catalogues and histories.

## Configuration

Use `.env.example` as the template. Never expose API secrets through `VITE_` variables.

| Variable | Meaning |
| --- | --- |
| `PORT` | API port, default 3001 |
| `HOST` | Default 127.0.0.1; use 0.0.0.0 inside a private production container |
| `DATA_DIR` | Persistent platform/workspace database directory |
| `DATABASE_DRIVER` | `sqlite` for local development; `postgres` for Supabase/production |
| `DATABASE_URL` | Private PostgreSQL connection string; use session pooling/direct connection |
| `DATABASE_SSL` | `verify-full` for hosted databases; `disable` allowed only on loopback |
| `DATABASE_POOL_MODE` | `session`; transaction pooling is unsupported for billing locks |
| `DATABASE_POOL_SIZE` | 2–50 connections per Node process, default 10 |
| `DATABASE_CA_FILE` | Optional path to the provider's TLS CA certificate |
| `APP_ORIGIN` | Exact browser origins, comma-separated locally; HTTPS in production |
| `NODE_ENV` | Production requires HTTPS configuration and enables Secure cookies |
| `REGISTRATION_ENABLED` | Set false to close public registration |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Server API credentials |
| `RAZORPAY_PLAN_ID` | Monthly INR 1,500 plan |
| `RAZORPAY_WEBHOOK_SECRET` | Independent secret from the webhook settings |

Registration is limited to 10 attempts per remote IP/hour; login/password operations to 15 per remote IP/minute per workspace. Forwarded IP headers are not trusted, so a reverse proxy shares those limits. Tune edge rate limiting and proxy identity before broad public launch.

## API

Tenant routes start with `/api/w/:workspaceId`, using the workspace slug. Authentication uses an HttpOnly `retail_session` cookie. Writes require JSON and `X-Retail-Request: 1`; browser origins are checked and cross-site requests rejected. No permissive CORS is enabled.

| Route | Purpose |
| --- | --- |
| POST /api/public/register | Pending business + owner registration and upfront payment checkout |
| GET /api/public/session | Anonymous sign-in state |
| GET /api/health | Health check |
| POST /api/webhooks/razorpay | Raw-body signed events |
| GET /api/w/:workspaceId/auth/session | Current user |
| POST /api/w/:workspaceId/auth/login | Password sign-in |
| POST /api/w/:workspaceId/auth/logout | Revoke session |
| POST /api/w/:workspaceId/auth/password | Change password and revoke other sessions |
| GET /api/w/:workspaceId/state | Role-filtered snapshot and subscription state |
| GET /api/w/:workspaceId/products | SQL search, filters, sort, capped pagination |
| GET /api/w/:workspaceId/backup | Owner-only records export, excluding credentials |
| POST /api/w/:workspaceId/commands | Explicit mutation |
| GET /api/w/:workspaceId/billing | Owner-only plan/entitlement |
| POST /api/w/:workspaceId/billing/subscribe | Create/reuse hosted subscription checkout |
| POST /api/w/:workspaceId/billing/refresh | Verify captured payments and reconcile cancellation/refund status |
| POST /api/w/:workspaceId/billing/cancel | Cancel/refund within seven days; stop renewals after seven days |

Commands carry `{ type, input, expectedRevision }` and an `Idempotency-Key` UUID header. Input types are in `src/domain/commands.ts`.

Registration requires `acceptTerms: true` and `billingPolicy: 'upfront_refund_v1'`; opening subscription checkout also requires that policy value. A missing gateway configuration returns 503 before account creation. If checkout fails after account creation, the pending owner session can retry from Billing. Cancellation accepts `refundExpected: true` when the owner confirms a refund: if that window has expired, the server returns 409 for a fresh review instead of silently cancelling without a refund. Amounts and payment IDs are derived from verified server records, not cancellation input.

Commands: `product.save`, `product.delete`, `product.import`, `stock.adjust`, `sale.create`, `supplier.create`, `purchase.create`, `purchase.receive`, `purchase.payment`, `expense.create`, `staff.save`, `settings.save`.

Cashiers cannot get purchase costs, suppliers, expenses, other staff or profit costs. Staff administration, settings, store-record downloads and billing are owner-only. Disabling staff or resetting their password revokes sessions. Passwords use salted scrypt; sessions expire after 12 hours.

## Razorpay

1. In **Test Mode**, enable Subscriptions and create a plan: period `monthly`, interval `1`, currency `INR`, amount `150000` paise. Put its `plan_...` ID in `.env`.
2. Configure the test API key ID/secret and an independent webhook secret. The account must support subscription creation/read/cancellation, invoice/payment reads, and payment refund creation/history reads. Restart the server.
3. Use a public HTTPS test host/tunnel. Set `APP_ORIGIN` to that exact URL.
4. Add `https://YOUR-HOST/api/webhooks/razorpay` in Razorpay. Select available subscription lifecycle events, including authenticated, activated, charged, pending, halted, cancelled, completed and paused/resumed. Also select **`refund.created`, `refund.processed` and `refund.failed`**.
5. Register a business and select **Continue to payment · ₹1,500**. Razorpay hosts authorization and the first monthly payment. The request omits a future `start_at` so payment starts upon authorization; the seven days are a money-back guarantee. Subscriptions support up to 120 monthly cycles and do not silently restart after completion.
6. Confirm a signed webhook arrives, then choose **Check payment status**. New accounts need a paid subscription invoice bound to a captured ₹1,500 INR payment. Authorization/activation events alone do not unlock editing. The server fetches current provider state for each webhook, preventing delayed events from overwriting it. Event IDs are deduplicated.
7. Test an early cancellation from Billing. It cancels immediately, revokes editing, and requests the full ₹1,500 first payment back to its original method. Verify pending/processed refund status and delivery of refund webhooks. Test a declined/abandoned checkout, failed refund, and retry without duplicate refunds.
8. Verify cancellation after the seven-day deadline schedules renewal cancellation at the end of the current paid period without a refund. Check that renewals and a new subscription do not reset the first-payment deadline. Unpaid mandates cancel immediately. Existing legacy trial accounts retain their earlier terms.
9. After successful real test checkout, cancellation, refunds and webhooks, configure live credentials and an equivalent live plan. Do not mix test/live keys or IDs.

Automated tests simulate provider API responses. Actual checkout, authorization rules, invoice/payment response shapes, cancellation, refunds and webhook delivery must be verified with your Razorpay test account on the intended host. External Razorpay documentation could not be fetched from this environment during implementation. No real payments or refunds were made during automated verification.

The monthly plan price is INR 1,500. SaaS subscription tax invoicing is not implemented; configure it for your business before commercial charging. Shopper payments and refunds are separate from subscription billing.

References:

- https://razorpay.com/docs/api/payments/subscriptions/create-subscription/
- https://razorpay.com/docs/api/payments/subscriptions/fetch-subscription/
- https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription/
- https://razorpay.com/docs/webhooks/validate-test/

## Refund recovery

The seven-day deadline is stored from the first verified paid invoice timestamp. The server records a cancellation request's receipt time before contacting Razorpay, so an outage does not remove a timely cancellation's eligibility. Renewals/resubscriptions keep that original payment and deadline. Early cancellation ends editing access; saved records and the owner download remain available. Late cancellation keeps access through the verified paid period.

The refund request stores the original payment ID, unique attempt receipt, amount, status and provider refund ID. Before submission/retry, the server checks payment and refund history. Previous partial refunds reduce the amount still to return; the total cannot exceed ₹1,500. A pending refund remains pending even if the provider has already reserved the full amount. Bank credit times vary after provider processing.

**Check refund status** and signed webhooks reconcile persisted requests. **Retry refund** is available for a definitive failure; routine status checks do not resubmit failures. If the process stops or a refund response is lost, the request stays unresolved until provider history confirms the outcome. A newer uncertain attempt cannot be retried merely because an older attempt failed. Resubscribing is blocked until the refund is processed.

For `review_required`, inspect the original payment's refund history in Razorpay and match its receipt/reference with `refund_requests`. Use status refresh to reconcile a pending/processed record. If the provider has no matching record, obtain confirmation from Razorpay before an operator resolves it; do not delete the request or resend blindly. There is no operator console or scheduled retry worker yet. Preserve the registry when restarting, and use Billing refresh or provider webhook retries to resume interrupted work.

## Hosting and recovery

Install the main dependencies and PostgreSQL runtime, configure Supabase, run migrations, build, and run `npm start` on Node 24. Production requires `DATABASE_DRIVER=postgres`, a private `DATABASE_URL`, `NODE_ENV=production` and `APP_ORIGIN=https://your-domain`. Terminate HTTPS at a reverse proxy. Node serves both the frontend and API, with SPA history fallback. This needs a Node server; a static-only frontend deployment cannot run the backend. PostgreSQL mode does not need a persistent local database disk.

For Supabase, configure backups/retention supported by your plan and test a full restore. These hosted settings have not been configured. For local SQLite, protect the full `DATA_DIR`: stop Node, copy the entire directory into encrypted backup storage, then restart. Restore a complete matching backup to a stopped service. The JSON records download is not a complete platform restore image. Use the [explicit SQLite import workflow](SUPABASE.md#move-the-current-local-records) when moving to PostgreSQL.

Only `dist` is publicly served. Keep `.env`, SQLite files, backups and logs private.

Before commercial launch, add email ownership verification and owner password recovery, legal/privacy/refund pages, abuse controls, automated backups, monitoring and a real Razorpay test. Staff passwords can currently be reset by the owner; owner recovery requires operator intervention. No platform-wide support console or outbound email service is included yet.
