import AxeBuilder from '@axe-core/playwright';
import {test,expect,type Page} from './isolated-test';
import {checkLayout} from './package-f-layout';
type Locator = ReturnType<Page['locator']>;
async function stable(page:Page){
 const dialog=page.getByRole('dialog');await expect(dialog).toHaveAttribute('data-state','open');
 await dialog.evaluate(async e=>{await Promise.all(e.getAnimations({subtree:true}).filter(a=>a.effect instanceof KeyframeEffect&&a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>undefined)));});return dialog;
}
async function geometry(page:Page,root:Locator){
 await checkLayout(page,root);
 await page.evaluate(()=>document.fonts.ready);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(root).not.toContainText(/[٠-٩]/u);
 const clippedActions=await root.locator('[data-product-catalog-card] button').evaluateAll(buttons=>buttons.filter(button=>{
  const card=button.closest('[data-product-catalog-card]')!,outer=card.getBoundingClientRect(),box=button.getBoundingClientRect();
  return box.left<outer.left-1||box.right>outer.right+1;
 }).map(button=>button.textContent?.trim()));expect(clippedActions).toEqual([]);
 const escaped=await root.evaluate(element=>{
  const out:string[]=[],walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){
   const text=walker.currentNode,parent=text.parentElement;if(!text.textContent?.trim()||!parent||!parent.getClientRects().length)continue;
   let clipped=false;
   for(let a:HTMLElement|null=parent;a&&a!==element;a=a.parentElement){const s=getComputedStyle(a);if(s.display==='none'||s.visibility==='hidden'||s.textOverflow==='ellipsis'||s.getPropertyValue('-webkit-line-clamp')!=='none'&&Number(s.getPropertyValue('-webkit-line-clamp'))>0){clipped=true;break;}}
   if(clipped)continue;
   const range=document.createRange();range.selectNodeContents(text);const box=parent.getBoundingClientRect();
   for(const r of range.getClientRects())if(r.width&&r.height&&(r.left<box.left-2||r.right>box.right+2||r.top<box.top-2||r.bottom>box.bottom+2))out.push(text.textContent!.trim().slice(0,90));
  }return out;
 });expect(escaped).toEqual([]);
}

