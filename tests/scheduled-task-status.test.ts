import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {scheduledTaskStatus} from '../scripts/monitoring/scheduled-task-status.mjs';

const now=new Date('2026-10-12T21:00:00Z');
const cases=[
  {result:0,at:'2026-10-11T20:00:00Z',healthy:true,status:'succeeded'},
  {result:267009,at:'2026-10-12T20:59:00Z',healthy:true,status:'running'},
  {result:267009,at:'2026-10-12T17:00:00Z',healthy:false,status:'running_overdue'},
  {result:267011,at:'2026-10-11T20:00:00Z',healthy:true,status:'not_run_yet'},
  {result:1,at:'2026-10-12T20:59:00Z',healthy:false,status:'failed'},
];
for(const item of cases)test(`Scheduler ${item.result}/${item.status}: actual state instead of nonzero failure`,()=>{
  const task={lastTaskResult:item.result,lastRunTime:item.at};
  const status=scheduledTaskStatus(task,now);assert.equal(status.healthy,item.healthy);assert.equal(status.status,item.status);
  const cli=JSON.parse(execFileSync(process.execPath,['scripts/monitoring/scheduled-task-status.mjs'],{
    input:JSON.stringify({task,now:now.toISOString()}),encoding:'utf8'}));assert.deepEqual(cli,status);
});
test('running budget is evidenced,bounded and invalid start cannot conceal a stuck task',()=>{
  const task={lastTaskResult:267009,lastRunTime:'2026-10-12T20:30:00Z',normalDurationSeconds:120};
  const status=scheduledTaskStatus(task,now);assert.equal(status.status,'running_overdue');assert.equal(status.maxRunningSeconds,1500);
  assert.equal(scheduledTaskStatus({...task,lastRunTime:'bad'},now).healthy,false);
  assert.equal(scheduledTaskStatus({...task,lastRunTime:'2026-10-13T00:00:00Z'},now).healthy,false);
  assert.equal(scheduledTaskStatus({...task,normalDurationSeconds:100000},now).maxRunningSeconds,8100);
  assert.equal(scheduledTaskStatus({...task,maxRunningSeconds:300},now).healthy,false);
  for(const result of [null,undefined,'',false,{},'invalid'])assert.equal(scheduledTaskStatus({lastTaskResult:result,lastRunTime:null},now).healthy,false);
});
test('PowerShell status consumers and watchdog share the exact Scheduler evaluator',()=>{
  for(const file of ['scripts/backup/get-backup-status.ps1','scripts/monitoring/get-developer-monitoring-status.ps1'])
    assert.match(readFileSync(file,'utf8'),/Get-NawasrahScheduledTaskStatus/);
  const bridge=readFileSync('scripts/monitoring/scheduled-task-status.ps1','utf8');assert.match(bridge,/scheduled-task-status\.mjs/);
  assert.doesNotMatch(bridge,/password|token|secret|Unprotect/iu);
  const watchdog=readFileSync('scripts/monitoring/run-developer-watchdog.mjs','utf8');
  assert.match(watchdog,/scheduledTaskStatus\(\{\.\.\.taskResults\.backup/);
  assert.match(watchdog,/n8nTaskStatus\.healthy/);assert.doesNotMatch(watchdog,/taskResults\.backup === 0|n8nTaskResult === 0/);
});
