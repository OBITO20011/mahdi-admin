import test from 'node:test';
import assert from 'node:assert/strict';
import type {ErrorEvent} from '@sentry/react';
import {monitoringScreen as adminScreen,sanitizeEvent as adminSanitize} from '../src/lib/monitoringPrivacy';
import {monitoringScreen as storeScreen,sanitizeEvent as storeSanitize} from '../customer-web/src/lib/monitoringPrivacy';
import {VALID_ACTIVE_TABS} from '../src/stores/appStorePreferences';
import {getStorePagePath} from '../customer-web/src/utils/publicRoutes';
import {monitoringEnvironment} from '../scripts/environments/environment.mjs';

test('admin screen uses the complete fixed activeTab allowlist and unknown fails closed',()=>{
 for(const tab of VALID_ACTIVE_TABS)assert.equal(adminScreen(tab),tab);
 for(const invalid of ['/', '0771234567', 'customer-name', null, {}, 'pos?token=x'])assert.equal(adminScreen(invalid),'unknown');
 assert.equal(adminSanitize({type:undefined,tags:{screen:'/' }},{screen:'pos'}).tags?.screen,'pos');
});
test('store screen covers actual public paths and never sends identifiers,query or hash',()=>{
 for(const page of ['home','catalog','offers','about'] as const){const path=getStorePagePath(page);assert.equal(storeScreen(path),path);}
 assert.equal(storeScreen('/product/secret-product/?token=private#sensitive'),'/product/:product/');
 assert.equal(storeScreen('/category/private-category/'),'/category/:category/');
 assert.equal(storeScreen('/offers/?phone=0771234567'),'/offers/');
 assert.equal(storeScreen('/customer/private'),'unknown');
 assert.equal(storeScreen('/#receipt=private'),'/');
});
for(const [name,sanitize] of [['admin',adminSanitize],['store',storeSanitize]] as const){
 test(name+' retains same-origin technical frames and allowlisted type while removing all sensitive fields',()=>{
  const secret='زبون_سري 0771234567 100.500 token-private cart-private';
  const raw: ErrorEvent={type:undefined,message:secret,user:{username:secret},request:{url:secret},extra:{cart:secret},contexts:{secret:{value:secret}},breadcrumbs:[{message:secret}],tags:{screen:secret,component:'AppErrorBoundary',error_code:'REACT_RENDER_ERROR'},exception:{values:[{type:'TypeError',value:secret,stacktrace:{frames:[
   {filename:'https://app.example.test/assets/PosView-abc12345.js?token=private#'+encodeURIComponent(secret),function:'renderProduct',lineno:123,colno:45,in_app:true,vars:{secret},pre_context:[secret],post_context:[secret],context_line:secret,module_metadata:{secret}},
   {filename:'https://evil.test/assets/private.js',function:secret},
   {filename:'https://app.example.test/customer/'+encodeURIComponent(secret)+'.js'},
   {filename:'https://app.example.test/assets/index-abc12345.js',function:secret,lineno:-1,colno:Infinity,vars:{secret}},
  ]}}]}};
  const safe=sanitize(raw,{screen:name==='admin'?'pos':'/products/',origin:'https://app.example.test'});
  assert.deepEqual(safe.exception?.values,[{type:'TypeError',value:'REACT_RENDER_ERROR',stacktrace:{frames:[
   {filename:'https://app.example.test/assets/PosView-abc12345.js',function:'renderProduct',lineno:123,colno:45,in_app:true},
   {filename:'https://app.example.test/assets/index-abc12345.js'},
  ]}}]);
  const serialized=JSON.stringify(safe);
  for(const fragment of ['زبون_سري','0771234567','100.500','token-private','cart-private','?token','vars','context_line','pre_context','post_context','module_metadata','user','extra'])assert.ok(!serialized.includes(fragment),fragment);
  assert.equal(sanitize({type:undefined,exception:{values:[{type:secret,value:secret}]}}).exception?.values?.[0].type,'Error');
  for(const type of ['RangeError','ChunkLoadError','TypeError'])assert.equal(sanitize({type:undefined,exception:{values:[{type,value:secret}]}}).exception?.values?.[0].type,type);
 });
 test(name+' frames require same origin and are bounded with only known fields',()=>{
  const frame={filename:'https://app.example.test/assets/index-abc12345.js',function:'foo',lineno:1,colno:0,in_app:false};
  const raw: ErrorEvent={type:undefined,exception:{values:[{stacktrace:{frames:Array.from({length:90},()=>({...frame}))}}]}};
  assert.equal(sanitize(raw,{origin:'https://app.example.test'}).exception?.values?.[0].stacktrace?.frames?.length,50);
  assert.equal(sanitize(raw,{origin:'https://different.test'}).exception?.values?.[0].stacktrace,undefined);
 });
}
test('legacy DSN fails clearly without exposing value in all non-isolated contexts;isolated ignores it',()=>{
 const old='https://privatefixture@o123.ingest.de.sentry.io/456';
 for(const context of ['production','prelaunch-trial','staging'])assert.throws(()=>monitoringEnvironment({VITE_SENTRY_DSN:old},context),error=>error instanceof Error&&error.message==='MONITORING_LEGACY_DSN_RENAME_TO_VITE_SENTRY_DSN_'+context.toUpperCase().replaceAll('-','_'));
 assert.equal(monitoringEnvironment({VITE_SENTRY_DSN:old},'isolated').dsn,'');
 assert.equal(monitoringEnvironment({VITE_SENTRY_DSN:old,VITE_SENTRY_DSN_PRODUCTION:old},'production').dsn,old);
});
