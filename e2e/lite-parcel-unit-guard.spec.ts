import {test,expect} from './isolated-test';
test.use({hasTouch:true});
const family='94300000-0000-4000-8000-000000000100',flavor='94300000-0000-4000-8000-000000000101',unit='94300000-0000-4000-8000-000000000120';
async function fixture(page:import('@playwright/test').Page){
 const writes:Record<string,unknown>[]=[];
 await page.route('**/rest/v1/rpc/get_admin_parcel_configuration_context_v1',r=>r.fulfill({json:{featureState:'ENABLED',products:[{familyProductId:family,nameAr:'عائلة اختبار وهمية',sku:'TEST-PARCEL',isFlavorMaster:true,unitsPerParcel:1,parcelPriceInMinorUnits:1100,configuration:null,allowedProductIds:[],components:[{productId:flavor,nameAr:'نكهة وهمية',sku:'TEST-PARCEL-F',flavorNameAr:'نكهة وهمية',packetPriceInMinorUnits:1100}]}]}}));
 await page.route('**/rest/v1/rpc/search_admin_products',r=>r.fulfill({json:[{id:family,sku:'TEST-PARCEL',name_ar:'عائلة اختبار وهمية',is_active:true,is_flavor_master:true,unit_id:unit,sale_unit_id:unit,base_unit:{id:unit,name_ar:'باكيت',code:'PKT'},sale_unit:{id:unit,name_ar:'باكيت',code:'PKT'},units_per_purchase_unit:1,units_per_sale_unit:1,default_sale_price_in_minor_units:1100,sale_price_in_minor_units:1100,parcel_only:false}]}));
 await page.route('**/rest/v1/rpc/save_product_parcel_configuration_v1',r=>{writes.push(r.request().postDataJSON());return r.fulfill({json:{success:true,configuration:{family_product_id:family,composition_mode:'configurable_mix',is_active:false},unitsPerParcel:7,allowedProductIds:[]}});});
 return writes;
}
test('OFF real modal dispatcher keeps capacity in product definition, not flavor configuration',async({page})=>{
 await fixture(page);await page.goto('/e2e/lite-parcel-unit-guard-harness.html');
 await expect(page.getByLabel('كم حبة بالطرد')).toHaveJSProperty('readOnly',true);
 await expect(page.getByText(/عدد الطرد.*نموذج المنتج/)).toBeVisible();
});
test('OFF forged capacity cannot invoke save RPC after the owner rename-to-packet path',async({page})=>{
 const writes=await fixture(page);await page.goto('/e2e/lite-parcel-unit-guard-harness.html');
 const input=page.getByLabel('كم حبة بالطرد');await input.evaluate(el=>(el as HTMLInputElement).readOnly=false);await input.fill('7');
 await page.getByRole('button',{name:'حفظ إعداد الطرد',exact:true}).tap();
 await expect(page.getByRole('alert')).toContainText(/نموذج المنتج/);expect(writes).toHaveLength(0);
});
test('OFF POS never describes a multi-unit package with its content unit name',async({page})=>{
 await page.goto('/e2e/lite-parcel-unit-guard-harness.html?view=pos');
 await expect(page.getByText('باكيت (7 باكيت)',{exact:true})).toHaveCount(0);
 await expect(page.locator('[data-pos-add-method="legacy_single_sku_parcel"]')).toBeDisabled();
 await expect(page.locator('[data-pos-add-method="base_unit"]')).toBeEnabled();
});
