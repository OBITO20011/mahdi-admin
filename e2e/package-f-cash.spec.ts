import AxeBuilder from '@axe-core/playwright';
import {test,expect,type Page} from './isolated-test';
import {cashIds,cashShift,shiftRpcFixture,cashReportFixture,recentCashShifts} from './package-f-cash.fixture';
const url=(query='')=>'/e2e/package-f-cash-harness.html?'+query;
for(const theme of ['light','dark'])test(`Arabic shift time ${theme} reads visually as 08:30 then ص`,async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto(url('theme='+theme));
  const time=page.getByTestId('cash-start-time');await expect(time).toHaveText('08:30 ص');
  await expect(time).toHaveAttribute('dir','auto');await page.evaluate(()=>document.fonts.ready);
  const positions=await time.evaluate(element=>{
    const text=element.firstChild!;
    const number=document.createRange();number.setStart(text,0);number.setEnd(text,5);
    const period=document.createRange();period.setStart(text,6);period.setEnd(text,7);
    return {number:number.getBoundingClientRect().left,period:period.getBoundingClientRect().right};
  });
  expect(positions.number).toBeGreaterThan(positions.period);
});
async function checkLayout(page:Page){
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.getByTestId('cash-workbench')).not.toContainText(/[٠-٩]/u);
  const escaped=await page.getByTestId('cash-workbench').evaluate(root=>{
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),bad:string[]=[];
    while(walker.nextNode()){
      const node=walker.currentNode,parent=node.parentElement;
      if(!parent||!node.textContent?.trim()||parent.closest('.sr-only,style')||!parent.getClientRects().length)continue;
      const box=parent.closest('p,h1,h2,h3,h4,h5,button,summary,div,span')??parent,rect=box.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(node);
      for(const r of range.getClientRects())if(r.width&&(r.left<rect.left-1||r.right>rect.right+1))bad.push(node.textContent.trim());
    }return bad;
  });expect(escaped).toEqual([]);
}
async function axe(page:Page){const result=await new AxeBuilder({page}).include('[data-testid="cash-workbench"]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();expect(result.violations.filter(v=>v.impact==='serious'||v.impact==='critical').map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);}
for(const theme of ['light','dark'])for(const width of [390,820,1440])test(`Cash ${theme} ${width}: authoritative fixture,Latin digits,containment,axe and sticky close`,async({page},info)=>{
  await page.setViewportSize({width,height:width<1024?844:1100});await page.goto(url('theme='+theme));
  await expect(page.getByTestId('cash-expected')).toContainText('810.300');await page.evaluate(()=>document.fonts.ready);
  await expect(page.getByTestId('cash-workbench')).toContainText('عدد العمليات: غير متاح');await expect(page.getByTestId('cash-workbench')).toContainText('مبيعات الدين للذمم');
  await checkLayout(page);await axe(page);
  if(width<1024){const close=page.getByTestId('cash-count-open');await expect(close).toBeInViewport();
    await page.getByTestId('cash-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;});await expect(close).toBeInViewport();
    await close.click();await expect(page.getByRole('dialog',{name:'إغلاق الوردية',exact:true})).toBeInViewport();await expect(page.getByTestId('cash-close-submit')).toBeInViewport();
    await checkLayout(page);await axe(page);await page.getByRole('button',{name:'رجوع للصندوق',exact:true}).click();await expect(close).toBeFocused();
    await page.getByTestId('cash-scroll').evaluate(el=>{el.scrollTop=0;});
  }else await expect(page.getByTestId('cash-close-submit')).toBeVisible();
  await page.screenshot({path:info.outputPath(`cash-${theme}-${width}.png`),fullPage:true});
});

test('denomination count retains exact old close payload,reason guard,busy close guard and existing report print',async({page})=>{
  await page.setViewportSize({width:390,height:844});const sent:Record<string,unknown>[]=[];
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/rest/v1/rpc/close_cash_shift',async route=>{sent.push(route.request().postDataJSON());await gate;await route.fulfill({json:{success:true,...shiftRpcFixture({...cashShift,status:'closed',actualCash:809.8,cashDiscrepancy:-.5}),message:'تم الإغلاق'}});});
  await page.goto(url('theme=dark'));await page.getByTestId('cash-count-open').click();
  for(const [denomination,count] of [[50,14],[20,4],[10,2],[5,1],[1,3]])await page.getByLabel(`عدد فئة ${denomination} دينار`,{exact:true}).fill(String(count));
  await page.getByLabel('الفكة كمبلغ',{exact:true}).fill('1.800');await expect(page.getByTestId('cash-count-total')).toHaveText('809.800');
  await page.getByRole('button',{name:/اعتماد العد في المبلغ/u}).click();await expect(page.getByLabel('الكاش الفعلي بعد عدّ الصندوق',{exact:true})).toHaveValue('809.800');
  const submit=page.getByTestId('cash-close-submit');await expect(submit).toBeDisabled();await page.getByLabel('سبب النقص أو الزيادة (إجباري)',{exact:true}).fill('فكة ناقصة');await expect(submit).toBeEnabled();
  await submit.click();await expect.poll(()=>sent.length).toBe(1);
  expect(sent[0]).toEqual({p_shift_id:cashIds.shift,p_actual_cash_in_minor_units:809800,p_discrepancy_reason:'فكة ناقصة'});
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'إغلاق الوردية',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'رجوع للصندوق'})).toBeDisabled();
  release();await expect(page.getByRole('dialog',{name:'تقرير الإغلاق اليومي',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'طباعة أو حفظ التقرير PDF',exact:true})).toBeVisible();expect(sent).toHaveLength(1);
});

