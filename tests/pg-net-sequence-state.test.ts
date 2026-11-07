import {execFileSync} from 'node:child_process';
import {sourceBeforePgNetSequenceState,restorePgNetStateSourceHashes} from '../scripts/audit/source-before-pg-net-sequence-state.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {capturePgNetSequenceState,planPgNetSequenceState,assertOwnedPgNetRestoreContainer,restorePgNetSequenceState,pgNetSequenceIdentitySql,pgNetRawStateSql} from '../scripts/backup/pg-net-sequence-state.mjs';
import {postgresDiagnostic} from '../scripts/backup/postgres-diagnostic.mjs';

const ext={name:'pg_net',version:'0.20.4',schema:'public',owner:'supabase_admin'};
const parameters={type:'bigint',start:'1',increment:'1',min:'1',max:'9223372036854775807',cache:'1',cycle:false};
const queueDefault="nextval('net.http_request_queue_id_seq'::regclass)";
function fixture(lastValue='3',isCalled=true){
 const identity={schema:'net',name:'http_request_queue_id_seq',kind:'S',persistence:'u',owner:ext.owner,parameters:{...parameters},extensions:['pg_net'],ownedBy:[{schema:'net',table:'http_request_queue',column:'id',type:'bigint',kind:'r',persistence:'u',owner:ext.owner,default:queueDefault,extensions:['pg_net']}]};
 return {catalog:{extensions:[{...ext}],tables:[{schema:'net',name:'http_request_queue_id_seq',kind:'S',persistence:'u',owner:ext.owner},{schema:'net',name:'http_request_queue',kind:'r',persistence:'u',owner:ext.owner,columns:[{name:'id',type:'bigint',default:queueDefault}]}],sequences:[{schema:'net',name:'http_request_queue_id_seq',start:1,increment:1,min:1,max:Number(parameters.max),cache:1,cycle:false}]},roles:[{name:ext.owner}],sequences:[{schema:'net',name:'http_request_queue_id_seq',value:isCalled?Number(lastValue):null}],pgNetSequenceState:{version:1,extension:{...ext},identity,state:{lastValue,isCalled}}};
}
test('raw pg_net evidence preserves called and uncalled values,including exact bigint',()=>{
 for(const [value,called] of [['1',false],['17',false],['3',true],['9223372036854775807',true]] as const){
  const p=planPgNetSequenceState(fixture(value,called));
  assert.deepEqual(p?.state,{lastValue:value,isCalled:called});
  assert.equal(p?.evidence,'raw-last-value-and-called');
 }
});
test('source capture reads only the fixed object and never calls setval or changes privileges',async()=>{
 const f=fixture('17',false),queries:string[]=[];
 const result=await capturePgNetSequenceState({query:async(sql:string)=>{
  queries.push(sql);return JSON.stringify(sql===pgNetSequenceIdentitySql?{extensions:[ext],sequences:[f.pgNetSequenceState.identity]}:f.pgNetSequenceState.state);
 }});
 assert.deepEqual(result,f.pgNetSequenceState);assert.deepEqual(queries,[pgNetSequenceIdentitySql,pgNetRawStateSql]);
 assert.doesNotMatch(queries.join('\n'),/\b(?:GRANT|REVOKE|ALTER|setval|nextval)\s*(?:\(|ON|ROLE)/iu);
});
test('legacy positive safe state is provable;null,missing,duplicate and rounded values fail closed',()=>{
 const f:any=fixture();delete f.pgNetSequenceState;
 assert.deepEqual(planPgNetSequenceState(f)?.state,{lastValue:'3',isCalled:true});
 for(const value of [null,undefined,0,-1,3.5,Number.MAX_SAFE_INTEGER+1,'3']){
  const b=structuredClone(f);b.sequences[0].value=value;assert.throws(()=>planPgNetSequenceState(b));
 }
 for(const rows of [[],[...f.sequences,...f.sequences]])assert.throws(()=>planPgNetSequenceState({...f,sequences:rows}));
});
test('wrong name,owner,extension,member,column,type,range or missing raw evidence is rejected',()=>{
 const mutations:Array<(f:any)=>void>=[
 f=>{f.pgNetSequenceState=null;},f=>{f.pgNetSequenceState.version=2;},
 f=>{f.catalog.tables[0].owner='postgres';},f=>{f.pgNetSequenceState.identity.name='other';},
 f=>{f.pgNetSequenceState.extension.version='0.99';},f=>{f.pgNetSequenceState.identity.extensions=[];},
 f=>{f.pgNetSequenceState.identity.ownedBy[0].table='other';},f=>{f.pgNetSequenceState.identity.parameters.type='integer';},
 f=>{f.pgNetSequenceState.state.lastValue='9223372036854775808';},f=>{f.pgNetSequenceState.state.lastValue="3');SELECT pg_sleep(1);--";},
 f=>{f.pgNetSequenceState.state.lastValue=3;},f=>{delete f.pgNetSequenceState.state.isCalled;},
 f=>{f.sequences[0].value=null;},f=>{f.catalog.sequences[0].cache=2;},
 ];
 for(const mutate of mutations){const f=fixture();mutate(f);assert.throws(()=>planPgNetSequenceState(f));}
 assert.equal(planPgNetSequenceState({catalog:{extensions:[],tables:[]}}),null);
 assert.throws(()=>planPgNetSequenceState({...fixture(),catalog:{...fixture().catalog,extensions:[]}}));
});
test('setval target is this process exact running network-none Docker ID with no mounts/ports',()=>{
 const target={container:'nawasrah-full-restore-'+process.pid+'-0123abcd',containerId:'a'.repeat(64),port:25435};
 const inspected={Id:target.containerId,Name:'/'+target.container,State:{Running:true},HostConfig:{NetworkMode:'none',PortBindings:{}},Mounts:[]};
 assert.doesNotThrow(()=>assertOwnedPgNetRestoreContainer(target,inspected));
 for(const mutate of [(r:any)=>r.Id='b'.repeat(64),(r:any)=>r.Name='/another',(r:any)=>r.State.Running=false,(r:any)=>r.HostConfig.NetworkMode='bridge',(r:any)=>r.HostConfig.PortBindings={'5432/tcp':[{}]},(r:any)=>r.Mounts=[{Type:'bind'}]]){
  const r=structuredClone(inspected);mutate(r);assert.throws(()=>assertOwnedPgNetRestoreContainer(target,r));
 }
 for(const changed of [{container:'owner-db'},{containerId:null},{port:5433},{container:'nawasrah-full-restore-999999-0123abcd'}])assert.throws(()=>assertOwnedPgNetRestoreContainer({...target,...changed},inspected));
});
test('unapproved executor or URL is never used and errors contain only fixed safe vocabulary',async()=>{
 let queried=false;
 const fake={query:async()=>{queried=true;throw new Error('private-token-123');},connection:'postgresql://private-token-123@host/db'};
 await assert.rejects(restorePgNetSequenceState(fake,fixture()),error=>{
  const d=postgresDiagnostic(error);assert.equal(d.category,'RESTORE_PG_NET_SEQUENCE_STATE_UNSUPPORTED');assert.equal(d.stage,'restore-pg-net-sequence-state');
  assert.doesNotMatch(JSON.stringify(error),/private-token|postgresql/iu);return true;
 });
 assert.equal(queried,false);
});
test('strict comparator and owner reset/build/connection guards remain byte-identical to approved main',()=>{
 const pins=JSON.parse(readFileSync(new URL('../scripts/testing/fixtures/pg-net-state-protected-sources.json',import.meta.url),'utf8'));
 assert.match(pins.baseline,/^[a-f0-9]{40}$/u);
 for(const [file,expected]of Object.entries(pins.files)){
  const actual=createHash('sha256').update(readFileSync(file)).digest('hex');assert.equal(actual,expected,file);
 }
});

test('state-repair historical view recognizes exact approved bytes only;unknown mutations stay visible',()=>{
 const baseline='01d4b036136304876da1be8b701cff9e342e3b4d';
 const old=['tests/record-order-source-contracts.test.ts','tests/workbook-integration-history.test.ts','scripts/backup/complete-backup.mjs','scripts/backup/postgres-diagnostic.mjs','scripts/testing/run-dual-backup-runtime.mjs'];
 const added=['scripts/backup/pg-net-sequence-state.mjs','scripts/testing/pg-net-sequence-runtime.mjs','scripts/testing/fixtures/pg-net-state-protected-sources.json'];
 const lf=(v:string)=>v.replaceAll('\r\n','\n');
 const hash=(v:string)=>createHash('sha256').update(lf(v)).digest('hex');
 for(const file of [...old,...added]){
  const raw=readFileSync(file,'utf8');
  const before=old.includes(file)?execFileSync('git',['show',baseline+':'+file],{encoding:'utf8',windowsHide:true}):null;
  assert.equal(sourceBeforePgNetSequenceState(file,raw),before===null?null:lf(before),file);
  const unknown=raw+'\n// unapproved state-repair mutation';
  assert.equal(sourceBeforePgNetSequenceState(file,unknown),unknown,file);
  assert.deepEqual(restorePgNetStateSourceHashes([{file,sha256:hash(raw)}]),before===null?[]:[{file,sha256:hash(before)}]);
  assert.deepEqual(restorePgNetStateSourceHashes([{file,sha256:'unknown'}]),[{file,sha256:'unknown'}]);
 }
});
