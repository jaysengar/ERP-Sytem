# Smart Retail ERP

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
