import AxeBuilder from '@axe-core/playwright';
import {test,expect,type Page} from './isolated-test';
import {checkLayout} from './package-f-layout';
import {analyzePackageFAccessibility} from './package-f-accessibility';
import {chequeRows,chequeBranch,chequeCustomer,chequeSupplier,chequeClaim,chequeResult,type ChequeFixtureRow} from './package-f-cheques.fixture';
import {posFixtureProducts,posFixtureIds} from './package-f-pos.fixture';
import {purchaseOrders,supplierRow,supplierId as poSupplier,branchId as poBranch} from './package-f-purchasing.fixture';
declare global {interface Window {__goLiveCalls:{name:string;args:Record<string,unknown>}[]}}
const url=(query='')=>'/e2e/package-f-cheques-harness.html?'+query;
for(const theme of ['light','dark'])test(`late supplier ${theme}:loaded party binds without resetting typed cheque inputs`,async({page})=>{
  await page.setViewportSize({width:390,height:1100});const calls:{name:string;args:Record<string,unknown>}[]=[];
  await page.route('**/rpc/preview_supplier_cheque_v1',route=>{calls.push({name:'preview_supplier_cheque_v1',args:route.request().postDataJSON()});
    return route.fulfill({json:{balanceInMinorUnits:600000,allocatedInMinorUnits:1001}});});
  await page.route('**/rpc/issue_supplier_cheque_v1',route=>{calls.push({name:'issue_supplier_cheque_v1',args:route.request().postDataJSON()});
    return route.fulfill({json:chequeResult({...chequeRows[1]!,supplier_id:poSupplier,branch_id:poBranch,amount_in_minor_units:1001})});});
  await page.goto(`/e2e/package-f-purchasing-harness.html?view=payment&lateSupplier=1&theme=${theme}`);
  const dialog=page.getByRole('dialog',{name:'دفعة المورد',exact:true});
  await dialog.getByRole('combobox',{name:'طريقة الدفع',exact:true}).selectOption('check');
  const form=dialog.getByTestId('cheque-registration');
  await form.getByLabel('البنك',{exact:true}).fill('بنك متأخر');await form.getByLabel('رقم الشيك',{exact:true}).fill('LATE-001');
  await form.getByLabel('تاريخ الاستحقاق',{exact:true}).fill('2026-10-18');await form.getByLabel('مبلغ الشيك (د.أ)',{exact:true}).fill('1.001');
  await page.evaluate(()=>window.dispatchEvent(new Event('fixture-suppliers-ready')));
  await expect(form.getByText(supplierRow.company_name, {exact:true})).toBeVisible();
  await expect(form.getByLabel('البنك',{exact:true})).toHaveValue('بنك متأخر');
  await expect(form.getByLabel('رقم الشيك',{exact:true})).toHaveValue('LATE-001');
  await expect(form.getByLabel('تاريخ الاستحقاق',{exact:true})).toHaveValue('2026-10-18');
  await expect(form.getByLabel('مبلغ الشيك (د.أ)',{exact:true})).toHaveValue('1.001');
  await form.getByRole('button',{name:'معاينة قبل التسجيل',exact:true}).click();await expect(form.getByTestId('cheque-preview')).toBeVisible();
  await form.getByRole('button',{name:'تأكيد تسجيل الشيك',exact:true}).click();await expect(dialog).toBeHidden();
  expect(calls).toEqual([
    {name:'preview_supplier_cheque_v1',args:{p_supplier_id:poSupplier,p_amount_in_minor_units:1001,p_claim_id:null,p_purchase_order_id:purchaseOrders[1]!.id}},
    {name:'issue_supplier_cheque_v1',args:{p_supplier_id:poSupplier,p_branch_id:poBranch,p_amount_in_minor_units:1001,p_claim_id:null,
      p_purchase_order_id:purchaseOrders[1]!.id,p_bank_name:'بنك متأخر',p_cheque_number:'LATE-001',p_due_date:'2026-10-18',p_notes:null,p_idempotency_key:expect.stringMatching(/^cheque-/u)}},
  ]);
});
for(const theme of ['light','dark'])for(const width of [390,1440])test(`claim reversal ${theme} ${width}:owner reason and exact narrow RPC;manager has no reversal`,async({page})=>{
  await page.setViewportSize({width,height:1100});const calls:{name:string;args:Record<string,unknown>}[]=[];
  await page.route('**/rpc/reverse_supplier_cheque_claim_payment_v1',async route=>{
    calls.push({name:'reverse_supplier_cheque_claim_payment_v1',args:route.request().postDataJSON()});
    await page.evaluate(()=>window.__chequeFixture.reverseClaimPayment('عكس سداد قيد المورد للاختبار'));
    return route.fulfill({json:{success:true,idempotentReplay:false,reversalId:'fixture-reversal',paymentId:'fixture-claim-payment'}});
  });
  await page.goto(url('theme='+theme));await page.getByRole('button',{name:'تفاصيل الشيك RET-10502',exact:true}).click();
  await page.getByRole('button',{name:'عكس سداد القيد',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'عكس سداد قيد المورد',exact:true});
  await expect(dialog).toContainText('لا تُعكس دفعة الشيك الأصلية');
  const confirm=dialog.getByRole('button',{name:'تأكيد عكس السداد',exact:true});await expect(confirm).toBeDisabled();
  await dialog.getByLabel('سبب عكس السداد (5–500 حرف)',{exact:true}).fill('قصير');await expect(confirm).toBeDisabled();
  await dialog.getByLabel('سبب عكس السداد (5–500 حرف)',{exact:true}).fill('عكس سداد قيد المورد للاختبار');await audit(page);
  await confirm.click();await expect(dialog).toBeHidden();expect(calls).toEqual([{name:'reverse_supplier_cheque_claim_payment_v1',args:{
    p_supplier_payment_id:'fixture-claim-payment',p_reason:'عكس سداد قيد المورد للاختبار',p_idempotency_key:expect.stringMatching(/^cheque-/u)}}]);
  await expect(page.getByRole('region',{name:'دفعات سداد القيد'})).toContainText('سداد معكوس · عكس سداد قيد المورد للاختبار');
  await expect(page.getByRole('button',{name:'عكس سداد القيد',exact:true})).toHaveCount(0);
  await page.goto(url(`theme=${theme}&role=manager`));await page.getByRole('button',{name:'تفاصيل الشيك RET-10502',exact:true}).click();
  await expect(page.getByRole('region',{name:'دفعات سداد القيد'})).toContainText('12.345');
  await expect(page.getByRole('button',{name:'عكس سداد القيد',exact:true})).toHaveCount(0);await audit(page);
});
for(const theme of ['light','dark'])test(`supplier opening cheque ${theme}:same registration form,opening-only allocation,no legacy163 cheque`,async({page})=>{
  await page.setViewportSize({width:390,height:1100});const calls:{name:string;args:Record<string,unknown>}[]=[];
  await page.route('**/rpc/preview_supplier_cheque_v1',route=>{calls.push({name:'preview_supplier_cheque_v1',args:route.request().postDataJSON()});
    return route.fulfill({json:{balanceInMinorUnits:1500000,allocatedInMinorUnits:20000}});});
  await page.route('**/rpc/issue_supplier_cheque_v1',route=>{calls.push({name:'issue_supplier_cheque_v1',args:route.request().postDataJSON()});
    return route.fulfill({json:chequeResult({...chequeRows[1]!,supplier_id:'s1',branch_id:'golive-branch',amount_in_minor_units:20000})});});
  await page.goto(`/e2e/package-f-go-live-harness.html?theme=${theme}&seeded=1`);
  await page.getByTestId('go-live-card-suppliers').getByRole('button',{name:'سداد رصيد سابق SOB-001001'}).click();
  await page.getByTestId('go-live-supplier-pay').getByLabel('المبلغ (د.أ)',{exact:true}).fill('20');
  await page.getByTestId('go-live-supplier-pay').getByLabel('طريقة الدفع',{exact:true}).selectOption('cheque');
  const form=page.getByTestId('go-live-supplier-cheque').getByTestId('cheque-registration');
  await form.getByLabel('البنك',{exact:true}).fill('بنك الرصيد');await form.getByLabel('رقم الشيك',{exact:true}).fill('OPEN-001');
  await form.getByLabel('تاريخ الاستحقاق',{exact:true}).fill('2026-10-18');await form.getByRole('button',{name:'معاينة قبل التسجيل',exact:true}).click();
  await expect(form.getByTestId('cheque-preview')).toContainText('20.000');await audit(page);
  await form.getByRole('button',{name:'تأكيد تسجيل الشيك',exact:true}).click();await expect(page.getByTestId('go-live-supplier-cheque')).toHaveCount(0);
  expect(calls).toEqual([
    {name:'preview_supplier_cheque_v1',args:{p_supplier_id:'s1',p_amount_in_minor_units:20000,p_claim_id:null,p_opening_only:true}},
    {name:'issue_supplier_cheque_v1',args:{p_supplier_id:'s1',p_branch_id:'golive-branch',p_amount_in_minor_units:20000,p_claim_id:null,p_opening_only:true,
      p_bank_name:'بنك الرصيد',p_cheque_number:'OPEN-001',p_due_date:'2026-10-18',p_notes:null,p_idempotency_key:expect.stringMatching(/^cheque-/u)}},
  ]);
  expect(await page.evaluate(()=>window.__goLiveCalls.filter(c=>c.name==='pay_supplier_opening_balance_v1'))).toEqual([]);
});
for(const theme of ['light','dark'])for(const width of [390,820,1440])test(`supplier legacy cheque ${theme} ${width}:registered lifecycle,selected PO preserved,no direct payment`,async({page})=>{
  await page.setViewportSize({width,height:1100});const requests:{name:string;args:Record<string,unknown>}[]=[];
  await page.route('**/rpc/record_supplier_payment',route=>{requests.push({name:'record_supplier_payment',args:route.request().postDataJSON()});return route.fulfill({json:{success:true}});});
  await page.route('**/rpc/preview_supplier_cheque_v1',route=>{requests.push({name:'preview_supplier_cheque_v1',args:route.request().postDataJSON()});
    return route.fulfill({json:{balanceInMinorUnits:600000,allocatedInMinorUnits:1001}});});
  await page.route('**/rpc/issue_supplier_cheque_v1',route=>{requests.push({name:'issue_supplier_cheque_v1',args:route.request().postDataJSON()});
    return route.fulfill({json:chequeResult({...chequeRows[1]!,supplier_id:poSupplier,branch_id:poBranch,amount_in_minor_units:1001})});});
  await page.goto(`/e2e/package-f-purchasing-harness.html?view=payment&theme=${theme}`);
  const dialog=page.getByRole('dialog',{name:'دفعة المورد',exact:true});
  await expect(dialog.getByRole('combobox',{name:'المورد',exact:true})).toHaveValue(poSupplier);
  await dialog.getByRole('combobox',{name:'طريقة الدفع',exact:true}).selectOption('check');
  const form=dialog.getByTestId('cheque-registration');await expect(form).toBeVisible();
  await form.getByLabel('البنك',{exact:true}).fill('بنك المورد');await form.getByLabel('رقم الشيك',{exact:true}).fill('SUPPLIER-001');
  await form.getByLabel('تاريخ الاستحقاق',{exact:true}).fill('2026-10-18');await form.getByLabel('مبلغ الشيك (د.أ)',{exact:true}).fill('1.001');
  await form.getByRole('button',{name:'معاينة قبل التسجيل',exact:true}).click();await expect(form.getByTestId('cheque-preview')).toBeVisible();await audit(page);
  await form.getByRole('button',{name:'تأكيد تسجيل الشيك',exact:true}).click();await expect(dialog).toBeHidden();
  expect(requests).toEqual([
    {name:'preview_supplier_cheque_v1',args:{p_supplier_id:poSupplier,p_amount_in_minor_units:1001,p_claim_id:null,p_purchase_order_id:purchaseOrders[1]!.id}},
    {name:'issue_supplier_cheque_v1',args:{p_supplier_id:poSupplier,p_branch_id:poBranch,p_amount_in_minor_units:1001,p_claim_id:null,
      p_purchase_order_id:purchaseOrders[1]!.id,p_bank_name:'بنك المورد',p_cheque_number:'SUPPLIER-001',p_due_date:'2026-10-18',p_notes:null,p_idempotency_key:expect.stringMatching(/^cheque-/u)}},
  ]);
});
for(const role of ['admin','accountant'])test(`supplier cheque role ${role}:legacy option disabled,other methods unchanged`,async({page})=>{
  await page.goto(`/e2e/package-f-purchasing-harness.html?view=payment&role=${role}`);
  const method=page.getByRole('combobox',{name:'طريقة الدفع',exact:true});
  await expect(method.locator('option[value="check"]')).toBeDisabled();
  for(const value of ['cash','bank_transfer','card'])await expect(method.locator(`option[value="${value}"]`)).toBeEnabled();
  await expect(page.getByTestId('cheque-registration')).toHaveCount(0);
});
for(const theme of ['light','dark'])for(const width of [390,1440])test(`POS cheque ${theme} ${width}:existing cart retained,server balance replaces stale debt,not a sale`,async({page})=>{
  await page.setViewportSize({width,height:width===390?844:1125});const calls=await writes(page);
  const customerId='55555555-5555-4555-8555-555555555555';const unexpectedSales:string[]=[];
  page.on('request',request=>{if(request.url().includes('/rpc/create_pos_sale'))unexpectedSales.push(request.url());});
  await page.route('**/rpc/preview_customer_cheque_v1',route=>route.fulfill({json:{totalOutstandingInMinorUnits:45000,openingOutstandingInMinorUnits:0,
    ordersOutstandingInMinorUnits:45000,compensationOutstandingInMinorUnits:0,exceedsBalance:false,
    parts:[{kind:'order',id:'existing-order',reference:'POS-EXISTING',debtAt:'2026-07-01T09:00:00Z',outstandingInMinorUnits:45000,
      allocateInMinorUnits:1001,remainingAfterInMinorUnits:43999}]}}));
  await page.route('**/rpc/receive_customer_cheque_v1',route=>{
    const args:Record<string,unknown>=route.request().postDataJSON();calls.push({name:'receive_customer_cheque_v1',args});
    return route.fulfill({json:{...chequeResult({...chequeRows[0]!,customer_id:customerId,branch_id:posFixtureIds.branch,amount_in_minor_units:1001}),customerBalanceInMinorUnits:43999}});
  });
  await page.goto('/e2e/package-f-pos-harness.html?theme='+theme);
  await page.getByRole('radio',{name:'طرد',exact:true}).click();
  await page.locator(`[data-pos-product-card="${posFixtureProducts[0]!.id}"]`).click();
  if(width===390)await page.getByRole('button',{name:'مراجعة السلة والعميل',exact:true}).click();
  await page.getByRole('combobox',{name:'اختيار العميل',exact:true}).selectOption(customerId);
  await expect(page.getByTestId('pos-workbench')).toContainText('45.000');
  await page.getByRole('button',{name:'استلام شيك من العميل',exact:true}).click();const form=page.getByTestId('cheque-registration');
  await form.getByLabel('البنك',{exact:true}).fill('بنك العميل');await form.getByLabel('رقم الشيك',{exact:true}).fill('POS-CHEQUE-001');
  await form.getByLabel('تاريخ الاستحقاق',{exact:true}).fill('2026-10-18');await form.getByLabel('مبلغ الشيك (د.أ)',{exact:true}).fill('1.001');
  await form.getByRole('button',{name:'معاينة قبل التسجيل',exact:true}).click();await expect(form.getByTestId('cheque-preview')).toContainText('45.000');
  await audit(page);await form.getByRole('button',{name:'تأكيد تسجيل الشيك',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'استلام شيك عميل',exact:true})).toBeHidden();
  await expect(page.getByTestId('pos-workbench')).toContainText('43.999');await expect(page.getByTestId('pos-workbench')).not.toContainText('45.000');
  await expect(page.locator('[data-testid="pos-complete-sale"]:visible')).toContainText('21.600');
  expect(unexpectedSales).toEqual([]);expect(calls).toEqual([{name:'receive_customer_cheque_v1',args:{p_customer_id:customerId,p_branch_id:posFixtureIds.branch,
    p_bank_name:'بنك العميل',p_cheque_number:'POS-CHEQUE-001',p_due_date:'2026-10-18',p_amount_in_minor_units:1001,p_notes:null,p_idempotency_key:expect.stringMatching(/^cheque-/u)}}]);
});
async function audit(page:Page){
  for(const dialog of await page.getByRole('dialog').all())if(await dialog.getAttribute('data-state')!==null)await expect(dialog).toHaveAttribute('data-state','open');
  await checkLayout(page,page.locator('body'));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.locator('body')).not.toContainText(/[٠-٩]/u);
  const result=await analyzePackageFAccessibility(page,new AxeBuilder({page}));
  expect(result.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
}
async function writes(page:Page){
  const calls:{name:string;args:Record<string,unknown>}[]=[];
  await page.route('**/rest/v1/rpc/*',async route=>{
    const name=new URL(route.request().url()).pathname.split('/').at(-1)!;
    const supported=['receive_customer_cheque_v1','issue_supplier_cheque_v1','return_deferred_cheque_v1','cancel_deferred_cheque_v1',
      'clear_deferred_cheque_v1','endorse_customer_cheque_v1','pay_supplier_cheque_claim_v1'];
    if(!supported.includes(name))return route.fallback();
    const args:Record<string,unknown>=route.request().postDataJSON();calls.push({name,args});
    if(name==='pay_supplier_cheque_claim_v1')return route.fulfill({json:{success:true,idempotentReplay:false,paymentId:'fixture-payment'}});
    const row=structuredClone(chequeRows.find(c=>c.id===args.p_cheque_id)??chequeRows[0]!);
    const status:ChequeFixtureRow['status']=name==='cancel_deferred_cheque_v1'?'cancelled':name==='return_deferred_cheque_v1'?'returned':
      name==='clear_deferred_cheque_v1'?'cleared':name==='endorse_customer_cheque_v1'?'endorsed':'pending';
    row.status=status;if(args.p_cheque_id){row.version++;await page.evaluate(({id,status})=>window.__chequeFixture.transition(id,status),{id:String(args.p_cheque_id),status});}
    if(args.p_cheque_number)row.cheque_number=String(args.p_cheque_number);
    if(args.p_amount_in_minor_units)row.amount_in_minor_units=Number(args.p_amount_in_minor_units);
    if(name==='issue_supplier_cheque_v1'){row.direction='outgoing';row.customer_id=null;row.supplier_id=chequeSupplier;}
    return route.fulfill({json:chequeResult(row)});
  });return calls;
}
for(const theme of ['light','dark'])for(const width of [390,820,1440])test(`cheques ${theme} ${width}:states,details,confirmation,layout and accessibility`,async({page})=>{
  await page.setViewportSize({width,height:width<1024?844:1100});const calls=await writes(page);await page.goto(url('theme='+theme));
  await expect(page.getByRole('heading',{name:'الشيكات',exact:true})).toBeVisible();
  await expect(page.getByTestId('cheques-workbench')).toContainText('150.000');await audit(page);
  await page.getByRole('button',{name:'تفاصيل الشيك 0000123456789',exact:true}).click();
  const detail=page.getByTestId('cheque-detail');await expect(detail).toContainText('100.000');await audit(page);
  await detail.getByRole('button',{name:'إلغاء تسجيل خاطئ',exact:true}).click();
  const question=page.getByRole('dialog',{name:'إلغاء تسجيل خاطئ',exact:true});await expect(question).toContainText('لا عكس للدفعة الأصلية، ولا وسم شيك راجع');
  await expect(question.getByRole('button',{name:'تأكيد العملية'})).toBeDisabled();
  await question.getByLabel('السبب الإلزامي').fill('تسجيل خاطئ بعد مرتجع مسوّى');await audit(page);
  await question.getByRole('button',{name:'تأكيد العملية'}).click();
  await expect(question).toBeHidden();
  await expect(detail).toContainText('ملغى — تسجيل خاطئ');
  expect(calls).toEqual([{name:'cancel_deferred_cheque_v1',args:{p_cheque_id:chequeRows[0]!.id,p_expected_version:1,
    p_reason:'تسجيل خاطئ بعد مرتجع مسوّى',p_idempotency_key:expect.stringMatching(/^cheque-/u)}}]);
  await expect(detail.getByRole('button',{name:'شيك راجع',exact:true})).toHaveCount(0);await audit(page);
});
for(const theme of ['light','dark'])test(`cashier cheque collection ${theme}:preview then exact integer-fils payload`,async({page})=>{
  await page.setViewportSize({width:390,height:844});const calls=await writes(page);await page.goto(url(`theme=${theme}&role=cashier&view=receive`));
  const form=page.getByTestId('cheque-registration');
  await form.getByLabel('البنك',{exact:true}).fill('بنك الاختبار');await form.getByLabel('رقم الشيك',{exact:true}).fill('000099');
  await form.getByLabel('تاريخ الاستحقاق',{exact:true}).fill('2026-10-18');await form.getByLabel('مبلغ الشيك (د.أ)',{exact:true}).fill('1.001');
  await form.getByRole('button',{name:'معاينة قبل التسجيل',exact:true}).click();await expect(form.getByTestId('cheque-preview')).toContainText('1.001');
  expect(calls).toEqual([]);await audit(page);
  await form.getByRole('button',{name:'تأكيد تسجيل الشيك',exact:true}).click();await expect.poll(()=>calls.length).toBe(1);
  expect(calls[0]).toEqual({name:'receive_customer_cheque_v1',args:{p_customer_id:chequeCustomer,p_branch_id:chequeBranch,p_bank_name:'بنك الاختبار',
    p_cheque_number:'000099',p_due_date:'2026-10-18',p_amount_in_minor_units:1001,p_notes:null,p_idempotency_key:expect.stringMatching(/^cheque-/u)}});
});
for(const theme of ['light','dark'])test(`cheque claim ${theme}:supplier standalone payment and statement null-order evidence`,async({page})=>{
  await page.setViewportSize({width:390,height:844});const calls=await writes(page);await page.goto(url('theme='+theme));
  await page.getByRole('button',{name:'تفاصيل الشيك RET-10502',exact:true}).click();await page.getByRole('button',{name:'سداد قيد المورد',exact:true}).click();
  const dialog=page.getByRole('dialog').last();await dialog.getByLabel('المبلغ (د.أ)',{exact:true}).fill('12.345');
  await dialog.getByLabel('طريقة الدفع',{exact:true}).selectOption('bank_transfer');await dialog.getByLabel('المرجع',{exact:true}).fill('BANK-123');await audit(page);
  await dialog.getByRole('button',{name:'تأكيد السداد',exact:true}).click();await expect.poll(()=>calls.length).toBe(1);
  expect(calls[0]).toEqual({name:'pay_supplier_cheque_claim_v1',args:{p_claim_id:chequeClaim,p_branch_id:chequeBranch,p_amount_in_minor_units:12345,
    p_payment_method:'bank_transfer',p_reference_number:'BANK-123',p_notes:'سداد قيد شيك مستقل',p_idempotency_key:expect.stringMatching(/^cheque-/u)}});
  await page.goto(url(`theme=${theme}&view=statement`));const statement=page.getByTestId('customer-statement');
  await expect(statement.getByTestId('statement-closing')).toContainText('100.000');await expect(statement).toContainText('إلغاء تسجيل شيك');
  await expect(statement).toContainText('تسجيل خاطئ بلا عكس للدفعة الأصلية');await expect(statement).toContainText('50.000');await audit(page);
});
test('cashier cannot open the owner/manager cheque page',async({page})=>{
  await page.goto(url('role=cashier'));await expect(page.getByRole('heading',{name:'الشيكات',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'إصدار شيك',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'استلام شيك',exact:true})).toHaveCount(0);
});

