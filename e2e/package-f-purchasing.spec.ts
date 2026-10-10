import AxeBuilder from '@axe-core/playwright';
import {test,expect,type Page} from './isolated-test';
import {checkLayout} from './package-f-layout';
import {purchaseOrders,supplierId,warehouseId,productId,otherSupplierRow} from './package-f-purchasing.fixture';
async function audit(page:Page){
 await page.evaluate(()=>document.fonts.ready);
 const dialogs=page.getByRole('dialog');
 if(await dialogs.count()){
  const dialog=dialogs.last();
  if(await dialog.getAttribute('data-state')!==null)await expect(dialog).toHaveAttribute('data-state','open');
  await dialog.evaluate(async e=>{await Promise.all(e.getAnimations({subtree:true}).filter(a=>a.effect instanceof KeyframeEffect&&a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>undefined)));});
 }
 const root=page.getByTestId('purchasing-workbench');
 await checkLayout(page,root);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(root).not.toContainText(/[٠-٩]/u);
 const axe=await new AxeBuilder({page}).analyze();
 expect(axe.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
}
for(const theme of ['light','dark'])for(const width of [390,820,1440]){
 test(`purchasing lists and receipt ${theme} ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto(`/e2e/package-f-purchasing-harness.html?theme=${theme}`);
  await expect(page.getByText('PO-10480',{exact:true})).toBeVisible();await expect(page.getByText('PO-10481',{exact:true})).toBeVisible();
  await audit(page);
  await page.getByRole('button',{name:'الاستلام المباشر',exact:true}).click();
  await expect(page.getByText('GR-10481',{exact:true}).first()).toBeVisible();await audit(page);
  await page.getByRole('button',{name:'تفاصيل سند',exact:true}).click();
  await expect(page.getByRole('button',{name:'تسجيل دفعة للمورد',exact:true})).toBeVisible();await audit(page);
  await page.getByRole('button',{name:'تفاصيل أمر',exact:true}).click();
  await expect(page.getByRole('button',{name:'استلام المتبقي',exact:true})).toBeVisible();await audit(page);
 });
}
for(const theme of ['light','dark']){
 test(`receipt paper remains readable independently of screen theme ${theme}`,async({page})=>{
  await page.goto(`/e2e/package-f-purchasing-harness.html?theme=${theme}&view=receipt`);
  await page.emulateMedia({media:'print'});
  const title=page.getByRole('heading',{name:'إذن استلام بضائع من مورد (Direct Goods Receipt)',exact:true});
  await expect(title).toBeVisible();
  expect(await title.evaluate(e=>getComputedStyle(e).color)).toBe('rgb(15, 27, 45)');
  expect(await title.evaluate(e=>getComputedStyle(e.closest('.nw-purchasing-fields')!).getPropertyValue('--nw-surface').trim())).toBe('#ffffff');
 });
 test(`purchasing forms and guarded confirmations ${theme}`,async({page})=>{
  await page.setViewportSize({width:390,height:900});
  for(const [view,title] of [['create-po','أمر الشراء'],['supplier','بيانات المورد'],['receive','استلام البضائع'],['payment','دفعة المورد'],['create-direct','سند استلام جديد'],['receipt-payment','دفعة السند'],['cancel','تأكيد إلغاء سند الاستلام']]){
   await page.goto(`/e2e/package-f-purchasing-harness.html?theme=${theme}&view=${view}`);
   const dialog=page.getByRole('dialog',{name:title,exact:true});await expect(dialog).toBeVisible();
   if(view==='create-direct')await expect(dialog.getByRole('combobox').first()).toContainText('شركة النواصرة للتوريد');
   if(view==='cancel'){
    await expect(dialog.getByText('هذه دفعة نقدية من وردية مغلقة',{exact:false})).toBeVisible();
    await expect(dialog.getByRole('button',{name:'إلغاء السند وعكس دفعة 400.000',exact:true})).toBeEnabled();
   }
   await audit(page);
   const fields=await dialog.locator('input:not([type="checkbox"]),select,textarea').evaluateAll(es=>es.filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect().height));
   expect(fields.every(h=>h>=44)).toBe(true);
   const primary=dialog.locator('button[type="submit"]');
   if(await primary.count())await expect(primary.last()).toBeInViewport();
  }
 });
}

test('real PurchasesView quick receive opens its existing V2 dialog',async({page})=>{
 await page.goto('/e2e/package-f-purchasing-harness.html?theme=light');
 await expect(page.getByRole('button',{name:'استلام',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'استلام',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'استلام البضائع',exact:true})).toBeVisible();
 await expect(page.getByRole('dialog').getByText('PO-10481',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'إغلاق استلام البضائع',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'استلام البضائع',exact:true})).toHaveCount(0);
});
test('real PurchasesView new voucher opens its existing supplier payment dialog',async({page})=>{
 await page.goto('/e2e/package-f-purchasing-harness.html?theme=light');
 await page.getByRole('button',{name:'سند صرف جديد',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'دفعة المورد',exact:true})).toBeVisible();
 await expect(page.getByRole('dialog').getByRole('combobox').first()).toHaveValue(otherSupplierRow.id);
 await page.getByRole('button',{name:'إغلاق دفعة المورد',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'دفعة المورد',exact:true})).toHaveCount(0);
});

test('selected supplier is preserved by the purchase list payment action',async({page})=>{
 await page.goto('/e2e/package-f-purchasing-harness.html?theme=light');
 await page.getByRole('button',{name:'3. الموردين (2)',exact:true}).click();
 await page.locator(`[data-supplier-card="${supplierId}"]`).getByRole('button',{name:'تسديد دفعة',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'دفعة المورد',exact:true});
 await expect(dialog.getByRole('combobox').first()).toHaveValue(supplierId);
 await page.getByRole('button',{name:'إغلاق دفعة المورد',exact:true}).click();
 await expect(dialog).toHaveCount(0);
});

test('list and detail submission payloads match with distinct stable intent keys',async({page})=>{
 const captured:Record<string,unknown>[]=[];
 await page.route('**/rest/v1/rpc/receive_purchase_order_v2',async route=>{
  captured.push(route.request().postDataJSON());
  await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'ISOLATED_PROBE_REJECTION',code:'P0001'})});
 });
 await page.route('**/rest/v1/rpc/record_supplier_payment',async route=>{
  captured.push(route.request().postDataJSON());
  await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'ISOLATED_PROBE_REJECTION',code:'P0001'})});
 });
 const receive=async(detail:boolean)=>{
  await page.goto('/e2e/package-f-purchasing-harness.html?theme=light'+(detail?'&view=po-detail':''));
  await page.getByRole('button',{name:detail?'استلام المتبقي':'استلام',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'استلام البضائع',exact:true});
  await expect(dialog.getByText('PO-10481',{exact:true})).toBeVisible();
  await dialog.getByRole('spinbutton').nth(0).fill('2');await dialog.getByRole('spinbutton').nth(1).fill('20');
  await dialog.getByRole('button',{name:'تأكيد الاستلام وزيادة المخزون',exact:true}).click();
  await expect(dialog.getByText('ISOLATED_PROBE_REJECTION',{exact:true})).toBeVisible();
 };
 await receive(false);await receive(true);
 const payment=async(detail:boolean)=>{
  await page.goto('/e2e/package-f-purchasing-harness.html?theme=light'+(detail?'&view=po-detail&po=received':''));
  if(detail)await page.getByRole('button',{name:'تسديد دفعة',exact:true}).click();
  else await page.locator(`[data-purchase-order-card="${purchaseOrders[2].id}"]`).getByRole('button',{name:'دفع',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'دفعة المورد',exact:true});
  await expect(dialog.getByRole('combobox').nth(1)).toHaveValue(purchaseOrders[2].id);
  await dialog.getByRole('spinbutton').fill('100');
  await dialog.getByRole('button',{name:'تأكيد وطباعة سند الصرف',exact:true}).click();
  await expect(dialog.getByText('ISOLATED_PROBE_REJECTION',{exact:true})).toBeVisible();
 };
 await payment(false);await payment(true);
 expect(captured).toHaveLength(4);
 const business=(p:Record<string,unknown>)=>{const {p_idempotency_key,...rest}=p;expect(p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/i);return rest;};
 expect(business(captured[0])).toEqual(business(captured[1]));
 expect(business(captured[2])).toEqual(business(captured[3]));
 expect(new Set(captured.map(x=>x.p_idempotency_key)).size).toBe(4);
 expect(captured[0]).toMatchObject({p_purchase_order_id:purchaseOrders[1].id,p_warehouse_id:warehouseId,p_lines:[{
  purchase_order_item_id:purchaseOrders[1].items[0].id,commercial_quantity:2,gross_amount_in_minor_units:40000,components:[{product_id:productId,base_quantity:2}]}]});
 expect(captured[2]).toMatchObject({p_supplier_id:supplierId,p_purchase_order_id:purchaseOrders[2].id,p_amount_in_minor_units:100000,p_payment_method:'cash'});
});
