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
});
