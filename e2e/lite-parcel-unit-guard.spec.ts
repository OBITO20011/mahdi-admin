import {test,expect} from './isolated-test';
import {formatJod} from '../customer-web/src/utils/money';
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
 const parcel=page.getByRole('region',{name:'إضافة صندوق',exact:true});await expect(parcel).toContainText(formatJod(7700));await parcel.getByRole('button',{name:/إلى السلة/}).tap();await expect(page.locator('html')).toHaveAttribute('data-parcel-added','true');
});

test('71 flavor families filter immediately by Arabic name variants or partial SKU on touch mobile',async({page})=>{
 const families=Array.from({length:71},(_,i)=>({familyProductId:'94300000-0000-4000-8000-'+String(500+i).padStart(12,'0'),nameAr:i===0?'ألواح توداي':i===1?'كرتونة حلوى':i===2?'إيس كريم':'عائلة وهمية '+i,sku:i===0?'NW-0268':'TEST-FAMILY-'+i,isFlavorMaster:true,unitsPerParcel:1,parcelPriceInMinorUnits:1100,configuration:null,allowedProductIds:[],components:[{productId:flavor,nameAr:'نكهة وهمية',sku:'TEST-F',flavorNameAr:'نكهة وهمية',packetPriceInMinorUnits:1100}]}));
 await page.route('**/rest/v1/rpc/get_admin_parcel_configuration_context_v1',r=>r.fulfill({json:{featureState:'ENABLED',products:families}}));
 await page.goto('/e2e/lite-parcel-unit-guard-harness.html');const search=page.getByRole('searchbox',{name:'بحث العائلات',exact:true}),choice=page.getByRole('combobox',{name:'الصنف / العائلة',exact:true});
 await expect(choice.locator('option:not([disabled])')).toHaveCount(71);await expect(search).toBeVisible();expect(await search.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
 for(const query of ['توداي','0268','الواح','إلواح','آلواح']){await search.fill(query);await expect(choice.locator('option:not([disabled])')).toHaveText(['ألواح توداي — NW-0268']);}
 await choice.selectOption(families[0].familyProductId);await search.fill('كرتونه');await expect(choice.locator('option:not([disabled])')).toHaveText(['كرتونة حلوى — TEST-FAMILY-1']);
 await choice.selectOption(families[1].familyProductId);await expect(page.getByRole('status')).toContainText('العائلة المحددة: كرتونة حلوى');
 await search.fill('حلوي');await expect(choice.locator('option:not([disabled])')).toHaveCount(1);await search.fill('ايس');await expect(choice.locator('option:not([disabled])')).toHaveText(['إيس كريم — TEST-FAMILY-2']);
 await search.fill('غير موجود');await expect(choice).toHaveValue('');await expect(choice).toContainText('لا توجد عائلة مطابقة');await search.clear();await expect(choice.locator('option:not([disabled])')).toHaveCount(71);
});

for(const kind of ['flavor','ordinary'])test(`OFF product form adds a ${kind} parcel with explicit price confirmation`,async({page})=>{
 const writes:Record<string,unknown>[]=[];
 const packet='88888888-8888-4888-8888-000000000121',box='88888888-8888-4888-8888-000000000124';
 await page.route('**/rest/v1/units?**',route=>{
  const name=new URL(route.request().url()).searchParams.get('name_ar');
  return route.fulfill({json:[{id:name==='eq.صندوق'?box:packet}]});
 });
 await page.route('**/rpc/update_product_master_v5',route=>{
  const body=route.request().postDataJSON();writes.push(body);
  return route.fulfill({json:{success:true,productId:body.p_product_id,updatedAt:'2026-11-12T08:01:00Z'}});
 });
 await page.goto('/e2e/package-f-products-harness.html?sales-only&'+(kind==='flavor'?'flavor-parcel&family':'unit-parcel'));
 await page.evaluate(async kind=>{
  // @ts-expect-error Isolated Vite module.
  const {storeEngine}=await import('/src/stores/useAppStore.ts');
  const family=kind==='flavor'?storeEngine.getState().products.find((p:{isFlavorMaster?:boolean})=>p.isFlavorMaster):storeEngine.getState().products[0];
  storeEngine.openModal('edit_product',family);
 },kind);
 const form=page.getByRole('dialog');
 const add=form.getByRole('checkbox',{name:'هاد السعر سعر حبة، بدي أضيف طرد',exact:true});
 await add.check();
 const pack=form.getByLabel('وحدة بيع الطرد المضاف',{exact:false});
 await expect(pack).toHaveValue('طرد');await expect(pack.locator('option[value="باكيت"]')).toHaveCount(0);
 await pack.selectOption('صندوق');await form.getByLabel('عدد وحدات الطرد المضاف',{exact:false}).fill('7');
 const confirm=form.getByRole('checkbox',{name:/أؤكد سعر الطرد/});
 await expect(confirm).toHaveAccessibleName(kind==='flavor'?/7\.700.*1\.100/:/5\.950.*0\.850/);
 await form.getByRole('button',{name:'حفظ التعديلات',exact:true}).tap();
 await expect(form.getByText(/وأكّد سعر الطرد/)).toBeVisible();expect(writes).toHaveLength(0);
 await confirm.check();await form.getByLabel('عدد وحدات الطرد المضاف',{exact:false}).fill('8');
 await expect(confirm).not.toBeChecked();await form.getByLabel('عدد وحدات الطرد المضاف',{exact:false}).fill('7');
 await confirm.check();await form.getByRole('button',{name:'حفظ التعديلات',exact:true}).tap();
 await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0]).toMatchObject({p_unit_id:packet,p_sale_unit_id:box,p_units_per_sale_unit:7,p_default_sale_price_in_minor_units:kind==='flavor'?7700:5950,p_parcel_only:false});
});

test('OFF added parcel displays packet850 and parcel20400 in store and POS;admin single price uses its unit',async({page})=>{
 await page.goto('/e2e/lite-parcel-unit-guard-harness.html?view=store&added');
 await expect(page.getByRole('region',{name:'إضافة باكيت',exact:true})).toContainText(formatJod(850));
 await expect(page.getByRole('region',{name:'إضافة طرد',exact:true})).toContainText(formatJod(20400));
 await expect(page.getByText('طرد (٢٤ باكيت)',{exact:false}).first()).toBeVisible();
 await page.goto('/e2e/lite-parcel-unit-guard-harness.html?view=pos&added');
 await expect(page.locator('[data-pos-add-method="base_unit"]')).toContainText('0.850');
 await expect(page.locator('[data-pos-add-method="legacy_single_sku_parcel"]')).toContainText('20.400');
 await page.goto('/e2e/package-f-products-harness.html?sales-only&unit-parcel');
 const card=page.locator('[data-product-catalog-card]').first();
 await expect(card).toContainText('وحدة البيع');await expect(card).toContainText('باكيت');await expect(card).toContainText('0.850');
 await expect(card).not.toContainText('سعر الطرد');
});
