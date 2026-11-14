import {test,expect,type Page} from './isolated-test';
import {posFixtureProducts} from './package-f-pos.fixture';
test.describe.configure({retries:0});
test.use({hasTouch:true,viewport:{width:390,height:844}});
const productId=posFixtureProducts[0].id;
const checkout=(page:Page)=>page.locator('[data-testid="pos-complete-sale"]:visible');
async function setup(page:Page,options:{shortage?:boolean;readFailure?:boolean;full?:boolean}={}){
 const requests:Record<string,unknown>[]=[],checks:Record<string,unknown>[]=[];
 await page.route('**/rpc/lite1_product_availability2',route=>route.fulfill({json:{contractVersion:'sales-only-availability2-v1',fullAccounting:false,
  products:[{productId,available:true,effectiveAvailable:true,active:true,revision:0,flavorMasterProductId:null,parentAvailable:true}]}}));
 await page.route('**/rpc/lite3_pos_quantity_check223',route=>{
  checks.push(route.request().postDataJSON());
  if(options.readFailure)return route.fulfill({status:503,json:{message:'isolated quantity reader unavailable'}});
  return route.fulfill({json:{contractVersion:'optional-quantity223-v1',fullAccounting:false,shortages:options.shortage?[{productId,name:posFixtureProducts[0].name_ar,unitName:'باكيت',quantity:3,required:24,revision:7}]:[]}});
 });
 await page.route('**/rpc/lite1_pos2',async route=>{requests.push(route.request().postDataJSON());await route.abort('connectionreset');});
 await page.route('**/rpc/create_pos_sale_v2',async route=>{requests.push(route.request().postDataJSON());await route.abort('connectionreset');});
 await page.goto('/e2e/package-f-pos-harness.html?toast&no-mix&counter-quantity'+(options.full?'':'&sales-only'));
 await page.locator(`[data-pos-product-card="${productId}"]`).tap();
 return {requests,checks};
}
test('OFF shortage displays actual required/base quantity and requires explicit confirmation;cancel sends no sale',async({page},info)=>{
 const c=await setup(page,{shortage:true});await checkout(page).tap();
 const dialog=page.getByRole('dialog',{name:'تأكيد بيع صنف غير متوفر'});
 await expect(dialog).toContainText('المطلوب 24 باكيت، متبقي 3 باكيت');
 await expect(dialog).toContainText('يتوقف العدّاد عند صفر مع تسجيل النقص');
 expect(c.requests).toHaveLength(0);expect(c.checks).toHaveLength(1);
 await page.screenshot({path:info.outputPath('quantity-shortage-confirmation.png'),fullPage:true});
 await dialog.getByRole('button',{name:'العودة للسلة دون بيع'}).tap();expect(c.requests).toHaveLength(0);
 await checkout(page).tap();await dialog.getByRole('button',{name:'أؤكد بيع الأصناف غير المتوفرة'}).tap();
 await expect.poll(()=>c.requests.length).toBe(1);
 expect(c.requests[0].p_request).toMatchObject({unavailableConfirmed:[productId],amountReceivedInMinorUnits:21600,
  lines:[{commercial_line_kind:'legacy_single_sku_parcel',product_id:productId,parcel_quantity:1,units_per_parcel:24}]});
});
test('untracked/adequate OFF product keeps the original request and recovery key without a shortage acknowledgement',async({page})=>{
 const c=await setup(page);await checkout(page).tap();await expect.poll(()=>c.requests.length).toBe(1);
 expect(c.checks).toHaveLength(1);expect(c.requests[0].p_request).not.toHaveProperty('unavailableConfirmed');
 const first=c.requests[0];await page.getByRole('button',{name:'استرجاع محاولة البيع',exact:true}).tap();
 await expect.poll(()=>c.requests.length).toBe(2);expect(c.requests[1]).toEqual(first);
 expect(c.checks).toHaveLength(1);
});
test('failed OFF quantity read preserves the cart and sends no financial request',async({page})=>{
 const c=await setup(page,{readFailure:true});await checkout(page).tap();
 await expect(page.getByRole('alert').filter({hasText:'لم نرسل بيعاً'})).toBeVisible();
 expect(c.requests).toHaveLength(0);expect(c.checks).toHaveLength(1);await expect(checkout(page)).toContainText('21.600');
});
test('ON checkout never reads optional quantities or adds a counter confirmation',async({page})=>{
 const c=await setup(page,{full:true,shortage:true});await checkout(page).tap();await expect.poll(()=>c.requests.length).toBe(1);
 expect(c.checks).toHaveLength(0);expect(c.requests[0]).toHaveProperty('p_lines');expect(JSON.stringify(c.requests[0])).not.toContain('unavailableConfirmed');
});
