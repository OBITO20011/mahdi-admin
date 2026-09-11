import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {chromium, webkit} from '@playwright/test';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const viteCli = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const releaseA = '1111111111111111111111111111111111111111';
const releaseB = '2222222222222222222222222222222222222222';
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'nawasrah-pwa-release-'));
const releaseRoots = {
  [releaseA]: path.join(temporaryRoot, 'release-a'),
  [releaseB]: path.join(temporaryRoot, 'release-b'),
};
let activeRoot = releaseRoots[releaseA];

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
]);

const buildRelease = async (releaseId) => {
  await execFileAsync(
    process.execPath,
    [viteCli, 'build', '--outDir', releaseRoots[releaseId], '--emptyOutDir'],
    {
      cwd: projectRoot,
      env: {...process.env, NAWASRAH_ADMIN_RELEASE_ID: releaseId},
      maxBuffer: 4 * 1024 * 1024,
      timeout: 180_000,
      windowsHide: true,
    },
  );
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const requestedPath = path.resolve(activeRoot, relativePath);
    const activePrefix = `${path.resolve(activeRoot)}${path.sep}`;

    if (!requestedPath.startsWith(activePrefix)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    let filePath = requestedPath;
    try {
      if (!(await stat(filePath)).isFile()) throw new Error('Not a file');
    } catch {
      if (!relativePath.startsWith('assets/')) {
        filePath = path.join(activeRoot, 'index.html');
      } else {
        response.writeHead(404).end('Not found');
        return;
      }
    }

    const extension = path.extname(filePath);
    const cacheControl = relativePath === 'sw.js' || filePath.endsWith('index.html')
      ? 'no-store'
      : 'public, max-age=31536000, immutable';
    response.writeHead(200, {
      'Cache-Control': cacheControl,
      'Content-Type': contentTypes.get(extension) || 'application/octet-stream',
      'Service-Worker-Allowed': '/',
    });
    response.end(await readFile(filePath));
  } catch (error) {
    response.writeHead(500).end(error instanceof Error ? error.message : 'Server error');
  }
});

const listen = () => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address()));
});

const waitForRelease = async (page, releaseId) => {
  await page.waitForFunction(
    async (expectedRelease) => {
      const registration = await navigator.serviceWorker.getRegistration('/');
      return registration?.active?.scriptURL.includes(`build=${expectedRelease}`) === true;
    },
    releaseId,
    {timeout: 30_000},
  );
};

const waitForReleaseCache = async (page, releaseId) => {
  await page.waitForFunction(
    async (expectedCache) => {
      const keys = await caches.keys();
      return keys.length === 1 && keys[0] === expectedCache;
    },
    `nawasrah-admin-shell-${releaseId}`,
    {timeout: 30_000},
  );
};

const inspectPage = async (page) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration('/');
        return {
          bodyTextLength: document.body.innerText.trim().length,
          cacheKeys: await caches.keys(),
          controllerUrl: navigator.serviceWorker.controller?.scriptURL || null,
          rootCached: Boolean(await caches.match('/')),
          scriptUrls: [...document.querySelectorAll('script[src]')]
            .map((script) => new URL(script.src).pathname),
          workerUrl: registration?.active?.scriptURL || null,
        };
      });
    } catch (error) {
      if (!String(error).includes('Execution context was destroyed')) throw error;
      await page.waitForLoadState('domcontentloaded');
    }
  }

  throw new Error('Page did not stabilize after the service worker update reload.');
};

const runBrowserScenario = async (name, browserType, origin) => {
  activeRoot = releaseRoots[releaseA];
  const browser = await browserType.launch({headless: true});
  const context = await browser.newContext({serviceWorkers: 'allow'});
  const page = await context.newPage();
  const pageErrors = [];
  const failedLocalRequests = [];

  page.on('pageerror', (error) => {
    const isLocalTurnstileProtocolNoise =
      error.message.includes('challenges.cloudflare.com') &&
      error.message.includes('Protocols must match');
    if (!isLocalTurnstileProtocolNoise) pageErrors.push(error.message);
  });
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(origin)) failedLocalRequests.push(request.url());
  });
  page.on('response', (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) {
      failedLocalRequests.push(`${response.status()} ${response.url()}`);
    }
  });

  try {
    await page.goto(origin, {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => document.body.innerText.trim().length > 0);
    await waitForRelease(page, releaseA);
    await waitForReleaseCache(page, releaseA);
    const stateA = await inspectPage(page);
    assert.ok(stateA.bodyTextLength > 0, `${name}: release A rendered a blank page`);
    assert.match(stateA.workerUrl || '', new RegExp(`build=${releaseA}$`));
    assert.deepEqual(stateA.cacheKeys, [`nawasrah-admin-shell-${releaseA}`]);
    assert.equal(stateA.rootCached, false);

    activeRoot = releaseRoots[releaseB];
    await page.reload({waitUntil: 'domcontentloaded'});
    await waitForRelease(page, releaseB);
    await waitForReleaseCache(page, releaseB);
    await page.waitForFunction(
      (expectedRelease) => navigator.serviceWorker.controller?.scriptURL.includes(`build=${expectedRelease}`),
      releaseB,
      {timeout: 30_000},
    );
    await page.waitForFunction(() => document.body.innerText.trim().length > 0);
    await page.waitForTimeout(500);

    const stateB = await inspectPage(page);
    assert.ok(stateB.bodyTextLength > 0, `${name}: release B rendered a blank page`);
    assert.match(stateB.workerUrl || '', new RegExp(`build=${releaseB}$`));
    assert.match(stateB.controllerUrl || '', new RegExp(`build=${releaseB}$`));
    assert.deepEqual(stateB.cacheKeys, [`nawasrah-admin-shell-${releaseB}`]);
    assert.equal(stateB.rootCached, false);
    assert.notDeepEqual(stateB.scriptUrls, stateA.scriptUrls);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(failedLocalRequests, []);

    return {
      releaseAWorker: stateA.workerUrl,
      releaseBWorker: stateB.workerUrl,
      cacheCleanup: stateB.cacheKeys.length === 1,
      rendered: true,
    };
  } finally {
    await context.close();
    await browser.close();
  }
};

let serverAddress;
try {
  await Promise.all([buildRelease(releaseA), buildRelease(releaseB)]);
  serverAddress = await listen();
  assert.ok(serverAddress && typeof serverAddress === 'object');
  const origin = `http://127.0.0.1:${serverAddress.port}`;
  const chromiumResult = await runBrowserScenario('Chromium', chromium, origin);
  const webkitResult = await runBrowserScenario('WebKit', webkit, origin);

  console.log(JSON.stringify({
    ok: true,
    releaseA,
    releaseB,
    chromium: chromiumResult,
    webkit: webkitResult,
  }));
} finally {
  await new Promise((resolve) => server.close(() => resolve()));
  const resolvedTemporaryRoot = path.resolve(temporaryRoot);
  const resolvedSystemTemp = `${path.resolve(tmpdir())}${path.sep}`;
  if (
    resolvedTemporaryRoot.startsWith(resolvedSystemTemp) &&
    path.basename(resolvedTemporaryRoot).startsWith('nawasrah-pwa-release-')
  ) {
    await rm(resolvedTemporaryRoot, {recursive: true, force: true});
  }
}
