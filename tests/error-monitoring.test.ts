import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const adminMonitoring = read('../src/lib/errorMonitoring.ts');
const storeMonitoring = read('../customer-web/src/lib/errorMonitoring.ts');
const adminBoundary = read('../src/components/common/AppErrorBoundary.tsx');
const storeBoundary = read('../customer-web/src/components/StoreErrorBoundary.tsx');

for (const [application, source] of [
  ['admin', adminMonitoring],
  ['storefront', storeMonitoring],
] as const) {
  test(`${application} error monitoring is production-only, private and lightweight`, () => {
    assert.match(source, /import\.meta\.env\.PROD/);
    assert.match(source, /VITE_SENTRY_DSN/);
    assert.match(source, /import\('@sentry\/react'\)/);
    assert.match(source, /sendDefaultPii:\s*false/);
    if(application === 'admin') assert.match(source, /tracesSampleRate:\s*0/);
    else {
      assert.match(source, /tracesSampleRate: performanceSampled \? 1 : 0/u);
      for(const term of ['sampleWebVitals','beforeSendSpan: sanitizeVitalSpan','beforeSendTransaction: event => sanitizeVitalTransaction','traceFetch: false','traceXHR: false','tracePropagationTargets: []'])assert.ok(source.includes(term),term);
    }
    assert.match(source, /sanitizeEvent,sanitizeBreadcrumb/);
    assert.match(source, /defaultIntegrations:\s*false/);
    assert.doesNotMatch(source, /replayIntegration/i);
    if(application === 'admin')assert.doesNotMatch(source, /browserTracingIntegration/i);
  });
}

test('both React recovery boundaries report unexpected render failures', () => {
  assert.match(adminBoundary, /captureRenderError\(error, info\.componentStack/);
  assert.match(storeBoundary, /captureRenderError\(error, info\.componentStack/);
});

test('admin downloads Sentry only after a real browser or React error', () => {
  assert.match(adminMonitoring, /function loadMonitoringSdk/);
  assert.match(adminMonitoring, /window\.addEventListener\('error'/);
  assert.match(adminMonitoring, /window\.addEventListener\('unhandledrejection'/);
  assert.match(adminMonitoring, /void loadMonitoringSdk\(\)\?\.catch/);
});

test('storefront downloads Sentry only for a sampled production visit or a real error', () => {
  assert.match(storeMonitoring, /function loadMonitoringSdk/);
  assert.match(storeMonitoring, /window\.addEventListener\('error'/);
  assert.match(storeMonitoring, /window\.addEventListener\('unhandledrejection'/);
  assert.match(storeMonitoring, /void loadMonitoringSdk\(\)\?\.catch/);
});
