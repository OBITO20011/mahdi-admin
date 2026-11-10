// Generate independent220 tools from hash-frozen219 sources. Never modify an
// owner219 entrypoint/core or patch PostgreSQL function bodies at runtime.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {sha256,canonicalLf} from './maintenance-db-contract.mjs';
assert.ok(process.argv.length===2||process.argv.length===3&&process.argv[2]==='--check','ONLY_CHECK_OPTION');
const check=process.argv.includes('--check'),root=new URL('../../',import.meta.url),pins=JSON.parse(await readFile(new URL('docs/design/sales-only-phase1/frozen-source.json',root),'utf8'));
const files=new Map();
async function source(name){const file='scripts/operations/'+name+'.mjs',text=canonicalLf(await readFile(new URL(file,root),'utf8'));assert.equal(sha256(text),pins.files[file]?.sha256,'FROZEN219_TOOL_SOURCE_DRIFT:'+file);return text;}
const once=(s,from,to)=>{assert.equal(s.split(from).length,2,'EXACT220_TOOL_HUNK:'+from.slice(0,75));return s.replace(from,()=>to);};
const all=(s,from,to,count)=>{assert.equal(s.split(from).length-1,count,'EXACT220_TOOL_HUNK_COUNT:'+from.slice(0,60));return s.split(from).join(to);};
const schemaSet="('public','sales_lite1','sales_lite2')",ns=`(SELECT oid FROM pg_namespace WHERE nspname IN${schemaSet})`;
let foundation=await source('trial-reset-core');
foundation=once(foundation,'export const resetCeiling=182;','export const resetCeiling=220;');
foundation=once(foundation,'217:179,219:180});','217:179,219:180,220:181});');
foundation=once(foundation,'roles:0,storefront_settings:1,units:11,warehouses:0});',"roles:0,storefront_settings:1,units:11,warehouses:0,'sales_lite1.mode':1});");
foundation=once(foundation,"FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LOOP\n EXECUTE format('SELECT count(*) FROM public.%I',r.tablename) INTO n;v=v||jsonb_build_object(r.tablename,n);END LOOP;",`FOR r IN SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN${schemaSet} ORDER BY schemaname,tablename LOOP
 EXECUTE format('SELECT count(*) FROM %I.%I',r.schemaname,r.tablename) INTO n;v=v||jsonb_build_object(CASE WHEN r.schemaname='public' THEN r.tablename ELSE r.schemaname||'.'||r.tablename END,n);END LOOP;`);
foundation=once(foundation,'DO $rebuild$ DECLARE r record;BEGIN','DROP SCHEMA sales_lite2 CASCADE;DROP SCHEMA sales_lite1 CASCADE;\n DO $rebuild$ DECLARE r record;BEGIN');
foundation=once(foundation,"if(row.schema!=='public')continue;",`if(!['public','sales_lite1','sales_lite2'].includes(row.schema))continue;`);
foundation=once(foundation,"r.schema==='public'&&(section==='functions'?",'r.schema===row.schema&&(section===\'functions\'?');
foundation=once(foundation,"target='FUNCTION public.'+row.identity;","target='FUNCTION '+ident(row.schema)+'.'+row.identity;");
foundation=once(foundation,"(row.kind==='S'?'SEQUENCE ':'TABLE ')+'public.'+ident(row.name)","(row.kind==='S'?'SEQUENCE ':'TABLE ')+ident(row.schema)+'.'+ident(row.name)");
const depStart=foundation.indexOf('export const externalDependentsSql='),depEnd=foundation.indexOf('export function assertExternalDependents',depStart);assert.ok(depStart>0&&depEnd>depStart);
let dep=foundation.slice(depStart,depEnd);
for(const column of ['relnamespace','pronamespace','typnamespace'])dep=once(dep,`WHERE ${column}='public'::regnamespace`,`WHERE ${column} IN${ns}`);
dep=once(dep,'\n), edges AS (',"\n UNION SELECT 'pg_namespace'::regclass::oid,oid,0 FROM pg_namespace WHERE nspname IN('sales_lite1','sales_lite2')\n), edges AS (");
dep=once(dep,"FROM objects WHERE object_schema IS DISTINCT FROM 'public'",`FROM objects WHERE (object_schema IS NULL OR object_schema NOT IN${schemaSet})`);
dep=once(dep,"objid='public'::regnamespace)",`objid IN${ns})`);
dep=once(dep,"WHERE defaclnamespace='public'::regnamespace)",`WHERE defaclnamespace IN${ns})`);
foundation=foundation.slice(0,depStart)+dep+foundation.slice(depEnd);files.set('reset220-foundation',foundation);
let guard=await source('reset214-write-guard');guard=once(guard,"from './trial-reset-core.mjs'","from './reset220-foundation.mjs'");
guard=all(guard,"FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LOOP",`FOR r IN SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN${schemaSet} ORDER BY schemaname,tablename LOOP`,2);
guard=once(guard,"FROM public.%I t',r.tablename)","FROM %I.%I t',r.schemaname,r.tablename)");
guard=once(guard,'jsonb_build_object(r.tablename,jsonb_build_object',"jsonb_build_object(CASE WHEN r.schemaname='public' THEN r.tablename ELSE r.schemaname||'.'||r.tablename END,jsonb_build_object");
guard=once(guard,"SELECT c.oid,c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace",`SELECT c.oid,c.relname,n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN${schemaSet}`);
guard=all(guard,"ON public.%I FOR","ON %I.%I FOR",2);guard=all(guard,"reset214_guard.observe()',r.relname);","reset214_guard.observe()',r.nspname,r.relname);",2);
guard=once(guard,"SELECT c.relname,t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace",`SELECT c.relname,n.nspname,t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN${schemaSet}`);
guard=once(guard,"DROP TRIGGER %I ON public.%I',r.tgname,r.relname)","DROP TRIGGER %I ON %I.%I',r.tgname,r.nspname,r.relname)");
guard=once(guard,"LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',r.tablename)","LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE',r.schemaname,r.tablename)");
guard=once(guard,'const metadata=new Set([...Object.keys(cleanSeedCounts),\'profiles\',\'user_roles\']);',`const metadata=new Set([...Object.keys(cleanSeedCounts),'profiles','user_roles']);
 if(observed['sales_lite1.mode']?.rows){assert.equal(observed['sales_lite1.mode'].rows,1,'RESET220_PRIVATE_MODE_ROWS');assert.deepEqual(JSON.parse(await read('SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM sales_lite1.mode m;')),[{id:true,full_accounting:true}],'RESET220_PRIVATE_MODE_SEED_CHANGED');}`);
