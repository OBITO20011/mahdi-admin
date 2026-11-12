import {test,expect} from './isolated-test';
test.use({hasTouch:true});
const ids={PKT:'88888888-8888-4888-8888-000000000121',X:'88888888-8888-4888-8888-000000000122',BOX:'88888888-8888-4888-8888-000000000124'};
async function open(page:import('@playwright/test').Page,query:string){
 await page.goto('/e2e/package-f-products-harness.html?'+query);
 await page.evaluate(async()=>{
  // @ts-expect-error Isolated Vite module.
  const {storeEngine}=await import('/src/stores/useAppStore.ts');
  storeEngine.openModal('edit_product',storeEngine.getState().products[0]);
 });
 return page.getByRole('dialog');
}
test('OFF owner renames a single unit with confirmation and an unchanged price',async({page})=>{
 await page.setViewportSize({width:390,height:1000});const writes:Record<string,unknown>[]=[];
 await page.route('**/rest/v1/units?**',route=>route.fulfill({json:[{id:ids.BOX,name_ar:'صندوق',is_active:true}]}));
 await page.route('**/rpc/update_product_master_v5',route=>{writes.push(route.request().postDataJSON());return route.fulfill({json:{success:true,productId:'88888888-8888-4888-8888-000000000123',updatedAt:'2026-11-12T08:01:00Z'}});});
 const form=await open(page,'sales-only&single-unit=SHRINK');
 const unit=form.getByLabel('الوحدة الأساسية',{exact:true});await expect(unit).toBeEnabled();await unit.selectOption('صندوق');
 await form.getByRole('button',{name:'حفظ التعديلات',exact:true}).tap();
 await expect(form.getByText(/تغيير وحدة البيع المفردة يحتاج المالك/)).toBeVisible();expect(writes).toHaveLength(0);
 await form.getByRole('checkbox',{name:'أؤكد تغيير اسم وحدة البيع دون تغيير السعر',exact:true}).check();
 await form.getByRole('button',{name:'حفظ التعديلات',exact:true}).tap();await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0]).toMatchObject({p_unit_id:ids.BOX,p_purchase_unit_id:ids.BOX,p_sale_unit_id:ids.BOX,p_units_per_purchase_unit:1,p_units_per_sale_unit:1,p_default_sale_price_in_minor_units:6000,p_parcel_only:false});
});
test('OFF conversion keeps the original selling unit X and requires a real count and owner confirmation',async({page})=>{
 const writes:Record<string,unknown>[]=[];
 await page.route('**/rest/v1/units?**',route=>{const base=new URL(route.request().url()).searchParams.get('name_ar')==='eq.باكيت';return route.fulfill({json:[{id:base?ids.PKT:ids.X,name_ar:base?'باكيت':'شرنك',is_active:true}]});});
 await page.route('**/rpc/update_product_master_v5',route=>{writes.push(route.request().postDataJSON());return route.fulfill({json:{success:true,productId:'88888888-8888-4888-8888-000000000123',updatedAt:'2026-11-12T08:01:00Z'}});});
 const form=await open(page,'sales-only&single-unit=SHRINK');
 await form.getByLabel('وحدة المحتوى بعد التحويل',{exact:true}).selectOption('باكيت');
 await form.getByLabel('عدد وحدات المحتوى الفعلي في وحدة البيع',{exact:true}).fill('12');
 const confirm=form.getByRole('checkbox',{name:'أؤكد التحويل والبيع بوحدة شرنك فقط بالسعر نفسه',exact:true});await confirm.check();
 await form.getByRole('button',{name:'حفظ التعديلات',exact:true}).tap();await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0]).toMatchObject({p_unit_id:ids.PKT,p_purchase_unit_id:ids.X,p_sale_unit_id:ids.X,p_units_per_purchase_unit:12,p_units_per_sale_unit:12,p_default_sale_price_in_minor_units:6000,p_parcel_only:true});
});

for(const unit of ['باكيت','صندوق','شرنك','كرتونة','طرد'])test(`OFF public saved receipt and share preserve actual unit ${unit}`,async({page})=>{
 const calls:string[]=[];
 await page.addInitScript(()=>Object.defineProperty(navigator,'share',{configurable:true,value:async(data:ShareData)=>{(window as unknown as {unitReceiptShare?:string}).unitReceiptShare=data.text;}}));
 await page.route('**/rest/v1/**',route=>{
  const name=new URL(route.request().url()).pathname;calls.push(name);
  if(name.endsWith('/rpc/lite1_operating_mode'))return route.fulfill({json:{contractVersion:'sales-only-phase2-v1',fullAccounting:false}});
  if(name.endsWith('/rpc/lite1_public_pos_receipt2'))return route.fulfill({json:{success:true,orderNumber:'LOCAL-UNIT',createdAt:'2026-11-12T08:00:00Z',status:'completed',paymentMethod:'cash',paymentStatus:'paid',subtotalInMinorUnits:3500,discountInMinorUnits:0,totalInMinorUnits:3500,branch:{name:'فرع وهمي'},items:[{productName:'صنف وحدة وهمي',sku:'LOCAL-UNIT',packageQuantity:1,packageName:unit,unitsPerPackage:1,packagePriceInMinorUnits:3500,lineTotalInMinorUnits:3500,commercialLineKind:'base_unit',baseQuantity:1,baseUnitName:unit}]}});
  return route.fulfill({status:500,json:{message:'unexpected receipt request'}});
 });
 await page.goto('http://127.0.0.1:4174/#receipt=93400000-0000-4000-8000-000000000099');
 const receipt=page.getByTestId('sale-receipt-document');await expect(receipt.locator('[data-receipt-line-description]')).toHaveText('1 '+unit);await expect(receipt).toContainText('3.500');
 await page.getByRole('button',{name:'مشاركة الوصل',exact:true}).tap();
 expect(await page.evaluate(()=>(window as unknown as {unitReceiptShare?:string}).unitReceiptShare)).toContain('1 '+unit);
 expect(calls.every(p=>p.endsWith('/rpc/lite1_operating_mode')||p.endsWith('/rpc/lite1_public_pos_receipt2'))).toBe(true);
});
