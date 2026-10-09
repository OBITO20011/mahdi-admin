import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow=readFileSync('.github/workflows/quality.yml','utf8');
const images=[];
for(const job of ['quality','package-f-browser']){
  const block=workflow.match(new RegExp(`^  ${job}:\\r?\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`,'m'))?.[1];
  assert.ok(block,`Required browser job ${job} must exist`);
  const image=block.match(/^ {6}image: (\S+)\r?$/m)?.[1];
  const version=image?.match(/^mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble@sha256:[a-f0-9]{64}$/u)?.[1];
  assert.ok(version,'Quality requires a versioned, digest-pinned Playwright image');
  assert.match(block,/^ {4}timeout-minutes: 20\r?$/m);
  const lock=JSON.parse(readFileSync('package-lock.json','utf8'));
  for(const name of ['@playwright/test','playwright','playwright-core']){
    assert.equal(lock.packages[`node_modules/${name}`]?.version,version,`Update ${job} image together with ${name}`);
  }
  images.push(image);
}
assert.equal(images[0],images[1],'Both browser jobs must use the same pinned image');
console.log('Both isolated browser jobs match the lockfile, image digest and20m limit');
