import '../scripts/register-ts.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSaas } from './saas.mjs';
import { razorpayClient } from './billing.mjs';
import { openPostgres } from './postgres.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 3001);
const production = process.env.NODE_ENV === 'production';
if (production && !process.env.APP_ORIGIN?.startsWith('https://')) throw new Error('Production requires APP_ORIGIN=https://your-domain in .env.');
const billing = razorpayClient({ keyId: process.env.RAZORPAY_KEY_ID, keySecret: process.env.RAZORPAY_KEY_SECRET, planId: process.env.RAZORPAY_PLAN_ID, webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET });
const databaseDriver = process.env.DATABASE_DRIVER || (process.env.DATABASE_URL ? 'postgres' : 'sqlite');
if (!['postgres', 'sqlite'].includes(databaseDriver)) throw new Error('DATABASE_DRIVER must be postgres or sqlite.');
if (production && databaseDriver !== 'postgres') throw new Error('Production SaaS requires DATABASE_DRIVER=postgres and a private DATABASE_URL.');
let backend;
try { if (databaseDriver === 'postgres') backend = await openPostgres(); }
catch (error) { console.error(`Cannot start Smart Retail: ${error.message}`); process.exitCode = 1; }
if (!process.exitCode) {
const app = await createSaas({
  backend,
  dataDir: resolve(root, process.env.DATA_DIR || 'server/data'),
  allowedOrigins: (process.env.APP_ORIGIN || `http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:${port},http://localhost:${port}`).split(',').map(s => s.trim()),
  secureCookies: production, staticDir: resolve(root, 'dist'), billing,
  registrationEnabled: process.env.REGISTRATION_ENABLED !== 'false',
});
app.server.once('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `Cannot start Smart Retail: backend port ${port} is already in use. Stop the other ERP server with Ctrl+C in its terminal, or change PORT in .env.`
    : `Cannot start Smart Retail: ${error.message}`);
  // Also cover a port claimed after the dev launcher's preflight check.
  void app.close().then(() => { process.exitCode = 1; });
});
app.server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Smart Retail SaaS: http://${process.env.HOST || '127.0.0.1'}:${port} (database: ${databaseDriver}; Razorpay ${billing.configured ? 'configured' : 'not configured'})`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
