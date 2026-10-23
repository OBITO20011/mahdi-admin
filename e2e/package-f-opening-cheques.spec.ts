import AxeBuilder from '@axe-core/playwright';
import {test,expect,type Page} from './isolated-test';
import {checkLayout} from './package-f-layout';
import {analyzePackageFAccessibility} from './package-f-accessibility';
import {writeXlsx,XLSX_MIME} from '../src/lib/xlsx';
import {openingChequeTemplateRows} from '../src/features/goLive/openingChequesImport';
import {chooseOpeningMainBranch} from './opening-cheque-readiness';

const url=(theme:string)=>`/e2e/package-f-go-live-harness.html?seeded=1&theme=${theme}`;
const card=(page:Page)=>page.getByTestId('go-live-card-cheques');
const branch=chooseOpeningMainBranch;
async function audit(page:Page){await checkLayout(page,card(page));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const result=await analyzePackageFAccessibility(page,new AxeBuilder({page}).include('[data-testid="go-live-page"]'));expect(result.violations.filter(v=>['serious','critical'].includes(v.impact??''))).toEqual([]);
 await expect(card(page)).not.toContainText(/[٠-٩]/u);
}
for(const theme of ['light','dark'])for(const width of [390,820,1440])test(`Opening cheques ${theme} ${width}:manual preview,zero-effect contract,keyboard and lock`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto(url(theme));await branch(page);
 await card(page).getByRole('button',{name:'إدخال يدوي',exact:true}).click();const form=page.getByTestId('go-live-cheques-manual');
 await form.getByRole('combobox',{name:'العميل',exact:true}).selectOption('c1');await form.getByLabel('البنك',{exact:true}).fill('بنك الفحص');
 await form.getByLabel('رقم الشيك',{exact:true}).fill('000123');await form.getByLabel('تاريخ الاستحقاق',{exact:true}).fill('2026-12-01');
 await form.getByLabel('المبلغ (د.أ)',{exact:true}).fill('10.001');await form.getByRole('button',{name:'معاينة قبل الحفظ'}).click();
 const preview=page.getByTestId('go-live-cheques-preview');await expect(preview).toContainText('125.500');await expect(preview).toContainText('10.001');await expect(preview).toContainText('135.501');
 const save=preview.getByRole('button',{name:'حفظ الشيكات للمتابعة فقط'});await expect(save).toBeDisabled();await preview.getByRole('checkbox').check();await save.focus();await expect(save).toBeFocused();await audit(page);await save.press('Enter');
 await expect(card(page).getByRole('status')).toContainText('لم يتغير أي رصيد');await expect(card(page)).toContainText('000123');
 const requests=await page.evaluate(()=>(window as Window&{__goLiveCalls:{name:string;args:Record<string,unknown>}[]}).__goLiveCalls);
 const registrations=requests.filter(r=>r.name==='record_go_live_cheques_v1');expect(registrations).toHaveLength(1);
 expect(registrations[0].args.p_rows).toEqual([{sourceRow:1,direction:'incoming',initial_status:'pending',bank_name:'بنك الفحص',cheque_number:'000123',due_date:'2026-12-01',amount_in_minor_units:'10001',cheque_date:'',original_debt_date:'',notes:'',customer_id:'c1'}]);
 expect(requests.filter(r=>['receive_customer_cheque_v1','issue_supplier_cheque_v1','collect_customer_payment_v1'].includes(r.name))).toEqual([]);
 const finish=page.getByTestId('go-live-finish');await finish.getByRole('button',{name:'إنهاء بداية التشغيل',exact:true}).click();await finish.getByRole('textbox').fill('إنهاء بداية التشغيل');await finish.getByRole('button',{name:'تأكيد الإنهاء النهائي'}).click();
 await expect(card(page).getByRole('button',{name:'إدخال يدوي',exact:true})).toBeDisabled();await expect(card(page)).toContainText('000123');await audit(page);
});
for(const theme of ['light','dark'])test(`Opening cheque Excel ${theme}:endorsed/outgoing,exact preview and manual search cannot submit hidden party`,async({page})=>{
 await page.setViewportSize({width:390,height:900});await page.goto(url(theme));await branch(page);
 await card(page).getByRole('button',{name:'استيراد من Excel'}).click();const rows=openingChequeTemplateRows();rows[1]=['وارد','مجيّر','بنك الفحص','0007','2026-12-01','100.000','محمد العلي','0791111111','','شركة التوزيع الأولى','2026-10-01','',''];
 rows.push(['صادر','قيد الانتظار','بنك الفحص','0008','2026-12-01','50.000','','','شركة التوزيع الأولى','','','','']);
 await card(page).locator('input[type="file"]').setInputFiles({name:'cheques.xlsx',mimeType:XLSX_MIME,buffer:Buffer.from(writeXlsx([{name:'البيانات',rows}]))});
 const preview=page.getByTestId('go-live-cheques-preview');await expect(preview).toContainText('225.500');await expect(preview).toContainText('1,650.000');await preview.getByRole('checkbox').check();await preview.getByRole('button',{name:'حفظ الشيكات للمتابعة فقط'}).click();
 await expect(card(page)).toContainText('0007');await expect(card(page)).toContainText('0008');await audit(page);
 await card(page).getByRole('button',{name:'إدخال يدوي',exact:true}).click();const form=page.getByTestId('go-live-cheques-manual');await form.getByRole('combobox',{name:'العميل',exact:true}).selectOption('c1');await form.getByLabel('بحث العميل').fill('سارة');
 await expect(form.getByRole('combobox',{name:'العميل',exact:true})).toHaveValue('');
});
