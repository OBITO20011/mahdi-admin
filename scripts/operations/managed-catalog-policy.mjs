// Owner2026-10-15: comparison policy ONLY,never SQL repair or permission changes.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {catalogDifference,normalizeRealtimePartitions} from '../testing/schema-catalog.mjs';
import {heldTrigger,isExpectedHeldTriggerDifference} from './frankfurt-notification-hold.mjs';
import {canonicalDefinitionLf} from '../testing/maintenance-db-contract.mjs';
export const platformSchemas=new Set(['auth','storage','realtime','_realtime','extensions','supabase_functions','cron','net','vault','graphql','graphql_public']);
const words={a:'INSERT',r:'SELECT',w:'UPDATE',d:'DELETE',D:'TRUNCATE',x:'REFERENCES',t:'TRIGGER',m:'MAINTAIN',U:'USAGE',X:'EXECUTE',C:'CREATE'};
export const privilegeWords=Object.freeze(words);
const unquote=s=>s.startsWith('"')?s.slice(1,-1).replaceAll('""','"'):s;
const compare=(a,b)=>a<b?-1:a>b?1:0;
export function aclEntries(acl,row,section){
 let value=acl;
 if(value===null||value===undefined){
  value=section==='functions'?[`=X/${row.owner}`,`${row.owner}=X/${row.owner}`]:
   section==='defaultPrivileges'?[]:[`${row.owner}=${section==='schemas'?'UC':row.kind==='S'?'rwU':'arwdDxtm'}/${row.owner}`];
 }
 const entries=[];
 for(const item of value){
  const m=item.match(/^("(?:[^"]|"")*"|[^=]*)=([a-zA-Z*]*)\/("(?:[^"]|"")*"|[^/]+)$/u);
  assert.ok(m,'UNSUPPORTED_ACL_ITEM');
  const grantee=unquote(m[1])||'PUBLIC',grantor=unquote(m[3]);
  for(let i=0;i<m[2].length;i++){
   const code=m[2][i];assert.ok(words[code],'UNSUPPORTED_ACL_PRIVILEGE');
   const grantable=m[2][i+1]==='*';if(grantable)i++;
   entries.push({grantee,grantor,privilege:words[code],grantable});
  }
 }
 return entries.sort((a,b)=>compare(JSON.stringify([a.grantee,a.grantor,a.privilege]),JSON.stringify([b.grantee,b.grantor,b.privilege])));
}
// Historical090 removes LF+the street condition from087's CRLF body, retaining
// the preceding CR plus the removed line's CRLF: one CRCRLF boundary on Windows.
// Normalize only CR runs immediately followed by LF, not bare CR, SQL tokens,
// spaces or any other definition/owner/ACL/search_path difference.
const lf=text=>typeof text==='string'?canonicalDefinitionLf(text):text;
export function normalizeManagedCatalog(catalog,date){
 const result=date?normalizeRealtimePartitions(catalog,date):structuredClone(catalog);
 for(const [section,rows] of Object.entries(result))for(const row of rows??[]){
  if(['functions','triggers','policies'].includes(section))for(const key of ['definition','using','check'])if(key in row)row[key]=lf(row[key]);
  if('acl' in row)row.acl=aclEntries(row.acl,row,section).filter(e=>e.grantee!=='service_role');
  for(const column of row.columns??[])if('acl' in column)column.acl=aclEntries(column.acl??[],row,'columns').filter(e=>e.grantee!=='service_role');
 }
 return result;
}
const schemaOf=(section,row)=>section==='schemas'?row?.name:row?.schema;
function informational(d){
 if(d.section==='policies')return false; // All RLS policies,including020 storage policies,remain strict.
 if(d.section==='tables'&&d.before&&d.after&&
  (d.before.rls!==d.after.rls||d.before.forceRls!==d.after.forceRls))return false;
 const row=d.after??d.before,schema=schemaOf(d.section,row);
 if(d.section==='extensions'&&row?.name==='pg_net')return true;
 return platformSchemas.has(schema);
}
export function compareManagedCatalog(before,after,dates){
 const a=normalizeManagedCatalog(before,dates?.beforeBuildDate),b=normalizeManagedCatalog(after,dates?.afterBuildDate);
 const differences=catalogDifference(a,b);
 const expected=differences.filter(isExpectedHeldTriggerDifference);
 const platform=differences.filter(d=>!isExpectedHeldTriggerDifference(d)&&informational(d));
 const unexpected=differences.filter(d=>!isExpectedHeldTriggerDifference(d)&&!informational(d));
 const identity='http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer)';
 const api=catalog=>(catalog.functions??[]).filter(f=>f.schema==='net'&&f.identity===identity&&/\bRETURNS bigint\b/u.test(lf(f.definition))).length===1;
 const original=(a.triggers??[]).find(t=>t.schema==='public'&&t.table==='orders'&&t.name===heldTrigger);
 const held=(b.triggers??[]).find(t=>t.schema==='public'&&t.table==='orders'&&t.name===heldTrigger);
 return {expected,platform,unexpected,differences,netHttpPost:{identity,local:api(before),remote:api(after)},
  namedHold:!!original&&original.enabled==='O'&&!!held&&held.enabled==='D'&&isDeepStrictEqual({...original,enabled:'D'},held)};
}
export function assertManagedCatalog(before,after,dates){
 const r=compareManagedCatalog(before,after,dates);
 assert.equal(r.unexpected.length,0,'UNEXPECTED_APPLICATION_CATALOG_DIFFERENCES');
 assert.ok(r.namedHold,'NAMED_NOTIFICATION_TRIGGER_HOLD_REQUIRED');
 assert.ok(r.netHttpPost.local&&r.netHttpPost.remote,'NET_HTTP_POST_SIGNATURE_REQUIRED');
 return {expectedDifferenceCount:r.expected.length,section:'triggers',schema:'public',table:'orders',name:heldTrigger,before:'O',after:'D',platformInformationCount:r.platform.length};
}
