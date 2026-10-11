import AxeBuilder from '@axe-core/playwright';
import {analyzePackageFAccessibility} from './package-f-accessibility';
import {test,expect,type Page} from './isolated-test';
import {checkLayout} from './package-f-layout';
const url=(view:string,theme='light',extra='')=>`/e2e/package-f-auth-assistant-harness.html?view=${view}&theme=${theme}&${extra}`;
async function audit(page:Page){
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>a.effect instanceof KeyframeEffect&&a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>undefined)));});
 await checkLayout(page,page.getByTestId('auth-assistant-workbench'));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.getByTestId('auth-assistant-workbench')).not.toContainText(/[٠-٩]/u);
 const result=await analyzePackageFAccessibility(page,new AxeBuilder({page}));expect(result.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
}
for(const theme of ['light','dark'])for(const width of [390,820,1440])test(`auth/assistant ${theme} ${width}:login,MFA,password and biometric lock,assistant layout and axe`,async({page})=>{
 await page.setViewportSize({width,height:900});
 for(const view of ['login','mfa','lock','biometric','assistant']){
  await page.goto(url(view,theme));
  const button=page.getByRole('button',{name:view==='login'?'تسجيل الدخول':view==='mfa'?'تأكيد الرمز والدخول':view==='lock'?'فتح التطبيق':view==='biometric'?'فتح بواسطة بصمة الجهاز':'إرسال السؤال',exact:true});
  await expect(button).toBeInViewport();await audit(page);
  expect(await page.locator('input:not([type="checkbox"]),textarea').evaluateAll(es=>es.every(e=>e.getBoundingClientRect().height>=44))).toBe(true);
  if(view==='lock'||view==='biometric')await expect(page.getByTestId('protected-content')).toHaveCount(0);
 }
});
test('login preserves CAPTCHA gate,exact credentials,MFA sanitization and error handling',async({page})=>{
 await page.goto(url('login','light','captcha=pending'));
 await expect(page.getByRole('button',{name:'تسجيل الدخول',exact:true})).toBeDisabled();
 await page.getByLabel('البريد الإلكتروني',{exact:true}).fill('owner@example.test');await page.getByLabel('كلمة المرور',{exact:true}).fill('example-password');
 await page.getByRole('button',{name:'إظهار كلمة المرور',exact:true}).click();await expect(page.getByLabel('كلمة المرور',{exact:true})).toHaveAttribute('type','text');
 await page.evaluate(()=>window.__PACKAGE_F_VERIFY_CAPTCHA__());await page.getByRole('button',{name:'تسجيل الدخول',exact:true}).click();
 await expect(page.getByText('تعذر التحقق في المعاينة المعزولة.')).toBeVisible();expect(await page.evaluate(()=>window.__PACKAGE_F_AUTH_CALLS__)).toEqual([{method:'signIn',args:['owner@example.test','example-password','isolated-human-token']}]);
 await page.goto(url('mfa'));const code=page.getByLabel('رمز التحقق المكوّن من 6 أرقام');await code.fill('12a34567');await expect(code).toHaveValue('123456');await page.getByRole('button',{name:'تأكيد الرمز والدخول',exact:true}).click();
 expect(await page.evaluate(()=>window.__PACKAGE_F_AUTH_CALLS__)).toEqual([{method:'verifyMfa',args:['123456']}]);
 await page.getByRole('button',{name:'الرجوع إلى البريد وكلمة المرور',exact:true}).click();expect(await page.evaluate(()=>window.__PACKAGE_F_AUTH_CALLS__)).toEqual([{method:'verifyMfa',args:['123456']},{method:'cancelMfa',args:[]}]);
});
test('password lock keeps known email,CAPTCHA,second factor and protected DOM guards',async({page})=>{
 await page.goto(url('lock-mfa','dark','captcha=pending'));await expect(page.getByLabel('البريد الإلكتروني',{exact:true})).toHaveAttribute('readonly','');await expect(page.getByRole('button',{name:'فتح التطبيق',exact:true})).toBeDisabled();
 await page.getByLabel('كلمة المرور',{exact:true}).fill('example-password');await page.evaluate(()=>window.__PACKAGE_F_VERIFY_CAPTCHA__());await page.getByRole('button',{name:'فتح التطبيق',exact:true}).click();
 const code=page.getByLabel('رمز تطبيق المصادقة',{exact:true});await expect(code).toBeVisible();await expect(page.getByTestId('protected-content')).toHaveCount(0);await code.fill('123456');await page.getByRole('button',{name:'تأكيد الرمز وفتح التطبيق',exact:true}).click();
 expect(await page.evaluate(()=>window.__PACKAGE_F_AUTH_CALLS__)).toEqual([{method:'reauthenticateForUnlock',args:['example-password','isolated-human-token']},{method:'verifyUnlockMfa',args:['123456']}]);await expect(page.getByTestId('protected-content')).toHaveCount(0);await audit(page);
});
test('assistant exact Edge payload,context,SKU,structured facts,suggestions and clear remain unchanged',async({page})=>{
 const calls:unknown[]=[];await page.route('**/functions/v1/admin-ai-assistant',route=>{calls.push(route.request().postDataJSON());return route.fulfill({json:{answer:'المخزون الحالي من القراءة.',context:'inventory',productSku:'SKU-TEST',card:{title:'متابعة المخزون',tone:'warning',facts:[{label:'المتوفر',value:'1,234 باكيت',tone:'warning'},{label:'الحالة',value:'متابعة',tone:'default'}],suggestions:['ما سعره؟']}}});});
 await page.goto(url('assistant'));await page.getByLabel('سؤالك للمساعد').fill('  ما المخزون؟  ');await page.getByRole('button',{name:'إرسال السؤال',exact:true}).click();await expect(page.getByText('متابعة المخزون',{exact:true})).toBeVisible();expect(calls).toEqual([{message:'ما المخزون؟'}]);await audit(page);
 await page.getByRole('button',{name:'ما سعره؟',exact:true}).click();await expect.poll(()=>calls.length).toBe(2);expect(calls[1]).toEqual({message:'ما سعره؟',context:'inventory',productSku:'SKU-TEST'});
 await page.getByRole('button',{name:'بدء من جديد',exact:true}).click();await expect(page.getByText('ابدأ بسؤال جاهز أو اكتب سؤالك')).toBeVisible();await audit(page);
});
test('failed biometric verification cannot call session unlock or expose protected content',async({page})=>{
 await page.goto(url('biometric','dark'));await page.getByRole('button',{name:'فتح بواسطة بصمة الجهاز',exact:true}).click();
 expect(await page.evaluate(()=>window.__PACKAGE_F_AUTH_CALLS__)).toEqual([{method:'unlockFaceId',args:[]}]);
 await expect(page.getByTestId('protected-content')).toHaveCount(0);
 await page.getByRole('button',{name:'الدخول بالبريد وكلمة المرور',exact:true}).click();
 await expect(page.getByLabel('البريد الإلكتروني',{exact:true})).toHaveValue('owner@example.test');await audit(page);
});
for(const theme of ['light','dark'])test(`switch tracks ${theme}:distinct solid ON/OFF,3:1 surrounding contrast and unchanged checked state`,async({page})=>{
 await page.goto(`/e2e/package-f-administration-harness.html?view=settings&theme=${theme}`);await expect(page.getByRole('dialog')).toHaveAttribute('data-state','open');
 const switches=page.getByRole('switch');expect(await switches.count()).toBe(5);
 for(let i=0;i<5;i++){
  const control=switches.nth(i),initial=await control.getAttribute('aria-checked');let first='';
  for(let pass=0;pass<2;pass++){
   const track=control.locator('[data-ui="switch-track"]');
   const result=await track.evaluate(element=>{
    const rgb=(s:string)=>s.match(/[\d.]+/g)!.slice(0,3).map(Number);
    const lum=(c:number[])=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
    const fg=getComputedStyle(element).backgroundColor;let ancestor=element.parentElement!,bg=getComputedStyle(ancestor).backgroundColor;
    while(bg==='rgba(0, 0, 0, 0)'&&ancestor.parentElement){ancestor=ancestor.parentElement;bg=getComputedStyle(ancestor).backgroundColor;}
    const a=lum(rgb(fg)),b=lum(rgb(bg));return {fg,bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
   });expect(result.ratio,JSON.stringify(result)).toBeGreaterThanOrEqual(3);
   if(pass===0)first=result.fg;else expect(result.fg).not.toBe(first);
   await control.click();
  }
  await expect(control).toHaveAttribute('aria-checked',initial!);
 }
 await expect(page.getByText('يستقبل الطلبات',{exact:true})).toBeVisible();await switches.first().click();await expect(page.getByText('متوقف',{exact:true}).first()).toBeVisible();
});
