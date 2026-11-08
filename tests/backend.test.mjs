import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHmac } from 'node:crypto';
import { createSaas } from '../server/saas.mjs';
import { razorpayClient, PLAN } from '../server/billing.mjs';
import { fakeBilling, webhookSecret } from './support/fake-billing.mjs';
import { readSqliteImport, importIntoPostgres } from '../server/import-sqlite.mjs';

const origin = 'http://127.0.0.1:5173';
const password = 'Test password for ERP 123!';
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'retail-api-'));
  const billing = options.billing || fakeBilling({ now: options.now || Date.now });
  options = { ...options, billing };
  let app = await createSaas({ dataDir: dir, allowedOrigins: [origin], ...options });
  async function listen() { await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${app.server.address().port}`; }
  let base = await listen();
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  async function request(path, payload, cookie = '', headers = {}) {
    const response = await fetch(base + path, { method: payload === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-Retail-Request': '1', ...headers }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
  }
  async function register(slug, sampleData = true) {
    const result = await request('/api/public/register', { slug, shopName: slug, name: 'Test Owner', email: `${slug}@example.test`, password, sampleData, acceptTerms: true, billingPolicy: PLAN.policy });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    const user = { slug, cookie: result.cookie };
    const refreshed = await request(`/api/w/${slug}/billing/refresh`, {}, user.cookie);
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.data));
    return user;
  }
  const route = (user, path) => `/api/w/${user.slug}${path}`;
  const state = async user => (await request(route(user, '/state'), undefined, user.cookie)).data;
  async function command(user, type, input, extra = {}) {
    const expectedRevision = extra.revision ?? (await state(user)).data.revision;
    return request(route(user, '/commands'), { type, input, expectedRevision }, user.cookie, { 'Idempotency-Key': extra.key || randomUUID() });
  }
  return { request, register, state, command, route, billing, dataDir: dir, get app() { return app; }, async restart() { await app.close(); app = await createSaas({ dataDir: dir, allowedOrigins: [origin], ...options }); base = await listen(); } };
}
const product = { id: 'new-sku', styleId: 'style', name: 'New shirt', sku: 'NEW-001', barcode: '90000000001', category: 'Shirts', brand: 'Test', size: 'M', colour: 'Blue', image: '', purchasePrice: 100, sellingPrice: 200, quantity: 1, minStock: 2 };
const sale = { lines: [{ productId: 'new-sku', quantity: 1 }], discount: 0, customerName: '', mobile: '', paymentMethod: 'Cash' };

test('registration isolates stores, rejects cross-tenant cookies and persists across restart', async t => {
  const f = await fixture(t), a = await f.register('alpha-store', false), b = await f.register('beta-store', false);
  assert.equal((await f.command(a, 'product.save', product)).status, 200);
  assert.equal((await f.state(b)).data.products.length, 0);
  assert.equal((await f.request(f.route(b, '/state'), undefined, a.cookie)).status, 401);
  assert.equal((await f.request(f.route(a, '/state'))).status, 401);
  assert.equal((await f.request(f.route(a, '/auth/setup'), {})).status, 403);
  await f.restart();
  assert.equal((await f.state(a)).data.products[0].sku, 'NEW-001');
  assert.equal((await f.state(b)).data.products.length, 0);
});

test('authentication, CSRF checks, password changes and role redaction are enforced on the server', async t => {
  const f = await fixture(t), owner = await f.register('staff-store');
  const staff = { id: 'cashier', name: 'Cashier', email: 'cashier@example.test', role: 'Cashier', active: true, password };
  assert.equal((await f.command(owner, 'staff.save', staff)).status, 200);
  const login = await f.request(f.route(owner, '/auth/login'), { email: staff.email, password });
  assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie'), /HttpOnly.*SameSite=Strict/);
  const cashier = { ...owner, cookie: login.cookie };
  const state = await f.state(cashier);
  assert.equal(state.user.role, 'Cashier'); assert.equal(state.data.staff.length, 1);
  assert.equal(state.data.products[0].purchasePrice, 0); assert.equal(state.data.sales[0].lines[0].cost, null);
  assert.deepEqual(state.data.expenses, []); assert.deepEqual(state.data.purchases, []);
  assert.equal((await f.command(cashier, 'product.save', product)).status, 403);
  assert.equal((await f.request(f.route(cashier, '/backup'), undefined, cashier.cookie)).status, 403);
  assert.equal((await f.request(f.route(cashier, '/billing'), undefined, cashier.cookie)).status, 403);
  assert.equal((await f.request(f.route(owner, '/auth/logout'), {}, owner.cookie, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.request(f.route(owner, '/auth/logout'), {}, owner.cookie, { 'X-Retail-Request': '' })).status, 403);
  const wrong = await f.request(f.route(owner, '/auth/login'), { email: staff.email, password: 'wrong' }); assert.equal(wrong.status, 401);
  assert.equal((await f.request(f.route(cashier, '/auth/password'), { currentPassword: password, password: password + 'new' }, cashier.cookie)).status, 200);
  assert.equal((await f.request(f.route(cashier, '/state'), undefined, cashier.cookie)).status, 401);
  assert.equal((await f.command(owner, 'staff.save', { ...staff, active: false, password: undefined })).status, 200);
  assert.equal((await f.request(f.route(owner, '/auth/login'), { email: staff.email, password: password + 'new' })).status, 401);
});

test('checkout is atomic, retry-safe, rejects stale writes and never oversells', async t => {
  const f = await fixture(t), owner = await f.register('stock-store', false);
  await f.command(owner, 'product.save', product);
  const revision = (await f.state(owner)).data.revision, key = randomUUID();
  const [first, second] = await Promise.all([f.command(owner, 'sale.create', sale, { revision, key }), f.command(owner, 'sale.create', sale, { revision })]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  const success = first.status === 200 ? first : second;
  assert.equal(success.data.result.total, 200);
  const after = await f.state(owner); assert.equal(after.data.products[0].quantity, 0); assert.equal(after.data.sales.length, 1);
  if (first.status === 200) {
    const retry = await f.command(owner, 'sale.create', sale, { revision, key });
    assert.equal(retry.status, 200); assert.equal(retry.data.result.id, first.data.result.id);
    assert.equal((await f.command(owner, 'sale.create', { ...sale, discount: 10 }, { revision, key })).status, 409);
  }
  assert.equal((await f.command(owner, 'sale.create', sale)).status, 400);
  assert.equal((await f.state(owner)).data.sales.length, 1);
  const invalid = await f.command(owner, 'product.import', { products: [{ ...product, id: 'other', sku: 'OK', barcode: 'OK' }, { ...product, id: 'third', sku: 'OK', barcode: 'different' }] });
  assert.equal(invalid.status, 400); assert.equal((await f.state(owner)).data.products.length, 1);
  assert.equal((await f.command(owner, 'product.save', { ...product, sellingPrice: '200' })).status, 400);
});

test('purchases, inventory, expenses, settings and pagination use the backend', async t => {
  const f = await fixture(t), owner = await f.register('workflow-store');
  let state = await f.state(owner); const order = state.data.purchases.find(p => p.status === 'Ordered');
  const line = order.lines[0], before = state.data.products.find(p => p.id === line.productId).quantity;
  assert.equal((await f.command(owner, 'purchase.receive', { id: order.id })).status, 200);
  assert.equal((await f.command(owner, 'purchase.receive', { id: order.id })).status, 400);
  state = await f.state(owner); assert.equal(state.data.products.find(p => p.id === line.productId).quantity, before + line.quantity);
  assert.equal((await f.command(owner, 'purchase.payment', { id: order.id, paymentStatus: 'Paid' })).status, 200);
  assert.equal((await f.command(owner, 'expense.create', { id: 'expense-new', category: 'Utilities', description: 'Power', amount: 500, date: '2026-11-08' })).status, 200);
  assert.equal((await f.command(owner, 'settings.save', { ...state.data.settings, shopName: 'Updated shop' })).status, 200);
  const products = await f.request(f.route(owner, '/products?category=Jeans&pageSize=3&page=2'), undefined, owner.cookie);
  assert.equal(products.data.total, 16); assert.equal(products.data.items.length, 3); assert.equal(products.data.page, 2);
  const backup = await f.request(f.route(owner, '/backup'), undefined, owner.cookie);
  assert.equal(backup.data.settings.shopName, 'Updated shop'); assert.ok(!JSON.stringify(backup.data).includes('password_hash'));
});

test('new workspaces require a captured monthly payment before edits are allowed', async t => {
  const billing = fakeBilling({ autoCapture: false });
  const f = await fixture(t, { billing }), owner = await f.register('unpaid-store');
  const before = await f.state(owner);
  assert.equal(before.workspace.canWrite, false); assert.equal(before.workspace.refundDeadline, null);
  assert.equal((await f.command(owner, 'product.save', product)).status, 402);
  assert.equal((await f.request(f.route(owner, '/backup'), undefined, owner.cookie)).status, 200);
  const workspace = (await f.app.registry.prepare('SELECT * FROM workspaces WHERE slug=?').get(owner.slug));
  billing.subscriptions.get(workspace.subscription_id).status = 'authenticated';
  await f.request(f.route(owner, '/billing/refresh'), {}, owner.cookie);
  assert.equal((await f.state(owner)).workspace.canWrite, false);
  const payment = billing.capture(workspace.subscription_id);
  await f.request(f.route(owner, '/billing/refresh'), {}, owner.cookie);
  const after = await f.state(owner);
  assert.equal(after.workspace.canWrite, true); assert.equal(after.workspace.refundEligible, true);
  assert.equal(new Date(after.workspace.refundDeadline).getTime(), payment.created_at * 1000 + 7 * 86400000);
});

test('Razorpay requests validate the price and webhook signatures use the raw body', async () => {
  const calls = [];
  const client = razorpayClient({ keyId: 'test_id', keySecret: 'test_secret', planId: 'plan_test', webhookSecret: 'webhook_test', fetcher: async (url, options) => {
    calls.push({ url, options }); return { ok: true, json: async () => url.includes('/plans/') ? { ...PLAN, item: { amount: PLAN.amount, currency: PLAN.currency } } : { id: 'sub_test', short_url: 'https://rzp.io/test' } };
  } });
  await client.create({ id: 'workspace', trial_end: Date.now() + 7 * 86400000 });
  const input = JSON.parse(calls[1].options.body); assert.equal(input.plan_id, 'plan_test'); assert.equal(input.notes.workspaceId, 'workspace'); assert.equal(Object.hasOwn(input, 'start_at'), false);
  const raw = Buffer.from('{"event":"subscription.charged"}');
  const signature = createHmac('sha256', 'webhook_test').update(raw).digest('hex');
  assert.equal(client.verify(raw, signature), true); assert.equal(client.verify(Buffer.concat([raw, Buffer.from(' ')]), signature), false);
});

test('verified billing events are deduplicated and cannot activate another tenant', async t => {
  const billing = fakeBilling({ autoCapture: false });
  const f = await fixture(t, { billing }), a = await f.register('billing-store', false), b = await f.register('other-store', false);
  const count = billing.calls.create.length;
  await Promise.all([f.request(f.route(a, '/billing/subscribe'), { billingPolicy: PLAN.policy }, a.cookie), f.request(f.route(a, '/billing/subscribe'), { billingPolicy: PLAN.policy }, a.cookie)]);
  assert.equal(billing.calls.create.length, count);
  const workspace = (await f.app.registry.prepare('SELECT * FROM workspaces WHERE slug=?').get(a.slug));
  billing.capture(workspace.subscription_id);
  const payload = { event: 'subscription.charged', payload: { subscription: { entity: { id: workspace.subscription_id } } } };
  const signature = createHmac('sha256', webhookSecret).update(JSON.stringify(payload)).digest('hex');
  assert.equal((await f.request('/api/webhooks/razorpay', payload, '', { 'x-razorpay-signature': '0'.repeat(64), 'x-razorpay-event-id': 'bad-event' })).status, 401);
  assert.equal((await f.request('/api/webhooks/razorpay', payload, '', { 'x-razorpay-signature': signature, 'x-razorpay-event-id': 'event-1' })).status, 200);
  assert.equal((await f.state(a)).workspace.canWrite, true); assert.equal((await f.state(b)).workspace.canWrite, false);
  await f.request('/api/webhooks/razorpay', payload, '', { 'x-razorpay-signature': signature, 'x-razorpay-event-id': 'event-1' });
  assert.equal((await f.app.registry.prepare('SELECT count(*) AS count FROM webhook_events').get()).count, 1);
  assert.equal((await f.command(a, 'product.save', product)).status, 200);
  assert.equal((await f.command(b, 'product.save', product)).status, 402);
});

test('cancellation within seven days refunds the first month once, including concurrent retries and restart', async t => {
  const f = await fixture(t), owner = await f.register('refund-store');
  const [a, b] = await Promise.all([
    f.request(f.route(owner, '/billing/cancel'), { refundExpected: true }, owner.cookie),
    f.request(f.route(owner, '/billing/cancel'), { refundExpected: true }, owner.cookie),
  ]);
  assert.equal(a.status, 200, JSON.stringify(a.data)); assert.equal(b.status, 200);
  assert.equal(a.data.refundStatus, 'processed'); assert.equal(a.data.refundAmount, 150000);
  assert.equal(a.data.canWrite, false); assert.equal(a.data.paidUntil, null);
  assert.equal(f.billing.calls.refund.length, 1); assert.equal(f.billing.calls.refund[0].amount, 150000);
  assert.equal(f.billing.calls.cancel.length, 1); assert.equal(f.billing.calls.cancel[0].atCycleEnd, false);
  const refundId = a.data.refundId;
  await f.restart();
  const retry = await f.request(f.route(owner, '/billing/cancel'), {}, owner.cookie);
  assert.equal(retry.data.refundId, refundId); assert.equal(f.billing.calls.refund.length, 1);
  assert.equal((await f.command(owner, 'product.save', product)).status, 402);
  assert.equal((await f.request(f.route(owner, '/backup'), undefined, owner.cookie)).status, 200);
});

test('cancelling after day seven only stops renewal; a later payment does not restart the guarantee', async t => {
  let clock = Date.now();
  const f = await fixture(t, { now: () => clock }), owner = await f.register('late-cancel');
  const before = await f.state(owner), deadline = before.workspace.refundDeadline;
  clock += 8 * 86400000;
  const stale = await f.request(f.route(owner, '/billing/cancel'), { refundExpected: true }, owner.cookie);
  assert.equal(stale.status, 409); assert.equal(f.billing.calls.cancel.length, 0);
  assert.equal((await f.app.registry.prepare('SELECT count(*) AS count FROM cancellation_requests').get()).count, 0);
  const cancelled = await f.request(f.route(owner, '/billing/cancel'), {}, owner.cookie);
  assert.equal(cancelled.status, 200); assert.equal(cancelled.data.refundStatus, null);
  assert.equal(cancelled.data.canWrite, true); assert.equal(cancelled.data.cancelPending, true);
  assert.equal(f.billing.calls.refund.length, 0); assert.equal(f.billing.calls.cancel[0].atCycleEnd, true);
  const row = (await f.app.registry.prepare('SELECT * FROM workspaces WHERE slug=?').get(owner.slug));
  clock += 23 * 86400000;
  f.billing.capture(row.subscription_id, clock);
  const renewed = await f.request(f.route(owner, '/billing/refresh'), {}, owner.cookie);
  assert.equal(renewed.data.refundDeadline, deadline); assert.equal(renewed.data.refundEligible, false);
  assert.equal(f.billing.calls.refund.length, 0);
});

test('a cancellation received before the deadline remains refundable after a gateway outage', async t => {
  let clock = Date.now();
  const f = await fixture(t, { now: () => clock }), owner = await f.register('deadline-retry');
  const deadline = new Date((await f.state(owner)).workspace.refundDeadline).getTime();
  const originalCancel = f.billing.cancel;
  f.billing.cancel = async () => { throw new Error('Simulated provider outage'); };
  clock = deadline - 1000;
  assert.equal((await f.request(f.route(owner, '/billing/cancel'), { refundExpected: true }, owner.cookie)).status, 500);
  assert.equal(f.billing.calls.refund.length, 0);
  f.billing.cancel = originalCancel; clock = deadline + 86400000;
  const retry = await f.request(f.route(owner, '/billing/cancel'), {}, owner.cookie);
  assert.equal(retry.status, 200); assert.equal(retry.data.refundStatus, 'processed');
  assert.equal(f.billing.calls.refund.length, 1);
});

test('a lost refund response reconciles pending and processed provider refunds without resubmitting', async t => {
  const f = await fixture(t), owner = await f.register('refund-network');
  const originalRefund = f.billing.refund;
  f.billing.refund = async (...args) => {
    const result = await originalRefund(...args);
    const payment = f.billing.paymentRecords.get(result.payment_id);
    payment.status = 'captured'; payment.amount_refunded = 0;
    f.billing.refundRecords.get(payment.id)[0].status = 'pending';
    throw new Error('Response lost after provider accepted the refund');
  };
  const cancelled = await f.request(f.route(owner, '/billing/cancel'), {}, owner.cookie);
  assert.equal(cancelled.data.refundStatus, 'review_required'); assert.equal(cancelled.data.canWrite, false);
  await f.restart();
  const reconciled = await f.request(f.route(owner, '/billing/refresh'), {}, owner.cookie);
  assert.equal(reconciled.data.refundStatus, 'pending'); assert.equal(f.billing.calls.refund.length, 1);
  const row = (await f.app.registry.prepare('SELECT * FROM workspaces WHERE slug=?').get(owner.slug));
  f.billing.paymentRecords.get(row.first_payment_id).amount_refunded = PLAN.amount;
  f.billing.paymentRecords.get(row.first_payment_id).status = 'refunded';
  f.billing.refundRecords.get(row.first_payment_id)[0].status = 'processed';
  const payload = { event: 'refund.processed', payload: { refund: { entity: { payment_id: row.first_payment_id } } } };
  const signature = createHmac('sha256', webhookSecret).update(JSON.stringify(payload)).digest('hex');
  assert.equal((await f.request('/api/webhooks/razorpay', payload, '', { 'x-razorpay-signature': signature, 'x-razorpay-event-id': 'refund-processed' })).status, 200);
  assert.equal((await f.state(owner)).workspace.refundStatus, 'processed');
  assert.equal((await f.state(owner)).workspace.canWrite, false); assert.equal(f.billing.calls.refund.length, 1);
});

test('an uncertain refund with no provider record is not blindly retried', async t => {
  const f = await fixture(t), owner = await f.register('uncertain-refund');
  let attempts = 0;
  f.billing.refund = async () => { attempts++; throw new Error('Connection closed before response'); };
  const first = await f.request(f.route(owner, '/billing/cancel'), {}, owner.cookie);
  assert.equal(first.data.refundStatus, 'review_required');
  for (let i = 0; i < 3; i++) await f.request(f.route(owner, '/billing/cancel'), {}, owner.cookie);
  assert.equal(attempts, 1); assert.equal((await f.state(owner)).workspace.refundStatus, 'review_required');
});

test('a definitive refund rejection can be retried and partial refunds only return the balance', async t => {
  const f = await fixture(t), owner = await f.register('refund-rejected');
  const row = (await f.app.registry.prepare('SELECT * FROM workspaces WHERE slug=?').get(owner.slug));
  f.billing.paymentRecords.get(row.first_payment_id).amount_refunded = 50000;
  const originalRefund = f.billing.refund;
  f.billing.refund = async () => { const error = new Error('Provider explicitly rejected the request'); error.providerRejected = true; throw error; };
  const first = await f.request(f.route(owner, '/billing/cancel'), {}, owner.cookie);
  assert.equal(first.data.refundStatus, 'failed');
  f.billing.refund = originalRefund;
  const retry = await f.request(f.route(owner, '/billing/cancel'), {}, owner.cookie);
  assert.equal(retry.data.refundStatus, 'processed'); assert.equal(f.billing.calls.refund[0].amount, 100000);
  assert.equal(f.billing.paymentRecords.get(row.first_payment_id).amount_refunded, 150000);
});

test('refund target comes from the authenticated workspace, never the submitted payment ID', async t => {
  const f = await fixture(t), a = await f.register('refund-owner-a'), b = await f.register('refund-owner-b');
  const rowA = (await f.app.registry.prepare('SELECT * FROM workspaces WHERE slug=?').get(a.slug));
  const rowB = (await f.app.registry.prepare('SELECT * FROM workspaces WHERE slug=?').get(b.slug));
  await f.request(f.route(a, '/billing/cancel'), { paymentId: rowB.first_payment_id, amount: 900000 }, a.cookie);
  assert.equal(f.billing.calls.refund[0].paymentId, rowA.first_payment_id);
  assert.equal(f.billing.paymentRecords.get(rowB.first_payment_id).amount_refunded, 0);
  assert.equal((await f.state(b)).workspace.canWrite, true);
});

test('missing payment configuration blocks signup and preserves legacy trial access', async t => {
  const f = await fixture(t, { billing: razorpayClient() });
  const result = await f.request('/api/public/register', { slug: 'not-configured', shopName: 'Shop', name: 'Owner', email: 'owner@example.test', password, sampleData: false, acceptTerms: true, billingPolicy: PLAN.policy });
  assert.equal(result.status, 503); assert.equal((await f.app.registry.prepare('SELECT count(*) AS count FROM workspaces').get()).count, 0);
  const other = await fixture(t), owner = await other.register('legacy-workspace');
  (await other.app.registry.prepare("UPDATE workspaces SET billing_policy='legacy_trial',paid_until=0,trial_end=? WHERE slug=?").run(Date.now() + 86400000, owner.slug));
  const state = await other.state(owner); assert.equal(state.workspace.legacyTrial, true); assert.equal(state.workspace.canWrite, true);
});

test('refund API sends a bounded amount to the original payment with a persisted reference', async () => {
  const calls = [];
  const client = razorpayClient({ keyId: 'test_id', keySecret: 'test_secret', planId: 'plan_test', webhookSecret, fetcher: async (url, options) => {
    calls.push({ url, options }); return { ok: true, json: async () => ({ id: 'rfnd_test', payment_id: 'pay_original', amount: 150000, status: 'pending' }) };
  } });
  await client.refund('pay_original', 150000, 'rf_saved_reference', 'workspace');
  assert.equal(calls[0].url, 'https://api.razorpay.com/v1/payments/pay_original/refund');
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.amount, 150000); assert.equal(payload.receipt, 'rf_saved_reference');
  assert.equal(payload.notes.workspaceId, 'workspace'); assert.equal(payload.speed, 'normal');
});

test('reserved refund amounts remain pending and failed refunds require an explicit retry', async t => {
  const f = await fixture(t), owner = await f.register('reserved-refund');
  const originalRefund = f.billing.refund;
  f.billing.refund = async (...args) => {
    const refund = await originalRefund(...args);
    f.billing.refundRecords.get(refund.payment_id)[0].status = 'pending';
    return { ...refund, status: 'pending' };
  };
  const first = await f.request(f.route(owner, '/billing/cancel'), {}, owner.cookie);
  assert.equal(first.data.refundStatus, 'pending');
  const pending = await f.request(f.route(owner, '/billing/refresh'), {}, owner.cookie);
  assert.equal(pending.data.refundStatus, 'pending'); assert.equal(f.billing.calls.refund.length, 1);
  const row = (await f.app.registry.prepare('SELECT * FROM workspaces WHERE slug=?').get(owner.slug));
  const payment = f.billing.paymentRecords.get(row.first_payment_id);
  assert.equal(payment.amount_refunded, PLAN.amount);
  payment.status = 'captured'; payment.amount_refunded = 0;
  f.billing.refundRecords.get(payment.id)[0].status = 'failed';
  f.billing.refund = originalRefund;
  const payload = { event: 'refund.failed', payload: { refund: { entity: { payment_id: payment.id } } } };
  const signature = createHmac('sha256', webhookSecret).update(JSON.stringify(payload)).digest('hex');
  assert.equal((await f.request('/api/webhooks/razorpay', payload, '', { 'x-razorpay-signature': signature, 'x-razorpay-event-id': 'refund-failed' })).status, 200);
  await f.restart();
  const failed = await f.request(f.route(owner, '/billing/refresh'), {}, owner.cookie);
  assert.equal(failed.data.refundStatus, 'failed'); assert.equal(f.billing.calls.refund.length, 1);
  assert.equal((await f.request(f.route(owner, '/billing/subscribe'), { billingPolicy: PLAN.policy }, owner.cookie)).status, 409);
  const retried = await f.request(f.route(owner, '/billing/cancel'), {}, owner.cookie);
  assert.equal(retried.data.refundStatus, 'processed'); assert.equal(f.billing.calls.refund.length, 2);
  assert.notEqual(f.billing.calls.refund[0].receipt, f.billing.calls.refund[1].receipt);
});

test('an older failed refund does not authorize retrying a newer uncertain attempt', async t => {
  const f = await fixture(t), owner = await f.register('refund-attempts');
  const originalRefund = f.billing.refund;
  f.billing.refund = async (...args) => {
    const refund = await originalRefund(...args);
    f.billing.refundRecords.get(refund.payment_id)[0].status = 'failed';
    const payment = f.billing.paymentRecords.get(refund.payment_id);
    payment.amount_refunded = 0; payment.status = 'captured';
    return { ...refund, status: 'failed' };
  };
  const first = await f.request(f.route(owner, '/billing/cancel'), {}, owner.cookie);
  assert.equal(first.data.refundStatus, 'failed');
  let unknownAttempts = 0;
  f.billing.refund = async () => { unknownAttempts++; throw new Error('Response lost on second attempt'); };
  const retried = await f.request(f.route(owner, '/billing/cancel'), {}, owner.cookie);
  assert.equal(retried.data.refundStatus, 'review_required'); assert.equal(retried.data.refundId, null);
  await f.restart();
  for (const route of ['/billing/refresh', '/billing/cancel', '/billing/cancel']) {
    const result = await f.request(f.route(owner, route), {}, owner.cookie);
    assert.equal(result.data.refundStatus, 'review_required');
  }
  assert.equal(unknownAttempts, 1);
});

test('resubscribing after a refund keeps the original guarantee and allows renewal cancellation', async t => {
  const f = await fixture(t), owner = await f.register('subscribe-again');
  const initial = (await f.state(owner)).workspace;
  const before = (await f.app.registry.prepare('SELECT * FROM workspaces WHERE slug=?').get(owner.slug));
  await f.request(f.route(owner, '/billing/cancel'), {}, owner.cookie);
  assert.equal((await f.request(f.route(owner, '/billing/subscribe'), { billingPolicy: PLAN.policy }, owner.cookie)).status, 200);
  const refreshed = await f.request(f.route(owner, '/billing/refresh'), {}, owner.cookie);
  assert.equal(refreshed.data.refundDeadline, initial.refundDeadline);
  assert.equal(refreshed.data.refundEligible, false); assert.equal(refreshed.data.refundForCurrentSubscription, false);
  assert.equal(refreshed.data.canWrite, true);
  const after = (await f.app.registry.prepare('SELECT * FROM workspaces WHERE slug=?').get(owner.slug));
  assert.notEqual(after.subscription_id, before.subscription_id);
  assert.equal(after.first_payment_id, before.first_payment_id);
  const cancelled = await f.request(f.route(owner, '/billing/cancel'), {}, owner.cookie);
  assert.equal(cancelled.data.cancelPending, true); assert.equal(cancelled.data.canWrite, true);
  assert.equal(f.billing.calls.cancel.at(-1).atCycleEnd, true); assert.equal(f.billing.calls.refund.length, 1);
});

test('a payment arriving after cancellation is refunded using the saved cancellation time', async t => {
  const billing = fakeBilling({ autoCapture: false });
  const f = await fixture(t, { billing }), owner = await f.register('late-capture');
  const row = (await f.app.registry.prepare('SELECT * FROM workspaces WHERE slug=?').get(owner.slug));
  const cancelled = await f.request(f.route(owner, '/billing/cancel'), {}, owner.cookie);
  assert.equal(cancelled.status, 200); assert.equal(cancelled.data.refundStatus, null);
  const payment = billing.capture(row.subscription_id);
  const refreshed = await f.request(f.route(owner, '/billing/refresh'), {}, owner.cookie);
  assert.equal(refreshed.data.refundStatus, 'processed'); assert.equal(refreshed.data.canWrite, false);
  assert.equal(billing.calls.refund[0].paymentId, payment.id);
  assert.equal(billing.calls.cancel.at(-1).atCycleEnd, false);
});

test('SQLite import preview preserves business records and refund history and rejects an occupied target', async t => {
  const f = await fixture(t), owner = await f.register('import-preview', false);
  await f.command(owner, 'product.save', product);
  await f.request(f.route(owner, '/billing/cancel'), { refundExpected: true }, owner.cookie);
  const before = await f.state(owner);
  const source = readSqliteImport(f.dataDir);
  assert.equal(source.workspaces.length, 1);
  assert.deepEqual(source.workspaces[0].db, before.data);
  assert.equal(source.workspaces[0].row.first_payment_id, source.refunds[0].payment_id);
  assert.equal(source.refunds[0].status, 'processed');
  assert.equal(new Date(source.workspaces[0].row.refund_deadline).toISOString(), before.workspace.refundDeadline);
  assert.equal(source.workspaces[0].credentials.length, 1);
  assert.equal(Object.hasOwn(source.workspaces[0], 'sessions'), false);
  await assert.rejects(importIntoPostgres({ registry: f.app.registry }, source), /empty PostgreSQL target/);
  assert.deepEqual((await f.state(owner)).data, before.data);
});
