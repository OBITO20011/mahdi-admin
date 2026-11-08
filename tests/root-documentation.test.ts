import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {sourceBeforeD1Kit, pathsBeforeD1Kit} from '../scripts/audit/source-before-d1-reference-kit.mjs';

const baseline='ef3507561652ea842229cdad66515cd89d82f882';
const read=(file:string)=>readFileSync(file,'utf8').replaceAll('\r\n','\n');

test('archived root documents preserve their historical content with working relocated links',()=>{
 for(const file of ['PROJECT_PLAN.md','DESIGN_SYSTEM.md','ARCHITECTURE.md','DATABASE_DESIGN.md']){
  assert.ok(!existsSync(file));
  const archived='docs/archive/'+file;
  const expected=execFileSync('git',['show',baseline+':'+file],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n')
   .replaceAll('(./docs/HANDOFF.md)','(../HANDOFF.md)')
   .replaceAll('(./docs/operations/PRIVACY_DATA_MAP.md)','(../operations/PRIVACY_DATA_MAP.md)');
  assert.equal(read(archived),expected,file);
  for(const match of read(archived).matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)){
   assert.ok(existsSync(path.resolve(path.dirname(archived),match[1].split('#')[0])),archived+': '+match[1]);
  }
 }
 assert.match(read('docs/archive/README.md'),/historical|Historical/u);
 for(const file of ['AGENTS.md','CLAUDE.md','metadata.json','package-lock.json','customer-web/package-lock.json'])assert.ok(existsSync(file));
 assert.ok(!existsSync('bun.lock'));
});

test('the historical SQL guard accepts only the exact approved documentation link delta',()=>{
 const file='supabase/README.md',raw=read(file);
 assert.deepEqual(pathsBeforeD1Kit([file],baseline),[]);
 const before=execFileSync('git',['show',baseline+':'+file],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');
 assert.equal(sourceBeforeD1Kit(file,raw),before);
 for(const unknown of [raw+'\nUNKNOWN_CHANGE',raw.replace('DATABASE_DESIGN.md','UNREVIEWED.md')])assert.equal(sourceBeforeD1Kit(file,unknown),unknown);
 for(const file of ['supabase/migrations/219_home_dashboard_financial_read_optimization.sql','supabase/functions/unreviewed/index.ts']){
  assert.deepEqual(pathsBeforeD1Kit([file],baseline),[file]);
  assert.equal(sourceBeforeD1Kit(file,'unreviewed SQL or backend change'),'unreviewed SQL or backend change');
 }
 const view=read('scripts/testing/product-workbook-runtime-view.mjs');
 assert.match(view,/pathsBeforeD1Kit\(git\(\['diff','--name-only',baseline,'HEAD','--','supabase'\]/u);
 assert.match(view,/HISTORICAL_VIEW_SQL_CHANGED/u);
});
