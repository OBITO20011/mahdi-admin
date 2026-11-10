import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {speedRpc,speedRpcPath,fullSpeedRpcName} from '../scripts/testing/storefront-speed-fixture.mjs';
test('public fixture accepts actual versioned RPC identifiers and keeps a finite reader-only contract',()=>{
 for(const [parallel,original] of [['lite1_catalog_page2','get_public_storefront_catalog_page'],['lite1_merchandising2','get_public_storefront_merchandising'],['lite1_parcel_options2','get_public_configurable_parcel_options']]){
  assert.match('/rest/v1/rpc/'+parallel,speedRpcPath);assert.equal(fullSpeedRpcName(parallel),original);assert.deepEqual(speedRpc(parallel,{}),speedRpc(original,{}));
 }
 for(const name of ['unreviewed','lite1_pos2','constructor','toString']){assert.equal(fullSpeedRpcName(name),name);assert.throws(()=>speedRpc(name,{}),/STOREFRONT_SPEED_UNEXPECTED_RPC/);}
 for(const path of ['/rest/v1/rpc/1bad','/rest/v1/rpc/valid?secret=x','/rest/v1/rpc/valid/../other','/rest/v1/rpc/valid;select','/rest/v1/rpc/UPPER'])assert.doesNotMatch(path,speedRpcPath);
 const flight=readFileSync('scripts/testing/run-cart-flight-browser.mjs','utf8');assert.match(flight,/name=fullSpeedRpcName\(name\)/);assert.match(flight,/assert\.match\(req\.url,speedRpcPath\)/);
 for(const pin of ['budget.initialJsBytes<=683725','budget.initialJsGzip<=187840'])assert.ok(flight.includes(pin),'Original flight budget must not be raised');
});
