import AxeBuilder from '@axe-core/playwright';
import {expect,test,type Page} from './isolated-test';
import {checkLayout} from './package-f-layout';
import {analyzePackageFAccessibility} from './package-f-accessibility';
import {financialReport} from './package-f-financial.fixture';
import {cashIds} from './package-f-cash.fixture';
const base=process.env.ADMIN_BASE_URL??'http://127.0.0.1:4173';
const url=(query:string)=>`${base}/e2e/package-f-home-harness.html?${query}`;

for(const width of [390,1440])for(const theme of ['light','dark'])test(`201 collections/shift/damage ${width} ${theme}: exact money,RTL,layout,axe,print`,async({page})=>{
 await page.setViewportSize({width,height:1000});await page.goto(url(`collections&damage&theme=${theme}`));
 const home=page.getByTestId('dashboard-home'),kpis=page.getByTestId('home-kpis');
 await expect(kpis).toContainText('177.777');await expect(kpis).toContainText('123.456');await expect(kpis).toContainText('54.321');
 const flows=page.getByTestId('home-shift-flows');await flows.scrollIntoViewIfNeeded();
 for(const value of ['دفعات الموردين كاش','-91.234','سحوبات المالك','-44.321','إرجاع سحوبات المالك','5.123','679.868'])await expect(flows).toContainText(value);
 const damage=page.getByTestId('report-damage-losses');await damage.scrollIntoViewIfNeeded();
 for(const text of ['منها محتسب أصلاً','60.000','0.000','مرتجع زبون تالف نهائي'])await expect(damage).toContainText(text);
 await page.evaluate(()=>document.fonts.ready);await checkLayout(page,home);await checkLayout(page,damage);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const axe=await analyzePackageFAccessibility(page,new AxeBuilder({page}).include('[data-testid="dashboard-home"], [data-testid="report-damage-losses"]').withTags(['wcag2a','wcag2aa','wcag21aa']));
 expect(axe.violations.filter(v=>v.impact==='serious'||v.impact==='critical').map(v=>v.id)).toEqual([]);
 await page.emulateMedia({media:'print'});await expect(damage).toContainText('خصم إضافي من الربح');await expect(damage).toContainText('60.000');
});

test('201 collections empty success,missing capability,loading and error never share invented zero',async({page})=>{
 for(const [query,expected] of [['collections&zero','0.000'],['','تفصيل كاش / CliQ غير متاح'],['loading','جاري التحميل…'],['collections&error','تعذر تحميل المقبوض']]){
  await page.goto(url(query));const card=page.getByTestId('home-kpis');await expect(card).toContainText(expected);
  if(query!=='collections&zero')await expect(card).not.toContainText('177.777');
 }
});

const damageFixture={totalInMinorUnits:180000,additionalInMinorUnits:120000,alreadyIncludedInMinorUnits:60000,reasons:[
 {code:'shop_breakage',count:1,quantity:2,amountInMinorUnits:120000,alreadyIncludedInMinorUnits:0},
 {code:'customer_return_final',count:1,quantity:1,amountInMinorUnits:60000,alreadyIncludedInMinorUnits:60000},
]};
async function installReportReads(page:Page,damage:()=>unknown){
 const requests:Record<string,unknown>[]=[];
 await page.route('**/rest/v1/rpc/get_operational_business_report',route=>{
  requests.push(route.request().postDataJSON());const losses=damage();
  return route.fulfill({json:{...financialReport,sales:{...financialReport.sales,netProfitInMinorUnits:4303933,...(losses===undefined?{}:{damageLosses:losses})}}});
 });
 await page.route('**/rest/v1/rpc/get_aftercare_integrity_status',route=>route.fulfill({json:{status:'healthy',checkedAt:new Date().toISOString()}}));
 return requests;
}
for(const width of [390,1440])for(const theme of ['light','dark'])test(`201 full report ${width} ${theme}: real HTTP mapper,loss disclosure and print button`,async({page})=>{
 await page.setViewportSize({width,height:1000});const requests=await installReportReads(page,()=>damageFixture);
 await page.goto(`${base}/e2e/package-f-report201-harness.html?theme=${theme}`);
 const report=page.getByTestId('reports-screen'),damage=page.getByTestId('report-damage-losses');
 await expect(damage).toBeVisible();await expect(report).toContainText('4,303.933');
 for(const amount of ['180.000','120.000','60.000'])await expect(damage.locator('dl')).toContainText(amount);
 await expect(damage.locator('table')).toContainText('انكسر بالمحل');await expect(damage.locator('table')).toContainText('مرتجع زبون تالف نهائي');
 await expect(page.getByTestId('report-details')).not.toHaveAttribute('open','');
 await page.evaluate(()=>document.fonts.ready);await checkLayout(page,report);
 const axe=await analyzePackageFAccessibility(page,new AxeBuilder({page}));
 expect(axe.violations.filter(v=>v.impact==='serious'||v.impact==='critical').map(v=>v.id)).toEqual([]);
 expect(requests).toHaveLength(1);expect(Object.keys(requests[0]).sort()).toEqual(['p_branch_id','p_date_from','p_date_to']);expect(requests[0].p_branch_id).toBe(cashIds.branch);
 await page.evaluate(()=>{window.print=()=>{document.body.dataset.printCalls=String(Number(document.body.dataset.printCalls??0)+1);};});
 await page.getByRole('button',{name:'طباعة / PDF',exact:true}).click();
 await expect(page.locator('body')).toHaveAttribute('data-print-calls','1');await expect(page.getByTestId('report-details')).toHaveAttribute('open','');
 await page.emulateMedia({media:'print'});await expect(damage).toBeVisible();await expect(damage.getByText('منها محتسب أصلاً ضمن المرتجعات',{exact:true})).toBeVisible();
 await expect(page.locator('.operational-report-print')).toContainText('4,303.933');
});
test('201 full report distinguishes unsupported,empty and malformed damage reads',async({page})=>{
 let losses:unknown=undefined;await installReportReads(page,()=>losses);
 const open=()=>page.goto(`${base}/e2e/package-f-report201-harness.html`);
 await open();await expect(page.getByTestId('report-damage-losses')).toContainText('خسائر التلف غير متاحة');
 await expect(page.getByTestId('report-damage-losses')).not.toContainText('0.000');
 losses={totalInMinorUnits:0,additionalInMinorUnits:0,alreadyIncludedInMinorUnits:0,reasons:[]};
 await open();await expect(page.getByTestId('report-damage-losses')).toContainText('لا توجد خسائر تلف مسجلة');await expect(page.getByTestId('report-damage-losses')).toContainText('0.000');
 losses={...damageFixture,totalInMinorUnits:0};await open();
 await expect(page.getByText('بيانات خسائر التلف غير مكتملة. أعد تحميل التقرير.',{exact:true})).toBeVisible();await expect(page.locator('.operational-report-print')).toHaveCount(0);
});

