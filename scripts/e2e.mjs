import { spawn } from 'node:child_process';
import { startTestServer } from '../tests/support/server.mjs';
const close = await startTestServer();
try {
  const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
  process.exitCode = await new Promise((resolve, reject) => { child.on('exit', code => resolve(code ?? 1)); child.on('error', reject); });
} finally { await close(); }
