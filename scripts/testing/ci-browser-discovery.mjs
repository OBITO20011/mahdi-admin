import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {packageFShardCount,isPackageFShardArgument} from './package-f-ci-shards.mjs';

const root=path.resolve(import.meta.dirname,'../..');
export const playwrightCli=path.join(root,'node_modules/@playwright/test/cli.js');
function rawList(group,files,extra,ci){
  const result=spawnSync(process.execPath,[playwrightCli,'test','--list','--reporter=json',
    '--config',group?'playwright.ci.config.ts':'playwright.config.ts',...extra,...files],{
    cwd:root,env:{...process.env,CI:ci?'true':'',NAWASRAH_BROWSER_GROUP:group??''},
    encoding:'utf8',maxBuffer:32*1024*1024});
  assert.equal(result.status,0,`Playwright list ${group??'full'} failed: ${result.stderr}`);
  const report=JSON.parse(result.stdout);assert.deepEqual(report.errors,[]);
  const entries=[];
  function visit(suite,parents=[]){
    const titles=[...parents,suite.title];
    for(const spec of suite.specs??[]){
      const file=path.relative(root,path.isAbsolute(spec.file)?spec.file:path.resolve(root,'e2e',spec.file)).replaceAll('\\','/');
      for(const test of spec.tests)entries.push({file,project:test.projectName,
        key:JSON.stringify([test.projectName,file,spec.line,spec.column,titles,spec.title])});
    }
    for(const child of suite.suites??[])visit(child,titles);
  }
  for(const suite of report.suites)visit(suite);return entries;
}
/** Actual Playwright discovery, with a per-project shard to balance engines too.
 * @param {string | undefined} group
 * @param {{files?:string[],shard?:number,ci?:boolean}} options */
export function listBrowserTests(group,{files=[],shard,ci=Boolean(process.env.CI)}={}){
  if(!shard)return rawList(group,files,[],ci);
  assert.equal(group,'package-f');
  const argument=`--shard=${shard}/${packageFShardCount}`;assert.ok(isPackageFShardArgument(argument));
  const projects=[...new Set(rawList(group,files,[],ci).map(row=>row.project))];
  return projects.flatMap(project=>rawList(group,files,[`--project=${project}`,argument],ci));
}
/** @param {string} argument @param {string[]} files */
export function packageFShardCommands(argument,files=[]){
  assert.ok(isPackageFShardArgument(argument));
  const ci=Boolean(process.env.CI);
  const projects=[...new Set(rawList('package-f',files,[],ci).map(row=>row.project))];
  assert.ok(projects.length>0,'No discovered Package F projects');
  return projects.flatMap(project=>{
    const args=[`--project=${project}`,argument];
    return rawList('package-f',files,args,ci).length
      ? [[playwrightCli,'test','--config','playwright.ci.config.ts',...args,...files]]:[];
  });
}
