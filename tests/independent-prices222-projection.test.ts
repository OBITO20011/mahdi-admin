import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {sourceBeforeIndependentPrices222,pathsBeforeIndependentPrices222} from '../scripts/audit/source-before-independent-prices222.mjs';
import {assertMigrationNumbering} from '../scripts/agent/migration-numbering.mjs';

test('222 exact inverse preserves historical text and never hides an unknown byte',()=>{
 const file='src/services/supabase/products.service.ts',raw=readFileSync(file,'utf8').replaceAll('\r\n','\n');
 const before=execFileSync('git',['show','bd4d696af6eef074bfd523ee54906059a0bb668c:'+file],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');
 assert.equal(sourceBeforeIndependentPrices222(file,raw),before);
 const changed=raw+'\n// UNKNOWN_BYTE';assert.equal(sourceBeforeIndependentPrices222(file,changed),changed);
 const added='src/utils/independentParcelPrices.ts',text=readFileSync(added,'utf8');
 assert.equal(sourceBeforeIndependentPrices222(added,text),null);
 assert.equal(sourceBeforeIndependentPrices222(added,text+'\n// UNKNOWN_BYTE'),text+'\n// UNKNOWN_BYTE');
 assert.deepEqual(pathsBeforeIndependentPrices222([added]),[]);
});

test('222 admits only the explicit221 reservation, never arbitrary gaps or a221 backfill',()=>{
 const state=JSON.parse(readFileSync('docs/agent/project-state.json','utf8'));
 const manifest=execFileSync('git',['ls-files','supabase/migrations'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/u).map(p=>p.split('/').at(-1)!).filter(p=>/^\d+_.+\.sql$/u.test(p)).sort();
 assert.equal(state.migrationCeiling,222);assert.deepEqual(state.ownerDeferredAccountingMigrationNumbers,[221]);
 assert.equal(assertMigrationNumbering(manifest,state).ceiling,222);
 assert.throws(()=>assertMigrationNumbering([...manifest.slice(0,-1),'221_unapproved.sql',manifest.at(-1)!],state),/OWNER_DEFERRED_ACCOUNTING221/);
 assert.throws(()=>assertMigrationNumbering(manifest,{...state,ownerDeferredAccountingMigrationNumbers:[]}),/ACCOUNTING221_RESERVATION_REQUIRED/);
 assert.throws(()=>assertMigrationNumbering([...manifest,'223_unknown.sql'],state),/MIGRATION_GAP_OR_ABOVE_CEILING/);
});

test('222 product SQL is additive functions only with three authenticated public writers',()=>{
 const sql=readFileSync('supabase/migrations/222_independent_lite_parcel_prices.sql','utf8');
 assert.equal(sql.match(/CREATE FUNCTION /gu)?.length,4);
 assert.equal(sql.match(/GRANT EXECUTE ON FUNCTION /gu)?.length,3);
 assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION|(?:ALTER|CREATE|DROP)\s+(?:TABLE|TRIGGER|POLICY|SCHEMA|INDEX)/iu);
 assert.doesNotMatch(sql,/GRANT[^;]*TO\s+(?:PUBLIC|anon|service_role)/iu);
 for(const name of ['update_product_master_v6','create_product_with_opening_stock_v6','create_product_family_with_flavors_v3'])assert.ok(sql.includes('CREATE FUNCTION public.'+name+'('));
});
