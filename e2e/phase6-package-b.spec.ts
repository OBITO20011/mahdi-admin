import {test,expect} from './isolated-test';
import {phase6AftercareFixture as context} from './phase6-package-b.fixture';
import {openAftercare,finishCurrentInspection,mockCurrentAftercare,confirmCurrentAftercare,mockInvoiceDamageCandidate,openInvoiceDamageConversion,damageFixtureProductId} from './aftercare-current-ui';
const url='/e2e/phase6-package-b-harness.html';
const supplier211='88880000-0000-4000-8000-000000000003';
export const options211={contractVersion:208,products:[{id:'juice',name:'عصير برتقال',sku:'JUICE',baseUnitName:'باكيت',unitsPerParcel:1}],suppliers:[{id:supplier211,name:'المورد الموثق'}],warehouses:[],lastSuppliers:[{productId:'juice',supplierId:supplier211,supplierName:'المورد الموثق'},{productId:damageFixtureProductId,supplierId:supplier211,supplierName:'المورد الموثق'}]};
test.beforeEach(async({page})=>{await page.setViewportSize({width:390,height:844});await page.route('**/rest/v1/rpc/get_admin_sales_aftercare_context_v1',r=>r.fulfill({json:context}));});

test('J saved flavor names hide parcel UUID; invalid inspection names the piece and sends zero writes',async({page})=>{
 const fresh=structuredClone(context),internal='41bb6c3c-cdc3-4240-8000-000000000001';fresh.parcelInstances[0].parcelInstanceId=internal;
 await page.route('**/rest/v1/rpc/get_admin_sales_aftercare_context_v1',r=>r.fulfill({json:fresh}));const calls=await mockCurrentAftercare(page);
 await page.goto(url);await openAftercare(page,'refund','الطرد المشكّل كاملاً');await expect(page.locator('body')).not.toContainText(internal);
 await expect(page.getByText('البديل الذي أعطيته · 3 باكيت',{exact:true})).toBeVisible();await page.getByLabel('الخربان · عصير برتقال',{exact:true}).fill('4');
 await page.getByLabel('فحصت الباكيتات الراجعة',{exact:true}).check();await page.getByRole('button',{name:'التالي',exact:true}).click();
 await expect(page.getByRole('alert').first()).toContainText('عصير برتقال');await expect(page.getByRole('alert').first()).toContainText('بين 0 و3 باكيت');expect(calls.previews).toHaveLength(0);expect(calls.writes).toHaveLength(0);
});

test('J owner supplier replacement uses one current atomic call and exact lost-response recovery across reload',async({page})=>{
 await page.route('**/rest/v1/rpc/get_supplier_replacement_options_v1',r=>r.fulfill({json:options211}));const calls=await mockCurrentAftercare(page,{dropFirst:true});let oldWrites=0;
 await page.route('**/rest/v1/rpc/execute_aftercare_supplier_v1',r=>{oldWrites++;return r.abort();});
 await page.goto(url);await openAftercare(page,'replace','تبديل المعيب · عصير برتقال');await finishCurrentInspection(page,'all',supplier211);await confirmCurrentAftercare(page,'replace');
 await expect(page.getByRole('button',{name:'استعادة الاستبدال المفحوص',exact:true})).toBeVisible();expect(calls.writes).toHaveLength(1);expect(oldWrites).toBe(0);
 await page.reload();await page.getByRole('button',{name:'استعادة الاستبدال المفحوص',exact:true}).click();await expect(page.getByTestId('notice')).toContainText('استرداد نتيجة الاستبدال');
 expect(calls.writes).toHaveLength(2);expect(calls.writes[1]).toEqual(calls.writes[0]);expect(calls.writes[0].p_payload.items).toEqual([{sourceKind:'replacement_item',sourceId:'leaf',quantity:1,goodQuantity:0,supplierId:supplier211}]);expect(calls.previews).toHaveLength(1);expect(oldWrites).toBe(0);
});

