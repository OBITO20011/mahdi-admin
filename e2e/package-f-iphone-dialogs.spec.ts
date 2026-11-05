import {checkLayout} from './package-f-layout';
import {test,expect} from './isolated-test';
test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true,
 userAgent:async({browserName},use)=>{await use({"webkit":"Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1","chromium":"Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.34 Mobile Safari/537.36"}[browserName==='webkit'?'webkit':'chromium']);},
});
test.beforeEach(async({page,browserName})=>{expect(await page.evaluate(()=>navigator.userAgent)).toMatch(browserName==='webkit'?/iPhone/u:/Android/u);});
const url='/e2e/package-f-iphone-dialogs-harness.html';

for(const kind of ['sheet','cart','action']){
 test(`${kind}: touch isolation, fixed-bar layering, internal last action and exact scroll restoration`,async({page})=>{
  await page.goto(url);await page.evaluate(()=>window.scrollTo(0,200));const before=await page.evaluate(()=>scrollY);
  // Opening via script avoids Playwright's scroll-into-view changing the baseline.
  await page.getByRole('button',{name:kind,exact:true}).evaluate((b:HTMLButtonElement)=>b.click());
  const layer=page.locator('[data-nw-dialog-layer]');await expect(layer).toBeVisible();
  expect(await page.evaluate(()=>document.body.style.position)).toBe('fixed');
  const oldY=await page.evaluate(()=>document.body.style.top);await page.touchscreen.tap(10,820);
  await expect(page.getByTestId('background-count')).toHaveText('0');
  expect(await page.evaluate(()=>document.body.style.top)).toBe(oldY);
  const fields=await page.locator('input,select,textarea').evaluateAll(elements=>elements.map(e=>parseFloat(getComputedStyle(e).fontSize)));
  expect(fields.every(size=>size>=16)).toBe(true);
  // Scroll the actual scroll container to the end; no forced click can bypass a bar.
  const last=page.getByTestId('last-action');await last.scrollIntoViewIfNeeded();await expect(last).toBeInViewport();await checkLayout(page,layer);await last.tap();
  await expect(page.locator('[data-nw-dialog-layer]')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(before);
  await expect(page.getByTestId('background-action')).not.toHaveAttribute('inert');
  await page.getByTestId('background-action').tap();await expect(page.getByTestId('background-count')).toHaveText('1');
 });
}
test('nested dialog restores first dialog, focus and its scroll; Back closes top only',async({page})=>{
 await page.goto(url);await page.getByRole('button',{name:'sheet',exact:true}).tap();const first=page.getByRole('dialog',{name:'عكس دفعة عميل',exact:true});
 await first.getByRole('button',{name:'نافذة ثانية'}).tap();const nested=page.getByRole('dialog',{name:'متداخلة',exact:true});await expect(nested).toBeVisible();
 await page.goBack();await expect(nested).toBeHidden();await expect(first).toBeVisible();await expect(first.getByRole('button',{name:'نافذة ثانية'})).toBeFocused();
 await first.getByRole('button',{name:'إغلاق',exact:true}).tap();await expect(first).toBeHidden();
});
for(const label of ['إلغاء مسح الباركود وإغلاق الكاميرا','إلغاء والمتابعة بالإدخال اليدوي']){
 test(`flavor camera touch ${label}: no reopen, scanner stops once, draft retained`,async({page})=>{
  await page.goto(url);await page.getByRole('button',{name:'camera',exact:true}).tap();await page.getByText('متقدم: التغليف والمخزون والصورة',{exact:true}).tap();await page.getByRole('switch').tap();
  const barcode=page.getByLabel('باركود النكهة (اختياري) 1',{exact:true});await barcode.fill('000123');
  await page.getByRole('button',{name:'مسح باركود النكهة بالكاميرا 1'}).tap();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {__dialogProbe:()=>{starts:number}}).__dialogProbe().starts)).toBe(1);
  await page.evaluate(()=>window.dispatchEvent(new Event('dialog-parent-render')));await expect(page.locator('main')).toHaveAttribute('data-revision','1');
  expect(await page.evaluate(()=>(window as unknown as {__dialogProbe:()=>{starts:number;stops:number}}).__dialogProbe())).toMatchObject({starts:1,stops:0});
  await page.getByRole('button',{name:label,exact:true}).tap();
  await expect(page.getByRole('dialog',{name:'مسح باركود المنتج',exact:true})).toHaveCount(0);await expect(barcode).toHaveValue('000123');
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {__dialogProbe:()=>{stops:number}}).__dialogProbe().stops)).toBe(1);
  // Fresh parent render (a manual edit) must not recreate a closed scanner.
  await barcode.fill('000124');await expect(page.getByRole('dialog',{name:'مسح باركود المنتج',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>(window as unknown as {__dialogProbe:()=>{starts:number;calls:number}}).__dialogProbe())).toMatchObject({starts:1,calls:0});
 });
}
test('manual menu backdrop intercepts touch; dynamically inserted background stays inert',async({page})=>{
 await page.goto(url);await page.getByRole('button',{name:'قائمة اختبار',exact:true}).tap();
 await page.evaluate(()=>{const b=document.createElement('button');b.id='late-background';b.onclick=()=>document.body.setAttribute('data-leaked','yes');document.body.append(b);});
 await expect(page.locator('#late-background')).toHaveAttribute('inert');await page.touchscreen.tap(10,20);await expect(page.getByTestId('background-count')).toHaveText('0');expect(await page.locator('body').getAttribute('data-leaked')).toBeNull();
});
test('safe-area + visual viewport height are real modal constraints; fallback keeps isolation',async({page})=>{
 await page.goto(url);await page.addStyleTag({content:':root{--nw-safe-top:47px;--nw-safe-bottom:34px}'});
 await page.getByRole('button',{name:'action',exact:true}).tap();const layer=page.locator('[data-nw-dialog-layer]');const box=await layer.boundingBox();expect(box?.height).toBeLessThanOrEqual(844);
 const heading=await layer.getByRole('heading').boundingBox();expect(heading!.y).toBeGreaterThanOrEqual(47);
 await page.getByRole('button',{name:'إغلاق الإجراء'}).tap();
 await page.evaluate(()=>{Object.defineProperty(HTMLElement.prototype,'showPopover',{configurable:true,value:undefined});});
 await page.getByRole('button',{name:'sheet',exact:true}).tap();await page.touchscreen.tap(10,820);await expect(page.getByTestId('background-count')).toHaveText('0');
});
