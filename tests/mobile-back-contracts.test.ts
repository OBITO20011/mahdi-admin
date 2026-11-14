import{sourceBeforeIndependentPrices222}from'../scripts/audit/source-before-independent-prices222.mjs';
import{pathsBeforeStorefrontImages}from'../scripts/audit/source-before-storefront-images.mjs';
import{sourceBeforeSalesOnlyPhase2}from'../scripts/audit/source-before-sales-only-phase2.mjs';
import{sourceBeforeStorefrontSpeed}from'../scripts/audit/source-before-storefront-speed.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {mobileBackPins,mobileBackBeforeText,sourceBeforeMobileBack} from '../scripts/audit/source-before-mobile-back.mjs';
import {parseSource} from '../scripts/audit/table-access-inventory.mjs';
import {parseServices} from '../scripts/audit/service-access-inventory.mjs';
import {sourceBeforeWorkbookIntegration,pathsBeforeWorkbookIntegration} from '../scripts/audit/source-before-workbook-integration.mjs';

const baseline='6229aa3115079ea1b4d50a2588ccc04fa7fa3f56';
const git=(file:string)=>execFileSync('git',['show',baseline+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:32*1024**2});
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const canonical=(text:string)=>text.replaceAll('\r\n','\n');

test('navigation projection binds every actual baseline byte and never erases an unknown source/payload change',()=>{
 for(const[file,pin]of Object.entries(mobileBackPins)as[string,{beforeText:string|null;before:string|null;after:string}][]){
  const raw=sourceBeforeWorkbookIntegration(file,sourceBeforeStorefrontSpeed(file,readFileSync(file,'utf8')))!;assert.equal(hash(canonical(raw)),pin.after,file);
  if(pin.before!==null){const before=mobileBackBeforeText(file);assert.equal(canonical(git(file)),canonical(before),file);assert.equal(hash(canonical(before)),pin.before,file);}
  assert.equal(sourceBeforeMobileBack(file,raw),pin.before===null?null:git(file),file);
  assert.equal(sourceBeforeMobileBack(file,raw+'\n// unknown mutation\n'),raw+'\n// unknown mutation\n',file);
 }
});

test('no SQL, service or owner execution/connection/ACL/reset comparison source changes',()=>{
 const unchanged=['supabase','src/services','scripts/operations','scripts/backup','scripts/monitoring','scripts/testing/rehearsal219-protected-sources.mjs','scripts/testing/schema-catalog.mjs','scripts/testing/maintenance-db-contract.mjs'];
 // PR63 is an independently approved, offline-only addition merged into main.
 // Keep every original guard, and bind just its three new tool files to Git63.
 const approvedTools=new Set(['scripts/operations/check-go-live-files.ps1','scripts/operations/go-live-files/check.ts','scripts/operations/go-live-files/cli.ts']);
 const changed:string[]=pathsBeforeWorkbookIntegration(pathsBeforeStorefrontImages(execFileSync('git',['diff','--name-only',baseline,'--',...unchanged],{encoding:'utf8',windowsHide:true}).trim().split('\n').filter(Boolean),baseline));
 for(const file of changed.filter(file=>approvedTools.has(file))){
  assert.equal(execFileSync('git',['ls-tree','--name-only',baseline,'--',file],{encoding:'utf8',windowsHide:true}).trim(),'','PR63 tool must be new, not replace an old source');
  const approved=execFileSync('git',['show','2dafe8433bc4efef68a82fee904590aabf5fc8ad:'+file],{windowsHide:true});
  assert.deepEqual(Buffer.from(sourceBeforeWorkbookIntegration(file,sourceBeforeStorefrontSpeed(file,readFileSync(file,'utf8')))!),approved,'Unknown PR63 tool edit: '+file);
 }
 assert.equal(changed.filter(file=>!approvedTools.has(file)).join('\n'),'');
});

test('all RPC/table calls and every StoreEngine method except the two navigation entry points are unchanged',()=>{
 const files=['src/App.tsx','src/features/pos/PosView.tsx','src/stores/useAppStore.ts'];
 const withoutLocation=(value:unknown):unknown=>Array.isArray(value)?value.map(withoutLocation):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['id','line'].includes(key)).map(([key,item])=>[key,withoutLocation(item)])):value;
 for(const file of files){
  const current=sourceBeforeSalesOnlyPhase2(file,readFileSync(file,'utf8'))!,before=git(file);
  for(const parse of [parseSource,parseServices])assert.deepEqual(withoutLocation(parse(file,current)),withoutLocation(parse(file,before)),file);
 }
 const file='src/stores/useAppStore.ts';
 const members=(text:string)=>{
  const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const declaration=source.statements.find(statement=>ts.isClassDeclaration(statement)&&statement.name?.text==='StoreEngine');assert.ok(declaration&&ts.isClassDeclaration(declaration));
  const printer=ts.createPrinter({removeComments:true});
  return Object.fromEntries(declaration.members.map(member=>[member.name?.getText(source)??'<constructor>',printer.printNode(ts.EmitHint.Unspecified,member,source)]));
 };
 const before=members(git(file)),current=members(sourceBeforeIndependentPrices222(file,readFileSync(file,'utf8'))!);
 assert.deepEqual(Object.keys(current),Object.keys(before));
 for(const name of Object.keys(current))if(!['setActiveTab','openCustomerProfile'].includes(name))assert.equal(current[name],before[name],name);
 for(const name of ['setActiveTab','openCustomerProfile'])assert.match(current[name],/if \(!requestScreenNavigation\(/u);
});
