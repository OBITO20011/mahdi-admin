import AxeBuilder from '@axe-core/playwright';
import {test,expect,type Page} from './isolated-test';
const base=process.env.CUSTOMER_BASE_URL ?? 'http://127.0.0.1:4174';
const product={id:'00000000-0000-4000-8000-000000000691',sku:'C6-WATER',unitId:'00000000-0000-4000-8000-000000000020',saleUnitId:'00000000-0000-4000-8000-000000000021',nameAr:'مياه اختبار المتجر',unitNameAr:'باكيت',saleUnitNameAr:'كرتونة',unitsPerSalePackage:10,salePackagePriceInMinorUnits:5500,salePriceInMinorUnits:550,availableQuantity:23,availableSalePackages:2,isAvailable:true};
async function setup(page:Page,overrides:Record<string,unknown>={},extraRows:Record<string,unknown>[]=[]){
 const row={...product,...overrides};
 await page.route('**/rest/v1/rpc/get_public_storefront_catalog_page',r=>r.fulfill({json:{items:[row,...extraRows],categories:[],brands:[],saleUnits:[],summary:{availableProducts:1,availableSalePackages:2,lowStockProducts:0},total:1,limit:24,offset:0}}));
 await page.route('**/rest/v1/rpc/get_public_storefront_catalog_snapshot',r=>r.fulfill({json:{items:[row]}}));
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto(`${base}/#catalog`,{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:`عرض تفاصيل ${row.nameAr}`}).first().click();
 return page.getByRole('dialog');
}
async function savedLines(page:Page){return page.evaluate(()=>JSON.parse(localStorage.getItem('nawasrah-wholesale-cart-v1') ?? '{}').items ?? []);}
for(const width of [390,1440]){
 test(`C6 clear equal parcel/unit controls and exact mixed cart quantities ${width}`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:1000});const dialog=await setup(page);
  const parcels=dialog.getByRole('region',{name:'إضافة طرد',exact:true}),units=dialog.getByRole('region',{name:'إضافة باكيت',exact:true});
  await expect(parcels).toContainText(`طرد (${(10).toLocaleString('ar-JO')} باكيت)`);
  await expect(parcels).toContainText('٥٫٥٠٠ د.أ');await expect(units).toContainText('٠٫٥٥٠ د.أ');
  await expect(dialog.getByRole('button',{name:/الطرد المختلط|كوّن طردًا/})).toHaveCount(0);
  const a=await parcels.boundingBox(),b=await units.boundingBox();expect(Math.abs(a!.width-b!.width)).toBeLessThanOrEqual(1);
  await units.getByRole('button',{name:'زيادة كمية باكيت'}).click();await units.getByRole('button',{name:'زيادة كمية باكيت'}).click();
  await units.getByRole('button',{name:/إضافة .* باكيت من/}).click();
  await expect.poll(()=>savedLines(page)).toMatchObject([{commercialLineKind:'base_unit',quantity:3,unitPriceInMinorUnits:550}]);
  await parcels.getByRole('button',{name:/إضافة .* طرد من/}).click();
  await expect.poll(()=>savedLines(page)).toMatchObject([{commercialLineKind:'base_unit',quantity:3},{commercialLineKind:'legacy_single_sku_parcel',quantity:1,unitPriceInMinorUnits:5500,unitsPerSalePackage:10}]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const axe=await new AxeBuilder({page}).include('[aria-label="إضافة المنتج للسلة"]').analyze();await testInfo.attach('C6-addition-axe',{body:JSON.stringify(axe.violations),contentType:'application/json'});expect(axe.violations.map(v=>({id:v.id,impact:v.impact}))).toEqual([]);
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
  if(width === 1440){
    const card=page.getByTestId('catalog-products-grid').locator('article').first();
    const before=await savedLines(page);
    await card.getByRole('button',{name:`زيادة ${product.nameAr} في السلة`,exact:true}).click();
    await expect.poll(()=>savedLines(page)).toMatchObject([{commercialLineKind:'base_unit',quantity:3,localLineId:before[0].localLineId},{commercialLineKind:'legacy_single_sku_parcel',quantity:2,unitPriceInMinorUnits:5500,localLineId:before[1].localLineId}]);
    await card.getByRole('button',{name:`إنقاص ${product.nameAr} من السلة`,exact:true}).click();
    await expect.poll(()=>savedLines(page)).toMatchObject([{commercialLineKind:'base_unit',quantity:3,unitPriceInMinorUnits:550,localLineId:before[0].localLineId},{commercialLineKind:'legacy_single_sku_parcel',quantity:1,unitPriceInMinorUnits:5500,localLineId:before[1].localLineId}]);
  }
 });
 test(`C6 mixed stock limits and no-parcel primary quote ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});let dialog=await setup(page,{availableQuantity:12,availableSalePackages:1});
  const parcels=dialog.getByRole('region',{name:'إضافة طرد',exact:true}),units=dialog.getByRole('region',{name:'إضافة باكيت',exact:true});
  await parcels.getByRole('button',{name:/إضافة .* طرد من/}).click();
  await units.getByRole('button',{name:'زيادة كمية باكيت'}).click();
  await expect(units.getByRole('button',{name:'زيادة كمية باكيت'})).toBeDisabled();
  await units.getByRole('button',{name:/إضافة .* باكيت من/}).click();
  await expect.poll(()=>savedLines(page)).toMatchObject([{commercialLineKind:'legacy_single_sku_parcel',quantity:1},{commercialLineKind:'base_unit',quantity:2}]);
  await expect(parcels.getByRole('button',{name:/إضافة .* طرد من/})).toBeDisabled();await expect(units.getByRole('button',{name:/إضافة .* باكيت من/})).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.evaluate(()=>localStorage.clear());
  dialog=await setup(page,{unitsPerSalePackage:1,unitNameAr:'شوال',availableQuantity:3,availableSalePackages:3,salePackagePriceInMinorUnits:7000,salePriceInMinorUnits:6500});
  await expect(dialog.getByRole('region',{name:'إضافة طرد',exact:true})).toHaveCount(0);
  await expect(dialog.getByText('طرد البيع',{exact:true})).toHaveCount(0);await expect(dialog.getByText('محتوى الطرد',{exact:true})).toHaveCount(0);
  const single=dialog.getByRole('region',{name:'إضافة شوال',exact:true});await expect(single).toContainText('٧٫٠٠٠ د.أ');
  await single.getByRole('button',{name:/إضافة .* شوال من/}).click();
  await expect.poll(()=>savedLines(page)).toMatchObject([{commercialLineKind:'legacy_single_sku_parcel',quantity:1,unitPriceInMinorUnits:7000,unitsPerSalePackage:1}]);
 });
}

test('C6 animated simultaneous additions keep exact stock and report only persisted quantity',async({page})=>{
 const dialog=await setup(page);await page.emulateMedia({reducedMotion:'no-preference'});
 const parcels=dialog.getByRole('region',{name:'إضافة طرد',exact:true}),units=dialog.getByRole('region',{name:'إضافة باكيت',exact:true});
 await parcels.getByRole('button',{name:'زيادة كمية طرد'}).click();
 for(let i=1;i<6;i++)await units.getByRole('button',{name:'زيادة كمية باكيت'}).click();
 await parcels.getByRole('button',{name:/إضافة .* طرد من/}).click();await units.getByRole('button',{name:/إضافة .* باكيت من/}).click();
 await expect.poll(()=>savedLines(page)).toMatchObject([{commercialLineKind:'legacy_single_sku_parcel',quantity:2},{commercialLineKind:'base_unit',quantity:3}]);
 await expect(page.getByText(`تمت إضافة ${(3).toLocaleString('ar-JO')} باكيت من ${product.nameAr}.`,{exact:true})).toBeVisible();
});
test('C6 real flavor identity remains selected and capability absence is distinct from a product without flavors',async({page})=>{
 const child={...product,id:'00000000-0000-4000-8000-000000000692',sku:'C6-FLAVOR',nameAr:'مياه اختبار المتجر - ليمون',flavorMasterProductId:product.id,flavorNameAr:'ليمون'};
 const dialog=await setup(page,{isFlavorMaster:true},[child]);
 await expect(dialog.getByText('اختر النكهة',{exact:true})).toBeVisible();
 await expect(dialog.getByRole('button',{name:'الطرد المختلط غير متاح',exact:true})).toHaveCount(0);
 await dialog.getByRole('region',{name:'إضافة باكيت',exact:true}).getByRole('button',{name:/إضافة .* باكيت من/}).click();
 await expect.poll(()=>savedLines(page)).toMatchObject([{commercialLineKind:'base_unit',productId:child.id,quantity:1,unitPriceInMinorUnits:550}]);
});

for(const width of [390,1440])test('209 parcel only has no unit or unavailable mixed control '+width,async({page})=>{
 await page.setViewportSize({width,height:1000});const dialog=await setup(page,{parcelOnly:true});
 await expect(dialog.getByRole('region',{name:'إضافة باكيت',exact:true})).toHaveCount(0);await expect(dialog.getByText('الطرد المختلط غير متاح',{exact:true})).toHaveCount(0);await expect(dialog.getByRole('button',{name:'كوّن طردًا بالنكهات',exact:true})).toHaveCount(0);
 await dialog.getByRole('region',{name:'إضافة طرد',exact:true}).getByRole('button',{name:/إضافة .* طرد من/}).click();
 await expect.poll(()=>savedLines(page)).toMatchObject([{commercialLineKind:'legacy_single_sku_parcel',quantity:1,unitsPerSalePackage:10,unitPriceInMinorUnits:5500}]);
});
