import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPostgresPool, openPostgres } from '../server/postgres.mjs';
import { migratePostgres } from '../server/migrate.mjs';
import { createSaas } from '../server/saas.mjs';
import { fakeBilling } from './support/fake-billing.mjs';
import { PLAN } from '../server/billing.mjs';

// Opt-in only. Never load the application's .env here.
test('real PostgreSQL: migrations, RLS, cross-process stock races and refund locking', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to a separate test database after installing the driver.',
}, async t => {
  const env = { DATABASE_URL: process.env.TEST_DATABASE_URL, DATABASE_SSL: process.env.TEST_DATABASE_SSL, DATABASE_CA_FILE: process.env.TEST_DATABASE_CA_FILE };
  const pool = createPostgresPool(env);
  await migratePostgres(pool);
  assert.equal(await migratePostgres(pool), false);
  const first = await openPostgres({ pool }), second = await openPostgres({ pool: createPostgresPool(env) });
  const billing = fakeBilling();
  const origin = 'http://127.0.0.1:5173';
  const appA = await createSaas({ backend: first, billing, allowedOrigins: [origin] });
  const appB = await createSaas({ backend: second, billing, allowedOrigins: [origin] });
  const ids = [];
  t.after(async () => {
    try {
      for (const id of ids) {
        await first.registry.atomic(async () => {
          const sql = first.tenant(id).sql;
          for (const table of ['sessions','credentials','requests','audit','records','metadata']) await sql.prepare('DELETE FROM ' + table).run();
          for (const table of ['cancellation_requests','refund_requests']) await first.registry.prepare('DELETE FROM ' + table + ' WHERE workspace_id=?').run(id);
          await first.registry.prepare('DELETE FROM workspaces WHERE id=?').run(id);
        });
      }
    } finally { await appA.close(); await appB.close(); }
  });
  const listen = async app => { await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); return 'http://127.0.0.1:' + app.server.address().port; };
  const [baseA, baseB] = await Promise.all([listen(appA), listen(appB)]);
  async function request(base, path, payload, cookie = '', headers = {}) {
    const response = await fetch(base + path, { method: payload === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-Retail-Request': '1', ...headers }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function register() {
    const slug = 'pgtest-' + randomUUID().slice(0, 12);
    const result = await request(baseA, '/api/public/register', { slug, shopName: 'PostgreSQL test', name: 'Test Owner', email: slug + '@example.test', password: 'PostgreSQL test password!', sampleData: false, acceptTerms: true, billingPolicy: PLAN.policy });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    const row = await first.registry.prepare('SELECT * FROM workspaces WHERE slug=?').get(slug); ids.push(row.id);
    assert.equal((await request(baseA, '/api/w/' + slug + '/billing/refresh', {}, result.cookie)).status, 200);
    return { ...row, cookie: result.cookie };
  }
  const a = await register(), b = await register();
  const command = (base, user, type, input, revision) => request(base, '/api/w/' + user.slug + '/commands', { type, input, expectedRevision: revision }, user.cookie, { 'Idempotency-Key': randomUUID() });
  const product = { id: 'last-shirt', styleId: 'shirt', name: 'Test shirt', sku: 'SAME-SKU', barcode: 'SAME-CODE', category: 'Shirts', brand: 'Test', size: 'M', colour: 'Blue', image: '', purchasePrice: 100, sellingPrice: 200, quantity: 1, minStock: 2 };
  assert.equal((await command(baseA, a, 'product.save', product, 0)).status, 200);
  assert.equal((await command(baseB, b, 'product.save', product, 0)).status, 200);
  assert.equal((await request(baseB, '/api/w/' + b.slug + '/state', undefined, a.cookie)).status, 401);
  const aSql = first.tenant(a.id).sql;
  assert.deepEqual(await aSql.prepare('SELECT * FROM records WHERE workspace_id=?').all(b.id), []);
  assert.equal((await aSql.prepare('UPDATE records SET position=99 WHERE workspace_id=?').run(b.id)).changes, 0);
  await assert.rejects(aSql.prepare('INSERT INTO records(kind,id,position,data,workspace_id) VALUES(?,?,?,?,?)').run('products', 'foreign', 0, JSON.stringify(product), b.id), /row-level security/);
  const sale = { lines: [{ productId: product.id, quantity: 1 }], discount: 0, customerName: '', mobile: '', paymentMethod: 'Cash' };
  const sales = await Promise.all([command(baseA, a, 'sale.create', sale, 1), command(baseB, a, 'sale.create', sale, 1)]);
  assert.deepEqual(sales.map(result => result.status).sort(), [200, 409]);
  assert.equal((await first.tenant(a.id).read()).sales.length, 1);
  assert.equal((await second.tenant(b.id).read()).products[0].quantity, 1);
  const cancellations = await Promise.all([
    request(baseA, '/api/w/' + a.slug + '/billing/cancel', { refundExpected: true }, a.cookie),
    request(baseB, '/api/w/' + a.slug + '/billing/cancel', { refundExpected: true }, a.cookie),
  ]);
  assert.ok(cancellations.every(result => result.status === 200 && result.data.refundStatus === 'processed'));
  assert.equal(billing.calls.refund.length, 1);
  assert.equal((await request(baseB, '/api/w/' + a.slug + '/billing/refresh', {}, a.cookie)).data.canWrite, false);
});