for(const theme of ['light','dark'])for(const width of [360,390,430]){
 test(`product header does not clip ${theme} ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.goto('/e2e/package-f-products-harness.html?theme='+theme);
  const cards=page.locator('[data-product-catalog-card]');await expect(cards).toHaveCount(5);
  await page.evaluate(()=>document.fonts.ready);
  for(const card of await cards.all()){
   const header=card.locator(':scope > button').first();
   expect(await header.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
   const outside=await header.locator('h4,span.shrink-0').evaluateAll(nodes=>nodes.filter(n=>{
    const c=n.closest('[data-product-catalog-card]')!.getBoundingClientRect(),r=n.getBoundingClientRect();
    return r.left<c.left||r.right>c.right||r.top<c.top||r.bottom>c.bottom;
   }).map(n=>n.textContent));expect(outside).toEqual([]);
  }
  await checkLayout(page,page.getByTestId('products-workbench'));
 });
}

test('shared layout guard detects hidden ancestor clipping but permits intentional truncation',async({page})=>{
 await page.goto('/e2e/package-f-products-harness.html?theme=light');
 const root=page.getByTestId('products-workbench');await expect(root).toBeVisible();
 await root.evaluate(e=>{e.replaceChildren();const box=document.createElement('div');box.style.cssText='width:40px;overflow:hidden';box.innerHTML='<span style="display:block;width:200px">unintended hidden text</span>';e.append(box);});
 await expect(checkLayout(page,root)).rejects.toThrow('Unintended text clipping');
 await root.evaluate(e=>{e.innerHTML='<p class="truncate" style="width:40px">intentional ellipsis text</p><p class="line-clamp-1" style="width:40px">intentional clamped text</p><span class="sr-only">screen reader text</span>';});
 await checkLayout(page,root);
 await root.evaluate(e=>{e.innerHTML='<div style="width:40px;overflow:hidden"><p class="line-clamp-1" style="width:200px">clamped box itself escaping ancestor</p></div>';});
 await expect(checkLayout(page,root)).rejects.toThrow('Unintended text clipping');
 await root.evaluate(e=>{e.innerHTML='<div style="height:40px;overflow:hidden"><div style="height:40px;overflow:auto"><p style="height:100px">scrollable content</p><p>below scroll viewport</p></div></div>';});
 await checkLayout(page,root);
 await root.evaluate(e=>{e.innerHTML='<div style="height:40px;overflow:auto"><div style="width:40px;overflow:hidden"><span style="display:block;width:200px">clipped inside scrollable area</span></div></div>';});
 await expect(checkLayout(page,root)).rejects.toThrow('Unintended text clipping');
 await root.evaluate(e=>{e.innerHTML='<div style="width:80px;overflow:hidden"><details><summary>summary</summary><p style="width:300px">closed content is not painted</p></details></div>';});
 await checkLayout(page,root);
 await root.locator('details').evaluate(e=>{(e as HTMLDetailsElement).open=true;});
 await expect(checkLayout(page,root)).rejects.toThrow('Unintended text clipping');
 await root.evaluate(e=>{e.innerHTML='<div style="width:40px;overflow:hidden"><details><summary style="width:300px">visible summary is still checked</summary><p>closed content</p></details></div>';});
 await expect(checkLayout(page,root)).rejects.toThrow('Unintended text clipping');
});
async function accessibility(page:Page){
 const results=await new AxeBuilder({page}).analyze();expect(results.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
}
for(const theme of ['light','dark'])for(const width of [390,820,1440]){
 test('products batch2 '+theme+' '+width+': catalogue and four dialogs stay contained,Latin and operable',async({page})=>{
  await page.setViewportSize({width,height:900});await page.goto('/e2e/package-f-products-harness.html?theme='+theme);
  await expect(page.locator('[data-product-catalog-card]')).toHaveCount(5);
  expect(await page.locator('[data-ui="products-hero"]').evaluate(e=>getComputedStyle(e).backgroundImage)).toBe('none');
  await geometry(page,page.getByTestId('products-workbench'));await accessibility(page);
  await expect(page.getByRole('button',{name:'إضافة منتج',exact:true})).toBeInViewport();
  const nav=page.getByRole('navigation',{name:'شاشات المعاينة'});
  for(const [name,title,action] of [
   ['تفاصيل','تفاصيل المنتج','تعديل المنتج'],
   ['نموذج المنتج','بيانات المنتج','إنشاء المنتج'],
   ['تعديل مخزون','تعديل المخزون','تأكيد تعديل المخزون'],
   ['إعداد الطرود','إعداد الطرود المرنة','حفظ إعداد الطرد'],
  ]){
   await nav.getByRole('button',{name,exact:true}).click();const dialog=await stable(page);await expect(dialog).toHaveAccessibleName(title);
   if(name==='إعداد الطرود')await expect(dialog.getByLabel('الصنف / العائلة')).toHaveValue('88888888-8888-4888-8888-000000000001');
   await geometry(page,dialog);
   // Both themes/all surfaces get axe at phone width;all widths get full geometry/action checks.
   if(width===390)await accessibility(page);
   if(name!=='تفاصيل'&&width===390)await expect(dialog.getByRole('button',{name:action,exact:true})).toBeInViewport();
   const inputs=await dialog.locator('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]),select,textarea').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));
   for(const height of inputs)expect(height).toBeGreaterThanOrEqual(44);
   await dialog.getByRole('button',{name:'إغلاق',exact:true}).click();await expect(dialog).toHaveCount(0);
  }
 });
}
test('stock adjustment forwards the same exact payload and keeps the busy Escape guard',async({page})=>{
 let payload:unknown,release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/rest/v1/rpc/adjust_inventory_stock',async route=>{payload=route.request().postDataJSON();await barrier;await route.fulfill({status:400,json:{message:'رفض معزول متعمد؛لم تكتب حركة',code:'FIXTURE_REJECTION'}});});
 await page.goto('/e2e/package-f-products-harness.html?view=stock&theme=light');const dialog=await stable(page);
 await dialog.getByLabel('الكمية',{exact:true}).fill('3');await dialog.getByLabel('ملاحظات إضافية',{exact:true}).fill('معاينة');
 await dialog.getByRole('button',{name:'تأكيد تعديل المخزون',exact:true}).click();
 await expect.poll(()=>payload).toEqual({p_warehouse_id:'88888888-8888-4888-8888-000000000099',p_product_id:'88888888-8888-4888-8888-000000000001',p_actual_quantity:103,p_reason:'تسوية زيادة ظهرت أثناء الجرد (معاينة)',p_adjustment_type:'manual'});
 await expect(dialog.locator('form')).toHaveAttribute('aria-busy','true');await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
 release();await expect(dialog.locator('form')).toHaveAttribute('aria-busy','false');await expect(dialog).toBeVisible();
});
test('family details and parcel configuration retain flavors and explicit owner confirmation',async({page})=>{
 await page.goto('/e2e/package-f-products-harness.html?view=detail&family=1&theme=dark');let dialog=await stable(page);
 await dialog.getByRole('button',{name:'إضافة نكهة',exact:true}).click();await expect(dialog.getByPlaceholder('مثال: جبنة')).toBeVisible();await accessibility(page);await geometry(page,dialog);
 // Close the existing flavor form then the modal,without changing either handler.
 await dialog.getByRole('button',{name:'إغلاق',exact:true}).last().click();
 await dialog.getByRole('button',{name:'إغلاق',exact:true}).click();await expect(dialog).toHaveCount(0);
 await page.getByRole('navigation',{name:'شاشات المعاينة'}).getByRole('button',{name:'إعداد الطرود',exact:true}).click();dialog=await stable(page);
 await dialog.getByLabel('حالة الميزة',{exact:true}).selectOption('OFF');await expect(dialog.getByRole('button',{name:'تأكيد تغيير حالة الميزة'})).toBeDisabled();
 await dialog.getByRole('checkbox',{name:'أؤكد تغيير الحالة إلى متوقفة'}).check();await expect(dialog.getByRole('button',{name:'تأكيد تغيير حالة الميزة'})).toBeEnabled();
 await dialog.getByLabel('الصنف / العائلة').selectOption('88888888-8888-4888-8888-000000000005');
 await expect(dialog.getByRole('checkbox',{name:'جبنة',exact:true})).toBeChecked();await expect(dialog.getByRole('checkbox',{name:'فلفل',exact:true})).toBeChecked();
 await geometry(page,dialog);await accessibility(page);
});
test('Profile displays Arabic roles and a single LTR email line with full title',async({page})=>{
 await page.setViewportSize({width:390,height:900});await page.goto('/e2e/package-f-more-harness.html?theme=light&view=profile');const dialog=await stable(page);
 await expect(dialog).not.toContainText('Owner');await expect(dialog.getByText('المالك',{exact:true})).toBeVisible();
 await expect(dialog.getByText('صلاحيات الحساب الحالية: المالك',{exact:true})).toBeVisible();
 const email=dialog.locator('p[data-field="profile-email"]');await expect(email).toHaveAttribute('dir','ltr');await expect(email).toHaveAttribute('title','fixture@example.invalid');
 expect(await email.evaluate(e=>{const s=getComputedStyle(e);return s.whiteSpace==='nowrap'&&s.textOverflow==='ellipsis'&&s.overflow==='hidden'&&e.scrollHeight<=e.clientHeight;})).toBe(true);
});
