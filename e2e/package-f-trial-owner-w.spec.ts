import {test,expect,type Page} from './isolated-test';
import {checkLayout} from './package-f-layout';
import {fieldGeometry} from './trial-w-form-geometry';
import {posFixtureProducts} from './package-f-pos.fixture';

const base='98100000-0000-4000-8000-',id=(n:number)=>base+String(n).padStart(12,'0');
const row=(n:number)=>({id:id(n),supplierId:id(100),supplierName:'قيصر',productId:id(101),productName:'روبي '+n,
  warehouseId:id(102),branchId:id(103),origin:'shop',quantity:2,commercialQuantity:2,unitsPerCommercialUnit:1,
  unitName:'باكيت',baseUnitName:'باكيت',pendingQuantity:2,receivedQuantity:0,writtenOffQuantity:0,
  occurredAt:'2026-10-23T10:00:00Z',events:[{id:id(1000+n),action:'send',quantity:2,heldDelta:2,
    occurredAt:'2026-10-23T10:00:00Z',isReversed:false,reversesEventId:null}]});
async function supplierMocks(page:Page,count=1){
  const previews:Record<string,unknown>[]=[],writes:Record<string,unknown>[]=[];
  await page.route('**/rest/v1/rpc/get_supplier_replacement_options_v1',r=>r.fulfill({json:{contractVersion:208,
    products:[{id:id(101),name:'روبي',sku:'R',baseUnitName:'باكيت',unitsPerParcel:6}],suppliers:[{id:id(100),name:'قيصر'}],
    warehouses:[{id:id(102),name:'المستودع',branchId:id(103)}],lastSuppliers:[]}}));
  await page.route('**/rest/v1/rpc/get_supplier_replacements_page_v1',r=>r.fulfill({json:{contractVersion:208,
    page:1,pageSize:25,totalCount:count,pendingQuantity:count*2,cases:Array.from({length:count},(_,i)=>row(i+1))}}));
  await page.route('**/rest/v1/rpc/preview_supplier_replacement_v1',r=>{
    const request=r.request().postDataJSON();previews.push(request);
    return r.fulfill({json:{contractVersion:208,action:request.p_action,eligible:true,blockedReason:null}});
  });
  await page.route('**/rest/v1/rpc/execute_supplier_replacement_v1',r=>{
    const request=r.request().postDataJSON();writes.push(request);
    return r.fulfill({json:{success:true,contractVersion:208,action:request.p_action,idempotencyKey:request.p_idempotency_key,
      idempotent:false,operationId:id(200),cases:[row(1)]}});
  });
  return {previews,writes};
}


test('W1 last pending case keeps full receive/edit/confirmation inline rather than after pagination',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});const {previews,writes}=await supplierMocks(page,25);
  await page.goto('/e2e/supplier-replacement208-harness.html');await page.getByRole('button',{name:'المعلّق',exact:true}).click();
  const card=page.getByTestId('replacement-case').last();await card.getByRole('button',{name:'استلام المتبقي (2)',exact:true}).click();
  const flow=card.getByTestId('replacement-case-workflow');await expect(flow).toBeVisible();
  await expect(flow.getByLabel('سبب العملية',{exact:true})).toHaveValue('وصل البديل من المورد');
  await expect(flow.getByRole('button',{name:'تأكيد الاستلام',exact:true})).toBeVisible();
  await expect(page.getByTestId('replacement-preview')).toHaveCount(1);
  expect(previews[0].p_payload).toEqual({caseId:id(25),quantity:2,reason:'وصل البديل من المورد'});
  await flow.getByRole('button',{name:'إلغاء المعاينة',exact:true}).click();await flow.getByLabel('العدد (باكيت)',{exact:true}).fill('1');
  await flow.getByLabel('سبب العملية',{exact:true}).fill('وصلت حبة واحدة من المورد');await flow.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();
  await fieldGeometry(page);await checkLayout(page,flow);
  await flow.screenshot({path:info.outputPath('pending-receive390.png')});
  await flow.getByRole('button',{name:'تأكيد الاستلام',exact:true}).click();await expect(page.getByTestId('saved')).toHaveText('1');
  expect(writes).toHaveLength(1);expect(writes[0].p_payload).toEqual({caseId:id(25),quantity:1,reason:'وصلت حبة واحدة من المورد'});
});

test('W1 partial/refusal/reversal name the missing field inside the selected card;no silent disabled preview',async({page})=>{
  await page.setViewportSize({width:390,height:844});const {previews,writes}=await supplierMocks(page);
  await page.goto('/e2e/supplier-replacement208-harness.html');await page.getByRole('button',{name:'المعلّق',exact:true}).click();
  const card=page.getByTestId('replacement-case');await card.getByRole('button',{name:'معاينة استلام جزئي',exact:true}).click();
  const flow=card.getByTestId('replacement-case-workflow');await flow.getByLabel('سبب العملية',{exact:true}).fill('');
  await expect(flow.getByRole('button',{name:'معاينة التفاصيل',exact:true})).toBeEnabled();
  await flow.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();await expect(flow.getByRole('alert')).toContainText('سبب العملية');
  expect(previews).toHaveLength(0);await flow.getByLabel('سبب العملية',{exact:true}).fill('وصل البديل');await flow.getByLabel('العدد (باكيت)',{exact:true}).fill('0');
  await flow.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();await expect(flow.getByRole('alert')).toContainText('العدد');expect(previews).toHaveLength(0);
  await flow.getByRole('button',{name:'إلغاء العملية',exact:true}).click();await card.getByText('⋯ السجل والخسارة والعكس',{exact:true}).click();
  await card.getByRole('button',{name:'معاينة رفض المورد',exact:true}).click();await flow.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();
  await expect(flow.getByRole('alert')).toContainText('سبب العملية');await flow.getByLabel('سبب العملية',{exact:true}).fill('رفض المورد البضاعة');
  await flow.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();await expect(flow.getByRole('button',{name:'تأكيد رفض المورد',exact:true})).toBeVisible();
  await flow.getByRole('button',{name:'إلغاء المعاينة',exact:true}).click();await flow.getByRole('button',{name:'إلغاء العملية',exact:true}).click();
  await card.getByRole('button',{name:'معاينة العكس',exact:true}).click();await flow.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();
  await expect(flow.getByRole('alert')).toContainText('سبب العملية');await flow.getByLabel('سبب العملية',{exact:true}).fill('تصحيح الحدث المختار');
  await flow.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();await expect(flow.getByRole('button',{name:'تأكيد العكس',exact:true})).toBeVisible();
  expect(previews.at(-1)?.p_payload).toEqual({eventId:id(1001),reason:'تصحيح الحدث المختار'});expect(writes).toHaveLength(0);
});

