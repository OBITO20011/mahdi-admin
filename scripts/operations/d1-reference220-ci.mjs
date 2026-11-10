import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {requireD1} from './d1-reference220-state.mjs';
// Public GitHub metadata only. No token,credential file or hosted ERP endpoint.
export async function readD1Github(route){
 try{const r=await fetch('https://api.github.com/repos/OBITO20011/mahdi-admin/'+route,{headers:{Accept:'application/vnd.github+json','User-Agent':'Nawasrah-D1-reference-kit'},signal:AbortSignal.timeout(30000)});requireD1(r.ok,'D1_CI_UNVERIFIED_MANUAL_REVIEW_REQUIRED');return await r.json();}
 catch{throw new Error('D1_CI_UNVERIFIED_MANUAL_REVIEW_REQUIRED');}
}
/** @param {string} root @param {string} head @param {{get?:(route:string)=>Promise<any>,verifyJobs?:(jobs:any[])=>void}} [dependencies] */
export async function verifyD1Ci(root,head,{get=readD1Github,verifyJobs}={}){
 const branch=await get('git/ref/heads/main');requireD1(branch.object?.sha===head,'D1_REMOTE_MAIN_MISMATCH');
 const runs=[];for(let page=1;;page++){const result=await get('actions/runs?head_sha='+head+'&per_page=100&page='+page);runs.push(...result.workflow_runs);if(result.workflow_runs.length<100)break;}
 const results={head,checkedAt:new Date().toISOString(),runs:{}};
 if(!verifyJobs)({verifyFullDeliveryJobs:verifyJobs}=await import(pathToFileURL(path.join(root,'scripts/agent/verify-delivery-ci.mjs')).href));
 for(const name of ['Nawasrah code quality','Nawasrah secret scanning','Nawasrah complete backup recovery','Nawasrah lite220 owner tools']){
  const run=runs.filter(r=>r.name===name&&r.head_sha===head&&r.head_branch==='main'&&['push','workflow_dispatch'].includes(r.event)).sort((a,b)=>b.id-a.id)[0];
  requireD1(run&&run.status==='completed'&&run.conclusion==='success','D1_CI_NOT_FULL_GREEN');
  const jobs=[];for(let page=1;;page++){const result=await get('actions/runs/'+run.id+'/jobs?filter=latest&per_page=100&page='+page);jobs.push(...result.jobs);if(result.jobs.length<100)break;}
  requireD1(jobs.length>0&&jobs.every(j=>j.head_sha===head&&j.status==='completed'&&j.conclusion==='success'),'D1_CI_NOT_FULL_GREEN');
  if(name==='Nawasrah code quality')try{verifyJobs(jobs);}catch{throw new Error('D1_CI_NOT_FULL_GREEN');}
  if(name==='Nawasrah lite220 owner tools')try{verify220OwnerToolJobs(jobs);}catch{throw new Error('D1_CI_NOT_FULL_GREEN');}
  results.runs[name]={id:run.id,event:run.event,jobs:jobs.length,url:'https://github.com/OBITO20011/mahdi-admin/actions/runs/'+run.id};
 }return results;
}

export const owner220DeliveryJobs=Object.freeze(['Literal220 migration and full parity','RESET220 interruption and private fence','Upgrade220 encrypted protection chain','Lite220 owner-size go-live and later activation']);
export function verify220OwnerToolJobs(jobs){for(const name of owner220DeliveryJobs){const rows=jobs.filter(j=>j.name===name);requireD1(rows.length===1&&rows[0].conclusion==='success','D1_CI_NOT_FULL_GREEN');}requireD1(jobs.length===owner220DeliveryJobs.length,'D1_CI_NOT_FULL_GREEN');}
