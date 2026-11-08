import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { seedDatabase } from '../src/data/seed.ts';
import { can } from '../src/domain/types.ts';
import { saveStaff } from '../src/domain/transactions.ts';
import { openDatabase } from './database.mjs';
import { ApiError, clearSession, currentUser, hash, hashPassword, issueSession, protectWrite, sessionToken, verifyPassword } from './security.mjs';
import { commandPermissions, execute, validateCommand, visibleProduct, visibleSale, visibleState } from './commands.mjs';

const json = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
async function body(request) {
  const parts = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 2_000_000) throw new ApiError(413, 'This request is too large (maximum 2 MB).'); parts.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(parts).toString()); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new ApiError(400, 'Send a valid JSON object.'); }
}
export async function createApp({ filename = ':memory:', store: providedStore, allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:3001', 'http://localhost:3001'], secureCookies = false, staticDir, setupKey = '', workspaceInfo, authorizeWrite } = {}) {
  const store = providedStore || await openDatabase(filename), { sql } = store;
  const origins = new Set(allowedOrigins);
  const dummyPassword = await hashPassword('not-a-real-account-password');
  const attempts = new Map();
  const authLimit = request => {
    const key = request.socket.remoteAddress || 'local';
    const now = Date.now();
    for (const [ip, record] of attempts) if (record.until <= now) attempts.delete(ip);
    const record = attempts.get(key) || { count: 0, until: now + 60_000 };
    attempts.set(key, record);
    if (++record.count > 15) throw new ApiError(429, 'Too many sign-in attempts. Wait a minute and try again.');
  };
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: http: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const url = new URL(request.url, 'http://retail.local');
      const path = url.pathname, method = request.method;
      if (path === '/api/health' && method === 'GET') return json(response, 200, { ok: true });
      if (!path.startsWith('/api/')) {
        if (!staticDir || !['GET', 'HEAD'].includes(method)) throw new ApiError(404, 'Not found.');
        const root = resolve(staticDir);
        const target = resolve(root, `.${decodeURIComponent(path)}`);
        if (target !== root && !target.startsWith(root + sep)) throw new ApiError(404, 'Not found.');
        let file = target;
        try { if (!(await stat(file)).isFile()) file = resolve(root, 'index.html'); }
        catch { if (extname(path)) throw new ApiError(404, 'Not found.'); file = resolve(root, 'index.html'); }
        const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
        const data = await readFile(file);
        response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
        return response.end(method === 'HEAD' ? undefined : data);
      }
      if (method !== 'GET') protectWrite(request, origins);
      if (path === '/api/auth/session' && method === 'GET') {
        return json(response, 200, { user: (await currentUser(sql, request)), setupRequired: !(await sql.prepare('SELECT 1 FROM credentials LIMIT 1').get()), setupKeyRequired: Boolean(setupKey) });
      }
      if (path === '/api/auth/setup' && method === 'POST') {
        authLimit(request);
        if ((await sql.prepare('SELECT 1 FROM credentials LIMIT 1').get())) throw new ApiError(409, 'The owner account has already been created. Sign in instead.');
        const input = await body(request);
        if (setupKey && input.setupKey !== setupKey) throw new ApiError(403, 'Enter the setup key configured on the server.');
        if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80 || typeof input.email !== 'string' || input.email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new ApiError(400, 'Enter your name and a valid email address.');
        if (typeof input.sampleData !== 'boolean') throw new ApiError(400, 'Choose whether to include sample data.');
        const passwordHash = await hashPassword(input.password);
        const user = { id: 'owner', name: input.name.trim(), email: input.email.trim().toLowerCase(), role: 'Owner / Admin', active: true };
        (await store.atomic(async () => {
          if ((await sql.prepare('SELECT 1 FROM credentials LIMIT 1').get())) throw new ApiError(409, 'The owner account has already been created.');
          const db = seedDatabase();
          if (!input.sampleData) for (const key of ['products', 'customers', 'suppliers', 'sales', 'purchases', 'expenses', 'movements']) db[key] = [];
          db.staff = [user]; db.settings.profileName = user.name; db.settings.profileEmail = user.email;
          (await store.write(db));
          (await sql.prepare('INSERT INTO credentials(staff_id,password_hash) VALUES(?,?)').run(user.id, passwordHash));
        }));
        (await issueSession(sql, user.id, response, secureCookies));
        return json(response, 201, { user });
      }
      if (path === '/api/auth/login' && method === 'POST') {
        authLimit(request);
        const input = await body(request);
        if (typeof input.email !== 'string' || input.email.length > 200) throw new ApiError(400, 'Enter your email address.');
        const row = (await sql.prepare("SELECT r.data, c.password_hash FROM records r JOIN credentials c ON c.staff_id=r.id WHERE r.kind='staff' AND lower(json_extract(r.data,'$.email'))=?").get(input.email.toLowerCase().trim()));
        const valid = await verifyPassword(input.password, row?.password_hash || dummyPassword);
        // Re-read and issue the session in one transaction: password resets and
        // owner edits must not race an old password into a new valid session.
        const user = await store.atomic(async () => {
        const latest = row && (await sql.prepare("SELECT r.data,c.password_hash FROM records r JOIN credentials c ON c.staff_id=r.id WHERE r.kind='staff' AND r.id=?").get(JSON.parse(row.data).id));
        const user = latest && JSON.parse(latest.data);
        if (!valid || !user?.active || latest.password_hash !== row.password_hash) throw new ApiError(401, 'Email or password is incorrect.');
        (await clearSession(sql, request, response, secureCookies));
        (await issueSession(sql, user.id, response, secureCookies));
        return user;
        });
        return json(response, 200, { user });
      }
      const user = (await currentUser(sql, request));
      if (!user) throw new ApiError(401, 'Please sign in to continue.');
      if (path === '/api/auth/logout' && method === 'POST') { (await clearSession(sql, request, response, secureCookies)); return json(response, 200, { ok: true }); }
      if (path === '/api/auth/password' && method === 'POST') {
        authLimit(request);
        const input = await body(request);
        const oldHash = (await sql.prepare('SELECT password_hash FROM credentials WHERE staff_id=?').get(user.id))?.password_hash;
        if (!oldHash || !(await verifyPassword(input.currentPassword, oldHash))) throw new ApiError(400, 'Your current password is incorrect.');
        const nextHash = await hashPassword(input.password);
        (await store.atomic(async () => {
          if (!(await currentUser(sql, request)) || (await sql.prepare('SELECT password_hash FROM credentials WHERE staff_id=?').get(user.id))?.password_hash !== oldHash) throw new ApiError(401, 'Please sign in again.');
          (await sql.prepare('UPDATE credentials SET password_hash=? WHERE staff_id=?').run(nextHash, user.id));
          (await sql.prepare('DELETE FROM sessions WHERE staff_id=?').run(user.id));
          (await issueSession(sql, user.id, response, secureCookies));
        }));
        return json(response, 200, { ok: true });
      }
      if (path === '/api/state' && method === 'GET') {
        const revision = (await sql.prepare('SELECT revision FROM metadata WHERE id=1').get()).revision;
        if (!workspaceInfo && url.searchParams.get('since') === String(revision)) { response.writeHead(204); return response.end(); }
        return json(response, 200, { data: visibleState((await store.read()), user), user, workspace: (await workspaceInfo?.()) });
      }
      if (path === '/api/products' && method === 'GET') {
        const result = (await store.listProducts(Object.fromEntries(url.searchParams)));
        return json(response, 200, { ...result, items: result.items.map(p => visibleProduct(p, user.role)) });
      }
      if (path === '/api/backup' && method === 'GET') {
        if (!can(user.role, 'settings')) throw new ApiError(403, 'Only an owner can export store data.');
        response.setHeader('Content-Disposition', 'attachment; filename="smart-retail-records.json"');
        return json(response, 200, (await store.read()));
      }
      if (path === '/api/commands' && method === 'POST') {
        const { type, input: raw, expectedRevision } = await body(request);
        const input = validateCommand(type, raw);
        if (!can(user.role, commandPermissions[type])) throw new ApiError(403, 'Your account does not have permission for this action.');
        const key = request.headers['idempotency-key'];
        if (typeof key !== 'string' || !/^[\w-]{16,100}$/.test(key)) throw new ApiError(400, 'A valid idempotency key is required.');
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new ApiError(400, 'A store revision is required. Refresh and try again.');
        const fingerprint = hash(JSON.stringify({ type, input }));
        let passwordHash;
        if (type === 'staff.save' && input.password) passwordHash = await hashPassword(input.password);
        const result = (await store.atomic(async () => {
          const actor = (await currentUser(sql, request));
          if (!actor) throw new ApiError(401, 'Please sign in again.');
          if (!can(actor.role, commandPermissions[type])) throw new ApiError(403, 'Your access has changed. Please refresh.');
          const previous = (await sql.prepare('SELECT * FROM requests WHERE actor=? AND key=?').get(actor.id, key));
          if (previous) { if (previous.fingerprint !== fingerprint) throw new ApiError(409, 'This request key was already used for different data.'); const result = JSON.parse(previous.result); return type === 'sale.create' ? visibleSale(result, actor.role) : result; }
          const db = (await store.read());
          (await authorizeWrite?.());
          if (expectedRevision !== db.revision) throw new ApiError(409, 'Store records changed on another screen. Reopen the form (or reload Settings) to review the latest records before saving. For a bill, close the review and check the updated totals.');
          if (type === 'staff.save') {
            if (!passwordHash && !(await sql.prepare('SELECT 1 FROM credentials WHERE staff_id=?').get(input.id))) throw new ApiError(400, 'Set a password for this staff account (at least 12 characters).');
            // Validate roles/email before writing the credential.
            saveStaff(structuredClone(db), actor.role, input);
          }
          let result;
          try { result = execute(db, actor, type, input); }
          catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, error.message); }
          db.revision++;
          (await store.write(db));
          if (type === 'staff.save') {
            if (passwordHash) (await sql.prepare('INSERT INTO credentials(staff_id,password_hash) VALUES(?,?) ON CONFLICT(staff_id) DO UPDATE SET password_hash=excluded.password_hash').run(input.id, passwordHash));
            if (input.id !== actor.id) (await sql.prepare('DELETE FROM sessions WHERE staff_id=?').run(input.id));
            else if (passwordHash) (await sql.prepare('DELETE FROM sessions WHERE staff_id=? AND token_hash<>?').run(input.id, hash(sessionToken(request))));
          }
          if (type === 'sale.create') result = visibleSale(result, actor.role);
          (await sql.prepare('INSERT INTO requests(actor,key,fingerprint,result) VALUES(?,?,?,?)').run(actor.id, key, fingerprint, JSON.stringify(result)));
          (await sql.prepare('INSERT INTO audit(actor,action,revision,created_at) VALUES(?,?,?,?)').run(actor.id, type, db.revision, new Date().toISOString()));
          return result;
        }));
        const latest = (await currentUser(sql, request));
        if (!latest) throw new ApiError(401, 'Your session has changed. Please sign in again.');
        return json(response, 200, { data: visibleState((await store.read()), latest), user: latest, result, workspace: (await workspaceInfo?.()) });
      }
      throw new ApiError(404, 'API route not found.');
    } catch (error) {
      if (!response.headersSent) {
        if (!(error instanceof ApiError)) console.error('Server request failed:', error.message);
        json(response, error.status || 500, { error: error.status ? error.message : 'The server could not complete this request. Please try again.' });
      } else response.end();
    }
  });
  return { server, store, close: () => new Promise((resolveClose, reject) => { server.close(async error => { await store.close(); error ? reject(error) : resolveClose(); }); server.closeAllConnections(); }) };
}
