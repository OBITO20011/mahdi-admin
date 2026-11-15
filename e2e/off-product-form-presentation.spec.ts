import {test,expect,type Page} from './isolated-test';

const packet='88888888-8888-4888-8888-000000000121',parcel='88888888-8888-4888-8888-000000000122';
async function editor(page:Page,{added=false,full=false,family=false,feature='OFF'}={}){
  const writes:Record<string,unknown>[]=[],featureWrites:string[]=[];
  await page.route('**/rest/v1/units?**',route=>{
    const name=new URL(route.request().url()).searchParams.get('name_ar');
    return route.fulfill({json:[{id:name==='eq.باكيت'?packet:parcel}]});
  });
  await page.route('**/rpc/update_product_master_v6',route=>{
    const args=route.request().postDataJSON();writes.push(args);
    return route.fulfill({json:{success:true,productId:args.p_product_id,updatedAt:'2026-11-15T00:00:01Z'}});
  });
  await page.route('**/rpc/set_configurable_parcel_feature_state_v1',route=>{
    const args=route.request().postDataJSON();featureWrites.push(args.p_state);
    return route.fulfill({json:{success:true,feature_state:args.p_state}});
  });
  await page.goto('/e2e/package-f-products-harness.html?realDialogs&'+(full?'':'sales-only&')+(added?'unit-parcel':'independent-prices'));
  await page.evaluate(async({added,family,feature})=>{
    // @ts-expect-error Isolated Vite module.
    const {storeEngine}=await import('/src/stores/useAppStore.ts');
    // @ts-expect-error Isolated Vite module.
    const {supabase}=await import('/src/lib/supabase.ts');
    const state=storeEngine.getState();
    const product=family?state.products.find((p:{isFlavorMaster?:boolean})=>p.isFlavorMaster):state.products[0];
    Object.assign(product,{unit:'باكيت',retailPrice:1.9,wholesalePrice:1.9,
      salePackage:added?'باكيت':'طرد',purchasePackage:added?'باكيت':'طرد',
      unitsPerPackage:added?1:8,unitsPerSalePackage:added?1:8,salePackagePrice:added?1.9:15.2,
      parcelOnly:false,baseUnitId:'88888888-8888-4888-8888-000000000121',
      saleUnitId:added?'88888888-8888-4888-8888-000000000121':'88888888-8888-4888-8888-000000000122'});
    let currentFeature=feature;
    const original=supabase.rpc.bind(supabase);
    supabase.rpc=(name:string,args?:Record<string,unknown>)=>{
      if(name==='get_admin_parcel_configuration_context_v1')return Promise.resolve({data:{
        featureState:currentFeature,products:state.products.filter((p:{isFlavorMaster?:boolean})=>p.isFlavorMaster)
          .map((p:{id:string;nameAr:string;sku:string})=>({
            familyProductId:p.id,nameAr:p.nameAr,sku:p.sku,isFlavorMaster:true,unitsPerParcel:8,parcelPriceInMinorUnits:15200,
            configuration:null,allowedProductIds:[],
            components:state.products.filter((f:{flavorMasterProductId?:string})=>f.flavorMasterProductId===p.id)
              .map((f:{id:string;nameAr:string;sku:string;flavorNameAr?:string})=>({
                productId:f.id,nameAr:f.nameAr,sku:f.sku,flavorNameAr:f.flavorNameAr??null,packetPriceInMinorUnits:1900,
              })),
          })),
      },error:null});
      if(name==='set_configurable_parcel_feature_state_v1')return Promise.resolve(original(name,args))
        .then((result:{error:unknown})=>{if(!result.error)currentFeature=String(args?.p_state);return result;});
      return original(name,args);
    };
    storeEngine.openModal('edit_product',product);
  },{added,family,feature});
  const form=page.getByRole('dialog');
  await expect(form.getByRole('button',{name:'حفظ التعديلات',exact:true})).toBeVisible();
  return {form,writes,featureWrites};
}

