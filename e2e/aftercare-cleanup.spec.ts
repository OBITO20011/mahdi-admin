import {test,expect,type Page} from './isolated-test';
import {wizard215Scenario,wizard215Order} from './aftercare215-wizard.fixture';
import {damage215Page} from './aftercare215-damage.fixture';
const id=(n:number)=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const seal='a'.repeat(64);
async function contextMock(page:Page,scenario='cash'){
  const {context}=wizard215Scenario(scenario);
  await page.route('**/rest/v1/rpc/get_admin_sales_aftercare_context_v1',r=>r.fulfill({json:context}));
}
for(const width of [390,1440]){
  test(`cleaned invoice has one entry, no legacy duplicate controls, and lazy real three-state damage UI at${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:900});await contextMock(page);let reads=0;
    await page.route('**/rest/v1/rpc/get_damage_ledger_page_v2',r=>{reads++;const args=r.request().postDataJSON(),raw=structuredClone(damage215Page);Object.assign(raw,{from:args.p_from,to:args.p_to,state:args.p_state,page:args.p_page});return r.fulfill({json:raw});});
    await page.goto('/e2e/aftercare-cleanup-harness.html');const panel=page.getByTestId('phase43-admin-aftercare');
    await expect(panel.getByRole('button',{name:'إرجاع أو استبدال',exact:true})).toBeEnabled();
    for(const name of ['مرتجع','استبدال طرد','إرجاع الطرد كاملاً','استبدال الطرد كاملاً','خيارات التالف النهائي'])await expect(panel.getByRole('button',{name,exact:true})).toHaveCount(0);
    expect(reads).toBe(0);await panel.locator('summary').filter({hasText:/^التالف$/}).click();
    await expect(panel.getByTestId('damage-history')).toBeVisible();
    await expect(panel.getByLabel('الحالة',{exact:true})).toHaveValue('all');
    await expect(panel.getByLabel('الحالة',{exact:true}).locator('option')).toHaveText(['كل الحالات','بانتظار المورد','انتهى مع المورد','خسارة نهائية عليّ']);
    await expect.poll(()=>reads).toBe(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`aftercare-cleanup-${width}.png`),fullPage:true});
  });
  test(`previous replacement is selected inside the wizard with its original source identity at${width}`,async({page})=>{
    await page.setViewportSize({width,height:900});await contextMock(page,'prior-leaf');let request:Record<string,any>|undefined;
    await page.route('**/rest/v1/rpc/preview_inspected_sales_replacement_v2',r=>{request=r.request().postDataJSON().p_payload;return r.fulfill({json:{contractVersion:215,orderId:wizard215Order.id,previewFingerprint:seal,issuedQuantity:1,restockedQuantity:0,badQuantity:1,moneyDifferenceInMinorUnits:0,customerDebtDeltaInMinorUnits:0}});});
    await page.goto('/e2e/aftercare-cleanup-harness.html?scenario=prior-leaf');await page.getByRole('button',{name:'إرجاع أو استبدال',exact:true}).click();
    await page.getByRole('button',{name:'يبدّل',exact:true}).click();await page.getByRole('button',{name:'التالي',exact:true}).click();
    await page.locator('summary').filter({hasText:'متقدم · البديل الذي أعطيته · عصير تجريبي'}).click();
    await page.getByRole('button',{name:'البديل الذي أعطيته · عصير تجريبي · 1 · المتبقي 2 باكيت',exact:true}).click();
    await page.getByRole('button',{name:'التالي',exact:true}).click();await page.getByLabel('الخربان · عصير تجريبي',{exact:true}).fill('1');
    await page.getByLabel('فحصت الباكيتات الراجعة',{exact:true}).check();await page.getByRole('button',{name:'التالي',exact:true}).click();
    await page.getByRole('button',{name:'خسارة عليّ — تالف نهائي',exact:true}).click();await page.getByRole('button',{name:'التالي',exact:true}).click();
    await page.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();await expect(page.getByTestId('aftercare215-preview')).toBeVisible();
    expect(request?.items).toEqual([{sourceKind:'replacement_item',sourceId:id(23),quantity:1,goodQuantity:0,supplierId:null}]);
    await expect(page.locator('body')).not.toContainText(id(23));
  });
  test(`formed prior replacement is selected without losing its flavor or exposing internal IDs at${width}`,async({page})=>{
    await page.setViewportSize({width,height:900});await contextMock(page,'formed-prior');let request:Record<string,any>|undefined;
    await page.route('**/rest/v1/rpc/preview_inspected_sales_replacement_v2',r=>{request=r.request().postDataJSON().p_payload;return r.fulfill({json:{contractVersion:215,orderId:wizard215Order.id,previewFingerprint:seal,issuedQuantity:1,restockedQuantity:0,badQuantity:1,moneyDifferenceInMinorUnits:0,customerDebtDeltaInMinorUnits:0}});});
    await page.goto('/e2e/aftercare-cleanup-harness.html?scenario=formed-prior');await page.getByRole('button',{name:'إرجاع أو استبدال',exact:true}).click();
    await page.getByRole('button',{name:'يبدّل',exact:true}).click();await page.getByRole('button',{name:'التالي',exact:true}).click();
    await page.locator('summary').filter({hasText:'متقدم · البديل الذي أعطيته · طرد مشكّل 1'}).click();
    await page.getByRole('button',{name:'البديل الذي أعطيته · توت · 1 · المتبقي 1 باكيت',exact:true}).click();
    await page.getByRole('button',{name:'التالي',exact:true}).click();await page.getByLabel('الخربان · توت',{exact:true}).fill('1');
    await page.getByLabel('فحصت الباكيتات الراجعة',{exact:true}).check();await page.getByRole('button',{name:'التالي',exact:true}).click();
    await page.getByRole('button',{name:'خسارة عليّ — تالف نهائي',exact:true}).click();await page.getByRole('button',{name:'التالي',exact:true}).click();
    await page.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();await expect(page.getByTestId('aftercare215-preview')).toBeVisible();
    expect(request?.items).toEqual([{sourceKind:'replacement_item',sourceId:id(90),quantity:1,goodQuantity:0,supplierId:null}]);await expect(page.locator('body')).not.toContainText(id(90));
  });
  test(`manager keeps normal wizard capability while the rare owner source selector stays hidden at${width}`,async({page})=>{
    await page.setViewportSize({width,height:900});await contextMock(page,'prior-leaf');await page.goto('/e2e/aftercare-cleanup-harness.html?scenario=prior-leaf&role=manager');
    await page.getByRole('button',{name:'إرجاع أو استبدال',exact:true}).click();await page.getByRole('button',{name:'يبدّل',exact:true}).click();await page.getByRole('button',{name:'التالي',exact:true}).click();
    await expect(page.locator('summary').filter({hasText:/متقدم · البديل الذي أعطيته/})).toHaveCount(0);
    await page.getByRole('button',{name:'طرد كامل',exact:true}).click();await page.getByRole('button',{name:'التالي',exact:true}).click();
    await expect(page.getByText('البديل الذي أعطيته · 2 باكيت',{exact:true})).toBeVisible();await expect(page.getByLabel('الخربان · عصير تجريبي',{exact:true})).toHaveCount(2);
  });
  test(`old replacement recovery remains visible and reuses the same saved request after button removal at${width}`,async({page})=>{
    await page.setViewportSize({width,height:900});await contextMock(page);await page.goto('/e2e/aftercare-cleanup-harness.html');
    await expect(page.getByRole('button',{name:'إرجاع أو استبدال',exact:true})).toBeEnabled();
    const oldRequest={items:[{sourceKind:'base_order_item',sourceId:id(2),quantity:12}],reason:'عيب في الطرد',notes:null};
    const original=await page.evaluate(async({actor,order,request})=>{
      // @ts-expect-error Real Vite module, isolated origin only.
      const {runAdminAftercareMutation}=await import('/src/services/supabase/adminAftercareRecovery.ts');
      let key='';try{await runAdminAftercareMutation({auth:{getUser:async()=>({data:{user:{id:actor}},error:null})}} as never,order,'replacement','START_NEW',request,async(k:string)=>{key=k;throw Error('synthetic lost reply');});}catch{/* Persist a real unknown browser recovery record. */}
      return key;
    },{actor:id(70),order:wizard215Order.id,request:oldRequest});
    expect(original).toMatch(/^phase43:/);let restored:Record<string,any>|undefined;
    await page.route('**/rest/v1/rpc/settle_sales_replacement_v1',r=>{restored=r.request().postDataJSON();return r.fulfill({json:{success:true,orderId:wizard215Order.id,operationId:id(80),replacementId:id(81),operationalCoordinatorVersion:403,issuedQuantity:12,replacementCogsInMinorUnits:6000,moneyRefundInMinorUnits:0,debtReductionInMinorUnits:0}});});
    await page.reload();await expect(page.getByRole('button',{name:'استعادة الاستبدال',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'إرجاع أو استبدال',exact:true})).toBeDisabled();await page.getByRole('button',{name:'استعادة الاستبدال',exact:true}).click();
    await expect(page.locator('output[role="status"]')).toContainText('تم استرداد نتيجة الاستبدال');expect(restored?.p_idempotency_key).toBe(original);
    expect(restored?.p_items).toEqual(oldRequest.items);expect(restored?.p_reason).toBe(oldRequest.reason);await expect(page.getByRole('button',{name:'إرجاع أو استبدال',exact:true})).toBeEnabled();
  });
  test(`supplier pending packet text and decision explanations keep existing receive payload at${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:900});const calls:Record<string,any>[]=[];
    const item={id:id(91),supplierId:id(92),supplierName:'مورد تجريبي',productId:id(3),productName:'مشروب تجريبي',warehouseId:id(5),branchId:id(4),origin:'shop',quantity:24,commercialQuantity:2,unitsPerCommercialUnit:12,unitName:'طرد',baseUnitName:'قنينة / زجاجة',pendingQuantity:14,receivedQuantity:10,writtenOffQuantity:0,occurredAt:'2026-10-28T10:00:00Z',events:[]};
    await page.route('**/rest/v1/rpc/get_supplier_replacement_options_v1',r=>r.fulfill({json:{contractVersion:208,products:[],suppliers:[],warehouses:[],lastSuppliers:[]}}));
    await page.route('**/rest/v1/rpc/get_supplier_replacements_page_v1',r=>r.fulfill({json:{contractVersion:208,page:1,pageSize:25,totalCount:1,pendingQuantity:14,cases:[item]}}));
    await page.route('**/rest/v1/rpc/preview_supplier_replacement_v1',r=>{calls.push(r.request().postDataJSON());return r.fulfill({json:{contractVersion:208,action:'receive',eligible:true,blockedReason:null}});});
    await page.goto('/e2e/supplier-replacement208-harness.html');await page.getByRole('button',{name:'المعلّق',exact:true}).click();
    const card=page.getByTestId('replacement-case');await expect(card).toContainText('المعلّق 1 طرد + 2 باكيت');await expect(card).toContainText('استُلم 10 باكيت');
    await expect(card).not.toContainText('قنينة');await expect(card).toContainText('تدخل المخزون، بلا مال');await expect(card).toContainText('والباقي يبقى معلّقاً');await expect(card).toContainText('وبحد ما عليك له');await expect(card).toContainText('إذا رفض المورد: سجّلها خسارة من السجل');
    await card.getByRole('button',{name:'استلام المتبقي (14)',exact:true}).click();await expect(card.getByRole('button',{name:'تأكيد الاستلام',exact:true})).toBeVisible();
    expect(calls[0].p_payload).toEqual({caseId:id(91),quantity:14,reason:'وصل البديل من المورد'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`supplier-help-${width}.png`),fullPage:true});
  });
}
