import {test, expect} from './isolated-test';

test('Admin keeps a temporarily hidden opener and only restores it when available',async({page})=>{
  await page.goto('/e2e/package-f-pos-harness.html?theme=light');
  await page.evaluate(async()=>{
    const path='/src/utils/dialogFocus.ts';
    const {activateDialog}=await import(/* @vite-ignore */path);
    const root=document.createElement('div');
    root.innerHTML='<button id="hidden-opener">فتح</button><section id="hidden-opener-panel" role="dialog" aria-label="اختبار الاستعادة" tabindex="-1" hidden><button id="restore-opener">رجوع</button></section>';
    document.body.append(root);
    const opener=root.querySelector<HTMLButtonElement>('#hidden-opener')!;
    const panel=root.querySelector<HTMLElement>('#hidden-opener-panel')!;
    let close:()=>void=()=>undefined;
    opener.addEventListener('click',()=>{
      opener.hidden=true;panel.hidden=false;
      close=activateDialog(panel,()=>undefined);
    });
    root.querySelector('#restore-opener')!.addEventListener('click',()=>{
      opener.hidden=false;panel.hidden=true;close();
    });
  });
  await page.locator('#hidden-opener').click();
  expect(await page.locator('#hidden-opener').evaluate(el=>({connected:el.isConnected,rects:el.getClientRects().length}))).toEqual({connected:true,rects:0});
  await expect(page.locator('#hidden-opener-panel')).toBeFocused();
  await page.locator('#restore-opener').click();
  await expect(page.locator('#hidden-opener')).toBeFocused();
});

for(const interaction of ['none','input','new-dialog'] as const) {
  test(`Admin commit-delayed opener restoration respects ${interaction}`,async({page})=>{
    await page.goto('/e2e/package-f-pos-harness.html?theme=light');
    await page.evaluate(async(next)=>{
      const path='/src/utils/dialogFocus.ts';const {activateDialog}=await import(/* @vite-ignore */path);
      const root=document.createElement('div');
      root.innerHTML='<button id="commit-opener">فتح</button><input id="new-interaction" aria-label="بحث جديد"><section id="commit-panel" role="dialog" aria-label="لوحة" tabindex="-1" hidden><button id="commit-close">رجوع</button></section>';
      document.body.append(root);
      const opener=root.querySelector<HTMLButtonElement>('#commit-opener')!;
      const panel=root.querySelector<HTMLElement>('#commit-panel')!;
      let close:()=>void=()=>undefined;
      opener.addEventListener('click',()=>{
        opener.hidden=true;panel.hidden=false;close=activateDialog(panel,()=>undefined);
      });
      root.querySelector('#commit-close')!.addEventListener('click',()=>{
        panel.hidden=true;close();
        queueMicrotask(()=>{
          opener.hidden=false;
          if(next==='input') root.querySelector<HTMLInputElement>('#new-interaction')!.focus();
          if(next==='new-dialog') {
            const dialog=document.createElement('section');dialog.setAttribute('role','dialog');
            dialog.setAttribute('aria-label','نافذة جديدة');dialog.tabIndex=-1;dialog.id='commit-next';
            dialog.textContent='نافذة جديدة';root.append(dialog);activateDialog(dialog,()=>undefined);
          }
        });
      });
    },interaction);
    await page.locator('#commit-opener').click();await page.locator('#commit-close').click();
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));
    await expect(page.locator(interaction==='none'?'#commit-opener':interaction==='input'?'#new-interaction':'#commit-next')).toBeFocused();
    if(interaction==='input') {
      await page.keyboard.type('بحث كامل');await expect(page.locator('#new-interaction')).toHaveValue('بحث كامل');
    }
  });
}

for(const unavailable of ['hidden','disabled','inert'] as const) {
  test(`Admin does not restore an opener that remains ${unavailable}`,async({page})=>{
    await page.goto('/e2e/package-f-pos-harness.html?theme=light');
    await page.evaluate(async(state)=>{
      const path='/src/utils/dialogFocus.ts';const {activateDialog}=await import(/* @vite-ignore */path);
      const root=document.createElement('div');
      root.innerHTML='<button id="unavailable-opener">فتح</button><section id="unavailable-panel" role="dialog" aria-label="اللوحة" tabindex="-1" hidden><button id="close-unavailable">رجوع</button></section>';
      document.body.append(root);
      const opener=root.querySelector<HTMLButtonElement>('#unavailable-opener')!;
      const panel=root.querySelector<HTMLElement>('#unavailable-panel')!;
      let close:()=>void=()=>undefined;
      opener.addEventListener('click',()=>{
        opener.hidden=true;panel.hidden=false;close=activateDialog(panel,()=>undefined);
      });
      root.querySelector('#close-unavailable')!.addEventListener('click',()=>{
        opener.hidden=state==='hidden';opener.disabled=state==='disabled';opener.inert=state==='inert';
        panel.hidden=true;close();
      });
    },unavailable);
    await page.locator('#unavailable-opener').click();
    await page.locator('#close-unavailable').click();
    await expect(page.locator('#unavailable-opener')).not.toBeFocused();
    await expect(page.locator('#unavailable-panel')).toBeHidden();
  });
}
