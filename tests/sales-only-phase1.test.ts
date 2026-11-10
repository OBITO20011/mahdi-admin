import{pathsBeforeSalesOnlyPhase3}from'../scripts/audit/source-before-sales-only-phase3.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {bridges,bridgedSource,replaceDefinitionSource} from '../scripts/testing/sales-only-phase1-bridges.mjs';
import {assertFrozenSource,frozenSource,root} from '../scripts/testing/sales-only-phase1-freeze.mjs';
import {execFileSync} from 'node:child_process';
import {sourceBeforeSalesOnlyPhase1,salesOnlyPhase1Pins} from '../scripts/audit/source-before-sales-only-phase1.mjs';
import {sourceBeforeSalesOnlyPhase2} from '../scripts/audit/source-before-sales-only-phase2.mjs';

test('phase1 quarantine preserves every frozen application/Edge/owner-tool/migration source',()=>{
 assert.equal(frozenSource.baseline,'4f3d6409e284da89cc33972b3fac36e135bebd35');assertFrozenSource();
 const currentMigrations=readdirSync(path.join(root,'supabase/migrations')).filter(p=>/^\d+_.+\.sql$/.test(p)).map(p=>'supabase/migrations/'+p);
 assert.equal(currentMigrations.length,181);assert.equal(pathsBeforeSalesOnlyPhase3(currentMigrations).length,180);
 assert.equal(JSON.parse(sourceBeforeSalesOnlyPhase2('docs/agent/project-state.json',readFileSync(path.join(root,'docs/agent/project-state.json'),'utf8'))!).migrationCeiling,219);
 assert.ok(Object.keys(frozenSource.files).includes('scripts/operations/frankfurt-owner-reset219.mjs'));
 assert.ok(Object.keys(frozenSource.files).includes('supabase/functions/submit-guest-order/index.ts'));
});
test('negative: one byte/token change to a frozen writer is rejected',()=>{
 const target='supabase/migrations/214_handover_z_corrections.sql';
 assert.throws(()=>assertFrozenSource(p=>readFileSync(path.join(root,p),'utf8')+(p===target?' -- altered writer':'')),/FROZEN_FILE_CHANGED:.*214_handover/);
});
test('SQL replacement preserves dollar regex anchors literally',()=>{
 const body="BEGIN IF name ~ '^abc$' THEN RETURN '$& $$';END IF;END;";
 const definition='AS $function$'+body+'$function$';
 assert.equal(replaceDefinitionSource(definition,body,body),definition);
 assert.equal(replaceDefinitionSource(definition,body,body+' -- $`'),definition.replace('$function$'+body+'$function$','$function$PLACEHOLDER$function$').replace('PLACEHOLDER',()=>body+' -- $`'));
});
test('only eight named shared functions have exact pinned bridge hunks',()=>{
 assert.deepEqual(bridges.map(b=>b.name),['populate_order_item_cost_snapshot','phase42_order_financial_position_internal','get_cash_shift_summary','_get_cash_shift_closing_report_before_snapshot','phase6_financial_facts_before208_internal','run_advanced_monitoring_checks','sync_stock_alert','enqueue_stock_automation_event']);
 for(const name of ['create_pos_sale_v2','create_pos_sale_with_initial_payment_v1','submit_guest_customer_order_v2','settle_admin_sales_return_v2','create_direct_supplier_receipt_v2'])assert.throws(()=>bridgedSource({name,signature:name,source:'tamper'}),/NOT_AN_APPROVED_BRIDGE/);
 assert.throws(()=>bridgedSource({name:bridges[0].name,signature:'populate_order_item_cost_snapshot()',source:'tamper'}),/FROZEN_BRIDGE_BASE_CHANGED/);
});
test('no prototype application import or active migration; fixed container, no target argument',()=>{
 const entry=readFileSync(path.join(root,'scripts/testing/run-sales-only-phase1.mjs'),'utf8');
 const context=readFileSync(path.join(root,'scripts/testing/sales-only-phase1-context.mjs'),'utf8');
 const candidate=readFileSync(path.join(root,'docs/design/sales-only-phase1/prototype.sql'),'utf8');
 assert.match(entry,/NO_TARGET_OR_RESUME_ARGUMENTS_ALLOWED/);assert.match(entry,/BOOTSTRAP_WORKDIR_OWNERSHIP/);
 assert.match(context,/NO_NETWORK_ALLOWED/);assert.match(context,/assert.equal\(c.Id,expectedId\)/);
 assert.match(candidate,/LITE1_ISOLATED_RUNNER_REQUIRED/);assert.match(candidate,/LITE1_ACTIVATION_REQUIRES_PHASE2/);
 assert.doesNotMatch(candidate,/session_replication_role|DISABLE TRIGGER|ALTER FUNCTION public\.|CREATE OR REPLACE FUNCTION public\.(?!lite1_)/);
});
test('historical metadata projection is exact Git4f3d, never a path exemption or current-runtime projection',()=>{
 assert.deepEqual(Object.keys(salesOnlyPhase1Pins.entries).sort(),['docs/agent/PHASE_STATUS.md','docs/agent/project-state.json','scripts/audit/source-before-d1-reference-kit.mjs','tests/d1-reference-kit.test.ts'].sort());
 for(const file of Object.keys(salesOnlyPhase1Pins.entries)){
  const raw=readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');
  const before=execFileSync('git',['show',salesOnlyPhase1Pins.baseline+':'+file],{cwd:root,encoding:'utf8',maxBuffer:4*1024**2}).replaceAll('\r\n','\n');
  assert.equal(sourceBeforeSalesOnlyPhase1(file,raw),before);
  assert.equal(sourceBeforeSalesOnlyPhase1(file,raw+'\nUNKNOWN_PHASE1_CHANGE'),raw+'\nUNKNOWN_PHASE1_CHANGE');
 }
 assert.equal(sourceBeforeSalesOnlyPhase1('supabase/migrations/unreviewed.sql','arbitrary SQL'),'arbitrary SQL');
 const actual=JSON.parse(sourceBeforeSalesOnlyPhase2('docs/agent/project-state.json',readFileSync(path.join(root,'docs/agent/project-state.json'),'utf8')));assert.equal(actual.currentPhase,'SALES_ONLY_PHASE1');assert.equal(actual.phaseSALES_ONLY_PHASE1ImplementationAllowed,true);
 for(const file of ['scripts/testing/run-sales-only-phase1.mjs','scripts/testing/sales-only-phase1-bridges.mjs','scripts/operations/d1-reference-kit.mjs','scripts/audit/table-access-inventory.mjs'])assert.doesNotMatch(readFileSync(path.join(root,file),'utf8'),/sourceBeforeSalesOnlyPhase1|source-before-sales-only-phase1/);
});
