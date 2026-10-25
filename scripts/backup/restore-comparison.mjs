import {isDeepStrictEqual} from 'node:util';
import {logicalRestoreDifferences} from '../testing/backup-restore-contract.mjs';
import {classifiedError,RESTORE_COMPARISON_CODES} from './postgres-diagnostic.mjs';

export const COMPARISON_CODES=RESTORE_COMPARISON_CODES;
const sections=['schemas','tables','constraints','indexes','functions','policies','triggers','defaultPrivileges','sequences','extensions'];
const catalogFields=['schema','name','identity','table','role','type','owner','acl','rls','forceRls','persistence','options','replicaIdentity','partition','parents','view','columns','definition','validated','deferrable','initiallyDeferred','onUpdate','onDelete','match','local','noInherit','inheritanceCount','valid','ready','primary','unique','clustered','configuration','kind','command','permissive','roles','using','check','enabled','start','increment','max','min','cache','cycle','version'];
const roleFields=['super','inherit','createRole','createDb','login','replication','bypassRls','limit','until','config'];
const memberFields=['role','member','grantor','admin','inherit','set'];
const equal=isDeepStrictEqual;
const name=v=>typeof v==='string'&&/^[\p{L}\p{N}_.$-]{1,256}$/u.test(v)?v:'[unavailable-name]';
const fields=(a,b,allowed)=>allowed.filter(k=>!equal(a?.[k],b?.[k]));
const presence=(a,b)=>a===undefined||a===null?'only-after':b===undefined||b===null?'only-before':'changed';
const rowCount=v=>Number.isSafeInteger(v)&&v>=0?v:typeof v==='string'&&/^\d{1,24}$/u.test(v)?v:null;
const countDiff=(a,b)=>({before:rowCount(a),after:rowCount(b)});
function mappedRows(before=[],after=[],key){
  const a=new Map((before??[]).map(r=>[key(r),r])),b=new Map((after??[]).map(r=>[key(r),r]));
  return [...new Set([...a.keys(),...b.keys()])].flatMap(k=>equal(a.get(k),b.get(k))?[]:[{a:a.get(k),b:b.get(k)}]);
}
export function buildRestoreComparison(before,after){
  // Raw differences may contain full SQL bodies/ACL/settings. They never leave RAM.
  const rawCatalog=logicalRestoreDifferences(before.catalog,after.catalog);
  const failedComparisons=[];
  if(rawCatalog.length)failedComparisons.push(COMPARISON_CODES[0]);
  for(const [index,key]of ['tables','roles','memberships','history','sequences','storage'].entries())if(!equal(after[key],before[key]))failedComparisons.push(COMPARISON_CODES[index+1]);
  const catalog=rawCatalog.map(d=>{
    const r=d.before??d.after??{},changed=fields(d.before,d.after,catalogFields);
    return {type:sections.includes(d.section)?d.section:'unknown',...(r.schema?{schema:name(r.schema)}:{}),name:name(r.name??r.identity?.split('(')[0]??r.table??r.role),...(r.table?{table:name(r.table)}:{}),...(r.role?{role:name(r.role)}:{}),change:presence(d.before,d.after),fields:changed};
  });
  const tableKeys=new Set([...Object.keys(before.tables??{}),...Object.keys(after.tables??{})]);
  const tables=[...tableKeys].flatMap(k=>{
    const a=before.tables?.[k],b=after.tables?.[k];if(equal(a,b))return [];
    return [{name:name(k),change:presence(a,b),rows:countDiff(a?.rows,b?.rows),hashDifferent:a?.hash!==b?.hash}];
  });
  const roles=mappedRows(before.roles,after.roles,r=>r.name).map(({a,b})=>({name:name((a??b).name),change:presence(a,b),fields:fields(a,b,roleFields)}));
  const memberships=mappedRows(before.memberships,after.memberships,r=>JSON.stringify([r.role,r.member,r.grantor])).map(({a,b})=>({role:name((a??b).role),member:name((a??b).member),grantor:name((a??b).grantor),change:presence(a,b),fields:fields(a,b,memberFields)}));
  const sequences=mappedRows(before.sequences,after.sequences,r=>JSON.stringify([r.schema,r.name])).map(({a,b})=>({schema:name((a??b).schema),name:name((a??b).name),change:presence(a,b),fields:fields(a,b,['value','last_value','is_called'])}));
  // Storage rows and history are data:only mismatch/count information is emitted.
  const summary=(a,b)=>({different:!equal(a,b),beforeCount:Array.isArray(a)?a.length:null,afterCount:Array.isArray(b)?b.length:null});
  return {formatVersion:1,policy:'names-field-names-counts-only-no-data-values-no-hashes-no-sql-no-acl-values',ok:failedComparisons.length===0,failedComparisons,catalog,tables,roles,memberships,sequences,history:summary(before.history,after.history),storage:summary(before.storage,after.storage),orderOnly:{roles:!equal(before.roles,after.roles)&&roles.length===0,memberships:!equal(before.memberships,after.memberships)&&memberships.length===0,sequences:!equal(before.sequences,after.sequences)&&sequences.length===0}};
}
export function assertStrictRestoreComparison(before,after){
  const comparison=buildRestoreComparison(before,after);
  if(!comparison.ok){
    const error=classifiedError('RESTORE_COMPARISON_FAILED',{tool:'internal',stage:'compare-data-catalog-acl',comparisonCode:comparison.failedComparisons[0]});
    // This object was freshly constructed from fixed fields;it contains no raw diff.
    error.comparison=comparison;throw error;
  }
  return {allRowsAndHashesMatch:true,allSequencesMatch:true,rolesAndMembershipsMatch:true,catalogAclOwnerSettingsMatch:true,historyMatch:true,storageMetadataMatch:true};
}
