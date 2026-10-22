import {test,expect} from './isolated-test';
import {checkLayout} from './package-f-layout';
import {trialDDescriptions} from './trial-d-receipt.fixture';
import {posFixtureProducts} from './package-f-pos.fixture';

for(const width of [390,1440])for(const source of ['pos','website'])test(`D internal saved ${source} receipt/reprint/share no writes ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  const writes:string[]=[];
  await page.route('**/rest/v1/**',route=>{
    const name=new URL(route.request().url()).pathname.split('/').at(-1)!;
    if(name==='get_admin_sales_aftercare_context_v1')return route.fulfill({status:403,json:{message:'No aftercare in this receipt-only fixture'}});
    if(route.request().method()!=='GET')writes.push(name);
    return route.fulfill({json:[]});
  });
  await page.addInitScript(()=>{
    window.print=()=>{document.body.dataset.receiptPrints=String(Number(document.body.dataset.receiptPrints??0)+1);};
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{document.body.dataset.copiedReceipt=text;}}});
    Object.defineProperty(navigator,'share',{configurable:true,value:async(data:ShareData)=>{document.body.dataset.sharedReceipt=data.text;}});
  });
  await page.goto(`/e2e/trial-d-receipt-harness.html?${source==='website'?'website':''}`);
  await page.getByRole('button',{name:'طباعة الوصل',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'إيصال البيع',exact:true}),receipt=dialog.getByTestId('sale-receipt-document');
  await expect(dialog).toBeVisible();await expect(receipt.locator('[data-receipt-line-description]')).toHaveText(trialDDescriptions);
  await expect(receipt).toContainText('36.000');await expect(receipt).toContainText('كاش');
  await expect(receipt).not.toContainText(/private-|PRIVATE-|999|عنوان التجهيز|سجل حالة الطلب/);
  await checkLayout(page,dialog);
  await dialog.getByRole('button',{name:'نسخ الرابط',exact:true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-copied-receipt',/#receipt=93400000/);
  await dialog.getByRole('button',{name:'مشاركة الوصل',exact:true}).click();
  for(const description of trialDDescriptions)await expect(page.locator('body')).toHaveAttribute('data-shared-receipt',new RegExp(description.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  await dialog.getByRole('button',{name:'طباعة / PDF',exact:true}).click();await expect(page.locator('body')).toHaveAttribute('data-receipt-prints','1');
  await page.emulateMedia({media:'print'});
  const printedReceipt=page.getByTestId('sale-receipt-document');
  await expect(printedReceipt).toBeVisible();
  await expect(printedReceipt.locator('[data-receipt-line-description]')).toHaveText(trialDDescriptions);
  await expect(page.getByRole('button',{name:'طباعة / PDF',exact:true,includeHidden:true})).not.toBeVisible();
  await page.emulateMedia({media:'screen'});
  await dialog.getByRole('button',{name:'إغلاق الإيصال',exact:true}).click();
  await expect(page.getByRole('button',{name:'طباعة الوصل',exact:true})).toBeFocused();
  await page.getByLabel('خيارات طباعة إضافية',{exact:true}).click();
  await page.getByRole('button',{name:'طباعة ورقة التجهيز',exact:true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-receipt-prints','2');
  await page.reload();await page.getByRole('button',{name:'طباعة الوصل',exact:true}).click();
  await expect(page.getByTestId('sale-receipt-document').locator('[data-receipt-line-description]')).toHaveText(trialDDescriptions);
  expect(writes).toEqual([]);
});

test('D missing saved public link still permits reprint without creating a token',async({page})=>{
  const requests:string[]=[];
  await page.route('**/rest/v1/**',route=>{requests.push(route.request().url());return route.fulfill({status:403,json:{message:'No writes or link creation'}});});
  await page.goto('/e2e/trial-d-receipt-harness.html?no-link');
  await expect(page.getByRole('button',{name:'مشاركة الوصل',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'نسخ الرابط',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'طباعة الوصل',exact:true}).click();
  await expect(page.getByTestId('sale-receipt-document').locator('[data-receipt-line-description]')).toHaveText(trialDDescriptions);
  expect(requests.every(url=>url.endsWith('/get_admin_sales_aftercare_context_v1'))).toBe(true);
});

for(const width of [390,1440])test(`D explicit per-product prices and independent parcel/unit counters ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});await page.goto('/e2e/package-f-pos-harness.html');
  const card=page.locator(`[data-pos-product="${posFixtureProducts[0].id}"]`);
  const parcel=card.locator('[data-pos-add-method="legacy_single_sku_parcel"]'),unit=card.locator('[data-pos-add-method="base_unit"]');
  await expect(parcel).toContainText('+ طرد');await expect(parcel).toContainText('21.600');
  await expect(unit).toContainText('+ باكيت');await expect(unit).toContainText('0.900');
  await expect(page.getByRole('radiogroup',{name:'وحدة البيع',exact:true})).toHaveCount(0);
  await parcel.click();await parcel.click();await unit.click();await unit.click();await unit.click();
  await expect(card.locator('[data-pos-method-quantity="legacy_single_sku_parcel"]')).toHaveText('2');
  await expect(card.locator('[data-pos-method-quantity="base_unit"]')).toHaveText('3');
  await card.getByRole('button',{name:`تقليل باكيت من ${posFixtureProducts[0].name_ar}`,exact:true}).click();
  await expect(card.locator('[data-pos-method-quantity="legacy_single_sku_parcel"]')).toHaveText('2');
  await expect(card.locator('[data-pos-method-quantity="base_unit"]')).toHaveText('2');
  await checkLayout(page,card);
  if(width===390)await page.getByRole('button',{name:'مراجعة السلة والعميل',exact:true}).click();
  const cart=page.getByTestId('pos-cart-panel').filter({visible:true});
  await expect(cart.locator('[data-pos-cart-line-kind]')).toHaveText(['· 2 طرد','· 2 باكيت']);
  await expect(cart).toContainText('45.000');
  await expect(cart).toContainText('21.600 د.أ / طرد');
  await expect(cart).toContainText('0.900 د.أ / باكيت');
});

