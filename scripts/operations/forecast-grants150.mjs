// Offline ACL forecast only. No SQL or function-definition replacement. The
// same prediction is checked against literal150 on real PostgreSQL in rehearsal.
import assert from 'node:assert/strict';
import {aclEntries} from './managed-catalog-policy.mjs';
import {toAcl} from './frankfurt-acl-plan.mjs';
import {readTables150,removed150,verify150Catalog} from '../testing/table-read-privileges150-contract.mjs';
export function forecast150(catalog){
 const result=structuredClone(catalog);
 for(const name of readTables150){
  const row=result.tables.find(t=>t.schema==='public'&&t.name===name);assert.ok(row,'FORECAST150_TABLE_REQUIRED');
  const entries=aclEntries(row.acl,row,'tables').filter(a=>!(['anon','authenticated'].includes(a.grantee)&&removed150.includes(a.privilege)));
  for(const grantee of name==='orders'?['authenticated','service_role']:['authenticated'])
   if(!entries.some(a=>a.grantee===grantee&&a.privilege==='SELECT'))entries.push({grantee,grantor:'postgres',privilege:'SELECT',grantable:false});
  row.acl=toAcl(entries);
 }
 const row=result.defaultPrivileges.find(t=>t.schema==='public'&&t.role==='postgres'&&t.type==='r');assert.ok(row,'FORECAST150_DEFAULTS_REQUIRED');
 row.acl=toAcl(aclEntries(row.acl,row,'defaultPrivileges').filter(a=>!['anon','authenticated'].includes(a.grantee)));
 verify150Catalog(catalog,result);return result;
}
