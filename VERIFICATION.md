# Verification record

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

The browser suite normally starts or reuses the development server on port 5173. To test a production build, run `npm run preview -- --port 5180 --strictPort` in another terminal, then set `$env:RETAIL_PREVIEW_URL = 'http://127.0.0.1:5180'` before testing.

```powershell
node scripts/inspect-ui.mjs artifacts/ui-pro-max
node scripts/check-contrast.mjs
```

The inspection scripts use installed Chrome and respect `RETAIL_PREVIEW_URL`. Browser tests use isolated contexts and do not touch the user's existing browser data.

## Scope of verification

Tablet and phone layouts were tested through desktop Chrome viewport emulation, not physical devices. Other browser engines, screen readers and a physical printer have not been exercised. The application remains a local demo; these results do not establish readiness for live retail operations.
