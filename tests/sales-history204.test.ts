import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {canReadSalesHistory,parseSalesHistoryPage,isSalesHistoryDate,SALES_HISTORY_ROLES} from '../src/utils/salesHistory';
import {ADMIN_NAVIGATION_GROUPS,isNavigationItemVisible} from '../src/features/more/adminNavigation.config';
import {buildSideNavigation} from '../src/components/layout/sideNavigationModel';
const row={id:'92600000-0000-4000-8000-000000000001',orderNumber:'POS-1',listedAt:'2026-10-19T12:00:00+03:00',firstCompletedAt:'2026-10-19T12:00:00+03:00',dateBasis:'completion',customerName:'عميل',customerPhone:'0790000000',totalInMinorUnits:12050,paymentMethod:'cash',paymentStatus:'paid',source:'pos',status:'completed',countsAsSale:true};
const page={success:true,generatedAt:'2026-10-19T12:00:00+03:00',timeZone:'Asia/Amman',page:1,pageSize:25,totalCount:1,totalPages:1,period:{kind:'day',fromDate:'2026-10-19',toDate:'2026-10-19'},summary:{invoiceCount:1,salesCount:1,salesInMinorUnits:12050,undatedInvoiceCount:0},rows:[row]};
test('204 reader capability follows every actual role,never only whichever primary role was returned first',()=>{
 for(const role of SALES_HISTORY_ROLES)assert.equal(canReadSalesHistory([role]),true);
 for(const roles of [[],['warehouse_keeper'],['unrecognized']])assert.equal(canReadSalesHistory(roles),false);
 assert.equal(canReadSalesHistory(['warehouse_keeper','sales'],'warehouse_keeper'),true);
 assert.equal(canReadSalesHistory(['warehouse_keeper'],'owner'),false);
 assert.equal(canReadSalesHistory(undefined,'owner'),true);
 const item=ADMIN_NAVIGATION_GROUPS.flatMap(g=>g.items).find(i=>i.id==='sales-history')!;
 assert.equal(isNavigationItemVisible(item,'warehouse_keeper',['warehouse_keeper']),false);
 assert.equal(isNavigationItemVisible(item,'warehouse_keeper',['warehouse_keeper','sales']),true);
 assert.ok(buildSideNavigation('warehouse_keeper',['warehouse_keeper','sales']).flatMap(g=>g.items).some(i=>i.id===item.id));
 assert.ok(!buildSideNavigation('warehouse_keeper',['warehouse_keeper']).flatMap(g=>g.items).some(i=>i.id===item.id));
});
test('204 parses authoritative money and true zero but rejects partial pages and rounded/omitted sums',()=>{
 assert.equal(parseSalesHistoryPage(page).summary.salesInMinorUnits,12050);
 const empty={...page,totalCount:0,summary:{invoiceCount:0,salesCount:0,salesInMinorUnits:0,undatedInvoiceCount:0},rows:[]};
 assert.equal(parseSalesHistoryPage(empty).summary.salesInMinorUnits,0);
 for(const invalid of [{...page,summary:undefined},{...page,summary:{...page.summary,salesInMinorUnits:undefined}},{...page,summary:{...page.summary,salesInMinorUnits:Number.MAX_SAFE_INTEGER+1}},{...page,rows:[]},{...page,totalPages:2},{...page,timeZone:'UTC'},{...page,totalCount:2,summary:{...page.summary,invoiceCount:2},rows:[row,row]}])assert.throws(()=>parseSalesHistoryPage(invalid));
});
test('204 distinguishes creation time from completion and never counts unsupported old chronology',()=>{
 const legacy={...page,rows:[{...row,status:'completed',firstCompletedAt:null,dateBasis:'creation',countsAsSale:false,source:null}],summary:{invoiceCount:1,salesCount:0,salesInMinorUnits:0,undatedInvoiceCount:1}};
 assert.equal(parseSalesHistoryPage(legacy).rows[0].countsAsSale,false);
 assert.throws(()=>parseSalesHistoryPage({...legacy,rows:[{...legacy.rows[0],countsAsSale:true}]}));
 assert.throws(()=>parseSalesHistoryPage({...page,rows:[{...row,status:'cancelled'}]}));
 assert.equal(parseSalesHistoryPage({...page,rows:[{...row,status:'returned'}]}).rows[0].countsAsSale,true);
 assert.equal(isSalesHistoryDate('2026-02-29'),false);assert.equal(isSalesHistoryDate('2028-02-29'),true);assert.equal(isSalesHistoryDate('infinity'),false);
});
test('204 SQL is one stable authenticated reader and operational075 remains unchanged/excludesPOS',()=>{
 const sql=readFileSync('supabase/migrations/204_sales_history_read_model.sql','utf8');
 assert.equal([...sql.matchAll(/CREATE OR REPLACE FUNCTION/gu)].length,1);assert.match(sql,/STABLE\s+SECURITY DEFINER/u);
 assert.doesNotMatch(sql,/INSERT INTO|UPDATE public\.|DELETE FROM|CREATE TABLE|CREATE INDEX/u);
 for(const role of SALES_HISTORY_ROLES)assert.ok(sql.includes("'"+role+"'"));
 assert.match(sql,/FROM PUBLIC,anon,service_role/u);assert.match(sql,/TO authenticated/u);
 assert.match(readFileSync('supabase/migrations/075_operational_orders_pagination.sql','utf8'),/COALESCE\(o.source, 'website'\) <> 'pos'/u);
});
