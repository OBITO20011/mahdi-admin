import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {sourceBeforeIphoneDialogs,iphoneDialogPins,baseline} from '../scripts/audit/source-before-iphone-dialogs.mjs';
import {parseSource} from '../scripts/audit/table-access-inventory.mjs';
import {parseServices} from '../scripts/audit/service-access-inventory.mjs';
const read=(file:string)=>readFileSync(file,'utf8');
const hash=(s:string)=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
test('iPhone presentation inverse binds full delivered bytes, exposes any unknown change and preserves all RPC/table content',()=>{
 for(const [file,pin] of Object.entries(iphoneDialogPins) as [string,{before:string|null;after:string}][]){
  const current=read(file);assert.equal(hash(current),pin.after,file);
  const before=pin.before===null?null:execFileSync('git',['show',baseline+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:64*1024**2});
  assert.equal(sourceBeforeIphoneDialogs(file,current),before,file);
  assert.equal(sourceBeforeIphoneDialogs(file,current+'\n// unknown mutation\n'),current+'\n// unknown mutation\n',file);
  if(/\.[jt]sx?$/u.test(file))for(const parse of [parseSource,parseServices]){
   const a=parse(file,current),b=parse(file,before??'');
   const strip=(x:unknown):unknown=>Array.isArray(x)?x.map(strip):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).filter(([k])=>!['id','line'].includes(k)).map(([k,v])=>[k,strip(v)])):x;
   const calls=(value:ReturnType<typeof parseSource>|ReturnType<typeof parseServices>)=>{
    if('entries' in value)return {entries:value.entries,subscriptions:value.subscriptions};
    return {rpc:value.rpc,storage:value.storage,channels:value.channels,env:value.env,wrapperCalls:value.wrapperCalls};
   };
   assert.deepEqual(strip(calls(a)),strip(calls(b)),'UI must not introduce/change RPC or table access: '+file);
  }
 }
 assert.equal(sourceBeforeIphoneDialogs('unknown.sql','unknown'),'unknown');
 assert.equal(execFileSync('git',['diff','--name-only',baseline,'--','supabase','src/services','scripts/operations','scripts/backup','scripts/monitoring'],{encoding:'utf8',windowsHide:true}).trim(),'');
});
test('central modal stack owns isolation; drawer has no competing body/inert lock and existing busy/unsaved guards remain',()=>{
 const focus=read('src/utils/dialogFocus.ts'),shell=read('src/components/layout/NavigationShell.tsx'),isolation=read('src/utils/dialogIsolation.ts');
 assert.equal((focus.match(/syncDialogIsolation\(dialogs\)/gu)??[]).length,3);
 assert.ok(focus.indexOf('prepareDialogActivation();')<focus.indexOf('if (!available(panel))'));
 assert.match(isolation,/rememberExternalInert\(observer\?\.takeRecords\(\)/u);
 assert.doesNotMatch(shell,/body\.style\.overflow|siblings\.forEach/u);
 for(const expression of [/element\.inert = value/u,/position:'fixed'/u,/window\.scrollTo\(x, y\)/u,/showPopover/u,/MutationObserver/u,/visualViewport/u])assert.match(isolation,expression);
 assert.match(read('src/hooks/useDialogFocus.ts'),/if \(!protectUnsaved \|\| !edited\) escape\.current\(\)/u);
 assert.match(read('src/components/common/Modal.tsx'),/closeDisabled \|\| panel\.current\?\.querySelector/u);
});
test('mobile viewport keeps manual zoom and shared safe areas; permanent touch suite is discovered by existing CI shards',()=>{
 for(const file of ['index.html','customer-web/index.html']){assert.match(read(file),/viewport-fit=cover/u);assert.doesNotMatch(read(file),/user-scalable=no|maximum-scale=1/u);}
 const css=read('src/styles/dialogs.css');for(const term of ['100dvh','safe-area-inset-top','safe-area-inset-bottom','overscroll-behavior'])assert.ok(css.includes(term),term);
 assert.match(read('src/components/ui/form-fields.css'),/font-size: 16px !important/u);
 assert.match(read('customer-web/src/index.css'),/font-size: max\(16px, 1rem\)/u);
 assert.match(read('e2e/package-f-iphone-dialogs.spec.ts'),/hasTouch:true,isMobile:true/u);
});
