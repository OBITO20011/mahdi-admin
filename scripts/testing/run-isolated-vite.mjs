import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {startIsolatedVite} from './isolated-vite-server.mjs';

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
const instance = await startIsolatedVite({
  root: target === 'customer' ? path.join(root, 'customer-web') : root,
  port: Number(port), env, controlledStop: true,
});
const stop = async () => {await instance.close();};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
process.once('message', message => {if (message === 'stop') void stop();});
