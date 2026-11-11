import {test,expect} from './isolated-test';
import {wizard215Order} from './aftercare215-wizard.fixture';
test.use({hasTouch:true});
const id=(n:number)=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`,seal='a'.repeat(64);
test('lite guest recipient proposal keeps customer card distinct and offers manual review;no stock reservation claim',async({page})=>{
 await page.setViewportSize({width:390,height:1000});await page.goto('/e2e/package-f-orders-harness.html?liteRecipient&select');
 const proposal=page.getByRole('region',{name:'مراجعة بيانات مستلم الطلب'});await expect(proposal).toContainText('اسم البطاقة المحفوظ');await expect(proposal).toContainText('مستلم الطلب المقترح');
 await expect(proposal).toContainText('غير مسجلة');await expect(proposal).toContainText('الطلب لا يعدّلها تلقائياً');await expect(proposal.getByRole('button',{name:'فتح بطاقة الزبون للمراجعة'})).toBeVisible();
 await page.getByText('تفاصيل الطلب والحساب',{exact:true}).tap();await expect(page.getByText('هذا الطلب بلا تتبع مخزون أو حجز. القبول يبدأ التجهيز، والتسليم يسجل التحصيل والذمة.',{exact:true})).toBeVisible();
 await expect(page.getByRole('main')).not.toContainText('كميات هذا الطلب محجوزة منذ إنشائه');
});
test('lite mobile return reuses inspection,server money and durable recovery;no replacement,supplier,cost or stock promise',async({page})=>{
 await page.setViewportSize({width:390,height:1000});const writes:Record<string,unknown>[]=[],names:string[]=[];
 await page.route('**/rest/v1/rpc/**',async route=>{
  const name=new URL(route.request().url()).pathname.split('/').at(-1)!;names.push(name);
  if(name==='lite1_preview_return2')return route.fulfill({json:{accountingTracked:false,contractVersion:215,orderId:wizard215Order.id,previewFingerprint:seal,canConfirm:true,issues:[],entitlementInMinorUnits:'9000',debtReductionInMinorUnits:'0',moneyRefundInMinorUnits:'9000',goodQuantity:12,badQuantity:0,customerDamageQuantity:0,refundMethod:'cash'}});
  if(name==='lite1_settle_return2'){
   writes.push(route.request().postDataJSON());if(writes.length===1)return route.abort('failed');
   return route.fulfill({json:{success:true,accountingTracked:false,contractVersion:215,orderId:wizard215Order.id,operationId:id(80),returnOperationId:id(80),returnId:id(81),returnNumber:'L2R-LOCAL',entitlementInMinorUnits:'9000',debtReductionInMinorUnits:'0',moneyRefundInMinorUnits:'9000',goodQuantity:12,badQuantity:0,customerDamageQuantity:0,refundMethod:'cash'}});
  }
  throw Error('UNEXPECTED_AFTERCARE_RPC:'+name);
 });
 await page.goto('/e2e/aftercare215-wizard-harness.html?sales-only');
 await page.getByRole('button',{name:'إرجاع من الزبون',exact:true}).tap();await expect(page.getByRole('button',{name:'يبدّل',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'التالي',exact:true}).tap();await page.getByRole('button',{name:'طرد كامل',exact:true}).tap();await page.getByRole('button',{name:'التالي',exact:true}).tap();
 await expect(page.getByTestId('aftercare215-wizard')).toContainText('لا تتغير كميات مخزون');await page.getByLabel('فحصت الباكيتات الراجعة',{exact:true}).check();await page.getByRole('button',{name:'التالي',exact:true}).tap();
 await expect(page.getByRole('button',{name:'على المورد — بانتظار البديل',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'التالي',exact:true}).tap();
 await page.getByRole('button',{name:'معاينة التفاصيل',exact:true}).tap();const preview=page.getByTestId('aftercare215-preview');await expect(preview).toContainText('9.000');await expect(preview).not.toContainText(/قيم المالك|ربح|تكلفة/);expect(writes).toHaveLength(0);
 await page.getByRole('button',{name:'تأكيد الإرجاع',exact:true}).tap();await expect.poll(()=>writes.length).toBe(1);
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('nawasrah:admin:phase43-aftercare:v2:92600000-0000-4000-8000-000000000070:'+ '92600000-0000-4000-8000-000000000001:sealed_return')??'null')?.status)).toBe('OUTCOME_UNKNOWN');
 await page.reload();
 const recovered=await page.evaluate(async orderId=>{
  // @ts-expect-error The isolated Vite browser module.
  const service=await import('/src/services/supabase/salesAftercare.service.ts');return service.recoverAdminAftercare(orderId,'sealed_return');
 },wizard215Order.id);expect(recovered.success).toBe(true);expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);expect(writes[0].p_preview).toBe(seal);expect(writes[0].p_key).toMatch(/^phase43:/);
 expect(names).toEqual(['lite1_preview_return2','lite1_settle_return2','lite1_settle_return2']);
});
