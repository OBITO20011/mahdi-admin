import {test, expect} from './isolated-test';

const url = '/e2e/phase6-package-b-harness.html';
import {phase6AftercareFixture as context} from './phase6-package-b.fixture';


const supplier211='88880000-0000-4000-8000-000000000003';
const options211={contractVersion:208,products:[{id:'juice',name:'عصير برتقال',sku:'JUICE',baseUnitName:'باكيت',unitsPerParcel:1}],suppliers:[{id:supplier211,name:'المورد الموثق'}],warehouses:[],lastSuppliers:[{productId:'juice',supplierId:supplier211,supplierName:'المورد الموثق'}]};
const case211={id:'supplier-case',supplierId:supplier211,supplierName:'المورد الموثق',productId:'juice',productName:'عصير برتقال',warehouseId:'warehouse',branchId:'branch',origin:'customer_replacement',quantity:1,commercialQuantity:1,unitsPerCommercialUnit:1,unitName:'باكيت',baseUnitName:'باكيت',pendingQuantity:1,receivedQuantity:0,writtenOffQuantity:0,occurredAt:'2026-10-23T01:00:00Z',events:[],unitCostInMinorUnitsExact:'1000.000000',pendingValueInMinorUnitsExact:'1000.000000'};

test('J saved flavor names hide parcel UUID; incomplete whole return names the missing piece with zero mutation',async({page})=>{
  const fresh=structuredClone(context),internal='41bb6c3c-cdc3-4240-8000-000000000001';fresh.parcelInstances[0].parcelInstanceId=internal;
  await page.route('**/rest/v1/rpc/get_admin_sales_aftercare_context_v1',route=>route.fulfill({json:fresh}));
  let writes=0;await page.route('**/rest/v1/rpc/settle_admin_sales_return_v1',route=>{writes++;return route.abort();});
  await page.goto(url);await expect(page.getByText('طرد مشكّل: عصير برتقال',{exact:true})).toBeVisible();await expect(page.locator('body')).not.toContainText(internal);
  await expect(page.getByRole('button',{name:'استبدال وحدة · عصير برتقال · البديل الذي أعطيته',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'إرجاع الطرد كاملاً',exact:true}).click();await expect(page.getByText('إرجاع الطرد كاملاً (كل حباته)',{exact:true})).toBeVisible();
  await expect(page.getByText('صنّف كل حبات الطرد:',{exact:false})).toContainText('ضرر العميل يُخصم من المبلغ المرجع');
  await page.getByRole('spinbutton').first().fill('0');await page.getByPlaceholder('سبب المرتجع',{exact:true}).fill('إرجاع كامل الطرد');await page.getByRole('button',{name:'اعتماد المرتجع',exact:true}).click();
  await expect(page.getByTestId('notice')).toContainText('أكمل تصنيف «عصير برتقال»');await expect(page.getByTestId('notice')).not.toContainText('PHASE43');expect(writes).toBe(0);
});

test('J owner supplier replacement uses one atomic call and exact lost-response recovery across reload',async({page})=>{
  const requests:Record<string,unknown>[]=[];let oldWrites=0;
  await page.route('**/rest/v1/rpc/get_supplier_replacement_options_v1',route=>route.fulfill({json:options211}));
  await page.route('**/rest/v1/rpc/settle_admin_sales_replacement_v1',route=>{oldWrites++;return route.abort();});
  await page.route('**/rest/v1/rpc/execute_aftercare_supplier_v1',route=>{const req=route.request().postDataJSON();requests.push(req);if(requests.length===1)return route.abort();return route.fulfill({json:{success:true,contractVersion:208,action:req.p_action,idempotencyKey:req.p_idempotency_key,idempotent:true,operationId:'atomic-op',cases:[case211]}});});
  await page.goto(url);await page.getByRole('button',{name:'استبدال وحدة · عصير برتقال · البديل الذي أعطيته',exact:true}).click();
  await page.getByLabel('مصير الحبة المعيبة',{exact:true}).selectOption('supplier');await expect(page.getByLabel('المورد',{exact:true})).toHaveValue(supplier211);
  await expect(page.getByText('قيمة الحبة المعيبة تبقى معلّقة؛',{exact:false})).toContainText('فرق تكلفة البديل يبقى على الربح');
  await page.getByPlaceholder('سبب العيب/الاستبدال',{exact:true}).fill('عيب المورد في الحبة');await page.getByRole('button',{name:'اعتماد الاستبدال',exact:true}).click();
  await expect(page.getByRole('button',{name:'استعادة الاستبدال المرسل للمورد',exact:true})).toBeVisible();expect(oldWrites).toBe(0);expect(requests.length).toBe(1);
  await page.reload();await page.getByRole('button',{name:'استعادة الاستبدال المرسل للمورد',exact:true}).click();await expect(page.getByTestId('notice')).toContainText('استرداد نتيجة الاستبدال المرتبط بالمورد');
  expect(requests.length).toBe(2);expect(requests[1]).toEqual(requests[0]);expect(requests[0].p_action).toBe('replacement_supplier');
  expect(requests[0].p_payload).toEqual({orderId:context.order.id,items:[{sourceKind:'replacement_item',sourceId:'leaf',quantity:1}],reason:'عيب المورد في الحبة',notes:null,supplierId:supplier211});expect(oldWrites).toBe(0);
});

test('J safety action stays in options; real service preview precedes confirmation; lost-response recovery repeats exact request',async({page})=>{
  const sourceId='41bb6c3c-cdc3-4240-8000-000000000001',requests:Record<string,unknown>[]=[];let previews=0;
  await page.route('**/rest/v1/rpc/get_aftercare_damage_candidates_v1',route=>route.fulfill({json:{contractVersion:211,candidates:[{kind:'replacement',id:sourceId,productId:'juice',productName:'عصير برتقال',quantity:1,occurredAt:'2026-10-23T01:00:00Z',blockedReason:null}]}}));
  await page.route('**/rest/v1/rpc/get_supplier_replacement_options_v1',route=>route.fulfill({json:options211}));
  await page.route('**/rest/v1/rpc/preview_aftercare_supplier_v1',route=>{previews++;expect(route.request().postDataJSON()).toEqual({p_kind:'replacement',p_source_id:sourceId,p_supplier_id:supplier211});return route.fulfill({json:{contractVersion:211,sourceKind:'replacement',sourceId,supplierId:supplier211,quantity:1,reclassifiedInMinorUnits:1000,previewFingerprint:'a'.repeat(64),eligible:true,blockedReason:null}});});
  await page.route('**/rest/v1/rpc/execute_aftercare_supplier_v1',route=>{const req=route.request().postDataJSON();requests.push(req);if(requests.length===1)return route.abort();return route.fulfill({json:{success:true,contractVersion:208,action:req.p_action,idempotencyKey:req.p_idempotency_key,idempotent:true,operationId:'convert-op',cases:[case211]}});});
  await page.goto(url);await expect(page.getByRole('button',{name:'حوّله للمورد بانتظار البديل',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'خيارات التالف النهائي',exact:true}).click();await page.getByRole('button',{name:'حوّله للمورد بانتظار البديل',exact:true}).click();await expect(page.locator('body')).not.toContainText(sourceId);
  await expect(page.getByLabel('مورد التالف',{exact:true})).toHaveValue(supplier211);await page.getByLabel('سبب تحويل التالف',{exact:true}).fill('اتفقنا مع المورد على الاستبدال');
  await page.getByRole('button',{name:'معاينة تحويل التالف',exact:true}).click();await expect(page.getByText('سيُعلّق 1 حبة للمورد بقيمة تاريخية 1.000 د.أ.',{exact:true})).toBeVisible();expect(previews).toBe(1);expect(requests.length).toBe(0);
  await page.getByRole('button',{name:'اعتماد تحويل التالف',exact:true}).click();await expect(page.getByRole('button',{name:'استعادة تحويل التالف للمورد',exact:true})).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'استعادة تحويل التالف للمورد',exact:true}).click();await expect(page.getByTestId('notice')).toContainText('استرداد نتيجة تحويل التالف للمورد');
  expect(requests.length).toBe(2);expect(requests[1]).toEqual(requests[0]);expect(requests[0].p_payload).toEqual({sourceId,supplierId:supplier211,reason:'اتفقنا مع المورد على الاستبدال',previewFingerprint:'a'.repeat(64)});expect(requests[0].p_action).toBe('reclassify_replacement');
});

