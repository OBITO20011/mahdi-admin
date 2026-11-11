import {test,expect} from './isolated-test';
import {reportToday} from '../src/utils/reportPeriodSelection';
import {liteReportDocument} from './sales-only-phase2-report.fixture';
test.use({hasTouch:true});
test('lite report reuses today/session selection,collection panel and exact displayed money without cost/profit;bad read shows no zeros',async({page})=>{
 await page.setViewportSize({width:390,height:1000});const calls:Record<string,unknown>[]=[];let fail=false;
 await page.route('**/rpc/lite1_business_report2',route=>{const args=route.request().postDataJSON();calls.push(args);return route.fulfill({json:fail?{raw:'PRIVATE TOKEN CUSTOMER'}:liteReportDocument(args.p_date_from,args.p_date_to)});});
 await page.goto('/e2e/sales-only-phase2-report-harness.html');const report=page.getByTestId('lite-business-report');await expect(report.getByTestId('report-customer-collections')).toBeVisible();
 const today=reportToday();expect(calls[0]).toMatchObject({p_date_from:today,p_date_to:today});await expect(report).toContainText('12.500');await expect(report).toContainText('10.000');await expect(report).toContainText('8.000');
 await expect(report.getByText('ربح الشهر',{exact:true})).toHaveCount(0);await expect(report).not.toContainText(/تكلفة البيع الأصلية|ذمم الموردين/);
 const yesterday=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10);await report.getByLabel('من تاريخ',{exact:true}).fill(yesterday);await expect.poll(()=>calls.at(-1)?.p_date_from).toBe(yesterday);
 await page.reload();await expect(report.getByLabel('من تاريخ',{exact:true})).toHaveValue(yesterday);await expect(report.getByTestId('report-customer-collections')).toBeVisible();
 fail=true;await report.getByRole('button',{name:'تحديث التقرير',exact:true}).tap();await expect(report.getByRole('alert')).toContainText('SREP-01');await expect(report.getByTestId('report-customer-collections')).toHaveCount(0);await expect(report).not.toContainText(/PRIVATE|TOKEN|CUSTOMER/);
});
