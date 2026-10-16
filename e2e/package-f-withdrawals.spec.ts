import AxeBuilder from '@axe-core/playwright';
import {test,expect,type Page} from './isolated-test';
import {checkLayout} from './package-f-layout';
import {analyzePackageFAccessibility} from './package-f-accessibility';
import {cashIds} from './package-f-cash.fixture';

const withdrawalId='93600000-0000-4000-8000-000000000101';
const at='2026-10-16T06:00:00Z';
async function withdrawalReads(page:Page){
 const calls:Array<{name:string;body:Record<string,unknown>}>=[];
 let reversed=false;
 await page.route('**/rest/v1/rpc/*',async route=>{
  const name=new URL(route.request().url()).pathname.split('/').at(-1)!;
  const body:Record<string,unknown>=route.request().postDataJSON();
  if(name==='get_shift_owner_withdrawals_v1')return route.fulfill({json:{withdrawals:[{
   withdrawalId,withdrawalNumber:'OW-000001',amountInMinorUnits:20000,reason:'سحب شخصي',createdAt:at,createdByName:'المالك',
   reversal:reversed?{reversalId:'reverse-1',effectiveShiftId:cashIds.shift,reversedAt:at,reason:'إرجاع المبلغ للدرج',viaShiftReversal:false}:null}],returnsFromOtherShifts:[]}});
  if(name==='get_owner_withdrawals_report')return route.fulfill({json:{totals:{withdrawnInMinorUnits:20000,returnedInMinorUnits:0,netInMinorUnits:20000},
   rows:[{kind:'withdrawal',at,direction:'out',amountInMinorUnits:20000,withdrawalNumber:'OW-000001',branchName:'فرع الرمثا',shiftNumber:'SHIFT-10482',actorName:'المالك',reason:'سحب شخصي',withdrawalId,isReversed:reversed}],totalCount:1,page:1,pageSize:25}});
  if(name==='create_owner_cash_withdrawal_v1'||name==='reverse_owner_cash_withdrawal_v1'){
   calls.push({name,body});if(name==='reverse_owner_cash_withdrawal_v1')reversed=true;
   return route.fulfill({json:{success:true,withdrawalNumber:'OW-000002',effectiveShiftId:cashIds.shift,idempotentReplay:false}});
  }
  return route.fallback();
 });
 return calls;
}
async function audit(page:Page){
 await page.evaluate(()=>document.fonts.ready);
 for(const dialog of await page.getByRole('dialog').all())if(await dialog.getAttribute('data-state')!==null)await expect(dialog).toHaveAttribute('data-state','open');
 await checkLayout(page,page.locator('body'));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.locator('body')).not.toContainText(/[٠-٩]/u);
 const result=await analyzePackageFAccessibility(page,new AxeBuilder({page}));
 expect(result.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
}
for(const theme of ['light','dark'])for(const width of [390,820,1440])test(`withdrawals ${theme} ${width}:shift,closing,report,home,payloads and accessibility`,async({page})=>{
 await page.setViewportSize({width,height:width<1024?844:1100});const calls=await withdrawalReads(page);
 await page.goto(`/e2e/package-f-cash-harness.html?theme=${theme}&withdrawals=1`);
 const panel=page.getByTestId('owner-withdrawals');await expect(panel).toContainText('OW-000001');await panel.scrollIntoViewIfNeeded();await audit(page);
 await panel.getByLabel('مبلغ السحب (د.أ) *',{exact:true}).fill('10.001');
 await panel.getByLabel('السبب (اختياري)',{exact:true}).fill('  سحب جديد  ');
 await panel.getByRole('button',{name:'سحب من الدرج',exact:true}).click();
 await expect(panel.getByRole('status')).toContainText('OW-000002');
 expect(calls[0]?.name).toBe('create_owner_cash_withdrawal_v1');
 expect(calls[0]?.body).toEqual({p_shift_id:cashIds.shift,p_amount_in_minor_units:10001,p_reason:'سحب جديد',p_idempotency_key:expect.stringMatching(/^owner-withdrawal-/u)});
 await panel.getByRole('button',{name:'عكس السحب OW-000001',exact:true}).click();
 await expect(panel.getByRole('button',{name:'تأكيد العكس',exact:true})).toBeDisabled();
 await panel.getByLabel('سبب العكس *',{exact:true}).fill('إرجاع المبلغ للدرج');
 await panel.getByRole('button',{name:'تأكيد العكس',exact:true}).click();await expect(panel).toContainText('أُعيد للدرج');
 expect(calls[1]?.body).toEqual({p_withdrawal_id:withdrawalId,p_reason:'إرجاع المبلغ للدرج',p_idempotency_key:expect.stringMatching(/^owner-withdrawal-reversal-/u)});
 await audit(page);
 await page.getByRole('button',{name:'عرض التقرير المالي الحي',exact:true}).click();
 await expect(page.getByTestId('closing-owner-withdrawals')).toContainText('OW-000001');await audit(page);
 await page.goto(`/e2e/package-f-financial-harness.html?theme=${theme}&view=reports&withdrawals=1`);
 const report=page.getByTestId('report-owner-withdrawals');await expect(report).toContainText('OW-000001');
 await expect(report).toContainText('30.000');await expect(report).toContainText('20.000');await expect(report).toContainText('10.000');await audit(page);
 await page.goto(`/e2e/package-f-home-harness.html?theme=${theme}&withdrawals=1`);
 await expect(page.getByTestId('home-owner-withdrawals')).toContainText('20.000');await audit(page);
 await page.goto(`/e2e/package-f-home-harness.html?theme=${theme}&withdrawals=1&unavailable=1`);
 await expect(page.getByTestId('home-owner-withdrawals')).toContainText('20.000');
 await expect(page.getByTestId('home-owner-withdrawals')).toContainText('غير متاح');await audit(page);
});
test('cashier cannot see owner withdrawal actions',async({page})=>{
 await withdrawalReads(page);await page.goto('/e2e/package-f-cash-harness.html?cashier=1&withdrawals=1');
 await expect(page.getByTestId('cash-workbench')).toBeVisible();await expect(page.getByTestId('owner-withdrawals')).toHaveCount(0);
});
for(const theme of ['light','dark'])test(`drawer shortfall ${theme} warns once without changing expense payload or blocking confirmation`,async({page})=>{
 const captured:Record<string,unknown>[]=[];
 await page.route('**/rest/v1/rpc/create_operational_expense',async route=>{
  captured.push(route.request().postDataJSON());return route.fulfill({status:400,json:{message:'LOCAL_ASSERTED_EXPENSE',code:'P0001'}});
 });
 await page.setViewportSize({width:390,height:844});await page.goto(`/e2e/package-f-financial-harness.html?theme=${theme}&view=expense-form`);
 const dialog=page.getByRole('dialog',{name:'مصروف جديد',exact:true});await expect(dialog).toHaveAttribute('data-state','open');
 await dialog.getByLabel('المبلغ (د.أ) *',{exact:true}).fill('900.000');
 await dialog.getByLabel('البيان / الوصف *',{exact:true}).fill('فاتورة فحص الدرج');
 await dialog.getByRole('button',{name:'اعتماد وتسجيل المصروف',exact:true}).click();
 await expect(dialog.getByTestId('drawer-shortfall-warning')).toContainText('متأكد');expect(captured).toEqual([]);await audit(page);
 await dialog.getByRole('button',{name:'اعتماد وتسجيل المصروف',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('LOCAL_ASSERTED_EXPENSE');expect(captured).toHaveLength(1);
 expect(captured[0]).toMatchObject({p_amount_in_minor_units:900000,p_description:'فاتورة فحص الدرج',p_payment_method:'cash'});
});