for(const width of [390,1440])test(`208 keyed stock damage ${width}: four reasons,required other note and exact physical quantity`,async({page})=>{
 await page.setViewportSize({width,height:1000});
 let payload:Record<string,unknown>|undefined,calls=0,legacyCalls=0;
 await page.route('**/rest/v1/rpc/adjust_inventory_stock',route=>{legacyCalls++;return route.abort();});
 await page.route('**/rest/v1/rpc/get_supplier_replacement_options_v1',route=>route.fulfill({json:{contractVersion:208,products:[{id:'88888888-8888-4888-8888-000000000001',name:'عصير برتقال 250مل',sku:'INV-0001',baseUnitName:'باكيت',unitsPerParcel:24}],suppliers:[],warehouses:[{id:'88888888-8888-4888-8888-000000000099',name:'المستودع الرئيسي',branchId:'fixture-branch'}],lastSuppliers:[]}}));
 await page.route('**/rest/v1/rpc/preview_supplier_replacement_v1',route=>route.fulfill({json:{contractVersion:208,action:'shop_damage',eligible:true,blockedReason:null,quantity:3,availableQuantity:100}}));
 await page.route('**/rest/v1/rpc/execute_supplier_replacement_v1',async route=>{calls++;payload=route.request().postDataJSON();await route.fulfill({status:400,json:{message:'رفض اختبار معزول بلا كتابة',code:'P0001'}});});
 await page.goto(`${base}/e2e/package-f-products-harness.html?view=stock&theme=light`);
 const dialog=page.getByRole('dialog',{name:'تعديل المخزون'});await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:'خصم من المخزون (-)',exact:true}).click();
 const reason=dialog.getByRole('combobox',{name:'سبب التلف',exact:true});for(const name of ['انكسر بالمحل','انتهت الصلاحية','تلف تخزين','أخرى'])await expect(reason.getByRole('option',{name,exact:true})).toHaveCount(1);
 await reason.selectOption('other');const note=dialog.getByLabel('ملاحظة التلف',{exact:true});await expect(note).toHaveAttribute('required','');
 await dialog.getByLabel('العدد',{exact:true}).fill('3');await dialog.getByRole('button',{name:'معاينة العملية',exact:true}).click();expect(calls).toBe(0);await expect(dialog.getByRole('button',{name:'تأكيد وحفظ العملية'})).toHaveCount(0);
 await note.fill('سقوط العبوة أثناء النقل');await dialog.getByRole('button',{name:'معاينة العملية',exact:true}).click();await dialog.getByRole('button',{name:'تأكيد وحفظ العملية'}).click();
 await expect.poll(()=>calls).toBe(1);expect(legacyCalls).toBe(0);expect(payload!.p_action).toBe('shop_damage');expect(payload!.p_idempotency_key).toMatch(/^sr208:/);
 expect(payload!.p_payload).toEqual({warehouseId:'88888888-8888-4888-8888-000000000099',productId:'88888888-8888-4888-8888-000000000001',quantity:3,unit:'base',reason:'سقوط العبوة أثناء النقل',reasonCode:'other'});
 await expect(dialog.getByTestId('supplier-replacement-panel')).toHaveAttribute('aria-busy','false');await checkLayout(page,dialog);
});
