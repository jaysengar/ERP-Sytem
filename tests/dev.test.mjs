import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectFile = path => fileURLToPath(new URL(`../${path}`, import.meta.url));
async function occupiedPort(t) {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server.address().port;
}
async function run(t, entry, env, args = []) {
  const cwd = await mkdtemp(join(tmpdir(), 'retail-startup-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const child = spawn(process.execPath, ['--import', new URL('../scripts/register-ts.mjs', import.meta.url).href, projectFile(entry), ...args], {
    cwd, windowsHide: true, env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', DATA_DIR: cwd, DATABASE_DRIVER: 'sqlite', DATABASE_URL: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const timer = setTimeout(() => child.kill(), 10000);
  try {
    const result = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal })); });
    assert.equal(result.signal, null, output || 'Startup did not exit in time.');
    return { code: result.code, output };
  } finally { clearTimeout(timer); }
}

test('dev rejects an occupied backend port before starting either child', async t => {
  const port = await occupiedPort(t);
  const result = await run(t, 'scripts/dev.mjs', { PORT: String(port) });
  assert.equal(result.code, 1);
  assert.match(result.output, new RegExp(`Backend port ${port} is already in use`));
  assert.doesNotMatch(result.output, /Unhandled|MODULE_NOT_FOUND|VITE v/);
});

test('dev rejects an occupied custom frontend port before starting the backend', async t => {
  const port = await occupiedPort(t);
  const temporary = createServer();
  await new Promise(resolve => temporary.listen(0, '127.0.0.1', resolve));
  const backendPort = temporary.address().port;
  await new Promise(resolve => temporary.close(resolve));
  const result = await run(t, 'scripts/dev.mjs', { PORT: String(backendPort) }, [`--port=${port}`]);
  assert.equal(result.code, 1);
  assert.match(result.output, new RegExp(`Frontend port ${port} is already in use`));
  assert.doesNotMatch(result.output, /Smart Retail SaaS:|MODULE_NOT_FOUND/);
  // The failed invocation must leave its proposed backend port free.
  await new Promise((resolve, reject) => { temporary.once('error', reject); temporary.listen(backendPort, '127.0.0.1', resolve); });
  await new Promise(resolve => temporary.close(resolve));
});

test('direct backend startup handles EADDRINUSE without an unhandled exception', async t => {
  const port = await occupiedPort(t);
  const result = await run(t, 'server/index.mjs', { PORT: String(port) });
  assert.equal(result.code, 1);
  assert.match(result.output, new RegExp(`backend port ${port} is already in use`));
  assert.doesNotMatch(result.output, /Unhandled|throw er;|node:events/);
});

test('selecting PostgreSQL without credentials fails clearly instead of falling back to SQLite', async t => {
  const result = await run(t, 'server/index.mjs', { DATABASE_DRIVER: 'postgres' });
  assert.equal(result.code, 1); assert.match(result.output, /Set DATABASE_URL/);
  assert.doesNotMatch(result.output, /Smart Retail SaaS:/);
});
