import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = process.argv[2];
const port = process.argv[3];

if (!['admin', 'customer'].includes(target) || !/^\d+$/u.test(port ?? '')) {
  throw new Error('Usage: node run-isolated-vite.mjs <admin|customer> <port>');
}

const env = {
  ...process.env,
  VITE_SUPABASE_URL: 'http://127.0.0.1:4176',
  VITE_BROWSER_QA_ISOLATED: 'true',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'isolated-browser-publishable-key',
  VITE_SUPABASE_ANON_KEY: 'isolated-browser-publishable-key',
  VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
};
const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', target === 'customer'
    ? `npm.cmd --prefix customer-web run dev -- --host 127.0.0.1 --port ${port}`
    : `npm.cmd run dev -- --host 127.0.0.1 --port ${port}`]
  : target === 'customer'
    ? ['--prefix', 'customer-web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', port]
    : ['run', 'dev', '--', '--host', '127.0.0.1', '--port', port];

const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
const stop = () => child.kill('SIGTERM');
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
child.once('error', (error) => {
  throw error;
});
child.once('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
