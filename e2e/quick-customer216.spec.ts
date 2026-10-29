import {test, expect} from './isolated-test';

test('216 quick customer has only name/phone, uses existing save_customer and selects confirmed identity', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  const calls: Record<string, unknown>[] = [];
  await page.route('**/rest/v1/rpc/save_customer', r => {
    calls.push(r.request().postDataJSON());
    return r.fulfill({json:{customer_id:'21600000-0000-4000-8000-000000000001'}});
  });
  await page.goto('/e2e/quick-customer216-harness.html');
  await expect(page.locator('input')).toHaveCount(2);
  await expect(page.locator('select')).toHaveCount(0);
  await page.getByLabel('اسم العميل أو المحل *',{exact:true}).fill('زبون تجربة وهمي');
  await page.getByLabel('رقم الهاتف *',{exact:true}).fill('0790000000');
  for (const input of await page.locator('input').all()) {
    expect(await input.evaluate(n=>Number.parseFloat(getComputedStyle(n).fontSize))).toBeGreaterThanOrEqual(16);
    expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('button',{name:'حفظ واختيار العميل',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('اختير زبون تجربة وهمي');
  await expect(page.getByTestId('closed')).toHaveText('true');
  expect(calls).toEqual([{p_full_name:'زبون تجربة وهمي',p_phone:'0790000000',p_customer_id:null,
    p_email:null,p_governorate:null,p_whatsapp:null,p_notes:null,p_customer_type:'wholesale'}]);
});

test('216 quick customer cannot select or close on server permission refusal', async ({page}) => {
  let calls=0;
  await page.route('**/rest/v1/rpc/save_customer', r => {calls++;return r.fulfill({status:403,
    json:{code:'42501',message:'ليس لديك صلاحية إضافة العملاء.'}});});
  await page.goto('/e2e/quick-customer216-harness.html');
  await page.getByLabel('اسم العميل أو المحل *',{exact:true}).fill('زبون وهمي');
  await page.getByLabel('رقم الهاتف *',{exact:true}).fill('0790000000');
  await page.getByRole('button',{name:'حفظ واختيار العميل',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('صلاحية');
  await expect(page.getByTestId('closed')).toHaveText('false');
  await expect(page.getByRole('status')).toHaveCount(0);
  expect(calls).toBe(1);
});
