import {verifyD1Ci as verify223Ci} from './d1-reference223-ci.mjs';
import {readD1Github} from './d1-reference220-ci.mjs';
import {requireD1} from './d1-reference224-state.mjs';

/** @param {string} root @param {string} head @param {Parameters<typeof verify223Ci>[2]} [dependencies] */
export async function verifyD1Ci(root,head,dependencies={}){
 const {get=readD1Github,verifyJobs}=dependencies;
 const result=await verify223Ci(root,head,{get,verifyJobs});
 const runs=[];
 for(let page=1;;page++){
  const response=await get('actions/runs?head_sha='+head+'&per_page=50&page='+page);
  runs.push(...response.workflow_runs);
  if(response.workflow_runs.length<50)break;
 }
 const name='Nawasrah inventory224';
 const run=runs.filter(row=>row.name===name&&row.head_sha===head&&row.head_branch==='main'&&['push','workflow_dispatch'].includes(row.event))
  .sort((a,b)=>b.id-a.id)[0];
 requireD1(run&&run.status==='completed'&&run.conclusion==='success','D1_CI_NOT_FULL_GREEN');
 const jobs=[];
 for(let page=1;;page++){
  const response=await get('actions/runs/'+run.id+'/jobs?filter=latest&per_page=50&page='+page);
  jobs.push(...response.jobs);
  if(response.jobs.length<50)break;
 }
 const expected=['Inventory224 reader and full-mode preservation','Inventory224 owner protection and RESET'];
 requireD1(jobs.length===expected.length&&expected.every(jobName=>jobs.filter(job=>
  job.name===jobName&&job.head_sha===head&&job.status==='completed'&&job.conclusion==='success').length===1),'D1_CI_NOT_FULL_GREEN');
 result.runs[name]={id:run.id,event:run.event,jobs:jobs.length,url:'https://github.com/OBITO20011/mahdi-admin/actions/runs/'+run.id};
 return result;
}
