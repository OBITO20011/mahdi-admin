import {test,expect} from './isolated-test';
import {liteClosingDocument,mixedClosingDocument} from './sales-only-phase2-closing.fixture';
test.use({hasTouch:true});
test('lite immutable shift reuses drawer UI with true money and no cost or live reconstruction requests',async({page})=>{
 await page.setViewportSize({width:390,height:1000});const calls:string[]=[];
 await page.route('**/rpc/**',route=>{const name=new URL(route.request().url()).pathname.split('/').at(-1)!;calls.push(name);if(name==='lite1_shift_closing2')return route.fulfill({json:liteClosingDocument});throw Error('UNEXPECTED_CLOSING_RPC:'+name);});
 await page.goto('/e2e/package-e-closing-harness.html');const report=page.getByTestId('lite-shift-closing-report');await expect(report).toBeVisible();
 await expect(report).toContainText('لقطة إغلاق محفوظة');await expect(report).toContainText('22.500');await expect(report).toContainText('1.500');
 await expect(report.getByRole('button',{name:/تفصيل/})).toHaveCount(0);await expect(report.getByRole('button',{name:'طباعة أو حفظ التقرير PDF'})).toBeVisible();
 await expect(report).not.toContainText('دفعات الموردين');expect(calls).toEqual(['lite1_shift_closing2']);
});

test('mixed full shift counts old uncosted refunds and hides incomplete profit withoutchangingmoney',async({page})=>{
 await page.setViewportSize({width:390,height:1000});await page.route('**/rpc/lite1_shift_closing2',r=>r.fulfill({json:mixedClosingDocument}));await page.goto('/e2e/package-e-closing-harness.html');const report=page.getByTestId('lite-shift-closing-report');await expect(report).toBeVisible();await expect(report).toContainText('لا يمكن حساب ربح كامل');await expect(report).toContainText('المبالغ المدفوعة للمرتجعات');await expect(report).toContainText('3.000');await expect(report).toContainText('22.500');await expect(report).not.toContainText('استحقاق المرتجعات (مال وتخفيض دين)');await expect(report.getByRole('button',{name:/تفصيل/})).toHaveCount(0);
});
