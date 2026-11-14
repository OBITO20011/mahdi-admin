import {test,expect,type Page,type BrowserContext} from './isolated-test';
const api=process.env.QUANTITY223_CONTROL_URL,token=process.env.QUANTITY223_CONTROL_TOKEN;
test.describe.configure({retries:0});
test.use({hasTouch:true,viewport:{width:390,height:950}});
test.setTimeout(180000);
const headers=()=>({'x-quantity-test-token':token!,'content-type':'application/json'});
async function control(path:string){const response=await fetch(api+path,{headers:headers()});expect(response.ok).toBe(true);return response.json();}
async function transport(context:BrowserContext){
 expect(api).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);expect(token).toMatch(/^[0-9a-f]{64}$/);
 await context.route('http://127.0.0.1:4176/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});
  const rpc=url.pathname.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/)?.[1];
  const guest=url.pathname==='/functions/v1/submit-guest-order';
  if(rpc||guest){
   const role=request.frame().url().startsWith('http://127.0.0.1:4173')?'authenticated':'anon';
   const response=await fetch(api+(guest?'/edge':'/rpc/'+rpc),{method:'POST',headers:{...headers(),'x-quantity-test-role':role},body:request.postData()??'{}'});
   const body=await response.text();expect(response.ok,(rpc??'guest-edge')+':'+body).toBe(true);
   return route.fulfill({status:response.status,headers:{'content-type':'application/json','access-control-allow-origin':'*'},body});
  }
  if(url.pathname==='/rest/v1/orders'){
   const filter=url.searchParams.get('id');
   if(filter?.startsWith('eq.')&&url.searchParams.get('select')?.includes('order_items(')){
    const id=filter.slice(3);expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    return route.fulfill({json:await control('/order-meta?id='+id),headers:{'access-control-allow-origin':'*'}});
   }
   return route.fulfill({json:await control('/table/orders'+(filter?'?filter='+encodeURIComponent(filter):'')),headers:{'access-control-allow-origin':'*'}});
  }
  if(url.pathname==='/rest/v1/order_items'){
   const filter=url.searchParams.get('order_id');expect(filter).toBeTruthy();
   return route.fulfill({json:await control('/table/order_items?filter='+encodeURIComponent(filter!)),headers:{'access-control-allow-origin':'*'}});
  }
  const metadata=url.pathname.match(/^\/rest\/v1\/(categories|units|brands|warehouses|branches)$/)?.[1];
  if(metadata)return route.fulfill({json:await control('/table/'+metadata),headers:{'access-control-allow-origin':'*'}});
  if(url.pathname==='/rest/v1/products'){
   const column=url.searchParams.get('select');expect(['category_id','brand_id','id,unit_id,purchase_unit_id,sale_unit_id']).toContain(column);
   expect(url.searchParams.get('is_active')).toBe('eq.true');
   return route.fulfill({json:await control('/product-reference-counts?column='+encodeURIComponent(column!)),headers:{'access-control-allow-origin':'*'}});
  }
  // No request may fall through to the owner's unrelated service on4176.
  throw Error('UNMODELED_QUANTITY223_LOCAL_ENDPOINT:'+url.pathname);
 });
}
async function mountOwner(page:Page,fixture:Record<string,unknown>,view:'product'|'pos'){
 await page.route('http://127.0.0.1:4173/',route=>route.fulfill({contentType:'text/html',body:'<html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'}));
 await page.goto('http://127.0.0.1:4173/');
 await page.evaluate(async({fixture,view})=>{
  const load=(path:string)=>import(/* @vite-ignore */path);
  await load('/src/index.css');for(const weight of [400,500,600,700])await load(`/node_modules/@fontsource/ibm-plex-sans-arabic/${weight}.css`);
  const refresh=await load('/@react-refresh');refresh.default.injectIntoGlobalHook(window);
  Object.assign(window,{$RefreshReg$:()=>undefined,$RefreshSig$:()=>((type:unknown)=>type),__vite_plugin_react_preamble_installed__:true});
  const lib=await load('/src/lib/supabase.ts'),stores=await load('/src/stores/useAppStore.ts'),auth=await load('/src/stores/useAuthStore.ts');
  // Synthetic test identity only. SQL role/AAL2 denial is a separate real PG
  // gate;this case proves component-to-service-to-authoritative-writer effects.
  lib.supabase.auth.getUser=async()=>({data:{user:{id:fixture.owner}},error:null});
  auth.authStoreEngine.state={...auth.authStoreEngine.getState(),user:{id:fixture.owner},roleName:'owner',roles:['owner'],isAuthenticated:true,isLoading:false};
  auth.authStoreEngine.initAuth=async()=>undefined;
  const service=await load('/src/services/supabase/products.service.ts'),product=service.mapAdminProductRecord(fixture.product);
  const branch={id:fixture.branch,name:'فرع اختبار العدّاد',address:'',city:'الرمثا',phone:''};
  const store=stores.storeEngine;store.state={...store.getState(),products:[product],categories:fixture.categories,units:fixture.units,brands:[],activeBranch:branch,branches:[branch],warehouses:[{id:fixture.warehouse,branchId:fixture.branch,name:'مستودع الاختبار',location:''}]};
  store.setCurrentUser({id:fixture.owner,name:'مالك اختبار معزول',role:'Owner',avatarUrl:''});
  const react=await load('/node_modules/.vite/deps/react.js'),dom=await load('/node_modules/.vite/deps/react-dom_client.js');
  const component=await load(view==='product'?'/src/features/products/ProductFormModal.tsx':'/src/features/pos/PosView.tsx');
  const create=react.createElement??react.default.createElement;
  (dom.createRoot??dom.default.createRoot)(document.getElementById('root')).render(create(component[view==='product'?'ProductFormModal':'PosView'],{initialProduct:product,operatingMode:'sales-only',modeVerified:true,onClose:()=>undefined}));
 },{fixture,view});
}
async function setCounter(page:Page,fixture:Record<string,unknown>,quantity:number,enabled=true){
 await mountOwner(page,fixture,'product');const panel=page.locator('[data-optional-quantity]');
 await expect(panel.getByLabel('صار عندي — باكيت',{exact:true})).toBeVisible();
 await panel.getByRole('checkbox',{name:'تتبّع الكمية',exact:true}).setChecked(enabled);
 await panel.getByLabel('صار عندي — باكيت',{exact:true}).fill(String(quantity));
 await panel.getByRole('button',{name:/حفظ كمية/}).tap();
 await expect.poll(async()=>{const value=await control('/snapshot');return {quantity:value.counter?.quantity,enabled:value.counter?.enabled};}).toEqual({quantity,enabled});
}
test('actual OFF owner UI → three real Edge/SQL orders → zero → manual refill → acknowledged POS shortage',async({page,context},info)=>{
 await transport(context);const fixture=await control('/fixture');
 await setCounter(page,fixture,3);
 const before=await control('/snapshot');expect(before.accounting).toEqual([0,0,0]);
 const customer=await context.newPage();await customer.emulateMedia({reducedMotion:'reduce'});
 await customer.addInitScript(()=>{const w=window as typeof window&{turnstile?:unknown};w.turnstile={render:(_container:HTMLElement,options:{callback:(token:string)=>void})=>{queueMicrotask(()=>options.callback('isolated-counter-real-edge'));return 'counter-fixture';},reset:()=>undefined,remove:()=>undefined};});
 for(let count=0;count<3;count++){
  await customer.goto('http://127.0.0.1:4174/#catalog');await expect(customer.getByTestId('catalog-products-grid')).toBeVisible();
  await customer.getByRole('button',{name:'عرض تفاصيل صنف الكرتونة',exact:true}).first().tap();
  await customer.getByRole('region',{name:'إضافة باكيت',exact:true}).getByRole('button',{name:/إضافة .* باكيت من/}).tap();await customer.keyboard.press('Escape');
  await customer.getByRole('button',{name:/^فتح السلة،/}).tap();await customer.getByRole('button',{name:'إتمام الطلب بدون تسجيل دخول'}).tap();
  const checkout=customer.getByRole('dialog',{name:'إتمام طلب الجملة',exact:true});
  await checkout.getByLabel('الاسم الكامل*').fill('مستلم اختبار فعلي وهمي');await checkout.getByLabel('رقم الهاتف*').fill(`0796000${info.project.name==='mobile-webkit'?'2':'1'}${count}0`);
  await checkout.getByLabel('المنطقة أو الحي*').fill('حي اختبار');await checkout.getByLabel('تفاصيل العنوان والتوصيل*').fill('عنوان وهمي لا يرسل لأي جهة');await checkout.getByRole('button',{name:'مراجعة الطلب قبل الإرسال'}).tap();
  const review=customer.getByRole('dialog',{name:'راجع طلبك قبل الإرسال',exact:true});await expect(review.getByText('تم التحقق الأمني وجاهز للإرسال.')).toBeVisible();const sent=customer.waitForResponse(response=>response.url().endsWith('/functions/v1/submit-guest-order')&&response.request().method()==='POST');
  await review.getByRole('button',{name:'تأكيد وحفظ الطلب في الإدارة'}).tap();const saved=await sent;expect(saved.ok()).toBe(true);expect((await saved.json()).success).toBe(true);
  await expect(customer.getByRole('heading',{name:'تم تسجيل طلبك',exact:true})).toBeVisible();
  await expect.poll(async()=>(await control('/snapshot')).counter.quantity).toBe(2-count);
  await customer.getByRole('button',{name:'العودة للمتجر',exact:true}).tap();
 }
 await customer.goto('http://127.0.0.1:4174/#catalog');await customer.getByRole('button',{name:'عرض تفاصيل صنف الكرتونة',exact:true}).first().tap();
 await expect(customer.getByRole('region',{name:'إضافة باكيت',exact:true}).getByRole('button',{name:/إضافة .* باكيت من/})).toBeDisabled();
 await customer.screenshot({path:info.outputPath('real-database-zero.png'),fullPage:true});
 await setCounter(page,fixture,2);await mountOwner(page,fixture,'pos');
 const add=page.locator(`[data-pos-product="${(fixture.product as {id:string}).id}"] [data-pos-add-method="base_unit"]`);await expect(add).toBeEnabled();
 for(let n=0;n<3;n++)await add.tap();await page.locator('[data-testid="pos-complete-sale"]:visible').tap();
 const warning=page.getByRole('dialog',{name:'تأكيد بيع صنف غير متوفر'});await expect(warning).toContainText('متبقي 2 باكيت');
 const beforePos=await control('/snapshot');await warning.getByRole('button',{name:'أؤكد بيع الأصناف غير المتوفرة'}).tap();
 await expect(page.getByRole('dialog',{name:'إيصال البيع',exact:true})).toBeVisible();
 const after=await control('/snapshot');expect(after.pos).toBe(beforePos.pos+1);expect(after.shortage).toBe(beforePos.shortage+1);expect(after.counter.quantity).toBe(0);expect(after.orders).toBe(before.orders+3);expect(after.accounting).toEqual([0,0,0]);
 await setCounter(page,fixture,0,false);await customer.close();
});
