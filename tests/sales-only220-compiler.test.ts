import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {assertOriginal219Functions,buildSalesOnly220} from '../scripts/testing/sales-only220-compiler.mjs';
import {bridges} from '../scripts/testing/sales-only220-bridges.mjs';
const sql=readFileSync('supabase/migrations/220_sales_only_operating_mode.sql','utf8');
test('220 admits exactly the nine approved bridges and new lite functions;PR79 deferred',()=>{
 const replaced=[...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_0-9]+)\(/giu)].map(m=>m[1]);
 assert.deepEqual(replaced.sort(),bridges.map(b=>b.name).sort());
 assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION public\.(?:submit_guest_customer_order_v2|create_customer_order_base_units_legacy|package_d_create_customer_order_before_source_guard_internal|_get_operational_business_report_v1|get_supplier_replacements_page_v1)\b/iu);
 assert.doesNotMatch(sql,/ALTER FUNCTION public\._get_operational_business_report_before_phase6|sales_lite[12]_test|OWNED_LOCAL_DB219/u);
 assert.match(sql,/LITE220_EXACT219_HISTORY_REQUIRED/);assert.match(sql,/LITE220_CLEAN219_REQUIRED/);
});
test('220 pins every original function before/after;exactly627 bodies and metadata stay frozen',()=>{
 const sections=sql.split('DO $frozen220_');assert.equal(sections.length,3);
 const rows=(s:string)=>new Map([...s.matchAll(/^\('([^']+)','([a-f0-9]{64})','([a-f0-9]{64})',([^\n]+)\)/gmu)].map(m=>[m[1],[m[2],m[3],m[4]]]));
 const before=rows(sections[1].split('END $frozen220_before$;')[0]),after=rows(sections[2].split('END $frozen220_after$;')[0]);
 assert.equal(before.size,636);assert.equal(after.size,636);let equal=0;
 for(const[sig,b]of before){const a=after.get(sig)!;assert.ok(a);assert.equal(a[2],b[2]);if(a[0]===b[0]){assert.deepEqual(a,b);equal++;}else assert.ok(bridges.some(x=>sig.startsWith(x.name+'(')));}
 assert.equal(equal,627);
});
test('compiler refuses missing/extra/duplicated/unknown219 catalog before producing SQL',()=>{
 for(const v of [null,[],Array(637).fill({}),Array(636).fill({signature:'unknown'})])assert.throws(()=>assertOriginal219Functions(v));
 assert.throws(()=>buildSalesOnly220([]),/ORIGINAL219_EXACT636/);
});
