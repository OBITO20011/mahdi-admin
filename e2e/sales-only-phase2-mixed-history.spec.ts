import {test,expect} from './isolated-test';
import {liteHomeDocument} from './sales-only-phase2-home.fixture';
import {liteReportDocument} from './sales-only-phase2-report.fixture';
import {posFixtureIds} from './package-f-pos.fixture';
test.use({hasTouch:true});
test('real full-mode App preserves uncosted historical sales withoutinventedprofit;period changes still reread dispatch',async({page})=>{
 await page.setViewportSize({width:390,height:1000});let bad=false;const reads:Record<string,unknown>[]=[];
 await page.route('**/rpc/lite1_operating_mode',r=>r.fulfill({json:{contractVersion:'sales-only-phase2-v1',fullAccounting:true}}));
 await page.route('**/rpc/lite1_reporting_home2',r=>r.fulfill({json:{...liteHomeDocument(),historyWithoutCost:true}}));
 await page.route('**/rpc/lite1_reporting_report2',r=>{const args=r.request().postDataJSON();reads.push(args);return r.fulfill({json:bad?{accountingTracked:false,historyWithoutCost:true,privateText:'PRIVATE_SECRET'}:{...liteReportDocument(args.p_date_from,args.p_date_to),branchId:posFixtureIds.branch,historyWithoutCost:true}});});
 await page.goto('/e2e/sales-only-phase2-app-harness.html');await expect(page.getByRole('heading',{name:'وضع التشغيل',exact:true})).toBeVisible();
 await page.evaluate(()=>{(window as unknown as {__LITE_APP_TAB__:(tab:string)=>void}).__LITE_APP_TAB__('home');});const home=page.getByTestId('dashboard-home');await expect(home).toContainText('الفترة تشمل مبيعات قبل تفعيل المخزون بلا تكلفة');await expect(home).toContainText('12.500');await expect(home.getByText('ربح الشهر',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>{(window as unknown as {__LITE_APP_TAB__:(tab:string)=>void}).__LITE_APP_TAB__('reports');});const mixed=page.getByTestId('mixed-history-report');await expect(mixed).toContainText('لا يمكن احتساب ربح موثوق');await expect(mixed).toContainText('10.000');await expect(mixed.getByTestId('report-customer-collections')).toBeVisible();await expect(mixed.getByText('الربح',{exact:true})).toHaveCount(0);
 bad=true;await page.getByRole('button',{name:'تحديث التقرير',exact:true}).click();await expect(mixed).toHaveCount(0);await expect(page.getByText(/تعذر التحقق من تقرير المبيعات والذمم/)).toBeVisible();await expect(page.locator('body')).not.toContainText('PRIVATE_SECRET');expect(reads.length).toBeGreaterThan(1);
});
