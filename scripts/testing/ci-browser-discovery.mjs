import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
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
        description:`[${test.projectName}] › ${path.relative(path.join(root,'e2e'),path.join(root,file)).replaceAll('\\','/')} › ${[...titles.slice(1),spec.title].join(' › ')}`,
        key:JSON.stringify([test.projectName,file,spec.line,spec.column,titles,spec.title])});
    }
    for(const child of suite.suites??[])visit(child,titles);
  }
  for(const suite of report.suites)visit(suite);return entries;
}
/** Interleave each file's cases per engine; expensive files cannot concentrate
 * in one ordinal range. Future files are automatically included by discovery.
 * @param {{file:string,project:string,key:string}[]} rows */
export function balanceBrowserCases(rows){
  const groups=new Map();
  for(const row of rows){const key=JSON.stringify([row.project,row.file]);const group=groups.get(key)??[];group.push(row);groups.set(key,group);}
  /** @type {typeof rows[]} */
  const bins=Array.from({length:packageFShardCount},()=>[]);
  const loads=new Map();
  for(const group of groups.values()){
    const project=group[0].project;const counts=loads.get(project)??Array(packageFShardCount).fill(0);
    // Rotate each file's round-robin start to the least-loaded shard.
    const start=counts.indexOf(Math.min(...counts));
    group.forEach((row,index)=>{const shard=(start+index)%packageFShardCount;bins[shard].push(row);counts[shard]++;});
    loads.set(project,counts);
  }
  return bins;
}
function testListFile(rows){
  assert.ok(rows.length>0,'Empty test list is not a passing shard');
  const directory=mkdtempSync(path.join(tmpdir(),'nawasrah-ci-case-list-'));
  const file=path.join(directory,'cases.txt');
  writeFileSync(file,rows.map(row=>row.description).join('\n')+'\n');
  const dispose=()=>rmSync(directory,{recursive:true,force:true});
  process.once('exit',dispose);
  return {file,dispose:()=>{process.removeListener('exit',dispose);dispose();}};
}
/** Actual Playwright discovery, with a per-project shard to balance engines too.
 * @param {string | undefined} group
 * @param {{files?:string[],shard?:number,ci?:boolean}} options */
export function listBrowserTests(group,{files=[],shard,ci=Boolean(process.env.CI)}={}){
  if(!shard)return rawList(group,files,[],ci);
  assert.equal(group,'package-f');
  const argument=`--shard=${shard}/${packageFShardCount}`;assert.ok(isPackageFShardArgument(argument));
  const selected=balanceBrowserCases(rawList(group,files,[],ci))[shard-1];
  if(!selected.length)return [];
  const list=testListFile(selected);
  try{return rawList(group,files,['--test-list',list.file],ci);}finally{list.dispose();}
}
/** @param {string} argument @param {string[]} files */
export function packageFShardCommands(argument,files=[]){
  assert.ok(isPackageFShardArgument(argument));
  const ci=Boolean(process.env.CI);
  const projects=[...new Set(rawList('package-f',files,[],ci).map(row=>row.project))];
  assert.ok(projects.length>0,'No discovered Package F projects');
  const shard=Number(argument.match(/^--shard=(\d+)\//u)?.[1]);
  const selected=balanceBrowserCases(rawList('package-f',files,[],ci))[shard-1];
  const lists=projects.flatMap(project=>{
    const rows=selected.filter(row=>row.project===project);if(!rows.length)return [];
    const list=testListFile(rows);
    // Native list parser must select exactly these full identities before run.
    assert.deepEqual(rawList('package-f',files,[`--project=${project}`,'--test-list',list.file],ci).map(r=>r.key).sort(),rows.map(r=>r.key).sort());
    return [{args:[playwrightCli,'test','--config','playwright.ci.config.ts',`--project=${project}`,'--test-list',list.file,...files],dispose:list.dispose}];
  });
  return lists;
}
