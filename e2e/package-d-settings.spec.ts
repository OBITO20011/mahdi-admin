import {test,expect} from './isolated-test';
const family='11111111-1111-4111-8111-111111111111',child='22222222-2222-4222-8222-222222222222';
test('owner saves exact parcel flavor/quantity and must confirm feature activation',async({page})=>{
  let featureState='OFF';let configuration:unknown=null;let allowedProductIds:string[]=[];let units=5;
  let writes=0;const context=()=>({featureState,products:[{familyProductId:family,nameAr:'عائلة الاختبار',sku:'D3',isFlavorMaster:true,unitsPerParcel:units,parcelPriceInMinorUnits:10000,
    configuration,allowedProductIds,components:[{productId:family,nameAr:'عائلة الاختبار',sku:'D3',flavorNameAr:null},{productId:child,nameAr:'نكهة الاختبار',sku:'D3-A',flavorNameAr:'نكهة الاختبار'}]}]});
  await page.route('**/rest/v1/rpc/get_admin_parcel_configuration_context_v1',route=>route.fulfill({json:context()}));
  await page.route('**/rest/v1/rpc/save_product_parcel_configuration_v1',route=>{
    const body=route.request().postDataJSON();expect(body).toEqual({p_family_product_id:family,p_composition_mode:'configurable_mix',p_is_active:true,p_units_per_parcel:6,p_allowed_product_ids:[child]});
    writes++;units=6;allowedProductIds=[child];configuration={id:'33333333-3333-4333-8333-333333333333',family_product_id:family,composition_mode:'configurable_mix',is_active:true,configuration_revision:1};
    return route.fulfill({json:{success:true,configuration,unitsPerParcel:units,allowedProductIds}});
  });
  await page.route('**/rest/v1/rpc/set_configurable_parcel_feature_state_v1',route=>{
    expect(route.request().postDataJSON()).toEqual({p_state:'ENABLED'});featureState='ENABLED';writes++;return route.fulfill({json:{success:true,feature_state:featureState}});
  });
  await page.goto('/e2e/package-d-settings-harness.html');
  await expect(page.getByText('حالة الطرود المرنة — متوقفة')).toBeVisible();expect(writes).toBe(0);
  await page.getByLabel('عدد القطع في الطرد').fill('6');await page.getByLabel('متاح للبيع كطرد').check();await page.getByLabel('نكهة الاختبار',{exact:true}).check();
  await page.getByRole('button',{name:'حفظ إعداد الطرد'}).click();await expect(page.getByRole('status')).toHaveText('تم حفظ إعداد الطرد.');
  await page.getByLabel('حالة الميزة',{exact:true}).selectOption('ENABLED');await expect(page.getByRole('button',{name:'تأكيد تغيير حالة الميزة'})).toBeDisabled();expect(writes).toBe(1);
  await page.getByLabel('أؤكد تغيير الحالة إلى مفعّلة للجميع').check();await page.getByRole('button',{name:'تأكيد تغيير حالة الميزة'}).click();
  await expect(page.getByText('حالة الطرود المرنة — مفعّلة للجميع')).toBeVisible();expect(writes).toBe(2);
});
test('non-owner cannot load or mutate configuration',async({page})=>{
  let calls=0;await page.route('**/rest/v1/rpc/*',route=>{calls++;return route.fulfill({status:403,json:{message:'forbidden'}});});
  await page.goto('/e2e/package-d-settings-harness.html?role=admin');await expect(page.getByRole('alert')).toHaveText('إعداد الطرود متاح للمالك فقط.');expect(calls).toBe(0);
});
test('uncertain settings save requires authoritative reload before another mutation',async({page})=>{
  let writes=0;
  const data={featureState:'OFF',products:[{familyProductId:family,nameAr:'صنف',sku:'D3',isFlavorMaster:false,unitsPerParcel:5,parcelPriceInMinorUnits:10000,
    configuration:null,allowedProductIds:[],components:[{productId:family,nameAr:'صنف',sku:'D3',flavorNameAr:null}]}]};
  await page.route('**/rest/v1/rpc/get_admin_parcel_configuration_context_v1',route=>route.fulfill({json:data}));
  await page.route('**/rest/v1/rpc/save_product_parcel_configuration_v1',route=>{writes++;return route.abort('failed');});
  await page.goto('/e2e/package-d-settings-harness.html');
  await page.getByRole('button',{name:'حفظ إعداد الطرد'}).click();await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button',{name:'حفظ إعداد الطرد'})).toBeDisabled();expect(writes).toBe(1);
  await page.getByRole('button',{name:'إعادة تحميل الإعداد'}).click();await expect(page.getByRole('button',{name:'حفظ إعداد الطرد'})).toBeEnabled();expect(writes).toBe(1);
});

test('missing packet price warns on active allowed flavors without blocking configuration',async({page})=>{
  const data={featureState:'OFF',products:[{familyProductId:family,nameAr:'عائلة',sku:'D',isFlavorMaster:true,
    unitsPerParcel:5,parcelPriceInMinorUnits:10000,configuration:{id:family,composition_mode:'configurable_mix',is_active:true,configuration_revision:1},
    allowedProductIds:[child],components:[{productId:child,nameAr:'نكهة ناقصة السعر',sku:'D-A',flavorNameAr:'نكهة',packetPriceInMinorUnits:0}]}]};
  await page.route('**/rest/v1/rpc/get_admin_parcel_configuration_context_v1',route=>route.fulfill({json:data}));
  await page.goto('/e2e/package-d-settings-harness.html');
  await expect(page.getByText('عبّي سعر الباكيت؛ بدونه لا يُحسب خصم ضرر العميل')).toBeVisible();
  await expect(page.getByText('نكهة ناقصة السعر — D-A')).toBeVisible();
  await expect(page.getByRole('button',{name:'حفظ إعداد الطرد'})).toBeEnabled();
});

test('carton product with missing packet price shows a non-blocking warning',async({page})=>{
  await page.goto('/e2e/admin-mobile-ux-harness.html?view=barcode-edit&missingPacketPrice=1');
  await expect(page.getByText('عبّي سعر الباكيت؛ بدونه لا يُحسب خصم ضرر العميل')).toBeVisible();
  await expect(page.getByRole('button',{name:'حفظ التعديلات',exact:true})).toBeEnabled();
});