test('J supplier disposition and safety actions are absent for admin; final replacement remains available',async({page})=>{
  let supplierReads=0;await page.route('**/rest/v1/rpc/get_aftercare_damage_candidates_v1',route=>{supplierReads++;return route.abort();});
  await page.goto(url+'?role=admin');await expect(page.getByRole('button',{name:'خيارات التالف النهائي',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'استبدال وحدة · عصير برتقال · البديل الذي أعطيته',exact:true}).click();
  await expect(page.getByLabel('مصير الحبة المعيبة',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'اعتماد الاستبدال',exact:true})).toBeVisible();expect(supplierReads).toBe(0);
});
test.beforeEach(async ({page}) => {
  await page.route('**/rest/v1/rpc/get_admin_sales_aftercare_context_v1', route => route.fulfill({json: context}));
});

test('208 owner supplier destination submits one atomic coordinator with exact physical leaves and reload recovery',async({page})=>{
  const supplierId='88880000-0000-4000-8000-000000000003',requests:Record<string,unknown>[]=[];let oldWrites=0;
  await page.route('**/rest/v1/rpc/get_supplier_replacement_options_v1',route=>route.fulfill({json:{contractVersion:208,products:[{id:'juice',name:'عصير فراولة',sku:'JUICE',baseUnitName:'باكيت',unitsPerParcel:1}],suppliers:[{id:supplierId,name:'المورد الموثق'}],warehouses:[],lastSuppliers:[{productId:'juice',supplierId,supplierName:'المورد الموثق'}]}}));
  await page.route('**/rest/v1/rpc/settle_admin_sales_return_v1',route=>{oldWrites++;return route.abort();});
  await page.route('**/rest/v1/rpc/execute_supplier_replacement_v1',route=>{
    const req=route.request().postDataJSON();requests.push(req);if(requests.length===1)return route.abort();
    return route.fulfill({json:{success:true,contractVersion:208,action:'customer_return',idempotencyKey:req.p_idempotency_key,idempotent:true,operationId:'op',returnResult:{success:true},cases:[{
      id:'case',supplierId,supplierName:'المورد الموثق',productId:'juice',productName:'عصير فراولة',warehouseId:'warehouse',branchId:'branch',origin:'customer_return',quantity:3,commercialQuantity:3,unitsPerCommercialUnit:1,unitName:'باكيت',baseUnitName:'باكيت',pendingQuantity:3,receivedQuantity:0,writtenOffQuantity:0,occurredAt:'2026-10-21T10:00:00Z',events:[],unitCostInMinorUnitsExact:'60.000000',pendingValueInMinorUnitsExact:'180.000000'}]}});
  });
  await page.goto(url);await page.getByRole('button',{name:'مرتجع',exact:true}).click();await page.getByLabel('كمية المرتجع',{exact:true}).fill('3');await page.getByRole('button',{name:'غير قابل للبيع',exact:true}).click();
  await page.getByRole('combobox',{name:'مصير عيب المورد غير القابل للبيع',exact:true}).selectOption('supplier');await expect(page.getByRole('combobox',{name:'المورد',exact:true})).toHaveValue(supplierId);
  await page.getByPlaceholder('سبب المرتجع',{exact:true}).fill('عيب المورد في البضاعة');await page.getByRole('button',{name:'اعتماد المرتجع',exact:true}).click();await expect.poll(()=>requests.length).toBe(1);
  await expect(page.getByRole('button',{name:'استعادة المرتجع المرسل للمورد'})).toBeVisible();await page.reload();await page.getByRole('button',{name:'استعادة المرتجع المرسل للمورد'}).click();
  await expect(page.getByTestId('notice')).toContainText('استرداد نتيجة المرتجع المرتبط بالمورد');expect(requests.length).toBe(2);expect(requests[1]).toEqual(requests[0]);expect(oldWrites).toBe(0);
  expect(requests[0].p_action).toBe('customer_return');const payload=requests[0].p_payload as Record<string,unknown>;
  expect(payload.items).toEqual([{return_scope:'base_unit',order_item_id:'base-root',quantity:3,stock_disposition:'damaged'}]);
  expect(payload.supplierAssignments).toEqual([{sourceKind:'base_order_item',sourceId:'a',supplierId},{sourceKind:'replacement_item',sourceId:'b',supplierId}]);
  expect((payload.physicalSources as Array<{source_id:string;defect_non_sellable_quantity:number}>).map(s=>[s.source_id,s.defect_non_sellable_quantity])).toEqual([['a',2],['b',1]]);
});
test('partial return sends selected quantity and exact current source allocation; invalid quantities send nothing', async ({page}) => {
  let calls = 0;
  let payload: Record<string, unknown> | null = null;
  await page.route('**/rest/v1/rpc/settle_admin_sales_return_v1', route => {
    calls++; payload = route.request().postDataJSON();
    return route.fulfill({status: 400, json: {code: 'P0001', message: 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED'}});
  });
  await page.goto(url);
  await expect(page.getByText('عصير فراولة · المتبقي 5 وحدة')).toBeVisible();
  await page.getByRole('button', {name: 'مرتجع', exact: true}).click();
  await page.getByPlaceholder('سبب المرتجع', {exact: true}).fill('مرتجع اختبار');
  await page.getByLabel('كمية المرتجع', {exact: true}).fill('6');
  await page.getByRole('button', {name: 'اعتماد المرتجع'}).click();
  await expect(page.getByTestId('notice')).toContainText('اختر كمية صحيحة');
  expect(calls).toBe(0);
  await page.getByLabel('كمية المرتجع', {exact: true}).fill('3');
  await page.getByRole('button', {name: 'اعتماد المرتجع'}).click();
  await expect.poll(() => calls).toBe(1);
  expect((payload!.p_items as Array<{quantity: number}>)[0].quantity).toBe(3);
  expect((payload!.p_physical_sources as Array<{source_id: string; quantity: number}>).map(row => [row.source_id, row.quantity])).toEqual([['a', 2], ['b', 1]]);
  await expect(page.getByTestId('notice')).toContainText('الكمية المتبقية');
  await expect(page.getByTestId('notice')).not.toContainText('PHASE4_');
});
test('parcel names, three-bucket totals and whole-parcel boundary remain explicit', async ({page}) => {
  await page.goto(url);
  await page.getByRole('button', {name: 'إرجاع الطرد كاملاً', exact: true}).click();
  await expect(page.getByText('عصير برتقال · 3 وحدة')).toBeVisible();
  await expect(page.getByLabel('كمية المرتجع', {exact: true})).toHaveCount(0);
  const leaf = page.locator('div').filter({has: page.getByText('القطعة الحالية 1 · البديل الذي أعطيته · 3 وحدة', {exact: true})}).filter({has: page.getByText('مجموع التصنيف: 3 / 3', {exact: true})}).last();
  await expect(leaf.getByRole('spinbutton')).toHaveCount(3);
  await leaf.getByRole('spinbutton').first().fill('1');
  await expect(page.getByText('مجموع التصنيف: 1 / 3', {exact: true})).toBeVisible();
  for (const input of await leaf.getByRole('spinbutton').all()) {
    expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test('partial return re-reads capacity immediately before submit and rejects changed physical quantity', async ({page}) => {
  let reads = 0; let writes = 0;
  await page.route('**/rest/v1/rpc/get_admin_sales_aftercare_context_v1', route => {
    reads++;
    const fresh = structuredClone(context);
    if (reads > 1) fresh.baseItems[0].physicalRepresentatives[0].remainingQuantity = 1;
    return route.fulfill({json: fresh});
  });
  await page.route('**/rest/v1/rpc/settle_admin_sales_return_v1', route => {
    writes++; return route.fulfill({json: {success: true}});
  });
  await page.goto(url);
  await page.getByRole('button', {name: 'مرتجع', exact: true}).click();
  await page.getByPlaceholder('سبب المرتجع', {exact: true}).fill('مرتجع اختبار');
  await page.getByLabel('كمية المرتجع', {exact: true}).fill('1');
  await page.getByRole('button', {name: 'اعتماد المرتجع'}).click();
  await expect(page.getByTestId('notice')).toContainText('تغيّرت الكمية المتبقية');
  expect(reads).toBe(2); expect(writes).toBe(0);
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

test('translated connection failure still exposes same-attempt recovery immediately', async ({page}) => {
  await page.route('**/rest/v1/rpc/settle_sales_replacement_v1', route => route.abort('failed'));
  await page.goto(url);
  await page.getByRole('button', {name: 'استبدال وحدة', exact: true}).click();
  await page.getByPlaceholder('سبب العيب/الاستبدال').fill('عيب مصنعي');
  await page.getByRole('button', {name: 'اعتماد الاستبدال', exact: true}).click();
  await expect(page.getByTestId('notice')).toContainText(/المحاولة السابقة|نفس المحاولة/);
  await expect(page.getByRole('button', {name: 'استعادة الاستبدال', exact: true})).toBeVisible();
  await expect(page.getByText('لا تبدأ عملية جديدة قبل معرفة نتيجة المحاولة السابقة.')).toBeVisible();
});

for(const only of [false,true])for(const action of ['unit','whole','return'] as const)test(`J defective ordinary parcel parcelOnly=${only} ${action}:fragmented leaves keep full money refund boundary`,async({page})=>{
 const fresh={...structuredClone(context),order:{...context.order,completedAt:'2026-09-30T10:00:00Z'},
  baseItems:[{...context.baseItems[0],quantity:10,remainingQuantity:10,commercialLineKind:'legacy_single_sku_parcel',unitsPerParcel:10,commercialQuantity:1,parcelOnly:only,
   physicalRepresentatives:context.baseItems[0].physicalRepresentatives.map((source,i)=>({...source,remainingQuantity:i===0?9:1}))}],parcelInstances:[]};
 await page.route('**/rest/v1/rpc/get_admin_sales_aftercare_context_v1',route=>route.fulfill({json:fresh}));
 let request:Record<string,unknown>|null=null;
 await page.route('**/rest/v1/rpc/settle_sales_replacement_v1',route=>{request=route.request().postDataJSON();return route.fulfill({json:{success:true,operationalCoordinatorVersion:403,operationId:'replacement',issuedQuantity:action==='unit'?1:10,moneyRefundInMinorUnits:0,debtReductionInMinorUnits:0}});});
 await page.route('**/rest/v1/rpc/settle_admin_sales_return_v1',route=>{request=route.request().postDataJSON();return route.fulfill({json:{success:true,operationId:'return'}});});
 await page.goto(url);await expect(page.getByText('عصير فراولة · المتبقي 1 طرد',{exact:true})).toBeVisible();
 if(action==='return'){
  await page.getByRole('button',{name:'مرتجع',exact:true}).click();
  const quantity=page.getByRole('spinbutton').first();await expect(quantity).toHaveAttribute('min','1');await expect(quantity).toHaveAttribute('max','1');
  await page.getByPlaceholder('سبب المرتجع',{exact:true}).fill('إرجاع الطرد بكل حباته');await page.getByRole('button',{name:'اعتماد المرتجع',exact:true}).click();
  await expect.poll(()=>request).not.toBeNull();expect(request!.p_items).toEqual([{return_scope:'base_unit',order_item_id:'base-root',quantity:10,stock_disposition:'restock'}]);
  expect((request!.p_physical_sources as Array<{source_id:string;quantity:number}>).map(x=>[x.source_id,x.quantity])).toEqual([['a',9],['b',1]]);
 }else{
  await page.getByRole('button',{name:action==='unit'?'تبديل حبة معيبة':'استبدال طرد',exact:true}).click();
  await expect(page.getByText('التبديل من نفس الصنف والكمية فقط. لا يُرد مال عن حبة من طرد.',{exact:true})).toBeVisible();
  if(action==='unit')await expect(page.getByLabel('عدد طرود الاستبدال',{exact:true})).toHaveCount(0);
  await page.getByPlaceholder('سبب العيب/الاستبدال',{exact:true}).fill('حبة معيبة من الطرد');await page.getByRole('button',{name:'اعتماد الاستبدال',exact:true}).click();
  await expect.poll(()=>request).not.toBeNull();expect(request!.p_items).toEqual(action==='unit'?[{sourceKind:'base_order_item',sourceId:'a',quantity:1}]:[{sourceKind:'base_order_item',sourceId:'a',quantity:9},{sourceKind:'replacement_item',sourceId:'b',quantity:1}]);
 }
});

test('J parcel-only mixed component still exposes defective-unit exchange without a partial return action',async({page})=>{
 const fresh=structuredClone(context);const parcel={...fresh.parcelInstances[0],components:fresh.parcelInstances[0].components.map(c=>({...c,parcelOnly:true}))};fresh.parcelInstances=[parcel];
 await page.route('**/rest/v1/rpc/get_admin_sales_aftercare_context_v1',route=>route.fulfill({json:fresh}));await page.goto(url);
 await expect(page.getByRole('button',{name:'إرجاع الطرد كاملاً',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'استبدال وحدة · عصير برتقال · البديل الذي أعطيته',exact:true}).click();
 await expect(page.getByText('إصدار بديل من نفس الصنف — وحدة واحدة',{exact:true})).toBeVisible();
 await expect(page.getByLabel('كمية المرتجع',{exact:true})).toHaveCount(0);
});
