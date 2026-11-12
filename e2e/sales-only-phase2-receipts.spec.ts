import {test,expect} from './isolated-test';
const token='93400000-0000-4000-8000-000000000099';
const payload={success:true,orderNumber:'LOCAL-LITE-RECEIPT',createdAt:'2026-11-09T10:00:00Z',status:'completed',paymentMethod:'debt',paymentStatus:'partially_paid',
 subtotalInMinorUnits:10000,discountInMinorUnits:0,totalInMinorUnits:10000,amountPaidInMinorUnits:4000,remainingInMinorUnits:6000,
 branch:{name:'فرع وهمي',address:'',phone:''},items:[{productName:'صنف وهمي',sku:'LOCAL',packageQuantity:1,packageName:'باكيت',unitsPerPackage:1,packagePriceInMinorUnits:10000,lineTotalInMinorUnits:10000,commercialLineKind:'base_unit',baseQuantity:1,baseUnitName:'باكيت',parcelInstances:[]}]};
for(const initial of [true,false])test(`public lite receipt reflects current paid/due without cost;initial=${initial};reload writes nothing`,async({page})=>{
 await page.setViewportSize({width:390,height:900});const calls:string[]=[];
 await page.route('**/rest/v1/**',route=>{calls.push(new URL(route.request().url()).pathname);if(route.request().url().endsWith('/rpc/lite1_operating_mode'))return route.fulfill({json:{contractVersion:'sales-only-phase2-v1',fullAccounting:false}});return route.fulfill({json:{...payload,...(initial?{initialPaymentMethod:'cash'}:{})}});});
 await page.goto(`http://127.0.0.1:4174/#receipt=${token}`);
 const receipt=page.getByTestId('sale-receipt-document');await expect(receipt).toContainText('4.000');await expect(receipt).toContainText('6.000');await expect(receipt).toContainText('الباقي على الحساب');
 if(initial)await expect(receipt).toContainText('دفعة كاش');else await expect(receipt).not.toContainText('دفعة كاش');
 await expect(receipt).not.toContainText(/تكلفة|ربح|هاتف الزبون/);await page.reload();await expect(receipt).toContainText('6.000');
 expect(calls.filter(p=>p==='/rest/v1/rpc/lite1_public_pos_receipt2')).toEqual(Array(4).fill('/rest/v1/rpc/lite1_public_pos_receipt2'));
 expect(calls.filter(p=>p==='/rest/v1/rpc/lite1_operating_mode')).toEqual(Array(4).fill('/rest/v1/rpc/lite1_operating_mode'));expect(calls).toHaveLength(8);
});
test('public lite receipt transport error never retries against full reader or shows a fabricated paid amount',async({page})=>{
 const calls:string[]=[];await page.route('**/rest/v1/**',route=>{calls.push(new URL(route.request().url()).pathname);return route.fulfill({status:503,json:{message:'unavailable'}});});
 await page.goto(`http://127.0.0.1:4174/#receipt=${token}`);await expect(page.getByRole('heading',{name:'تعذر فتح الإيصال'})).toBeVisible();await expect(page.getByTestId('sale-receipt-document')).toHaveCount(0);
 expect(calls).toEqual(Array(2).fill('/rest/v1/rpc/lite1_public_pos_receipt2'));
});
