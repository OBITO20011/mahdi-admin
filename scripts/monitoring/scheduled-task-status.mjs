import {fileURLToPath} from 'node:url';
import path from 'node:path';

/** Scheduler results are state,not all nonzero values are failures. */
/** @param {{lastTaskResult?:unknown,lastRunTime?:unknown,normalDurationSeconds?:number|null,maxRunningSeconds?:number}} task */
export function scheduledTaskStatus({lastTaskResult,lastRunTime,normalDurationSeconds=null,maxRunningSeconds=8100},now=new Date()) {
  const result=Number(lastTaskResult);
  if((typeof lastTaskResult!=='number'&&!(typeof lastTaskResult==='string'&&/^\d+$/u.test(lastTaskResult)))||!Number.isSafeInteger(result))
    return {healthy:false,status:'unavailable'};
  if(result===0)return {healthy:true,status:'succeeded',lastTaskResult:result};
  if(result===267011)return {healthy:true,status:'not_run_yet',lastTaskResult:result};
  if(result!==267009)return {healthy:false,status:'failed',lastTaskResult:result};
  const start=Date.parse(lastRunTime),elapsed=(now.getTime()-start)/1000;
  const ceiling=Number.isFinite(maxRunningSeconds)&&maxRunningSeconds>0?maxRunningSeconds:8100;
  // Successful observed duration×2 plus15m;minimum10m of normal runtime.
  // Without evidence use the existing2h scheduler ceiling plus15m grace.
  const limit=typeof normalDurationSeconds==='number'&&Number.isFinite(normalDurationSeconds)&&normalDurationSeconds>0
    ?Math.min(ceiling,Math.max(600,normalDurationSeconds*2)+900):ceiling;
  if(!Number.isFinite(elapsed)||elapsed<0)return {healthy:false,status:'running_time_invalid',lastTaskResult:result,maxRunningSeconds:limit};
  return {healthy:elapsed<=limit,status:elapsed<=limit?'running':'running_overdue',lastTaskResult:result,
    elapsedSeconds:Math.floor(elapsed),maxRunningSeconds:limit};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  let input='';process.stdin.setEncoding('utf8');for await(const chunk of process.stdin)input+=chunk;
  const {task,now}=JSON.parse(input);
  process.stdout.write(JSON.stringify(scheduledTaskStatus(task,now?new Date(now):new Date()))+'\n');
}
