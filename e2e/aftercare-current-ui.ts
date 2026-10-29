import {expect,type Page} from '@playwright/test';
import {damage215Page,damage215Row} from './aftercare215-damage.fixture';
export const damageFixtureProductId=damage215Row.productId;
export const quoteSeal='c'.repeat(64);
export const proofId=(n:number)=>`93400000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export async function openAftercare(page:Page,intent:'refund'|'replace',choice:string,quantity?:number){
  await page.getByRole('button',{name:'إرجاع أو استبدال',exact:true}).click();
  if(intent==='replace')await page.getByRole('button',{name:'يبدّل',exact:true}).click();
  await page.getByRole('button',{name:'التالي',exact:true}).click();await page.getByRole('button',{name:choice,exact:true}).click();
  if(quantity!==undefined)await page.getByLabel(/^عدد .* الراجعة$/).fill(String(quantity));
  await page.getByRole('button',{name:'التالي',exact:true}).click();
}
export async function finishCurrentInspection(page:Page,bad:'all'|'none'='none',supplier?:string){
  if(bad==='all')for(const field of await page.getByLabel(/^الخربان ·/).all())await field.fill((await field.getAttribute('max'))!);
  await page.getByLabel('فحصت الباكيتات الراجعة',{exact:true}).check();await page.getByRole('button',{name:'التالي',exact:true}).click();
  if(bad==='all'){
    await page.getByRole('button',{name:supplier?'على المورد — بانتظار البديل':'خسارة عليّ — تالف نهائي',exact:true}).click();
    if(supplier)for(const field of await page.getByLabel(/^مورد /).all())await field.selectOption(supplier);
  }
  await page.getByRole('button',{name:'التالي',exact:true}).click();
}
/** Synthetic server quotes only. Tests inspect payload/identities and zero writes;
 * monetary correctness is proved separately by actual local PostgreSQL suites. */
export async function mockCurrentAftercare(page:Page,options:{dropFirst?:boolean;previewError?:string;writeError?:string}={}){
  const previews:Array<Record<string,any>>=[],writes:Array<Record<string,any>>=[];
  const preview=(payload:Record<string,any>,replace:boolean)=>{
    const rows=replace?payload.items:payload.physicalSources;
    const sum=(field:string)=>rows.reduce((n:number,row:Record<string,number>)=>n+(row[field]??0),0);
    const quantity=sum('quantity'),good=sum(replace?'goodQuantity':'sellable_restock_quantity'),bad=replace?quantity-good:sum('defect_non_sellable_quantity');
    return replace?{contractVersion:215,orderId:payload.orderId,previewFingerprint:quoteSeal,issuedQuantity:quantity,restockedQuantity:good,badQuantity:bad,moneyDifferenceInMinorUnits:0,customerDebtDeltaInMinorUnits:0}
      :{contractVersion:215,orderId:payload.orderId,previewFingerprint:quoteSeal,canConfirm:true,issues:[],goodQuantity:good,badQuantity:bad,customerDamageQuantity:sum('customer_damage_quantity'),entitlementInMinorUnits:String(quantity*1000),debtReductionInMinorUnits:'0',moneyRefundInMinorUnits:String(quantity*1000),refundMethod:'cash'};
  };
  for(const [action,replace] of [['preview_admin_sales_return_v2',false],['preview_inspected_sales_replacement_v2',true]] as const)
    await page.route('**/rest/v1/rpc/'+action,r=>{const req=r.request().postDataJSON();previews.push(req);return options.previewError?r.fulfill({status:400,json:{code:'P0001',message:options.previewError}}):r.fulfill({json:preview(req.p_payload,replace)});});
  for(const [action,replace] of [['settle_admin_sales_return_v2',false],['settle_inspected_sales_replacement_v2',true]] as const)
    await page.route('**/rest/v1/rpc/'+action,r=>{const req=r.request().postDataJSON();writes.push(req);if(options.dropFirst&&writes.length===1)return r.abort('failed');
      if(options.writeError)return r.fulfill({status:400,json:{code:'P0001',message:options.writeError}});
      const result=preview(req.p_payload,replace);return r.fulfill({json:{...result,success:true,operationId:proofId(1),...(replace?{replacementId:proofId(2),caseIds:[]}:{returnId:proofId(2),returnOperationId:proofId(3),returnNumber:'SRT-UI-TEST'}),idempotentReplay:writes.length>1}});});
  return{previews,writes};
}
export async function confirmCurrentAftercare(page:Page,intent:'refund'|'replace'){
  await page.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();await expect(page.getByTestId('aftercare215-preview')).toBeVisible();
  await page.getByRole('button',{name:intent==='refund'?'تأكيد الإرجاع':'تأكيد الاستبدال',exact:true}).click();
}
export async function mockInvoiceDamageCandidate(page:Page,orderId:string,sourceId:string){
  await page.route('**/rest/v1/rpc/get_damage_ledger_page_v2',r=>{
    const a=r.request().postDataJSON();return r.fulfill({json:{...damage215Page,from:a.p_from,to:a.p_to,state:a.p_state,page:a.p_page,periodLossInMinorUnits:'1000',
      quantitySummary:[{product_id:damageFixtureProductId,product_name:'عصير برتقال',pending_quantity:0,finished_supplier_quantity:0,final_owner_quantity:1}],
      rows:[{...damage215Row,source:'replacement',id:sourceId,productId:damageFixtureProductId,productName:'عصير برتقال',quantity:1,pendingQuantity:0,receivedQuantity:0,finishedSupplierQuantity:0,finalOwnerQuantity:1,states:[{state:'final_owner',quantity:1}],historicalParcelSize:null,parcelSizeKnown:false,
        reasonCode:'customer_replacement',document:{type:'order',id:orderId,number:'P6-B',returnNumber:null},
        unitCostInMinorUnitsExact:'1000.000000',periodLossInMinorUnits:'1000',
        movements:[{id:proofId(60),action:'customer_replacement',quantity:1,occurredAt:damage215Row.occurredAt,reason:'عيب من بديل تجريبي',lossDeltaInMinorUnits:'1000'}],
        actions:{cases:[],reclassification:{kind:'replacement',sourceId,blockedReason:null}}}]}});
  });
}
export async function openInvoiceDamageConversion(page:Page){
  await expect(page.getByRole('button',{name:'إرجاع أو استبدال',exact:true})).toBeEnabled();await page.getByText('التالف',{exact:true}).click();
  await page.getByText('⋯ قرارات المصدر',{exact:true}).click();await page.getByRole('button',{name:'حوّلها للمورد بانتظار البديل',exact:true}).click();
}