test('J safety action moves to three-state damage; preview precedes confirmation and old scope recovers across reload',async({page})=>{
 const sourceId='41bb6c3c-cdc3-4240-8000-000000000001',requests:Array<Record<string,any>>=[];let previews=0;
 await mockInvoiceDamageCandidate(page,context.order.id,sourceId);
 await page.route('**/rest/v1/rpc/get_supplier_replacement_options_v1',r=>r.fulfill({json:options211}));
 await page.route('**/rest/v1/rpc/preview_aftercare_supplier_v1',r=>{previews++;expect(r.request().postDataJSON()).toEqual({p_kind:'replacement',p_source_id:sourceId,p_supplier_id:supplier211});return r.fulfill({json:{contractVersion:211,sourceKind:'replacement',sourceId,supplierId:supplier211,quantity:1,reclassifiedInMinorUnits:1000,previewFingerprint:'a'.repeat(64),eligible:true,blockedReason:null}});});
 await page.route('**/rest/v1/rpc/execute_aftercare_supplier_v1',r=>{const request=r.request().postDataJSON();requests.push(request);if(requests.length===1)return r.abort();return r.fulfill({json:{success:true,contractVersion:208,action:request.p_action,idempotencyKey:request.p_idempotency_key,idempotent:true,operationId:'convert-op',cases:[{id:'supplier-case',supplierId:supplier211,supplierName:'المورد الموثق',productId:'juice',productName:'عصير برتقال',warehouseId:'warehouse',branchId:'branch',origin:'customer_replacement',quantity:1,commercialQuantity:1,unitsPerCommercialUnit:1,unitName:'باكيت',baseUnitName:'باكيت',pendingQuantity:1,receivedQuantity:0,writtenOffQuantity:0,occurredAt:'2026-10-23T01:00:00Z',events:[]}]}});});
 await page.goto(url);await expect(page.getByRole('button',{name:'إرجاع أو استبدال',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'خيارات التالف النهائي',exact:true})).toHaveCount(0);await openInvoiceDamageConversion(page);await expect(page.locator('body')).not.toContainText(sourceId);
 await expect(page.getByLabel('مورد التالف',{exact:true})).toHaveValue(supplier211);await page.getByLabel('سبب تحويل التالف',{exact:true}).fill('اتفقنا مع المورد على الاستبدال');
 await page.getByRole('button',{name:'معاينة تحويل التالف',exact:true}).click();await expect(page.getByText('سيُعلّق 1 باكيت للمورد بقيمة تاريخية 1.000 د.أ.',{exact:true})).toBeVisible();expect(previews).toBe(1);expect(requests).toHaveLength(0);
 await page.getByRole('button',{name:'اعتماد تحويل التالف',exact:true}).click();await expect(page.getByRole('button',{name:'استعادة تحويل التالف للمورد',exact:true})).toBeVisible();
 await page.reload();await page.getByRole('button',{name:'استعادة تحويل التالف للمورد',exact:true}).click();await expect(page.getByTestId('notice')).toContainText('استرداد نتيجة تحويل التالف للمورد');
 expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);expect(requests[0].p_payload).toEqual({sourceId,supplierId:supplier211,reason:'اتفقنا مع المورد على الاستبدال',previewFingerprint:'a'.repeat(64)});expect(requests[0].p_action).toBe('reclassify_replacement');
});

test('J supplier disposition and damage actions stay absent for admin; inspected final replacement remains available',async({page})=>{
 let supplierReads=0;await page.route('**/rest/v1/rpc/get_aftercare_damage_candidates_v1',r=>{supplierReads++;return r.abort();});const calls=await mockCurrentAftercare(page);
 await page.goto(url+'?role=admin');await openAftercare(page,'replace','تبديل المعيب · عصير برتقال');
 for(const field of await page.getByLabel(/^الخربان ·/).all())await field.fill('1');await page.getByLabel('فحصت الباكيتات الراجعة',{exact:true}).check();await page.getByRole('button',{name:'التالي',exact:true}).click();
 await expect(page.getByRole('button',{name:'على المورد — بانتظار البديل',exact:true})).toHaveCount(0);await expect(page.getByText('التالف',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'خسارة عليّ — تالف نهائي',exact:true}).click();await page.getByRole('button',{name:'التالي',exact:true}).click();
 await confirmCurrentAftercare(page,'replace');await expect.poll(()=>calls.writes.length).toBe(1);expect(calls.writes[0].p_payload.items[0].supplierId).toBe(null);expect(supplierReads).toBe(0);
});

