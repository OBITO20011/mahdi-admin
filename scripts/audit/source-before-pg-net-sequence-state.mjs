import{sourceBeforeD1Kit}from'./source-before-d1-reference-kit.mjs';
// Exact historical view only;current Backup/Restore always executes current code.
import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';
const baseline="01d4b036136304876da1be8b701cff9e342e3b4d",pins={
  "tests/record-order-source-contracts.test.ts": {
    "before": "917d67433281ccbc1e4efcd41586d17f32d9798b048ba075e671aab8c3fb2963",
    "after": "eac07e02ccd555514f758936dabc957b5571e4135bf3b4c73c8a6319d07f7127"
  },
  "tests/workbook-integration-history.test.ts": {
    "before": "41f32a12280f0a82b19b1925e6d540240c3eb56dd6fb2384cbc9c21f68854f80",
    "after": "eb72f311e6893908e7edc44ca83cd1ab708d91976d09ea27ed1fb1e9d2c36922"
  },
  "scripts/backup/complete-backup.mjs": {
    "before": "adb9b91267523be7ba1f8ead94687330a526a07848f6330ea49afb1a507450cf",
    "after": "5375ff8514146e427aa234c4b38239a930249d7d1360faba2513bae48536a9c0"
  },
  "scripts/backup/postgres-diagnostic.mjs": {
    "before": "2ae55415ea2bb29209bd7f9706c31bd3357780f8da14269042ba0b943acf34e8",
    "after": "81617ee06f3c0ac8be01682875cb2ebb6fb4583c1dffd3a9c2b22d7d2df64d44"
  },
  "scripts/testing/run-dual-backup-runtime.mjs": {
    "before": "609bfbf667fc14090c5cd4038fdbe2b024c01db8f9a261ee266e02d3e555a3b2",
    "after": "ef3a1bc05933087f88dbb63e0c79f7d0834cda1d228eb7fa9aa4364d5b473d76"
  },
  "scripts/backup/pg-net-sequence-state.mjs": {
    "before": null,
    "after": "c6ac93638f830b7a964a3848f9becf8f05979e3f6cefe28665deae671353c1ab"
  },
  "scripts/testing/pg-net-sequence-runtime.mjs": {
    "before": null,
    "after": "4eacf7099e154dec4ed071a42d4ee2cb3ba6f5bf793e17112127619de2304c49"
  },
  "scripts/testing/fixtures/pg-net-state-protected-sources.json": {
    "before": null,
    "after": "da78e44c45843caacc8e7c5e986a92467d5200ba2ba27abbcaa1386579687c42"
  }
};
const canonical=t=>t.replaceAll('\r\n','\n'),hash=t=>createHash('sha256').update(canonical(t)).digest('hex'),old=new Map();
export function sourceBeforePgNetSequenceState(file,text){
 text=sourceBeforeD1Kit(file,text);
 const p=pins[file];if(text===null||!p||hash(text)!==p.after)return text;
 if(p.before===null)return null;
 if(!old.has(file)){const before=execFileSync('git',['show',baseline+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:32*1024**2});assert.equal(hash(before),p.before,'PGNET_STATE_BASELINE_CHANGED');old.set(file,canonical(before));}
 return old.get(file);
}
export function restorePgNetStateSourceHashes(rows){return rows.flatMap(row=>{const p=pins[row.file];return !p||p.after!==row.sha256?[row]:p.before===null?[]:[{...row,sha256:p.before}];});}
export function pathsBeforePgNetSequenceState(files,reference){return files.filter(file=>{
 if(!pins[file])return true;const current=readFileSync(new URL('../../'+file,import.meta.url),'utf8'),before=sourceBeforePgNetSequenceState(file,current);
 if(before===null)return false;if(before===current||!reference)return true;
 try{return hash(execFileSync('git',['show',reference+':'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}))!==hash(before);}catch{return true;}
});}
