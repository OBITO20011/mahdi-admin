import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ADMIN_NAVIGATION_GROUPS,ERP_READER_ROLES,searchNavigationGroups,canUseNavigationAction} from '../src/features/more/adminNavigation.config';
import {cashFlowRows} from '../src/features/shifts/cashFlowModel';
import {CashFlowSummary} from '../src/features/shifts/CashFlowSummary';
import {DashboardHome} from '../src/features/dashboard/DashboardHome';
import {parseCashShiftMovementPage} from '../src/services/supabase/cashShiftMovements.service';
import {homeFixture,shiftFixture} from '../e2e/package-f-home.fixture';
import {createHash} from 'node:crypto';
import {navigation206Pins,sourceBeforeNavigation206,inventoryBeforeNavigation206} from '../scripts/audit/source-before-navigation-cash206.mjs';
import {verifyProbeCoverage} from '../scripts/audit/table-access-probes.mjs';
import {sourceBeforeSales204} from '../scripts/audit/source-before-sales-history204.mjs';
const read=(file:string)=>readFileSync(file,'utf8');

test('four short canonical groups retain unique entry IDs and current destinations',()=>{
  assert.deepEqual(ADMIN_NAVIGATION_GROUPS.map(group=>group.label),['البيع','المخزون والشراء','المال','الإدارة']);
  const items=ADMIN_NAVIGATION_GROUPS.flatMap(group=>group.items);assert.equal(new Set(items.map(item=>item.id)).size,items.length);
  assert.deepEqual(items.find(item=>item.id==='customer-returns')?.action,{type:'tab',destination:'sales_history',intent:'customer_return'});
  assert.deepEqual(items.find(item=>item.id==='inventory-damage')?.action,{type:'modal',destination:'damage_stock_selection'});
  assert.deepEqual(items.find(item=>item.id==='finance-withdrawals')?.action,{type:'tab',destination:'shifts',intent:'owner_withdrawals'});
});
test('navigation mirrors literal existing role memberships and unions all memberships',()=>{
  const expected:Record<string,readonly string[]>={pos:['owner','admin','manager','sales'],shifts:['owner','admin','manager','accountant'],purchases:['owner','admin','manager','accountant','warehouse_keeper'],cheques:['owner','manager'],users:['owner']};
  for(const [destination,roles] of Object.entries(expected))assert.deepEqual(ERP_READER_ROLES.filter(role=>canUseNavigationAction({type:'tab',destination:destination as 'pos'},role)),roles);
  assert.equal(canUseNavigationAction({type:'tab',destination:'pos'},'cashier'),false);
  assert.equal(canUseNavigationAction({type:'tab',destination:'users'},'cashier',['cashier','owner']),true);
  assert.equal(canUseNavigationAction({type:'tab',destination:'pos'},null),false);
  const viewer=searchNavigationGroups('','view_only').flatMap(group=>group.items.map(item=>item.id));
  assert.deepEqual(viewer.sort(),['catalog-products','customer-accounts','inventory-current']);
});
test('Arabic search normalizes diacritics/alef and never returns forbidden destinations',()=>{
  assert.deepEqual(searchNavigationGroups('إِستلام','owner').flatMap(group=>group.items.map(item=>item.id)),['supplier-receiving']);
  assert.equal(searchNavigationGroups('الصندوق','view_only').length,0);assert.equal(searchNavigationGroups('غير موجود','owner').length,0);
});
test('cash rows preserve each server field and put every CliQ/card movement outside cash',()=>{
  const shift={...shiftFixture,openingCash:500,totalCashSales:0,cashReceipts:0,cashExpenses:90,cashSupplierPayments:20,cashRefunds:0,expectedCash:390,cliqReceipts:8,cliqSupplierPayments:7,ownerWithdrawals:4,ownerWithdrawalReturns:2};
  const rows=cashFlowRows(shift);assert.equal(rows.find(row=>row.kind==='supplier_payments'&&row.method==='cash')?.amount,20);
  assert.equal(rows.find(row=>row.kind==='withdrawals')?.direction,'out');assert.equal(rows.find(row=>row.kind==='withdrawal_returns')?.direction,'in');
  assert.equal(rows.find(row=>row.kind==='receipts'&&row.method==='cliq')?.amount,8);
  const html=renderToStaticMarkup(React.createElement(CashFlowSummary,{shift}));assert.match(html,/390\.000/);assert.match(html,/90\.000/);assert.match(html,/20\.000/);assert.match(html,/داخل \(\+\)/);assert.match(html,/طالع \(−\)/);assert.match(html,/بنود بلا حركة/);
  // Deliberately inconsistent source:display the server expected390,never recompute384.
  assert.doesNotMatch(html,/384\.000/);
});
const renderHome=(canViewProfit=true,available=true)=>renderToStaticMarkup(React.createElement(DashboardHome,{data:{...homeFixture,financialFactsAvailable:available,access:{canViewProfit}},currentUserName:'المالك',currentShift:shiftFixture,loading:false,error:null,realtimeConnected:true,onRefresh(){},onOrders(){},onAccounts(){},onInventory(){},onProducts(){},onShift(){},onSell(){},onReceive(){},onExpense(){}}));
test('same four Home cards show actual month profit only with profit capability',()=>{
  const html=renderHome(),kpis=html.slice(html.indexOf('data-testid="home-kpis"'),html.indexOf('aria-labelledby="home-shift-title"'));assert.match(kpis,/ربح الشهر/);assert.match(kpis,/4,100\.000/);assert.match(kpis,/8,420\.750/);assert.doesNotMatch(kpis,/31,906\.250/);assert.match(html,/31,906\.250/);assert.match(html,/الوردية مفتوحة/);assert.doesNotMatch(html,/text-4xl|bg-nw-hero/);
  assert.doesNotMatch(renderHome(false),/4,100\.000/);assert.doesNotMatch(renderHome(true,false),/4,100\.000|8,420\.750/);
});
const page={shiftId:'shift',kind:'expenses',method:'cash',generatedAt:'2026-10-20T12:00:00Z',shiftStatus:'open',canonicalAmountInMinorUnits:20000,totalAmountInMinorUnits:20000,totalCount:1,page:1,pageSize:25,totalPages:1,evidenceStatus:'matched',rows:[{id:'expense',source:'expense',reference:'EXP-1',at:'2026-10-20T10:00:00Z',method:'cash',amountInMinorUnits:20000,note:null}]};
test('movement parser preserves fils and explicit legacy mismatch,never fabricates difference rows',()=>{
  assert.deepEqual(parseCashShiftMovementPage(page),page);
  const legacy={...page,evidenceStatus:'mismatch',canonicalAmountInMinorUnits:21000};assert.deepEqual(parseCashShiftMovementPage(legacy),legacy);
  assert.deepEqual(parseCashShiftMovementPage({...page,evidenceStatus:'unavailable',canonicalAmountInMinorUnits:null}).rows,page.rows);
});
test('movement parser fails closed on unsafe money,forged match,invalid paging and missing references',()=>{
  for(const bad of [{...page,totalAmountInMinorUnits:Number.MAX_SAFE_INTEGER+1},{...page,totalAmountInMinorUnits:'20000'},{...page,canonicalAmountInMinorUnits:21000},{...page,pageSize:101},{...page,totalPages:2},{...page,rows:[{...page.rows[0],reference:''}]}])assert.throws(()=>parseCashShiftMovementPage(bad));
});
test('206 adds only one STABLE reader with four existing report roles and bounded actual evidence',()=>{
  const sql=read('supabase/migrations/206_cash_shift_movement_read_model.sql');assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/gu)??[]).length,1);
  assert.match(sql,/LANGUAGE plpgsql STABLE SECURITY DEFINER/u);assert.match(sql,/ARRAY\['owner','admin','manager','accountant'\]/u);assert.doesNotMatch(sql,/\b(?:INSERT INTO|UPDATE public\.|DELETE FROM|CREATE TABLE|CREATE SEQUENCE|ALTER TABLE)\b/u);
  assert.match(sql,/v_summary:=public\.get_cash_shift_summary/u);assert.match(sql,/p_page_size>100/u);assert.match(sql,/COUNT\(\*\) count,COALESCE\(SUM\(amount\),0\)/u);
  for(const table of ['customer_payments','customer_collection_operations','supplier_payments','supplier_opening_payments','supplier_cheque_claim_payments','sales_returns','sales_return_events','owner_cash_withdrawals','owner_cash_withdrawal_reversals'])assert.ok(sql.includes('public.'+table),table);
  assert.match(sql,/FROM PUBLIC,anon,service_role/u);assert.match(sql,/TO authenticated/u);
});
test('206 exact source inverse restores accepted205 evidence without repinning old proofs',async()=>{
  const historical=await inventoryBeforeNavigation206(),proof=JSON.parse(read('docs/operations/TABLE_ACCESS_AFTER_205.json'));
  assert.deepEqual(historical.sources,proof.sourceHashes);assert.deepEqual(verifyProbeCoverage(historical,proof.results),proof.coverage);
  for(const [file,pin] of Object.entries(navigation206Pins) as Array<[string,{before:string|null;after:string;added?:boolean}]>){const current=read(file),restored=sourceBeforeNavigation206(file,current);
    assert.throws(()=>sourceBeforeNavigation206(file,current+'\nvoid 206;\n'),/(?:NAVIGATION206|CORRECTIONS207)_ENTIRE_CURRENT_FILE_CHANGED/u);
    if(pin.added)assert.equal(restored,null);else assert.equal(createHash('sha256').update(restored!).digest('hex'),pin.before);
  }
});
test('composed source restoration admits only exact older BEFORE hashes and still rejects extra code',()=>{
  const file='src/App.tsx',older=sourceBeforeSales204(file,read(file))!;
  assert.equal(sourceBeforeNavigation206(file,older),older);
  assert.throws(()=>sourceBeforeNavigation206(file,older+'\nvoid unapproved;\n'),/(?:NAVIGATION206|CORRECTIONS207)_ENTIRE_CURRENT_FILE_CHANGED/u);
});
