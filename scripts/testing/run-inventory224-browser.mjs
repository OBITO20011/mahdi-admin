import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from './verification-source-freeze.mjs';
assert.equal(process.argv.length,2,'INVENTORY224_BROWSER_NO_TARGET_ARGUMENTS');
const root=path.resolve(import.meta.dirname,'../..'),output=await mkdtemp(path.join(tmpdir(),'nawasrah-inventory224-browser-'));
const config=path.join(output,'playwright.config.mjs'),slash=root.replaceAll('\\','/');
const report={ok:false,output,hostedAccess:false,ownerDemoAccess:false};
try{
 const freeze=await readVerificationSourceFreeze(root);
 const module=pathToFileURL(path.join(root,'node_modules/@playwright/test/index.mjs')).href;
 await writeFile(config,`import{devices}from${JSON.stringify(module)};const cwd=${JSON.stringify(slash)};export default{testDir:cwd+'/e2e',testMatch:'inventory224.spec.ts',timeout:90000,retries:0,workers:1,reporter:[['list']],outputDir:${JSON.stringify(output.replaceAll('\\','/')+'/results')},use:{baseURL:'http://127.0.0.1:4183',serviceWorkers:'block',trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:{proxy:{server:'http://127.0.0.1:4185'}}},projects:[{name:'desktop-chromium',use:{...devices['Desktop Chrome'],locale:'ar-JO'}},{name:'mobile-webkit',use:{...devices['iPhone 13'],locale:'ar-JO'}}],webServer:[{command:'node scripts/testing/run-browser-network-guard.mjs 4185',cwd,url:'http://127.0.0.1:4185/health',reuseExistingServer:false,timeout:30000},{command:'node scripts/testing/run-isolated-vite.mjs admin 4183',cwd,url:'http://127.0.0.1:4183',reuseExistingServer:false,timeout:120000}]};`);
 const result=await promisify(execFile)(process.execPath,[path.join(root,'node_modules/@playwright/test/cli.js'),'test','--config',config],{cwd:root,windowsHide:true,maxBuffer:16*1024**2});
 await writeFile(path.join(output,'browser.log'),result.stdout+'\n'+result.stderr);
 assertVerificationSourceFreeze(freeze,await readVerificationSourceFreeze(root));report.ok=true;
}catch(error){report.error=String(error.message).slice(0,1000);if(error.stdout||error.stderr)await writeFile(path.join(output,'browser.log'),String(error.stdout??'')+'\n'+String(error.stderr??''));process.exitCode=1;}
await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
