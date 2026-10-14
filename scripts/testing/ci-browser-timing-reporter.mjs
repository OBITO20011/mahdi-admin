import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';

/** @param {{project:string,file:string,title:string,id:string} } test
 * @param {{duration:number,retry:number,status:string}} result */
export function timingRecord(test,result) {
  return {...test,durationMs:result.duration,retry:result.retry,status:result.status};
}
/** @param {ReturnType<typeof timingRecord>[]} records */
export function summarizeTimings(records) {
  const files=new Map();
  for(const row of records){
    const key=JSON.stringify([row.project,row.file]);
    const current=files.get(key)??{project:row.project,file:row.file,durationMs:0,attempts:0};
    current.durationMs+=row.durationMs;current.attempts++;files.set(key,current);
  }
  const descending=(a,b)=>b.durationMs-a.durationMs;
  return {attempts:records.length,totalTestDurationMs:records.reduce((sum,row)=>sum+row.durationMs,0),
    topFiles:[...files.values()].sort(descending).slice(0,10),topCases:[...records].sort(descending).slice(0,10)};
}

export default class CiBrowserTimingReporter {
  records=[];
  /** @param {import('@playwright/test/reporter').TestCase} test
   * @param {import('@playwright/test/reporter').TestResult} result */
  onTestEnd(test,result){
    const record=timingRecord({project:test.parent.project()?.name??'',
      file:path.relative(process.cwd(),test.location.file).replaceAll('\\','/'),
      title:test.titlePath().join(' > '),id:test.id},result);
    this.records.push(record);
    // Stream safe timing metadata even when a runner is cancelled before onEnd.
    // Never serialize request payloads, stdout, errors, environment or credentials.
    console.log('CI_BROWSER_TIMING '+JSON.stringify(record));
  }
  onEnd(){
    const summary=summarizeTimings(this.records);
    mkdirSync('ci-browser-metrics',{recursive:true});
    const project=(this.records[0]?.project??'empty').replace(/[^a-z0-9-]/giu,'_');
    writeFileSync(`ci-browser-metrics/${project}.json`,JSON.stringify({records:this.records,summary},null,2));
    console.log('CI_BROWSER_TIMING_SUMMARY '+JSON.stringify(summary));
  }
}
