// Fixed pg_net sequence evidence. Source reads never grant privileges or call setval.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {SnapshotSession} from './snapshot-session.mjs';
import {classifiedError} from './postgres-diagnostic.mjs';

const exec=promisify(execFile);
const schema='net',name='http_request_queue_id_seq';
const parameters=Object.freeze({type:'bigint',start:'1',increment:'1',min:'1',max:'9223372036854775807',cache:'1',cycle:false});
const queueDefault="nextval('net.http_request_queue_id_seq'::regclass)";
const readJson=async(session,sql)=>JSON.parse((await session.query(sql)).trim());
export const pgNetSequenceIdentitySql=String.raw`SELECT jsonb_build_object(
 'extensions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname,'owner',pg_get_userbyid(e.extowner))),'[]') FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_net'),
 'sequences',(SELECT coalesce(jsonb_agg(jsonb_build_object(
 'schema',n.nspname,'name',c.relname,'kind',c.relkind,'persistence',c.relpersistence,'owner',pg_get_userbyid(c.relowner),
 'parameters',jsonb_build_object('type',format_type(s.seqtypid,NULL),'start',s.seqstart::text,'increment',s.seqincrement::text,'min',s.seqmin::text,'max',s.seqmax::text,'cache',s.seqcache::text,'cycle',s.seqcycle),
 'extensions',(SELECT coalesce(jsonb_agg(e.extname ORDER BY e.extname),'[]') FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.objsubid=0 AND d.refclassid='pg_extension'::regclass AND d.deptype='e'),
 'ownedBy',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',tn.nspname,'table',t.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'kind',t.relkind,'persistence',t.relpersistence,'owner',pg_get_userbyid(t.relowner),'default',pg_get_expr(ad.adbin,ad.adrelid),
 'extensions',(SELECT coalesce(jsonb_agg(e.extname ORDER BY e.extname),'[]') FROM pg_depend td JOIN pg_extension e ON e.oid=td.refobjid WHERE td.classid='pg_class'::regclass AND td.objid=t.oid AND td.objsubid=0 AND td.refclassid='pg_extension'::regclass AND td.deptype='e')) ORDER BY tn.nspname,t.relname,a.attname),'[]')
 FROM pg_depend d JOIN pg_class t ON t.oid=d.refobjid JOIN pg_namespace tn ON tn.oid=t.relnamespace JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid LEFT JOIN pg_attrdef ad ON ad.adrelid=t.oid AND ad.adnum=a.attnum
 WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.objsubid=0 AND d.refclassid='pg_class'::regclass AND d.deptype='a'))),'[]')
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_sequence s ON s.seqrelid=c.oid WHERE n.nspname='net' AND c.relname='http_request_queue_id_seq'));`;
export const pgNetRawStateSql="SELECT jsonb_build_object('lastValue',last_value::text,'isCalled',is_called) FROM net.http_request_queue_id_seq;";

function expectedIdentity(extension,owner){
 return {schema,name,kind:'S',persistence:'u',owner,parameters:{...parameters},extensions:['pg_net'],
  ownedBy:[{schema,table:'http_request_queue',column:'id',type:'bigint',kind:'r',persistence:'u',owner:extension.owner,default:queueDefault,extensions:['pg_net']}]};
}
function validateState(state){
 assert.equal(typeof state?.lastValue,'string','PGNET_EXACT_VALUE_REQUIRED');
 assert.match(state.lastValue,/^[1-9][0-9]{0,18}$/u,'PGNET_EXACT_VALUE_REQUIRED');
 const value=BigInt(state.lastValue);
 assert.ok(value>=BigInt(parameters.min)&&value<=BigInt(parameters.max),'PGNET_VALUE_OUT_OF_RANGE');
 assert.equal(typeof state.isCalled,'boolean','PGNET_CALLED_FLAG_REQUIRED');
 assert.deepEqual(Object.keys(state).sort(),['isCalled','lastValue']);
 return {lastValue:state.lastValue,isCalled:state.isCalled};
}
function one(rows,predicate,code){
 assert.ok(Array.isArray(rows),code);
 const found=rows.filter(predicate);assert.equal(found.length,1,code);return found[0];
}

