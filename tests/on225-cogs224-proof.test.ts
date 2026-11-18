import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalLf,sha256} from '../scripts/testing/maintenance-db-contract.mjs';
import {sourceBeforeOnPrices225,onPrices225Pins} from '../scripts/audit/source-before-on-prices225.mjs';
test('literal225 source layer preserves every beforeText and refuses unknown bytes',()=>{
 for(const [file,pin] of Object.entries(onPrices225Pins)){
  const current=canonicalLf(readFileSync(file,'utf8'));
  assert.equal(sha256(current),pin.after,file);
  assert.equal(sourceBeforeOnPrices225(file,current),pin.beforeText,file);
  assert.equal(sourceBeforeOnPrices225(file,current+'\nUNKNOWN_BYTE'),current+'\nUNKNOWN_BYTE',file);
 }
});
test('baseline224 proof uses an independent9650oracle and checks rows,RPC and cache without frozen SQL edits',()=>{
 const text=readFileSync('scripts/testing/run-on225-cogs224-proof.mjs','utf8');
 for(const required of ['startInventory224Local(224','expectedCogs,9650','apply_inventory_opening_setup','create_direct_supplier_receipt_v2','create_pos_sale_v2','create_pos_sale_with_initial_payment_v1','complete_website_order_with_settlement_v2','observed.result','observed.cache','ALL_FUNCTIONS_UNCHANGED','ROLLBACK_ALL_PUBLIC_ROWS'])assert.ok(text.includes(required),required);
 assert.ok(!text.includes('CREATE OR REPLACE FUNCTION'));
 const document=readFileSync('docs/design/on-independent-prices225/COGS224_FROZEN_REVIEW_AR.md','utf8');
 assert.ok(document.includes('صفر سطر'));assert.ok(document.includes('214_handover_z_corrections.sql'));
});
