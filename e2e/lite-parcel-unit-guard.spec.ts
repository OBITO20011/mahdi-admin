import {test,expect} from './isolated-test';
test.use({hasTouch:true});
test.beforeEach(async({page})=>{await page.setViewportSize({width:390,height:844});});
const family='94300000-0000-4000-8000-000000000100',flavor='94300000-0000-4000-8000-000000000101',unit='94300000-0000-4000-8000-000000000120';
async function fixture(page:import('@playwright/test').Page,options:{units?:number;sale?:string;parcelPrice?:number;unitPrice?:number}={}){
 const writes:Record<string,unknown>[]=[];const units=options.units??1;
 await page.route('**/rest/v1/rpc/get_admin_parcel_configuration_context_v1',r=>r.fulfill({json:{featureState:'ENABLED',products:[{familyProductId:family,nameAr:'عائلة اختبار وهمية',sku:'TEST-PARCEL',isFlavorMaster:true,unitsPerParcel:units,parcelPriceInMinorUnits:options.parcelPrice??1100,configuration:null,allowedProductIds:[],components:[{productId:flavor,nameAr:'نكهة وهمية',sku:'TEST-PARCEL-F',flavorNameAr:'نكهة وهمية',packetPriceInMinorUnits:1100}]}]}}));
 await page.route('**/rest/v1/rpc/search_admin_products',r=>r.fulfill({json:[{id:family,sku:'TEST-PARCEL',name_ar:'عائلة اختبار وهمية',is_active:true,is_flavor_master:true,unit_id:unit,sale_unit_id:unit,base_unit:{id:unit,name_ar:'باكيت',code:'PKT'},sale_unit:{id:options.sale?unit.slice(0,-1)+'1':unit,name_ar:options.sale??'باكيت',code:options.sale?'BOX':'PKT'},units_per_purchase_unit:1,units_per_sale_unit:units,default_sale_price_in_minor_units:options.parcelPrice??1100,sale_price_in_minor_units:options.unitPrice??1100,parcel_only:false}]}));
 await page.route('**/rest/v1/rpc/save_product_parcel_configuration_v1',r=>{const args=r.request().postDataJSON();writes.push(args);return r.fulfill({json:{success:true,configuration:{family_product_id:family,composition_mode:'configurable_mix',is_active:args.p_is_active},unitsPerParcel:args.p_units_per_parcel,allowedProductIds:args.p_allowed_product_ids}});});
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

for(const scenario of [{name:'same content/sale unit',sale:undefined,parcelPrice:7700,unitPrice:1100},{name:'same packet/parcel price',sale:'صندوق',parcelPrice:1100,unitPrice:1100}])test('OFF refuses activation: '+scenario.name,async({page})=>{
 const writes=await fixture(page,{units:7,...scenario});await page.goto('/e2e/lite-parcel-unit-guard-harness.html');
 await page.getByRole('checkbox',{name:'الطرد المشكّل مفعّل للبيع',exact:true}).check();
 await page.getByRole('checkbox',{name:'نكهة وهمية',exact:true}).check();
 await page.getByRole('button',{name:'حفظ إعداد الطرد',exact:true}).tap();
 await expect(page.getByRole('alert')).toContainText('نموذج المنتج');expect(writes).toHaveLength(0);
});
test('OFF converted product saves flavors without rewriting capacity or price',async({page})=>{
 const writes=await fixture(page,{units:7,sale:'صندوق',parcelPrice:7700,unitPrice:1100});await page.goto('/e2e/lite-parcel-unit-guard-harness.html');
 await page.getByRole('checkbox',{name:'الطرد المشكّل مفعّل للبيع',exact:true}).check();await page.getByRole('checkbox',{name:'نكهة وهمية',exact:true}).check();
 await page.getByRole('button',{name:'حفظ إعداد الطرد',exact:true}).tap();await expect(page.getByText('تم حفظ إعداد الطرد.',{exact:true})).toBeVisible();
 expect(writes).toEqual([{p_family_product_id:family,p_composition_mode:'configurable_mix',p_is_active:true,p_units_per_parcel:7,p_allowed_product_ids:[flavor]}]);
});
test('ON preserves the existing editable configuration writer',async({page})=>{
 const writes=await fixture(page);await page.goto('/e2e/lite-parcel-unit-guard-harness.html?full');
 const input=page.getByLabel('كم حبة بالطرد');await expect(input).toHaveJSProperty('readOnly',false);await input.fill('7');
 await page.getByRole('button',{name:'حفظ إعداد الطرد',exact:true}).tap();await expect(page.getByText('تم حفظ إعداد الطرد.',{exact:true})).toBeVisible();expect(writes[0].p_units_per_parcel).toBe(7);
});
test('unverified operating mode cannot save parcel configuration',async({page})=>{
 const writes=await fixture(page);await page.goto('/e2e/lite-parcel-unit-guard-harness.html?unverified');await expect(page.getByRole('button',{name:'حفظ إعداد الطرد',exact:true})).toBeDisabled();expect(writes).toHaveLength(0);
});

test('OFF store details block the inconsistent parcel while a single packet remains buyable',async({page})=>{
 await page.goto('/e2e/lite-parcel-unit-guard-harness.html?view=store');
 await expect(page.getByText('باكيت (٧ باكيت)',{exact:false})).toHaveCount(0);
 const parcel=page.getByRole('region',{name:'إضافة طرد',exact:true}),single=page.getByRole('region',{name:'إضافة باكيت',exact:true});
 await expect(parcel.getByRole('button',{name:/إلى السلة/})).toBeDisabled();await single.getByRole('button',{name:/إلى السلة/}).tap();
 await expect(page.locator('html')).toHaveAttribute('data-unit-added','true');await expect(page.locator('html')).not.toHaveAttribute('data-parcel-added','true');
});
test('OFF converted store parcel is named صندوق and can be added at its unchanged price',async({page})=>{
 await page.goto('/e2e/lite-parcel-unit-guard-harness.html?view=store&valid');
 const parcel=page.getByRole('region',{name:'إضافة صندوق',exact:true});await expect(parcel).toContainText('7.700');await parcel.getByRole('button',{name:/إلى السلة/}).tap();await expect(page.locator('html')).toHaveAttribute('data-parcel-added','true');
});