test('208 owner supplier return uses the sealed coordinator with selected current physical leaves and reload recovery',async({page})=>{
 await page.route('**/rest/v1/rpc/get_supplier_replacement_options_v1',r=>r.fulfill({json:options211}));const calls=await mockCurrentAftercare(page,{dropFirst:true});let oldWrites=0;
 await page.route('**/rest/v1/rpc/execute_aftercare_supplier_v1',r=>{oldWrites++;return r.abort();});await page.goto(url);
 await openAftercare(page,'refund','باكيتات',3);await finishCurrentInspection(page,'all',supplier211);await confirmCurrentAftercare(page,'refund');await expect(page.getByRole('button',{name:'استعادة الإرجاع',exact:true})).toBeVisible();
 await page.reload();await page.getByRole('button',{name:'استعادة الإرجاع',exact:true}).click();await expect(page.getByTestId('notice')).toContainText('استرداد نتيجة');expect(calls.writes).toHaveLength(2);expect(calls.writes[1]).toEqual(calls.writes[0]);expect(oldWrites).toBe(0);
 const payload=calls.writes[0].p_payload;expect(payload.items).toEqual([{return_scope:'base_unit',order_item_id:'base-root',quantity:3,stock_disposition:'damaged'}]);
 expect(payload.supplierAssignments).toEqual([{sourceKind:'base_order_item',sourceId:'a',supplierId:supplier211},{sourceKind:'replacement_item',sourceId:'b',supplierId:supplier211}]);expect(payload.physicalSources.map((s:Record<string,unknown>)=>[s.source_id,s.defect_non_sellable_quantity])).toEqual([['a',2],['b',1]]);
});

test('partial return sends selected quantity and exact source allocation; invalid quantities and refused preview send no write',async({page})=>{
 const calls=await mockCurrentAftercare(page,{previewError:'AFTERCARE215_PREVIEW_CHANGED'});await page.goto(url);await page.getByRole('button',{name:'إرجاع أو استبدال',exact:true}).click();await page.getByRole('button',{name:'التالي',exact:true}).click();await page.getByRole('button',{name:'باكيتات',exact:true}).click();
 const qty=page.getByLabel('عدد الباكيتات الراجعة',{exact:true});await qty.fill('6');await page.getByRole('button',{name:'التالي',exact:true}).click();await expect(page.getByRole('alert').first()).toContainText('اختر كمية صحيحة');expect(calls.previews).toHaveLength(0);expect(calls.writes).toHaveLength(0);
 await qty.fill('3');await page.getByRole('button',{name:'التالي',exact:true}).click();await finishCurrentInspection(page);await page.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();await expect(page.getByRole('alert')).toContainText('تغيّرت البيانات منذ المعاينة');expect(calls.previews).toHaveLength(1);expect(calls.writes).toHaveLength(0);
 const payload=calls.previews[0].p_payload;expect(payload.items[0].quantity).toBe(3);expect(payload.physicalSources.map((r:Record<string,unknown>)=>[r.source_id,r.quantity])).toEqual([['a',2],['b',1]]);await expect(page.getByRole('alert')).not.toContainText('AFTERCARE215');
});

test('parcel names, good/bad/customer-damage totals and whole-parcel boundary remain explicit',async({page})=>{
 await page.goto(url);await page.getByRole('button',{name:'إرجاع أو استبدال',exact:true}).click();await page.getByRole('button',{name:'التالي',exact:true}).click();await page.getByRole('button',{name:'الطرد المشكّل كاملاً',exact:true}).click();await expect(page.getByLabel('عدد الطرود المشكّلة الراجعة',{exact:true})).toBeDisabled();await page.getByRole('button',{name:'التالي',exact:true}).click();
 const bad=page.getByLabel('الخربان · عصير برتقال',{exact:true});await bad.fill('1');await page.getByText('متقدم · ضرر من الزبون',{exact:true}).click();const damage=page.getByLabel('ضرر الزبون · عصير برتقال',{exact:true});await damage.fill('1');await expect(page.getByText('السليم الذي يرجع للمخزون: 1 باكيت',{exact:true})).toBeVisible();
 for(const input of [bad,damage])expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await damage.fill('3');await page.getByLabel('فحصت الباكيتات الراجعة',{exact:true}).check();await page.getByRole('button',{name:'التالي',exact:true}).click();await expect(page.getByRole('alert')).toContainText('عصير برتقال');
});

