import AxeBuilder from '@axe-core/playwright';
import {test,expect} from './isolated-test';
import {checkLayout} from './package-f-layout';
import {analyzePackageFAccessibility} from './package-f-accessibility';
import {chequeCustomer,chequeBranch} from './package-f-cheques.fixture';
for(const theme of ['light','dark'])for(const width of [390,820,1440]){
 test(`cashier collection198 ${theme} ${width}:payload unchanged,no reversal,accessible`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const calls:unknown[]=[];
  await page.route('**/rest/v1/rpc/collect_customer_balance_v1',route=>{
   calls.push(route.request().postDataJSON());return route.fulfill({json:{operationId:'saved198',operationNumber:'COL-198-NEW',amountInMinorUnits:1000,paymentMethod:'cash'}});
  });
  await page.goto(`/e2e/package-f-cheques-harness.html?view=collection&role=cashier&theme=${theme}`);
  await expect(page.getByText('COL-198',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/عكس العملية/u})).toHaveCount(0);
  await page.getByLabel('المبلغ المقبوض (د.أ) *',{exact:true}).fill('1.000');
  await page.getByRole('button',{name:'معاينة التوزيع',exact:true}).click();
  await expect(page.getByTestId('customer-collection-preview')).toBeVisible();
  await checkLayout(page,page.locator('body'));
  await expect(page.locator('body')).not.toContainText(/[٠-٩]/u);
  const result=await analyzePackageFAccessibility(page,new AxeBuilder({page}));
  expect(result.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
  await page.getByRole('button',{name:'حفظ التحصيل',exact:true}).click();
  await expect.poll(()=>calls.length).toBe(1);
  expect(calls).toEqual([{p_customer_id:chequeCustomer,p_amount_in_minor_units:1000,p_payment_method:'cash',p_branch_id:chequeBranch,
   p_reference_number:null,p_notes:null,p_idempotency_key:expect.stringMatching(/^collect-/u)}]);
  await page.goto(`/e2e/package-f-cheques-harness.html?view=collection&role=owner&theme=${theme}`);
  await expect(page.getByRole('button',{name:'عكس العملية COL-198',exact:true})).toBeVisible();
 });
}
