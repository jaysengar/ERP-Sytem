# Smart Retail ERP demo

A single-store clothing retail demo for a shop owner moving from notebook records to connected daily workflows. Built with React, TypeScript, Tailwind CSS, Lucide and Recharts. The fictional shop, **Urban Thread**, can be renamed in Settings.

This is a **local frontend demo**, not a production ERP. It does not have server authentication, actual payment processing, production backups or GST compliance certification. The role switch demonstrates permissions; browser users can access local data.

## Start

Use **Node.js 24 or later** (the dependency-free domain tests use Node's TypeScript support).

```powershell
cd C:\Users\jayxj\Documents\smart-retail-erp
npm install
npm run dev
```

Open the local URL printed by Vite, usually http://127.0.0.1:5173.

```powershell
npm run build
npm run preview
npm test
npx playwright install chromium
npm run test:e2e
```

The browser tests use an isolated browser context and never change an existing browser profile. `npm test` runs without downloading packages. A future deployment needs a host with SPA history fallback to `index.html`.

To run the browser tests with an already installed Google Chrome instead of downloading Chromium:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm run test:e2e
```

## What's implemented

- Dashboard with calculated daily sales, orders, product counts, stock alerts, purchase amount, expenses, sales chart, recent invoices and bestsellers.
- 144 SKU variants across nine categories and 18 styles, 18 fictional customers, four suppliers, three staff, 90 days of sales, 14 purchases and 25 expenses.
- Product creation, editing, confirmed deletion, detail and sibling variant views, name/SKU/barcode search, category/brand/stock filters, sorting and pagination.
- CSV template, validated atomic imports (up to 500 new products), and filtered exports. SKU and barcode uniqueness are enforced. The demo uses category icons until an image URL is provided.
- POS product and barcode lookup, quantity controls, cart removal and clearing, optional customer identity, fixed rupee discount, Cash/UPI/Card/Other, explicit bill review, saved invoices and print layout.
- Sales reduce stock atomically. A purchase marked received increases stock once. Receiving uses a weighted average purchase cost for future bills. Every new stock change records a movement.
- Supplier contacts, purchases with multiple lines and payment status updates; order totals and history.
- Searchable/date-filtered invoices, daily summary, customer histories and expense entry with daily/monthly totals.
- Daily/weekly/monthly sales, product and bestseller reports, low stock, purchase and expense reports, chart data tables and CSV downloads.
- Staff administration and role permission previews, shop/profile settings, INR, low-stock defaults, invoice settings, optional GST, JSON backup download and confirmed reset.
- Readable type and contrast, responsive navigation with keyboard focus containment, native dialogs, route loading within the app shell, and a working profile menu.
- Mobile invoice summaries, a Products/Current bill switch for phone checkout, visible invoice actions, and scroll hints for wide tables.
- Field-level validation and linked error summaries preserve entered values and keep focused fields visible. Empty states, loading feedback and reduced motion are supported.
- Grouped product entry with optional photo/variant fields, labelled catalogue filters, removable filter selections and accessible sort state.
- Contextual cart confirmations, marked payment selection and mobile-number error recovery beside the checkout field.

## A five-minute shop-owner demonstration

1. **Dashboard:** explain today's figures and low-stock alerts.
2. **Products:** search `UT-001-02`, open its details and see its sizes/colours. Check its quantity.
3. **POS Billing:** enter barcode `8901000000002`, add three pieces, optionally enter a customer mobile, review and complete the bill. Use Print invoice to print or save as PDF.
4. **Inventory:** search the same SKU. Its stock is now three pieces lower; Stock history records the invoice.
5. **Purchases:** create an order with several products, save, then Receive it. The stock increases exactly once.
6. **Customers:** search the mobile used at checkout and open the purchase history.
7. **Reports:** compare revenue, estimated gross profit and expenses. Try the daily, weekly and monthly reports and export a CSV.

## Data and accounting boundaries

- Data persists under localStorage key `smart-retail-demo:v1`. Refreshing preserves saved records. Tabs use the Web Locks API where available to serialize changes. Clearing browser site data removes the demo.
- Unsaved POS cart lines use sessionStorage. Customer fields and discounts are not persisted in the draft. Other unsaved forms do not persist.
- Seed inventory is an **opening snapshot**, not a reconstruction from seed historical sales and purchases. Stock movement history starts with operations performed in the demo.
- Sales and purchase records keep item snapshots so deleted products and later price changes do not rewrite history. Invoices also keep shop/tax/footer snapshots.
- The dashboard's total sales represent money collected including GST if configured. Sales revenue in charts/reports is after discounts and excludes GST.
- Estimated gross profit uses discounted net line revenue minus the cost saved at checkout. If a cost is unavailable, that line is excluded and cost coverage is shown. This is **not net profit** and excludes operating expenses.
- GST starts disabled. The demonstration supports one configured rate on the discounted taxable amount. Real GST treatment, HSN codes, per-item rates, CGST/SGST/IGST and returns require a separate live implementation.
- Product minimum levels apply per SKU. The Settings threshold is the default for newly created SKUs.
- CSV exports prefix spreadsheet formula characters. Imports create new SKUs; they do not overwrite existing inventory.

## Project structure

```text
src/
  components/  Shared layout, dialogs, forms, tables, product thumbnails, invoices
  data/        Seed records, repository contract/local adapter, React store
  domain/      Types, permissions, validation, transactions, queries, analytics, CSV
  pages/       Dashboard, Products/Inventory, POS, Purchases, Sales, Customers,
               Expenses, Reports, Staff and Settings
  styles.css   Design tokens, responsive layouts, states, print stylesheet
server/
  README.md    Future Express/MongoDB contracts and migration plan
tests/
  domain.test.mjs        Transaction and calculation tests
  browser/              Playwright workflow and responsive tests
scripts/
  register-ts.mjs        Node test resolver for Vite-style TS imports
  check-source.mjs       TS/TSX syntax and local import verification
  inspect-ui.mjs         Chrome screenshots, page errors and viewport checks
  check-contrast.mjs     Sampled text-contrast checks across all routes
```

See [DESIGN.md](DESIGN.md) for UI decisions, [PRODUCT.md](PRODUCT.md) for product scope, [server/README.md](server/README.md) for the API migration plan and [VERIFICATION.md](VERIFICATION.md) for checks actually performed.
