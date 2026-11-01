// Same server Execution Time metric, unchanged3000ms/3warmups/20samples.
// Original slow measurements are evidence, never relabelled optimized PASS.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {timingSummary} from './package-e-scale-contract.mjs';

export async function measureHome219({name,query,json,rounds=1,limitMs=3000,assertLimit=false,evidenceKind='original-evidence'}){
  assert.equal(limitMs,3000,'HOME219_ORIGINAL_3_SECOND_GATE_REQUIRED');
  assert.ok([1,5].includes(rounds),'HOME219_COMPLETE_ROUNDS_ONLY');
  const results=[];
  for(let round=1;round<=rounds;round++){
    for(let n=0;n<3;n++)await json(query);
    const serverSamples=[],wallSamples=[];let lastPlan;
    for(let n=0;n<20;n++){
      const start=performance.now();lastPlan=await json(query);
      wallSamples.push(performance.now()-start);serverSamples.push(lastPlan[0]['Execution Time']);
    }
    const server=timingSummary(serverSamples),wall=timingSummary(wallSamples);
    results.push({round,...server,wall,serverSamples,wallSamples,lastPlan});
    console.log(JSON.stringify({stage:'full-scale p95 '+name,name,round,...server,wall,
      metric:'PostgreSQL EXPLAIN Execution Time',limitMs,acceptance:assertLimit?'optimized-current':evidenceKind}));
  }
  const p95s=results.map(r=>r.p95).sort((a,b)=>a-b),medianP95=p95s[Math.floor(p95s.length/2)];
  const result={name,metric:'PostgreSQL EXPLAIN Execution Time',rounds:results,medianP95,
    aggregation:'median of complete-round p95 values;never median of raw samples',limitMs,
    // Every measured round must pass too: the median cannot hide intermittent regressions.
    withinLimit:results.every(r=>r.p95<limitMs)};
  if(assertLimit)assert.ok(result.withinLimit&&medianP95<limitMs,'HOME219_P95_EXCEEDS_UNCHANGED_3000MS_GATE');
  return result;
}
export function assertHome219SamplesRejected(result){
  assert.ok(!result.withinLimit,'HOME219_REAL_SLOWDOWN_WAS_NOT_DETECTED');
}

// A failed Docker cleanup must not erase the evidence or turn a run green.
export async function finishHome219Report({report,output,stop}){
  try{if(stop)await stop();}
  catch{report.ok=false;report.cleanupError='LOCAL_TEST_DATABASE_STOP_FAILED';}
  report.endedAt=new Date().toISOString();
  const text=JSON.stringify(report,null,2)+'\n';
  await writeFile(path.join(output,'performance-report.json'),text);
  await writeFile(path.join(output,'report.json'),text);
  console.log(JSON.stringify({ok:report.ok,stage:report.stage,error:report.error,cleanupError:report.cleanupError,output,endedAt:report.endedAt}));
  return report.ok===true;
}
