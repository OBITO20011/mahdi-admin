import {test,expect,type Page} from './isolated-test';
import {posFixtureIds,posFixtureProducts} from './package-f-pos.fixture';
test.use({hasTouch:true});
const endpoint='**/rest/v1/rpc/lite1_pos2';
const fixture='/e2e/package-f-pos-harness.html?sales-only&toast';
const checkout=(page:Page)=>page.locator('[data-testid="pos-complete-sale"]:visible');
const product=(page:Page)=>page.locator(`[data-pos-product-card="${posFixtureProducts[0].id}"]`);
async function availability(page:Page,available=true){
 await page.route('**/rest/v1/rpc/lite1_product_availability2',route=>route.fulfill({json:{contractVersion:'sales-only-availability2-v1',fullAccounting:false,
  products:(route.request().postDataJSON().p_product_ids as string[]).map(productId=>({productId,available,effectiveAvailable:available,active:true,revision:0,flavorMasterProductId:null,parentAvailable:true}))}}));
}
test('completed lite POS renders existing receipt and shares its public link to WhatsApp without another sale',async({page})=>{
 await page.setViewportSize({width:390,height:1000});await availability(page);let writes=0;
 const orderId='92600000-0000-4000-8000-000000000931',token='92600000-0000-4000-8000-000000000932';
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'share',{configurable:true,value:undefined});
  window.open=(url)=>{Object.assign(window,{__LITE_SHARED_URL__:String(url)});return null;};
 });
 await page.route('**/rest/v1/orders?*',r=>r.fulfill({json:{created_at:'2026-11-10T05:00:00Z',order_items:[]}}));
 await page.route('**/rpc/get_or_create_pos_receipt_token',r=>r.fulfill({json:{success:true,receiptToken:token}}));
 await page.route(endpoint,r=>{
  writes++;const request=r.request().postDataJSON().p_request;
  expect(request.lines).toEqual([{commercial_line_kind:'legacy_single_sku_parcel',product_id:posFixtureProducts[0].id,parcel_quantity:1,units_per_parcel:24}]);
  return r.fulfill({json:{success:true,accountingTracked:false,unavailableConfirmed:[],operationId:'92600000-0000-4000-8000-000000000933',orderId,orderNumber:'POS-LITE-931',warehouseId:posFixtureIds.warehouse,branchId:posFixtureIds.branch,customerName:'زبون نقدي',idempotentReplay:false,subtotalInMinorUnits:21600,discountInMinorUnits:0,totalInMinorUnits:21600,amountPaidInMinorUnits:21600,changeDueInMinorUnits:0,paymentMethod:'cash',paymentStatus:'paid',items:[{id:'92600000-0000-4000-8000-000000000934',productId:posFixtureProducts[0].id,productName:posFixtureProducts[0].name_ar,sku:posFixtureProducts[0].sku,salePackage:'طرد',commercialLineKind:'legacy_single_sku_parcel',quantity:1,baseQuantity:24,unitsPerSalePackage:24,unitPriceInMinorUnits:21600,lineTotalInMinorUnits:21600,allocatedDiscountInMinorUnits:0,netRefundableAmountInMinorUnits:21600,accountingTracked:false,parcelInstances:[]}]}});
 });
 await page.goto(fixture+'&no-mix');await product(page).tap();await checkout(page).tap();
 const receipt=page.getByRole('dialog',{name:'إيصال البيع',exact:true});await expect(receipt).toContainText('POS-LITE-931');await expect(receipt).toContainText('21.600');await expect(receipt).not.toContainText(/تكلفة|ربح/);
 await receipt.getByRole('button',{name:'مشاركة الوصل',exact:true}).tap();
 const shared=await page.evaluate(()=>(window as unknown as {__LITE_SHARED_URL__?:string}).__LITE_SHARED_URL__);
 expect(shared).toBeTruthy();const url=new URL(shared!);expect(url.origin).toBe('https://api.whatsapp.com');
 expect(url.searchParams.get('text')).toContain('#receipt='+token);expect(url.searchParams.get('text')).toContain('POS-LITE-931');expect(writes).toBe(1);
 await receipt.getByRole('button',{name:'إغلاق الإيصال',exact:true}).tap();await expect(checkout(page)).toBeDisabled();expect(writes).toBe(1);
});
for(const width of [390,1440])test(`lite POS ${width}:zero stock adds immediately;unknown recovery keeps route/body/key across later full mode`,async({page})=>{
 await page.setViewportSize({width,height:1000});await availability(page);
 const requests:Record<string,unknown>[]=[];await page.route(endpoint,async route=>{requests.push(route.request().postDataJSON());await route.abort('failed');});
 await page.goto(fixture+'&no-mix');await expect(product(page)).toBeEnabled();await product(page).tap();
 await expect(checkout(page)).toContainText('21.600');await checkout(page).tap();await expect.poll(()=>requests.length).toBe(1);
 const first=requests[0];expect(first.p_request).toMatchObject({amountReceivedInMinorUnits:21600,paymentMethod:'cash'});
 expect(first.p_request).not.toHaveProperty('accountingMode');expect(first.p_request).not.toHaveProperty('unavailableConfirmed');
 const stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('nawasrah:pos-v2:attempt:v1:11111111-1111-4111-8111-111111111111')??'null'));
 await expect.poll(async()=>(await stored())?.status).toBe('OUTCOME_UNKNOWN');expect((await stored()).request.accountingMode).toBe('sales-only');
 await page.goto('/e2e/package-f-pos-harness.html?toast&no-mix');await page.getByRole('button',{name:'استرجاع محاولة البيع',exact:true}).tap();
 await expect.poll(()=>requests.length).toBe(2);expect(requests[1]).toEqual(first);await expect.poll(async()=>(await stored())?.status).toBe('OUTCOME_UNKNOWN');
});
test('lite unavailable product requires explicit acknowledgement;cancel never sends sale',async({page})=>{
 await page.setViewportSize({width:390,height:1000});await availability(page,false);
 const requests:Record<string,unknown>[]=[];await page.route(endpoint,async route=>{requests.push(route.request().postDataJSON());await route.abort('failed');});
 await page.goto(fixture+'&no-mix');await product(page).tap();await checkout(page).tap();
 const dialog=page.getByRole('dialog',{name:'تأكيد بيع صنف غير متوفر'});await expect(dialog).toContainText(posFixtureProducts[0].name_ar);expect(requests).toHaveLength(0);
 await dialog.getByRole('button',{name:'العودة للسلة دون بيع'}).tap();expect(requests).toHaveLength(0);
 await checkout(page).tap();await dialog.getByRole('button',{name:'أؤكد بيع الأصناف غير المتوفرة'}).tap();
 await expect.poll(()=>requests.length).toBe(1);expect(requests[0].p_request).toMatchObject({unavailableConfirmed:[posFixtureProducts[0].id]});
});
test('lite availability read failure and unverified mode do not start or erase a sale',async({page})=>{
 await page.setViewportSize({width:390,height:1000});await page.route('**/rest/v1/rpc/lite1_product_availability2',route=>route.fulfill({status:503,json:{message:'unavailable'}}));
 let writes=0;await page.route(endpoint,async route=>{writes++;await route.abort('failed');});
 await page.goto(fixture+'&no-mix');await product(page).tap();await checkout(page).tap();
 await expect(page.getByRole('alert').filter({hasText:'لم نرسل بيعاً'})).toBeVisible();expect(writes).toBe(0);await expect(checkout(page)).toContainText('21.600');
 expect(await page.evaluate(()=>localStorage.getItem('nawasrah:pos-v2:attempt:v1:'+ '11111111-1111-4111-8111-111111111111'))).toBeNull();
 await page.goto(fixture+'&unverified');await expect(product(page)).toBeDisabled();expect(writes).toBe(0);
});
test('lite mixed builder enforces real parcel capacity without stock;uses same commercial lines',async({page})=>{
 await page.setViewportSize({width:390,height:1000});await availability(page);
 const requests:Record<string,unknown>[]=[];await page.route(endpoint,async route=>{requests.push(route.request().postDataJSON());await route.abort('failed');});
 await page.goto(fixture);await page.getByRole('button',{name:'تركيب طرد: طرد شيبس مشكّل',exact:true}).tap();
 const dialog=page.getByRole('dialog',{name:'تركيب طرد: طرد شيبس مشكّل'});
 await dialog.getByLabel('كمية عينة').fill('10');await dialog.getByLabel('كمية شطة').fill('19');await expect(dialog.getByRole('button',{name:'إضافة الطرد المكتمل'})).toBeDisabled();
 await dialog.getByLabel('كمية شطة').fill('20');await dialog.getByRole('button',{name:'إضافة الطرد المكتمل'}).tap();
 await checkout(page).tap();await expect.poll(()=>requests.length).toBe(1);
 expect(requests[0].p_request).toMatchObject({lines:[{commercial_line_kind:'configurable_parcel',configuration_revision:3,
  parcel_instances:[{components:[{product_id:posFixtureProducts[2].id,base_quantity:10},{product_id:posFixtureProducts[3].id,base_quantity:20}]}]}]});
 expect(posFixtureIds.actor).toBe('11111111-1111-4111-8111-111111111111');
});
