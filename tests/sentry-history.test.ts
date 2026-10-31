import {sourceBeforeUsability} from '../scripts/audit/source-before-pre-delivery-usability.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';import{sourceBeforeSentry,restoreSentrySourceHashes}from'../scripts/audit/source-before-sentry.mjs';import{inventory}from'../scripts/audit/table-access-inventory.mjs';import{compareManagedCatalog}from'../scripts/operations/managed-catalog-policy.mjs';
const lf=(s:string)=>s.replaceAll('\r\n','\n'),hash=(s:string)=>createHash('sha256').update(s).digest('hex');
test('Sentry exact inverse preserves actual original Git bytes and never erases unknown changes',()=>{
 const p=JSON.parse(readFileSync('scripts/audit/sentry-source-pins.json','utf8'));assert.equal(p.baseline,'962d0406c6edb6797b7b8429e9508b4e8379470f');
 for(const[file,pin]of Object.entries(p.entries)as [string,{after:string;before:string|null;beforeText:string|null}][]){const text=sourceBeforeUsability(file,lf(readFileSync(file,'utf8')))!;assert.equal(hash(text),pin.after,file);assert.equal(sourceBeforeSentry(file,text),pin.beforeText,file);if(pin.beforeText!==null){assert.equal(hash(pin.beforeText),pin.before);assert.equal(lf(execFileSync('git',['show',p.baseline+':'+file],{encoding:'utf8',maxBuffer:16*1024**2})),pin.beforeText,file)}assert.equal(sourceBeforeSentry(file,text+'\n// unknown mutation\n'),text+'\n// unknown mutation\n',file);}
 assert.deepEqual(restoreSentrySourceHashes([{file:'unknown',sha256:'unapproved'}]),[{file:'unknown',sha256:'unapproved'}]);
});
test('actual current Sentry access evidence is complete and preserves the entire pre-Sentry catalog and ACL',async()=>{
 const current=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_217.json','utf8')),previousText=lf(readFileSync('docs/operations/TABLE_ACCESS_BEFORE_SENTRY217.json','utf8'));
 assert.equal(previousText,lf(execFileSync('git',['show','962d0406c6edb6797b7b8429e9508b4e8379470f:docs/operations/TABLE_ACCESS_AFTER_217.json'],{encoding:'utf8',maxBuffer:16*1024**2})));
 assert.deepEqual(current.sourceHashes,(await inventory()).sources);assert.equal(current.applicationReady,true);assert.equal(current.infrastructureOk,true);assert.ok(current.results.every((r:{sqlstate:null})=>r.sqlstate===null));
 const previous=JSON.parse(previousText),comparison=compareManagedCatalog(previous.catalog,current.catalog,{beforeBuildDate:previous.startedAt.slice(0,10),afterBuildDate:current.startedAt.slice(0,10)});assert.deepEqual(comparison.unexpected,[]);assert.deepEqual(comparison.expected,[]);
});
