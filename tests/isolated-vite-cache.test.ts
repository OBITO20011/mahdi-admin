import assert from 'node:assert/strict';
import {access, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as poll} from 'node:timers/promises';
import test from 'node:test';
import {createLogger, createServer, normalizePath, type ViteDevServer} from 'vite';
import {startIsolatedVite} from '../scripts/testing/isolated-vite-server.mjs';
import {stopIsolatedVite} from '../scripts/testing/stop-isolated-vite.mjs';

const root = path.resolve('.');
const until = async (condition: () => boolean) => {
  const deadline = Date.now() + 15000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'Real optimizer state must become ready');
    await poll(10);
  }
};
const fixture = {
  name: 'cache-test-entry',
  resolveId(id: string) {if (id.startsWith('/cache-test-')) return id;},
  load(id: string) {
    if (id === '/cache-test-a.js') return 'import React from "react"; export default React';
    if (id === '/cache-test-b.js') return 'import {Plus} from "lucide-react"; export default Plus';
  },
};
const origin = (server: ViteDevServer) => {
  const address = server.httpServer?.address(); assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
};

test('two real shared-cache servers reproduce HTTP504 Outdated Optimize Dep before isolation', async context => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'nawasrah-vite-shared-proof-'));
  const logger = createLogger('silent');
  const logs: string[] = [];
  logger.info = message => {logs.push(message);};
  const common = {root, cacheDir, configFile: false as const, customLogger: logger,
    plugins: [fixture], server: {host: '127.0.0.1', port: 0, fs: {allow: [root, cacheDir]}}};
  const a = await createServer({...common, optimizeDeps: {entries: [], include: ['react', 'react-dom/client']}});
  let b: ViteDevServer | undefined;
  try {
    await a.listen(); await fetch(`${origin(a)}/cache-test-a.js`); await a.waitForRequestsIdle();
    const optimizer = a.environments.client.depsOptimizer!;
    await until(() => Boolean(optimizer.metadata.optimized['react-dom/client']));
    const old = optimizer.metadata.optimized['react-dom/client'];
    b = await createServer({...common, optimizeDeps: {entries: [], include: ['lucide-react'], force: true}});
    await b.listen(); await fetch(`${origin(b)}/cache-test-b.js`); await b.waitForRequestsIdle();
    await until(() => Boolean(b!.environments.client.depsOptimizer!.metadata.optimized['lucide-react']));
    const response = await fetch(`${origin(a)}/@fs/${normalizePath(old.file)}?v=${old.browserHash}`);
    assert.equal(response.status, 504); assert.equal(response.statusText, 'Outdated Optimize Dep');
    assert.ok(logs.some(message => message.includes('Forced re-optimization')));
    context.diagnostic(`Vite: Forced re-optimization of dependencies; HTTP ${response.status} ${response.statusText}`);
  } finally {await b?.close(); await a.close(); await rm(cacheDir, {recursive: true, force: true});}
});

test('unique temporary caches preserve existing harness imports across two live servers and clean on stop', async () => {
  const original = process.env.VITE_SUPABASE_URL;
  const a = await startIsolatedVite({root, port: 4191, env: {VITE_SUPABASE_URL: 'http://127.0.0.1:4176'},
    config: {configFile: false, plugins: [fixture], optimizeDeps: {entries: []}}});
  let b;
  try {
    b = await startIsolatedVite({root, port: 4192,
      config: {configFile: false, plugins: [fixture], optimizeDeps: {entries: [], include: ['recharts']}}});
    assert.notEqual(a.cacheDir, b.cacheDir);
    assert.ok(a.cacheDir.startsWith(tmpdir())); assert.ok(!a.cacheDir.startsWith(root + path.sep));
    assert.equal(process.env.VITE_SUPABASE_URL, original, 'Temporary server env cannot leak to another server');
    await Promise.all([fetch(`${origin(a.server)}/cache-test-a.js`), fetch(`${origin(b.server)}/cache-test-b.js`)]);
    await Promise.all([a.server.waitForRequestsIdle(), b.server.waitForRequestsIdle()]);
    await until(() => Boolean(a.server.environments.client.depsOptimizer.metadata.optimized['react-dom/client'])
      && Boolean(b.server.environments.client.depsOptimizer.metadata.optimized.recharts));
    for (let request = 0; request < 10; request++) {
      const responses = await Promise.all([a, b].map(instance =>
        fetch(`${origin(instance.server)}/node_modules/.vite/deps/react-dom_client.js`)));
      for (const response of responses) {
        assert.equal(response.status, 200); assert.match(response.headers.get('content-type') ?? '', /javascript/u);
      }
    }
  } finally {await Promise.all([a.close(), b?.close()]);}
  await assert.rejects(access(a.cacheDir)); await assert.rejects(access(b.cacheDir));
  await a.close(); // Stop must be idempotent.
});

test('QA shutdown proves cache deletion before forced Windows process teardown', async () => {
  const instance = await startIsolatedVite({root, port: 4193, controlledStop: true,
    config: {configFile: false, optimizeDeps: {entries: []}}});
  try {await stopIsolatedVite(4193); await assert.rejects(access(instance.cacheDir));}
  finally {await instance.close();}
});
