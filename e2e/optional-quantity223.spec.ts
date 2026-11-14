import {test,expect,type Page} from './isolated-test';
import {inventoryProducts} from './package-f-inventory.fixture';
test.describe.configure({retries:0});
test.use({hasTouch:true,viewport:{width:390,height:844}});
const packet='88888888-8888-4888-8888-000000000121';
interface Counter {enabled:boolean;quantity:number;threshold:number;revision:number;everEnabled:boolean}
async function setup(page:Page,query='',failure:'none'|'lost'|'stale'='none'){
 const counters=new Map<string,Counter>(),writes:Record<string,unknown>[]=[];let reads=0,lowReads=0;
 const current=(id:string)=>counters.get(id)??{enabled:false,quantity:0,threshold:0,revision:0,everEnabled:false};
 const row=(id:string)=>({productId:id,name:'منتج عدّاد تجريبي',flavorName:id===inventoryProducts[5].id?'جبنة':id===inventoryProducts[6].id?'فلفل':null,sku:inventoryProducts.find(p=>p.id===id)?.sku??'TEST',unitId:packet,unitName:'باكيت',...current(id),active:true,manualAvailable:true,effectiveAvailable:!current(id).enabled||current(id).quantity>0});
 await page.route('**/rpc/lite3_counter_context223',route=>{
  reads++;const id=route.request().postDataJSON().p_product_id as string,family=id===inventoryProducts[4].id;
  return route.fulfill({json:{contractVersion:'optional-quantity223-v1',fullAccounting:false,productId:id,isFamily:family,products:family?[row(inventoryProducts[5].id),row(inventoryProducts[6].id)]:[row(id)]}});
 });
 await page.route('**/rpc/lite3_set_counter223',async route=>{
  const args=route.request().postDataJSON();writes.push(args);const previous=current(args.p_product_id);
  expect(args.p_expected_unit_id).toBe(packet);
  if(failure==='stale')counters.set(args.p_product_id,{...previous,quantity:7,revision:previous.revision+1});
  if(args.p_expected_revision!==current(args.p_product_id).revision)return route.fulfill({status:400,json:{code:'P0001',message:'QUANTITY223_CONFLICT'}});
  const after={enabled:args.p_enabled,quantity:args.p_quantity,threshold:args.p_low_threshold,revision:previous.revision+1,everEnabled:previous.everEnabled||args.p_enabled};
  counters.set(args.p_product_id,after);
  if(failure==='lost')return route.abort('connectionreset');
  return route.fulfill({json:{success:true,idempotentReplay:false,productId:args.p_product_id,unitId:packet,enabled:after.enabled,quantity:after.quantity,threshold:after.threshold,revision:after.revision}});
 });
 await page.route('**/rpc/lite3_low_counters223',route=>{
  lowReads++;return route.fulfill({json:{contractVersion:'optional-quantity223-v1',page:1,pageSize:20,total:1,products:[{productId:inventoryProducts[0].id,sku:'TEST-ZERO',name:'صنف قرب يخلص',unitName:'باكيت',quantity:0,threshold:2,revision:1}]}});
 });
 await page.goto('/e2e/package-f-products-harness.html?counter-quantity&'+query);
 const edit=async()=>page.evaluate(()=>{
  // @ts-expect-error Isolated Vite module.
  return import('/src/stores/useAppStore.ts').then(({storeEngine})=>{
   const params=new URLSearchParams(location.search),index=params.has('family')?4:0;
   storeEngine.openModal('edit_product',storeEngine.getState().products[index]);
  });
 });
 return {writes,edit,reads:()=>reads,lowReads:()=>lowReads};
}
test('actual product form enables an optional counter with Arabic input and exactly one CAS',async({page},info)=>{
 const c=await setup(page,'sales-only&unit-parcel');await c.edit();const section=page.locator('[data-optional-quantity]'),row=section.locator('[data-optional-quantity-row]');
 await expect(row.getByRole('checkbox',{name:'تتبّع الكمية',exact:true})).not.toBeChecked();
 await row.getByRole('checkbox',{name:'تتبّع الكمية',exact:true}).check();
 await row.getByLabel('صار عندي — باكيت',{exact:true}).fill('٣');await row.getByLabel('نبّهني إذا صارت أقل من — باكيت',{exact:true}).fill('٢');expect(c.writes).toHaveLength(0);
 await row.getByRole('button',{name:/حفظ كمية/}).tap();await expect(row.getByLabel('صار عندي — باكيت',{exact:true})).toHaveValue('3');
 await expect.poll(()=>c.writes.length).toBe(1);expect(c.writes[0]).toMatchObject({p_enabled:true,p_quantity:3,p_low_threshold:2,p_expected_revision:0,p_product_id:inventoryProducts[0].id});
 expect(c.writes[0].p_key).toMatch(/^[0-9a-f-]{36}$/u);await expect(row.getByRole('checkbox',{name:'تتبّع الكمية'})).toBeChecked();
 await page.screenshot({path:info.outputPath('owner-counter.png'),fullPage:true});
});
for(const failure of ['lost','stale'] as const)test(`actual owner counter ${failure} response requires explicit read and never retries`,async({page})=>{
 const c=await setup(page,'sales-only&unit-parcel',failure);await c.edit();const section=page.locator('[data-optional-quantity]');
 await section.getByRole('checkbox',{name:'تتبّع الكمية'}).check();await section.getByLabel('صار عندي — باكيت',{exact:true}).fill('3');
 await section.getByRole('button',{name:/حفظ كمية/}).tap();await expect(section.getByRole('alert')).toContainText('QTY-01');expect(c.writes).toHaveLength(1);
 await section.getByRole('button',{name:'إعادة قراءة الكميات',exact:true}).tap();await expect(section.getByLabel('صار عندي — باكيت',{exact:true})).toHaveValue(failure==='lost'?'3':'7');expect(c.writes).toHaveLength(1);
});
test('family editor shows leaf counters together and never offers a parent counter',async({page})=>{
 const c=await setup(page,'sales-only&family&flavor-parcel');await c.edit();const section=page.locator('[data-optional-quantity]');
 await expect(section.locator('[data-optional-quantity-row]')).toHaveCount(2);
 await expect(section.locator(`[data-optional-quantity-row="${inventoryProducts[4].id}"]`)).toHaveCount(0);
 const leaf=section.locator(`[data-optional-quantity-row="${inventoryProducts[6].id}"]`);
 await leaf.getByRole('checkbox',{name:'تتبّع الكمية'}).check();await leaf.getByLabel('صار عندي — باكيت',{exact:true}).fill('٦');await leaf.getByRole('button',{name:/حفظ كمية/}).tap();
 await expect.poll(()=>c.writes.length).toBe(1);expect(c.writes[0]).toMatchObject({p_product_id:inventoryProducts[6].id,p_quantity:6});
});
test('owner low list is explicitly opened and shows zero quantities with their actual unit',async({page})=>{
 const c=await setup(page,'sales-only&unit-parcel');expect(c.lowReads()).toBe(0);
 const section=page.getByRole('region',{name:'أصناف قرب تخلص',exact:true});await section.getByRole('button',{name:'أصناف قرب تخلص',exact:true}).tap();
 await expect(section).toContainText('TEST-ZERO');await expect(section).toContainText('نفدت الكمية');await expect(section).toContainText('حد التنبيه: 2 باكيت');expect(c.lowReads()).toBe(1);
});
test('first counter activation freezes base-unit conversion but leaves adding a parcel available',async({page})=>{
 const c=await setup(page,'sales-only&unit-parcel');await c.edit();
 const panel=page.locator('[data-optional-quantity]'),unit=page.getByLabel('الوحدة الأساسية',{exact:true});
 await expect(unit).toBeEnabled();
 await panel.getByRole('checkbox',{name:'تتبّع الكمية'}).check();await panel.getByLabel('صار عندي — باكيت',{exact:true}).fill('3');
 await panel.getByRole('button',{name:/حفظ كمية/}).tap();await expect.poll(()=>c.writes.length).toBe(1);
 await expect(unit).toBeDisabled();await expect(panel).toContainText('وحدة الأساس ثابتة بعد أول تفعيل');
 await expect(page.getByRole('checkbox',{name:/بدي أضيف طرد/})).toBeEnabled();
 await expect(page.getByRole('group',{name:'تعريف محتوى وحدة البيع',exact:true})).toHaveCount(0);
 await panel.getByRole('checkbox',{name:'تتبّع الكمية'}).uncheck();await panel.getByRole('button',{name:/حفظ كمية/}).tap();
 await expect.poll(()=>c.writes.length).toBe(2);await expect(unit).toBeDisabled();
});
for(const query of ['unit-parcel','sales-only&unit-parcel&not-owner'])test(`full mode/non-owner never exposes optional controls: ${query}`,async({page})=>{
 const c=await setup(page,query);await c.edit();await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.locator('[data-optional-quantity]')).toHaveCount(0);await expect(page.getByRole('region',{name:'أصناف قرب تخلص',exact:true})).toHaveCount(0);expect(c.reads()).toBe(0);expect(c.writes).toHaveLength(0);
});
