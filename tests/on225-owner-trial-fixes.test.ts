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

test('mixed parcel count is read-only and follows the product definition',()=>{
 const modal=raw('src/features/more/ParcelConfigurationModal.tsx');
 assert.match(modal,/<input readOnly[^>]+value={form.units}/u);
 assert.match(modal,/اضبط عدد الطرد من نموذج المنتج، ثم أعد تحميل الإعداد/u);
 assert.match(modal,/form.units!==fresh.unitsPerSalePackage/u);
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
 assert.match(section,/أثر التلف على الربح في هذه الفترة/u);
 assert.match(section,/تفاصيل للمحاسب/u);
 assert.doesNotMatch(section,/'إعادة تصنيف عيب إلى معلّق'/u);
});

test('reports open with a plain summary of server values and hide zero extras',()=>{
 const view=raw('src/features/reports/ReportsCenterView.tsx');
 const summary=view.slice(view.indexOf('data-testid="report-plain-summary"'),view.indexOf('<SupplierReplacementSummary ownerOnly />'));
 for(const value of ['report.sales.netSales','report.sales.netProfit','report.cashFlow.cashNetFlow','report.cashFlow.cliqNetFlow','report.balances.customerDue','report.balances.supplierDue'])assert.ok(summary.includes(value),value);
 assert.ok(summary.includes('filter(row=>row.always||row.value!==0)'));
 assert.doesNotMatch(summary,/<section|<article/u);
});

test('owner 2026-11-20: CliQ reference is optional everywhere; a blank one is recorded as «بدون مرجع»',async()=>{
 const {cliqReferenceForServer,CLIQ_NO_REFERENCE}=await import('../src/utils/cliqReference.ts');
 assert.equal(CLIQ_NO_REFERENCE,'بدون مرجع');
 assert.equal(cliqReferenceForServer('cliq',''),'بدون مرجع');
 assert.equal(cliqReferenceForServer('cliq','   '),'بدون مرجع');
 assert.equal(cliqReferenceForServer('cliq',' REF-1 '),'REF-1');
 assert.equal(cliqReferenceForServer('cash',''),null);
 assert.equal(cliqReferenceForServer('bank_transfer',' T-9 '),'T-9');
 assert.equal(cliqReferenceForServer('debt',undefined),null);
 // Every CliQ entry point routes through the helper and no longer blocks a blank reference.
 for(const file of ['src/features/accounts/RecordCustomerPaymentModal.tsx','src/features/crm/CustomerCollectionModal.tsx',
  'src/features/expenses/ExpenseFormModal.tsx','src/features/orders/OrderDetailModal.tsx','src/features/orders/aftercare215Draft.ts'])
  assert.match(raw(file),/cliqReferenceForServer\(/u,file);
 for(const file of ['src/features/accounts/RecordCustomerPaymentModal.tsx','src/features/crm/CustomerCollectionModal.tsx',
  'src/features/expenses/ExpenseFormModal.tsx','src/features/orders/OrderDetailModal.tsx'])
  assert.doesNotMatch(raw(file),/مرجع CliQ مطلوب|مرجع CliQ \*|مرجع عملية CliQ قبل|referenceNumber\.trim\(\)\.length > 0/u,file);
 assert.match(raw('src/features/orders/AftercareWizard215.tsx'),/ومرجعه اختياري/u);
});

test('owner 2026-11-20: delivery paid to the driver is explained where the order is settled',()=>{
 assert.match(raw('src/features/orders/OrderDetailModal.tsx'),/اتركها 0 إذا دفع الزبون الأجرة للسائق مباشرة/u);
});
