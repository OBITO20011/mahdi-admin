import AxeBuilder from '@axe-core/playwright';
import {test,expect,type Page} from './isolated-test';
import {inventoryProducts,inventoryMetrics} from './package-f-inventory.fixture';

const url=(query='')=>'/e2e/package-f-inventory-harness.html?'+query;
const card=(page:Page,index=0)=>page.locator(`[data-inventory-product-card="${inventoryProducts[index].id}"]:visible`);
async function layout(page:Page){
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.getByTestId('inventory-workbench')).not.toContainText(/[٠-٩]/u);
  const escaped=await page.getByTestId('inventory-workbench').evaluate(root=>{
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),result:string[]=[];
    while(walker.nextNode()){
      const node=walker.currentNode,parent=node.parentElement;
      if(!parent||!node.textContent?.trim()||parent.closest('.sr-only,style')||!parent.getClientRects().length)continue;
      const box=parent.closest('p,h1,h2,h3,h4,h5,td,th,button,summary,div,span')??parent;
      const bounds=box.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(node);
      for(const rect of range.getClientRects())if(rect.width&&(rect.left<bounds.left-1||rect.right>bounds.right+1))result.push(node.textContent.trim());
    }
    return result;
  });expect(escaped).toEqual([]);
}
async function axe(page:Page){
  const result=await new AxeBuilder({page}).include('[data-testid="inventory-workbench"]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  expect(result.violations.filter(v=>v.impact==='serious'||v.impact==='critical').map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
}
for(const theme of ['light','dark'])for(const width of [390,820,1440])test(`Inventory ${theme} ${width}: tokens,server KPIs,Latin digits,containment and axe`,async({page},info)=>{
  await page.setViewportSize({width,height:width<1024?844:1125});await page.goto(url('theme='+theme));
  await expect(page.getByTestId('inventory-workbench')).toContainText('18,642.300');
  await expect(page.getByTestId('inventory-workbench')).toContainText('126');
  await expect(page.getByText('الأصناف المفعّلة فقط')).toBeVisible();
  await expect(page.getByTestId('inventory-workbench')).toContainText('120');
  const chips=page.getByRole('tablist',{name:'حالة المخزون'});
  await expect(chips.getByRole('tab')).toHaveCount(4);
  await expect(chips.getByRole('tab',{name:/متوفر/u})).toContainText('124');
  await expect(page.getByTestId('inventory-workbench')).not.toContainText('📦');
  if(width>=768)await expect(page.getByRole('columnheader',{name:'القيمة',exact:true})).toHaveCount(0);
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:info.outputPath(`inventory-${theme}-${width}-list.png`),fullPage:false});
  if(width<768)await card(page).getByRole('button').click();
  else await page.getByRole('button',{name:'تفاصيل المنتج والرصيد: '+inventoryProducts[0].name_ar,exact:true}).filter({visible:true}).click();
  await expect(page.getByTestId('inventory-detail-panel')).toBeVisible();
  await layout(page);await axe(page);
  await expect(page.getByTestId('inventory-detail-panel').getByText('استلام بضاعة',{exact:true})).toBeVisible();
  await expect(page.getByTestId('inventory-detail-panel').getByText('بيع باكيتات',{exact:true})).toBeVisible();
  await expect(page.getByTestId('inventory-detail-panel').getByText('مطابقة الجرد',{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath(`inventory-${theme}-${width}-detail.png`),fullPage:false});
});
test('actual InventoryView and adapter submit exact search/status/warehouse scope,never page-only filters',async({page})=>{
  const requests:Record<string,unknown>[]=[];
  await page.route('**/rest/v1/rpc/get_admin_inventory_product_page',async route=>{
    requests.push(route.request().postDataJSON());
    await route.fulfill({json:{products:inventoryProducts,total_count:126,metrics:inventoryMetrics}});
  });await page.goto(url('live=1'));
  await expect.poll(()=>requests.length).toBe(1);
  expect(requests[0]).toEqual({p_page:1,p_page_size:24,p_search:null,p_branch_id:null,p_warehouse_id:null,p_category_id:null,p_status:'all'});
  await page.getByRole('tab',{name:'منخفض 7',exact:true}).click();await expect.poll(()=>requests.at(-1)?.p_status).toBe('low_stock');
  await page.getByRole('tab',{name:'نفد 2',exact:true}).click();await expect.poll(()=>requests.at(-1)?.p_status).toBe('out_of_stock');
  await page.getByRole('searchbox',{name:'البحث في المخزون'}).fill('625123');await expect.poll(()=>requests.at(-1)?.p_search).toBe('625123');
  await page.getByText('تصفية وبحث متقدم',{exact:true}).click();await page.getByRole('combobox',{name:'المستودع',exact:true}).selectOption('inventory-warehouse');
  await expect.poll(()=>requests.at(-1)?.p_warehouse_id).toBe('inventory-warehouse');
  expect(requests.at(-1)?.p_page_size).toBe(24);
});
test('phone back restores the lower card after actual accepted list reload',async({page})=>{
  await page.route('**/rest/v1/rpc/get_admin_inventory_product_page',route=>route.fulfill({json:{products:inventoryProducts,total_count:24,metrics:inventoryMetrics}}));
  await page.setViewportSize({width:390,height:844});await page.goto(url('theme=dark&live=1'));
  const chosen=card(page,15);await chosen.scrollIntoViewIfNeeded();
  const scroll=page.getByTestId('inventory-scroll'),before=await scroll.evaluate(e=>e.scrollTop);
  expect(before).toBeGreaterThan(500);await chosen.getByRole('button').click();
  const detail=page.getByRole('dialog',{name:'تفاصيل المنتج والرصيد: '+inventoryProducts[15].name_ar});
  await expect(detail).toBeInViewport();
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});let readStarted=false;
  await page.route('**/rest/v1/rpc/get_admin_inventory_product_page',async route=>{
    readStarted=true;await pending;await route.fulfill({json:{products:inventoryProducts,total_count:24,metrics:inventoryMetrics}});
  });
  await page.evaluate(()=>window.__INVENTORY_RELOAD__());await expect.poll(()=>readStarted).toBe(true);
  await detail.getByRole('button',{name:'رجوع للمخزون'}).click();await expect(detail).toHaveCount(0);
  release();await expect.poll(async()=>Math.abs(await scroll.evaluate(e=>e.scrollTop)-before)).toBeLessThanOrEqual(3);
  await expect(chosen).toBeInViewport();await expect(chosen.getByRole('button')).toBeFocused();await axe(page);
});
test('existing receive,stock-count,opening and clear controls retain exact product identity',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto(url());await card(page).getByRole('button').click();
  const modalState=()=>page.evaluate(async()=>{const p='/src/stores/useAppStore.ts';const m=await import(/* @vite-ignore */p);const state=m.storeEngine.getState();return {name:state.currentModal,payload:state.modalData};});
  const panel=page.getByTestId('inventory-detail-panel');
  await panel.getByRole('button',{name:'استلام',exact:true}).click();
  expect(await modalState()).toEqual({name:'receive_goods',payload:{productId:inventoryProducts[0].id}});
  await panel.getByRole('button',{name:'جرد',exact:true}).click();
  expect(await modalState()).toEqual({name:'stock_count',payload:{productId:inventoryProducts[0].id}});
  await panel.getByRole('button',{name:'حذف الرصيد',exact:true}).click();
  const clear=page.getByRole('dialog',{name:'حذف الرصيد الحالي؟',exact:true});
  await expect(clear).toContainText(inventoryProducts[0].name_ar);
  await expect(clear).toContainText(inventoryProducts[0].sku);
  await clear.getByRole('button',{name:'إغلاق',exact:true}).click();
  await panel.getByRole('button',{name:'رجوع للمخزون'}).click();
  await page.getByText('إدارة',{exact:true}).click();
  await page.getByRole('button',{name:'تهيئة المخزون الافتتاحي',exact:true}).click();
  expect(await modalState()).toEqual({name:'inventory_opening_setup',payload:null});
});
test('inventory unavailable read is explicit and does not present guessed zero KPIs',async({page})=>{
  await page.goto(url('unavailable=1'));await expect(page.getByRole('alert')).toHaveText('تعذر تحميل صفحة المخزون.');
  await expect(page.getByTestId('inventory-workbench').getByText('غير متاح',{exact:true})).toHaveCount(4);
  await expect(page.getByRole('button',{name:'إعادة المحاولة'})).toBeVisible();
});
test('existing view-only reader visibility is retained without adding a role policy',async({page})=>{
  await page.goto(url('viewOnly=1'));await expect(page.getByTestId('inventory-workbench')).toContainText('18,642.300');
  await expect(page.locator('[data-side-nav-item="admin-users"]')).toHaveCount(0);
});
test('POS count wording and all short collapsed rail labels are uncut on1280',async({page})=>{
  await page.setViewportSize({width:1280,height:1100});await page.goto('/e2e/package-f-pos-harness.html?theme=light');
  for(const label of await page.locator('[data-rail-label]').all())expect(await label.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  await expect(page.locator('[data-side-nav-item="admin-users"]')).toHaveAttribute('aria-label','المستخدمون والصلاحيات');
  await expect(page.locator('[data-side-nav-item="admin-users"] [data-rail-label]')).toHaveText('الفريق');
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-pos-product-card]').first().click();await expect(page.getByTestId('pos-sticky-checkout')).toContainText('صنف واحد');
  await page.locator('[data-pos-product-card]').nth(1).click();await expect(page.getByTestId('pos-sticky-checkout')).toContainText('صنفان');
});