test('open shift and empty cancellation preserve exact store/service request and reason gates',async({page})=>{
  const sent:{name:string;args:Record<string,unknown>}[]=[];
  await page.route('**/rest/v1/rpc/open_cash_shift',async route=>{sent.push({name:'open',args:route.request().postDataJSON()});await route.fulfill({json:{success:true,...shiftRpcFixture(cashShift)}});});
  await page.goto(url('closed=1'));await page.getByLabel('العهدة الافتتاحية (د.أ)').fill('50.125');await page.getByRole('button',{name:'فتح وردية جديدة',exact:true}).click();await expect.poll(()=>sent.length).toBe(1);
  expect(sent[0].args).toEqual({p_branch_id:cashIds.branch,p_opening_cash_in_minor_units:50125});
  await page.route('**/rest/v1/rpc/cancel_empty_cash_shift',async route=>{sent.push({name:'cancel',args:route.request().postDataJSON()});await route.fulfill({json:{success:false,message:'يوجد نشاط'}});});
  await page.goto(url());await page.getByRole('button',{name:'إلغاء وردية فُتحت بالخطأ',exact:true}).click();const confirm=page.getByRole('button',{name:'نعم، إلغاء الوردية',exact:true});await expect(confirm).toBeDisabled();
  await page.getByLabel('سبب إلغاء الوردية').fill('فتح بالخطأ');await confirm.click();await expect.poll(()=>sent.length).toBe(2);
  expect(sent[1].args).toEqual({p_shift_id:cashIds.shift,p_reason:'فتح بالخطأ'});
});

test('archive keeps all six filter values and server paging,not visible-row filtering',async({page})=>{
  const requests:Record<string,unknown>[]=[];
  await page.route('**/rest/v1/rpc/get_cash_shift_archive_page',async route=>{requests.push(route.request().postDataJSON());await route.fulfill({json:{success:true,items:recentCashShifts.map(shiftRpcFixture),totalCount:64,limit:25,hasMore:true,cashiers:[{id:cashIds.actor,name:'أحمد'}]}});});
  await page.goto(url('live=1'));const archive=page.getByLabel('أرشيف الورديات',{exact:true}).filter({has:page.getByRole('searchbox',{name:'رقم الوردية'})});
  await archive.getByRole('searchbox',{name:'رقم الوردية'}).fill('SHIFT-42');await archive.getByLabel('الفرع',{exact:true}).selectOption(cashIds.branch);
  await archive.getByLabel('الكاشير / فاتح الوردية',{exact:true}).selectOption(cashIds.actor);await archive.getByLabel('الحالة',{exact:true}).selectOption('closed');
  await archive.getByLabel('من تاريخ',{exact:true}).fill('2026-10-01');await archive.getByLabel('إلى تاريخ',{exact:true}).fill('2026-10-09');await archive.getByRole('button',{name:'تطبيق الفلاتر'}).click();
  await expect.poll(()=>requests.some(r=>r.p_shift_number==='SHIFT-42')).toBe(true);
  expect(requests.at(-1)).toEqual({p_branch_id:cashIds.branch,p_cashier_id:cashIds.actor,p_status:'closed',p_shift_number:'SHIFT-42',p_date_from:'2026-10-01',p_date_to:'2026-10-09',p_limit:25,p_offset:0});
  await archive.getByRole('button',{name:'التالي',exact:true}).click();await expect.poll(()=>requests.at(-1)?.p_offset).toBe(25);
});

test('owner full reversal preview cannot execute blocked evidence;cashier cannot expose it',async({page})=>{
  const requested:Record<string,unknown>[]=[];
  await page.route('**/rest/v1/rpc/preview_cash_shift_full_reversal',async route=>{requested.push(route.request().postDataJSON());await route.fulfill({json:{success:true,canExecute:false,shiftId:cashIds.shift,summary:{cash_in_minor_units:-734000},operations:[],scopeNote:'مانع مثبت'}});});
  await page.goto(url());await page.getByRole('button',{name:'إلغاء الوردية وعكس جميع عملياتها',exact:true}).click();await page.getByRole('button',{name:'معاينة العمليات والأثر المالي',exact:true}).click();
  await expect.poll(()=>requested.length).toBe(1);expect(requested[0]).toEqual({p_shift_id:cashIds.shift});await expect(page.getByText('لا يمكن التأكيد:',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'تأكيد عكس الوردية بالكامل'})).toHaveCount(0);
  await page.goto(url('cashier=1'));await expect(page.getByRole('button',{name:'إلغاء الوردية وعكس جميع عملياتها',exact:true})).toHaveCount(0);
});

