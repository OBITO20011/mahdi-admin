import {test,expect} from './isolated-test';
import {cashIds} from './package-f-cash.fixture';
test.use({hasTouch:true});

for(const query of ['','lite=1'])test(`cashier page preserves daily close butblocks lite-refund reversal ${query||'full'}`,async({page})=>{
 await page.setViewportSize({width:390,height:1000});const previews:unknown[]=[],writes:string[]=[];
 await page.route('**/rpc/lite1_preview_shift_reversal2',r=>{previews.push(r.request().postDataJSON());return r.fulfill({json:{success:true,shiftId:cashIds.shift,shiftNumber:'LOCAL',shiftStatus:'open',canExecute:false,liteMonetaryRefundBlocked:true,summary:{cash_in_minor_units:-1000,cogs_in_minor_units:-500,profit_in_minor_units:-500,inventory_base_units_delta:1},operations:[{operationType:'lite_monetary_refund',originalRecordId:cashIds.shift,status:'BLOCKED',reason:'الوردية تتضمن ردّ مبلغ لفاتورة قديمة بلا مخزون. استخدم عدّ الدرج والإغلاق اليومي.',expectedEffect:{}}]}});});
 await page.route('**/rpc/reverse_cash_shift_with_operations',r=>{writes.push('reversal');return r.fulfill({status:500,json:{message:'UNEXPECTED'}});});
 await page.goto('/e2e/package-f-cash-harness.html?'+query);
 await expect(page.getByRole('button',{name:/عدّ الدرج وإغلاق الوردية/})).toBeVisible();
 await page.locator('summary').filter({hasText:'تصحيح استثنائي'}).tap();await page.getByRole('button',{name:'إلغاء الوردية وعكس جميع عملياتها',exact:true}).tap();await page.getByRole('button',{name:'معاينة العمليات والأثر المالي',exact:true}).tap();
 await expect(page.getByText('ردّ مبلغ لفاتورة بلا مخزون',{exact:true})).toBeVisible();await expect(page.getByText(/الوردية تتضمن ردّ مبلغ/)).toBeVisible();await expect(page.getByRole('button',{name:'تأكيد عكس الوردية بالكامل'})).toHaveCount(0);
 await expect(page.getByText('تكلفة البضاعة:',{exact:false})).toHaveCount(0);await expect(page.getByText('الربح:',{exact:false})).toHaveCount(0);
 expect(previews).toEqual([{p_shift_id:cashIds.shift}]);expect(writes).toEqual([]);
});
