import {sourceBeforePgNetSequenceState,restorePgNetStateSourceHashes,pathsBeforePgNetSequenceState} from './source-before-pg-net-sequence-state.mjs';
// Exact projection for historical checks. Operational backup and Restore always use current bytes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const baseline='96cf7b9553aac99be655a5a342d801b99367ca66';
const pins={
 "scripts/backup/complete-backup.mjs": {
  "before": "9ce195adc4a26a06c10d57babe17e596fb033b06664e74a275a57bf6774ba6d9",
  "after": "adb9b91267523be7ba1f8ead94687330a526a07848f6330ea49afb1a507450cf"
 },
 "scripts/testing/run-dual-backup-runtime.mjs": {
  "before": "d9f93b0e0e7393cdb23374756b12efcbe322ebad22cfcb3aa15479f9f822310d",
  "after": "609bfbf667fc14090c5cd4038fdbe2b024c01db8f9a261ee266e02d3e555a3b2"
 }
};
const canonical=text=>text.replaceAll('\r\n','\n');
const hash=text=>createHash('sha256').update(canonical(text)).digest('hex');
const old=new Map();

export function sourceBeforeEmptyStorageRestore(file,text){
 text=sourceBeforePgNetSequenceState(file,text);
 const pin=pins[file];
 if(text===null||!pin||hash(text)!==pin.after)return text;
 if(!old.has(file)){
  const before=execFileSync('git',['show',baseline+':'+file],{encoding:'utf8',windowsHide:true});
  assert.equal(hash(before),pin.before,'EMPTY_STORAGE_RESTORE_BASELINE_CHANGED');
  old.set(file,canonical(before));
 }
 return old.get(file);
}

export function restoreEmptyStorageSourceHashes(rows){
 return restorePgNetStateSourceHashes(rows).map(row=>{
  const pin=pins[row.file];
  return pin&&row.sha256===pin.after?{...row,sha256:pin.before}:row;
 });
}

export function pathsBeforeEmptyStorageRestore(files,reference){
 return pathsBeforePgNetSequenceState(files,reference).filter(file=>{
  if(!reference||!pins[file])return true;
  const actual=readFileSync(new URL('../../'+file,import.meta.url),'utf8');
  const before=sourceBeforeEmptyStorageRestore(file,actual);
  if(before===actual)return true;
  try{return hash(execFileSync('git',['show',reference+':'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}))!==hash(before);}
  catch{return true;}
 });
}