for(const theme of ['light','dark'])test(`cheque supplier claim ${theme}:existing drawer shortfall confirmation warns,never changes payload`,async({page})=>{
  await page.setViewportSize({width:390,height:844});const calls=await writes(page);await page.goto(url('theme='+theme+'&drawer=low'));
  await page.getByRole('button',{name:'تفاصيل الشيك RET-10502',exact:true}).click();await page.getByRole('button',{name:'سداد قيد المورد',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'سداد قيد ذمة المورد',exact:true});await dialog.getByLabel('المبلغ (د.أ)',{exact:true}).fill('12.345');
  await dialog.getByRole('button',{name:'تأكيد السداد',exact:true}).click();await expect(dialog.getByTestId('drawer-shortfall-warning')).toContainText('بالدرج 5.000');
  expect(calls).toEqual([]);await audit(page);await dialog.getByRole('button',{name:'تأكيد السداد',exact:true}).click();
  await expect.poll(()=>calls.length).toBe(1);expect(calls[0]).toEqual({name:'pay_supplier_cheque_claim_v1',args:{p_claim_id:chequeClaim,p_branch_id:chequeBranch,
    p_amount_in_minor_units:12345,p_payment_method:'cash',p_reference_number:null,p_notes:'سداد قيد شيك مستقل',p_idempotency_key:expect.stringMatching(/^cheque-/u)}});
});

