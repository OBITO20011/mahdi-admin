import {defineConfig} from '@playwright/test';
import base from './playwright.config';
import {packageFSpecPattern,notPackageFSpecPattern} from './scripts/testing/package-f-ci-shards.mjs';

// Keep projects, timeout, retry, worker and network guards unchanged.
// Owner-approved case-level Package F sharding in CI only (still one worker).
const group=process.env.NAWASRAH_BROWSER_GROUP;
if(group!=='core'&&group!=='package-f')throw new Error('Expected core or package-f browser group');
const packageF=packageFSpecPattern;
const notPackageF=notPackageFSpecPattern;
export default defineConfig({
  ...base,
  fullyParallel: Boolean(process.env.CI) && group==='package-f' ? true : base.fullyParallel,
  reporter: Boolean(process.env.CI) && group==='package-f'
    ? [...(Array.isArray(base.reporter) ? base.reporter : []), ['./scripts/testing/ci-browser-timing-reporter.mjs']]
    : base.reporter,
  testIgnore: [...(Array.isArray(base.testIgnore)?base.testIgnore:base.testIgnore?[base.testIgnore]:[]),
    group==='core'?packageF:notPackageF],
});
