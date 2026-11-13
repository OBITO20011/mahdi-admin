import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow=readFileSync('.github/workflows/quality.yml','utf8');
const images=[];
for(const job of ['quality','core-webkit-browser','package-f-browser']){
  const block=workflow.match(new RegExp(`^  ${job}:\\r?\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`,'m'))?.[1];
  assert.ok(block,`Required browser job ${job} must exist`);
  const image=block.match(/^ {6}image: (\S+)\r?$/m)?.[1];
  const version=image?.match(/^mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble@sha256:[a-f0-9]{64}$/u)?.[1];
  assert.ok(version,'Quality requires a versioned, digest-pinned Playwright image');
  const minutes=job==='quality'?35:20;
  assert.match(block,new RegExp('^ {4}timeout-minutes: '+minutes+'\\r?$','m'));
  const lock=JSON.parse(readFileSync('package-lock.json','utf8'));
  for(const name of ['@playwright/test','playwright','playwright-core']){
    assert.equal(lock.packages[`node_modules/${name}`]?.version,version,`Update ${job} image together with ${name}`);
  }
  images.push(image);
}
assert.ok(images.every(image=>image===images[0]),'All browser jobs must use the same pinned image');
console.log('All isolated browser jobs match the lockfile and image digest; quality35m, other browser jobs20m limit');
