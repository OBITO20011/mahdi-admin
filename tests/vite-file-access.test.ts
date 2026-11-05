import {sourceBeforeStorefrontSpeed} from '../scripts/audit/source-before-storefront-speed.mjs';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createServer, normalizePath, type ViteDevServer} from 'vite';
import {developmentFileAccess} from '../scripts/environments/development-file-access.mjs';
import {developmentFsPins, sourceBeforeDevelopmentFs} from '../scripts/audit/source-before-development-fs.mjs';
import {sourceBeforePrivateMaps} from '../scripts/audit/source-before-private-maps.mjs';

test('both actual Vite configs reject direct/raw/inline secrets and outside files without blocking application modules', async () => {
 const scratch = await mkdtemp(path.join(os.tmpdir(), 'nawasrah-vite-fs-'));
 const marker = 'SYNTHETIC_CANARY_NOT_A_CREDENTIAL';
 const outside = path.join(scratch, 'outside.txt');
 await writeFile(outside, marker);
 const previous = new Map(['VITE_BROWSER_QA_ISOLATED', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].map(key => [key, process.env[key]]));
 Object.assign(process.env, {VITE_BROWSER_QA_ISOLATED: 'true', VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'isolated-fs-canary-key'});
 try {
  for (const [index, relative] of ['', 'customer-web'].entries()) {
   const root = path.resolve(relative);
   const suffix = randomUUID();
   const files = [path.join(root, '.env.canary-' + suffix), path.join(root, 'src', suffix + '.pem'), path.join(root, suffix + '.nwb')];
   for (const file of files) await writeFile(file, marker, {flag: 'wx'});
   let server: ViteDevServer | undefined;
   try {
    server = await createServer({root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'silent', cacheDir: path.join(scratch, 'cache-' + index),
     optimizeDeps: {noDiscovery: true, include: []}, server: {host: '127.0.0.1', port: 42763 + index, strictPort: true, hmr: false, watch: null, preTransformRequests: false}});
    assert.equal(server.config.server.fs.strict, true);
    assert.ok(!server.config.server.fs.allow.includes(normalizePath(root)), 'Never allow the entire checkout');
    await server.listen();
    const address = server.httpServer!.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const request = async (url: string) => {
     const response = await fetch(origin + url, {headers: {connection: 'close'}});
     return {status: response.status, text: await response.text()};
    };
    for (const file of [...files, outside]) for (const query of ['', '?import&raw', '?raw', '?inline', '?import&raw&v=canary']) {
     const response = await request('/@fs/' + normalizePath(file) + query);
     assert.equal(response.status, 403, `${relative}: ${path.basename(file)}${query}`);
     assert.ok(!response.text.includes(marker));
    }
    assert.equal((await request('/')).status, 200);
    assert.equal((await request('/src/main.tsx')).status, 200);
    if (!relative) assert.equal((await request('/customer-web/src/receipts/exactMoney.ts')).status, 200, 'Existing shared receipt import stays available');
   } finally {
    await server?.close();
    for (const file of files) await rm(file);
   }
  }
 } finally {
  for (const [key, value] of previous) {if (value === undefined) delete process.env[key]; else process.env[key] = value;}
  await rm(scratch, {recursive: true, force: true});
 }
});

test('fs projection preserves every historical proof and only restores the two exact reviewed configs', async () => {
 const baseline = '376293af705837201e4c94b66967337baf524af6';
 for (const [file, pin] of Object.entries(developmentFsPins) as [string, {before:string;after:string;beforeText:string}][]) {
  const current = sourceBeforePrivateMaps(file, sourceBeforeStorefrontSpeed(file, (await readFile(file, 'utf8')).replaceAll('\r\n', '\n'))!)!;
  const previous = execFileSync('git', ['show', baseline + ':' + file], {encoding:'utf8', windowsHide:true}).replaceAll('\r\n','\n');
  assert.equal(pin.beforeText, previous);
  assert.equal(createHash('sha256').update(current).digest('hex'), pin.after);
  assert.equal(sourceBeforeDevelopmentFs(file, current), previous);
  const unknown = current + '\n// unreviewed change\n';
  assert.equal(sourceBeforeDevelopmentFs(file, unknown), unknown, 'Unknown bytes reach the existing strict guards');
 }
 const historical = execFileSync('git', ['diff', '--name-only', baseline, '--', 'supabase', 'scripts/audit/*-inverse.json', 'scripts/audit/*-hunks.json'], {encoding:'utf8',windowsHide:true});
 assert.equal(historical.trim(), '');
});

test('negative control reproduces the original query bypass with Vite6.4.4 defaults', async () => {
 const root = await mkdtemp(path.join(os.tmpdir(), 'nawasrah-vite-old-control-'));
 await writeFile(path.join(root, 'private.pem'), 'SYNTHETIC_NEGATIVE_CONTROL');
 const server = await createServer({configFile: false, root, logLevel: 'silent', optimizeDeps: {noDiscovery: true, include: []},
  server: {host: '127.0.0.1', port: 42765, strictPort: true, watch: null}});
 try {
  await server.listen();
  const direct = await fetch('http://127.0.0.1:42765/private.pem', {headers: {connection: 'close'}});
  assert.equal(direct.status, 403);
  const bypass = await fetch('http://127.0.0.1:42765/private.pem?import&raw', {headers: {connection: 'close'}});
  assert.equal(bypass.status, 200);
  assert.match(await bypass.text(), /SYNTHETIC_NEGATIVE_CONTROL/);
 } finally {await server.close(); await rm(root, {recursive: true, force: true});}
});

test('Vite fs allowlist resolves only the dependency junction, retains query-aware deny and both pinned Vite versions', async () => {
 for (const relative of ['', 'customer-web']) {
  const root = path.resolve(relative), fs = developmentFileAccess(root, !relative);
  assert.equal(fs.strict, true);
  assert.ok(fs.allow.includes(path.join(root, 'src')));
  assert.ok(!fs.allow.includes(root));
  assert.ok(fs.deny.includes('**/.env*'));
  assert.ok(fs.deny.includes('**/*.{crt,pem,key,p12,pfx,nwb}*'));
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages['node_modules/vite'].version, '6.4.4');
 }
});
