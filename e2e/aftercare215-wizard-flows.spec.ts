import {test,expect,type Page} from './isolated-test';
import {wizard215Order,wizard215Scenario} from './aftercare215-wizard.fixture';
import {inventoryProducts} from './package-f-inventory.fixture';
const id=(n:number)=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`,seal='b'.repeat(64);
const harness='/e2e/aftercare215-wizard-harness.html';
test.beforeEach(async({page})=>{await page.setViewportSize({width:390,height:844});});
async function whole(page:Page,intent:'refund'|'replace'='refund',formed=false){
 await page.getByRole('button',{name:'إرجاع أو استبدال',exact:true}).click();
 if(intent==='replace')await page.getByRole('button',{name:'يبدّل',exact:true}).click();
 await page.getByRole('button',{name:'التالي',exact:true}).click();await page.getByRole('button',{name:formed?'الطرد المشكّل كاملاً':'طرد كامل',exact:true}).click();await page.getByRole('button',{name:'التالي',exact:true}).click();
}
async function finishInspection(page:Page){
 await page.getByLabel('فحصت الباكيتات الراجعة',{exact:true}).check();await page.getByRole('button',{name:'التالي',exact:true}).click();await page.getByRole('button',{name:'التالي',exact:true}).click();
}
const refundPreview=(method:'cash'|'cliq'|null,money='9000',debt='0',issues:Array<{field:string;code:string}>=[])=>({contractVersion:215,orderId:wizard215Order.id,previewFingerprint:seal,
 canConfirm:issues.length===0,issues,goodQuantity:12,badQuantity:0,customerDamageQuantity:0,entitlementInMinorUnits:'9000',debtReductionInMinorUnits:debt,moneyRefundInMinorUnits:money,refundMethod:method});
for(const method of ['cash','cliq','debt'] as const)test(`215 wizard ${method} refund default,server amount and exact sealed write`,async({page})=>{
 const writes:Array<Record<string,unknown>>=[],previews:Array<Record<string,any>>=[];
 await page.route('**/rest/v1/rpc/preview_admin_sales_return_v2',r=>{previews.push(r.request().postDataJSON().p_payload);return r.fulfill({json:refundPreview(method==='debt'?null:method,method==='debt'?'0':'9000',method==='debt'?'9000':'0')});});
 await page.route('**/rest/v1/rpc/settle_admin_sales_return_v2',r=>{const body=r.request().postDataJSON();writes.push(body);return r.fulfill({json:{...refundPreview(method==='debt'?null:method,method==='debt'?'0':'9000',method==='debt'?'9000':'0'),success:true,operationId:id(80),returnId:id(81),returnOperationId:id(82),returnNumber:'SRT-TEST-215',idempotentReplay:false}});});
 await page.goto(harness+'?scenario='+method);await whole(page);await finishInspection(page);await expect(page.getByLabel('طريقة رد المال',{exact:true})).toHaveValue(method);
 if(method==='cliq')await page.getByLabel('مرجع CliQ',{exact:true}).fill('CL-TEST-215');
 expect(writes).toHaveLength(0);await page.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();const preview=page.getByTestId('aftercare215-preview');
 await expect(preview).toContainText(method==='debt'?'ينقص من دين هذه الفاتورة: 9.000':method==='cliq'?'9.000 د.أ CliQ من حسابك':'9.000 د.أ كاش من الدرج');expect(writes).toHaveLength(0);
 expect(previews[0].refundMethod).toBe(method);expect(previews[0].referenceNumber).toBe(method==='cliq'?'CL-TEST-215':null);expect(previews[0].physicalSources[0].sellable_restock_quantity).toBe(12);
 await page.getByRole('button',{name:'تأكيد الإرجاع',exact:true}).click();await expect(page.getByRole('status')).toContainText('تم الإرجاع');expect(writes).toHaveLength(1);expect(writes[0].p_payload).toEqual(previews[0]);expect(writes[0].p_preview_fingerprint).toBe(seal);
 expect(JSON.stringify(writes[0])).not.toMatch(/moneyRefund|entitlement|goodRestockValue|cost/i);
});
test('215 wizard original CliQ auto asks for reference by name then sends it without a manual refund amount',async({page})=>{
 const bodies:Array<Record<string,any>>=[];await page.route('**/rest/v1/rpc/preview_admin_sales_return_v2',r=>{const p=r.request().postDataJSON().p_payload;bodies.push(p);return r.fulfill({json:refundPreview('cliq','9000','0',p.referenceNumber?[]:[{field:'referenceNumber',code:'AFTERCARE215_REFUND_REFERENCE_REQUIRED'}])});});
 await page.goto(harness+'?scenario=cliq');await whole(page);await finishInspection(page);await page.getByLabel('طريقة رد المال',{exact:true}).selectOption('auto');await page.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('مرجع CliQ');await expect(page.getByRole('button',{name:'تأكيد الإرجاع',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'رجوع',exact:true}).click();
 await page.getByLabel('مرجع CliQ',{exact:true}).fill('AUTO-CLIQ-215');await page.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();await expect(page.getByRole('button',{name:'تأكيد الإرجاع',exact:true})).toBeVisible();expect(bodies[1].referenceNumber).toBe('AUTO-CLIQ-215');expect(bodies[1].refundMethod).toBe('auto');
});
test('215 wizard collected original debt needs an explicit actual refund method;no fabricated debt reduction',async({page})=>{
 const bodies:Array<Record<string,any>>=[];await page.route('**/rest/v1/rpc/preview_admin_sales_return_v2',r=>{const p=r.request().postDataJSON().p_payload;bodies.push(p);return r.fulfill({json:refundPreview(p.refundMethod==='cash'?'cash':null,'9000','0',p.refundMethod==='cash'?[]:[{field:'refundMethod',code:'AFTERCARE215_REFUND_METHOD_REQUIRED'}])});});
 await page.goto(harness+'?scenario=collected-debt');await whole(page);await finishInspection(page);await expect(page.getByLabel('طريقة رد المال',{exact:true})).toHaveValue('debt');await page.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('طريقة رد المال');await expect(page.getByRole('button',{name:'تأكيد الإرجاع',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'رجوع',exact:true}).click();await page.getByLabel('طريقة رد المال',{exact:true}).selectOption('cash');await page.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();
 await expect(page.getByTestId('aftercare215-preview')).toContainText('ينقص من دين هذه الفاتورة: 0.000');await expect(page.getByTestId('aftercare215-preview')).toContainText('9.000 د.أ كاش من الدرج');expect(bodies.map(p=>p.refundMethod)).toEqual(['debt','cash']);
});
test('215 wizard whole formed parcel sends the supplier only the bad flavor and restores the two good buckets',async({page})=>{
 let body:Record<string,any>|undefined;await page.route('**/rest/v1/rpc/get_supplier_replacement_options_v1',r=>r.fulfill({json:{contractVersion:208,products:[],warehouses:[],suppliers:[{id:id(40),name:'مورد التجربة'}],lastSuppliers:[{productId:id(31),supplierId:id(40),supplierName:'مورد التجربة'}]}}));
 await page.route('**/rest/v1/rpc/preview_inspected_sales_replacement_v2',r=>{body=r.request().postDataJSON().p_payload;return r.fulfill({json:{contractVersion:215,orderId:wizard215Order.id,previewFingerprint:seal,issuedQuantity:6,restockedQuantity:5,badQuantity:1,moneyDifferenceInMinorUnits:0,customerDebtDeltaInMinorUnits:0}});});
 await page.goto(harness+'?scenario=formed');await whole(page,'replace',true);await page.getByLabel('الخربان · توت',{exact:true}).fill('1');await expect(page.getByText('السليم الذي يرجع للمخزون: 4 باكيت',{exact:true})).toBeVisible();await expect(page.getByText('السليم الذي يرجع للمخزون: 1 باكيت',{exact:true})).toBeVisible();
 await page.getByLabel('فحصت الباكيتات الراجعة',{exact:true}).check();await page.getByRole('button',{name:'التالي',exact:true}).click();await page.getByRole('button',{name:'على المورد — بانتظار البديل',exact:true}).click();await expect(page.getByLabel('مورد توت',{exact:true})).toHaveValue(id(40));await expect(page.getByLabel('مورد برتقال',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'التالي',exact:true}).click();await page.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();
 await expect(page.getByTestId('aftercare215-preview')).toContainText('المعيب بانتظار المورد');expect(body?.items).toEqual([{sourceKind:'parcel_component',sourceId:id(21),quantity:5,goodQuantity:4,supplierId:id(40)},{sourceKind:'parcel_component',sourceId:id(22),quantity:1,goodQuantity:1,supplierId:null}]);
});
test('215 wizard prior replacement leaf stays distinct from the original physical buckets',async({page})=>{
 let body:Record<string,any>|undefined;await page.route('**/rest/v1/rpc/preview_inspected_sales_replacement_v2',r=>{body=r.request().postDataJSON().p_payload;return r.fulfill({json:{contractVersion:215,orderId:wizard215Order.id,previewFingerprint:seal,issuedQuantity:12,restockedQuantity:11,badQuantity:1,moneyDifferenceInMinorUnits:0,customerDebtDeltaInMinorUnits:0}});});
 await page.goto(harness+'?scenario=prior-leaf');await whole(page,'replace');await expect(page.getByText('البديل الذي أعطيته · 2 باكيت',{exact:true})).toBeVisible();await page.getByLabel('الخربان · عصير تجريبي',{exact:true}).nth(1).fill('1');await page.getByLabel('فحصت الباكيتات الراجعة',{exact:true}).check();await page.getByRole('button',{name:'التالي',exact:true}).click();await page.getByRole('button',{name:'خسارة عليّ — تالف نهائي',exact:true}).click();await page.getByRole('button',{name:'التالي',exact:true}).click();await page.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();
 await expect(page.getByTestId('aftercare215-preview')).toBeVisible();expect(body?.items).toEqual([{sourceKind:'base_order_item',sourceId:id(2),quantity:10,goodQuantity:10,supplierId:null},{sourceKind:'replacement_item',sourceId:id(23),quantity:2,goodQuantity:1,supplierId:null}]);
 expect(wizard215Scenario('prior-leaf').context.order.deadlineAt).toBe('2026-10-30T09:00:00Z');
});
for(const cheaper of [false,true])test(`215 wizard crossSKU ${cheaper?'refunds':'collects'} only actual difference through one sealed exchange`,async({page})=>{
 let previewBody:Record<string,any>|undefined;const writes:Array<Record<string,any>>=[],replacement=inventoryProducts[0],total=cheaper?'6000':'12000',credit=cheaper?'6000':'9000';
 const funding={newTotalInMinorUnits:total,internalCreditInMinorUnits:credit,moneyReceivedInMinorUnits:cheaper?'0':'3000',moneyRefundInMinorUnits:cheaper?'3000':'0',differenceMethod:'cliq'};
 await page.route('**/rest/v1/rpc/search_admin_products',r=>r.fulfill({json:[replacement]}));
 await page.route('**/rest/v1/rpc/preview_sales_exchange_v1',r=>{previewBody=r.request().postDataJSON().p_payload;return r.fulfill({json:{contractVersion:215,orderId:wizard215Order.id,previewFingerprint:seal,canConfirm:true,issues:[],goodQuantity:12,badQuantity:0,productId:replacement.id,productName:replacement.name_ar,baseQuantity:1,...funding,differenceInMinorUnits:cheaper?'-3000':'3000'}});});
 await page.route('**/rest/v1/rpc/settle_sales_exchange_v1',r=>{const b=r.request().postDataJSON();writes.push(b);return r.fulfill({json:{success:true,operationId:id(80),originalOrderId:wizard215Order.id,newOrderId:id(81),returnId:id(82),returnNumber:'SRT-EXCHANGE-215',newOrderNumber:'POS-EXCHANGE-215',referenceNumber:'DIFF-215',...funding}});});
 await page.goto(harness);await whole(page,'replace');await finishInspection(page);await page.getByRole('button',{name:'صنف آخر — مع فرق السعر',exact:true}).click();await page.locator(`[data-product-choice="${replacement.id}"]`).click();await page.getByLabel('كيف تسوّي فرق المال؟',{exact:true}).selectOption('cliq');await page.getByLabel('مرجع CliQ',{exact:true}).fill('DIFF-215');await page.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();
 const preview=page.getByTestId('aftercare215-preview');await expect(preview).toContainText((cheaper?'تعطي الزبون':'تقبض الآن')+' 3.000 د.أ');await expect(preview).toContainText('CliQ خارج الدرج');expect(writes).toHaveLength(0);expect(previewBody?.returnRequest.refundMethod).toBe('auto');expect(previewBody?.returnRequest.referenceNumber).toBe(null);expect(previewBody?.referenceNumber).toBe('DIFF-215');
 await page.getByRole('button',{name:'تأكيد الاستبدال',exact:true}).click();await expect(page.getByRole('status')).toContainText('تم الاستبدال');expect(writes).toHaveLength(1);expect(writes[0].p_payload).toEqual(previewBody);expect(writes[0].p_preview_fingerprint).toBe(seal);
});
