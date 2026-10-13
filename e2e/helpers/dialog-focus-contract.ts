import {test, expect, type Page} from '../isolated-test';

async function mountContract(page: Page, origin: string) {
  const url=`${origin}/e2e/dialog-focus-contract.html`;
  await page.route(url,route=>route.fulfill({contentType:'text/html',body:
    '<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="contract"></main></body></html>'}));
  await page.goto(url);
  await page.evaluate(async()=>{
    const path='/src/utils/dialogFocus.ts';
    const {activateDialog}=await import(/* @vite-ignore */ path);
    const root=document.getElementById('contract')!;
    root.innerHTML=`<button id="opener">فتح الرئيسية</button>
      <section id="outer" role="dialog" aria-labelledby="outer-title" tabindex="-1" hidden inert>
        <h2 id="outer-title">النافذة الرئيسية</h2><button id="outer-first">أول رئيسي</button>
        <button id="open-inner">فتح الداخلية</button><input aria-label="حقل رئيسي" id="outer-input">
        <button id="outer-last">آخر رئيسي</button>
        <section id="inner" role="dialog" aria-labelledby="inner-title" tabindex="-1" hidden inert>
          <h2 id="inner-title">النافذة الداخلية</h2><button id="inner-first">أول داخلي</button>
          <input aria-label="حقل داخلي" id="inner-input"><button id="inner-last">آخر داخلي</button>
        </section>
      </section>`;
    const outer=document.getElementById('outer')!;
    const inner=document.getElementById('inner')!;
    let cleanupOuter:()=>void=()=>undefined;
    let cleanupInner:()=>void=()=>undefined;
    const events:string[]=[];
    (window as typeof window & {dialogContractEvents:string[]}).dialogContractEvents=events;
    const closeInner=()=>{inner.hidden=true;inner.inert=true;cleanupInner();};
    const closeOuter=()=>{outer.hidden=true;outer.inert=true;cleanupOuter();};
    document.getElementById('opener')!.addEventListener('click',()=>{
      outer.hidden=false;outer.inert=false;
      cleanupOuter=activateDialog(outer,()=>{events.push('outer');closeOuter();});
    });
    document.getElementById('open-inner')!.addEventListener('click',()=>{
      inner.hidden=false;inner.inert=false;
      cleanupInner=activateDialog(inner,()=>{events.push('inner');closeInner();});
    });
  });
}

// ONE behavioral contract; no implementation-specific branch or weaker path.
export function registerDialogFocusContract(name:string,origin:string) {
  test.describe(`${name} shared dialog safety`,()=>{
    test.beforeEach(async({page})=>{await mountContract(page,origin);});

    test('Tab wraps both directions inside the top ordinary dialog',async({page})=>{
      await page.locator('#opener').click();
      await page.locator('#outer-first').focus();await page.keyboard.press('Shift+Tab');
      await expect(page.locator('#outer-last')).toBeFocused();
      await page.keyboard.press('Tab');await expect(page.locator('#outer-first')).toBeFocused();
      for(let i=0;i<8;i++) {
        await page.keyboard.press('Tab');
        expect(await page.locator('#outer').evaluate(panel=>panel.contains(document.activeElement))).toBe(true);
      }
    });

    test('nested dialog owns Tab without reaching the lower dialog',async({page})=>{
      await page.locator('#opener').click();await page.locator('#open-inner').click();
      await page.locator('#inner-first').focus();await page.keyboard.press('Shift+Tab');
      await expect(page.locator('#inner-last')).toBeFocused();
      await page.keyboard.press('Tab');await expect(page.locator('#inner-first')).toBeFocused();
      for(let i=0;i<8;i++) {
        await page.keyboard.press('Tab');
        expect(await page.locator('#inner').evaluate(panel=>panel.contains(document.activeElement))).toBe(true);
      }
    });

    test('Escape closes only the top dialog and nested close restores its opener',async({page})=>{
      await page.locator('#opener').click();await page.locator('#open-inner').click();
      await page.keyboard.press('Escape');
      await expect(page.locator('#inner')).toBeHidden();await expect(page.locator('#outer')).toBeVisible();
      await expect(page.locator('#open-inner')).toBeFocused();
      expect(await page.evaluate(()=>(window as typeof window & {dialogContractEvents:string[]}).dialogContractEvents)).toEqual(['inner']);
      await page.keyboard.press('Escape');await expect(page.locator('#outer')).toBeHidden();
      await expect(page.locator('#opener')).toBeFocused();
      expect(await page.evaluate(()=>(window as typeof window & {dialogContractEvents:string[]}).dialogContractEvents)).toEqual(['inner','outer']);
    });

    test('ordinary close restores the external opener and removes its focus guard',async({page})=>{
      await page.locator('#opener').click();await page.locator('#outer-input').focus();
      await page.keyboard.press('Escape');await expect(page.locator('#opener')).toBeFocused();
      await expect(page.locator('#outer')).toBeHidden();
      await page.keyboard.press('Tab');await expect(page.locator('#outer-input')).not.toBeFocused();
      expect(await page.locator('#outer').evaluate(panel=>panel.contains(document.activeElement))).toBe(false);
    });

    test('programmatic focus cannot reach a lower dialog or outside the top dialog',async({page})=>{
      await page.locator('#opener').click();await page.locator('#open-inner').click();
      await page.locator('#outer-input').focus();
      expect(await page.locator('#inner').evaluate(panel=>panel.contains(document.activeElement))).toBe(true);
      await expect(page.locator('#outer-input')).not.toBeFocused();
      await page.locator('#opener').focus();
      expect(await page.locator('#inner').evaluate(panel=>panel.contains(document.activeElement))).toBe(true);
      await expect(page.locator('#opener')).not.toBeFocused();
    });

    test('initial focus is a named neutral panel; immediate Enter cannot activate a control',async({page})=>{
      await page.locator('#opener').click();await expect(page.locator('#outer')).toBeFocused();
      await expect(page.locator('#outer')).toHaveAccessibleName('النافذة الرئيسية');
      await page.keyboard.press('Enter');await expect(page.locator('#outer')).toBeVisible();
      await expect(page.locator('#outer-first')).not.toBeFocused();
      await page.keyboard.press('Tab');await expect(page.locator('#outer-first')).toBeFocused();
    });

    test('handover preserves an active input and ignores an inert predecessor',async({page})=>{
      await page.locator('#opener').click();
      await page.evaluate(async()=>{
        const path='/src/utils/dialogFocus.ts';const {activateDialog}=await import(/* @vite-ignore */path);
        const next=document.createElement('section');next.setAttribute('role','dialog');next.setAttribute('aria-label','النافذة الجديدة');next.tabIndex=-1;
        next.innerHTML='<button id="next-close">إغلاق جديدة</button><input id="next-input" aria-label="اسم جديد">';document.body.append(next);
        document.getElementById('outer')!.inert=true;
        const input=document.getElementById('next-input') as HTMLInputElement;input.focus();
        activateDialog(document.getElementById('outer')!,()=>{throw Error('INERT_GUARD');});
        activateDialog(next,()=>{next.remove();});
      });
      await expect(page.locator('#next-input')).toBeFocused();await page.keyboard.type('اسم محفوظ');
      await expect(page.locator('#next-input')).toHaveValue('اسم محفوظ');
      await expect(page.locator('#next-input')).toBeFocused();
    });
  });
}