for(const width of [390,1280]){
  test('OFF regular parcel feedback, formatting, and unchanged writer at '+width,async({page},testInfo)=>{
    await page.setViewportSize({width,height:900});
    const {form,writes}=await editor(page);
    const price=form.getByLabel('سعر بيع الطرد',{exact:true});
    const feedback=form.locator('[data-off-parcel-price-summary]');
    await expect(feedback).toContainText('8 باكيت × 1.900 = 15.200 د.أ');
    await expect(feedback).toContainText('بدون خصم');
    await price.fill('14');await price.blur();
    await expect(price).toHaveValue('14.000');
    await expect(feedback).toContainText('خصم 1.200 د.أ — باكيت داخل الطرد بـ1.750');
    await expect(feedback.getByText(/خصم/)).toHaveClass(/text-nw-ok/);
    await price.fill('15.201');await price.blur();
    await expect(form.getByRole('button',{name:'حفظ التعديلات',exact:true})).toBeDisabled();
    await expect(feedback.getByRole('alert')).toContainText('سعر الطرد لا يتجاوز');
    expect(writes).toHaveLength(0);
    await form.getByRole('button',{name:'احسب الطرد = العدد × سعر باكيت',exact:true}).click();
    await expect(price).toHaveValue('15.200');
    await expect(feedback).toContainText('بدون خصم');
    await price.fill('14');await price.blur();
    await form.getByRole('checkbox',{name:/أؤكد سعر باكيت/}).check();
    await price.scrollIntoViewIfNeeded();
    await page.screenshot({path:testInfo.outputPath('product-prices-'+width+'.png')});
    await form.getByRole('button',{name:'حفظ التعديلات',exact:true}).click();
    await expect.poll(()=>writes.length).toBe(1);
    expect(writes[0]).toMatchObject({p_sale_price_in_minor_units:1900,p_default_sale_price_in_minor_units:14000,p_units_per_sale_unit:8,p_parcel_only:false});
  });

  test('OFF added parcel shows the multiplication, reciprocal units, and blocks conflict at '+width,async({page},testInfo)=>{
    await page.setViewportSize({width,height:900});
    const {form,writes}=await editor(page,{added:true});
    const identity=form.getByTestId('product-identity-fields');
    await expect(identity.getByLabel('وصف المنتج',{exact:true})).toBeVisible();
    await expect(identity.getByRole('button',{name:'اختيار صورة المنتج',exact:true})).toBeVisible();
    await expect(form.getByText('أو استخدام رابط صورة مباشر',{exact:true})).toHaveCount(0);
    await expect(form.getByRole('checkbox',{name:'طرد بيع مختلف عن طرد الشراء',exact:true})).toHaveCount(0);
    await form.getByText('متقدم: التغليف والعلامة التجارية',{exact:true}).click();
    await expect(form.getByLabel('العلامة التجارية',{exact:true})).toBeVisible();
    await form.getByText('متقدم: التغليف والعلامة التجارية',{exact:true}).click();
    const base=form.getByLabel('الوحدة الأساسية',{exact:true});
    await expect(base.locator('..')).toContainText('وحدة البيع المفرد (باكيت)');
    await base.selectOption('طرد');
    await form.getByRole('checkbox',{name:'هاد السعر سعر باكيت، بدي أضيف طرد',exact:true}).check();
    await form.getByLabel('كم باكيت بالطرد المضاف',{exact:false}).fill('8');
    await expect(form.getByRole('alert').filter({hasText:'وحدة الطرد نفس وحدة المفرد'})).toBeVisible();
    await expect(form.getByRole('button',{name:'حفظ التعديلات',exact:true})).toBeDisabled();
    expect(writes).toHaveLength(0);
    await base.selectOption('باكيت');
    const outer=form.getByLabel('وحدة بيع الطرد المضاف',{exact:false});
    await expect(outer.locator('option[value="باكيت"]')).toHaveCount(0);
    await expect(base.locator('option[value="طرد"]')).toHaveCount(0);
    const feedback=form.locator('[data-off-parcel-price-summary]');
    await expect(feedback).toContainText('8 باكيت × 1.900 = 15.200 د.أ');
    const price=form.getByLabel('سعر الطرد المضاف',{exact:true});
    await price.fill('14');await price.blur();
    await expect(price).toHaveValue('14.000');
    await expect(feedback).toContainText('خصم 1.200 د.أ — باكيت داخل الطرد بـ1.750');
    await price.fill('16');await price.blur();
    await expect(form.getByRole('button',{name:'حفظ التعديلات',exact:true})).toBeDisabled();
    await form.getByRole('button',{name:'احسب الطرد = العدد × سعر باكيت',exact:true}).click();
    await expect(price).toHaveValue('15.200');
    await expect(feedback).toContainText('بدون خصم');
    await price.fill('14');await price.blur();
    await form.getByRole('checkbox',{name:/أؤكد سعر الطرد/}).check();
    await price.scrollIntoViewIfNeeded();
    await page.screenshot({path:testInfo.outputPath('add-parcel-'+width+'.png')});
    await form.getByRole('button',{name:'حفظ التعديلات',exact:true}).click();
    await expect.poll(()=>writes.length).toBe(1);
    expect(writes[0]).toMatchObject({p_sale_price_in_minor_units:1900,p_default_sale_price_in_minor_units:14000,p_units_per_sale_unit:8,p_parcel_only:false});
  });

  test('OFF direct global setting link, confirmation, and pilot display at '+width,async({page},testInfo)=>{
    await page.setViewportSize({width,height:900});
    const {form,featureWrites}=await editor(page,{family:true,feature:'OWNER_PILOT'});
    await expect(form.getByText(/متاحة حالياً لتجربة المالك/)).toBeVisible();
    await form.getByRole('button',{name:'فتح المفتاح العام للطرد المشكّل',exact:true}).click();
    const modal=page.getByRole('dialog');
    const toggle=modal.getByRole('switch',{name:'تشغيل الطرد المشكّل',exact:true});
    await expect(toggle).not.toBeChecked();
    await expect(modal.getByText('موقوف للزبائن (تجربة المالك)',{exact:true})).toBeVisible();
    await expect(modal.getByText('الزبائن والكاشير ما بيشوفوا أي طرد مشكّل',{exact:true})).toBeVisible();
    await expect(modal.getByRole('option',{name:'تجربة المالك فقط',exact:true})).toHaveCount(0);
    await toggle.click();
    expect(featureWrites).toHaveLength(0);
    const save=modal.getByRole('button',{name:'تأكيد تغيير حالة الميزة',exact:true});
    await expect(save).toBeDisabled();
    await modal.getByRole('checkbox',{name:'أؤكد تغيير الحالة إلى مفعّلة للجميع',exact:true}).check();
    await save.click();
    await expect(modal.getByText('تم تغيير حالة الميزة.',{exact:true})).toBeVisible();
    await expect(toggle).toBeChecked();
    await expect(modal.getByText('الزبائن والكاشير ما بيشوفوا أي طرد مشكّل',{exact:true})).toHaveCount(0);
    expect(featureWrites).toEqual(['ENABLED']);
    await toggle.click();
    await modal.getByRole('checkbox',{name:'أؤكد تغيير الحالة إلى متوقفة',exact:true}).check();
    await save.click();
    await expect(toggle).not.toBeChecked();
    await expect(modal.getByText('الزبائن والكاشير ما بيشوفوا أي طرد مشكّل',{exact:true})).toBeVisible();
    expect(featureWrites).toEqual(['ENABLED','OFF']);
    await toggle.scrollIntoViewIfNeeded();
    await page.screenshot({path:testInfo.outputPath('global-feature-'+width+'.png')});
  });
}

test('ON retains the existing image URL, packaging, and pilot selection',async({page})=>{
  const {form}=await editor(page,{full:true,family:true});
  await expect(form.locator('[data-off-parcel-price-summary]')).toHaveCount(0);
  await expect(form.getByText('متقدم: التغليف والمخزون والصورة',{exact:true})).toBeVisible();
  await form.getByText('متقدم: التغليف والمخزون والصورة',{exact:true}).click();
  await expect(form.getByRole('checkbox',{name:'طرد بيع مختلف عن طرد الشراء',exact:true})).toBeVisible();
  await expect(form.getByText('أو استخدام رابط صورة مباشر',{exact:true})).toBeVisible();
  await expect(form.getByLabel('وصف المنتج',{exact:true})).toBeVisible();
  await form.getByRole('button',{name:'فتح إعداد الطرد المشكّل لهذا المنتج',exact:true}).click();
  const modal=page.getByRole('dialog');
  await modal.getByText('متقدم: حالة الطرد المشكّل',{exact:true}).click();
  await expect(modal.getByRole('option',{name:'تجربة المالك فقط',exact:true})).toHaveCount(1);
  await expect(modal.getByRole('switch',{name:'تشغيل الطرد المشكّل',exact:true})).toHaveCount(0);
});
