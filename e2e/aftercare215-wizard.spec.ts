import {test,expect} from './isolated-test';
import {wizard215Order} from './aftercare215-wizard.fixture';
const id=(n:number)=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const seal='a'.repeat(64);
async function inspect(page:import('@playwright/test').Page){
  await page.getByRole('button',{name:'إرجاع أو استبدال',exact:true}).click();await page.getByRole('button',{name:'يبدّل',exact:true}).click();await page.getByRole('button',{name:'التالي',exact:true}).click();
  await page.getByRole('button',{name:'طرد كامل',exact:true}).click();await page.getByRole('button',{name:'التالي',exact:true}).click();
  await page.getByLabel('الخربان · عصير تجريبي',{exact:true}).fill('1');await expect(page.getByText('السليم الذي يرجع للمخزون: 11 باكيت',{exact:true})).toBeVisible();
  await page.getByLabel('فحصت الباكيتات الراجعة',{exact:true}).check();await page.getByRole('button',{name:'التالي',exact:true}).click();
  await page.getByRole('button',{name:'خسارة عليّ — تالف نهائي',exact:true}).click();await page.getByRole('button',{name:'التالي',exact:true}).click();
}
test.beforeEach(async({page})=>{await page.setViewportSize({width:390,height:844});});
test('215 mobile wizard sends 11 good/1 bad only after a server preview and explicit confirmation',async({page},info)=>{
  let previews=0,writes=0,writeBody:Record<string,unknown>|undefined;
  await page.route('**/rest/v1/rpc/preview_inspected_sales_replacement_v2',route=>{previews++;const p=route.request().postDataJSON().p_payload;expect(p.items[0].goodQuantity).toBe(11);expect(p.items[0].quantity).toBe(12);
    return route.fulfill({json:{contractVersion:215,orderId:wizard215Order.id,previewFingerprint:seal,issuedQuantity:12,restockedQuantity:11,badQuantity:1,moneyDifferenceInMinorUnits:0,customerDebtDeltaInMinorUnits:0,
      issuedCostInMinorUnits:'6000',goodRecoveryInMinorUnits:'5500',supplierHeldInMinorUnits:'0',profitDeltaInMinorUnits:'-500'}});});
  await page.route('**/auth/v1/user',route=>route.fulfill({json:{id:id(70)}}));
  await page.route('**/rest/v1/rpc/settle_inspected_sales_replacement_v2',route=>{writes++;writeBody=route.request().postDataJSON();return route.fulfill({json:{success:true,contractVersion:215,operationId:id(80),orderId:wizard215Order.id,replacementId:id(81),issuedQuantity:12,restockedQuantity:11,badQuantity:1,caseIds:[],moneyDifferenceInMinorUnits:0,idempotentReplay:false}});});
  await page.goto('/e2e/aftercare215-wizard-harness.html');await inspect(page);expect(writes).toBe(0);expect(previews).toBe(0);
  await page.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();await expect(page.getByTestId('aftercare215-preview')).toBeVisible();expect(previews).toBe(1);expect(writes).toBe(0);
  await expect(page.getByTestId('aftercare215-preview')).toContainText('11 باكيت');await expect(page.getByTestId('aftercare215-preview')).toContainText('صافي المخزون: -1 باكيت');
  await page.getByText('قيم المالك',{exact:true}).click();await expect(page.getByTestId('aftercare215-preview')).toContainText('−0.500 د.أ');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('wizard-390.png'),fullPage:true});
  await page.getByRole('button',{name:'تأكيد الاستبدال',exact:true}).click();await expect(page.getByRole('status')).toContainText('تم الاستبدال');expect(writes).toBe(1);
  expect(writeBody?.p_preview_fingerprint).toBe(seal);expect(String(writeBody?.p_idempotency_key)).toMatch(/^phase43:/);expect(JSON.stringify(writeBody)).not.toMatch(/issuedCost|profitDelta|goodRecovery/);
});
test('215 mobile wizard names a missing inspection field and uses 16px quantity controls',async({page})=>{
  await page.goto('/e2e/aftercare215-wizard-harness.html');await page.getByRole('button',{name:'إرجاع أو استبدال',exact:true}).click();await page.getByRole('button',{name:'التالي',exact:true}).click();
  await page.getByRole('button',{name:'التالي',exact:true}).click();await expect(page.getByRole('alert')).toContainText('اختر ما رجع');
  await page.getByRole('button',{name:'طرد كامل',exact:true}).click();await page.getByRole('button',{name:'التالي',exact:true}).click();
  await page.getByRole('button',{name:'التالي',exact:true}).click();await expect(page.getByRole('alert')).toContainText('فحصت');
  const field=page.getByLabel('الخربان · عصير تجريبي',{exact:true});expect(await field.evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
  expect(await field.getAttribute('inputmode')).toBe('numeric');expect(await field.evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
});
test('215 changing account discards an owner preview and ignores its late response',async({page})=>{
  let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});let invoked=false;
  await page.route('**/rest/v1/rpc/preview_inspected_sales_replacement_v2',async route=>{invoked=true;await waiting;await route.fulfill({json:{contractVersion:215,orderId:wizard215Order.id,previewFingerprint:seal,issuedQuantity:12,restockedQuantity:11,badQuantity:1,moneyDifferenceInMinorUnits:0,customerDebtDeltaInMinorUnits:0,
    issuedCostInMinorUnits:'6000',goodRecoveryInMinorUnits:'5500',supplierHeldInMinorUnits:'0',profitDeltaInMinorUnits:'-500'}});});
  await page.goto('/e2e/aftercare215-wizard-harness.html');await inspect(page);await page.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();await expect.poll(()=>invoked).toBe(true);
  await page.getByRole('button',{name:'تجربة تبديل الحساب',exact:true}).click();release();await expect(page.getByRole('button',{name:'إرجاع أو استبدال',exact:true})).toBeVisible();
  await expect(page.getByTestId('aftercare215-preview')).toHaveCount(0);await expect(page.getByText('قيم المالك',{exact:true})).toHaveCount(0);
});
