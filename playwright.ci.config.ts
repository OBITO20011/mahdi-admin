import {defineConfig} from '@playwright/test';
import base from './playwright.config';

// Selection only: retain every project, timeout, retry, worker and network guard.
const group=process.env.NAWASRAH_BROWSER_GROUP;
if(group!=='core'&&group!=='package-f')throw new Error('Expected core or package-f browser group');
const packageF=/[/\\]package-f-[^/\\]+\.spec\.ts$/;
const notPackageF=/[/\\](?!package-f-[^/\\]+\.spec\.ts$)[^/\\]+$/;
export default defineConfig({
  ...base,
  testIgnore: [...(Array.isArray(base.testIgnore)?base.testIgnore:base.testIgnore?[base.testIgnore]:[]),
    group==='core'?packageF:notPackageF],
});
