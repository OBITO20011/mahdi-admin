import {openAftercare,mockInvoiceDamageCandidate,openInvoiceDamageConversion,proofId,damageFixtureProductId} from './aftercare-current-ui';
import {test,expect,type Page} from './isolated-test';
import {checkLayout} from './package-f-layout';
import {fieldGeometry,focusWithKeyboardSpace} from './trial-w-form-geometry';
import {phase6AftercareFixture} from './phase6-package-b.fixture';
import {recentSalesFixture} from './package-f-sales-history.fixture';
import {chooseOpeningMainBranch} from './opening-cheque-readiness';

async function openDisclosures(page:Page){
  for(const summary of await page.locator('details > summary').all())if(await summary.isVisible())await summary.click();
}
async function capture(page:Page,info:{outputPath:(file:string)=>string},name:string){
  await fieldGeometry(page);await focusWithKeyboardSpace(page);const dialog=page.getByRole('dialog').filter({visible:true});
  const aftercare=page.getByTestId(name==='aftercare-safety'?'aftercare-supplier-safety':'phase43-admin-aftercare');
  const root=await dialog.count()?dialog.last():await aftercare.count()?aftercare:page.locator('main').last();
  await checkLayout(page,root);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await root.screenshot({path:info.outputPath(name+'390.png')});
}

for(const view of ['form','parcel'])test(`W5 product ${view} consistent native fields390`,async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/e2e/package-f-products-harness.html?view='+view);
  await expect(page.getByRole('dialog')).toHaveAttribute('data-state','open');
  if(view==='form')await page.getByRole('dialog').locator('details > summary').first().click();
  await capture(page,info,'product-'+view);
});

test('W5 storefront settings native labels/fees390',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/e2e/package-f-administration-harness.html?view=settings');
  await expect(page.getByRole('dialog')).toHaveAttribute('data-state','open');await openDisclosures(page);
  await capture(page,info,'storefront-settings');
});

test('W5 inventory expanded filters390',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/e2e/package-f-inventory-harness.html');
  await expect(page.getByTestId('inventory-workbench')).toBeVisible();await openDisclosures(page);
  await capture(page,info,'inventory-filters');
});

test('W5 sales history dates and filters390',async({page},info)=>{
  await page.route('**/rest/v1/rpc/get_sales_history_page',r=>r.fulfill({json:{success:true,...recentSalesFixture}}));
  await page.setViewportSize({width:390,height:844});await page.goto('/e2e/package-f-sales-history-harness.html');
  await expect(page.getByTestId('sales-history')).toBeVisible();await page.getByRole('button',{name:'مدى',exact:true}).click();
  await capture(page,info,'sales-history');
});

test('W5 opening cheques manual inputs390',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/e2e/package-f-go-live-harness.html?seeded=1');
  await chooseOpeningMainBranch(page);
  await page.getByTestId('go-live-card-cheques').getByRole('button',{name:'إدخال يدوي',exact:true}).click();
  await expect(page.getByTestId('go-live-cheques-manual')).toBeVisible();await capture(page,info,'opening-cheques');
});

test('W5 document correction reason390',async({page},info)=>{
  await page.route('**/rest/v1/rpc/get_document_correction_preview',r=>{const args=r.request().postDataJSON();return r.fulfill({json:{
    contractVersion:207,action:args.p_action,recordId:args.p_record_id,reference:'POS-207',eligible:true,blockedReason:null,cashShiftId:'shift',fingerprint:'a'.repeat(64),
    effect:{cashInMinorUnits:-2000,cliqInMinorUnits:0,customerDebtInMinorUnits:0,supplierBalanceInMinorUnits:0,inventoryBaseUnits:2,paymentMethod:'cash',paymentInMinorUnits:2000,stock:[]}}});});
  await page.setViewportSize({width:390,height:844});await page.goto('/e2e/document-corrections207-harness.html');
  const entry=page.locator('[data-action="pos_sale"]');await entry.locator('summary').click();await entry.getByRole('button',{name:'عكس بيع خاطئ',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'سبب التصحيح',exact:true})).toBeVisible();await capture(page,info,'document-correction');
});