test('server preview rechecks changed physical capacity before confirmation and rejects with zero writes',async({page})=>{
 let reads=0;await page.route('**/rest/v1/rpc/get_admin_sales_aftercare_context_v1',r=>{reads++;return r.fulfill({json:context});});const calls=await mockCurrentAftercare(page,{previewError:'AFTERCARE215_PREVIEW_CHANGED'});await page.goto(url);await openAftercare(page,'refund','باكيتات',1);await finishCurrentInspection(page);await page.getByRole('button',{name:'معاينة التفاصيل',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('تغيّرت البيانات منذ المعاينة');expect(reads).toBe(1);expect(calls.previews).toHaveLength(1);expect(calls.writes).toHaveLength(0);await expect(page.getByRole('button',{name:'تأكيد الإرجاع',exact:true})).toHaveCount(0);
});
test('desktop/tablet expand; mobile shell dimensions and selectable operational identity remain', async ({page}, testInfo) => {
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 900});
    await page.goto(url);
    const screen = page.locator('[data-ui="admin-screen"]');
    await expect(screen).toBeVisible();
    const box = (await screen.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(width < 768 ? width - 1 : width - 40);
    expect(box.height).toBeGreaterThanOrEqual(width < 768 ? 899 : 865);
    await expect(page.getByText('9:41', {exact: true})).toHaveCount(0);
    expect(await page.getByTestId('selectable-identity').evaluate(node => getComputedStyle(node).userSelect)).not.toBe('none');
    const profile = page.locator('.admin-app-header').getByRole('button', {name: 'الملف الشخصي: المالك'});
    if (width < 1024) await expect(profile).toBeVisible();
    else await expect(profile).toBeHidden(); // Desktop profile belongs to the SideNav.
    if (width >= 768 && width < 1024) await expect(page.getByText('المالك', {exact: true}).last()).toBeVisible();
    else await expect(page.getByText('المالك', {exact: true}).last()).toBeHidden();
    await page.screenshot({path: testInfo.outputPath(`shell-${width}.png`)});
  }
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto(`${url}?preview=phone`);
  await expect(page.getByText('9:41', {exact: true})).toBeVisible();
  expect((await page.locator('[data-ui="admin-screen"]').boundingBox())!.width).toBeLessThanOrEqual(420);
});

test('mixed cart shows parcels and base units separately without changing the lines', async ({page}) => {
  await page.goto(`${url}?kind=cart`);
  const summary = `${(3).toLocaleString('ar-JO')} باكيت + ${(2).toLocaleString('ar-JO')} طرد`;
  await expect(page.getByText(summary, {exact: true}).first()).toBeVisible();
  await expect(page.getByText('وحدة العصير', {exact: true})).toBeVisible();
  await expect(page.getByText('طرد العصير', {exact: true})).toBeVisible();
  await expect(page.getByText(`${(5).toLocaleString('ar-JO')} طرد`, {exact: true})).toHaveCount(0);
});

