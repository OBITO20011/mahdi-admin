import AxeBuilder from '@axe-core/playwright';
import {test,expect,type Page} from './isolated-test';
import {checkLayout} from './package-f-layout';
import {cashIds} from './package-f-cash.fixture';
import {expenseRows} from './package-f-financial.fixture';
async function audit(page:Page){
 await page.evaluate(()=>document.fonts.ready);
 const dialogs=page.getByRole('dialog');
 if(await dialogs.count())await expect(dialogs.last()).toHaveAttribute('data-state','open');
 await checkLayout(page,page.getByTestId('financial-workbench'));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.getByTestId('financial-workbench')).not.toContainText(/[٠-٩]/u);
 const a=await new AxeBuilder({page}).analyze();
 expect(a.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
}
for(const theme of ['light','dark'])for(const width of [390,820,1440])test(`expenses and report ${theme} ${width}:real readers,Latin money,details,axe and layout`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.goto(`/e2e/package-f-financial-harness.html?theme=${theme}`);
 await expect(page.getByText('EXP-10481',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'مصروف جديد',exact:true})).toBeInViewport();
 await expect(page.getByTestId('expenses-screen')).toContainText('1,234.567');await audit(page);
 await page.getByRole('button',{name:'مصروف جديد',exact:true}).click();
 const d=page.getByRole('dialog',{name:'مصروف جديد',exact:true});await expect(d).toBeVisible();
 await expect(d.getByRole('button',{name:'اعتماد وتسجيل المصروف'})).toBeInViewport();
 await audit(page);
 const heights=await d.locator('input,select').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));expect(heights.every(h=>h>=44)).toBe(true);
 await d.getByRole('button',{name:'إغلاق',exact:true}).click();await expect(d).toHaveCount(0);
 await page.getByRole('button',{name:'التقارير',exact:true}).click();
 await expect(page.getByRole('heading',{name:'التقرير المالي والتشغيلي',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'طباعة / PDF',exact:true})).toBeInViewport();
 await expect(page.locator('.operational-report-print > section > article')).toHaveCount(9);
 await expect(page.getByText('تكلفة الاستبدال',{exact:true})).not.toBeVisible();await audit(page);
 await page.getByTestId('report-details').locator('summary').click();
 await expect(page.getByText('تكلفة الاستبدال',{exact:true})).toBeVisible();await audit(page);
 await page.getByTestId('report-details').locator('footer').scrollIntoViewIfNeeded();
 await expect(page.getByTestId('report-details').locator('footer')).toBeInViewport();
});
for(const theme of ['light','dark'])test(`report ${theme} keeps integrity warning and real print details`,async({page})=>{
 await page.goto(`/e2e/package-f-financial-harness.html?theme=${theme}&view=reports&integrity=critical`);
 await expect(page.getByTestId('aftercare-integrity-warning')).toContainText('لم ينجح');
 await audit(page);
 await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
 await expect(page.getByTestId('report-details')).toHaveAttribute('open','');
 await page.emulateMedia({media:'print'});
 const h=page.getByRole('heading',{name:'التقرير المالي والتشغيلي',exact:true});
 expect(await h.evaluate(e=>getComputedStyle(e).color)).toBe('rgb(15, 27, 45)');
 await expect(page.getByText('تكلفة الاستبدال',{exact:true})).toBeVisible();
});
test('expense Cash/CliQ payloads unchanged;missing CliQ reference blocks;busy guards close',async({page})=>{
 const captured:unknown[]=[];let release!:()=>void;
 await page.route('**/rest/v1/rpc/create_operational_expense',async route=>{
  captured.push(route.request().postDataJSON());await new Promise<void>(r=>{release=r;});
  await route.fulfill({status:400,json:{message:'ISOLATED_PROBE_REJECTION',code:'P0001'}});
 });
 await page.goto('/e2e/package-f-financial-harness.html?view=expense-form');
 const d=page.getByRole('dialog');await expect(d).toHaveAttribute('data-state','open');
 await d.getByLabel('المبلغ (د.أ) *',{exact:true}).fill('12.345');
 await d.getByLabel('البيان / الوصف *',{exact:true}).fill('  فاتورة الكهرباء  ');
 await d.getByRole('button',{name:'CliQ',exact:true}).click();
 await expect(d.getByRole('button',{name:'اعتماد وتسجيل المصروف'})).toBeDisabled();expect(captured).toEqual([]);
 await d.getByLabel('رقم مرجع CliQ *',{exact:true}).fill(' REF-22 ');
 await d.getByRole('button',{name:'اعتماد وتسجيل المصروف'}).click();
 await expect.poll(()=>captured.length).toBe(1);
 await expect(d.locator('[aria-busy="true"]')).toHaveCount(1);await page.keyboard.press('Escape');await expect(d).toBeVisible();
 expect(captured[0]).toEqual({p_branch_id:cashIds.branch,p_category:'إيجار',p_description:'فاتورة الكهرباء',p_amount_in_minor_units:12345,p_payment_method:'cliq',p_reference_number:'REF-22'});
 release();await expect(d.getByRole('button',{name:'اعتماد وتسجيل المصروف'})).toBeEnabled();
 await d.getByRole('button',{name:'كاش',exact:true}).click();
 await d.getByRole('button',{name:'اعتماد وتسجيل المصروف'}).click();await expect.poll(()=>captured.length).toBe(2);
 expect(captured[1]).toEqual({...captured[0] as object,p_payment_method:'cash'});release();
});
test('expense reversal keeps exact explicit reason and original expense identity',async({page})=>{
 const captured:unknown[]=[];
 await page.route('**/rest/v1/rpc/reverse_operational_expense',route=>{captured.push(route.request().postDataJSON());return route.fulfill({status:400,json:{message:'ISOLATED_PROBE_REJECTION',code:'P0001'}});});
 page.on('dialog',dialog=>dialog.accept('  تصحيح فاتورة  '));
 await page.goto('/e2e/package-f-financial-harness.html');
 await page.getByRole('button',{name:'عكس المصروف مع حفظ السجل',exact:true}).first().click();
 await expect.poll(()=>captured.length).toBe(1);
 expect(captured).toEqual([{p_expense_id:expenseRows[0].id,p_reason:'تصحيح فاتورة'}]);
});
test('no open shift keeps original route and prevents expense submission',async({page})=>{
 await page.goto('/e2e/package-f-financial-harness.html?view=expense-form&shift=closed');
 const d=page.getByRole('dialog');await expect(d.getByText('افتح وردية الصندوق أولًا')).toBeVisible();
 await expect(d.getByRole('button',{name:'اعتماد وتسجيل المصروف'})).toHaveCount(0);
 await d.getByRole('button',{name:'الانتقال إلى الورديات'}).click();await expect(d).toHaveCount(0);
});
test('report failure preserves no-financial-output and explicit retry',async({page})=>{
 await page.goto('/e2e/package-f-financial-harness.html?view=reports&report=error');
 await expect(page.getByText('تعذر قراءة التقرير في المعاينة',{exact:true})).toBeVisible();
 await expect(page.locator('.operational-report-print')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'إعادة المحاولة',exact:true})).toBeVisible();
});
for(const theme of ['light','dark'])test(`purchasing phone ${theme} compact one-line header,non-danger pay and clean due background`,async({page})=>{
 await page.setViewportSize({width:390,height:900});await page.goto(`/e2e/package-f-purchasing-harness.html?theme=${theme}`);
 const actions=page.getByTestId('purchase-header-actions');await expect(actions).toBeVisible();
 expect(await actions.locator('button').evaluateAll(es=>es.map(e=>({height:e.getBoundingClientRect().height,fits:e.scrollWidth<=e.clientWidth})))).toEqual([{height:44,fits:true},{height:44,fits:true},{height:44,fits:true}]);
 await expect(page.getByText('نظام بالجملة والتوريد',{exact:true})).toHaveCSS('white-space','nowrap');
 await expect(page.getByRole('button',{name:'دفع',exact:true}).first()).toHaveClass(/bg-nw-primary/u);
 const due=page.getByText('المستحق للموردين',{exact:true}).locator('..');await expect(due).not.toHaveClass(/bg-nw-bad-bg/u);
 await checkLayout(page,page.getByTestId('purchasing-workbench'));
});
