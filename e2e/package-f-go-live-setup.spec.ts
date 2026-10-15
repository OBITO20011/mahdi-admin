import AxeBuilder from '@axe-core/playwright';
import {analyzePackageFAccessibility} from './package-f-accessibility';
import {checkLayout as checkClipping} from './package-f-layout';
import {test,expect,type Page} from './isolated-test';
import {readXlsxFirstSheet,writeXlsx,XLSX_MIME} from '../src/lib/xlsx';
import {GO_LIVE_COLUMNS,templateRows} from '../src/features/goLive/goLiveImport';

const url=(query='')=>'/e2e/package-f-go-live-harness.html?'+query;
const page$=(page:Page)=>page.getByTestId('go-live-page');
const xlsx=(name:string,rows:string[][])=>({name,mimeType:XLSX_MIME,buffer:Buffer.from(writeXlsx([{name:'البيانات',rows}]))});
type Calls={name:string;args:Record<string,unknown>}[];
const calls=(page:Page)=>page.evaluate(()=>(window as unknown as {__goLiveCalls:Calls}).__goLiveCalls);

async function checkLayout(page:Page){
  const root=page$(page);
  await checkClipping(page,root);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(root).not.toContainText(/[٠-٩]/u);
  // Touch targets: every visible control in the page is at least 44px tall.
  const small=await root.evaluate(element=>Array.from(element.querySelectorAll('button,input:not([type="file"]),select,label[for]'))
    .filter(control=>{const box=control.getBoundingClientRect();return box.width>0&&box.height>0&&!control.classList.contains('sr-only')&&!(control.tagName==='LABEL'&&!control.querySelector('svg'));})
    .filter(control=>control.getBoundingClientRect().height<43.5).map(control=>control.outerHTML.slice(0,90)));
  expect(small).toEqual([]);
}
async function axe(page:Page){
  const result=await analyzePackageFAccessibility(page,new AxeBuilder({page}).include('[data-testid="go-live-page"]')
    .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']));
  expect(result.violations.filter(v=>v.impact==='serious'||v.impact==='critical')
    .map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
}

for(const theme of ['light','dark'] as const)for(const width of [390,820,1440]){
  test(`بداية التشغيل ${theme} ${width}: أربع بطاقات بلا تمرير أفقي ولا قص، وaxe نظيف`,async({page})=>{
    await page.setViewportSize({width,height:width===390?844:900});
    await page.goto(url(`theme=${theme}&seeded=1`));
    for(const kind of ['products','stock','customers','suppliers'])await expect(page.getByTestId(`go-live-card-${kind}`)).toBeVisible();
    await expect(page.getByRole('heading',{name:'بداية التشغيل',exact:true})).toBeVisible();
    await expect(page.getByTestId('go-live-card-customers')).toContainText('125.500');
    await checkLayout(page);await axe(page);
    // Open panels are part of the audited surface too.
    await page.getByTestId('go-live-card-customers').getByRole('button',{name:'استيراد من Excel'}).click();
    await page.getByTestId('go-live-card-suppliers').getByRole('button',{name:'إدخال يدوي'}).click();
    await expect(page.getByTestId('go-live-manual-suppliers')).toBeVisible();
    await page.getByTestId('go-live-finish').getByRole('button',{name:'إنهاء بداية التشغيل'}).click();
    await checkLayout(page);await axe(page);
  });
}

test('القالب القابل للتنزيل xlsx بعناوين الأعمدة ومثال',async({page})=>{
  await page.goto(url('theme=light'));
  await page.getByTestId('go-live-card-suppliers').getByRole('button',{name:'استيراد من Excel'}).click();
  const [download]=await Promise.all([page.waitForEvent('download'),
    page.getByTestId('go-live-import-suppliers').getByRole('button',{name:'تنزيل القالب'}).click()]);
  expect(download.suggestedFilename()).toBe('go-live-suppliers-template.xlsx');
  const path=await download.path();const {readFile}=await import('node:fs/promises');
  expect(await readXlsxFirstSheet(await readFile(path))).toEqual(templateRows('suppliers'));
});

test('استيراد ديون العملاء: أخطاء بالعربي لكل سطر تمنع الحفظ، ثم معاينة وحفظ على دفعات بلا تكرار',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(url('theme=light'));
  const card=page.getByTestId('go-live-card-customers');
  await card.getByRole('button',{name:'استيراد من Excel'}).click();
  const header=GO_LIVE_COLUMNS.customers.map(c=>c.header);
  const input=page.getByTestId('go-live-import-customers').locator('input[type="file"]');
  await input.setInputFiles(xlsx('bad.xlsx',[header,['0791111111','محمد','12.5','2025-01-10',''],
    ['0790000000','محمد العلي','5','2025-01-10',''],['0792222222','سارة','0','2025-01-10',''],['0792222222','سارة','4','2099-01-01','']]));
  const preview=page.getByTestId('go-live-preview-customers');
  await expect(preview).toContainText('أسطر تحتاج تصحيحاً: 3');
  // Decision 7: same name with another phone is a blocking warning, never a silent duplicate.
  await expect(preview).toContainText('السطر 3 (تحذير): تحذير: يوجد عميل باسم مطابق أو مشابه وهاتف مختلف (محمد العلي — 0791111111)');
  await expect(preview).toContainText('السطر 4: مبلغ الدين يجب أن يكون أكبر من صفر');
  await expect(preview).toContainText('السطر 5: تاريخ الدين الأصلي لا يمكن أن يكون في المستقبل');
  await expect(preview.getByRole('button',{name:/^حفظ/u})).toBeDisabled();
  expect((await calls(page)).filter(c=>c.name==='record_customer_opening_balances_v1'&&!c.args.p_dry_run)).toEqual([]);

  const rows=[header,...Array.from({length:205},(_,i)=>[i%2?'0791111111':'0792222222','',`${i+1}.250`,'2025-02-01','']),
    ['0793333333','زبون جديد','7','2025-02-01','']];
  await input.setInputFiles(xlsx('good.xlsx',rows));
  await expect(preview).toContainText('كل الأسطر صالحة');
  await expect(preview).toContainText('206');
  const newParties=page.getByTestId('go-live-new-parties-customers');
  await expect(newParties).toContainText('سيُضاف 1 عميلاً جديداً');
  await expect(newParties).toContainText('زبون جديد');
  const saveAll=preview.getByRole('button',{name:'حفظ 206 سطر'});
  await expect(saveAll).toBeDisabled(); // new customers need an explicit confirmation
  await newParties.getByLabel('أؤكد إضافتهم كجدد في النظام').check();
  await saveAll.click();
  await expect(page.getByTestId('go-live-import-customers')).toContainText('تم الحفظ بنجاح: 206 سطر في 2 دفعة.');
  const saves=(await calls(page)).filter(c=>c.name==='record_customer_opening_balances_v1'&&!c.args.p_dry_run);
  expect(saves.map(c=>(c.args.p_rows as unknown[]).length)).toEqual([200,6]);
  expect(saves.every(c=>c.args.p_confirm_new_customers===true)).toBe(true);
  expect(new Set(saves.map(c=>c.args.p_idempotency_key)).size).toBe(2);
  expect((saves[0].args.p_rows as Record<string,unknown>[])[0]).toEqual({customer_phone:'0792222222',amount_in_minor_units:'1250',original_debt_date:'2025-02-01'});
  await expect(card).toContainText('عملاء لهم دين سابق');
  await checkLayout(page);await axe(page);
});

test('استيراد البضاعة: المطابقة بالباركود/SKU والطرد والحبات، والمنتج الأساسي للنكهات مرفوض',async({page})=>{
  await page.goto(url('theme=dark'));
  await page.getByTestId('go-live-card-stock').getByRole('button',{name:'استيراد من Excel'}).click();
  const header=GO_LIVE_COLUMNS.stock.map(c=>c.header);
  await page.getByTestId('go-live-import-stock').locator('input[type="file"]').setInputFiles(xlsx('stock.xlsx',
    [header,['6281000000017','','3','5'],['FL-MASTER','','1',''],['FL-A','','2','5']]));
  const preview=page.getByTestId('go-live-preview-stock');
  await expect(preview).toContainText('السطر 3: لا يوجد صنف قابل للجرد');
  await expect(preview).toContainText('السطر 4: الحبات الإضافية يجب أن تكون أقل من محتوى الطرد (5)');
  await page.getByTestId('go-live-import-stock').locator('input[type="file"]').setInputFiles(xlsx('stock.xlsx',
    [header,['6281000000017','','3','5'],['fl-a','','2','4']]));
  await expect(preview).toContainText('91');
  await preview.getByRole('button',{name:'حفظ 2 سطر'}).click();
  await expect(page.getByTestId('go-live-import-stock')).toContainText('تم الحفظ بنجاح: 2 سطر');
  const apply=(await calls(page)).filter(c=>c.name==='apply_inventory_opening_setup');
  expect(apply).toHaveLength(1);
  expect(apply[0].args.p_rows).toEqual([{productId:'p1',packageCount:3,looseUnits:5},{productId:'p2',packageCount:2,looseUnits:4}]);
  expect(String(apply[0].args.p_idempotency_key)).toMatch(/^golive-stock-/u);
});

test('إدخال مورد يدوياً بالاتجاه، وعكس رصيد بسبب، ثم الإنهاء يقفل الصفحة',async({page})=>{
  await page.setViewportSize({width:820,height:900});
  await page.goto(url('theme=light&seeded=1'));
  const card=page.getByTestId('go-live-card-suppliers');
  await card.getByRole('button',{name:'إدخال يدوي'}).click();
  const form=page.getByTestId('go-live-manual-suppliers');
  await form.getByLabel('المورد',{exact:true}).selectOption('s2');
  await form.getByLabel('الاتجاه').selectOption('advance');
  await form.getByLabel('المبلغ (د.أ)').fill('250.5');
  await form.getByLabel('التاريخ الأصلي').fill('2025-05-01');
  await form.getByRole('button',{name:'حفظ الرصيد'}).click();
  await expect(form).toContainText('تم حفظ الرصيد الافتتاحي.');
  await expect(card).toContainText('250.500');
  await expect(card.getByText('عليه',{exact:true})).toBeVisible();

  await card.getByRole('button',{name:'سداد رصيد سابق SOB-001001'}).click();
  const pay=page.getByTestId('go-live-supplier-pay');
  await expect(pay).toContainText('1,500.000');
  await pay.getByLabel('المبلغ (د.أ)').fill('100');
  await pay.getByRole('button',{name:'تأكيد السداد'}).click();
  await expect(pay).toHaveCount(0);
  const payment=(await calls(page)).find(c=>c.name==='pay_supplier_opening_balance_v1')!;
  expect(payment.args).toMatchObject({p_supplier_id:'s1',p_branch_id:'golive-branch',p_amount_in_minor_units:100000,p_payment_method:'cash'});

  const main=page.getByTestId('go-live-main-branch');
  await main.getByLabel('اختر الفرع الرئيسي').selectOption('golive-branch');
  await main.getByRole('button',{name:'حفظ الفرع'}).click();
  await expect(main.getByRole('button',{name:'حفظ الفرع'})).toBeDisabled();

  const customers=page.getByTestId('go-live-card-customers');
  await customers.getByRole('button',{name:'عكس الرصيد COB-001001'}).click();
  await customers.getByLabel('سبب العكس (يظهر في سجل التدقيق)').fill('إدخال مكرر');
  await customers.getByRole('button',{name:'تأكيد العكس'}).click();
  await expect(customers.getByText('معكوس')).toBeVisible();

  const finish=page.getByTestId('go-live-finish');
  await finish.getByRole('button',{name:'إنهاء بداية التشغيل'}).click();
  const confirm=finish.getByRole('button',{name:'تأكيد الإنهاء النهائي'});
  await expect(confirm).toBeDisabled();
  await finish.getByLabel(/للتأكيد اكتب/u).fill('إنهاء بداية التشغيل');
  await confirm.click();
  await expect(page.getByTestId('go-live-finished')).toContainText('تم إنهاء بداية التشغيل نهائياً');
  for(const button of await page$(page).getByRole('button',{name:/استيراد من Excel|إدخال يدوي/u}).all())await expect(button).toBeDisabled();
  // Decision 3: the owner may still reverse an entry with a reason after finish.
  await expect(page.getByRole('button',{name:'عكس الرصيد SOB-001001'})).toBeEnabled();
  await checkLayout(page);await axe(page);
});

test('الصفحة للمالك فقط',async({page})=>{
  await page.goto(url('theme=light&role=manager'));
  await expect(page.getByText('هذه الشاشة للمالك فقط')).toBeVisible();
  expect((await calls(page)).filter(c=>c.name.includes('go_live'))).toEqual([]);
});
