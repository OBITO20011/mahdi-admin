import {test,expect,type Page} from './isolated-test';
import {inventoryProducts} from './package-f-inventory.fixture';
test.use({hasTouch:true});
const family=inventoryProducts[4].id,leaf=inventoryProducts[5].id;
const url='/e2e/package-f-products-harness.html?sales-only&family&view=detail';
async function mock(page:Page,options:{lostReply?:boolean;full?:boolean}={}){
 const values=new Map<string,{available:boolean;revision:number}>(),writes:Record<string,unknown>[]=[],reads:string[][]=[];
 await page.route('**/rest/v1/rpc/lite1_product_availability2',route=>{
  const ids=route.request().postDataJSON().p_product_ids as string[];reads.push(ids);
  return route.fulfill({json:{contractVersion:'sales-only-availability2-v1',fullAccounting:!!options.full,
   products:ids.map(productId=>{const own=values.get(productId)??{available:true,revision:0},parentAvailable=productId===family?true:values.get(family)?.available??true;return {
    productId,...own,active:true,parentAvailable,flavorMasterProductId:productId===family?null:family,effectiveAvailable:own.available&&parentAvailable};})}});
 });
 await page.route('**/rest/v1/rpc/lite1_set_available2',async route=>{
  const args=route.request().postDataJSON();writes.push(args);
  const old=values.get(args.p_product)??{available:true,revision:0};expect(args.p_revision).toBe(old.revision);
  const next={available:args.p_available,revision:old.revision+1};values.set(args.p_product,next);
  if(options.lostReply)return route.abort('failed');return route.fulfill({json:next});
 });
 return {writes,reads};
}
test('lite family/detail:one grouped read;manual parent/leaf CAS;no cost,profit,stock or receiving controls',async({page})=>{
 await page.setViewportSize({width:390,height:1000});const api=await mock(page);await page.goto(url);
 const dialog=page.getByRole('dialog',{name:'تفاصيل المنتج'}),panel=dialog.getByRole('region',{name:'التوفر اليدوي'});
 await expect(panel.getByRole('switch')).toHaveCount(3);expect(api.reads).toEqual([[family,...inventoryProducts.slice(5,7).map(p=>p.id)].sort()]);
 const parent=panel.getByRole('switch',{name:'توفر عائلة شيبس بنكهاته',exact:true});await expect(parent).toHaveAttribute('aria-checked','true');await parent.tap();
 await expect(parent).toHaveAttribute('aria-checked','false');expect(api.writes).toEqual([{p_product:family,p_available:false,p_revision:0}]);
 await expect(panel.getByText('المنتج الأساسي غير متوفر أو مخفي',{exact:true})).toHaveCount(2);
 const flavor=panel.getByRole('switch',{name:'توفر جبنة',exact:true});await expect(flavor).toHaveAttribute('aria-checked','true');await flavor.tap();
 await expect(flavor).toHaveAttribute('aria-checked','false');expect(api.writes[1]).toEqual({p_product:leaf,p_available:false,p_revision:0});
 await expect(dialog).not.toContainText(/الربحية|تصحيح التكلفة|طرد شراء المورد|الرصيد الحالي|المحجوز|استلام مخزون لهذه النكهة/);
});
test('lost toggle response does not retry or guess state;explicit refresh recovers committed revision',async({page})=>{
 const api=await mock(page,{lostReply:true});await page.goto(url);
 const panel=page.getByRole('region',{name:'التوفر اليدوي'});await expect(panel.getByRole('switch')).toHaveCount(3);
 await panel.getByRole('switch',{name:'توفر عائلة شيبس بنكهاته',exact:true}).click();
 await expect(panel.getByRole('alert')).toContainText('AVL-01');expect(api.writes).toHaveLength(1);expect(api.reads).toHaveLength(1);await expect(panel.getByRole('switch')).toHaveCount(0);
 await panel.getByRole('button',{name:'إعادة قراءة التوفر'}).click();await expect(panel.getByRole('switch',{name:'توفر عائلة شيبس بنكهاته',exact:true})).toHaveAttribute('aria-checked','false');
 expect(api.writes).toHaveLength(1);expect(api.reads).toHaveLength(2);
});
test('manual controls are owner-only and mode drift fails closed',async({page})=>{
 const api=await mock(page,{full:true});await page.goto(url);
 const panel=page.getByRole('region',{name:'التوفر اليدوي'});await expect(panel.getByRole('alert')).toContainText('AVL-01');await expect(panel.getByRole('switch')).toHaveCount(0);expect(api.writes).toHaveLength(0);
 await page.goto(url+'&not-owner');await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('region',{name:'التوفر اليدوي'})).toHaveCount(0);expect(api.reads).toHaveLength(1);
});
test('lite catalog keeps sell prices and names but omits inventory/profit filters and metrics',async({page})=>{
 await page.goto('/e2e/package-f-products-harness.html?sales-only');await expect(page.locator('[data-product-catalog-card]')).toHaveCount(5);
 await expect(page.getByRole('main')).not.toContainText(/تكلفة الرصيد|ربح متوقع|ربح \/ هامش|مخزون يحتاج انتباهك|طرد الشراء/);
 await expect(page.getByRole('button',{name:'استلام',exact:true})).toHaveCount(0);
 await expect(page.getByRole('option',{name:'الأعلى ربحًا',exact:true})).toHaveCount(0);await expect(page.getByRole('option',{name:'الأكثر مخزونًا',exact:true})).toHaveCount(0);
 await expect(page.getByRole('option',{name:'الاسم',exact:true})).toHaveCount(1);await expect(page.getByText('سعر الطرد',{exact:true})).toHaveCount(5);
});
