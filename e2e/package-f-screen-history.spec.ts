import {test,expect,type Page} from './isolated-test';
import {posFixtureIds} from './package-f-pos.fixture';

const harness='/e2e/package-f-screen-history-harness.html?theme=light';
const active=(page:Page)=>page.evaluate(()=>window.__SCREEN_HISTORY_TAB__());
const back=async(page:Page)=>{await page.evaluate(()=>history.back());};
const forward=async(page:Page)=>{await page.evaluate(()=>history.forward());};
const waitTab=async(page:Page,tab:string)=>{await expect.poll(()=>active(page)).toBe(tab);await page.waitForFunction(t=>history.state?.nawasrahScreenHistory?.tab===t,tab);};

for(const width of [390,1280]){
 test(`native Back/Forward records tabs and closes nested/busy/edited layers first ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.goto(harness);
  await expect(page.getByTestId('screen')).toHaveText('home');
  await page.getByTestId('go-orders').click();await page.getByTestId('go-products').click();
  await back(page);await waitTab(page,'orders');await forward(page);await waitTab(page,'products');
  await page.getByRole('button',{name:'افتح نافذة اختبار',exact:true}).click();
  const outer=page.getByRole('dialog',{name:'نافذة اختبار',exact:true});await expect(outer).toBeVisible();
  await outer.getByRole('button',{name:'افتح طبقة داخلية',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'طبقة داخلية',exact:true})).toBeVisible();
  await back(page);await expect(page.getByRole('dialog',{name:'طبقة داخلية',exact:true})).toBeHidden();await expect(outer).toBeVisible();
  await outer.getByRole('button',{name:'فعّل الانشغال',exact:true}).click();await back(page);
  await expect(outer.getByRole('button',{name:'أوقف الانشغال',exact:true})).toBeVisible();await waitTab(page,'products');
  await outer.getByRole('button',{name:'أوقف الانشغال',exact:true}).click();
  await outer.getByLabel('ملاحظة اختبار',{exact:true}).fill('ملاحظة اصطناعية');await back(page);
  const discard=page.getByRole('dialog',{name:'تجاهل التعديلات؟',exact:true});await expect(discard).toBeVisible();
  await page.screenshot({path:info.outputPath(`history-unsaved-${width}.png`)});
  await discard.getByRole('button',{name:'متابعة التعديل',exact:true}).click();
  await expect(outer.getByLabel('ملاحظة اختبار',{exact:true})).toHaveValue('ملاحظة اصطناعية');
  await back(page);await expect(discard).toBeVisible();await discard.getByRole('button',{name:'تجاهل التعديلات',exact:true}).click();
  await expect(outer).toBeHidden();await waitTab(page,'products');
  await forward(page);await expect(outer).toBeHidden();await waitTab(page,'products');
  expect(await page.evaluate(()=>Object.keys(history.state.nawasrahScreenHistory).sort())).toEqual(['overlay','position','session','tab','version']);
 });

 test(`cart Back requires a decision and Forward never restores an old sale form ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.goto(harness);
  await page.getByTestId('go-pos').click();await page.locator('[data-pos-product-card]').first().click();
  const rows=page.locator('[data-pos-cart-line]');await expect(rows.first()).toBeAttached();
  if(width===390){
   await page.getByRole('button',{name:'مراجعة السلة والعميل',exact:true}).click();
   const cart=page.getByRole('dialog').filter({has:page.locator('[data-pos-cart-line]')});await expect(cart).toBeVisible();
   await back(page);await expect(cart).toBeHidden();await waitTab(page,'pos');await expect(rows.first()).toBeAttached();
  }
  page.once('dialog',async dialog=>{expect(dialog.message()).toContain('السلة غير محفوظة');await dialog.dismiss();});
  await back(page);await waitTab(page,'pos');await expect(rows.first()).toBeAttached();
  page.once('dialog',async dialog=>{expect(dialog.message()).toContain('إفراغ السلة');await dialog.accept();});
  await back(page);await waitTab(page,'home');
  await forward(page);await waitTab(page,'pos');await expect(page.locator('[data-pos-product-card]').first()).toBeVisible();
  await expect(page.locator('[data-pos-cart-line]')).toHaveCount(0);
  expect(await page.evaluate(k=>localStorage.getItem(k),`nawasrah:pos-v2:attempt:v1:${posFixtureIds.actor}`)).toBeNull();
 });

 test(`unknown sale Back cannot discard the pending intent, replay it, or select another tab ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const requests:unknown[]=[];
  await page.route('**/rest/v1/rpc/create_pos_sale_v2',route=>{requests.push(route.request().postDataJSON());return route.fulfill({status:500,json:{code:'XX000',message:'SYNTHETIC_UNKNOWN'}});});
  await page.goto(harness);await page.getByTestId('go-pos').click();await page.locator('[data-pos-product-card]').first().click();
  await page.locator('[data-testid="pos-complete-sale"]:visible').click();
  await expect(page.getByRole('status').filter({hasText:'لم نتأكد هل البيع انحفظ'})).toContainText('POS-03');expect(requests).toHaveLength(1);
  const key=`nawasrah:pos-v2:attempt:v1:${posFixtureIds.actor}`,before=await page.evaluate(k=>localStorage.getItem(k),key);
  expect(JSON.parse(before!).status).toBe('OUTCOME_UNKNOWN');
  await back(page);await waitTab(page,'pos');await forward(page);await page.evaluate(()=>window.__SCREEN_HISTORY_GO__('orders'));
  await waitTab(page,'pos');expect(requests).toHaveLength(1);expect(await page.evaluate(k=>localStorage.getItem(k),key)).toBe(before);
  await expect(page.locator('[data-testid="pos-complete-sale"]:visible')).toBeDisabled();
 });
}

test('mobile drawer Back closes it once and root home Back leaves the application normally',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/e2e/admin-navigation-harness.html');await page.goto(harness);
 await expect(page.getByTestId('screen')).toHaveText('home');
 await page.getByRole('button',{name:'فتح القائمة الرئيسية',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'القائمة الرئيسية',exact:true})).toBeVisible();
 await back(page);await expect(page.getByRole('dialog',{name:'القائمة الرئيسية',exact:true})).toBeHidden();await waitTab(page,'home');
 await back(page);await expect(page).toHaveURL(/\/e2e\/admin-navigation-harness\.html$/u);
});

for(const screen of ['orders','reports','inventory','shifts','cheques'])test(`existing actual App deep link ${screen} preserves browser Back`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(`/e2e/owner-alert-links-harness.html?screen=${screen}&${screen==='orders'?'order':'cheque'}=11111111-1111-4111-8111-111111111111`);
 await expect.poll(()=>page.evaluate(()=>window.__OWNER_ALERT_TAB__())).toBe(screen);
 await page.waitForFunction(t=>history.state?.nawasrahScreenHistory?.tab===t,screen);
 await back(page);await expect.poll(()=>page.evaluate(()=>window.__OWNER_ALERT_TAB__())).toBe('home');
});

test('standalone PWA mode retains the same tab history without storing a form',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'standalone',{get:()=>true,configurable:true}));
 await page.setViewportSize({width:390,height:844});await page.goto(harness);
 await page.getByTestId('go-reports').click();await page.getByTestId('go-shifts').click();await back(page);await waitTab(page,'reports');
 await expect(page.getByTestId('screen')).toHaveText('reports');
});
