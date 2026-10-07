import {test, expect, type Page} from './isolated-test';

const baseUrl = process.env.PHASE44_ADMIN_BASE_URL;
const controlUrl = process.env.PHASE44_CONTROL_URL;
const email = process.env.PHASE44_ADMIN_EMAIL;
const password = process.env.PHASE44_ADMIN_PASSWORD;
const enabled = Boolean(baseUrl && controlUrl && email && password);
const prefix = 'nawasrah:pos-v2:attempt:v1:';
const productId = '92400000-0000-0000-0000-000000000101';
const state = (page: Page) => page.evaluate(storagePrefix => {
  const key = Object.keys(localStorage).find(k => k.startsWith(storagePrefix));
  return key ? JSON.parse(localStorage.getItem(key)!) : null;
}, prefix);
const snapshot = async () => {const response = await fetch(`${controlUrl}/pos-snapshot`);
  expect(response.ok).toBe(true); return response.json();};

async function mount(page: Page) {
  await page.route(`${baseUrl}/`, route => route.fulfill({contentType:'text/html',
    body:'<html lang="ar" dir="rtl"><body><div id="root"></div></body></html>'}));
  await page.goto(baseUrl!);
  return page.evaluate(async ({loginEmail, loginPassword}) => {
    const runtimeImport = (p: string) => import(/* @vite-ignore */ p);
    const lib = await runtimeImport('/src/lib/supabase.ts');
    const login = await lib.supabase.auth.signInWithPassword({email:loginEmail,password:loginPassword,
      options:{captchaToken:'XXXX.DUMMY.TOKEN.XXXX'}});
    if (login.error) throw Error(login.error.message);
    const auth = await lib.supabase.auth.getUser();
    if (auth.error || !auth.data.user?.id) throw Error('Isolated authentication failed');
    const storeModule = await runtimeImport('/src/stores/useAppStore.ts');
    const store = storeModule.storeEngine;
    const branch = {id:'92400000-0000-0000-0000-000000000200',name:'فرع Phase 3',address:'',city:'',phone:''};
    store.state = {...store.getState(),activeBranch:branch,branches:[branch],warehouses:[{
      id:'92400000-0000-0000-0000-000000000201',branchId:branch.id,name:'مستودع Phase 3',location:''}]};
    store.setCurrentUser({id:auth.data.user.id,name:'Isolated Admin',role:'Admin',avatarUrl:''});
    const refresh = await runtimeImport('/@react-refresh'); refresh.default.injectIntoGlobalHook(window);
    Object.assign(window,{$RefreshReg$:()=>undefined,$RefreshSig$:()=>((t: unknown)=>t),
      __vite_plugin_react_preamble_installed__:true});
    const react = await runtimeImport('/node_modules/.vite/deps/react.js');
    const dom = await runtimeImport('/node_modules/.vite/deps/react-dom_client.js');
    const view = await runtimeImport('/src/features/pos/PosView.tsx');
    (dom.createRoot ?? dom.default.createRoot)(document.getElementById('root')).render(
      (react.default ?? react).createElement(view.PosView));
    return auth.data.user.id as string;
  }, {loginEmail:email!,loginPassword:password!});
}

async function mountAftercare(page: Page, orderId: string) {
  await page.goto(baseUrl!);
  await page.evaluate(async id => {
    const load = (p: string) => import(/* @vite-ignore */ p);
    const refresh = await load('/@react-refresh');refresh.default.injectIntoGlobalHook(window);
    Object.assign(window,{$RefreshReg$:()=>undefined,$RefreshSig$:()=>((t:unknown)=>t),
      __vite_plugin_react_preamble_installed__:true});
    const react=await load('/node_modules/.vite/deps/react.js');
    const dom=await load('/node_modules/.vite/deps/react-dom_client.js');
    const panel=await load('/src/features/orders/AdminAftercarePanel.tsx');
    (dom.createRoot ?? dom.default.createRoot)(document.getElementById('root')).render(
      // Only seed the committed sale identity. The panel obtains all eligibility,
      // quantity, price and lineage facts through its authenticated public RPC.
      // Do not grant direct table access just to prepare the browser harness.
      (react.default ?? react).createElement(panel.AdminAftercarePanel,{order:{id,items:[]},
        onContractResolved:()=>undefined,notify:()=>undefined}));
  },orderId);
}
const aftercareSnapshot=async(orderId:string)=>{
  const response=await fetch(`${controlUrl}/snapshot?orderId=${orderId}`);
  expect(response.ok).toBe(true);return response.json();
};

