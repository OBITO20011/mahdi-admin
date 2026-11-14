// Strict legacy219/220 test compilation only;never a runtime application alias.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {sourceBeforeIndependentPrices222} from '../audit/source-before-independent-prices222.mjs';
const root=path.resolve(import.meta.dirname,'../..');
export function pre222ProductWorkbookSourcePlugin(){return{name:'exact-pre222-legacy-application',setup(b){
 // esbuild uses Go RE2:plain filter flags only. Unknown bytes stay visible.
 b.onLoad({filter:/\.[cm]?[jt]sx?$/},async args=>{
  const relative=path.relative(root,args.path).replaceAll('\\','/');
  if(!relative.startsWith('src/'))return undefined;
  const raw=await readFile(args.path,'utf8'),before=sourceBeforeIndependentPrices222(relative,raw);
  assert.ok(before!==null,'LEGACY_TRANSPORT_NEW222_IMPORT:'+relative);
  return{contents:before,loader:relative.endsWith('.tsx')?'tsx':relative.endsWith('.ts')?'ts':'js'};
 });
}};}