for(const theme of ['light','dark'])test(`real report adapter ${theme} preserves detailed financial/return evidence and existing print action`,async({page})=>{
  const reports:Record<string,unknown>[]=[];await page.route('**/rest/v1/rpc/get_cash_shift_closing_report',async route=>{reports.push(route.request().postDataJSON());await route.fulfill({json:cashReportFixture});});
  await page.goto(url('live=1&theme='+theme));await page.getByRole('button',{name:'عرض التقرير المالي الحي',exact:true}).click();
  await expect.poll(()=>reports.length).toBe(1);expect(reports[0]).toEqual({p_shift_id:cashIds.shift});
  const dialog=page.getByRole('dialog',{name:'تقرير الإغلاق اليومي',exact:true});await expect(dialog).toContainText('تفصيل كميات المرتجعات');await expect(dialog).toContainText('1,073.000');
  await checkLayout(page);await axe(page);
  await page.evaluate(()=>{window.print=()=>{document.body.dataset.printed='true';};});await dialog.getByRole('button',{name:'طباعة أو حفظ التقرير PDF',exact:true}).click();await expect(page.locator('body')).toHaveAttribute('data-printed','true');
});

for(const width of [390,1440])test(`closed center ${width} retains recent closed/cancelled/reversed audit and report access`,async({page})=>{
  await page.setViewportSize({width,height:960});await page.goto(url('closed=1'));
  await expect(page.getByText('لا توجد وردية مفتوحة حاليًا',{exact:true})).toBeVisible();
  const recent=page.getByTestId('cash-workbench').locator('section.md\\:hidden,div.hidden.md\\:block').filter({hasText:'آخر الورديات المغلقة والملغاة والمعكوسة'}).filter({visible:true});
  await expect(recent).toContainText('SHIFT-10481');await expect(recent).toContainText('SHIFT-10478');await expect(recent).toContainText('SHIFT-10477');await expect(recent).toContainText('فُتحت بالخطأ');await expect(recent).toContainText('تصحيح العمليات');await expect(recent).toContainText('REV-42');
  await recent.getByRole('button',{name:width<768?'عرض تقرير الإغلاق الكامل':'تقرير SHIFT-10481',exact:true}).first().click();
  await expect(page.getByRole('dialog',{name:'تقرير الإغلاق اليومي',exact:true})).toContainText('SHIFT-10481');
});

test('missing historical drawer difference is unavailable,never a guessed zero match',async({page})=>{
  await page.setViewportSize({width:390,height:960});await page.goto(url('closed=1&missing-difference=1'));
  const recent=page.getByTestId('cash-workbench').locator('section.md\\:hidden');
  await expect(recent).toContainText('فرق الصندوق');await expect(recent).toContainText('غير متاح');await expect(recent).not.toContainText('0.000');
});

test('supported owner reversal retains the exact preview-bound key and both explicit confirmation inputs',async({page})=>{
  const sent:Record<string,unknown>[]=[];
  await page.route('**/rest/v1/rpc/preview_cash_shift_full_reversal',async route=>{await route.fulfill({json:{success:true,canExecute:true,shiftId:cashIds.shift,summary:{cash_in_minor_units:-734000},operations:[]}});});
  await page.route('**/rest/v1/rpc/reverse_cash_shift_with_operations',async route=>{sent.push(route.request().postDataJSON());await route.fulfill({json:{success:true,reversalId:'REV-135',idempotent:false,actualEffect:{},operations:[]}});});
  await page.goto(url());await page.getByRole('button',{name:'إلغاء الوردية وعكس جميع عملياتها',exact:true}).click();await page.getByRole('button',{name:'معاينة العمليات والأثر المالي',exact:true}).click();
  const confirm=page.getByRole('button',{name:'تأكيد عكس الوردية بالكامل',exact:true});await expect(confirm).toBeDisabled();
  await page.getByLabel('سبب عكس الوردية').fill('تصحيح العمليات');await page.getByLabel('تأكيد عكس الوردية',{exact:true}).fill('تأكيد خاطئ');await expect(confirm).toBeDisabled();
  await page.getByLabel('تأكيد عكس الوردية',{exact:true}).fill('إلغاء الوردية');await confirm.click();await expect.poll(()=>sent.length).toBe(1);
  expect(sent[0]).toEqual({p_shift_id:cashIds.shift,p_reason:'تصحيح العمليات',p_idempotency_key:expect.stringMatching(/^[a-f\d-]{36}$/u)});
  await expect(page.getByText('تم العكس بنجاح. مرجع العملية: REV-135',{exact:true})).toBeVisible();expect(sent).toHaveLength(1);
});