test('translated connection failure still exposes the same current attempt immediately',async({page})=>{
 const calls=await mockCurrentAftercare(page,{dropFirst:true});await page.goto(url);await openAftercare(page,'replace','باكيتات',1);await finishCurrentInspection(page,'all');await confirmCurrentAftercare(page,'replace');
 await expect(page.getByRole('button',{name:'استعادة الاستبدال المفحوص',exact:true})).toBeVisible();await expect(page.getByText('لا تبدأ عملية جديدة قبل معرفة نتيجة المحاولة السابقة.',{exact:true})).toBeVisible();expect(calls.writes).toHaveLength(1);
 await expect(page.getByRole('button',{name:'إرجاع أو استبدال',exact:true})).toHaveCount(0);await expect(page.getByTestId('aftercare215-wizard').getByRole('button',{name:'تأكيد الاستبدال',exact:true})).toBeDisabled();
});
for(const only of [false,true])for(const action of ['unit','whole','return'] as const)test(`J ordinary parcel parcelOnly=${only} ${action}:fragmented leaves preserve full refund boundary`,async({page})=>{
 const fresh={...structuredClone(context),baseItems:[{...context.baseItems[0],quantity:10,remainingQuantity:10,commercialLineKind:'legacy_single_sku_parcel',unitsPerParcel:10,commercialQuantity:1,parcelOnly:only,
 physicalRepresentatives:context.baseItems[0].physicalRepresentatives.map((s,i)=>({...s,remainingQuantity:i===0?9:1}))}],parcelInstances:[]};
 await page.route('**/rest/v1/rpc/get_admin_sales_aftercare_context_v1',r=>r.fulfill({json:fresh}));const calls=await mockCurrentAftercare(page);await page.goto(url);
 const intent=action==='return'?'refund':'replace';await page.getByRole('button',{name:'إرجاع أو استبدال',exact:true}).click();if(intent==='replace')await page.getByRole('button',{name:'يبدّل',exact:true}).click();await page.getByRole('button',{name:'التالي',exact:true}).click();
 await expect(page.getByText('المتبقي 1 طرد',{exact:true})).toBeVisible();await page.getByRole('button',{name:action==='unit'?'باكيت معيب للتبديل فقط':'طرد كامل',exact:true}).click();
 if(action==='return'){const qty=page.getByLabel('عدد الطرود الراجعة',{exact:true});await qty.fill('2');await page.getByRole('button',{name:'التالي',exact:true}).click();await expect(page.getByRole('alert').first()).toContainText('اختر كمية صحيحة');expect(calls.previews).toHaveLength(0);await qty.fill('1');}
 await page.getByRole('button',{name:'التالي',exact:true}).click();await finishCurrentInspection(page,action==='return'?'none':'all');await confirmCurrentAftercare(page,intent);await expect.poll(()=>calls.writes.length).toBe(1);
 const payload=calls.writes[0].p_payload;if(action==='return'){expect(payload.items[0].quantity).toBe(10);expect(payload.physicalSources.map((r:Record<string,unknown>)=>[r.source_id,r.quantity])).toEqual([['a',9],['b',1]]);}
 else expect(payload.items).toEqual(action==='unit'?[{sourceKind:'base_order_item',sourceId:'a',quantity:1,goodQuantity:0,supplierId:null}]:[{sourceKind:'base_order_item',sourceId:'a',quantity:9,goodQuantity:0,supplierId:null},{sourceKind:'replacement_item',sourceId:'b',quantity:1,goodQuantity:0,supplierId:null}]);
});
test('J parcel-only mixed component keeps defective packet exchange and rejects partial money return',async({page})=>{
 const fresh=structuredClone(context);fresh.parcelInstances[0].components=fresh.parcelInstances[0].components.map(c=>({...c,parcelOnly:true}));await page.route('**/rest/v1/rpc/get_admin_sales_aftercare_context_v1',r=>r.fulfill({json:fresh}));await page.goto(url);
 await page.getByRole('button',{name:'إرجاع أو استبدال',exact:true}).click();await page.getByRole('button',{name:'التالي',exact:true}).click();await expect(page.getByRole('button',{name:'الطرد المشكّل كاملاً',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'تبديل المعيب · عصير برتقال',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'رجوع',exact:true}).click();await page.getByRole('button',{name:'يبدّل',exact:true}).click();await page.getByRole('button',{name:'التالي',exact:true}).click();await page.getByRole('button',{name:'تبديل المعيب · عصير برتقال',exact:true}).click();await page.getByRole('button',{name:'التالي',exact:true}).click();await expect(page.getByText('البديل الذي أعطيته · 1 باكيت',{exact:true})).toBeVisible();await page.getByLabel('فحصت الباكيتات الراجعة',{exact:true}).check();await page.getByRole('button',{name:'التالي',exact:true}).click();await expect(page.getByRole('alert')).toContainText('يجب أن تكون الباكيتات المختارة كلها معيبة');
});
