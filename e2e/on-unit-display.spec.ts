import {test,expect} from './isolated-test';
import {posFixtureProducts} from './package-f-pos.fixture';

for(const width of [390,1280]){
 test(`ON catalog, details and live cart show real units without overflow ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});
  for(const view of ['card','details','cart']){
   await page.goto('/e2e/on-unit-display-harness.html?view='+view);
   if(view==='cart')await expect(page.getByText('صندوق (12 قنينة)',{exact:true}).first()).toBeVisible();
   else{
    await expect(page.getByText('صندوق',{exact:true}).filter({visible:true}).first()).toBeVisible();
    if(view==='details')await expect(page.getByText('12 قنينة',{exact:true}).filter({visible:true}).first()).toBeVisible();
   }
   await expect(page.locator('body')).toContainText('12.000');
   if(view==='cart')await expect(page.locator('body')).toContainText('1.000');
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:info.outputPath(`on-${view}-${width}.png`),fullPage:true});
  }
 });
 test(`ON POS blocks shortage and names the exact remaining unit ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});
  const writes:string[]=[];
  await page.route('**/rest/v1/rpc/create_pos_sale*',route=>{writes.push(route.request().url());return route.abort();});
  await page.goto('/e2e/package-f-pos-harness.html?unitOnly&base-unit=sack&stock-two&toast&no-mix');
  const card=page.locator(`[data-pos-product="${posFixtureProducts[0].id}"]`);
  await card.getByRole('button',{name:'إضافة شوال من '+posFixtureProducts[0].name_ar,exact:true}).click();
  if(width===390)await page.getByRole('button',{name:'مراجعة السلة والعميل',exact:true}).click();
  const increase=page.getByRole('button',{name:'زيادة '+posFixtureProducts[0].name_ar,exact:true});
  await increase.click();await increase.click();
  await expect(page.getByRole('alert')).toContainText(`المتاح من ${posFixtureProducts[0].name_ar}: 2 شوال، والمطلوب 3`);
  expect(writes).toEqual([]);
  await page.screenshot({path:info.outputPath(`on-pos-shortage-${width}.png`),fullPage:true});
  await page.goto('/e2e/package-f-pos-harness.html?unitOnly&base-unit=sack&stock-zero&toast&no-mix');
  await expect(card).toContainText(`نفد المخزون: ${posFixtureProducts[0].name_ar} — المتاح 0 شوال`);
  await expect(card.getByRole('button',{name:'إضافة شوال من '+posFixtureProducts[0].name_ar,exact:true})).toBeDisabled();
  expect(writes).toEqual([]);
 });
 test(`ON formed cart uses its saved units even after catalog labels differ ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});
  await page.goto('/e2e/on-unit-display-harness.html?view=mixed-cart');
  await expect(page.getByText('صندوق (3 قنينة)',{exact:true})).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('1.500');
  await expect(page.getByRole('dialog')).not.toContainText('شوال');
  await expect(page.getByRole('dialog')).not.toContainText('شرنك');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`on-formed-snapshots-${width}.png`),fullPage:true});
 });
 test(`ON public receipt uses immutable snapshots and retains old receipt fallback ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});const calls:string[]=[];
  await page.route('**/rest/v1/**',route=>{
   const name=new URL(route.request().url()).pathname;calls.push(name);
   if(name.endsWith('/rpc/lite1_operating_mode'))return route.fulfill({json:{contractVersion:'sales-only-phase2-v1',fullAccounting:true}});
   if(name.endsWith('/rpc/lite1_public_pos_receipt2'))return route.fulfill({json:{success:true,orderNumber:'ON-SAVED',createdAt:'2026-11-17T08:00:00Z',status:'completed',paymentMethod:'cash',paymentStatus:'paid',subtotalInMinorUnits:14000,discountInMinorUnits:0,totalInMinorUnits:14000,branch:{name:'وهمي'},items:[
    {productName:'لقطة مفرد محفوظة',sku:'SAVED-BASE',packageQuantity:1,packageName:'قنينة',unitsPerPackage:1,packagePriceInMinorUnits:1000,lineTotalInMinorUnits:1000,commercialLineKind:'base_unit',baseQuantity:1,baseUnitName:'قنينة'},
    {productName:'لقطة طرد محفوظة',sku:'SAVED-PARCEL',packageQuantity:1,packageName:'صندوق',unitsPerPackage:12,packagePriceInMinorUnits:12000,lineTotalInMinorUnits:12000,commercialLineKind:'legacy_single_sku_parcel',baseQuantity:12,baseUnitName:'قنينة'},
    {productName:'فاتورة قديمة بلا لقطة وحدة',sku:'OLDER',packageQuantity:1,packageName:'طرد',unitsPerPackage:1,packagePriceInMinorUnits:1000,lineTotalInMinorUnits:1000}
   ]}});
   return route.fulfill({status:500,json:{message:'unexpected receipt request'}});
  });
  await page.goto('http://127.0.0.1:4174/#receipt=93400000-0000-4000-8000-000000000099');
  const descriptions=page.getByTestId('sale-receipt-document').locator('[data-receipt-line-description]');
  await expect(descriptions).toHaveText(['1 قنينة','1 صندوق (12 قنينة)','1 طرد']);
  expect(calls.every(name=>name.endsWith('/rpc/lite1_public_pos_receipt2')||name.endsWith('/rpc/lite1_operating_mode'))).toBe(true);
  await page.screenshot({path:info.outputPath(`on-saved-receipt-${width}.png`),fullPage:true});
 });
}
