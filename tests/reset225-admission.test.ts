import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {reset225Arguments} from '../scripts/operations/frankfurt-owner-reset225.mjs';
import {assertReset225DdlCapability,reset225DdlCapabilitySql} from '../scripts/operations/reset225-ddl-capability.mjs';
import {assertCleanCounts,cleanSeedCounts} from '../scripts/operations/reset225-foundation.mjs';
import {reset224Marker,reset225Marker} from '../scripts/operations/reset225-session.mjs';

test('RESET225 requires its own reference and retains the prior unfinished-attempt marker',()=>{
 assert.equal(reset224Marker,'RESET224_IN_PROGRESS.json');
 assert.equal(reset225Marker,'RESET225_IN_PROGRESS.json');
 assert.equal(reset225Arguments([]).mode,'plan');
 assert.throws(()=>reset225Arguments(['--apply']),/OWNER_UUID_REQUIRED/u);
 assert.throws(()=>reset225Arguments(['--reference','local-reference-through224-ready.json']),/REFERENCE_NAME_REQUIRED/u);
 assert.throws(()=>reset225Arguments(['--plan','--apply']),/ONE_MODE_REQUIRED/u);
 assert.throws(()=>reset225Arguments(['--db-url','forbidden']),/UNKNOWN_OPTION/u);
});

test('RESET225 has the same read-only DDL capability admission and rejects a missing policy capability',()=>{
 assert.match(reset225DdlCapabilitySql,/^BEGIN READ ONLY;/u);
 assert.match(reset225DdlCapabilitySql,/ROLLBACK;$/u);
 assert.doesNotMatch(reset225DdlCapabilitySql,/\b(?:GRANT|ALTER|CREATE POLICY|DROP POLICY)\b/u);
 const checks={actor:true,storage_policy:true,database_create:true,public_create:true,rebuild_ownership:true,publication:true,platform_extensions:true};
 assert.doesNotThrow(()=>assertReset225DdlCapability({checks,deniedObjects:[]}));
 for(const key of Object.keys(checks))assert.throws(()=>assertReset225DdlCapability({checks:{...checks,[key]:false},deniedObjects:[]}),/DDL_CAPABILITY_REQUIRED/u);
 assert.throws(()=>assertReset225DdlCapability({checks,deniedObjects:['storage.objects']}),/DDL_CAPABILITY_REQUIRED/u);
});

test('RESET225 requires its pricing decisions empty along with all business rows',()=>{
 const counts={...cleanSeedCounts,branches:1,warehouses:1,roles:1,profiles:1,user_roles:1,product_sale_pricing_state225:0};
 assert.doesNotThrow(()=>assertCleanCounts(counts,true,true,true));
 assert.throws(()=>assertCleanCounts({...counts,product_sale_pricing_state225:1},true,true,true),/RESET_ROW_COUNT:product_sale_pricing_state225/u);
});

test('versioned225 protection starts from exact reviewed224 sources without changing their bytes',()=>{
 const pins=JSON.parse(readFileSync('docs/design/on-independent-prices225/protection224-template-pins.json','utf8'));
 assert.equal(Object.keys(pins.templates).length,9);
 for(const entry of Object.values(pins.templates) as {source:string;sourceSha256:string;initialTargetSha256:string}[]){
  const source=readFileSync('scripts/operations/'+entry.source,'utf8').replace(/\r\n/gu,'\n');
  assert.equal(createHash('sha256').update(source).digest('hex'),entry.sourceSha256,entry.source);
 }
});
