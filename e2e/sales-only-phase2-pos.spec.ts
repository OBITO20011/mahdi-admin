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
