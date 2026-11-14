import test from 'node:test';
import assert from 'node:assert/strict';
import {packageFShardCount,isPackageFSpec,packageFSpecPattern,notPackageFSpecPattern} from '../scripts/testing/package-f-ci-shards.mjs';

test('only the two price-card interface suites join the existing ten F shards without changing test identities',()=>{
 assert.equal(packageFShardCount,10);
 for(const file of ['off-product-prices.spec.ts','price-visibility.spec.ts'])for(const prefix of ['e2e/','C:\\repo\\e2e\\']){
  const path=prefix+file;assert.equal(isPackageFSpec(path),true);assert.equal(packageFSpecPattern.test(path),true);assert.equal(notPackageFSpecPattern.test(path),false);
 }
 for(const file of ['other-off-product-prices.spec.ts','off-product-prices.spec.ts.extra','off-product-prices-old.spec.ts','regular.spec.ts']){
  const path='/repo/e2e/'+file;assert.equal(isPackageFSpec(path),false);assert.equal(notPackageFSpecPattern.test(path),true);
 }
});
