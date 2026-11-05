import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {sourceBeforeStorefrontImages,projectStorefrontImageQueries,pathsBeforeStorefrontImages,historicalStorefrontImagesRpcSite} from '../scripts/audit/source-before-storefront-images.mjs';
import {parseServices} from '../scripts/audit/service-access-inventory.mjs';
import {parseSource} from '../scripts/audit/table-access-inventory.mjs';
const hash=(text:string)=>createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex');
test('image history reproduces exact Git70 bytes and never admits an unknown source or evidence mutation',()=>{
 const p=JSON.parse(readFileSync('scripts/audit/storefront-images-source-pins.json','utf8'));assert.equal(p.baseline,'d102074583c7369502954eaf8ea70d2595f6a19c');
 for(const[file,pin]of Object.entries(p.entries)as[string,{before:string|null;after:string}][]){const raw=readFileSync(file,'utf8');assert.equal(hash(raw),pin.after,file);const before=sourceBeforeStorefrontImages(file,raw);if(pin.before===null)assert.equal(before,null,file);else{const git=execFileSync('git',['show',p.baseline+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:32*1024**2});assert.equal(hash(git),pin.before,file);assert.equal(before!.replaceAll('\r\n','\n'),git.replaceAll('\r\n','\n'),file);}const unknown=raw+'\n// unknown image mutation';assert.equal(sourceBeforeStorefrontImages(file,unknown),unknown,file);}
});
test('image query projection preserves the actual unchanged read and rejects argument or identity substitution',()=>{
 const file='src/services/supabase/product-images.service.ts',raw=readFileSync(file,'utf8'),parsed=parseSource(file,raw);const current={entries:parsed.entries,sources:[{file,sha256:hash(raw)}]};const old=execFileSync('git',['show','d1020745:'+file],{encoding:'utf8'});
 assert.deepEqual(projectStorefrontImageQueries(current,parseSource).entries,parseSource(file,old).entries);
 const changed=structuredClone(current);changed.entries[0].calls[0].args=['unapproved'];assert.throws(()=>projectStorefrontImageQueries(changed,parseSource),/IMAGE_QUERY_ARGUMENT_CHANGED/u);
 const unknown=structuredClone(current);unknown.sources[0].sha256='unapproved';assert.deepEqual(projectStorefrontImageQueries(unknown,parseSource),unknown);
});

test('image path projection cannot hide an unrelated file and RPC relocation preserves exact original content',()=>{
 const ref='d102074583c7369502954eaf8ea70d2595f6a19c',file='src/services/supabase/product-images.service.ts';
 assert.deepEqual(pathsBeforeStorefrontImages(['src/services/supabase/orders.service.ts'],ref),['src/services/supabase/orders.service.ts']);
 assert.deepEqual(pathsBeforeStorefrontImages([file],ref),[]);
 const raw=readFileSync(file,'utf8'),current=parseServices(file,raw).rpc,old=parseServices(file,sourceBeforeStorefrontImages(file,raw)!).rpc;
 assert.deepEqual(current.map(entry=>historicalStorefrontImagesRpcSite(entry.id,parseServices)),old.map(entry=>entry.id));
 assert.throws(()=>historicalStorefrontImagesRpcSite(file+':999999',parseServices),/IMAGE_RPC_SITE_UNKNOWN/u);
});
