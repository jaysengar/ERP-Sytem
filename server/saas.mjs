import { createServer } from 'node:http';
import { openSqlite } from './sqlite.mjs';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.mjs';
import { ApiError, currentUser, hashPassword, issueSession, protectWrite } from './security.mjs';
import { seedDatabase } from '../src/data/seed.ts';
import { PLAN, razorpayClient } from './billing.mjs';
import { subscriptionManager } from './subscriptions.mjs';

const json = (response, status, data) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); };
async function readBody(request, raw = false) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 100000) throw new ApiError(413, 'Request is too large.'); chunks.push(chunk); }
  const buffer = Buffer.concat(chunks);
  if (raw) return buffer;
  try { const value = JSON.parse(buffer); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new ApiError(400, 'Send a valid JSON object.'); }
}
export async function createSaas({ dataDir, backend, allowedOrigins, secureCookies = false, staticDir, billing = razorpayClient(), registrationEnabled = true, registrationLimit = 10, now = Date.now } = {}) {
  if (!backend) mkdirSync(dataDir, { recursive: true });
  const registry = backend?.registry || openSqlite(resolve(dataDir, 'platform.sqlite'));
  if (!backend) await registry.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, owner_email TEXT NOT NULL UNIQUE,
      trial_end INTEGER NOT NULL, subscription_id TEXT UNIQUE, subscription_status TEXT, paid_until INTEGER NOT NULL DEFAULT 0,
      checkout_url TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL);
  `);
  const subscriptions = await subscriptionManager(registry, billing, { now });
  const apps = new Map(), attempts = new Map();
  const origins = new Set(allowedOrigins);
  const find = async slug => (await registry.prepare('SELECT * FROM workspaces WHERE slug=?').get(slug));
  const locked = (key, action) => registry.withLock(key, action);
  function limit(request) {
    const now = Date.now(), key = request.socket.remoteAddress;
    for (const [ip, entry] of attempts) if (entry.until <= now) attempts.delete(ip);
    const entry = attempts.get(key) || { count: 0, until: now + 3600000 };
    attempts.set(key, entry);
    if (++entry.count > registrationLimit) throw new ApiError(429, 'Too many registration attempts. Please try again later.');
  }
  async function tenant(workspace) {
    if (!apps.has(workspace.id)) {
      const promise = createApp({ ...(backend ? { store: backend.tenant(workspace.id) } : { filename: resolve(dataDir, `${workspace.id}.sqlite`) }), allowedOrigins, secureCookies,
        workspaceInfo: () => subscriptions.view(workspace.id),
        authorizeWrite: async () => { if (!(await subscriptions.view(workspace.id)).canWrite) throw new ApiError(402, 'An active paid subscription is required to make changes. Ask the workspace owner to open Billing. Your existing records remain available.'); },
      });
      apps.set(workspace.id, promise);
    }
    return apps.get(workspace.id);
  }
  const shell = await createApp({ staticDir, allowedOrigins, secureCookies });
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('X-Frame-Options', 'DENY'); response.setHeader('Referrer-Policy', 'same-origin');
    try {
      const url = new URL(request.url, 'http://retail.local'), path = url.pathname;
      if (path === '/api/health') return json(response, 200, { ok: true });
      if (path === '/api/public/session' && request.method === 'GET') return json(response, 200, { user: null, setupRequired: false, setupKeyRequired: false });
      if (path === '/api/public/register' && request.method === 'POST') {
        if (!registrationEnabled) throw new ApiError(403, 'New registrations are currently closed.');
        protectWrite(request, origins); limit(request);
        const input = await readBody(request);
        if (typeof input.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{2,39}$/.test(input.slug) || typeof input.shopName !== 'string' || !input.shopName.trim() || input.shopName.length > 100) throw new ApiError(400, 'Enter a business name and a workspace ID with 3 to 40 lowercase letters, numbers or hyphens.');
        if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80 || typeof input.email !== 'string' || input.email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new ApiError(400, 'Enter your name and a valid email address.');
        if (input.acceptTerms !== true || input.billingPolicy !== PLAN.policy || typeof input.sampleData !== 'boolean') throw new ApiError(400, 'Confirm the upfront payment and seven-day refund terms, and choose whether to include sample records.');
        if (!billing.configured) throw new ApiError(503, 'Payment checkout is currently unavailable. Please try again later. No account or charge has been created.');
        const passwordHash = await hashPassword(input.password);
        const workspace = { id: randomUUID(), slug: input.slug, name: input.shopName.trim(), owner_email: input.email.toLowerCase().trim(), trial_end: now(), created_at: now() };
        if (await find(workspace.slug) || (await registry.prepare('SELECT 1 FROM workspaces WHERE owner_email=?').get(workspace.owner_email))) throw new ApiError(409, 'That workspace ID or owner email is already registered. Sign in or choose a different workspace ID.');
        const app = await tenant(workspace);
        const user = { id: 'owner', name: input.name.trim(), email: workspace.owner_email, role: 'Owner / Admin', active: true };
        // A platform transaction serializes uniqueness, while the tenant DB is
        // initialized before the workspace becomes visible to other requests.
        try { await registry.atomic(async () => {
          (await registry.prepare('INSERT INTO workspaces(id,slug,name,owner_email,trial_end,created_at,billing_policy) VALUES(?,?,?,?,?,?,?)').run(workspace.id, workspace.slug, workspace.name, workspace.owner_email, workspace.trial_end, workspace.created_at, PLAN.policy));
          (await app.store.atomic(async () => {
            const db = seedDatabase();
            if (!input.sampleData) for (const collection of ['products', 'sales', 'purchases', 'customers', 'suppliers', 'expenses', 'movements']) db[collection] = [];
            db.staff = [user]; db.settings.shopName = workspace.name; db.settings.profileName = user.name; db.settings.profileEmail = user.email;
            if (!input.sampleData) { db.settings.address = ''; db.settings.phone = ''; }
            (await app.store.write(db)); (await app.store.sql.prepare('INSERT INTO credentials(staff_id,password_hash) VALUES(?,?)').run(user.id, passwordHash));
          }));
        }); } catch (e) { if (e.code?.includes('SQLITE_CONSTRAINT') || e.code === '23505') throw new ApiError(409, 'That workspace ID or owner email is already registered.'); throw e; }
        (await issueSession(app.store.sql, user.id, response, secureCookies));
        let checkout; let checkoutError;
        try { checkout = await locked(workspace.id, () => subscriptions.subscribe(workspace.id)); }
        catch { checkoutError = 'Your account was created, but checkout could not open. Continue to Billing to retry payment.'; }
        return json(response, 201, { user, slug: workspace.slug, checkoutUrl: checkout?.checkoutUrl || null, checkoutError });
      }
      if (path === '/api/webhooks/razorpay' && request.method === 'POST') {
        const raw = await readBody(request, true);
        if (!billing.verify(raw, request.headers['x-razorpay-signature'])) throw new ApiError(401, 'Invalid webhook signature.');
        const event = JSON.parse(raw), eventId = request.headers['x-razorpay-event-id'];
        if (typeof eventId !== 'string' || eventId.length > 200) throw new ApiError(400, 'A webhook event ID is required.');
        if ((await registry.prepare('SELECT 1 FROM webhook_events WHERE id=?').get(eventId))) return json(response, 200, { ok: true });
        const subscriptionId = event.payload?.subscription?.entity?.id;
        const paymentId = event.payload?.refund?.entity?.payment_id || event.payload?.payment?.entity?.id;
        const workspace = (typeof subscriptionId === 'string' && (await registry.prepare('SELECT * FROM workspaces WHERE subscription_id=?').get(subscriptionId)))
          || (typeof paymentId === 'string' && (await registry.prepare('SELECT * FROM workspaces WHERE first_payment_id=?').get(paymentId)));
        if (workspace) await locked(workspace.id, async () => {
          // Fetch current provider state so delayed/out-of-order webhook events
          // cannot reactivate a cancelled or stale subscription.
          await subscriptions.refresh(workspace.id);
        });
        (await registry.prepare('INSERT OR IGNORE INTO webhook_events VALUES(?,?)').run(eventId, Date.now()));
        return json(response, 200, { ok: true });
      }
      const match = path.match(/^\/api\/w\/([a-z0-9][a-z0-9-]{2,39})(\/.*)$/);
      if (match) {
        const workspace = await find(match[1]); if (!workspace) throw new ApiError(404, 'Workspace not found. Check your workspace ID.');
        const app = await tenant(workspace), route = match[2];
        if (route === '/auth/setup') throw new ApiError(403, 'This workspace already has an owner.');
        if (route.startsWith('/billing')) {
          const actor = (await currentUser(app.store.sql, request));
          if (!actor) throw new ApiError(401, 'Please sign in.');
          if (actor.role !== 'Owner / Admin') throw new ApiError(403, 'Only the workspace owner can manage billing.');
          if (route === '/billing' && request.method === 'GET') return json(response, 200, await subscriptions.view(workspace.id));
          if (request.method !== 'POST') throw new ApiError(404, 'Not found.');
          protectWrite(request, origins); const input = await readBody(request); const requestedAt = now();
          return await locked(workspace.id, async () => {
            const actorNow = (await currentUser(app.store.sql, request));
            if (!actorNow || actorNow.role !== 'Owner / Admin') throw new ApiError(403, 'Your access has changed. Sign in again.');
            if (route === '/billing/subscribe') {
              if (input.billingPolicy !== PLAN.policy) throw new ApiError(400, 'Confirm the upfront payment terms before opening checkout.');
              return json(response, 200, await subscriptions.subscribe(workspace.id));
            }
            if (route === '/billing/refresh') return json(response, 200, await subscriptions.refresh(workspace.id));
            if (route === '/billing/cancel') return json(response, 200, await subscriptions.cancel(workspace.id, requestedAt, input.refundExpected === true));
            throw new ApiError(404, 'Not found.');
          });
        }
        request.url = `/api${route}${url.search}`;
        app.server.emit('request', request, response); return;
      }
      if (path.startsWith('/api/')) throw new ApiError(404, 'API route not found.');
      shell.server.emit('request', request, response);
    } catch (error) {
      if (!(error instanceof ApiError)) console.error('Platform request failed:', error.message);
      if (!response.headersSent) json(response, error.status || 500, { error: error.status ? error.message : 'The server could not complete this request. Please try again.' });
    }
  });
  return { server, registry, close: () => new Promise(resolveClose => {
    server.close(async () => { for (const app of apps.values()) await (await app).store.close(); await shell.store.close(); await (backend ? backend.close() : registry.close()); resolveClose(); }); server.closeAllConnections();
  }) };
}
