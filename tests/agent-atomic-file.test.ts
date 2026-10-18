import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {writeAtomicUtf8} from '../scripts/agent/atomic-file.mjs';
test('checkpoint atomic replacement preserves complete UTF8 JSON and cleans temporary files on success or failure',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'nawasrah-checkpoint-atomic-')),file=path.join(dir,'task.json');
 try{
  writeFileSync(file,'{"old":true}');
  const content=JSON.stringify({status:'ACTIVE',next:'إكمال الفحوص',entries:Array.from({length:200},(_,i)=>i)});writeAtomicUtf8(file,content);assert.equal(readFileSync(file,'utf8'),content);
  assert.deepEqual(readdirSync(dir),['task.json']);
  const blocked=path.join(dir,'directory');mkdirSync(blocked);writeFileSync(path.join(blocked,'keep'),'unchanged');
  assert.throws(()=>writeAtomicUtf8(blocked,'cannot replace directory'));
  assert.equal(readFileSync(path.join(blocked,'keep'),'utf8'),'unchanged');
  assert.deepEqual(readdirSync(dir).sort(),['directory','task.json']);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
