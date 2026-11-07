import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { measureStorefrontBudget, assertStorefrontBudget } from '../scripts/testing/storefront-budget.mjs';

test('cold-entry graph includes static imports, excludes lazy chunks, and rejects a genuine heavy initial download', async () => {
 const root=await mkdtemp(path.join(os.tmpdir(),'nawasrah-store-budget-'));
 try{
  await mkdir(path.join(root,'assets'));
  await writeFile(path.join(root,'index.html'),'<script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/style.css">');
  await writeFile(path.join(root,'assets/style.css'),'body{color:black}');
  await writeFile(path.join(root,'assets/index.js'),"import './shared.js';import('./lazy.js');");
  await writeFile(path.join(root,'assets/shared.js'),'export const shared=1;');
  const heavy='export const download='+JSON.stringify(randomBytes(600_000).toString('base64'))+';';
  await writeFile(path.join(root,'assets/lazy.js'),heavy);
  const mobileHeroVideo = path.join(root, 'nawasrah-hero-mobile.mp4');
  await writeFile(mobileHeroVideo, Buffer.alloc(1_000_000));
  const baseline=assertStorefrontBudget(await measureStorefrontBudget(root));
  assert.equal(baseline.initialScriptRequests,2);
  assert.equal(baseline.mobileHeroVideoBytes, 1_000_000);
  assert.ok(!baseline.chunks.some((item:{file:string})=>item.file.includes('lazy')));
  await writeFile(path.join(root,'assets/index.js'),"import './shared.js';import './lazy.js';");
  const slowed=await measureStorefrontBudget(root);
  assert.ok(slowed.initialJsGzip-baseline.initialJsGzip>500_000,'The negative case adds >2.5s of real 1.6Mbps transfer, not a mocked timing');
  assert.throws(()=>assertStorefrontBudget(slowed),/STOREFRONT_BUDGET_initialJs/u);
  await writeFile(path.join(root,'assets/index.js'), "import './shared.js';import('./lazy.js');");
  await writeFile(mobileHeroVideo, Buffer.alloc(1_000_001));
  const oversizedVideo = await measureStorefrontBudget(root);
  assert.throws(() => assertStorefrontBudget(oversizedVideo), /STOREFRONT_BUDGET_mobileHeroVideoBytes/u);
 }finally{await rm(root,{recursive:true,force:true});}
});
