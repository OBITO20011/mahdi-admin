import AxeBuilder from '@axe-core/playwright';
import {test,expect,type Page} from './isolated-test';
import {inventoryProducts} from './package-f-inventory.fixture';
const url=(query='')=>'/e2e/package-f-navigation206-harness.html?'+query;
async function axe(page:Page){const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();expect(result.violations.filter(item=>['serious','critical'].includes(item.impact??'')).map(item=>({id:item.id,targets:item.nodes.map(node=>node.target)}))).toEqual([]);}
for(const theme of ['light','dark'])for(const width of [390,1440])test(`navigation206 ${theme} ${width}:compact Home and canonical layout`,async({page},info)=>{
  await page.setViewportSize({width,height:844});await page.goto(url('theme='+theme));await expect(page.getByRole('heading',{name:'أهلاً المالك'})).toBeVisible();await page.evaluate(()=>document.fonts.ready);
  const kpis=page.getByTestId('home-kpis');await expect(kpis).toContainText('4,100.000');await expect(kpis).toContainText('0.000');await expect(kpis).toContainText('كاش 0.000');await expect(kpis).toContainText('CliQ 0.000');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(width===390){const box=await page.getByRole('button',{name:/تنبيه مخزون/}).boundingBox();expect(box!.y+box!.height).toBeLessThan(764);await expect(page.getByRole('button',{name:'فتح القائمة الرئيسية'})).toBeVisible();}
  else await expect(page.getByRole('button',{name:'فتح القائمة الرئيسية'})).toBeHidden();
  await axe(page);await page.screenshot({path:info.outputPath(`navigation206-${theme}-${width}.png`),fullPage:true});
});
test('drawer traps/restores focus,uses RTL,keeps BottomTabs,and consumes exactly one Back',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto(url());const opener=page.getByRole('button',{name:'فتح القائمة الرئيسية'});await opener.click();
  const dialog=page.getByRole('dialog',{name:'القائمة الرئيسية'});await expect(dialog).toBeVisible();await expect(page.locator('#root')).toHaveJSProperty('inert',true);
  await dialog.evaluate(async node=>{await Promise.all(node.getAnimations().map(animation=>animation.finished));});
  const rect=await dialog.boundingBox();expect(rect!.x+rect!.width).toBeCloseTo(390,0);
  await page.keyboard.press('Shift+Tab');expect(await dialog.evaluate(node=>node.contains(document.activeElement))).toBe(true);await page.keyboard.press('Tab');expect(await dialog.evaluate(node=>node.contains(document.activeElement))).toBe(true);
  const short=await dialog.getByRole('button').evaluateAll(buttons=>buttons.filter(item=>item.getClientRects().length&&item.getBoundingClientRect().height<44).map(item=>item.textContent));expect(short).toEqual([]);await axe(page);
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(opener).toBeFocused();await expect(page.locator('#root')).toHaveJSProperty('inert',false);
  await opener.click();await expect(dialog).toBeVisible();await page.evaluate(()=>history.back());await expect(dialog).toHaveCount(0);expect(page.url()).toContain('navigation206-harness');await expect(page.getByRole('navigation',{name:'التنقل الرئيسي'})).toHaveCount(1);
});
test('drawer closes outside,on swipe,on destination,on resize and after locking',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto(url());const opener=page.getByRole('button',{name:'فتح القائمة الرئيسية'}),dialog=page.getByRole('dialog',{name:'القائمة الرئيسية'});
  await opener.click();await page.mouse.click(5,150);await expect(dialog).toHaveCount(0);
  await opener.click();await dialog.dispatchEvent('pointerdown',{pointerId:1,clientX:100,clientY:100});await dialog.dispatchEvent('pointerup',{pointerId:1,clientX:250,clientY:100});await expect(dialog).toHaveCount(0);
  await opener.click();await dialog.locator('[data-side-nav-item="sales-orders"]').click();await expect(dialog).toHaveCount(0);await expect(page.getByTestId('navigation206-state')).toHaveText('orders:');
  await opener.click();await page.setViewportSize({width:1440,height:844});await expect(dialog).toHaveCount(0);await page.setViewportSize({width:390,height:844});
  await opener.click();await page.evaluate(()=>window.__NAV206_LOCK__(true));await expect(dialog).toHaveCount(0);await page.getByRole('button',{name:'فك قفل الاختبار'}).click();await expect(dialog).toHaveCount(0);await expect(opener).toBeVisible();
});
test('More has three-column search,restricted roles and independent account controls',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto(url('start=more&role=view_only'));
  await expect(page.locator('[data-navigation-id="sales-pos"]')).toHaveCount(0);await expect(page.locator('[data-navigation-id="finance-shifts"]')).toHaveCount(0);await expect(page.locator('[data-navigation-id="inventory-damage"]')).toHaveCount(0);
  await expect(page.getByRole('region',{name:'الحساب والأمان'})).toBeVisible();await expect(page.locator('[data-navigation-id="profile-summary"]')).toBeVisible();
  await page.getByRole('searchbox',{name:'ابحث عن شاشة'}).fill('إِستلام');await expect(page.getByText('لا توجد شاشة مطابقة.')).toBeVisible();
  await page.goto(url('start=more'));const columns=await page.locator('[data-navigation-group="sales"] > div').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length);expect(columns).toBe(3);
  await page.getByRole('searchbox',{name:'ابحث عن شاشة'}).fill('إِستلام');await expect(page.locator('[data-navigation-group]')).toHaveCount(1);await expect(page.locator('[data-navigation-id="supplier-receiving"]')).toBeVisible();await expect(page.locator('[data-navigation-id="sales-pos"]')).toHaveCount(0);await axe(page);
});
test('customer return opens all-date invoice search and accountant retains receiving quick action',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto(url('start=more'));await page.locator('[data-navigation-id="customer-returns"]').click();await expect(page.getByRole('button',{name:'كل التواريخ',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('textbox',{name:'بحث برقم الفاتورة'})).toBeFocused();
  await page.setViewportSize({width:1440,height:844});await page.goto(url('role=accountant'));await expect(page.locator('[data-side-nav-action="pos-sale"]')).toHaveCount(0);await expect(page.locator('[data-side-nav-action="goods-receipt"]')).toBeVisible();
});
test('secondary owner membership opens the existing owner panel through its navigation tile',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto(url('start=more&role=cashier&multi'));
  await page.locator('[data-navigation-id="finance-withdrawals"]').click();await expect(page.getByRole('button',{name:'سحب من الدرج',exact:true})).toBeVisible();
});
test('damage picker reads a fresh product before existing damage form and keeps busy close lock',async({page})=>{
  await page.setViewportSize({width:390,height:844});let release:()=>void=()=>undefined;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/rest/v1/rpc/search_admin_products',async route=>{const args=route.request().postDataJSON();if(args.p_product_id)await gate;await route.fulfill({json:[{...inventoryProducts[0],warehouse_id:'92600000-0000-4000-8000-000000000201'}]});});
  await page.route('**/rest/v1/rpc/get_supplier_replacement_options_v1',route=>route.fulfill({json:{contractVersion:208,products:[{id:inventoryProducts[0].id,name:inventoryProducts[0].name_ar,sku:inventoryProducts[0].sku,baseUnitName:'باكيت',unitsPerParcel:24}],suppliers:[],warehouses:[{id:'92600000-0000-4000-8000-000000000201',name:'مستودع المحل',branchId:'branch'}],lastSuppliers:[]}}));
  await page.goto(url('start=more'));await page.locator('[data-navigation-id="inventory-damage"]').click();await expect(page.getByRole('searchbox',{name:'بحث اختر الصنف التالف'})).toBeVisible();
  await page.getByRole('button',{name:/عصير برتقال 250مل/}).click();await expect(page.locator('[aria-busy="true"]')).toBeVisible();await page.keyboard.press('Escape');await page.getByRole('button',{name:'إغلاق',exact:true}).click();await expect(page.getByRole('searchbox',{name:'بحث اختر الصنف التالف'})).toBeVisible();
  release();await expect(page.getByRole('searchbox',{name:'بحث اختر الصنف التالف'})).toHaveCount(0);await expect(page.getByRole('combobox',{name:'سبب التلف',exact:true})).toHaveValue('shop_breakage');await expect(page.locator(`[data-product-choice="${inventoryProducts[0].id}"]`)).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('region',{name:'الصنف',exact:true})).not.toContainText('INV-0001');
});
test('real movement read renders full totals,paging and explicit mismatch without modifying expected',async({page})=>{
  await page.setViewportSize({width:390,height:844});const reads:unknown[]=[];
  await page.route('**/rest/v1/rpc/get_cash_shift_movement_page',async route=>{const args=route.request().postDataJSON();reads.push(args);await route.fulfill({json:{shiftId:args.p_shift_id,kind:args.p_kind,method:args.p_method,generatedAt:'2026-10-20T10:00:00Z',shiftStatus:'open',canonicalAmountInMinorUnits:20000,totalAmountInMinorUnits:19000,totalCount:26,page:args.p_page,pageSize:25,totalPages:2,evidenceStatus:'mismatch',rows:Array.from({length:args.p_page===1?25:1},(_,n)=>({source:'supplier_payment',id:'payment-'+args.p_page+'-'+n,reference:'SUP-'+args.p_page+'-'+n,at:'2026-10-20T09:00:00Z',method:'cash',amountInMinorUnits:args.p_page===1?700:1500,note:null}))}});});
  await page.goto(url());await page.getByText('تفصيل داخل / طالع',{exact:true}).click();await page.getByRole('button',{name:'تفصيل دفعات الموردين كاش',exact:true}).click();const dialog=page.getByRole('dialog',{name:'تفصيل دفعات الموردين كاش'});await expect(dialog).toContainText('19.000');await expect(dialog).toContainText('20.000');await expect(dialog).toContainText('لا تطابق مبلغ العرض');await expect(dialog).toContainText('SUP-1');await dialog.getByRole('button',{name:'التالي',exact:true}).click();await expect(dialog).toContainText('SUP-2');await dialog.getByRole('button',{name:'إغلاق',exact:true}).click();await expect(page.getByTestId('cash-flow-summary')).toContainText('390.000');expect(reads).toHaveLength(2);
});