for(const theme of ['light','dark'])test(`cheques ${theme}:endorse and bounce atomically, clear outgoing, issue exact payload`,async({page})=>{
  await page.setViewportSize({width:390,height:844});const calls=await writes(page);await page.goto(url('theme='+theme));
  await page.getByRole('button',{name:'تفاصيل الشيك 0000123456789',exact:true}).click();
  const detail=page.getByTestId('cheque-detail');
  await detail.getByRole('button',{name:'تجيير لمورد',exact:true}).click();
  const endorse=page.getByRole('dialog',{name:'تجيير الشيك لمورد',exact:true});
  await expect(endorse.getByRole('button',{name:'تأكيد العملية'})).toBeDisabled();
  await endorse.getByLabel('المورد',{exact:true}).selectOption(chequeSupplier);await audit(page);
  await endorse.getByRole('button',{name:'تأكيد العملية'}).click();await expect(endorse).toBeHidden();
  await expect(detail).toContainText('مُجيّر لمورد');await expect(detail.getByRole('button',{name:'إلغاء تسجيل خاطئ',exact:true})).toHaveCount(0);
  await detail.getByRole('button',{name:'شيك راجع',exact:true}).click();
  const bounce=page.getByRole('dialog',{name:'تسجيل شيك راجع',exact:true});
  await expect(bounce).toContainText('سيعود دين العميل وذمة المورد معاً في معاملة واحدة');
  await bounce.getByLabel('السبب الإلزامي').fill('أعاد البنك الشيك المُجيّر');await audit(page);
  await bounce.getByRole('button',{name:'تأكيد العملية'}).click();await expect(bounce).toBeHidden();await expect(detail).toContainText('راجع');
  const detailDialog=page.getByRole('dialog',{name:'تفاصيل الشيك',exact:true});await detailDialog.getByRole('button',{name:'إغلاق',exact:true}).click();await expect(detailDialog).toBeHidden();
  await page.getByRole('button',{name:'تفاصيل الشيك OUT-10500',exact:true}).click();
  await detail.getByRole('button',{name:'صُرف',exact:true}).click();
  const clear=page.getByRole('dialog',{name:'تأكيد صرف الشيك',exact:true});await expect(clear).toContainText('لا يسجل حركة جديدة على الدرج');
  await clear.getByRole('button',{name:'تأكيد العملية'}).click();await expect(clear).toBeHidden();await expect(detail.getByText('صُرف',{exact:true})).toBeVisible();
  await detailDialog.getByRole('button',{name:'إغلاق',exact:true}).click();await expect(detailDialog).toBeHidden();
  await page.getByRole('button',{name:'إصدار شيك',exact:true}).click();const form=page.getByTestId('cheque-registration');
  await form.getByLabel('المورد',{exact:true}).selectOption(chequeSupplier);
  await form.getByLabel('البنك',{exact:true}).fill('بنك المورد');await form.getByLabel('رقم الشيك',{exact:true}).fill('000200');
  await form.getByLabel('تاريخ الاستحقاق',{exact:true}).fill('2026-10-18');await form.getByLabel('مبلغ الشيك (د.أ)',{exact:true}).fill('23.007');
  await form.getByRole('button',{name:'معاينة قبل التسجيل',exact:true}).click();await expect(form.getByTestId('cheque-preview')).toContainText('23.007');await audit(page);
  await form.getByRole('button',{name:'تأكيد تسجيل الشيك',exact:true}).click();await expect.poll(()=>calls.length).toBe(4);
  const key=expect.stringMatching(/^cheque-/u);
  expect(calls).toEqual([
    {name:'endorse_customer_cheque_v1',args:{p_cheque_id:chequeRows[0]!.id,p_supplier_id:chequeSupplier,p_expected_version:1,p_idempotency_key:key}},
    {name:'return_deferred_cheque_v1',args:{p_cheque_id:chequeRows[0]!.id,p_expected_version:2,p_reason:'أعاد البنك الشيك المُجيّر',p_idempotency_key:key}},
    {name:'clear_deferred_cheque_v1',args:{p_cheque_id:chequeRows[1]!.id,p_expected_version:1,p_idempotency_key:key}},
    {name:'issue_supplier_cheque_v1',args:{p_supplier_id:chequeSupplier,p_branch_id:chequeBranch,p_bank_name:'بنك المورد',p_cheque_number:'000200',
      p_due_date:'2026-10-18',p_amount_in_minor_units:23007,p_notes:null,p_idempotency_key:key,p_claim_id:null}},
  ]);
});
