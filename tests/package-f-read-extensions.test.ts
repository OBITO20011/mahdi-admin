import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {formatWholesaleInventory} from '../src/utils/inventoryFormatter';

const read=(file:string)=>readFileSync(file,'utf8');
const migration=read('supabase/migrations/135_package_f_pos_customer_inventory_reads.sql');
test('135 replaces exactly two existing readers with explicit stable secured bodies,never money/inventory writes',()=>{
  assert.deepEqual([...migration.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/gu)].map(m=>m[1]),['get_pos_customer_page','get_admin_inventory_product_page']);
  assert.equal([...migration.matchAll(/SET search_path = public, pg_temp/gu)].length,2);
  assert.equal([...migration.matchAll(/LANGUAGE plpgsql\s+STABLE\s+SECURITY DEFINER/gu)].length,2);
  assert.doesNotMatch(migration,/pg_get_functiondef|\bEXECUTE\b|\bRENAME\b|\bGRANT\b|\bREVOKE\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/iu);
  assert.match(migration,/phase42_customer_receivable_total_internal\(pc.id\)/u);
  assert.match(migration,/'credit_limit_in_minor_units', pc.credit_limit_in_minor_units/u);
  assert.match(migration,/v_status = 'available' AND product.available_quantity > 0/u);
  assert.match(migration,/COUNT\(\*\) FILTER \(WHERE product.is_active = true\)::INTEGER AS active_items/u);
  assert.match(migration,/COUNT\(\*\)::INTEGER AS total_items/u);
  assert.match(migration,/wac_cost_in_minor_units_exact/u);
});
test('read adapters use the existing source fields and do not turn missing debt/active facts into guessed zero',()=>{
  const pos=read('src/services/supabase/pos.service.ts'),inventory=read('src/services/supabase/inventory.service.ts');
  assert.match(pos,/get_pos_customer_page/u);assert.match(pos,/Number.isSafeInteger\(Number\(customer.current_balance_in_minor_units\)\)/u);
  assert.match(pos,/\? undefined : minorUnitsToJod\(Number\(customer.current_balance_in_minor_units\)\)/u);
  assert.match(inventory,/activeItems: metrics.active_items == null \? undefined/u);
  assert.match(inventory,/availableStock: metrics.available_stock == null \? undefined/u);
});
test('wholesale quantity preserves count/unit facts without decorative emoji',()=>{
  const quantity=formatWholesaleInventory(157,24,'كرتونة','باكيت');
  assert.equal(quantity.cartons,6);assert.equal(quantity.remainingPieces,13);
  assert.equal(quantity.cartonFormatted,'6 كراتين + 13 باكيت');
  assert.equal(quantity.totalPiecesFormatted,'(157 باكيت)');assert.doesNotMatch(quantity.fullFormatted,/📦/u);
});

test('new reader runtime parses the complete multiline EXPLAIN JSON,not its final bracket',()=>{
  const runner=read('scripts/testing/run-package-f-read-extensions-runtime.mjs');
  assert.match(runner,/const json=async\(text,options\)=>JSON.parse\(await sql\(text,options\)\);/u);
  const plan=[{'Plan':{'Node Type':'Result'},'Execution Time':12.345}];
  const output=JSON.stringify(plan,null,2)+'\n';
  assert.deepEqual(JSON.parse(output),plan);assert.throws(()=>JSON.parse(output.trim().split('\n').at(-1)!));
});