export async function capturePgNetSequenceState(session){
 const actual=await readJson(session,pgNetSequenceIdentitySql);
 if(actual.extensions.length===0){assert.deepEqual(actual.sequences,[],'PGNET_UNEXPECTED_SEQUENCE');return null;}
 assert.equal(actual.extensions.length,1,'PGNET_EXTENSION_REQUIRED');
 const extension=actual.extensions[0];
 assert.equal(extension.name,'pg_net');
 assert.equal(actual.sequences.length,1,'PGNET_SEQUENCE_REQUIRED');
 const identity=actual.sequences[0];
 assert.deepEqual(identity,expectedIdentity(extension,extension.owner),'PGNET_IDENTITY_UNSUPPORTED');
 return {version:1,extension,identity,state:validateState(await readJson(session,pgNetRawStateSql))};
}

// No database IO: invalid or ambiguous old evidence is rejected before creating Docker.
export function planPgNetSequenceState(before){
 const extensions=before.catalog?.extensions??[];
 const ext=extensions.filter(e=>e.name==='pg_net');
 if(!ext.length){
  assert.ok(!before.catalog?.tables?.some(r=>r.schema===schema&&r.name===name),'PGNET_UNEXPECTED_SEQUENCE');
  assert.ok(!before.sequences?.some(r=>r.schema===schema&&r.name===name),'PGNET_UNEXPECTED_VALUE_EVIDENCE');
  assert.ok(before.pgNetSequenceState===undefined||before.pgNetSequenceState===null,'PGNET_UNEXPECTED_EVIDENCE');return null;
 }
 assert.equal(ext.length,1,'PGNET_EXTENSION_REQUIRED');const extension=ext[0];
 for(const key of ['version','schema','owner'])assert.ok(typeof extension[key]==='string'&&extension[key].length>0,'PGNET_EXTENSION_IDENTITY_REQUIRED');
 assert.ok(before.roles.some(r=>r.name===extension.owner),'PGNET_OWNER_REQUIRED');
 const sequence=one(before.catalog.tables,r=>r.schema===schema&&r.name===name,'PGNET_CATALOG_SEQUENCE_REQUIRED');
 assert.equal(sequence.kind,'S');assert.equal(sequence.persistence,'u');assert.equal(sequence.owner,extension.owner,'PGNET_OWNER_REQUIRED');
 const queue=one(before.catalog.tables,r=>r.schema===schema&&r.name==='http_request_queue','PGNET_QUEUE_REQUIRED');
 assert.equal(queue.kind,'r');assert.equal(queue.persistence,'u');assert.equal(queue.owner,extension.owner);
 const column=one(queue.columns,c=>c.name==='id','PGNET_OWNED_COLUMN_REQUIRED');
 assert.equal(column.type,'bigint');assert.equal(column.default,queueDefault);
 const metadata=one(before.catalog.sequences,r=>r.schema===schema&&r.name===name,'PGNET_PARAMETERS_REQUIRED');
 for(const key of ['start','increment','min','max','cache'])assert.equal(metadata[key],Number(parameters[key]),'PGNET_PARAMETERS_UNSUPPORTED');
 assert.equal(metadata.cycle,false);
 const identity=expectedIdentity(extension,sequence.owner);
 const old=one(before.sequences,r=>r.schema===schema&&r.name===name,'PGNET_VALUE_EVIDENCE_REQUIRED');
 let state,evidence;
 if(Object.hasOwn(before,'pgNetSequenceState')){
  const raw=before.pgNetSequenceState;
  assert.ok(raw&&raw.version===1,'PGNET_RAW_EVIDENCE_REQUIRED');
  assert.deepEqual(raw.extension,extension,'PGNET_EXTENSION_IDENTITY_DIFFER');
  assert.deepEqual(raw.identity,identity,'PGNET_IDENTITY_DIFFER');
  state=validateState(raw.state);evidence='raw-last-value-and-called';
  assert.equal(old.value,state.isCalled?Number(state.lastValue):null,'PGNET_SOURCE_VALUE_INCONSISTENT');
 }else{
  // pg_sequences exposes a positive last_value only after is_called=true.
  // Null also covers lack of privilege and arbitrary uncalled state:never infer it.
  assert.ok(Number.isSafeInteger(old.value)&&old.value>0,'PGNET_LEGACY_STATE_AMBIGUOUS');
  state=validateState({lastValue:String(old.value),isCalled:true});evidence='legacy-positive-value';
 }
 return {version:1,extension,identity,state,evidence};
}

