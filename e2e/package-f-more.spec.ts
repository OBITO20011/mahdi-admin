import AxeBuilder from '@axe-core/playwright';
import {test,expect,type Page} from './isolated-test';

const url=(theme:string,view='more',extra='')=>`/e2e/package-f-more-harness.html?theme=${theme}&view=${view}${extra}`;
test('standalone More pairs footer tokens with its own canvas even before theme initialization',async({page})=>{
  await page.goto('/e2e/admin-navigation-harness.html');
  const footer=page.locator('.pb-1');await expect(footer).toContainText('النواصرة');
  expect(await footer.evaluate(element=>{
    const root=element.parentElement!,probe=document.createElement('span');probe.style.backgroundColor='var(--nw-bg)';document.body.append(probe);
    const expected=getComputedStyle(probe).backgroundColor;probe.remove();return getComputedStyle(root).backgroundColor===expected;
  })).toBe(true);
  const results=await new AxeBuilder({page}).analyze();
  expect(results.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
  const measured=await footer.evaluate(element=>{
    const fg=getComputedStyle(element).color,bg=getComputedStyle(element.parentElement!).backgroundColor;
    const luminance=(value:string)=>{const channels=value.match(/[\d.]+/gu)!.slice(0,3).map(Number).map(channel=>{const c=channel/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;});return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;};
    const a=luminance(fg),b=luminance(bg);return {fg,bg,ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)};
  });expect(measured.ratio).toBeGreaterThanOrEqual(4.5);console.info(JSON.stringify({event:'MoreFooterContrast',...measured}));
});
async function stableDialog(page:Page,name:string){
  const dialog=page.getByRole('dialog',{name,exact:true});
  await expect(dialog).toHaveAttribute('data-state','open');
  await dialog.evaluate(async element=>{await Promise.all(element.getAnimations({subtree:true}).filter(a=>a.effect instanceof KeyframeEffect&&a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>undefined)));});
  return dialog;
}
async function audit(page:Page){
  await page.evaluate(()=>document.fonts.ready);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.getByTestId('more-workbench')).not.toContainText(/[٠-٩]/u);
  const results=await new AxeBuilder({page}).analyze();
  expect(results.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
  const overflow=await page.getByTestId('more-workbench').evaluate(root=>{
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),failed:string[]=[];
    while(walker.nextNode()){
      const node=walker.currentNode,parent=node.parentElement;
      if(!node.textContent?.trim()||!parent||parent.closest('.sr-only,option')||!parent.getClientRects().length||getComputedStyle(parent).visibility==='hidden')continue;
      // Owner-approved email ellipsis is a display contract,not escaping text.
      // This one named field must expose its full value and remain inside its card.
      if(parent.matches('p[data-field="profile-email"]')){
        const style=getComputedStyle(parent),bounds=parent.getBoundingClientRect(),card=parent.parentElement!.getBoundingClientRect();
        if(parent.dir!=='ltr'||parent.title!==node.textContent.trim()||style.overflow!=='hidden'||style.textOverflow!=='ellipsis'||style.whiteSpace!=='nowrap'
          ||bounds.left<card.left-1||bounds.right>card.right+1)failed.push('invalid Profile email ellipsis contract');
        continue;
      }
      const box=parent.closest('p,h1,h2,h3,h4,h5,button,label,li')??parent;
      const bounds=box.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(node);
      for(const r of range.getClientRects())if(r.width&&(r.left<bounds.left-1||r.right>bounds.right+1||r.top<bounds.top-1||r.bottom>bounds.bottom+1))failed.push(node.textContent.trim());
    }
    return failed;
  });expect(overflow).toEqual([]);
}
for(const theme of ['light','dark'])for(const width of [390,820,1440]){
  test(`More ${theme} ${width}: all groups,roles,token contrast and containment`,async({page})=>{
    await page.setViewportSize({width,height:900});await page.goto(url(theme));
    await expect(page.getByRole('heading',{name:'إدارة التطبيق',exact:true})).toBeVisible();
    for(const [id,token] of [['assistant-shortcut','--nw-surface-2'],['sign-out','--nw-bad-bg']]){
      expect(await page.locator(`[data-navigation-id="${id}"]`).evaluate((element,variable)=>{
        const probe=document.createElement('span');probe.style.backgroundColor=`var(${variable})`;document.body.append(probe);
        const expected=getComputedStyle(probe).backgroundColor;probe.remove();
        return getComputedStyle(element).backgroundColor===expected;
      },token)).toBe(true);
    }
    await audit(page);
    for(const id of ['products-inventory','customers','suppliers-purchases','finance-reports','administration-store']){
      await page.locator(`#admin-navigation-trigger-${id}`).click();
      await expect(page.locator(`#admin-navigation-trigger-${id}`)).toHaveAttribute('aria-expanded','true');
      await page.locator(`#admin-navigation-panel-${id}`).evaluate(async element=>{await Promise.all(element.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>undefined)));});
      await audit(page);
    }
    await expect(page.locator('[data-navigation-id="profile-summary"]')).toBeVisible();
    await page.locator('[data-navigation-id="profile-summary"]').click();
    await stableDialog(page,'الملف الشخصي وإعدادات الحساب');await audit(page);
  });
  test(`Profile ${theme} ${width}: native fields44px,labels,dirty guard and contrast`,async({page})=>{
    await page.setViewportSize({width,height:900});await page.goto(url(theme,'profile'));
    const dialog=await stableDialog(page,'الملف الشخصي وإعدادات الحساب');await audit(page);
    await dialog.getByRole('button',{name:'تعديل البيانات',exact:true}).click();
    await expect(dialog.getByLabel('الاسم الكامل *',{exact:true})).toHaveValue('مهدي النواصرة');
    const controls=await dialog.locator('input:not([type="checkbox"]),select,textarea').evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,label:(n as HTMLInputElement).labels?.length||n.getAttribute('aria-label')})));
    expect(controls).toHaveLength(10);for(const row of controls){expect(row.height).toBeGreaterThanOrEqual(44);expect(row.label).toBeTruthy();}
    await audit(page);
    if(width===390)await expect(dialog.getByRole('button',{name:'حفظ التعديلات',exact:true})).toBeInViewport();
    await dialog.getByLabel('الاسم الكامل *',{exact:true}).fill('اسم معدل');await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();await expect(dialog.getByLabel('الاسم الكامل *',{exact:true})).toHaveValue('اسم معدل');
    await dialog.getByRole('button',{name:'إلغاء',exact:true}).click();
    const warning=page.getByRole('dialog',{name:'تغييرات غير محفوظة',exact:true});await expect(warning).toBeVisible();
    await warning.evaluate(async element=>{await Promise.all(element.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>undefined)));});await audit(page);
    await warning.getByRole('button',{name:'متابعة التعديل',exact:true}).click();
    await dialog.getByRole('button',{name:'الإشعارات',exact:true}).click();await audit(page);
    await dialog.getByRole('button',{name:'الأمان والجلسات',exact:true}).click();
    await expect(dialog.getByRole('button',{name:'تفعيل تطبيق المصادقة',exact:true})).toBeVisible();await audit(page);
  });
  test(`Install and Push ${theme} ${width}: existing install help and capability states`,async({page})=>{
    await page.setViewportSize({width,height:900});await page.goto(url(theme,'install'));
    await page.getByRole('button',{name:/تثبيت التطبيق على iPhone/}).click();
    const dialog=await stableDialog(page,'تثبيت تطبيق إدارة النواصرة');await audit(page);
    await dialog.getByRole('button',{name:'فهمت، سأثبت التطبيق'}).click();await expect(dialog).toHaveCount(0);
    for(const push of ['default','enabled','denied','unsupported']){
      await page.goto(url(theme,'push',`&push=${push}`));
      await expect(page.getByText('جاري فحص إشعارات هذا الجهاز...')).toHaveCount(0);
      if(push==='enabled')await expect(page.getByRole('button',{name:'إيقاف الإشعارات على هذا الجهاز'})).toBeInViewport();
      else if(push==='default')await expect(page.getByRole('button',{name:'تفعيل إشعارات الطلبات'})).toBeInViewport();
      else if(push==='denied')await expect(page.getByRole('button',{name:'تفعيل إشعارات الطلبات'})).toBeDisabled();
      else await expect(page.getByText('ثبّت التطبيق أولاً على iPhone',{exact:true})).toBeVisible();
      await audit(page);
    }
  });
}
for(const theme of ['light','dark'])test(`Shared Modal ${theme}:busy/dirty Escape,state and focus retained`,async({page})=>{
  await page.goto(url(theme,'profile'));
  await stableDialog(page,'الملف الشخصي وإعدادات الحساب');await page.getByRole('button',{name:'إغلاق',exact:true}).click();
  await page.getByRole('button',{name:'فتح نموذج الاختبار'}).click();
  const dialog=await stableDialog(page,'نموذج الحقول المشتركة');await audit(page);
  await dialog.getByRole('button',{name:'تغيير الانشغال'}).click();await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button',{name:'إغلاق',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:'تغيير الانشغال'}).click();
  await dialog.getByLabel('حقل الاختبار',{exact:true}).fill('تعديل');await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'إلغاء النموذج'}).click();
  await expect(page.getByRole('button',{name:'فتح نموذج الاختبار'})).toBeFocused();
});