const supplier='88880000-0000-4000-8000-000000000003';
async function aftercareMocks(page:Page){
  await page.route('**/rest/v1/rpc/get_admin_sales_aftercare_context_v1',r=>r.fulfill({json:phase6AftercareFixture}));
  await page.route('**/rest/v1/rpc/get_supplier_replacement_options_v1',r=>r.fulfill({json:{contractVersion:208,
    products:[{id:'juice',name:'عصير برتقال',sku:'JUICE',baseUnitName:'باكيت',unitsPerParcel:1}],suppliers:[{id:supplier,name:'المورد الموثق'}],
    warehouses:[],lastSuppliers:[{productId:'juice',supplierId:supplier,supplierName:'المورد الموثق'},{productId:damageFixtureProductId,supplierId:supplier,supplierName:'المورد الموثق'}]}}));
}

async function supplierWizardFields(page:Page,intent:'refund'|'replace'){
  await openAftercare(page,intent,'الطرد المشكّل كاملاً');
  await page.getByLabel('الخربان · عصير برتقال',{exact:true}).fill('1');await page.getByLabel('فحصت الباكيتات الراجعة',{exact:true}).check();await page.getByRole('button',{name:'التالي',exact:true}).click();
  await page.getByRole('button',{name:'على المورد — بانتظار البديل',exact:true}).click();await expect(page.getByLabel('مورد عصير برتقال',{exact:true})).toHaveValue(supplier);
}
test('W5 current wizard supplier replacement fields390',async({page},info)=>{
  await aftercareMocks(page);await page.setViewportSize({width:390,height:844});await page.goto('/e2e/phase6-package-b-harness.html');await supplierWizardFields(page,'replace');await capture(page,info,'aftercare-replacement');
});
test('W5 current wizard supplier return fields390',async({page},info)=>{
  await aftercareMocks(page);await page.setViewportSize({width:390,height:844});await page.goto('/e2e/phase6-package-b-harness.html');await supplierWizardFields(page,'refund');await capture(page,info,'aftercare-return');
});
test('W5 current damage-list supplier safety conversion fields390',async({page},info)=>{
  await aftercareMocks(page);await mockInvoiceDamageCandidate(page,phase6AftercareFixture.order.id,proofId(65));await page.setViewportSize({width:390,height:844});await page.goto('/e2e/phase6-package-b-harness.html');await openInvoiceDamageConversion(page);
  await expect(page.getByLabel('مورد التالف',{exact:true})).toHaveValue(supplier);await capture(page,info,'aftercare-safety');
});

test('W5+ counted drawer and opening float preserve mobile zoom and decimal keyboard390',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/e2e/package-f-cash-harness.html');
  await expect(page.getByTestId('owner-withdrawals').getByLabel('مبلغ السحب (د.أ) *',{exact:true})).toHaveAttribute('inputmode','decimal');
  await page.getByTestId('cash-count-open').click();
  const counted=page.getByLabel('الكاش الفعلي بعد عدّ الصندوق',{exact:true});
  await expect(counted).toHaveAttribute('inputmode','decimal');await expect(counted).toHaveAttribute('enterkeyhint','done');
  await counted.fill('810.300');await expect(page.getByTestId('cash-close-submit')).toBeEnabled();
  await capture(page,info,'drawer-counted');
  await page.goto('/e2e/package-f-cash-harness.html?closed=1');
  await expect(page.getByLabel('العهدة الافتتاحية (د.أ)',{exact:true})).toHaveAttribute('inputmode','decimal');
  await capture(page,info,'drawer-opening');
});

for(const [name,url,title]of [
  ['expense','/e2e/package-f-financial-harness.html?view=expense-form','مصروف جديد'],
  ['supplier-payment','/e2e/package-f-purchasing-harness.html?view=payment','دفعة المورد'],
  ['receipt-payment','/e2e/package-f-purchasing-harness.html?view=receipt-payment','دفعة السند'],
  ['receiving','/e2e/package-f-purchasing-harness.html?view=receive','استلام البضائع'],
  ['direct-receiving','/e2e/package-f-purchasing-harness.html?view=create-direct','سند استلام جديد'],
  ['purchase','/e2e/package-f-purchasing-harness.html?view=create-po','أمر الشراء'],
]as const)test(`W5+ ${name} mobile field font/keyboard/focus390`,async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await page.goto(url);
  const dialog=page.getByRole('dialog',{name:title,exact:true});await expect(dialog).toBeVisible();
  if(await dialog.getAttribute('data-state')!==null)await expect(dialog).toHaveAttribute('data-state','open');
  await capture(page,info,name);
});

test('W5+ unified customer collection mobile fields390',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/e2e/package-f-cheques-harness.html?view=collection&role=owner');
  await expect(page.getByLabel('المبلغ المقبوض (د.أ) *',{exact:true})).toHaveAttribute('inputmode','decimal');
  await capture(page,info,'customer-collection');
});
