import {test,expect} from './isolated-test';
import {liteHomeDocument} from './sales-only-phase2-home.fixture';
import {posFixtureProducts} from './package-f-pos.fixture';
import {cashShift,shiftRpcFixture} from './package-f-cash.fixture';
import {posFixtureIds} from './package-f-pos.fixture';
test.use({hasTouch:true});
for(const assurance of ['aal1','aal2'])test(`real App owner mode switch ${assurance}:identity/AAL2 gate precedes one write and navigation refresh`,async({page})=>{
 await page.setViewportSize({width:390,height:1000});let full=true;const writes:unknown[]=[];
 await page.route('**/rpc/lite1_operating_mode',r=>r.fulfill({json:{contractVersion:'sales-only-phase2-v1',fullAccounting:full}}));
 await page.route('**/rpc/lite1_set_mode2',r=>{writes.push(r.request().postDataJSON());full=false;return r.fulfill({json:{fullAccounting:false}});});
 await page.goto('/e2e/sales-only-phase2-app-harness.html?owner-assurance='+assurance);
 const panel=page.getByRole('region',{name:'وضع التشغيل',exact:true});await expect(panel).toBeVisible();
 await expect(page.locator('[data-navigation-id="inventory-current"]')).toHaveCount(1);
 await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'إطفاء المحاسبة والمخزون',exact:true}).tap();
 if(assurance==='aal1'){
  await expect(panel.getByRole('alert')).toContainText('MODE-01');expect(writes).toEqual([]);
  await expect(page.locator('[data-navigation-id="inventory-current"]')).toHaveCount(1);
 }else{
  await expect(panel).toContainText('تتبع المخزون والتكلفة مطفأ');expect(writes).toEqual([{p_full:false}]);
  await expect(page.locator('[data-navigation-id="inventory-current"]')).toHaveCount(0);
  await expect(page.locator('[data-navigation-id="supplier-receiving"]')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'فتح المساعد الإداري الذكي'})).toHaveCount(0);
 }
});

