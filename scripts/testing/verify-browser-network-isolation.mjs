import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { chromium, webkit } from 'playwright';

const port = 4185;
const guardOrigin = `http://127.0.0.1:${port}`;
const guard = spawn(process.execPath, [
  'scripts/testing/run-browser-network-guard.mjs', String(port),
], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

const post = async (path, body) => {
  const response = await fetch(`${guardOrigin}${path}`, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.ok, true, `${path} failed with ${response.status}`);
};

const readStatus = () => fetch(`${guardOrigin}/__network-guard/status`).then(
  (response) => response.json(),
);

const launchBrowsers = async (callback) => {
  for (const [name, browserType] of [
    ['chromium', chromium],
    ['webkit', webkit],
  ]) {
    const browser = await browserType.launch({ proxy: { server: guardOrigin } });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await callback({ name, page });
      await context.close();
    } finally {
      await browser.close();
    }
  }
};

const waitForGuard = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${guardOrigin}/health`);
      if (response.ok) return;
    } catch {
      // The child has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Browser network guard did not become ready.');
};

try {
  await waitForGuard();
  await post('/__network-guard/reset');
  await post('/__network-guard/expect-blocked-canary', {
    method: 'GET', target: 'http://audit-external.invalid/http-probe',
  });
  await post('/__network-guard/expect-blocked-canary', {
    method: 'GET', target: 'ws://audit-external.invalid/websocket-probe',
  });
  // Chromium and WebKit expose proxy attempts differently. Register each
  // exact method/target signature rather than broadly trusting the host.
  await post('/__network-guard/expect-blocked-canary', {
    method: 'CONNECT', target: 'audit-external.invalid:80',
  });
  await post('/__network-guard/expect-blocked-canary', {
    method: 'GET', target: 'http://audit-external.invalid/websocket-probe',
  });
  await launchBrowsers(async ({ name, page }) => {
    const response = await page.goto('http://audit-external.invalid/http-probe');
    assert.equal(response?.status(), 403, `${name} HTTP proxy bypassed the guard.`);
    const websocketBlocked = await page.evaluate(() => new Promise((resolve) => {
      const socket = new WebSocket('ws://audit-external.invalid/websocket-probe');
      socket.addEventListener('open', () => resolve(false), { once: true });
      socket.addEventListener('error', () => resolve(true), { once: true });
    }));
    assert.equal(websocketBlocked, true, `${name} WebSocket bypassed the guard.`);
  });

  const canaryStatus = await readStatus();
  assert.ok(canaryStatus.blockedCanaryAttempts.length >= 2);
  assert.equal(
    canaryStatus.blockedCanaryAttempts.every(
      (entry) => entry.target.includes('audit-external.invalid'),
    ),
    true,
  );
  assert.deepEqual(canaryStatus.deniedUnexpectedAttempts, []);
  assert.deepEqual(canaryStatus.escapedExternalRequests, []);

  await post('/__network-guard/reset');
  await launchBrowsers(async ({ name, page }) => {
    const unexpected = await page.goto('http://unexpected-external.invalid/escape-probe');
    assert.equal(unexpected?.status(), 403, `${name} unapproved host was not denied.`);
    await assert.rejects(
      page.goto('https://alnawasreh.com/production-probe'),
      undefined,
      `${name} Production host was not denied.`,
    );
  });
  const deniedStatus = await readStatus();
  assert.ok(deniedStatus.deniedUnexpectedAttempts.length >= 4);
  assert.equal(
    deniedStatus.deniedUnexpectedAttempts.some(
      (entry) => entry.target.includes('unexpected-external.invalid'),
    ),
    true,
  );
  assert.equal(
    deniedStatus.deniedUnexpectedAttempts.some(
      (entry) => entry.target.includes('alnawasreh.com'),
    ),
    true,
  );
  assert.deepEqual(deniedStatus.escapedExternalRequests, []);

  await post('/__network-guard/reset');
  const loopbackServer = http.createServer((_request, response) => response.end('loopback-ok'));
  await new Promise((resolve) => loopbackServer.listen(4186, '127.0.0.1', resolve));
  try {
    await launchBrowsers(async ({ name, page }) => {
      const response = await page.goto('http://127.0.0.1:4186/allowed');
      assert.equal(response?.status(), 200, `${name} loopback target was not allowed.`);
      assert.equal(await page.textContent('body'), 'loopback-ok');
    });
  } finally {
    await new Promise((resolve) => loopbackServer.close(resolve));
  }
  const loopbackStatus = await readStatus();
  assert.deepEqual(loopbackStatus.deniedUnexpectedAttempts, []);
  assert.deepEqual(loopbackStatus.escapedExternalRequests, []);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    browsers: ['chromium', 'webkit'],
    externalRequestsEscaped: 0,
    productionRequestsEscaped: 0,
    deniedCanaryRequests: canaryStatus.blockedCanaryAttempts.length,
    deniedUnexpectedAttemptsVerified: deniedStatus.deniedUnexpectedAttempts.length,
  }, null, 2)}\n`);
} finally {
  guard.kill('SIGTERM');
}
