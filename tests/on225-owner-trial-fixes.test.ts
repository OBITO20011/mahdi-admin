import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

// Owner ON225 trial findings 2026-11-20. Raw current source only (never a historical projection).
const raw=(file:string)=>readFileSync(file,'utf8').replaceAll('\r\n','\n');

test('single-unit products can gain a parcel named «طرد» instead of their own content unit',()=>{
 const form=raw('src/features/products/ProductFormModal.tsx');
 assert.match(form,/units\.find\(item => item\.nameAr\.trim\(\) === 'طرد'\)\?\.nameAr/u);
 assert.match(form,/\|\| purchasePackage\.trim\(\) === unit\.trim\(\)\n\s+\? parcelName/u);
 // The «طرد» unit wins over the generic CTN «كرتونة» fallback.
 assert.ok(form.indexOf("item.nameAr.trim() === 'طرد'")<form.indexOf("item.code === 'CTN'"));
});

test('an invoice no longer embeds the shop-wide damage log; it stays in More → التالف',()=>{
 const panel=raw('src/features/orders/AdminAftercarePanel.tsx');
 assert.doesNotMatch(panel,/DamageHistoryPanel|damageOpen|سجل المحل كله/u);
 assert.match(panel,/<AftercareWizard215 /u);
 assert.match(raw('src/features/more/DamageProductSelection.tsx'),/<DamageHistoryPanel\/>/u);
});

test('a cash refund larger than the drawer is warned once before settlement, never blocked',()=>{
 const wizard=raw('src/features/orders/AftercareWizard215.tsx');
 assert.match(wizard,/const drawer=useDrawerShortfallConfirm\(\);/u);
 const confirm=wizard.slice(wizard.indexOf('const confirm=async()=>{'));
 assert.ok(confirm.indexOf('drawer.confirmCash(')<confirm.indexOf('settleAftercare215('));
 assert.match(confirm,/preview\.refundMethod==='cash'\?preview\.moneyRefundInMinorUnits:'0'/u);
 assert.match(wizard,/\{drawer\.warningNode\}/u);
});

test('mixed parcel count shows the product parcel size or asks for a count',()=>{
 const modal=raw('src/features/more/ParcelConfigurationModal.tsx');
 assert.match(modal,/طرد هذا المنتج: \$\{product\.unitsPerParcel\} \$\{contentUnit\(form\.familyProductId\)\}/u);
 assert.match(modal,/لا يوجد طرد معرّف لهذا المنتج — اكتب العدد/u);
});

test('owner withdrawals entry scrolls only its own container and flashes the card',()=>{
 const shifts=raw('src/features/shifts/ShiftsView.tsx');
 assert.doesNotMatch(shifts,/withdrawalsEntry\.current\?\.scrollIntoView/u);
 assert.match(shifts,/card\.focus\(\{preventScroll:true\}\)/u);
 assert.match(shifts,/scroller\.scrollTo\(/u);
});

test('receiving can add loose packets (or a parcel) of the same product as its own line',()=>{
 const modal=raw('src/features/directReceiving/CreateDirectReceiptModal.tsx');
 const add=modal.slice(modal.indexOf('const addCompanionLine='),modal.indexOf('// Remove Item row'));
 assert.match(add,/clientLineId:crypto\.randomUUID\(\)/u);
 assert.match(add,/item\.receivingMode==='package'\?'base_unit':'package'/u);
 assert.match(modal,/data-testid="receiving-companion-line"/u);
 assert.match(modal,/فرط لنفس الصنف/u);
});

test('damage report leads with one plain profit line whose sign follows profit',()=>{
 const section=raw('src/features/reports/DamageLossReportSection.tsx');
 assert.match(section,/const effect=losses\.additional===0\?0:-losses\.additional/u);
 assert.match(section,/أثر التلف على ربحك بهذه الفترة/u);
 assert.match(section,/تفاصيل للمحاسب/u);
 assert.doesNotMatch(section,/'إعادة تصنيف عيب إلى معلّق'/u);
});

test('reports open with a plain summary of server values and hide zero extras',()=>{
 const view=raw('src/features/reports/ReportsCenterView.tsx');
 const summary=view.slice(view.indexOf('data-testid="report-plain-summary"'),view.indexOf('<section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">'));
 for(const value of ['report.sales.netSales','report.sales.netProfit','report.cashFlow.cashNetFlow','report.cashFlow.cliqNetFlow','report.balances.customerDue','report.balances.supplierDue'])assert.ok(summary.includes(value),value);
 assert.match(summary,/filter\(row=>row\.always\|\|row\.value!==0\)/u);
 assert.doesNotMatch(summary,/<section|<article/u);
});
