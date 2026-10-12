import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {watch} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, utimes, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import tailwindcss from '@tailwindcss/vite';
import {chromium} from '@playwright/test';
import {createServer, normalizePath} from 'vite';
import {startIsolatedVite} from '../scripts/testing/isolated-vite-server.mjs';

test('QA ignores task-document touches while a real page stays open; live Tailwind control reloads', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nawasrah-watch-regression-'));
  const taskDocument = path.join(root, 'docs/agent/ACTIVE_TASK.json');
  const css = normalizePath(path.resolve('node_modules/tailwindcss/index.css'));
  await mkdir(path.dirname(taskDocument), {recursive: true});
  await writeFile(taskDocument, '{"fixture":"bg-red-500"}');
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(root, 'style.css'), `@import "${css}";`);
  await writeFile(path.join(root, 'index.html'), '<html><head><link rel="stylesheet" href="/style.css"></head><body><div class="bg-red-500" role="dialog"><input aria-label="name" value=""></div></body></html>');
  const hash = async () => createHash('sha256').update(await readFile(taskDocument)).digest('hex');
  const originalHash = await hash();
  const config = {configFile: false as const, plugins: [tailwindcss()], optimizeDeps: {entries: []},
    resolve: {alias: {react: path.resolve('node_modules/react'), 'react-dom': path.resolve('node_modules/react-dom'), 'lucide-react': path.resolve('node_modules/lucide-react')}},
    // Distinct low QA-only ports; Vite treats port0 as its dev default5173.
    server: {host: '127.0.0.1', port: 4197, strictPort: true, fs: {allow: [root, path.resolve('node_modules')]}}};
  const live = await createServer({...config, root});
  let qa: Awaited<ReturnType<typeof startIsolatedVite>> | undefined;
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'No external fixture request');
    return route.continue();
  });
  const url = (server: typeof live) => {
    const address = server.httpServer?.address();
    assert.ok(address && typeof address !== 'string');
    return `http://127.0.0.1:${address.port}`;
  };
  const touch = async () => {
    const notification = new Promise<void>(resolve => {
      const observer = watch(taskDocument, () => {observer.close(); resolve();});
    });
    const now = new Date();
    await utimes(taskDocument, now, now);
    await notification;
    assert.equal(await hash(), originalHash, 'Touch does not modify document content');
  };
  try {
    await live.listen();
    const before = await context.newPage();
    await before.goto(url(live));
    await before.getByLabel('name').fill('retained input');
    const reload = before.waitForEvent('framenavigated', {predicate: frame => frame === before.mainFrame()});
    await touch(); await reload;
    assert.equal(await before.getByLabel('name').inputValue(), '', 'Negative control proves real reload destroys input');
    await before.close(); await live.close();

    qa = await startIsolatedVite({root, port: 4198, config});
    assert.equal(qa.server.config.server.hmr, false);
    assert.equal(qa.server.config.server.watch, null);
    assert.deepEqual(qa.server.watcher.getWatched(), {}, 'No watched source, docs or agent log');
    const after = await context.newPage();
    await after.goto(url(qa.server));
    await after.getByLabel('name').fill('retained input');
    const timeOrigin = await after.evaluate(() => performance.timeOrigin);
    let navigations = 0;after.on('framenavigated', frame => {if (frame === after.mainFrame()) navigations++;});
    await touch(); await qa.server.waitForRequestsIdle();
    await after.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(await after.evaluate(() => performance.timeOrigin), timeOrigin);
    assert.equal(await after.getByLabel('name').inputValue(), 'retained input');
    assert.equal(await after.getByLabel('name').evaluate(element => element === document.activeElement), true);
    assert.equal(navigations, 0);
  } finally {
    await browser.close(); await live.close(); await qa?.close();
    await rm(root, {recursive: true, force: true});
  }
});
