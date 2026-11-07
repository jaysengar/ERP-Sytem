import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDatabase } from '../src/data/seed.ts';
import { adjustStock, calculateBill, checkout, createPurchase, queryProducts, receivePurchase, removeProduct, saveExpense, saveProduct, saveSettings, saveStaff } from '../src/domain/transactions.ts';
import { productSales, salesInRange } from '../src/domain/analytics.ts';
import { parseProductCsv } from '../src/domain/csv.ts';
import { dateKey, sum } from '../src/domain/format.ts';
import { repository, STORAGE_KEY } from '../src/data/repository.ts';

const owner = 'Owner / Admin';
// Exercise the adapter's in-process serialization independently of Node's
// experimental LockManager. Cross-tab browser locks are a separate browser concern.
Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
const fresh = () => seedDatabase(new Date('2026-11-07T10:30:00+05:30'));
const input = (db, overrides = {}) => ({ lines: [{ productId: db.products[1].id, quantity: 3 }], discount: 0, customerName: 'Test Customer', mobile: '9876543210', paymentMethod: 'UPI', ...overrides });
const transaction = (db, operation) => { const draft = structuredClone(db); const result = operation(draft); Object.assign(db, draft); return result; };

test('seed has 144 unique clothing variants and coherent invoice totals', () => {
  const db = fresh(); assert.equal(db.products.length, 144); assert.equal(new Set(db.products.map(p => p.sku)).size, 144); assert.equal(new Set(db.products.map(p => p.barcode)).size, 144); assert.equal(new Set(db.products.map(p => p.category)).size, 9);
  for (const s of db.sales) { assert.equal(s.subtotal, sum(s.lines, l => l.quantity * l.price)); assert.equal(s.total, s.subtotal - s.discount + s.tax); }
});
test('selling 3 pieces from 20 produces 17, a customer and an immutable cost snapshot', () => {
  const db = fresh(); db.products[1].quantity = 20; const cost = db.products[1].purchasePrice;
  const sale = checkout(db, owner, input(db)); assert.equal(db.products[1].quantity, 17); assert.equal(sale.lines[0].quantity, 3); assert.equal(sale.lines[0].cost, cost); assert.equal(db.movements[0].change, -3); assert.ok(db.customers.find(c => c.mobile === '9876543210')); db.products[1].purchasePrice = 900; assert.equal(sale.lines[0].cost, cost);
});
test('repeated customer mobile reuses identity and optional customer fields support walk-ins', () => {
  const db = fresh(); const existing = db.customers[0]; const before = db.customers.length; const sale = checkout(db, owner, input(db, { mobile: existing.mobile, customerName: '' })); assert.equal(sale.customerId, existing.id); assert.equal(db.customers.length, before); const walkin = checkout(db, owner, input(db, { mobile: '', customerName: '' })); assert.equal(walkin.customerName, 'Walk-in customer'); assert.equal(walkin.customerId, undefined);
});
test('discount and GST are calculated with paise rounding; GST starts disabled', () => {
  const db = fresh(); const sale = checkout(db, owner, input(db, { discount: 100 })); assert.equal(sale.tax, 0); db.settings.gstEnabled = true; const taxed = checkout(db, owner, input(db, { discount: 101.5 })); assert.equal(taxed.tax, Math.round((taxed.subtotal - taxed.discount) * .05 * 100) / 100); assert.deepEqual(calculateBill(1000, 100, 5), { tax: 45, total: 945 });
});
test('sale rollback prevents overselling even with duplicate product lines', () => {
  const db = fresh(); db.products[1].quantity = 4; const before = JSON.stringify(db);
  assert.throws(() => transaction(db, d => checkout(d, owner, input(d, { lines: [{ productId: d.products[1].id, quantity: 3 }, { productId: d.products[1].id, quantity: 3 }] }))), /Only 4/); assert.equal(JSON.stringify(db), before);
});
test('negative quantities, excessive discounts and invalid mobiles are rejected', () => {
  for (const override of [{ discount: -1 }, { discount: 1e8 }, { mobile: '123' }, { lines: [{ productId: 'p-2', quantity: -1 }] }, { lines: [] }]) { const db = fresh(); assert.throws(() => transaction(db, d => checkout(d, owner, input(d, override)))); }
});
test('permissions are enforced in domain actions, beyond disabled UI controls', () => {
  const db = fresh(); assert.throws(() => checkout(db, 'Inventory Manager', input(db)), /permission/); assert.throws(() => adjustStock(db, 'Cashier', 'p-2', 5, 'Count'), /permission/); assert.throws(() => saveExpense(db, 'Cashier', { amount: 5 }), /permission/); assert.throws(() => removeProduct(db, 'Inventory Manager', 'p-2'), /permission/);
});
test('purchases are received once and weighted purchase cost uses existing stock', () => {
  const db = fresh(); const p = db.products[1]; p.quantity = 20; p.purchasePrice = 100;
  createPurchase(db, owner, { id: 'test-po', reference: 'PO-TEST', supplierId: db.suppliers[0].id, date: '2026-11-07', lines: [{ productId: p.id, name: p.name, sku: p.sku, quantity: 10, cost: 160 }], total: 1600, status: 'Ordered', paymentStatus: 'Unpaid' });
  assert.equal(p.quantity, 20); receivePurchase(db, owner, 'test-po'); assert.equal(p.quantity, 30); assert.equal(p.purchasePrice, 120); assert.equal(db.purchases[0].status, 'Received'); assert.throws(() => receivePurchase(db, owner, 'test-po'), /already been received/); assert.equal(p.quantity, 30);
});
test('purchase validation rejects missing supplier, fractional stock and duplicate lines', () => {
  const db = fresh(); const line = { productId: 'p-2', name: 'Test', sku: 'T', quantity: 1, cost: 100 }; const base = { id: 'test', reference: 'test', supplierId: 'su-1', date: '2026-11-07', lines: [line], total: 100, paymentStatus: 'Unpaid' };
  assert.throws(() => createPurchase(db, owner, { ...base, supplierId: 'missing' })); assert.throws(() => createPurchase(db, owner, { ...base, lines: [{ ...line, quantity: 1.5 }] })); assert.throws(() => createPurchase(db, owner, { ...base, lines: [line, line] }));
});
test('receiving a partially invalid purchase is atomic', () => {
  const db = fresh(); const order = db.purchases.find(p => p.status === 'Ordered'); db.products = db.products.filter(p => p.id !== order.lines[1].productId); const before = JSON.stringify(db); assert.throws(() => transaction(db, d => receivePurchase(d, owner, order.id)), /no longer exists/); assert.equal(JSON.stringify(db), before);
});
test('manual adjustments cannot produce negative stock and retain a reason', () => {
  const db = fresh(); const p = db.products[1]; const qty = p.quantity; adjustStock(db, owner, p.id, 5, 'Physical count'); assert.equal(p.quantity, qty + 5); assert.equal(db.movements[0].reason, 'Physical count'); assert.throws(() => adjustStock(db, owner, p.id, -1e6, 'Damage')); assert.throws(() => adjustStock(db, owner, p.id, 1, ''));
});
test('SKU/barcode uniqueness, product edits and protected open purchase references', () => {
  const db = fresh(); assert.throws(() => saveProduct(db, owner, { ...db.products[1], id: 'new' }), /already uses/); const qty = db.products[1].quantity; saveProduct(db, owner, { ...db.products[1], quantity: 900 }); assert.equal(db.products[1].quantity, qty); const id = db.purchases[0].lines[0].productId; assert.throws(() => removeProduct(db, owner, id), /open purchase/);
});
test('search includes barcode; filters, sort and pagination compose', () => {
  const db = fresh(); const p = db.products[1]; assert.equal(queryProducts(db, { search: p.barcode }).items[0].id, p.id); const low = queryProducts(db, { stock: 'Low stock', pageSize: 100 }); assert.ok(low.items.every(p => p.quantity <= p.minStock)); const jeans = queryProducts(db, { category: 'Jeans', sort: 'price-desc', page: 2, pageSize: 5 }); assert.equal(jeans.total, 16); assert.equal(jeans.items.length, 5); assert.equal(jeans.page, 2); assert.equal(queryProducts(db, { search: 'does-not-exist', page: 7 }).page, 1);
});
test('profit excludes tax and allocates discount only to cost-known lines', () => {
  const sale = { subtotal: 300, discount: 30, tax: 13.5, total: 283.5, lines: [{ productId: 'known', name: 'Known', sku: 'K', price: 200, quantity: 1, cost: 100 }, { productId: 'unknown', name: 'Unknown', sku: 'U', price: 100, quantity: 1, cost: null }] };
  const rows = productSales([sale]); assert.equal(sum(rows, r => r.revenue), 270); assert.equal(sum(rows, r => r.grossProfit), 80); assert.equal(sum(rows, r => r.knownCostUnits), 1);
});
test('date reports use local calendar dates inclusively', () => { const db = fresh(); const date = dateKey(db.sales.at(-1).date); assert.ok(salesInRange(db.sales, date, date).length > 0); assert.ok(salesInRange(db.sales, '2040-01-01', '2040-01-02').length === 0); });
test('settings preserve non-registration and last active owner cannot be removed', () => {
  const db = fresh(); assert.equal(db.settings.gstEnabled, false); assert.throws(() => saveSettings(db, owner, { ...db.settings, gstEnabled: true, gstin: '' }), /GSTIN/); assert.throws(() => saveStaff(db, owner, { ...db.staff[0], active: false }), /active owner/); saveSettings(db, owner, { ...db.settings, taxRate: 12 }); assert.equal(db.settings.taxRate, 12);
});
test('CSV supports quoted commas and rejects malformed or empty files', () => {
  const csv = 'name,sku,barcode,category,brand,size,colour,purchasePrice,sellingPrice,quantity,minStock\r\n"Cotton, classic",NEW1,8901000777777,Shirts,Demo,M,Navy,100,200,4,2';
  const [p] = parseProductCsv(csv); assert.equal(p.name, 'Cotton, classic'); assert.equal(p.quantity, 4); assert.throws(() => parseProductCsv('name,sku')); assert.throws(() => parseProductCsv(csv + '\n"unclosed')); assert.throws(() => parseProductCsv(csv.replace(',100,200,', ',,200,')), /purchasePrice is required/);
});

