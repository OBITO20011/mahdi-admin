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
