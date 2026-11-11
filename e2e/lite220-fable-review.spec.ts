import {test,expect} from './isolated-test';import{cashIds}from'./package-f-cash.fixture';import{customersFixture}from'./package-f-customers.fixture';
test.use({hasTouch:true});
test('lite220 all-lite shift block is Arabic,keeps dailyclose and never exposes reversal confirmation',async({page})=>{
 await page.setViewportSize({width:390,height:1000});const writes:string[]=[];
 await page.route('**/rpc/lite1_preview_shift_reversal2',r=>r.fulfill({json:{success:true,shiftId:cashIds.shift,shiftNumber:'LOCAL',shiftStatus:'open',canExecute:false,liteShiftBlocked:true,summary:{cogs_in_minor_units:-500,profit_in_minor_units:-500,inventory_base_units_delta:1},operations:[{operationType:'lite_shift',originalRecordId:cashIds.shift,status:'BLOCKED',reason:'هذه الوردية تتبع وضع البيع المبسّط. لا يمكن إلغاؤها أو عكس عملياتها؛ استخدم المرتجع وعدّ الدرج والإغلاق اليومي.',expectedEffect:{}}]}}));
 await page.route('**/rpc/reverse_cash_shift_with_operations',r=>{writes.push('reverse');return r.fulfill({status:500,json:{message:'UNEXPECTED'}});});
 await page.goto('/e2e/package-f-cash-harness.html');await expect(page.getByRole('button',{name:/عدّ الدرج وإغلاق الوردية/})).toBeVisible();
 await page.locator('summary').filter({hasText:'تصحيح استثنائي'}).tap();await page.getByRole('button',{name:'إلغاء الوردية وعكس جميع عملياتها',exact:true}).tap();await page.getByRole('button',{name:'معاينة العمليات والأثر المالي',exact:true}).tap();
 await expect(page.getByText(/هذه الوردية تتبع وضع البيع المبسّط/)).toBeVisible();await expect(page.getByRole('button',{name:'تأكيد عكس الوردية بالكامل'})).toHaveCount(0);for(const text of['تكلفة البضاعة:','الربح:','المخزون:'])await expect(page.getByText(text,{exact:false})).toHaveCount(0);expect(writes).toEqual([]);
});
test('real customer UI routes aging and financial filters to parallel220 readers with no legacy fallback',async({page})=>{
 await page.setViewportSize({width:390,height:1000});const calls:Array<{name:string,args:any}>=[],zero={total_in_minor_units:0,days_0_7_in_minor_units:0,days_8_30_in_minor_units:0,days_over_30_in_minor_units:0,age_unavailable_in_minor_units:0,overdue_customer_count:0,over_limit_customer_count:0};
 await page.route('**/rest/v1/rpc/**',r=>{const name=r.request().url().split('/').at(-1)!,args=r.request().postDataJSON();calls.push({name,args});if(name==='lite1_debt_aging2')return r.fulfill({json:zero});if(name==='lite1_crm_page2')return r.fulfill({json:{customers:args.p_status==='has_debt'?[]:[{...customersFixture[0],full_name:'زبون سدد بعد المرتجع',current_balance_in_minor_units:0}],total_count:args.p_status==='has_debt'?0:1}});return r.fulfill({json:{items:[],unreadCount:0}});});
 await page.goto('/e2e/package-f-customers-harness.html?live&lite220=1');await expect(page.getByText('زبون سدد بعد المرتجع',{exact:true}).filter({visible:true})).toBeVisible();await expect(page.getByTestId('customer-aging-summary')).toContainText('0.000');
 await page.getByRole('tab',{name:'عليهم دين',exact:true}).tap();await expect.poll(()=>calls.filter(v=>v.name==='lite1_crm_page2').at(-1)?.args.p_status).toBe('has_debt');await expect(page.getByText('زبون سدد بعد المرتجع',{exact:true})).toHaveCount(0);
 expect(calls.filter(v=>['get_customer_debt_aging','get_crm_customer_page'].includes(v.name))).toEqual([]);expect(calls.find(v=>v.name==='lite1_debt_aging2')?.args).toEqual({p_customer_id:null});
});
