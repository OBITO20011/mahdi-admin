import {test,expect,type Page} from './isolated-test';
const base='http://127.0.0.1:4174',id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const raw={id:id(1),sku:'00001',unitId:id(20),saleUnitId:id(21),nameAr:'صنف متاح يدوياً',unitNameAr:'باكيت',saleUnitNameAr:'طرد',unitsPerSalePackage:5,salePackagePriceInMinorUnits:4500,salePriceInMinorUnits:1000,quantityTracked:false,manualAvailable:true,availableQuantity:null,availableSalePackages:null,isAvailable:true};
const family={...raw,id:id(2),sku:'FAMILY',nameAr:'عائلة النكهات',isFlavorMaster:true},flavors=[{...raw,id:id(3),sku:'00003',nameAr:'عائلة النكهات - جبنة',flavorNameAr:'جبنة',flavorMasterProductId:family.id},{...raw,id:id(4),sku:'00004',nameAr:'عائلة النكهات - زعتر',flavorNameAr:'زعتر',flavorMasterProductId:family.id}];
const parcel={quantityTracked:false,familyProductId:family.id,parcelConfigurationId:id(30),configurationRevision:1,compositionMode:'configurable_mix',unitsPerParcel:5,parcelPriceInMinorUnits:4500,baseUnitNameAr:'باكيت',saleUnitNameAr:'طرد',components:flavors.map(p=>({productId:p.id,sku:p.sku,nameAr:p.nameAr,flavorNameAr:p.flavorNameAr,unitNameAr:p.unitNameAr,imageUrl:'',quantityTracked:false,manualAvailable:true,availableQuantity:null}))};
async function setup(page:Page){
 const state={unavailable:false,omitSelectedFlavor:false,catalogCalls:0,parcelCalls:0,legacyCalls:0};
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/rest/v1/rpc/*',async route=>{
  const name=new URL(route.request().url()).pathname.split('/').pop();
  if(name==='lite1_catalog_page2'){state.catalogCalls++;return route.fulfill({json:{contractVersion:'lite2-catalog-v1',quantityTracked:false,items:[{...raw,isAvailable:!state.unavailable,manualAvailable:!state.unavailable},family,...flavors],categories:[],brands:[],saleUnits:[],summary:{quantityTracked:false,availableProducts:3,availableSalePackages:null,lowStockProducts:0},total:3,limit:24,offset:0}});}
  if(name==='lite1_merchandising2')return route.fulfill({json:{contractVersion:'lite2-merchandising-v1',quantityTracked:false,newest:[],bestSellers:[],offers:[],lowStock:[]}});
  if(name==='lite1_parcel_options2'){state.parcelCalls++;return route.fulfill({json:{contractVersion:'lite2-parcel-options-v1',quantityTracked:false,featureState:'ENABLED',guestCreationEnabled:true,options:[{...parcel,components:state.omitSelectedFlavor?parcel.components.slice(1):parcel.components}]}});}
  if(name==='get_public_storefront_catalog_page'||name==='get_public_configurable_parcel_options')state.legacyCalls++;
  await route.fallback();
 });
 await page.goto(`${base}/#catalog`,{waitUntil:'domcontentloaded'});
 await expect(page.getByTestId('catalog-products-grid')).toBeVisible();return state;
}
test('OFF الرئيسية تصف التشكيلة دون ادعاء مخزون متتبع',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);
 await page.goto(base+'/',{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('heading',{level:1})).toContainText('تشكيلة الجملة بين يديك');
 await expect(page.getByRole('heading',{level:1})).not.toContainText('من المخزون مباشرة');
 await expect(page.getByText('يحدد المحل توفر الأصناف',{exact:false})).toBeVisible();
 await expect(page.getByTestId('hero-stats')).not.toContainText('طرد متاح');
});
async function lines(page:Page){return page.evaluate(()=>JSON.parse(localStorage.getItem('nawasrah-wholesale-cart-v1')??'{}').items??[]);}
for(const width of [390,1440]){
 test(`lite storefront real prices + five immediate additions without fake quantities persist/reconcile ${width}`,async({page})=>{
  await page.setViewportSize({width,height:950});const state=await setup(page);
  await page.getByRole('button',{name:`عرض تفاصيل ${raw.nameAr}`}).first().click();const dialog=page.getByRole('dialog');
  const parcels=dialog.getByRole('region',{name:'إضافة طرد',exact:true});
  for(let n=0;n<5;n++)await parcels.getByRole('button',{name:/إضافة .* طرد من/}).click();
  await expect.poll(()=>lines(page)).toMatchObject([{productId:raw.id,quantity:5,quantityTracked:false,maxAvailablePackages:null,unitPriceInMinorUnits:4500}]);
  await dialog.getByRole('region',{name:'إضافة باكيت',exact:true}).getByRole('button',{name:/إضافة .* باكيت من/}).click();
  await expect.poll(()=>lines(page)).toMatchObject([{quantity:5},{quantity:1,commercialLineKind:'base_unit',unitPriceInMinorUnits:1000}]);
  await page.keyboard.press('Escape');await page.reload({waitUntil:'domcontentloaded'});await expect.poll(()=>lines(page)).toHaveLength(2);
  await page.getByRole('button',{name:/^فتح السلة،/}).click();const drawer=page.getByRole('dialog');
  await expect(drawer).toContainText('التوفر يدوي');await expect(drawer).not.toContainText('المتاح:');await expect(drawer).not.toContainText('NaN');
  await expect(drawer.getByRole('button',{name:/زيادة كمية/}).first()).toBeEnabled();
  await expect.poll(()=>state.catalogCalls).toBeGreaterThan(1);expect(state.legacyCalls).toBe(0);
  expect((await lines(page)).reduce((sum:number,p:{quantity:number;unitPriceInMinorUnits:number})=>sum+p.quantity*p.unitPriceInMinorUnits,0)).toBe(23500);
 });
 test(`lite mixed parcel has exact real capacity;unavailable fresh flavor stops checkout ${width}`,async({page})=>{
  await page.setViewportSize({width,height:950});const state=await setup(page);await page.getByRole('button',{name:`عرض تفاصيل ${family.nameAr}`}).first().click();
  await page.getByRole('button',{name:'كوّن طردًا بالنكهات',exact:true}).click();const builder=page.getByRole('dialog').last(),add=builder.getByRole('button',{name:'إضافة الطرد للسلة',exact:true});
  for(let n=0;n<4;n++)await builder.getByRole('button',{name:'زيادة جبنة',exact:true}).click();await expect(add).toBeDisabled();
  await builder.getByRole('button',{name:'زيادة جبنة',exact:true}).click();await expect(add).toBeEnabled();await expect(builder.getByRole('button',{name:'زيادة زعتر',exact:true})).toBeDisabled();await add.click();
  await expect.poll(()=>lines(page)).toMatchObject([{commercialLineKind:'configurable_parcel',quantity:1,capacity:5,quantityTracked:false,maxAvailablePackages:null,unitPriceInMinorUnits:4500,parcelInstances:[{components:[{productId:flavors[0].id,baseQuantity:5}]}]}]);
  // Closing details and requesting a fresh cart checks current manual availability.
  await page.keyboard.press('Escape');state.omitSelectedFlavor=true;await page.getByRole('button',{name:/^فتح السلة،/}).click();
  await expect(page.getByRole('dialog')).toContainText('تغيّر توفر إحدى النكهات');
  expect((await lines(page))[0].parcelInstances[0].components[0].productId).toBe(flavors[0].id);
  const reads=state.parcelCalls;await page.getByRole('dialog').getByRole('button',{name:'إتمام الطلب بدون تسجيل دخول'}).click();await expect.poll(()=>state.parcelCalls).toBeGreaterThan(reads);await expect(page.getByRole('heading',{name:'إتمام طلب الجملة',exact:true})).toHaveCount(0);await expect(page.getByRole('dialog',{name:'سلة طلب الجملة'})).toBeVisible();
 });
 test(`lite unavailable scalar cannot enter cart;stock filter absent ${width}`,async({page})=>{
  await page.setViewportSize({width,height:950});const state=await setup(page);state.unavailable=true;await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:`عرض تفاصيل ${raw.nameAr}`}).first().click();const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('region',{name:'إضافة طرد',exact:true}).getByRole('button',{name:/إضافة .* طرد من/})).toBeDisabled();
  await expect(dialog.getByRole('region',{name:'إضافة باكيت',exact:true}).getByRole('button',{name:/إضافة .* باكيت من/})).toBeDisabled();expect(await lines(page)).toEqual([]);
  await page.keyboard.press('Escape');await expect(page.getByRole('option',{name:'الأكثر توفرًا'})).toHaveCount(0);
 });
}
test('lite checkout reuses canonical quote/review for zero-stock mixed parcel and packet',async({page})=>{
 await page.addInitScript(()=>{const w=window as typeof window&{turnstile?:{render:(container:HTMLElement,options:{callback:(token:string)=>void})=>string;reset:()=>void;remove:()=>void}};w.turnstile={render:(_container,options)=>{queueMicrotask(()=>options.callback('isolated-lite-quote-token'));return 'isolated-lite-widget';},reset:()=>undefined,remove:()=>undefined};});
 const submitted:Record<string,unknown>[]=[];await page.route('**/functions/v1/submit-guest-order',route=>{submitted.push(route.request().postDataJSON());return route.fulfill({json:{success:true,order_id:id(801),order_number:'LITE-TEST-801',customer_id:id(802),customer_address_id:id(803),customer_reused:false,idempotent_replay:false,subtotal:5500,discount:0,delivery_fee:0,total:5500,delivery_zone:'inside_ramtha',status:'new',payment_method:'cash_on_delivery',tracking_token:id(804),tracking_path:'/#track='+id(804)}});});
 await page.setViewportSize({width:390,height:950});await setup(page);
 const quotes:Record<string,unknown>[]=[];
 await page.route('**/rest/v1/rpc/lite1_preview_guest2',route=>{quotes.push(route.request().postDataJSON());return route.fulfill({json:{success:true,contractVersion:'phase3-customer-promotion-preview-v2',merchandiseSubtotalInMinorUnits:5500,promotionDiscountInMinorUnits:0,finalMerchandiseTotalInMinorUnits:5500,promotion:null}});});
 await page.getByRole('button',{name:`عرض تفاصيل ${family.nameAr}`}).first().click();await page.getByRole('button',{name:'كوّن طردًا بالنكهات',exact:true}).click();
 const builder=page.getByRole('dialog').last();for(let n=0;n<5;n++)await builder.getByRole('button',{name:'زيادة جبنة',exact:true}).click();await builder.getByRole('button',{name:'إضافة الطرد للسلة',exact:true}).click();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:`عرض تفاصيل ${raw.nameAr}`}).first().click();await page.getByRole('region',{name:'إضافة باكيت',exact:true}).getByRole('button',{name:/إضافة .* باكيت من/}).click();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:/^فتح السلة،/}).click();await page.getByRole('button',{name:'إتمام الطلب بدون تسجيل دخول'}).click();
 const checkout=page.getByRole('dialog',{name:'إتمام طلب الجملة',exact:true});await checkout.getByLabel('الاسم الكامل*').fill('مستلم اختبار معزول');await checkout.getByLabel('رقم الهاتف*').fill('0791234567');await checkout.getByLabel('المنطقة أو الحي*').fill('حي الاختبار');await checkout.getByLabel('تفاصيل العنوان والتوصيل*').fill('عنوان اصطناعي للبروفة المحلية');await checkout.getByRole('button',{name:'مراجعة الطلب قبل الإرسال'}).click();
 const review=page.getByRole('dialog',{name:'راجع طلبك قبل الإرسال',exact:true});await expect(review).toBeVisible();await expect(review.getByText('تم التحقق الأمني وجاهز للإرسال.')).toBeVisible();await review.getByRole('button',{name:'تأكيد وحفظ الطلب في الإدارة'}).click();await expect(page.getByRole('heading',{name:'تم تسجيل طلبك',exact:true})).toBeVisible();expect(submitted).toHaveLength(1);expect(submitted[0]).toMatchObject({expectedQuote:{subtotalInMinorUnits:5500,discountInMinorUnits:0,deliveryFeeInMinorUnits:0,totalInMinorUnits:5500},items:expect.any(Array)});expect(quotes).toHaveLength(1);expect(quotes[0]).toMatchObject({p_lines:expect.arrayContaining([{commercial_line_kind:'base_unit',product_id:raw.id,base_quantity:1,expected_unit_price_in_minor_units:1000},expect.objectContaining({commercial_line_kind:'configurable_parcel',family_product_id:family.id,expected_unit_price_in_minor_units:4500,parcel_instances:[{components:[{product_id:flavors[0].id,base_quantity:5}]}]})]),p_customer_phone:'0791234567',p_promotion_code:null});
 expect(await lines(page)).toEqual([]);
});
