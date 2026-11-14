import {verifyD1Ci as verify220Ci,readD1Github} from './d1-reference220-ci.mjs';
import {requireD1} from './d1-reference222-state.mjs';
// Keep all five existing FULL workflows mandatory, plus the222 proof. Never
// accept a green ancestor or the previous220 workflows as evidence for222.
/** @param {string} root @param {string} head @param {Parameters<typeof verify220Ci>[2]} [dependencies] */
export async function verifyD1Ci(root,head,dependencies={}){
 const {get=readD1Github,verifyJobs}=dependencies;
 const result=await verify220Ci(root,head,{get,verifyJobs});
 const runs=[];
 for(let page=1;;page++){const r=await get('actions/runs?head_sha='+head+'&per_page=50&page='+page);runs.push(...r.workflow_runs);if(r.workflow_runs.length<50)break;}
 const run=runs.filter(r=>r.name==='Nawasrah independent prices222'&&r.head_sha===head&&r.head_branch==='main'&&['push','workflow_dispatch'].includes(r.event)).sort((a,b)=>b.id-a.id)[0];
 requireD1(run&&run.status==='completed'&&run.conclusion==='success','D1_CI_NOT_FULL_GREEN');
 const jobs=[];for(let page=1;;page++){const r=await get('actions/runs/'+run.id+'/jobs?filter=latest&per_page=50&page='+page);jobs.push(...r.jobs);if(r.jobs.length<50)break;}
 const expected=['Independent222 prices and full-mode parity','Independent222 owner protection and RESET'];
 requireD1(jobs.length===expected.length&&expected.every(name=>jobs.filter(j=>j.name===name&&j.head_sha===head&&j.status==='completed'&&j.conclusion==='success').length===1),'D1_CI_NOT_FULL_GREEN');
 result.runs[run.name]={id:run.id,event:run.event,jobs:jobs.length,url:'https://github.com/OBITO20011/mahdi-admin/actions/runs/'+run.id};return result;
}