for(const mode of ['parcelOnly=1','unitOnly=1'])test(`D only selected methods appear on cards ${mode}`,async({page})=>{
  await page.goto(`/e2e/package-f-pos-harness.html?${mode}&no-mix=1`);
  const card=page.locator(`[data-pos-product="${posFixtureProducts[0].id}"]`);
  await expect(card.locator('[data-pos-add-method]')).toHaveCount(1);
  await expect(card.locator(`[data-pos-add-method="${mode.startsWith('parcel')?'legacy_single_sku_parcel':'base_unit'}"]`)).toBeVisible();
  await expect(page.getByRole('button',{name:/تركيب طرد:/})).toHaveCount(0);
});

test('D legacy single SKU configuration is read-only and can only be disabled unchanged',async({page})=>{
  const family='93400000-0000-4000-8000-000000000011',child='93400000-0000-4000-8000-000000000012',old='93400000-0000-4000-8000-000000000013';
  let active=true;const saved:unknown[]=[];
  const context=()=>({featureState:'OWNER_PILOT',products:[
    {familyProductId:family,nameAr:'عصير بنكهات',sku:'F',isFlavorMaster:true,unitsPerParcel:6,parcelPriceInMinorUnits:7000,configuration:null,allowedProductIds:[],components:[{productId:child,nameAr:'توت',sku:'B',flavorNameAr:'توت'}]},
    {familyProductId:old,nameAr:'طرد قديم محفوظ',sku:'OLD',isFlavorMaster:false,unitsPerParcel:10,parcelPriceInMinorUnits:15000,configuration:{id:old,composition_mode:'single_sku',is_active:active,configuration_revision:4},allowedProductIds:[old],components:[{productId:old,nameAr:'طرد قديم محفوظ',sku:'OLD',flavorNameAr:null}]},
  ]});
  await page.route('**/rest/v1/rpc/get_admin_parcel_configuration_context_v1',route=>route.fulfill({json:context()}));
  await page.route('**/rest/v1/rpc/save_product_parcel_configuration_v1',route=>{
    const payload=route.request().postDataJSON();saved.push(payload);
    expect(payload).toEqual({p_family_product_id:old,p_composition_mode:'single_sku',p_is_active:false,p_units_per_parcel:10,p_allowed_product_ids:[old]});
    active=false;return route.fulfill({json:{success:true,configuration:{family_product_id:old,composition_mode:'single_sku',is_active:false},unitsPerParcel:10,allowedProductIds:[old]}});
  });
  await page.goto('/e2e/package-d-settings-harness.html');
  await expect(page.getByLabel('نمط الطرد',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('option',{name:/طرد قديم محفوظ/})).toHaveCount(0);
  await expect(page.getByLabel('متاح للبيع كطرد مشكّل',{exact:true})).toBeVisible();
  const legacy=page.getByRole('region',{name:'إعدادات الطرد القديمة'});
  await expect(legacy).toContainText('كم حبة بالطرد: 10');await expect(legacy.locator('input,select')).toHaveCount(0);
  expect(saved).toEqual([]);await legacy.getByRole('button',{name:'إيقاف الإعداد القديم — طرد قديم محفوظ',exact:true}).click();
  await expect(legacy).toContainText('متوقف');await expect(legacy.getByRole('button')).toHaveCount(0);expect(saved).toHaveLength(1);
  await page.reload();await expect(legacy).toContainText('متوقف');expect(saved).toHaveLength(1);
});
