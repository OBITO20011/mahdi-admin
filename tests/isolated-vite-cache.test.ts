import assert from 'node:assert/strict';
import {access, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {freemem, tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as poll} from 'node:timers/promises';
import test from 'node:test';
import {createLogger, createServer, normalizePath, type ViteDevServer} from 'vite';
import {startIsolatedVite} from '../scripts/testing/isolated-vite-server.mjs';
import {stopIsolatedVite} from '../scripts/testing/stop-isolated-vite.mjs';

const root = path.resolve('.');
const until = async (condition: () => boolean, onFailure?: () => void) => {
  const deadline = Date.now() + 15000;
  while (!condition()) {
    try {
      assert.ok(Date.now() < deadline, 'Real optimizer state must become ready');
    } catch (error) {
      onFailure?.();
      throw error;
    }
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
  const proofRoot = await mkdtemp(path.join(tmpdir(), 'nawasrah-vite-shared-proof-'));
  const cacheDir = path.join(proofRoot, 'node_modules', '.vite');
  // Real, tiny CommonJS packages: the regression is cache invalidation, not
  // cold compilation of thousands of icon modules. No optimizer is mocked.
  for (const name of ['cache-proof-a', 'cache-proof-b']) {
    const directory = path.join(proofRoot, 'node_modules', name);
    await mkdir(directory, {recursive: true});
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({name, version: '1.0.0', main: 'index.cjs'}));
    await writeFile(path.join(directory, 'index.cjs'), `module.exports = ${JSON.stringify(name)};`);
    await writeFile(path.join(proofRoot, `${name}.js`), `import value from '${name}'; export default value;`);
    await writeFile(path.join(proofRoot, `${name}.html`), `<script type="module" src="/${name}.js"></script>`);
  }
  const logger = createLogger('silent');
  const logs: string[] = [];
  logger.info = message => {logs.push(message);};
  const optimizerMessages: {level: 'warn' | 'error'; message: string}[] = [];
  const originalWarn = logger.warn.bind(logger), originalError = logger.error.bind(logger);
  logger.warn = (message, options) => {
    optimizerMessages.push({level: 'warn', message: message.slice(0, 8000)});
    originalWarn(message, options);
  };
  logger.error = (message, options) => {
    optimizerMessages.push({level: 'error', message: message.slice(0, 8000)});
    originalError(message, options);
  };
  const common = {root: proofRoot, cacheDir, configFile: false as const, customLogger: logger,
    // Request the old bundle only after B invalidates the disk cache; otherwise
    // background pre-transform can serve A's in-memory response instead.
    server: {host: '127.0.0.1', port: 0, preTransformRequests: false, fs: {allow: [proofRoot, cacheDir]}}};
  const a = await createServer({...common, optimizeDeps: {entries: ['cache-proof-a.html'], include: ['cache-proof-a']}});
  let b: ViteDevServer | undefined;
  const snapshot = (server: ViteDevServer | undefined) => {
    const optimizer = server?.environments.client.depsOptimizer;
    const address = server?.httpServer?.address();
    return {
      configuredPort: server?.config.server.port,
      actualPort: address && typeof address !== 'string' ? address.port : null,
      optimized: Object.keys(optimizer?.metadata.optimized ?? {}),
      discovered: Object.keys(optimizer?.metadata.discovered ?? {}),
      scanPending: Boolean(optimizer?.scanProcessing),
      holdUntilCrawlEnd: server?.environments.client.config.optimizeDeps.holdUntilCrawlEnd,
    };
  };
  const readinessFailure = (phase: string) => context.diagnostic(JSON.stringify({
    kind: 'VITE_OPTIMIZER_READINESS_FAILURE', phase, node: process.version,
    freeMemoryMB: Math.round(freemem() / 1024 / 1024),
    a: snapshot(a), b: snapshot(b), info: logs.slice(-20),
    optimizerMessages: optimizerMessages.slice(-20),
  }));
  try {
    await a.listen(); await fetch(`${origin(a)}/cache-proof-a.js`); await a.waitForRequestsIdle();
    const optimizer = a.environments.client.depsOptimizer!;
    await until(() => Boolean(optimizer.metadata.optimized['cache-proof-a']), () => readinessFailure('A-cache-proof-a'));
    const old = optimizer.metadata.optimized['cache-proof-a'];
    b = await createServer({...common, optimizeDeps: {entries: ['cache-proof-b.html'], include: ['cache-proof-b'], force: true}});
    await b.listen(); await fetch(`${origin(b)}/cache-proof-b.js`); await b.waitForRequestsIdle();
    await until(() => Boolean(b!.environments.client.depsOptimizer!.metadata.optimized['cache-proof-b']), () => readinessFailure('B-cache-proof-b'));
    const response = await fetch(`${origin(a)}/@fs/${normalizePath(old.file)}?v=${old.browserHash}`);
    assert.equal(response.status, 504); assert.equal(response.statusText, 'Outdated Optimize Dep');
    assert.ok(logs.some(message => message.includes('Forced re-optimization')));
    context.diagnostic(`Vite: Forced re-optimization of dependencies; HTTP ${response.status} ${response.statusText}`);
  } finally {await b?.close(); await a.close(); await rm(proofRoot, {recursive: true, force: true});}
});

test('unique temporary caches preserve existing harness imports across two live servers and clean on stop', async () => {
  const original = process.env.VITE_SUPABASE_URL;
  const a = await startIsolatedVite({root, port: 4191, env: {VITE_SUPABASE_URL: 'http://127.0.0.1:4176'},
    config: {configFile: false, plugins: [fixture], optimizeDeps: {entries: []}}});
  let b: Awaited<ReturnType<typeof startIsolatedVite>> | undefined;
  try {
    b = await startIsolatedVite({root, port: 4192,
      config: {configFile: false, plugins: [fixture], optimizeDeps: {entries: [], include: ['recharts']}}});
    assert.notEqual(a.cacheDir, b.cacheDir);
    assert.ok(a.cacheDir.startsWith(tmpdir())); assert.ok(!a.cacheDir.startsWith(root + path.sep));
    assert.equal(process.env.VITE_SUPABASE_URL, original, 'Temporary server env cannot leak to another server');
    await Promise.all([fetch(`${origin(a.server)}/cache-test-a.js`), fetch(`${origin(b.server)}/cache-test-b.js`)]);
    await Promise.all([a.server.waitForRequestsIdle(), b.server.waitForRequestsIdle()]);
    const activeB=b;
    await until(() => {
      const aOptimizer=a.server.environments.client.depsOptimizer;
      const bOptimizer=activeB.server.environments.client.depsOptimizer;
      assert.ok(aOptimizer);assert.ok(bOptimizer);
      return Boolean(aOptimizer.metadata.optimized['react-dom/client'])
        && Boolean(bOptimizer.metadata.optimized.recharts);
    });
    for (let request = 0; request < 10; request++) {
      const responses: Response[] = await Promise.all([a, b].map(instance =>
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
