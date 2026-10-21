import AxeBuilder from '@axe-core/playwright';
import {test,expect,type Page} from './isolated-test';
const url='/e2e/document-corrections207-harness.html',recordId='66660000-0000-4000-8000-000000000002';
const preview=(action='pos_sale',id=recordId)=>({contractVersion:207,action,recordId:id,reference:'POS-207',eligible:true,blockedReason:null,cashShiftId:'66660000-0000-4000-8000-000000000099',fingerprint:'a'.repeat(64),effect:{cashInMinorUnits:-2000,cliqInMinorUnits:0,customerDebtInMinorUnits:0,supplierBalanceInMinorUnits:0,inventoryBaseUnits:2,paymentMethod:'cash',paymentInMinorUnits:2000,stock:[]}});
const open=async(page:Page)=>{const entry=page.locator('[data-action="pos_sale"]');if(await entry.locator('details').getAttribute('open')===null)await entry.locator('summary').click();await entry.getByRole('button',{name:'عكس بيع خاطئ',exact:true}).click();const dialog=page.getByRole('dialog',{name:'عكس بيع خاطئ',exact:true});await expect(dialog).toHaveAttribute('data-state','open');return dialog;};
const mock=async(page:Page)=>{await page.route('**/rest/v1/rpc/get_document_correction_preview',route=>{const p=route.request().postDataJSON();return route.fulfill({json:preview(p.p_action,p.p_record_id)});});};
for(const width of [390,1440])test(`207 preview reason confirmation and retained effect ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await mock(page);let calls=0;
 await page.route('**/rest/v1/rpc/execute_document_correction_once',async route=>{calls++;const r=route.request().postDataJSON();expect(r.p_reason).toBe('البيع مسجل بالخطأ');expect(r.p_preview_fingerprint).toBe('a'.repeat(64));expect(r.p_idempotency_key).toMatch(/^correction207:/u);await route.fulfill({json:{success:true,contractVersion:207,action:'pos_sale',recordId,idempotent:false,preview:preview(),writerResult:{success:true}}});});
 await page.goto(url);const d=await open(page);await expect(d.getByLabel('أثر التصحيح')).toContainText('الكاش في الدرج');await expect(d.getByLabel('أثر التصحيح')).toContainText('٢');expect(calls).toBe(0);
 await expect(d.getByRole('button',{name:'تأكيد التصحيح'})).toBeDisabled();await d.getByLabel('سبب التصحيح').fill('البيع مسجل بالخطأ');
 expect((await new AxeBuilder({page}).include('[data-testid="document-correction-dialog"]').analyze()).violations.filter(v=>v.impact==='critical'||v.impact==='serious')).toEqual([]);
 await d.getByRole('button',{name:'تأكيد التصحيح'}).click();await expect(page.getByTestId('saved')).toContainText('1');expect(calls).toBe(1);
});
test('207 lost response survives reload and recovers identical immutable request',async({page})=>{
 await mock(page);const requests:unknown[]=[];await page.route('**/rest/v1/rpc/execute_document_correction_once',async route=>{requests.push(route.request().postDataJSON());if(requests.length===1)await route.abort('failed');else await route.fulfill({json:{success:true,contractVersion:207,action:'pos_sale',recordId,idempotent:true,preview:preview(),writerResult:{success:true}}});});
 await page.goto(url);let d=await open(page);await d.getByLabel('سبب التصحيح').fill('المستند مكرر بالخطأ');await d.getByRole('button',{name:'تأكيد التصحيح'}).click();await expect(d.getByRole('button',{name:'استعادة نفس المحاولة'})).toBeVisible();
 await page.reload();d=await open(page);await expect(d.getByLabel('سبب التصحيح')).toHaveValue('المستند مكرر بالخطأ');await expect(d.getByLabel('سبب التصحيح')).toBeDisabled();await d.getByRole('button',{name:'استعادة نفس المحاولة'}).click();await expect(page.getByTestId('saved')).toContainText('1');expect(requests.length).toBe(2);expect(requests[1]).toEqual(requests[0]);
});
test('207 blocked preview and missing capability never enable confirmation',async({page})=>{
 await page.route('**/rest/v1/rpc/get_document_correction_preview',route=>route.fulfill({json:{...preview(),eligible:false,blockedReason:'الوردية مغلقة؛ لا يمكن العكس.'}}));await page.goto(url);let d=await open(page);await expect(d).toContainText('الوردية مغلقة');await expect(d.getByRole('button',{name:'تأكيد التصحيح'})).toHaveCount(0);await d.getByRole('button',{name:'إغلاق',exact:true}).last().click();
 await page.route('**/rest/v1/rpc/get_document_correction_preview',route=>route.fulfill({status:404,json:{code:'PGRST202',message:'معاينة التصحيح غير متاحة'}}));d=await open(page);await expect(d.getByRole('alert')).toContainText('غير متاحة');await expect(d.getByRole('button',{name:'تأكيد التصحيح'})).toHaveCount(0);
});
test('207 canonical memberships retain owner-only POS/supplier actions',async({page})=>{
 for(const [role,allowed]of [['cashier',[]],['manager',['customer_payment','purchase_receipt']],['accountant',['customer_payment']],['warehouse_keeper',['purchase_receipt']]] as Array<[string,string[]]>) {
  await page.goto(`${url}?role=${role}`);for(const action of ['pos_sale','customer_payment','supplier_payment','purchase_receipt'])await expect(page.locator(`[data-action="${action}"] summary`)).toHaveCount(allowed.includes(action)?1:0);
 }
});
test('207 corrupted recovery storage fails closed before new request',async({page})=>{
 await mock(page);let calls=0;await page.route('**/rest/v1/rpc/execute_document_correction_once',route=>{calls++;return route.abort();});await page.goto(url);
 await page.evaluate(()=>localStorage.setItem('document-correction207:66660000-0000-4000-8000-000000000001:pos_sale:66660000-0000-4000-8000-000000000002','{"version":207,"status":"unknown"}'));
 const d=await open(page);await expect(d.getByRole('alert')).toBeVisible();await expect(d.getByRole('button',{name:'تأكيد التصحيح'})).toHaveCount(0);expect(calls).toBe(0);
});
test('207 storage denial prevents dispatch and preserves explicit failure',async({page})=>{
 await mock(page);let calls=0;await page.route('**/rest/v1/rpc/execute_document_correction_once',route=>{calls++;return route.abort();});await page.goto(url);
 await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('document-correction207:'))throw new DOMException('Storage unavailable','QuotaExceededError');return original.call(this,k,v);};});
 const d=await open(page);await d.getByLabel('سبب التصحيح').fill('خطأ إدخال الفاتورة');await d.getByRole('button',{name:'تأكيد التصحيح'}).click();await expect(d.getByRole('alert')).toBeVisible();expect(calls).toBe(0);await expect(page.getByTestId('saved')).toContainText('0');
});
test('207 shared tab lock sends identical key while pending confirmation cannot close',async({page,context})=>{
 const requests:Record<string,unknown>[]=[];let release:()=>void=()=>undefined;const hold=new Promise<void>(r=>{release=r;});
 await context.route('**/rest/v1/rpc/get_document_correction_preview',route=>route.fulfill({json:preview()}));
 await context.route('**/rest/v1/rpc/execute_document_correction_once',async route=>{requests.push(route.request().postDataJSON());await hold;await route.fulfill({json:{success:true,contractVersion:207,action:'pos_sale',recordId,idempotent:requests.length>1,preview:preview(),writerResult:{success:true}}});});
 await page.goto(url);const second=await context.newPage();await second.goto(url);const a=await open(page),b=await open(second);for(const d of [a,b])await d.getByLabel('سبب التصحيح').fill('نفس خطأ المستند');
 try{
  await page.bringToFront();await a.getByRole('button',{name:'تأكيد التصحيح'}).click();await expect.poll(()=>requests.length).toBe(1);await page.keyboard.press('Escape');await expect(a).toBeVisible();await expect(a.getByRole('button',{name:'إغلاق',exact:true}).last()).toBeDisabled();
  await second.bringToFront();
  const lockName=`document-correction207:66660000-0000-4000-8000-000000000001:pos_sale:${recordId}:lock`;
  await Promise.all([
   b.getByRole('button',{name:'تأكيد التصحيح'}).click(),
   (async()=>{
    await expect.poll(()=>second.evaluate(async name=>{const locks=await navigator.locks.query();return {held:locks.held?.filter(lock=>lock.name===name).length??0,pending:locks.pending?.filter(lock=>lock.name===name).length??0};},lockName)).toEqual({held:1,pending:1});
    expect(requests.length).toBe(1);release();await page.bringToFront();await expect(page.getByTestId('saved')).toContainText('1');
   })(),
  ]);
  await second.bringToFront();await expect(second.getByTestId('saved')).toContainText('1');expect(requests.length).toBe(2);expect(requests[1]).toEqual(requests[0]);
 }finally{release();await second.close();}
});
test('207 committed response with failed local success save retains its original recovery key',async({page})=>{
 await mock(page);const requests:unknown[]=[];
 await page.route('**/rest/v1/rpc/execute_document_correction_once',route=>{requests.push(route.request().postDataJSON());return route.fulfill({json:{success:true,contractVersion:207,action:'pos_sale',recordId,idempotent:requests.length>1,preview:preview(),writerResult:{success:true}}});});
 await page.goto(url);await page.evaluate(()=>{document.documentElement.dataset.dropSuccess207='1';const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('document-correction207:')&&v.includes('"status":"succeeded"')&&document.documentElement.dataset.dropSuccess207==='1')return;return original.call(this,k,v);};});
 let d=await open(page);await d.getByLabel('سبب التصحيح').fill('مستند نجاحه محفوظ بالخادم');await d.getByRole('button',{name:'تأكيد التصحيح'}).click();await expect(d.getByRole('alert')).toContainText('استعد نفس المحاولة');await expect(d.getByRole('alert')).not.toContainText('لم يُرسل');await expect(page.getByTestId('saved')).toContainText('0');expect(requests.length).toBe(1);
 await page.reload();d=await open(page);await d.getByRole('button',{name:'استعادة نفس المحاولة'}).click();await expect(page.getByTestId('saved')).toContainText('1');expect(requests.length).toBe(2);expect(requests[1]).toEqual(requests[0]);
});
for(const changedIdentity of [false,true])test(`207 delayed prior success ${changedIdentity?'cannot replace another immutable request':'accepts its identical confirmed server response'}`,async({page})=>{
 await mock(page);let calls=0;
 const key=`document-correction207:66660000-0000-4000-8000-000000000001:pos_sale:${recordId}`;
 await page.route('**/rest/v1/rpc/execute_document_correction_once',async route=>{
  calls++;await page.evaluate(({key,changedIdentity})=>{
   const attempt=JSON.parse(localStorage.getItem(key)!);attempt.status='succeeded';
   if(changedIdentity)attempt.reason='سبب مختلف لا يخص الرد الجاري';
   localStorage.setItem(key,JSON.stringify(attempt));
  },{key,changedIdentity});
  await route.fulfill({json:{success:true,contractVersion:207,action:'pos_sale',recordId,idempotent:true,preview:preview(),writerResult:{success:true}}});
 });
 await page.goto(url);const d=await open(page);await d.getByLabel('سبب التصحيح').fill('المستند نفسه من نافذتين');await d.getByRole('button',{name:'تأكيد التصحيح'}).click();
 if(changedIdentity){await expect(d.getByRole('alert')).toContainText('تغيّرت حالة المحاولة');await expect(page.getByTestId('saved')).toContainText('0');}
 else{await expect(page.getByTestId('saved')).toContainText('1');await expect(d.getByRole('status')).toContainText('تم التصحيح');}
 expect(calls).toBe(1);expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).status,key)).toBe('succeeded');
});
