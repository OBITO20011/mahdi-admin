import AxeBuilder from '@axe-core/playwright';
import {test,expect,type Page} from './isolated-test';
import {checkLayout} from './package-f-layout';
import {administrationIds,storefrontSettings,promotionRows} from './package-f-administration.fixture';
import {cashIds} from './package-f-cash.fixture';
async function audit(page:Page){
 await page.evaluate(()=>document.fonts.ready);
 const dialog=page.getByRole('dialog');if(await dialog.count())await expect(dialog.last()).toHaveAttribute('data-state','open');
 await checkLayout(page,page.getByTestId('administration-workbench'));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.getByTestId('administration-workbench')).not.toContainText(/[٠-٩]/u);
 const axe=await new AxeBuilder({page}).analyze();expect(axe.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
}
for(const theme of ['light','dark'])for(const width of [390,820,1440])test(`administration ${theme} ${width}:all five screens,fields,Latin dates,axe and clipping`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto(`/e2e/package-f-administration-harness.html?theme=${theme}`);
 await expect(page.getByText('أحمد النواصرة',{exact:true})).toBeVisible();await audit(page);
 await expect(page.getByRole('button',{name:'إضافة مستخدم',exact:true})).toBeInViewport();
 await page.getByRole('button',{name:'سجل الأمان (1)',exact:true}).click();await expect(page.getByText('تعديل بيانات موظف',{exact:true})).toBeVisible();await audit(page);
 await page.getByRole('button',{name:'إضافة مستخدم',exact:true}).click();
 let dialog=page.getByRole('dialog');await expect(dialog.getByLabel('اسم الموظف الكامل *',{exact:true})).toBeVisible();
 await expect(dialog.getByRole('button',{name:'إنشاء حساب الموظف',exact:true})).toBeInViewport();await audit(page);
 expect(await dialog.locator('input,select').evaluateAll(es=>es.every(e=>e.getBoundingClientRect().height>=44))).toBe(true);
 await dialog.getByRole('button',{name:'إلغاء',exact:true}).click();await expect(dialog).toHaveCount(0);
 for(const name of ['المراقبة','إعدادات المتجر','رموز الخصم']){
  await page.getByRole('button',{name,exact:true}).click();dialog=page.getByRole('dialog',{name,exact:true});
  await expect(dialog).toHaveAttribute('data-state','open');await audit(page);
  if(name==='إعدادات المتجر'){
   await expect(dialog.getByRole('button',{name:'حفظ وتطبيق على الموقع',exact:true})).toBeInViewport();
   expect(await dialog.locator('input,textarea').evaluateAll(es=>es.every(e=>e.getBoundingClientRect().height>=44))).toBe(true);
   await dialog.getByText('سياسة الاستبدال والاسترجاع',{exact:true}).scrollIntoViewIfNeeded();await expect(dialog.getByText('سياسة الاستبدال والاسترجاع',{exact:true})).toBeInViewport();await audit(page);
  }
  if(name==='رموز الخصم'){
   await expect(dialog.getByRole('button',{name:'إنشاء رمز الخصم',exact:true})).toBeInViewport();
   await dialog.getByText('WELCOME',{exact:true}).scrollIntoViewIfNeeded();await expect(dialog).toContainText('1,234.567');await audit(page);
  }
  await dialog.getByRole('button',{name:'إغلاق',exact:true}).click();await expect(dialog).toHaveCount(0);
 }
});
test('staff creation retains exact roles,owner confirmation,password,branch and busy close guards',async({page})=>{
 const requests:unknown[]=[];let release!:()=>void;
 await page.route('**/functions/v1/manage-staff-users',async route=>{requests.push(route.request().postDataJSON());await new Promise<void>(r=>{release=r;});await route.fulfill({status:400,json:{error:'ISOLATED_PROBE_REJECTION'}});});
 await page.goto('/e2e/package-f-administration-harness.html');await page.getByRole('button',{name:'إضافة مستخدم',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog.getByLabel('الدور والصلاحيات *').locator('option')).toHaveText(['مالك النظام','مدير تنفيذي','محاسب','كاشير','موظف مبيعات','مسؤول مستودع','متابع الطلبات','سائق توصيل','مشاهدة فقط']);
 await dialog.getByLabel('اسم الموظف الكامل *').fill('  موظف المعاينة  ');await dialog.getByLabel('رقم الهاتف',{exact:true}).fill(' 0791234567 ');
 await dialog.getByLabel('البريد الإلكتروني *').fill('staff@example.test');await dialog.getByLabel('كلمة المرور المؤقتة *').fill('ExamplePass123');await dialog.getByLabel('المسمى الوظيفي').fill('  كاشير  ');
 await dialog.getByLabel('الدور والصلاحيات *').selectOption('Owner');let confirmation='';page.once('dialog',async d=>{confirmation=d.message();await d.dismiss();});
 await dialog.getByRole('button',{name:'إنشاء حساب الموظف',exact:true}).click();expect(confirmation).toContain('كامل الصلاحيات');expect(requests).toEqual([]);
 await dialog.getByLabel('الدور والصلاحيات *').selectOption('Cashier');await dialog.getByRole('button',{name:'إنشاء حساب الموظف',exact:true}).click();await expect.poll(()=>requests.length).toBe(1);
 expect(requests).toEqual([{action:'create',fullName:'موظف المعاينة',email:'staff@example.test',phone:'0791234567',jobTitle:'كاشير',branchId:cashIds.branch,roleCode:'cashier',password:'ExamplePass123'}]);
 await expect(dialog.locator('form')).toHaveAttribute('aria-busy','true');await page.keyboard.press('Escape');await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'إلغاء',exact:true})).toBeDisabled();release();
 await expect(dialog.getByRole('alert')).toHaveText('Edge Function returned a non-2xx status code');await expect(dialog.getByRole('button',{name:'إنشاء حساب الموظف',exact:true})).toBeEnabled();
});
test('staff edit,password and activation retain identities,payloads and explicit confirmations',async({page})=>{
 const requests:Record<string,unknown>[]=[];await page.route('**/functions/v1/manage-staff-users',route=>{requests.push(route.request().postDataJSON());return route.fulfill({status:400,json:{error:'ISOLATED_PROBE_REJECTION'}});});
 await page.goto('/e2e/package-f-administration-harness.html');await page.getByRole('button',{name:'تعديل بيانات المستخدم',exact:true}).first().click();
 let dialog=page.getByRole('dialog');await expect(dialog.getByLabel('البريد الإلكتروني *')).toBeDisabled();await dialog.getByLabel('اسم الموظف الكامل *').fill('أحمد المعدل');await dialog.getByRole('button',{name:'حفظ التعديلات',exact:true}).click();await expect.poll(()=>requests.length).toBe(1);
 expect(requests[0]).toEqual({action:'update',userId:administrationIds.cashier,fullName:'أحمد المعدل',phone:'0790000002',jobTitle:'مسؤول نقطة البيع',branchId:cashIds.branch,roleCode:'cashier'});
 await dialog.getByRole('button',{name:'إلغاء',exact:true}).click();await page.getByRole('button',{name:'تغيير كلمة المرور',exact:true}).first().click();dialog=page.getByRole('dialog');await dialog.getByLabel('كلمة المرور الجديدة').fill('ExamplePass456');await dialog.getByRole('button',{name:'تغيير كلمة المرور',exact:true}).click();await expect.poll(()=>requests.length).toBe(2);expect(requests[1]).toEqual({action:'set_password',userId:administrationIds.cashier,password:'ExamplePass456'});
 await dialog.getByRole('button',{name:'إلغاء',exact:true}).click();let confirmed='';page.once('dialog',async d=>{confirmed=d.message();await d.accept();});await page.getByRole('button',{name:'تعطيل الحساب',exact:true}).click();await expect.poll(()=>requests.length).toBe(3);
 expect(confirmed).toContain('تعطيل حساب أحمد النواصرة');expect(requests[2]).toEqual({action:'set_active',userId:administrationIds.cashier,isActive:false});
});
test('non-owner Users remains denied with no staff reads or mutation actions',async({page})=>{
 const requests:string[]=[];page.on('request',r=>{if(r.url().includes('manage-staff-users'))requests.push(r.url());});
 await page.goto('/e2e/package-f-administration-harness.html?role=cashier');await expect(page.getByText('هذه الشاشة للمالك فقط')).toBeVisible();await expect(page.getByRole('button',{name:'إضافة مستخدم',exact:true})).toHaveCount(0);expect(requests).toEqual([]);await audit(page);
});
test('storefront monetary fields,toggles,policy and full save payload stay exact;busy Escape blocked',async({page})=>{
 const requests:unknown[]=[];let release!:()=>void;await page.route('**/rest/v1/rpc/save_storefront_settings_v3',async route=>{requests.push(route.request().postDataJSON());await new Promise<void>(r=>{release=r;});await route.fulfill({status:400,json:{message:'ISOLATED_PROBE_REJECTION',code:'P0001'}});});
 await page.goto('/e2e/package-f-administration-harness.html?view=settings');const dialog=page.getByRole('dialog');await expect(dialog).toHaveAttribute('data-state','open');await expect(dialog.getByLabel('اسم المتجر',{exact:true})).toHaveValue(storefrontSettings.storeNameAr);
 await dialog.getByLabel('الحد الأدنى للطلب (د.أ)').fill('7.125');await dialog.getByLabel('توصيل داخل الرمثا (د.أ)').fill('2.345');await dialog.getByLabel('توصيل خارج الرمثا (د.أ)').fill('5.678');
 await dialog.getByRole('switch',{name:'استقبال طلبات الموقع',exact:true}).click();await dialog.getByLabel('سياسة الاستبدال والاسترجاع').fill('  السياسة المحددة  ');await dialog.getByRole('button',{name:'حفظ وتطبيق على الموقع',exact:true}).click();await expect.poll(()=>requests.length).toBe(1);
 expect(requests).toEqual([{p_store_name_ar:storefrontSettings.storeNameAr,p_whatsapp_number:storefrontSettings.whatsappNumber,p_cliq_alias:storefrontSettings.cliqAlias,p_orders_enabled:false,p_announcement_text:storefrontSettings.announcementText,p_business_hours_text:storefrontSettings.businessHoursText,p_delivery_areas_text:storefrontSettings.deliveryAreasText,p_delivery_eta_text:storefrontSettings.deliveryEtaText,p_exchange_policy_text:'السياسة المحددة',p_minimum_order_in_minor_units:7125,p_inside_ramtha_delivery_fee_in_minor_units:2345,p_outside_ramtha_delivery_fee_in_minor_units:5678,p_show_newest_products:true,p_show_best_sellers:true,p_show_offers:true,p_show_low_stock:false}]);
 await expect(dialog.locator('form')).toHaveAttribute('aria-busy','true');await expect(dialog.getByRole('button',{name:'جارٍ الحفظ...',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await expect(dialog).toBeVisible();await expect(dialog.locator('form')).toHaveAttribute('aria-busy','true');release();await expect(dialog.getByRole('alert')).toContainText('ISOLATED_PROBE_REJECTION');
});
test('promotion percentage guard,fixed amount save and disable payloads remain unchanged',async({page})=>{
 const saved:unknown[]=[],disabled:unknown[]=[];
 await page.route('**/rest/v1/rpc/upsert_promotion_code',route=>{saved.push(route.request().postDataJSON());return route.fulfill({status:400,json:{message:'ISOLATED_PROBE_REJECTION',code:'P0001'}});});
 await page.route('**/rest/v1/rpc/set_promotion_code_active',route=>{disabled.push(route.request().postDataJSON());return route.fulfill({status:400,json:{message:'ISOLATED_PROBE_REJECTION',code:'P0001'}});});
 await page.goto('/e2e/package-f-administration-harness.html?view=promotions');const dialog=page.getByRole('dialog');await expect(dialog).toHaveAttribute('data-state','open');await expect(dialog.getByText('WELCOME',{exact:true})).toBeVisible();await dialog.getByLabel('الرمز *').fill('NEW10');await dialog.getByLabel('النوع *').selectOption('percentage');
 const percentage=dialog.getByLabel('نسبة الخصم % *');await percentage.fill('101');
 // Existing min=.001 / step=.01 rejects integer101 natively before onSubmit.
 // Preserve that constraint;use101.001 to also reach the unchanged >100 guard.
 expect(await percentage.evaluate((e:HTMLInputElement)=>e.validity.stepMismatch)).toBe(true);await dialog.getByRole('button',{name:'إنشاء رمز الخصم',exact:true}).click();expect(saved).toEqual([]);
 await percentage.fill('101.001');expect(await dialog.locator('form').evaluate((f:HTMLFormElement)=>f.checkValidity())).toBe(true);await dialog.getByRole('button',{name:'إنشاء رمز الخصم',exact:true}).click();await expect(dialog.getByText('نسبة الخصم لا يمكن أن تتجاوز 100%.')).toBeVisible();expect(saved).toEqual([]);
 await dialog.getByLabel('النوع *').selectOption('fixed');await dialog.getByLabel('قيمة الخصم (د.أ) *').fill('1.234');await dialog.getByRole('button',{name:'إنشاء رمز الخصم',exact:true}).click();await expect.poll(()=>saved.length).toBe(1);
 expect(saved).toEqual([{p_code:'NEW10',p_discount_type:'fixed',p_discount_value:1234,p_promotion_code_id:null,p_description_ar:null,p_minimum_subtotal_in_minor_units:0,p_maximum_discount_in_minor_units:null,p_starts_at:null,p_expires_at:null,p_maximum_total_redemptions:null,p_maximum_redemptions_per_phone:1,p_is_active:true,p_is_public_offer:true}]);
 await dialog.getByRole('button',{name:'إيقاف',exact:true}).click();await expect.poll(()=>disabled.length).toBe(1);expect(disabled).toEqual([{p_promotion_code_id:promotionRows[0].id,p_is_active:false}]);
});
test('monitoring read failure retains explicit retry without any repair action',async({page})=>{
 await page.goto('/e2e/package-f-administration-harness.html?view=monitoring&monitoring=error');const dialog=page.getByRole('dialog');await expect(dialog.getByText('تعذر تحميل حالة المراقبة. أعد المحاولة بعد قليل.')).toBeVisible();await expect(dialog.getByRole('button',{name:'إعادة المحاولة',exact:true})).toBeVisible();await audit(page);
});
