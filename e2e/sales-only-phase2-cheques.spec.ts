import {test,expect} from './isolated-test';
import {chequeRows,chequeCustomer,chequeResult} from './package-f-cheques.fixture';
test.use({hasTouch:true});
const harness='/e2e/package-f-cheques-harness.html';
test('OFF cheques reuse customer receipt writer and server incoming pagination;no supplier reads or new supplier actions',async({page})=>{
 await page.setViewportSize({width:390,height:1000});const writes:Record<string,unknown>[]=[];
 await page.route('**/rpc/receive_customer_cheque_v1',r=>{writes.push(r.request().postDataJSON());return r.fulfill({json:chequeResult(chequeRows[0])});});
 await page.goto(harness+'?sales-only');const work=page.getByTestId('cheques-workbench');
 await expect(work.getByRole('button',{name:'استلام شيك',exact:true})).toBeVisible();await expect(work.getByRole('button',{name:'إصدار شيك',exact:true})).toHaveCount(0);await expect(work.getByText('شيكات صادرة قائمة',{exact:true})).toHaveCount(0);await expect(work.getByRole('group',{name:'اتجاه الشيك'})).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>window.__phase2ChequeReads__.pages.length)).toBeGreaterThan(0);const reads=await page.evaluate(()=>window.__phase2ChequeReads__);expect(reads.supplierReads).toBe(0);expect(reads.pages.every(p=>p.p_direction==='incoming')).toBe(true);
 const incoming=chequeRows.find(c=>c.direction==='incoming'&&c.status==='pending')!;await work.getByRole('button',{name:`تفاصيل الشيك ${incoming.cheque_number}`,exact:true}).filter({visible:true}).tap();const details=page.getByRole('dialog',{name:'تفاصيل الشيك',exact:true});await expect(details.getByRole('button',{name:'صُرف',exact:true})).toBeVisible();await expect(details.getByRole('button',{name:'تجيير لمورد',exact:true})).toHaveCount(0);await details.getByRole('button',{name:/إغلاق/}).first().tap();
 await work.getByRole('button',{name:'استلام شيك',exact:true}).tap();const form=page.getByTestId('cheque-registration');await form.getByLabel('العميل',{exact:true}).selectOption(chequeCustomer);
 await form.getByLabel('البنك',{exact:true}).fill('بنك محلي');await form.getByLabel('رقم الشيك',{exact:true}).fill('000123');await form.getByLabel('تاريخ الاستحقاق',{exact:true}).fill('2026-12-10');await form.getByLabel('مبلغ الشيك (د.أ)',{exact:true}).fill('1.001');
 await form.getByRole('button',{name:'معاينة قبل التسجيل',exact:true}).tap();await expect(form.getByTestId('cheque-preview')).toBeVisible();await form.getByRole('button',{name:'تأكيد تسجيل الشيك',exact:true}).tap();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({p_customer_id:chequeCustomer,p_amount_in_minor_units:1001,p_cheque_number:'000123'});
});
test('a pending full supplier cheque keeps draft and idempotency identity across OFF;submission refused until full again',async({page})=>{
 await page.setViewportSize({width:390,height:1000});const writes:Record<string,unknown>[]=[];await page.route('**/rpc/issue_supplier_cheque_v1',async r=>{writes.push(r.request().postDataJSON());await r.abort('failed');});
 await page.goto(harness);await page.getByRole('button',{name:'إصدار شيك',exact:true}).tap();const form=page.getByTestId('cheque-registration');await form.getByLabel('المورد',{exact:true}).selectOption({index:1});
 await form.getByLabel('البنك',{exact:true}).fill('بنك محفوظ');await form.getByLabel('رقم الشيك',{exact:true}).fill('00077');await form.getByLabel('تاريخ الاستحقاق',{exact:true}).fill('2026-12-10');await form.getByLabel('مبلغ الشيك (د.أ)',{exact:true}).fill('1.001');
 await form.getByRole('button',{name:'معاينة قبل التسجيل',exact:true}).tap();await form.getByRole('button',{name:'تأكيد تسجيل الشيك',exact:true}).tap();await expect.poll(()=>writes.length).toBe(1);await expect(form.getByRole('alert')).toBeVisible();
 await page.evaluate(()=>window.__phase2ChequeMode__('sales-only'));await expect(form.getByRole('button',{name:'تأكيد تسجيل الشيك',exact:true})).toBeDisabled();await expect(form.getByLabel('البنك',{exact:true})).toHaveValue('بنك محفوظ');
 await form.evaluate(node=>(node as HTMLFormElement).requestSubmit());expect(writes).toHaveLength(1);
 await page.evaluate(()=>window.__phase2ChequeMode__('full'));await form.getByRole('button',{name:'تأكيد تسجيل الشيك',exact:true}).tap();await expect.poll(()=>writes.length).toBe(2);expect(writes[1]).toEqual(writes[0]);
});
