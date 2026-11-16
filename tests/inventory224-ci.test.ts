import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyD1Ci} from '../scripts/operations/d1-reference224-ci.mjs';
import {owner220DeliveryJobs,predecessor220Jobs} from '../scripts/operations/d1-reference220-ci.mjs';
test('D1 requires both exact-head224 jobs plus every preceding full workflow without skipped, duplicate or stale admission',async()=>{
 const head='a'.repeat(40),names=['Nawasrah code quality','Nawasrah secret scanning','Nawasrah complete backup recovery','Nawasrah lite220 owner tools','Quarantined sales-only phase1','Nawasrah independent prices222','Nawasrah optional quantity223','Nawasrah inventory224'];
 const runs=names.map((name,i)=>({id:i+1,name,head_sha:head,head_branch:'main',event:'push',status:'completed',conclusion:'success'}));
 let mutation='none';
 const get=async(route:string)=>{
  if(route==='git/ref/heads/main')return{object:{sha:head}};
  if(route.startsWith('actions/runs?'))return{workflow_runs:mutation==='missing-run'?runs.slice(0,-1):runs};
  const id=Number(route.split('/')[2]);
  const jobNames=id===4?owner220DeliveryJobs:id===5?predecessor220Jobs:id===6?['Independent222 prices and full-mode parity','Independent222 owner protection and RESET']:id===7?['Optional223 database and browser lifecycle','Optional223 owner protection and RESET']:id===8?['Inventory224 reader and full-mode preservation','Inventory224 owner protection and RESET']:['legacy'];
  const jobs=jobNames.map(name=>({name,head_sha:head,status:'completed',conclusion:'success'}));
  if(id===8){
   if(mutation==='missing-job')jobs.pop();
   if(mutation==='red')jobs[0].conclusion='failure';
   if(mutation==='skipped')jobs[0].conclusion='skipped';
   if(mutation==='stale')jobs[0].head_sha='b'.repeat(40);
   if(mutation==='extra')jobs.push(jobs[0]);
  }
  if(id===7&&mutation==='prior-red')jobs[0].conclusion='failure';
  return{jobs};
 };
 assert.equal((await verifyD1Ci('',head,{get,verifyJobs:()=>{}})).head,head);
 for(mutation of ['missing-run','missing-job','red','skipped','stale','extra','prior-red'])
  await assert.rejects(()=>verifyD1Ci('',head,{get,verifyJobs:()=>{}}),/D1_CI_NOT_FULL_GREEN/);
});
