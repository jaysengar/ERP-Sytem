# Future Express + MongoDB integration

No live backend is included in this demo. Do not expose the local repository or role preview as a production API. The domain layer is intentionally independent of React and the persistence adapter.

## Boundaries

- `src/domain/types.ts`: typed domain models and paginated query/result contracts.
- `src/domain/transactions.ts`: deterministic validations and permission checks, with mutations applied to a draft.
- `src/data/repository.ts`: asynchronous local adapter and repository contract. Product listings accept search, category, brand, stock, sort, page and pageSize.
- `src/data/Store.tsx`: demo snapshot provider and mutation feedback. A live frontend should replace the full snapshot with paginated query caches and server-calculated aggregates. Loading all 10,000 products into the provider is **not** the live scaling strategy.

The `transaction(callback)` method is a local convenience, not an HTTP contract. Replace it with explicit commands (`createSale`, `receivePurchase`, `adjustStock`, etc.) on the HTTP adapter. Never serialize functions to a server.

## Suggested single-store routes

| Route | Purpose | Required access |
| --- | --- | --- |
| GET /api/dashboard | Aggregated daily figures, chart buckets, recent sales, alerts | Authenticated staff; filter restricted fields |
| GET /api/products | Server pagination, search, filters and sorting | Authenticated staff |
| GET /api/products/:id | Product detail and related variants | Authenticated staff |
| POST /api/products | Add validated SKU | Owner, inventory manager |
| PATCH /api/products/:id | Edit attributes and prices with version check | Owner, inventory manager |
| DELETE /api/products/:id | Archive SKU, retaining history | Owner |
| POST /api/products/:id/adjustments | Signed stock change and audit reason | Owner, inventory manager |
| GET /api/stock-movements | Paginated movement ledger | Owner, inventory manager |
| POST /api/products/import | Validate/stage CSV then atomically apply or run a job | Owner, inventory manager |
| GET /api/products/export | Stream filtered export | Owner, inventory manager |
| POST /api/sales | Checkout with server prices, stock validation and idempotency key | Owner, cashier |
| GET /api/sales | Search invoices, date filters, pagination | Authenticated staff |
| GET /api/sales/:id | Invoice snapshot | Authenticated staff |
| GET, POST /api/suppliers | List/add supplier | Owner, inventory manager |
| GET, POST /api/purchases | List/create purchase order | Owner, inventory manager |
| POST /api/purchases/:id/receive | Receive exactly once and update stock/cost | Owner, inventory manager |
| PATCH /api/purchases/:id/payment | Supplier payment status and audit | Owner, inventory manager |
| GET /api/customers | Server search/pagination and aggregate spending | Authenticated staff |
| GET /api/customers/:id/sales | Paginated customer history | Authenticated staff |
| GET, POST /api/expenses | List/create expenses | Owner |
| GET /api/reports/:type | Bounded date-range report and export | Owner |
| GET, POST, PATCH /api/staff | Staff records and access | Owner |
| GET, PATCH /api/settings | Shop, invoice and tax configuration | Owner |

Query example: `GET /api/products?search=oxford&category=Shirts&stock=low&sort=name&page=2&pageSize=25` returns `{items,total,page,pageSize}`. Whitelist sort fields, cap page sizes and debounce search. For deep/large lists, evolve toward indexed cursor pagination. Look up barcodes with an exact unique index.

## MongoDB collections and indexes

- **products**: `_id`, `styleId`, name/normalizedName, SKU, barcode, category, brand, size, colour, purchaseCostPaise, sellingPricePaise, quantity, minStock, image metadata, active, version. Unique SKU and barcode; compound indexes on active/category/brand/normalizedName, styleId, and a maintained stock-status field. Use text or Atlas Search indexes for tokenized name search.
- **sales**: unique invoice number and idempotency key; date, customerId, immutable line/price/cost/tax/shop snapshots, amounts in integer paise, payment method/status. Index date descending and customerId/date descending.
- **purchases**: supplierId, order date, status, receivedAt, lines/costs, payments, version. Index supplierId/date and status/date. Unique order reference.
- **stockMovements**: productId, signed quantity, actorId, timestamp, reason, sourceId, idempotency key. Index productId/timestamp and sourceId.
- **customers**: unique normalized mobile when supplied; names and consent fields; no separate mutable spending counter unless transactionally maintained.
- **suppliers**, **expenses**, **staff**, **settings**, **auditEvents**. Index expense date/category. A single store configuration document is enough; do not introduce marketplace or branch tenancy.

## Live transaction invariants

Use a MongoDB replica set and session transactions. Checkout reads current prices and tax, checks a version/quote token, conditionally decrements each stock quantity (`quantity >= requested`), creates the invoice/customer/movements and commits together. Reject stale quotes for review. An idempotency key prevents duplicated checkout when clients retry.

Receiving must conditionally transition `Ordered -> Received` once and update every product plus movement in the same transaction. Use integer paise/Decimal128 for costs and taxes; define rounding and costing rules explicitly. Invoice sequences must be generated atomically on the server. Archive products; do not delete transaction snapshots.

Enforce authenticated server roles on every endpoint and response field. Add validated schemas, secure sessions, CSRF protection where applicable, audit trails, backups and tested restores before any live use. Validate uploaded images, use managed object storage, and serve bounded thumbnails. Real GST invoices, returns/refunds, supplier payments/ledgers and payment settlement are separate production work.
