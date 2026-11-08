import { test, expect } from './fixtures';

test('billing saves an invoice, reduces stock, and survives reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  const quantity = await page.evaluate(async () => (await (await fetch(`/api/w/${localStorage.getItem('retail-workspace')}/state`)).json()).data.products.find((p: { id: string }) => p.id === 'p-2').quantity);
  await page.goto('/pos');
  await page.getByRole('textbox', { name: 'Scan or enter barcode' }).fill('8901000000002');
  await page.getByRole('button', { name: 'Add barcode product' }).click();
  await page.getByRole('button', { name: 'Increase UT-001-02' }).click();
  await page.getByRole('button', { name: 'Increase UT-001-02' }).click();
  await page.getByLabel('Customer name', { exact: true }).fill('Demo Buyer');
  await page.getByLabel('Mobile number', { exact: true }).fill('9876543210');
  await page.getByRole('button', { name: 'UPI', exact: true }).click();
  await page.getByRole('button', { name: 'Review bill' }).click();
  await page.getByRole('button', { name: /Complete sale ·/ }).click();
  await expect(page.getByRole('heading', { name: 'Sale completed', exact: true })).toBeVisible();
  await expect(page.getByText('Payment recorded and inventory updated.')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  const data = await page.evaluate(async () => (await (await fetch(`/api/w/${localStorage.getItem('retail-workspace')}/state`)).json()).data);
  expect(data.products.find((p: { id: string }) => p.id === 'p-2').quantity).toBe(quantity - 3);
  expect(data.sales.at(-1).customerName).toBe('Demo Buyer');
  await page.goto('/customers');
  await page.getByRole('textbox', { name: 'Search customer name or mobile…' }).fill('9876543210');
  await expect(page.getByText('Demo Buyer', { exact: true })).toBeVisible();
});
test('receiving a purchase adds stock once', async ({ page }) => {
  await page.goto('/purchases');
  await expect(page.getByRole('heading', { name: 'Purchases & suppliers' })).toBeVisible();
  const before = await page.evaluate(async () => { const db = (await (await fetch(`/api/w/${localStorage.getItem('retail-workspace')}/state`)).json()).data; const order = db.purchases.find((p: { status: string }) => p.status === 'Ordered'); return { id: order.id, line: order.lines[0], stock: db.products.find((p: { id: string }) => p.id === order.lines[0].productId).quantity }; });
  await page.getByRole('button', { name: 'Receive', exact: true }).first().click();
  await page.getByRole('button', { name: 'Receive stock', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const after = await page.evaluate(async () => (await (await fetch(`/api/w/${localStorage.getItem('retail-workspace')}/state`)).json()).data);
  expect(after.products.find((p: { id: string }) => p.id === before.line.productId).quantity).toBe(before.stock + before.line.quantity);
  expect(after.purchases.find((p: { id: string }) => p.id === before.id).status).toBe('Received');
});
test('product search, filters and edit validation work', async ({ page }) => {
  await page.goto('/products');
  await page.getByRole('textbox', { name: 'Search name, SKU or barcode…' }).fill('8901000000002');
  await expect(page.getByText('UT-001-02', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByRole('combobox', { name: 'Filter by category' }).selectOption('Jeans');
  await expect(page.getByText('16 matching products', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  await page.getByLabel('Product name', { exact: true }).fill('Test Linen Shirt');
  await page.getByLabel('SKU / product code').fill('TEST-LINEN-M');
  await page.getByLabel('Barcode', { exact: true }).fill('8901000998888');
  await page.getByLabel('Brand', { exact: true }).fill('Demo Brand');
  await page.getByLabel('Size', { exact: true }).fill('M');
  await page.getByLabel('Colour', { exact: true }).fill('White');
  await page.getByLabel('Purchase price (₹)').fill('500');
  await page.getByLabel('Selling price (₹)').fill('999');
  await page.getByLabel('Opening quantity').fill('20');
  await page.getByRole('dialog').getByRole('button', { name: 'Add product', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search name, SKU or barcode…' }).fill('TEST-LINEN-M');
  await expect(page.getByText('Test Linen Shirt', { exact: true })).toBeVisible();
});
test('cashier restrictions and all navigation routes render', async ({ page }) => {
  for (const [route, heading] of [['/', 'Dashboard'], ['/products', 'Products'], ['/pos', 'POS Billing'], ['/inventory', 'Inventory'], ['/purchases', 'Purchases & suppliers'], ['/sales', 'Sales history'], ['/customers', 'Customers'], ['/expenses', 'Expenses'], ['/reports', 'Reports & analytics'], ['/staff', 'Staff & access'], ['/settings', 'Settings']]) {
    await page.goto(route); await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible();
  }
  await page.goto('/staff');
  await page.evaluate(async () => {
    const api = `/api/w/${localStorage.getItem('retail-workspace')}`;
    const state = await (await fetch(api + '/state')).json();
    const headers = { 'Content-Type': 'application/json', 'X-Retail-Request': '1', 'Idempotency-Key': crypto.randomUUID() };
    const saved = await fetch(api + '/commands', { method: 'POST', headers, body: JSON.stringify({ type: 'staff.save', expectedRevision: state.data.revision, input: { id: 'cashier', name: 'Test Cashier', email: 'cashier@example.test', role: 'Cashier', active: true, password: 'Cashier password 123!' } }) });
    if (!saved.ok) throw new Error(await saved.text());
    await fetch(api + '/auth/login', { method: 'POST', headers, body: JSON.stringify({ email: 'cashier@example.test', password: 'Cashier password 123!' }) });
  });
  await page.reload();
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add product', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Expenses', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Owner access required' })).toBeVisible();
});
test('mobile navigation fits and invoice has a print layout', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Sales history', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sales history', exact: true })).toBeVisible();
  const overflow = await page.evaluate(async () => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.getByRole('button', { name: /View invoice/ }).filter({ visible: true }).first().click();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.invoice-sheet')).toBeVisible();
  await expect(page.locator('.topbar')).toBeHidden();
});
