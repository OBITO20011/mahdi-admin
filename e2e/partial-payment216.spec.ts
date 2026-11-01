import {test,expect} from './isolated-test';
import {posFixtureIds as ids,posFixtureProducts as products} from './package-f-pos.fixture';
const identity=(n:number)=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const url='/e2e/package-f-pos-harness.html';
async function cart(page:any){const open=page.getByRole('button',{name:'مراجعة السلة والعميل',exact:true});if(await open.isVisible())await open.click();}
function reply(params:any,method:string,partial:boolean){const paid=partial?params.p_initial_paid_in_minor_units:params.p_payment_method==='debt'?0:21600;return {
 success:true,operationId:identity(1),orderId:identity(2),orderNumber:'POS-LOCAL216',warehouseId:ids.warehouse,branchId:ids.branch,customerName:'سوبرماركت النور',idempotentReplay:false,
 subtotalInMinorUnits:21600,discountInMinorUnits:0,totalInMinorUnits:21600,amountPaidInMinorUnits:paid,changeDueInMinorUnits:0,paymentMethod:partial?'debt':params.p_payment_method,paymentStatus:partial?'partially_paid':params.p_payment_method==='debt'?'unpaid':'paid',
 ...(partial?{initialPaymentMethod:method,initialPaymentId:identity(3),remainingInMinorUnits:21600-paid}:{}),items:[{id:identity(4),productId:products[0].id,productName:products[0].name_ar,sku:products[0].sku,salePackage:'طرد',commercialLineKind:'legacy_single_sku_parcel',quantity:1,baseQuantity:24,unitsPerSalePackage:24,
 unitPriceInMinorUnits:21600,lineTotalInMinorUnits:21600,allocatedDiscountInMinorUnits:0,netRefundableAmountInMinorUnits:21600,cogsInMinorUnits:2400,profitInMinorUnits:19200,parcelInstances:[]}],
};}
async function setup(page:any,width:number){await page.setViewportSize({width,height:900});await page.route('**/rest/v1/orders?*',(route:any)=>route.fulfill({json:new URL(route.request().url()).searchParams.get('select')==='created_at,order_items(id,base_unit_name_snapshot)'?{created_at:'2026-10-29T10:00:00Z',order_items:[{id:identity(4),base_unit_name_snapshot:'باكيت'}]}:[]}));await page.route('**/rest/v1/rpc/get_or_create_pos_receipt_token',(route:any)=>route.fulfill({json:{success:true,receiptToken:identity(5)}}));await page.goto(url);await page.locator(`[data-pos-product-card="${products[0].id}"]`).click();await cart(page);await page.getByRole('radio',{name:'دين / دفع جزئي',exact:true}).filter({visible:true}).click();await page.getByRole('combobox',{name:'اختيار العميل'}).selectOption('55555555-5555-4555-8555-555555555555');}
for(const width of [390,1440])for(const method of ['cash','cliq'])test(`216 partial ${method} ${width}: real POS captures one atomic request and prints paid/due`,async({page}:any,info:any)=>{
 const requests:any[]=[];let legacy=0;
 await page.route('**/rest/v1/rpc/create_pos_sale_v2',async(route:any)=>{legacy++;await route.abort('failed');});
 await page.route('**/rest/v1/rpc/create_pos_sale_with_initial_payment_v1',async(route:any)=>{const params=route.request().postDataJSON();requests.push(params);await route.fulfill({json:reply(params,method,true)});});
 await setup(page,width);await page.getByLabel('المدفوع الآن',{exact:true}).fill('10.000');
 await page.getByRole('radiogroup',{name:'طريقة المدفوع الآن'}).getByRole('radio',{name:method==='cash'?'كاش':'CliQ',exact:true}).click();if(method==='cliq')await page.getByLabel('مرجع CliQ (اختياري)',{exact:true}).fill('LOCAL216-REFERENCE');
 await expect(page.locator('#pos-initial-paid-help')).toContainText('11.600');
 expect(await page.getByLabel('المدفوع الآن',{exact:true}).evaluate((e:HTMLElement)=>({font:parseFloat(getComputedStyle(e).fontSize),height:e.getBoundingClientRect().height}))).toEqual({font:16,height:44});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('partial-payment216.png')});
 await page.locator('[data-testid="pos-complete-sale"]:visible').click();
 const receipt=page.getByTestId('sale-receipt-document');await expect(receipt).toBeVisible();await expect(receipt).toContainText('المدفوع');await expect(receipt).toContainText('10.000');await expect(receipt).toContainText('الباقي على الحساب');await expect(receipt).toContainText('11.600');
 expect(requests).toHaveLength(1);expect(legacy).toBe(0);expect(requests[0].p_initial_paid_in_minor_units).toBe(10000);expect(requests[0].p_initial_payment_method).toBe(method);expect(requests[0].p_customer_id).toBe('55555555-5555-4555-8555-555555555555');
});
