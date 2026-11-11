import {test,expect} from './isolated-test';
import {cashIds} from './package-f-cash.fixture';
test.use({hasTouch:true});
test('actual drawer component reads private-return evidence with canonical amount and keeps explicit mismatch/error behavior',async({page})=>{
 await page.setViewportSize({width:390,height:1000});const calls:Record<string,unknown>[]=[];let bad=false;
 await page.route('**/rpc/lite1_shift_movements2',r=>{const args=r.request().postDataJSON();calls.push(args);return r.fulfill({json:bad?{message:'TECHNICAL_PRIVATE'}:{shiftId:cashIds.shift,kind:'refunds',method:'cash',generatedAt:'2026-11-09T12:00:00Z',shiftStatus:'open',canonicalAmountInMinorUnits:12000,totalAmountInMinorUnits:12000,totalCount:1,page:1,pageSize:25,totalPages:1,evidenceStatus:'matched',rows:[{source:'lite_return',id:'92600000-0000-4000-8000-000000000987',reference:'LOCAL-REFUND',at:'2026-11-09T10:00:00Z',method:'cash',amountInMinorUnits:12000,note:'ردّ مبلغ لفاتورة بلا مخزون'}]}});});
 await page.goto('/e2e/package-f-cash-harness.html?lite=1');await page.getByRole('button',{name:'تفصيل مبالغ مرتجعات كاش',exact:true}).tap();
 const modal=page.getByRole('dialog',{name:'تفصيل مبالغ مرتجعات كاش'});await expect(modal).toContainText('12.000');await expect(modal).toContainText('LOCAL-REFUND');await expect(modal).toContainText('ردّ مبلغ لفاتورة بلا مخزون');await expect(modal).not.toContainText('لا تطابق');
 expect(calls).toEqual([{p_shift_id:cashIds.shift,p_kind:'refunds',p_method:'cash',p_page:1,p_page_size:25}]);await modal.getByRole('button',{name:'إغلاق',exact:true}).tap();
 bad=true;await page.getByRole('button',{name:'تفصيل مبالغ مرتجعات كاش',exact:true}).tap();await expect(page.getByRole('dialog',{name:'تفصيل مبالغ مرتجعات كاش'}).getByRole('alert')).toBeVisible();await expect(page.locator('body')).not.toContainText('TECHNICAL_PRIVATE');
});