files.set('reset220-write-guard',guard);
let privateState=await source('reset214-private-state');privateState=once(privateState,"path.join(workdir,'reset214-private')","path.join(workdir,'reset220-private')");files.set('reset220-private-state',privateState);
let session=await source('reset214-session');session=once(session,"from './reset214-private-state.mjs'","from './reset220-private-state.mjs'");session=once(session,"from './reset214-write-guard.mjs'","from './reset220-write-guard.mjs'");session=once(session,"from './trial-reset-core.mjs'","from './reset220-foundation.mjs'");
session=once(session,"export const reset219Marker='RESET219_IN_PROGRESS.json';","export const reset219Marker='RESET219_IN_PROGRESS.json';\nexport const reset220Marker='RESET220_IN_PROGRESS.json';");
session=once(session,'217:reset217Marker,219:reset219Marker});','217:reset217Marker,219:reset219Marker,220:reset220Marker});');files.set('reset220-session',session);
let core=await source('trial-reset214-core');
core=once(core,"from './trial-reset-core.mjs'","from './reset220-foundation.mjs'");core=once(core,"from './reset214-session.mjs'","from './reset220-session.mjs'");core=once(core,"from './reset214-write-guard.mjs'","from './reset220-write-guard.mjs'");
for(const version of [214,215,216,217,219])core=once(core,`import {assertReady${version}Catalog} from './frankfurt-reference${version}.mjs';\n`,'');
core="// Independent220 engine: literal219 engine plus pinned private-schema scope.\nimport {assertReady220Catalog} from './frankfurt-reference220.mjs';\n"+core;
const pStart=core.indexOf('const policy214='),pEnd=core.indexOf('async function captureRetainedReset',pStart);assert.ok(pEnd>pStart);
core=core.slice(0,pStart)+`const policy220={ceiling:220,files:181,assertCatalog:catalog=>assertReady220Catalog(catalog,{notificationTriggerEnabled:'D'})};
export const captureReset220=options=>{assertCurrentResetReference(options.reference);return captureRetainedReset(options,policy220);};
`+core.slice(pEnd);
const eStart=core.indexOf('export const reset214WithExecutor='),eEnd=core.indexOf('async function runRetainedReset',eStart);assert.ok(eEnd>eStart);
core=core.slice(0,eStart)+`export const reset220WithExecutor=options=>{assertCurrentResetReference(options.reference);return runRetainedReset(options,policy220);};
`+core.slice(eEnd);
for(const [from,to]of [['verifyExistingReset219Cron','verifyExistingReset220Cron'],['guardedReset219CronUnits','guardedReset220CronUnits'],['verifyReset219MigrationManifest','verifyReset220MigrationManifest'],["'./reset219-pg-cron-guard.mjs'","'./reset220-pg-cron-guard.mjs'"],['policy.ceiling===219','policy.ceiling===220']]){assert.ok(core.includes(from));core=core.split(from).join(to);}
core=once(core,'{assertCurrentResetReference,assertSupportedResetReference}','{assertCurrentResetReference}');
files.set('trial-reset220-core',core);
for(const[name,text]of files){const target=new URL('scripts/operations/'+name+'.mjs',root);const result='// Generated by scripts/testing/build-reset220-engine.mjs;219 source files are unchanged.\n'+text;if(check)assert.equal(canonicalLf(await readFile(target,'utf8')),result,'GENERATED_RESET220_DRIFT:'+name);else await writeFile(target,result);}
console.log(JSON.stringify({ok:true,checkOnly:check,files:[...files.keys()],frozen219SourcesUnchanged:true,privateDropScope:['sales_lite1','sales_lite2']}));