test('real App lite expense uses existing writer and refreshes separate drawer expense/withdrawal and closing amounts',async({page})=>{
 await page.setViewportSize({width:390,height:1000});let recorded=false;const writes:unknown[]=[];
 const shift={...cashShift,id:posFixtureIds.configuration,branchId:posFixtureIds.branch,openingCash:10,totalCashSales:30,totalCliqSales:0,totalCardSales:0,totalReceipts:0,totalPayments:0,cashReceipts:0,cliqReceipts:0,cashSupplierPayments:0,cliqSupplierPayments:0,cashExpenses:0,cliqExpenses:0,cashRefunds:0,cliqRefunds:0,ownerWithdrawals:5,ownerWithdrawalReturns:0,expectedCash:35};
 await page.route('**/rpc/lite1_operating_mode',r=>r.fulfill({json:{contractVersion:'sales-only-phase2-v1',fullAccounting:false}}));
 await page.route('**/rpc/get_expense_shift_center',r=>r.fulfill({json:{success:true,currentShift:{...shiftRpcFixture({...shift,cashExpenses:recorded?12.345:0,expectedCash:recorded?22.655:35}),ownerWithdrawalsInMinorUnits:5000,ownerWithdrawalReturnsInMinorUnits:0},recentShifts:[],expenses:recorded?[{id:'92600000-0000-4000-8000-000000000920',expenseNumber:'EXP-LITE-01',shiftId:shift.id,category:'كهرباء وماء',amountInMinorUnits:12345,paymentMethod:'cash',description:'فاتورة الكهرباء المحلية',isReversed:false,branchId:shift.branchId,createdByName:'مالك اختبار',createdAt:'2026-11-10T05:00:00Z'}]:[]}}));
 await page.route('**/rpc/create_operational_expense',r=>{writes.push(r.request().postDataJSON());recorded=true;return r.fulfill({json:{success:true,message:'تم تسجيل المصروف.'}});});
 await page.goto('/e2e/sales-only-phase2-app-harness.html');
 await expect(page.getByRole('heading',{name:'وضع التشغيل',exact:true})).toBeVisible();
 await page.evaluate(()=>{(window as unknown as {__LITE_APP_TAB__:(tab:string)=>void}).__LITE_APP_TAB__('expenses');});
 await expect(page.getByTestId('expenses-screen')).toContainText('SHIFT-10482');await page.getByRole('button',{name:'مصروف جديد',exact:true}).tap();
 const dialog=page.getByRole('dialog',{name:'تسجيل مصروف تشغيلي',exact:true});await expect(dialog).toHaveAttribute('data-state','open');
 await dialog.getByLabel('فئة المصروف',{exact:true}).selectOption('كهرباء وماء');
 await dialog.getByLabel('المبلغ (د.أ) *',{exact:true}).fill('12.345');await dialog.getByLabel('البيان / الوصف *',{exact:true}).fill('فاتورة الكهرباء المحلية');
 await dialog.getByRole('button',{name:'اعتماد وتسجيل المصروف',exact:true}).tap();await expect(dialog).toHaveCount(0);
 expect(writes).toEqual([{p_branch_id:posFixtureIds.branch,p_category:'كهرباء وماء',p_description:'فاتورة الكهرباء المحلية',p_amount_in_minor_units:12345,p_payment_method:'cash',p_reference_number:null}]);
 await expect(page.getByTestId('expenses-screen')).toContainText('EXP-LITE-01');await expect(page.getByTestId('expenses-screen')).toContainText('12.345');
 await page.evaluate(()=>{(window as unknown as {__LITE_APP_TAB__:(tab:string)=>void}).__LITE_APP_TAB__('shifts');});
 await expect(page.getByTestId('cash-expected')).toContainText('22.655');
 await expect(page.locator('[data-cash-flow="expenses:cash"]')).toContainText('12.345');
 await expect(page.locator('[data-cash-flow="withdrawals:cash"]')).toContainText('5.000');
 await page.getByTestId('cash-count-open').tap();const closing=page.getByRole('dialog',{name:'إغلاق الوردية',exact:true});
 await expect(closing).toContainText('22.655');await closing.getByLabel('الكاش الفعلي بعد عدّ الصندوق',{exact:true}).fill('22.655');
 await expect(closing).toContainText('مطابق');expect(writes).toHaveLength(1);
});
test('real App refuses unknown initial mode;reuses cost-free Home and keeps POS cart mounted across failed refresh',async({page})=>{
 await page.setViewportSize({width:390,height:1000});let modeFailure=true,fullHomeReads=0,writes=0;
 await page.route('**/rpc/lite1_operating_mode',r=>r.fulfill(modeFailure?{status:503,json:{message:'PRIVATE'}}:{json:{contractVersion:'sales-only-phase2-v1',fullAccounting:false}}));
 await page.route('**/rpc/get_home_dashboard',r=>{fullHomeReads++;return r.fulfill({json:{}});});
 await page.route('**/rpc/lite1_home2',r=>r.fulfill({json:liteHomeDocument()}));
 await page.route('**/rpc/lite1_product_availability2',r=>r.fulfill({json:{contractVersion:'sales-only-availability2-v1',fullAccounting:false,products:r.request().postDataJSON().p_product_ids.map((productId:string)=>({productId,available:true,effectiveAvailable:true,active:true,revision:0,flavorMasterProductId:null,parentAvailable:true}))}}));
 await page.route('**/rpc/lite1_pos2',async r=>{writes++;await r.abort('failed');});
 await page.goto('/e2e/sales-only-phase2-app-harness.html');await expect(page.getByRole('alert')).toContainText('MODE-02');await expect(page.locator('[data-bottom-tab]')).toHaveCount(0);expect(fullHomeReads).toBe(0);
 modeFailure=false;await page.getByRole('button',{name:'إعادة قراءة وضع التشغيل',exact:true}).tap();await expect(page.getByRole('heading',{name:'وضع التشغيل',exact:true})).toBeVisible();
 await expect(page.locator('[data-navigation-id="inventory-overview"]')).toHaveCount(0);await expect(page.getByRole('button',{name:'فتح المساعد الإداري الذكي'})).toHaveCount(0);
 await page.evaluate(()=>{(window as unknown as {__LITE_APP_TAB__:(tab:string)=>void}).__LITE_APP_TAB__('home');});
 const home=page.getByTestId('dashboard-home');await expect(home).toBeVisible();await expect(home).toContainText('12.500');await expect(home).not.toContainText(/ربح الشهر|ذمم الموردين|تنبيهات المخزون/);expect(fullHomeReads).toBe(0);
 await page.evaluate(()=>{(window as unknown as {__LITE_APP_MODAL__:()=>void}).__LITE_APP_MODAL__();});await expect(page.getByRole('dialog')).toContainText('خاصة بالمخزون');await page.getByRole('dialog').getByRole('button',{name:/إغلاق/}).first().tap();
 await page.evaluate(()=>{(window as unknown as {__LITE_APP_TAB__:(tab:string)=>void}).__LITE_APP_TAB__('pos');});
 const product=page.locator(`[data-pos-product-card="${posFixtureProducts[0].id}"]`),checkout=page.locator('[data-testid="pos-complete-sale"]:visible');await expect(product).toBeEnabled();await product.tap();await expect(checkout).toContainText('21.600');
 modeFailure=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('alert').filter({hasText:'السلة محفوظة'})).toBeVisible();await expect(checkout).toContainText('21.600');await expect(checkout).toBeDisabled();expect(writes).toBe(0);
 modeFailure=false;await page.getByRole('button',{name:'إعادة القراءة',exact:true}).tap();await expect(checkout).toBeEnabled();await expect(checkout).toContainText('21.600');expect(writes).toBe(0);
});