function assertOwnedTarget(target){
 assert.match(target?.container,/^nawasrah-full-restore-[0-9]+-[a-f0-9]{8}$/u,'PGNET_OWNED_CONTAINER_REQUIRED');
 assert.ok(target.container.startsWith('nawasrah-full-restore-'+process.pid+'-'),'PGNET_OWN_PROCESS_REQUIRED');
 assert.match(target.containerId,/^[a-f0-9]{64}$/u,'PGNET_CONTAINER_ID_REQUIRED');
 assert.ok([5432,25435].includes(target.port),'PGNET_PRIVATE_SOCKET_PORT_REQUIRED');
}
export function assertOwnedPgNetRestoreContainer(target,inspected){
 assertOwnedTarget(target);
 assert.equal(inspected?.Id,target.containerId,'PGNET_CONTAINER_ID_DIFFER');
 assert.equal(inspected.Name,'/'+target.container,'PGNET_CONTAINER_NAME_DIFFER');
 assert.equal(inspected.State?.Running,true,'PGNET_CONTAINER_NOT_RUNNING');
 assert.equal(inspected.HostConfig?.NetworkMode,'none','PGNET_NETWORK_NONE_REQUIRED');
 assert.deepEqual(inspected.Mounts,[],'PGNET_NO_MOUNTS_REQUIRED');
 assert.deepEqual(inspected.HostConfig?.PortBindings??{},{} ,'PGNET_NO_PORT_BINDINGS_REQUIRED');
}

// The setter has no URL or caller-provided executor. Its own psql is created
// only after inspecting the exact ID returned by this Restore's docker run.
export async function restorePgNetSequenceState(target,before){
 let session;
 try{
  const plan=planPgNetSequenceState(before);
  if(!plan)return {checked:0,exactRawState:true,exceptionsApplied:[]};
  assertOwnedTarget(target);
  const inspected=JSON.parse((await exec('docker',['inspect',target.container],{windowsHide:true,timeout:30000,maxBuffer:2**20})).stdout);
  assert.equal(inspected.length,1);assertOwnedPgNetRestoreContainer(target,inspected[0]);
  session=new SnapshotSession('docker',['exec','-i',target.container,'psql','-h','/tmp/socket','-p',String(target.port),'-U','supabase_admin','-d','postgres','-X','-q','-A','-t','-w','-v','ON_ERROR_STOP=1']);
  const connection=await readJson(session,"SELECT jsonb_build_object('user',current_user,'session',session_user,'database',current_database(),'port',current_setting('port'),'address',inet_server_addr(),'socket',current_setting('unix_socket_directories'));");
  assert.deepEqual(connection,{user:'supabase_admin',session:'supabase_admin',database:'postgres',port:String(target.port),address:null,socket:'/tmp/socket'});
  const actual=await capturePgNetSequenceState(session);
  assert.deepEqual(actual.extension,plan.extension,'PGNET_TARGET_EXTENSION_DIFFER');
  assert.deepEqual(actual.identity,plan.identity,'PGNET_TARGET_IDENTITY_DIFFER');
  const {lastValue,isCalled}=plan.state;
  await session.query("SELECT pg_catalog.setval('net.http_request_queue_id_seq'::regclass,'"+lastValue+"'::bigint,"+String(isCalled)+");");
  const after=await capturePgNetSequenceState(session);
  assert.deepEqual(after,{version:1,extension:plan.extension,identity:plan.identity,state:plan.state},'PGNET_EXACT_STATE_POSTCONDITION');
  return {checked:1,evidence:plan.evidence,exactRawState:true,isolatedDockerOnly:true,exceptionsApplied:[]};
 }catch{
  throw classifiedError('RESTORE_PG_NET_SEQUENCE_STATE_UNSUPPORTED',{stage:'restore-pg-net-sequence-state',tool:'internal'});
 }finally{await session?.close().catch(()=>{});}
}
