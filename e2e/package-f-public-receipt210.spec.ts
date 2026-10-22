import {test,expect} from './isolated-test';
import {checkLayout} from './package-f-layout';
import {trialDItems,trialDOrder,trialDDescriptions} from './trial-d-receipt.fixture';
const payload={success:true,orderNumber:trialDOrder.orderNumber,createdAt:trialDOrder.createdAt,status:'completed',paymentMethod:'cash',paymentStatus:'paid',subtotalInMinorUnits:37000,discountInMinorUnits:1000,totalInMinorUnits:36000,branch:{name:'فرع التجربة',address:'',phone:''},items:trialDItems.map(i=>({productName:i.productName,sku:i.sku,packageQuantity:i.quantity,packageName:i.salePackage,unitsPerPackage:1,packagePriceInMinorUnits:i.unitPrice*1000,lineTotalInMinorUnits:i.totalPrice*1000,commercialLineKind:i.commercialLineKind,baseQuantity:i.baseQuantity,baseUnitName:i.baseUnitName,parcelInstances:i.parcelInstances?.map(p=>({components:p.components.map(c=>({name:c.name,quantity:c.quantity,unitName:c.unitName}))}))??[]}))};
for(const width of [390,1440])test(`D public210 mixed receipt same template print/share/reload zero writes ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});const unexpected:string[]=[],calls:unknown[]=[];
 await page.route('**/rest/v1/**',route=>{if(route.request().url().endsWith('/rpc/get_public_pos_receipt')){calls.push(route.request().postDataJSON());return route.fulfill({json:payload});}unexpected.push(route.request().url());return route.fulfill({status:500,json:{error:'unexpected receipt request'}});});
 await page.addInitScript(()=>{Object.defineProperty(navigator,'share',{configurable:true,value:async(data:ShareData)=>{(window as unknown as {receiptShare:ShareData}).receiptShare=data;}});window.print=()=>{(window as unknown as {receiptPrinted:boolean}).receiptPrinted=true;};});
 await page.goto('http://127.0.0.1:4174/#receipt=93400000-0000-4000-8000-000000000099');
 const receipt=page.getByTestId('sale-receipt-document');await expect(receipt).toBeVisible();for(const d of trialDDescriptions)await expect(receipt.locator('[data-receipt-line-description]').filter({hasText:d})).toHaveCount(1);
 await expect(receipt.locator('[data-receipt-line]')).toHaveCount(4);await expect(receipt).not.toContainText(/private-|999|عنوان التجهيز|تغليف محفوظ/);await expect(receipt).toContainText('36.000');await checkLayout(page,page.locator('main'));
 await page.getByRole('button',{name:'مشاركة الوصل'}).click();const shared=await page.evaluate(()=>(window as unknown as {receiptShare:ShareData}).receiptShare);for(const d of trialDDescriptions)expect(shared.text).toContain(d);
 await page.getByRole('button',{name:'طباعة الوصل'}).click();expect(await page.evaluate(()=>(window as unknown as {receiptPrinted:boolean}).receiptPrinted)).toBe(true);await page.emulateMedia({media:'print'});await expect(receipt).toBeVisible();await expect(page.getByRole('button',{name:'طباعة الوصل'})).toBeHidden();await page.emulateMedia({media:'screen'});
 await page.reload();await expect(receipt).toBeVisible();expect(calls).toHaveLength(4);expect(calls.every(c=>(c as {p_receipt_token:string}).p_receipt_token==='93400000-0000-4000-8000-000000000099')).toBe(true);expect(unexpected).toEqual([]);
});
test('D public210 unavailable token shows no receipt and creates nothing',async({page})=>{
 const requests:string[]=[];await page.route('**/rest/v1/**',route=>{requests.push(new URL(route.request().url()).pathname);return route.fulfill({json:{success:false,message:'الإيصال غير موجود أو لم يعد متاحاً.'}});});
 await page.goto('http://127.0.0.1:4174/#receipt=93400000-0000-4000-8000-000000000098');await expect(page.getByRole('heading',{name:'تعذر فتح الإيصال'})).toBeVisible();await expect(page.getByTestId('sale-receipt-document')).toHaveCount(0);expect(requests).toEqual(['/rest/v1/rpc/get_public_pos_receipt','/rest/v1/rpc/get_public_pos_receipt']);
});
