import {test,expect} from './isolated-test';
test.describe.configure({retries:0});
test.use({viewport:{width:390,height:844},hasTouch:true});
const id='92600000-0000-4000-8000-000000000103';
test('actual inventory UI→SQL: +24, correction, concurrent revision refusal, zero accounting writes',async({page,request},info)=>{
 const origin=process.env.INVENTORY224_CONTROL_URL!,token=process.env.INVENTORY224_CONTROL_TOKEN!;
 expect(new URL(origin).hostname).toBe('127.0.0.1');
 const headers={'x-quantity-test-token':token,'x-quantity-test-role':'authenticated'};
 const rpc=async(name:string,args:Record<string,unknown>)=>{const response=await request.post(origin+'/rpc/'+name,{headers,data:args});expect(response.ok()).toBe(true);return response.json();};
 const current=async()=>{const context=await rpc('lite3_counter_context223',{p_product_id:id});return context.products[0];};
 const set=async(quantity:number,enabled=true)=>{const row=await current();return rpc('lite3_set_counter223',{p_product_id:id,p_enabled:enabled,p_quantity:quantity,p_low_threshold:4,p_expected_revision:row.revision,p_expected_unit_id:row.unitId,p_key:crypto.randomUUID()});};
 await set(2);
 await page.route('**/rest/v1/rpc/**',async route=>{
  const name=new URL(route.request().url()).pathname.split('/').at(-1)!;
  expect(['lite3_counters224','lite3_counter_context223','lite3_set_counter223']).toContain(name);
  const response=await request.post(origin+'/rpc/'+name,{headers,data:route.request().postDataJSON()});
  return route.fulfill({status:response.status(),json:await response.json()});
 });
 await page.goto('/e2e/inventory224-harness.html');
 const button=page.locator(`[data-counter-id="${id}"]`);await button.click();const dialog=page.getByRole('dialog');
 await dialog.getByLabel('كم باكيت وصل؟',{exact:true}).fill('24');await expect(dialog.getByRole('status')).toHaveText('2 + 24 = الكمية الجديدة 26 باكيت');
 await dialog.getByRole('button',{name:'حفظ الكمية',exact:true}).click();await expect(dialog).toHaveCount(0);expect((await current()).quantity).toBe(26);
 await button.click();await dialog.getByRole('button',{name:'تصحيح العدد',exact:true}).click();await dialog.getByLabel('الكمية الموجودة',{exact:true}).fill('9');await dialog.getByRole('button',{name:'حفظ الكمية',exact:true}).click();await expect(dialog).toHaveCount(0);expect((await current()).quantity).toBe(9);
 await button.click();await expect(dialog.getByLabel('كم باكيت وصل؟',{exact:true})).toBeVisible();await set(1);
 await dialog.getByLabel('كم باكيت وصل؟',{exact:true}).fill('24');await dialog.getByRole('button',{name:'حفظ الكمية',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('QTY-01');expect((await current()).quantity).toBe(1);
 await page.screenshot({path:info.outputPath('inventory224-real-cas.png'),fullPage:true});
 await dialog.getByRole('button',{name:'إعادة قراءة الكمية',exact:true}).click();await expect(dialog).toContainText('الكمية الحالية 1 باكيت');await expect(dialog.getByLabel('كم باكيت وصل؟',{exact:true})).toHaveValue('0');
 await set(0,false);
});
