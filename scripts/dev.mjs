import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const args = process.argv.slice(2);
const apiPort = Number(process.env.PORT || 3001);
const portFlag = args.find(value => value.startsWith('--port='));
const vitePort = Number(portFlag ? portFlag.slice(7) : args.includes('--port') ? args[args.indexOf('--port') + 1] : 5173);
const apiHost = process.env.HOST || '127.0.0.1';

async function checkPort(port, host, label, setting) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${label} port must be a number from 1 to 65535. Check ${setting}.`);
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', error => reject(new Error(error.code === 'EADDRINUSE'
      ? `${label} port ${port} is already in use. An ERP instance may still be running. Stop it with Ctrl+C in its terminal before restarting, or choose a different ${setting}.`
      : `Cannot open ${label.toLowerCase()} port ${port}: ${error.message}`)));
    probe.listen(port, host, () => probe.close(resolve));
  });
}

try {
  if (apiPort === vitePort) throw new Error('The backend and frontend need different ports. Change PORT in .env or the Vite --port option.');
  // Check both ports before starting either child, so a duplicate invocation
  // cannot leave half of the development stack running.
  await checkPort(apiPort, apiHost, 'Backend', 'PORT in .env');
  await checkPort(vitePort, '127.0.0.1', 'Frontend', 'Vite --port option');
} catch (error) {
  console.error(`Cannot start Smart Retail: ${error.message}`);
  process.exitCode = 1;
}

if (!process.exitCode) {
process.env.API_TARGET ||= `http://127.0.0.1:${apiPort}`;
const children = [
  spawn(process.execPath, ['--env-file-if-exists=.env', '--import', './scripts/register-ts.mjs', 'server/index.mjs'], { stdio: 'inherit', windowsHide: true }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--configLoader', 'native', '--host', '127.0.0.1', '--strictPort', ...args], { stdio: 'inherit', windowsHide: true }),
];
let stopped = false;
function stop(code = 0) { if (stopped) return; stopped = true; for (const child of children) child.kill(); process.exitCode = code; }
for (const child of children) { child.on('error', error => { console.error(error.message); stop(1); }); child.on('exit', code => stop(code || 0)); }
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
}
