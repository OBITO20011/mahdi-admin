// Owner10Nov: retain all eight prototype hunks;add only the approved summary leaf.
import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';
import{bridges as eight,bridgedSource as originalBridge,replaceDefinitionSource,sha256}from'./sales-only-phase1-bridges.mjs';
export{replaceDefinitionSource,sha256};
const pins=JSON.parse(readFileSync(new URL('../../docs/design/sales-only-phase1/frozen-functions.json',import.meta.url),'utf8'));
export const summaryBridge=Object.freeze({name:'build_business_summary',signature:'build_business_summary(text,date,date,timestamp with time zone)',
 from:'DECLARE v_result JSONB; BEGIN\n',to:'DECLARE v_result JSONB; BEGIN\n  IF sales_lite2.summary_uses_lite(p_period_start,p_period_end) THEN\n    RETURN sales_lite2.business_summary(p_summary_type,p_period_start,p_period_end,p_generated_at);\n  END IF;\n'});
export const bridges=Object.freeze([...eight,summaryBridge]);
export function bridgedSource(row){
 if(row.name!==summaryBridge.name)return originalBridge(row);
 assert.equal(row.signature,summaryBridge.signature,'SUMMARY_BRIDGE_EXACT_SIGNATURE');
 assert.equal(sha256(row.source),pins.functions[row.signature]?.sourceSha256,'SUMMARY_BRIDGE_BASE_CHANGED');
 assert.equal(row.source.split(summaryBridge.from).length,2,'SUMMARY_BRIDGE_EXACT_HUNK');
 return row.source.replace(summaryBridge.from,()=>summaryBridge.to);
}
export function summaryBridgeSql(rows){const r=rows.find(r=>r.signature===summaryBridge.signature);assert.ok(r);return replaceDefinitionSource(r.definition,r.source,bridgedSource(r)).trimEnd()+';';}
export function assertFrozenFunctions(before,after){
 assert.equal(before.length,636);assert.equal(new Set(before.map(r=>r.signature)).size,636);const actual=new Map(after.map(r=>[r.signature,r]));let unchanged=0;
 for(const row of before){const p=pins.functions[row.signature];assert.ok(p);assert.equal(sha256(row.source),p.sourceSha256);assert.equal(sha256(row.definition),p.definitionSha256);for(const k of['owner','config','acl'])assert.deepEqual(row[k],p[k]);
  const a=actual.get(row.signature);assert.ok(a);const expected=bridges.some(b=>b.name===row.name)?bridgedSource(row):row.source;
  assert.equal(a.source,expected,'FROZEN_SOURCE_CHANGED:'+row.signature);assert.equal(a.definition,replaceDefinitionSource(row.definition,row.source,expected),'FROZEN_DEFINITION_CHANGED:'+row.signature);
  for(const k of['owner','config','acl'])assert.deepEqual(a[k],row[k],'FROZEN_METADATA_CHANGED:'+row.signature+':'+k);if(expected===row.source)unchanged++;
 }
 assert.equal(unchanged,627);for(const r of after)assert.ok(pins.functions[r.signature]||r.name.startsWith('lite1_'),'UNAPPROVED_FUNCTION_ADDED:'+r.signature);
}
