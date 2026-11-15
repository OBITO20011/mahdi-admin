import {test,expect,type Page} from './isolated-test';
test.describe.configure({retries:0});
const id=(n:number)=>'92600000-0000-4000-8000-'+String(n).padStart(12,'0');
async function setup(page:Page,stale=false){
 const rows=[{productId:id(103),name:'براوني',sku:'NW-0268',barcode:'001234',quantity:2,threshold:4,enabled:true,revision:1},{productId:id(104),name:'ويفر',sku:'NW-0306',barcode:'009999',quantity:0,threshold:3,enabled:true,revision:1},{productId:id(105),name:'صنف جديد',sku:'NW-0999',barcode:'007777',quantity:0,threshold:2,enabled:false,revision:0}];
 const writes:Record<string,unknown>[]=[],reads:Record<string,unknown>[]=[],searches:string[]=[];
 const row=(r:typeof rows[number])=>({...r,flavorName:null,familyId:null,familyName:null,unitId:id(10),unitName:'باكيت',everEnabled:r.enabled,active:true,manualAvailable:true,effectiveAvailable:!r.enabled||r.quantity>0,updatedAt:'2026-11-16T00:00:00Z',status:r.quantity===0?'zero':r.quantity<r.threshold?'low':'available',lastEvent:{kind:'manual',delta:r.quantity,at:'2026-11-16T00:00:00Z',actorDisplayName:'المالك',source:null}});
 await page.route('**/rpc/lite3_counters224',route=>{
  const args=route.request().postDataJSON();reads.push(args);const tracked=rows.filter(r=>r.enabled),search=String(args.p_search).toLowerCase();
  const found=tracked.filter(r=>(r.name+' '+r.sku+' '+r.barcode).toLowerCase().includes(search)&&(args.p_filter==='all'||args.p_filter==='zero'&&r.quantity===0||args.p_filter==='low'&&r.quantity<r.threshold)).sort((a,b)=>a.quantity-b.quantity);
  return route.fulfill({json:{contractVersion:'inventory224-v1',fullAccounting:false,counts:{tracked:tracked.length,low:tracked.filter(r=>r.quantity===0||r.quantity<r.threshold).length,zero:tracked.filter(r=>r.quantity===0).length},total:found.length,page:args.p_page,pageSize:20,items:found.map(row)}});
 });
 await page.route('**/rpc/lite3_counter_context223',route=>{const productId=route.request().postDataJSON().p_product_id,r=rows.find(r=>r.productId===productId)!;return route.fulfill({json:{contractVersion:'optional-quantity223-v1',fullAccounting:false,productId,isFamily:false,products:[row(r)]}});});
 await page.route('**/rpc/lite3_set_counter223',route=>{
  const args=route.request().postDataJSON();writes.push(args);const r=rows.find(r=>r.productId===args.p_product_id)!;
  if(stale){r.quantity=1;r.revision++;return route.fulfill({status:409,json:{code:'P0001',message:'QUANTITY223_CONFLICT'}});}
  expect(args.p_expected_revision).toBe(r.revision);expect(args.p_expected_unit_id).toBe(id(10));
  Object.assign(r,{quantity:args.p_quantity,threshold:args.p_low_threshold,enabled:args.p_enabled,revision:r.revision+1});
  return route.fulfill({json:{success:true,idempotentReplay:false,productId:r.productId,unitId:id(10),quantity:r.quantity,threshold:r.threshold,enabled:r.enabled,revision:r.revision}});
 });
 await page.route('**/rpc/search_admin_products',route=>{
  const search=String(route.request().postDataJSON().p_search??'').toLowerCase();searches.push(search);
  return route.fulfill({json:rows.filter(r=>(r.name+' '+r.sku+' '+r.barcode).toLowerCase().includes(search)).map(r=>({id:r.productId,name_ar:r.name,sku:r.sku,barcode:r.barcode,is_active:true,is_flavor_master:false,base_unit:{id:id(10),name_ar:'باكيت',code:'PKT'}}))});
 });
 await page.goto('/e2e/inventory224-harness.html');await expect(page.locator('[data-counter-id]')).toHaveCount(2);
 return {rows,writes,reads,searches};
}
for(const width of [390,1280])test.describe(`inventory224 ${width}`,()=>{
 test.use({viewport:{width,height:844}});
 test('name/SKU/barcode search, combined filter, clear and empty action',async({page},info)=>{
  const c=await setup(page),search=page.getByRole('searchbox',{name:'البحث في المخزون'});
  for(const text of ['براوني','nw-٠٢٦٨','001234']){await search.fill(text);await expect.poll(()=>c.reads.at(-1)?.p_search).toBe(text==='nw-٠٢٦٨'?'nw-0268':text);await expect(page.locator('[data-counter-id]')).toHaveCount(1);await expect(page.locator('[data-counter-id]')).toContainText('براوني');}
  await page.getByLabel('فلتر المخزون').getByRole('button',{name:'نفد',exact:true}).click();await expect(page.getByRole('status')).toContainText('ما في نتيجة');
  expect(c.reads.at(-1)).toMatchObject({p_search:'001234',p_filter:'zero'});
  await page.getByRole('button',{name:'مسح البحث'}).click();await expect(page.locator('[data-counter-id]')).toHaveCount(1);
  await search.fill('لايوجد');await expect(page.getByRole('status')).toHaveText('ما في نتيجة لـ"لايوجد"');
  await page.screenshot({path:info.outputPath('inventory-search-empty.png'),fullPage:true});
 });
 test('receive +24 saves26 once; correction saves absolute value and full Latin quantities fit',async({page},info)=>{
  const c=await setup(page);await page.locator(`[data-counter-id="${id(103)}"]`).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('كم باكيت وصل؟',{exact:true}).fill('٢٤');
  await expect(dialog.getByRole('status')).toHaveText('2 + 24 = الكمية الجديدة 26 باكيت');
  await page.screenshot({path:info.outputPath('inventory-receive.png'),fullPage:true});
  await dialog.getByRole('button',{name:'حفظ الكمية',exact:true}).click();await expect(dialog).toHaveCount(0);expect(c.writes).toHaveLength(1);expect(c.writes[0]).toMatchObject({p_quantity:26,p_expected_revision:1});
  await page.locator(`[data-counter-id="${id(103)}"]`).click();await dialog.getByRole('button',{name:'تصحيح العدد',exact:true}).click();await dialog.getByLabel('الكمية الموجودة',{exact:true}).fill('9');await dialog.getByRole('button',{name:'حفظ الكمية',exact:true}).click();await expect(dialog).toHaveCount(0);expect(c.writes[1]).toMatchObject({p_quantity:9,p_expected_revision:2});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
 });
 test('revision conflict gives QTY-01, prohibits save until explicit re-read, never retries',async({page})=>{
  const c=await setup(page,true);await page.locator(`[data-counter-id="${id(103)}"]`).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('كم باكيت وصل؟',{exact:true}).fill('24');await dialog.getByRole('button',{name:'حفظ الكمية',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('QTY-01');await expect(dialog.getByRole('button',{name:'حفظ الكمية',exact:true})).toBeDisabled();expect(c.writes).toHaveLength(1);
  await dialog.getByRole('button',{name:'إعادة قراءة الكمية',exact:true}).click();await expect(dialog).toContainText('الكمية الحالية 1 باكيت');await expect(dialog.getByLabel('كم باكيت وصل؟',{exact:true})).toHaveValue('0');expect(c.writes).toHaveLength(1);
 });
 test('add searches name/SKU/barcode; already-tracked cannot select; new counter enabled once',async({page})=>{
  const c=await setup(page);await page.getByRole('button',{name:'إضافة منتج للعدّ',exact:true}).click();const dialog=page.getByRole('dialog');const search=dialog.getByRole('searchbox',{name:'بحث عن منتج للعدّ'});
  await search.fill('براوني');await expect.poll(()=>c.searches.at(-1)).toBe('براوني');await expect(dialog.getByRole('button',{name:'بالقائمة',exact:true})).toHaveCount(1);await expect(dialog.getByRole('button',{name:'بالقائمة',exact:true})).toBeDisabled();
  for(const text of ['صنف جديد','nw-0999','٠٠٧٧٧٧']){await search.fill(text);await expect.poll(()=>c.searches.at(-1)).toBe(text==='٠٠٧٧٧٧'?'007777':text);await expect(dialog.getByRole('button',{name:'اختيار',exact:true})).toBeEnabled();}
  await dialog.getByRole('button',{name:'اختيار',exact:true}).click();await expect(dialog).toContainText('بعد التفعيل وحدة «باكيت» بتنقفل');await dialog.getByLabel('الكمية الموجودة',{exact:true}).fill('12');await dialog.getByRole('button',{name:'ابدأ العدّ',exact:true}).click();await expect(dialog).toHaveCount(0);expect(c.writes).toHaveLength(1);expect(c.writes[0]).toMatchObject({p_product_id:id(105),p_quantity:12,p_enabled:true,p_expected_revision:0});
 });
});
test('nonowner inventory renders no owner data and performs no RPC',async({page})=>{
 let calls=0;await page.route('**/rpc/**',route=>{calls++;return route.fulfill({status:403,json:{message:'forbidden'}});});
 await page.goto('/e2e/inventory224-harness.html?nonowner');await expect(page.getByRole('alert')).toHaveText('هذه الشاشة للمالك فقط.');expect(calls).toBe(0);
});
