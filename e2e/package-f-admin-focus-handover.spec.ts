import {test,expect} from './isolated-test';
import {waitForPackageFMotion} from './package-f-accessibility';
import {checkLayout} from './package-f-layout';

for(const theme of ['light','dark'])for(const kind of ['edit','address']){
  const title=kind==='edit'?'تعديل ملف العميل':'إضافة عنوان توصيل';
  const url=`/e2e/package-f-customers-harness.html?theme=${theme}`;
  test(`customer ${kind} ${theme}: top Tab, clean Escape and opener restore`,async({page})=>{
    await page.setViewportSize({width:390,height:844});await page.goto(url);
    await page.getByRole('button',{name:'فتح ملف بقالة أبو خالد',exact:true}).filter({visible:true}).click();
    const parent=page.getByRole('dialog',{name:'ملف العميل',exact:true});
    if(kind==='address')await parent.getByRole('tab',{name:'العناوين',exact:true}).click();
    const opener=parent.getByRole('button',{name:kind==='edit'?'تعديل':'عنوان',exact:true});await opener.click();
    const child=page.getByRole('dialog',{name:title,exact:true});await expect(child).toBeFocused();
    await expect(child).toHaveAttribute('tabindex','-1');await expect(child).toHaveAttribute('aria-modal','true');
    const buttons=child.locator('button:not(:disabled)');await buttons.last().focus();await page.keyboard.press('Tab');await expect(buttons.first()).toBeFocused();
    await page.keyboard.press('Shift+Tab');await expect(buttons.last()).toBeFocused();
    await parent.getByRole('button',{name:'رجوع للعملاء',exact:true}).focus();
    expect(await child.evaluate(d=>d.contains(document.activeElement))).toBe(true);
    await waitForPackageFMotion(page);await checkLayout(page,child);
    await page.keyboard.press('Escape');await expect(child).toHaveCount(0);await expect(parent).toBeVisible();await expect(opener).toBeFocused();
  });

  test(`customer ${kind} ${theme}: dirty Escape asks, preserves data, then discards only child`,async({page})=>{
    const writes:string[]=[];
    await page.route('**/rest/v1/rpc/**',route=>{const name=route.request().url().split('/').at(-1)!;
      if(!name.startsWith('get_')&&!name.startsWith('search_'))writes.push(name);
      return route.fulfill({json:{items:[],unreadCount:0}});
    });
    await page.setViewportSize({width:390,height:844});await page.goto(url);
    await page.getByRole('button',{name:'فتح ملف بقالة أبو خالد',exact:true}).filter({visible:true}).click();
    const parent=page.getByRole('dialog',{name:'ملف العميل',exact:true});
    if(kind==='address')await parent.getByRole('tab',{name:'العناوين',exact:true}).click();
    await parent.getByRole('button',{name:kind==='edit'?'تعديل':'عنوان',exact:true}).click();
    const child=page.getByRole('dialog',{name:title,exact:true}),input=child.locator('input:not([type=checkbox])').first();
    await input.focus();await input.fill('نص غير محفوظ');await page.keyboard.press('Escape');
    const question=page.getByRole('dialog',{name:'تجاهل التعديلات؟',exact:true});await expect(question).toBeVisible();await expect(question).toBeFocused();
    await expect(parent).toBeVisible();await expect(child).toBeVisible();await expect(input).toHaveValue('نص غير محفوظ');
    await waitForPackageFMotion(page);await checkLayout(page,question);
    const cancel=question.getByRole('button',{name:'متابعة التعديل',exact:true}),discard=question.getByRole('button',{name:'تجاهل التعديلات',exact:true});
    await discard.focus();await page.keyboard.press('Tab');await expect(cancel).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(discard).toBeFocused();
    await page.keyboard.press('Escape');await expect(question).toHaveCount(0);await expect(child).toBeVisible();await expect(input).toHaveValue('نص غير محفوظ');
    await input.focus();await page.keyboard.press('Escape');await cancel.click();await expect(question).toHaveCount(0);await expect(input).toHaveValue('نص غير محفوظ');
    await input.focus();await page.keyboard.press('Escape');await discard.click();await expect(child).toHaveCount(0);await expect(parent).toBeVisible();
    expect(await parent.evaluate(d=>d.contains(document.activeElement))).toBe(true);
    expect(writes).toEqual([]);
  });
}

for(const theme of ['light','dark'])test(`real AllModals product handover ${theme}: immediate Enter does not close or submit`,async({page})=>{
  const writes:string[]=[];await page.route('**/rest/v1/rpc/**',route=>{const name=route.request().url().split('/').at(-1)!;
    if(!name.startsWith('get_')&&!name.startsWith('search_'))writes.push(name);return route.fulfill({json:[]});});
  await page.setViewportSize({width:390,height:844});await page.goto(`/e2e/package-f-products-harness.html?theme=${theme}&realDialogs`);
  await page.getByRole('button',{name:'تفاصيل الصنف الفعلية',exact:true}).click();
  const details=page.getByRole('dialog',{name:'تفاصيل الصنف والمخزون',exact:true});await expect(details).toBeVisible();
  await details.getByRole('button',{name:'تعديل البيانات',exact:true}).click();
  const edit=page.getByRole('dialog',{name:'تعديل بطاقة المنتج',exact:true});await expect(edit).toBeFocused();
  await page.keyboard.press('Enter');await expect(edit).toBeVisible();await expect(edit).toBeFocused();
  const input=edit.getByLabel('اسم المنتج',{exact:true});await input.focus();await input.fill('اسم كامل محفوظ');
  await waitForPackageFMotion(page);await expect(input).toHaveValue('اسم كامل محفوظ');await expect(input).toBeFocused();
  await checkLayout(page,edit);
  expect(writes).toEqual([]);
});