test('financial amounts reject fractional paise and dates reject impossible calendar values', () => {
  const db = fresh(); assert.throws(() => checkout(db, owner, input(db, { discount: 1.001 })), /two decimal/);
  assert.throws(() => saveExpense(db, owner, { id: 'invalid', category: 'Other', description: 'Invalid date', amount: 10, date: '2026-02-31' }), /valid date/);
});

test('repository serializes concurrent writes and persists successful transactions', async () => {
  const memory = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) } });
  const db = await repository.load(); const before = db.products[1].quantity;
  await Promise.all([repository.transaction(d => adjustStock(d, owner, 'p-2', 1, 'First count')), repository.transaction(d => adjustStock(d, owner, 'p-2', 2, 'Second count'))]);
  const saved = await repository.load(); assert.equal(saved.products[1].quantity, before + 3); assert.equal(saved.revision, 2); assert.equal(JSON.parse(memory.get(STORAGE_KEY)).movements.length, 2);
});

test('repository does not commit failed operations or overwrite unreadable saved data', async () => {
  let saved = JSON.stringify(fresh());
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => saved, setItem: (_key, value) => { saved = value; } } });
  const before = saved; await assert.rejects(repository.transaction(d => { d.products[1].quantity = 99; throw new Error('Rejected'); }), /Rejected/); assert.equal(saved, before);
  saved = '{broken'; await assert.rejects(repository.load(), /not been overwritten/); assert.equal(saved, '{broken');
});

test('storage quota failures report an error without persisting stock changes', async () => {
  const saved = JSON.stringify(fresh());
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => saved, setItem: () => { throw new Error('QuotaExceededError'); } } });
  await assert.rejects(repository.transaction(d => adjustStock(d, owner, 'p-2', 5, 'Count')), /could not save/);
  assert.equal((await repository.load()).products[1].quantity, fresh().products[1].quantity);
  delete globalThis.localStorage;
});
