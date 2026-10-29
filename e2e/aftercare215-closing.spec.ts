import {test,expect} from './isolated-test';
import {cashReportFixture} from './package-f-cash.fixture';
test('215 equal-value exchange closing displays internal credit on both commercial sides and unchanged cash',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.route('**/rest/v1/rpc/get_cash_shift_closing_report',route=>route.fulfill({json:{...cashReportFixture,
    sales:{...cashReportFixture.sales,salesDefinitionVersion:215,internalExchangeCreditInMinorUnits:'9000',grossSalesInMinorUnits:1101000,returnEntitlementInMinorUnits:28000}}}));
  await page.goto('/e2e/package-f-cash-harness.html?live=1&theme=light');await page.getByRole('button',{name:'عرض التقرير المالي الحي',exact:true}).click();const report=page.getByRole('dialog',{name:'تقرير الإغلاق اليومي',exact:true});
  await expect(report).toContainText('مبيعات بمقابل تبديل (بلا قبض نقدي)');await expect(report).toContainText('من المرتجع إلى مقابل التبديل (بلا كاش)');await expect(report).toContainText('9.000');await expect(report).toContainText('آجل متبقي');await expect(report).toContainText('58.000');await expect(report).toContainText('دفعات أولى عند الاستلام');await expect(report).toContainText('734.000');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
