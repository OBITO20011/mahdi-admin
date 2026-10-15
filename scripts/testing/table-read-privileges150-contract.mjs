import assert from 'node:assert/strict';
import {aclEntries} from '../operations/managed-catalog-policy.mjs';
import {catalogDifference} from './schema-catalog.mjs';

// Named owner-approved proposal, not an automatically expanding discovery list.
export const readTables150=Object.freeze([
 'branches','brands','categories','customer_addresses','customers',
 'inventory_balances','inventory_movements','order_items','order_status_history',
 'orders','product_images','products','profiles','purchase_order_items',
 'purchase_orders','purchase_receipt_items','purchase_receipts','roles',
 'supplier_payments','supplier_receipt_items','supplier_receipts','suppliers',
 'units','user_roles','warehouses',
]);
export const removed150=Object.freeze(['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']);
const clients=['anon','authenticated'];
const atoms=(row,section)=>aclEntries(row.acl,row,section).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'));
export function verify150Catalog(before,after){
 const expected=structuredClone(before),changes=[];
 for(const table of readTables150){
  const old=before.tables.find(r=>r.schema==='public'&&r.name===table);
  const now=after.tables.find(r=>r.schema==='public'&&r.name===table);
  assert.ok(old&&now,'MISSING150TABLE:'+table);assert.equal(now.rls,true,'RLS_REQUIRED:'+table);
  const wanted=atoms(old,'tables').filter(a=>!(clients.includes(a.grantee)&&removed150.includes(a.privilege)));
  for(const grantee of table==='orders'?['authenticated','service_role']:['authenticated']){
   if(!wanted.some(a=>a.grantee===grantee&&a.privilege==='SELECT'))wanted.push({grantee,grantor:'postgres',privilege:'SELECT',grantable:false});
  }
  wanted.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'));
  assert.deepEqual(atoms(now,'tables'),wanted,'EXACT150ACL:'+table);
  expected.tables.find(r=>r.schema==='public'&&r.name===table).acl=now.acl;
  changes.push(table);
 }
 const old=before.defaultPrivileges.find(r=>r.schema==='public'&&r.role==='postgres'&&r.type==='r');
 const now=after.defaultPrivileges.find(r=>r.schema==='public'&&r.role==='postgres'&&r.type==='r');
 assert.ok(old&&now,'PUBLIC_POSTGRES_TABLE_DEFAULT_REQUIRED');
 assert.deepEqual(atoms(now,'defaultPrivileges'),atoms(old,'defaultPrivileges').filter(a=>!clients.includes(a.grantee)),'EXACT150DEFAULTS');
 expected.defaultPrivileges.find(r=>r.schema==='public'&&r.role==='postgres'&&r.type==='r').acl=now.acl;
 // Everything else literal:column grants,RLS,functions/EXECUTE,sequences,owners,
 // other tables/defaults,service_role privileges (except orders SELECT).
 assert.deepEqual(catalogDifference(expected,after),[],'UNAPPROVED150CATALOG_CHANGE');
 return {tableAcls:changes.length,clientReads:25,serviceReads:1,revokePairs:200,otherCatalogDifferences:0};
}
