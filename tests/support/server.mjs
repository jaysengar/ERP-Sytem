import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { createSaas } from '../../server/saas.mjs';
import { fakeBilling, webhookSecret } from './fake-billing.mjs';
export async function startTestServer() {
  const dir = await mkdtemp(join(tmpdir(), 'retail-browser-'));
  const billing = fakeBilling({ autoCapture: false });
  const app = await createSaas({ dataDir: dir, billing, allowedOrigins: ['http://127.0.0.1:5191'], staticDir: resolve('dist'), registrationLimit: 1000 });
  // Test-only provider callback. Production never imports this module.
  const handler = app.server.listeners('request')[0];
  app.server.removeListener('request', handler);
  app.server.on('request', async (request, response) => {
    const match = request.url?.match(/^\/__test\/pay\/(sub_[a-z0-9]+)$/);
    if (!match || request.method !== 'POST') return handler(request, response);
    if (!billing.subscriptions.has(match[1])) { response.writeHead(404); response.end(); return; }
    if (!billing.subscriptions.get(match[1]).paid_count) billing.capture(match[1]);
    const event = JSON.stringify({ event: 'subscription.charged', payload: { subscription: { entity: { id: match[1] } } } });
    const delivered = await fetch('http://127.0.0.1:5191/api/webhooks/razorpay', { method: 'POST', body: event,
      headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': createHmac('sha256', webhookSecret).update(event).digest('hex'), 'X-Razorpay-Event-Id': randomUUID() },
    });
    if (!delivered.ok) { response.writeHead(500); response.end(await delivered.text()); return; }
    response.writeHead(303, { Location: '/billing' }); response.end();
  });
  await new Promise((resolveReady, reject) => { app.server.once('error', reject); app.server.listen(5191, '127.0.0.1', resolveReady); });
  return async () => { await app.close(); await rm(dir, { recursive: true, force: true }); };
}
