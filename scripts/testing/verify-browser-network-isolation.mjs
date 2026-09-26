import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium, webkit } from 'playwright';

const port = 4185;
const guardOrigin = `http://127.0.0.1:${port}`;
const guard = spawn(process.execPath, [
  'scripts/testing/run-browser-network-guard.mjs', String(port),
], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

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
  for (const [name, browserType] of [
    ['chromium', chromium],
    ['webkit', webkit],
  ]) {
    const browser = await browserType.launch({
      proxy: { server: guardOrigin },
    });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.route('**/*', (route) => route.continue());
      const response = await page.goto('http://audit-external.invalid/http-probe');
      assert.equal(response?.status(), 403, `${name} HTTP proxy bypassed the guard.`);
      const websocketBlocked = await page.evaluate(() => new Promise((resolve) => {
        const socket = new WebSocket('ws://audit-external.invalid/websocket-probe');
        socket.addEventListener('open', () => resolve(false), { once: true });
        socket.addEventListener('error', () => resolve(true), { once: true });
      }));
      assert.equal(websocketBlocked, true, `${name} WebSocket bypassed the guard.`);
      await context.close();
    } finally {
      await browser.close();
    }
  }

  const status = await fetch(`${guardOrigin}/__network-guard/status`).then(
    (response) => response.json(),
  );
  assert.ok(status.denied.length >= 4);
  assert.equal(
    status.denied.every((entry) => entry.target.includes('audit-external.invalid')),
    true,
  );
  process.stdout.write(`${JSON.stringify({
    ok: true,
    browsers: ['chromium', 'webkit'],
    externalRequestsEscaped: 0,
    deniedCanaryRequests: status.denied.length,
  }, null, 2)}\n`);
} finally {
  guard.kill('SIGTERM');
}