test.describe('Package D POS browser to real isolated RPC', () => {
  test.skip(!enabled, 'Requires NAWASRAH_PACKAGE_D_POS_FULLSTACK=1 isolated runner.');
  test('committed lost response, reload and two-tab recovery never duplicate business writes', async ({page, context}) => {
    await mount(page);
    await page.getByLabel('وحدة البيع',{exact:true}).selectOption('base_unit');
    await page.locator(`[data-pos-product-card="${productId}"]`).click();
    let committedResponse: Record<string, unknown> | undefined;
    const requests: unknown[] = [];
    await page.route('**/rest/v1/rpc/create_pos_sale_v2',async route => {
      requests.push(route.request().postDataJSON());
      const response = await route.fetch(); expect(response.ok()).toBe(true);
      committedResponse = await response.json(); expect(committedResponse?.success).toBe(true);
      await route.abort('failed');
    });
    const before = await snapshot();
    await page.getByRole('button',{name:'إتمام البيع وطباعة'}).click();
    await expect.poll(async () => (await state(page))?.status).toBe('OUTCOME_UNKNOWN');
    const unknown = await state(page); const committed = await snapshot();
    expect(committed.sha256).not.toBe(before.sha256); expect(requests).toHaveLength(1);
    await page.unroute('**/rest/v1/rpc/create_pos_sale_v2');
    let replayBaseline = committed;
    await context.route('**/rest/v1/rpc/create_pos_sale_v2', async route => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      expect((await response.json()).success).toBe(true);
      // Measure the actual coordinator before the UI creates its receipt link.
      expect(await snapshot()).toEqual(replayBaseline);
      await route.fulfill({response});
    });
    await mount(page);
    await expect(page.locator(`[data-pos-product-card="${productId}"]`)).toBeDisabled();
    await page.getByRole('button',{name:'استرجاع محاولة البيع'}).click();
    await expect.poll(async () => (await state(page))?.status).toBe('SUCCEEDED');
    const recovered = await state(page);
    expect(recovered.request).toEqual(unknown.request);
    expect(recovered.result.operationId).toBe(committedResponse!.operationId);
    await expect(page.getByText(`رقم الفاتورة: ${committedResponse!.orderNumber}`,{exact:true})).toBeVisible();
    const presented = await snapshot();
    const receiptOrder = presented.content.orders.find((row: {id: string}) => row.id === committedResponse!.orderId);
    const originalOrder = committed.content.orders.find((row: {id: string}) => row.id === committedResponse!.orderId);
    expect(originalOrder.public_receipt_token).toBeNull();
    expect(receiptOrder.public_receipt_token).toMatch(/^[0-9a-f-]{36}$/);
    expect({...receiptOrder, public_receipt_token:originalOrder.public_receipt_token,
      updated_at:originalOrder.updated_at}).toEqual(originalOrder);
    expect({...presented.content, orders:presented.content.orders.map((row: {id: string}) =>
      row.id === originalOrder.id ? originalOrder : row)}).toEqual(committed.content);
    replayBaseline = presented;
    const second = await context.newPage(); await mount(second);
    await page.getByRole('button',{name:'✕',exact:true}).click();
    await Promise.all([page.getByRole('button',{name:'استرجاع محاولة البيع'}).click(),
      second.getByRole('button',{name:'استرجاع محاولة البيع'}).click()]);
    await expect(page.getByText(`رقم الفاتورة: ${committedResponse!.orderNumber}`,{exact:true})).toBeVisible();
    await expect(second.getByText(`رقم الفاتورة: ${committedResponse!.orderNumber}`,{exact:true})).toBeVisible();
    expect((await state(page)).request).toEqual(unknown.request);
    expect(await snapshot()).toEqual(presented); await second.close();
  });

  test('POS single-SKU carton uses the real Admin Replacement and current-leaf Return RPCs',async({page})=>{
    await mount(page);
    await page.getByLabel('وحدة البيع',{exact:true}).selectOption('legacy_single_sku_parcel');
    await page.locator('[data-pos-product-card="92400000-0000-0000-0000-000000000103"]').click();
    await page.getByRole('button',{name:'إتمام البيع وطباعة'}).click();
    await expect.poll(async()=>(await state(page))?.status).toBe('SUCCEEDED');
    const sold=await state(page);const orderId=sold.result.orderId;
    expect(sold.result.items[0].commercialLineKind).toBe('legacy_single_sku_parcel');
    expect(sold.result.items[0].baseQuantity).toBe(5);
    await mountAftercare(page,orderId);
    await page.getByRole('button',{name:'استبدال كرتونة',exact:true}).click();
    await expect(page.getByLabel('عدد كراتين الاستبدال')).toHaveValue('1');
    await page.getByPlaceholder('سبب العيب/الاستبدال').fill('عيب كرتونة من بيع الكاشير');
    const replacementResponse=page.waitForResponse(r=>r.url().endsWith('/rest/v1/rpc/settle_sales_replacement_v1'));
    await page.getByRole('button',{name:'اعتماد الاستبدال',exact:true}).click();
    const issued=await (await replacementResponse).json();expect(issued.success).toBe(true);
    const replacementState=await aftercareSnapshot(orderId);
    expect(replacementState.orderReplacements).toBe(1);
    expect(replacementState.content.replacementItems[0].quantity).toBe(5);
    await page.getByRole('button',{name:'مرتجع',exact:true}).click();
    await expect(page.getByLabel('عدد كراتين المرتجع')).toHaveValue('1');
    await page.getByPlaceholder('سبب المرتجع').fill('مرتجع الكرتونة البديلة كاملة');
    await page.getByRole('button',{name:'كاش',exact:true}).click();
    const returnResponse=page.waitForResponse(r=>r.url().endsWith('/rest/v1/rpc/settle_admin_sales_return_v1'));
    await page.getByRole('button',{name:'اعتماد المرتجع',exact:true}).click();
    const returned=await(await returnResponse).json();expect(returned.success).toBe(true);
    const settled=await aftercareSnapshot(orderId);expect(settled.orderReturns).toBe(1);
    expect(settled.content.returnEffects[0].sellable_quantity).toBe(5);
    expect(settled.content.returns[0].money_refund_amount_in_minor_units).toBe(4500);
    const consumed=settled.content.consumptions.filter((c:{consumption_kind:string})=>c.consumption_kind==='return');
    expect(consumed).toHaveLength(1);expect(consumed[0].source_kind).toBe('replacement_item');
    expect(consumed[0].source_id).toBe(replacementState.content.replacementItems[0].id);
    const recovered=await page.evaluate(async id=>{
      const p='/src/services/supabase/salesAftercare.service.ts';
      const service=await import(/* @vite-ignore */ p);return service.recoverAdminAftercare(id,'return');
    },orderId);
    expect(recovered.success).toBe(true);expect(await aftercareSnapshot(orderId)).toEqual(settled);
  });

  test('carton customer damage uses frozen standalone price and restocks only accepted sellable units',async({page})=>{
    await mount(page);
    await page.getByLabel('وحدة البيع',{exact:true}).selectOption('legacy_single_sku_parcel');
    await page.locator('[data-pos-product-card="92400000-0000-0000-0000-000000000103"]').click();
    await page.getByRole('button',{name:'إتمام البيع وطباعة'}).click();
    await expect.poll(async()=>(await state(page))?.status).toBe('SUCCEEDED');
    const sold=await state(page); const orderId=sold.result.orderId;
    await mountAftercare(page,orderId);
    await page.getByRole('button',{name:'مرتجع',exact:true}).click();
    await page.getByLabel('سليم',{exact:true}).fill('2');
    await page.getByLabel('عيب/غير قابل للبيع',{exact:true}).fill('1');
    await page.getByLabel('ضرر عميل',{exact:true}).fill('2');
    await page.getByPlaceholder('سبب المرتجع').fill('فحص كرتونة: سليم وعيب وضرر عميل');
    const response=page.waitForResponse(r=>r.url().endsWith('/rest/v1/rpc/settle_admin_sales_return_v1'));
    await page.getByRole('button',{name:'اعتماد المرتجع',exact:true}).click();
    const result=await(await response).json();expect(result.success).toBe(true);
    // Independent fixture prices: carton4500 and standalone900, not returned evidence.
    expect(result.merchandiseEntitlementInMinorUnits).toBe(2700);
    expect(result.moneyRefundInMinorUnits).toBe(2700);
    const committed=await aftercareSnapshot(orderId);
    expect(committed.content.returnEffects[0].sellable_quantity).toBe(2);
    expect(committed.content.returnItems[0].raw_customer_damage_deduction_in_minor_units).toBe(1800);
    const recovered=await page.evaluate(async id=>{
      const p='/src/services/supabase/salesAftercare.service.ts';
      const service=await import(/* @vite-ignore */ p);return service.recoverAdminAftercare(id,'return');
    },orderId);
    expect(recovered.success).toBe(true);expect(await aftercareSnapshot(orderId)).toEqual(committed);
  });

  test('server absence and explicit confirmed cancellation unlock POS without erasing the attempt',async({page})=>{
    await mount(page);await page.getByLabel('وحدة البيع',{exact:true}).selectOption('base_unit');
    await page.locator(`[data-pos-product-card="${productId}"]`).click();
    await page.route('**/rest/v1/rpc/create_pos_sale_v2',route=>route.abort('failed'));
    const before=await snapshot();await page.getByRole('button',{name:'إتمام البيع وطباعة'}).click();
    await expect.poll(async()=>(await state(page))?.status).toBe('OUTCOME_UNKNOWN');
    const pending=await state(page);expect(await snapshot()).toEqual(before);
    await page.getByRole('button',{name:'التحقق من حالة المحاولة',exact:true}).click();
    await expect(page.getByText('الخادم لا يجد بيعاً مسجلاً لهذه المحاولة. سيعيد التحقق عند الإلغاء.')).toBeVisible();
    expect((await state(page)).status).toBe('OUTCOME_UNKNOWN');
    const cancel=page.getByRole('button',{name:'إلغاء المحاولة غير المسجلة',exact:true});await expect(cancel).toBeDisabled();
    await page.getByRole('checkbox',{name:'أؤكد إلغاء هذه المحاولة غير المسجلة وبدء بيع جديد'}).check();
    await cancel.click();await expect.poll(async()=>(await state(page))?.status).toBe('CANCELLED_UNCOMMITTED');
    const cancelled=await state(page);expect(cancelled.request).toEqual(pending.request);
    expect(cancelled.cancellationProof.idempotencyKey).toBe(pending.request.idempotencyKey);
    expect(await snapshot()).toEqual(before);
    await page.unroute('**/rest/v1/rpc/create_pos_sale_v2');
    const late=await page.evaluate(async request=>{
      const p='/src/services/supabase/posV2.service.ts';const service=await import(/* @vite-ignore */ p);
      return service.createPosSaleV2InSupabase(request);
    },pending.request);
    expect(late.ok).toBe(false);expect(await snapshot()).toEqual(before);
    await expect(page.locator(`[data-pos-product-card="${productId}"]`)).toBeEnabled();
  });
});
