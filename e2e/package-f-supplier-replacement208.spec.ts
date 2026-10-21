import {checkLayout} from './package-f-layout';
import {test,expect,type Page,type BrowserContext} from './isolated-test';
const url='/e2e/supplier-replacement208-harness.html',product='88880000-0000-4000-8000-000000000002',supplier='88880000-0000-4000-8000-000000000003',warehouse='88880000-0000-4000-8000-000000000004';
const caseRow={id:'88880000-0000-4000-8000-000000000005',supplierId:supplier,supplierName:'مورد التجربة',productId:product,productName:'صنف التجربة',warehouseId:warehouse,branchId:'branch',origin:'shop',quantity:2,commercialQuantity:2,unitsPerCommercialUnit:1,unitName:'باكيت',baseUnitName:'باكيت',pendingQuantity:2,receivedQuantity:0,writtenOffQuantity:0,occurredAt:'2026-10-21T10:00:00Z',events:[]};
const mocks=async(surface:Page|BrowserContext)=>{
 await surface.route('**/rest/v1/rpc/get_supplier_replacement_options_v1',route=>route.fulfill({json:{contractVersion:208,products:[{id:product,name:'صنف التجربة',sku:'208',baseUnitName:'باكيت',unitsPerParcel:5}],suppliers:[{id:supplier,name:'مورد التجربة'}],warehouses:[{id:warehouse,name:'مستودع المحل',branchId:'branch'}],lastSuppliers:[{productId:product,supplierId:supplier,supplierName:'مورد التجربة'}]}}));
 await surface.route('**/rest/v1/rpc/preview_supplier_replacement_v1',route=>route.fulfill({json:{contractVersion:208,action:route.request().postDataJSON().p_action,eligible:true,blockedReason:null,quantity:2,availableQuantity:10}}));
 await surface.route('**/rest/v1/rpc/get_supplier_replacements_page_v1',route=>route.fulfill({json:{contractVersion:208,page:1,pageSize:25,totalCount:1,pendingQuantity:2,cases:[caseRow]}}));
};
const success=(request:Record<string,unknown>,recovered=false)=>({success:true,contractVersion:208,action:request.p_action,idempotencyKey:request.p_idempotency_key,idempotent:recovered,operationId:'88880000-0000-4000-8000-000000000006',cases:[caseRow]});
const fill=async(page:Page)=>{await expect(page.getByRole('button',{name:'معاينة العملية',exact:true})).toBeEnabled();await page.getByRole('combobox',{name:'الصنف',exact:true}).selectOption(product);await page.getByLabel('العدد',{exact:true}).fill('2');await page.getByLabel('سبب العملية',{exact:true}).fill('نفس البضاعة إلى المورد');await page.getByRole('button',{name:'معاينة العملية',exact:true}).click();await expect(page.getByRole('button',{name:'تأكيد وحفظ العملية'})).toBeVisible();};
test('208 pending UI uses current unit/solewarehouse and real service once;history quantities;no horizontal overflow',async({page})=>{
 await mocks(page);const requests:Record<string,unknown>[]=[];await page.route('**/rest/v1/rpc/execute_supplier_replacement_v1',route=>{const req=route.request().postDataJSON();requests.push(req);return route.fulfill({json:success(req)});});
 await page.goto(url+'?role=manager');await fill(page);await expect(page.getByLabel('المستودع',{exact:true})).toHaveCount(0);await expect(page.getByText('مستودع المحل',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'تأكيد وحفظ العملية'}).click();await expect(page.getByTestId('saved')).toHaveText('1');expect(requests.length).toBe(1);expect(requests[0].p_payload).toEqual({productId:product,supplierId:supplier,warehouseId:warehouse,quantity:2,unit:'base',reason:'نفس البضاعة إلى المورد'});
 await page.getByRole('button',{name:'المعلّق',exact:true}).click();await expect(page.getByText('المعلّق 2 باكيت',{exact:false})).toBeVisible();await expect(page.getByText('قيمة الأصل المعلّق',{exact:false})).toHaveCount(0);await expect(page.getByRole('button',{name:'معاينة رفض المورد'})).toHaveCount(0);
 await checkLayout(page,page.getByRole('dialog'));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('208 unknown survives reload and recovers identicalkey/payload without storing financialresult',async({page})=>{
 await mocks(page);const requests:Record<string,unknown>[]=[];await page.route('**/rest/v1/rpc/execute_supplier_replacement_v1',route=>{const req=route.request().postDataJSON();requests.push(req);return requests.length===1?route.abort():route.fulfill({json:success(req,true)});});
 await page.goto(url);await fill(page);await page.getByRole('button',{name:'تأكيد وحفظ العملية'}).click();await expect(page.getByRole('alert')).toBeVisible();await page.reload();await expect(page.getByTestId('replacement-recovery')).toContainText('لم تتأكد نتيجة الحفظ بعد');
 await page.getByRole('button',{name:'استعادة نفس المحاولة'}).click();await expect(page.getByTestId('saved')).toHaveText('1');expect(requests.length).toBe(2);expect(requests[1]).toEqual(requests[0]);
 const stored=await page.evaluate(async()=>new Promise<unknown>((resolve,reject)=>{const request=indexedDB.open('nawasrah-supplier-replacement208',1);request.onsuccess=()=>{const db=request.result,tx=db.transaction('attempts','readonly'),get=tx.objectStore('attempts').getAll();get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error);tx.oncomplete=()=>db.close();};}));
 expect(JSON.stringify(stored)).not.toMatch(/pendingValue|unitCost|manifest|operationId|returnResult/);expect(JSON.stringify(stored)).toContain('succeeded');
});
test('208 IndexedDB unavailable failsclosed before any dispatch',async({page})=>{
 await mocks(page);let calls=0;await page.route('**/rest/v1/rpc/execute_supplier_replacement_v1',route=>{calls++;return route.abort();});
 await page.addInitScript(()=>{IDBFactory.prototype.open=function(){throw new DOMException('storage denied','SecurityError');};});
 await page.goto(url);await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('button',{name:'معاينة العملية',exact:true})).toBeDisabled();expect(calls).toBe(0);
});
test('208 committed result with failed local success save retains exact unknown recovery key',async({page})=>{
 await mocks(page);const requests:Record<string,unknown>[]=[];
 await page.route('**/rest/v1/rpc/execute_supplier_replacement_v1',route=>{const req=route.request().postDataJSON();requests.push(req);return route.fulfill({json:success(req,requests.length>1)});});
 await page.goto(url);await page.evaluate(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value:unknown,key?:IDBValidKey){if(value&&typeof value==='object'&&'status' in value&&value.status==='succeeded')throw new DOMException('savefailed','QuotaExceededError');return original.call(this,value,key);};});
 await fill(page);await page.getByRole('button',{name:'تأكيد وحفظ العملية'}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('alert')).not.toContainText('لم يُرسل');await expect(page.getByTestId('saved')).toHaveText('0');
 await page.reload();await expect(page.getByTestId('replacement-recovery')).toContainText('لم تتأكد نتيجة الحفظ بعد');await page.getByRole('button',{name:'استعادة نفس المحاولة'}).click();await expect(page.getByTestId('saved')).toHaveText('1');expect(requests[1]).toEqual(requests[0]);
});
test('208 response for another request cannot mark this attempt successful',async({page})=>{
 await mocks(page);const requests:Record<string,unknown>[]=[];
 await page.route('**/rest/v1/rpc/execute_supplier_replacement_v1',route=>{const req=route.request().postDataJSON();requests.push(req);return route.fulfill({json:requests.length===1?{...success(req),idempotencyKey:'sr208:another-request'}:success(req,true)});});
 await page.goto(url);await fill(page);await page.getByRole('button',{name:'تأكيد وحفظ العملية'}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByTestId('saved')).toHaveText('0');
 await page.reload();await page.getByRole('button',{name:'استعادة نفس المحاولة'}).click();await expect(page.getByTestId('saved')).toHaveText('1');expect(requests[1]).toEqual(requests[0]);
});
test('208 stale other-tab newintent cannot silently start another shipment',async({page,context})=>{
 await mocks(context);const requests:Record<string,unknown>[]=[];let release:()=>void=()=>undefined;const barrier=new Promise<void>(r=>{release=r;});
 await context.route('**/rest/v1/rpc/execute_supplier_replacement_v1',async route=>{const req=route.request().postDataJSON();requests.push(req);await barrier;await route.fulfill({json:success(req)});});
 await page.goto(url);const second=await context.newPage();await second.goto(url);await fill(page);await fill(second);
 try{await page.bringToFront();await page.getByRole('button',{name:'تأكيد وحفظ العملية'}).click();await expect.poll(()=>requests.length).toBe(1);await second.bringToFront();
  const lock='supplier-replacement208:88880000-0000-4000-8000-000000000001:supplier-replacement208:panel';
  await Promise.all([second.getByRole('button',{name:'تأكيد وحفظ العملية'}).click(),(async()=>{await expect.poll(()=>second.evaluate(async key=>(await navigator.locks.query()).pending?.filter(l=>l.name===key).length??0,lock)).toBe(1);release();})()]);
  await expect(second.getByRole('alert')).toContainText('تغيّرت المحاولة');expect(requests.length).toBe(1);await expect(second.getByTestId('replacement-recovery')).toContainText('آخر عملية محفوظة');
 }finally{release();await second.close();}
});
test('208 same request after explicit fresh review createsnewshipment nonce;recovery keeps the previouskey',async({page})=>{
 await mocks(page);const requests:Record<string,unknown>[]=[];await page.route('**/rest/v1/rpc/execute_supplier_replacement_v1',route=>{const req=route.request().postDataJSON();requests.push(req);return route.fulfill({json:success(req,requests.length===2)});});
 await page.goto(url);await fill(page);await page.getByRole('button',{name:'تأكيد وحفظ العملية'}).click();await expect(page.getByTestId('saved')).toHaveText('1');await page.getByRole('button',{name:'استعادة نفس المحاولة'}).click();await expect(page.getByTestId('saved')).toHaveText('2');expect(requests[1]).toEqual(requests[0]);
 await page.getByRole('button',{name:'معاينة العملية',exact:true}).click();await page.getByRole('button',{name:'تأكيد وحفظ العملية'}).click();await expect(page.getByTestId('saved')).toHaveText('3');expect(requests[2].p_payload).toEqual(requests[0].p_payload);expect(requests[2].p_idempotency_key).not.toBe(requests[0].p_idempotency_key);
});
