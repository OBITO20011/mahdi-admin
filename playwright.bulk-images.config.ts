import {defineConfig,devices} from '@playwright/test';
const baseURL=process.env.BULK_IMAGES_BASE_URL;
if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw Error('LOCAL_BULK_IMAGE_RUNNER_REQUIRED');
export default defineConfig({testDir:'./tests/bulk-images-browser',timeout:90_000,fullyParallel:false,workers:1,retries:0,reporter:'list',
 outputDir:process.env.BULK_IMAGES_BROWSER_OUTPUT,
 use:{baseURL,serviceWorkers:'block',launchOptions:{proxy:{server:'http://127.0.0.1:4189'}},trace:'off',video:'off',screenshot:'only-on-failure',locale:'ar-JO',timezoneId:'Asia/Amman'},
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'webkit',use:{...devices['iPhone 13']}}],
 webServer:{command:'node scripts/testing/run-browser-network-guard.mjs 4189',url:'http://127.0.0.1:4189/health',reuseExistingServer:false,timeout:30_000},
});