test('W4 390 pointer parcel additions do not focus the search or reopen its keyboard',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/e2e/package-f-pos-harness.html');
  const search=page.getByRole('searchbox',{name:'البحث في منتجات نقطة البيع',exact:true});
  const card=page.locator(`[data-pos-product="${posFixtureProducts[0].id}"]`);await expect(card).toBeVisible();await search.focus();
  await card.locator('[data-pos-add-method="legacy_single_sku_parcel"]').click();
  await expect(card.locator('[data-pos-method-quantity="legacy_single_sku_parcel"]')).toHaveText('1');await expect(search).not.toBeFocused();
  await card.locator('[data-pos-add-method="base_unit"]').click();await expect(search).not.toBeFocused();
});

for(const width of [390,1440])test(`W4 ${width} barcode/Enter in search keeps consecutive scan focus and parcel admission`,async({page})=>{
  await page.setViewportSize({width,height:1000});await page.goto('/e2e/package-f-pos-harness.html?parcelOnly=1');
  const search=page.getByRole('searchbox',{name:'البحث في منتجات نقطة البيع',exact:true});
  const card=page.locator(`[data-pos-product="${posFixtureProducts[0].id}"]`);
  for(const quantity of [1,2]){
    await search.fill(posFixtureProducts[0].barcode);await expect(page.locator('[data-pos-product]')).toHaveCount(1);await search.press('Enter');
    await expect(card.locator('[data-pos-method-quantity="legacy_single_sku_parcel"]')).toHaveText(String(quantity));
    await expect(search).toBeFocused();await expect(search).toHaveValue('');
  }
  await expect(card.locator('[data-pos-add-method="base_unit"]')).toHaveCount(0);
});

test('W5 supplier form labels, fields, boundaries and comfortable reason area at390',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await supplierMocks(page);await page.goto('/e2e/supplier-replacement208-harness.html');
  await expect(page.getByRole('region',{name:'الصنف',exact:true})).toBeVisible();await fieldGeometry(page);await checkLayout(page,page.getByRole('dialog'));
  await page.getByRole('dialog').screenshot({path:info.outputPath('supplier-form390.png')});
});

for(const width of [390,1440])test(`W3 top optional photo has gallery/camera and keeps direct URL advanced ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.goto('/e2e/package-f-products-harness.html?view=form');
  const identity=page.getByTestId('product-identity-fields'),picker=identity.getByRole('button',{name:'اختيار صورة المنتج',exact:true});
  await expect(page.getByRole('dialog')).toHaveAttribute('data-state','open');
  await expect(picker).toBeVisible();const box=await picker.boundingBox(),name=await page.getByLabel('اسم المنتج',{exact:true}).boundingBox();
  expect(box!.width).toBe(96);expect(box!.height).toBe(96);expect(Math.abs(box!.y-name!.y)).toBeLessThan(60);
  expect(await picker.evaluate(node=>Boolean(node.closest('details')))).toBe(false);
  const gallery=page.locator('#product-image-upload'),camera=page.locator('#product-image-camera');
  await expect(gallery).toHaveAttribute('accept','image/*');await expect(camera).toHaveAttribute('capture','environment');
  if(width===390)await expect(identity.getByRole('button',{name:'تصوير صورة المنتج بالكاميرا',exact:true})).toBeVisible();
  await gallery.setInputFiles({name:'selected.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4x8AAAAASUVORK5CYII=','base64')});
  await expect(identity).toContainText('جاهزة للرفع: selected.png');
  await identity.getByRole('button',{name:'إلغاء الصورة المختارة',exact:true}).click();await expect(identity).not.toContainText('جاهزة للرفع');
  await gallery.setInputFiles({name:'too-large.png',mimeType:'image/png',buffer:Buffer.alloc(5*1024*1024+1)});
  await expect(identity.getByRole('alert')).toContainText('5');await expect(identity).not.toContainText('جاهزة للرفع');
  await gallery.setInputFiles({name:'rejected.avif',mimeType:'image/avif',buffer:Buffer.from('invalid')});
  await expect(identity.getByRole('alert')).toContainText(/JPG|PNG|WebP/);
  await page.getByRole('dialog').locator('details > summary').first().click();
  const direct=page.getByRole('button',{name:'أو استخدام رابط صورة مباشر',exact:true});await expect(direct).toBeVisible();
  expect(await direct.evaluate(node=>Boolean(node.closest('details')))).toBe(true);
  await direct.click();await expect(page.getByLabel('رابط صورة المنتج',{exact:true})).toBeVisible();
  await picker.scrollIntoViewIfNeeded();await checkLayout(page,identity);await identity.screenshot({path:info.outputPath(`photo-top${width}.png`)});
});
