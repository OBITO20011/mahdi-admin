import {checkLayout} from './package-f-layout';
import {test,expect} from './isolated-test';

test('P1 pending quantities preserve product/unit identity and explicitly scope partial pages',async({page})=>{
  await page.goto('/e2e/pretrial-p1-harness.html');
  const list=page.getByRole('list',{name:'كميات المعلّق حسب الصنف'});
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByRole('listitem').filter({hasText:'عصير'})).toHaveText('عصير5 باكيت');
  await expect(list.getByRole('listitem').filter({hasText:'أرز'})).toHaveText('أرز1 شوال');
  await expect(page.getByText(/عرض 25 من 80 سجلاً.*هذه الصفحة فقط/)).toBeVisible();
  await expect(list).not.toContainText('999');await checkLayout(page,page.locator('main'));
});

test('P1 known and unknown rejections remain refusals with Arabic text and safe optional references',async({page})=>{
  await page.goto('/e2e/pretrial-p1-harness.html');
  const known=page.getByRole('region',{name:'رفض معروف'}),unknown=page.getByRole('region',{name:'رفض غير معروف'});
  await expect(known.getByRole('alert')).toContainText('العدد أكبر من البضاعة المتبقية لدى المورد');
  await expect(known.locator('code')).toBeHidden();await known.locator('summary').click();
  await expect(known.locator('code')).toHaveText('SUPPLIER_REPLACEMENT_EXCEEDS_PENDING');
  await expect(unknown.getByRole('alert')).toContainText('تعذر إتمام العملية');
  await expect(unknown).not.toContainText('hidden database detail');
  await expect(page.getByRole('button',{name:/تأكيد|حفظ/})).toHaveCount(0);
});

test('P1 product code is Arabic and the existing generator remains a usable small touch target',async({page})=>{
  await page.goto('/e2e/package-f-products-harness.html?view=form');
  const dialog=page.getByRole('dialog');await expect(dialog).toHaveAttribute('data-state','open');
  await expect(dialog.getByLabel('رمز الصنف',{exact:true})).toBeVisible();
  await expect(dialog.getByLabel('SKU',{exact:true})).toHaveCount(0);
  const generate=dialog.getByRole('button',{name:'توليد',exact:true});await expect(generate).toBeVisible();
  const box=await generate.boundingBox();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);
  await checkLayout(page,dialog);
});

test('P1 unsupported monthly collection card is absent while current customer debt indicators stay',async({page})=>{
  await page.goto('/e2e/package-f-customers-harness.html');
  const summary=page.getByTestId('customer-aging-summary');
  await expect(summary).toBeVisible();await expect(summary).not.toContainText('تحصيل هذا الشهر');
  await expect(summary).toContainText('إجمالي الذمم');await expect(summary).toContainText('تجاوزوا حد الدين');
});

test('P1 receiving uses shop terminology and per-item actual units without a mixed-unit grand quantity',async({page})=>{
  await page.route('**/rest/v1/rpc/get_receiving_purchase_context',r=>r.fulfill({json:{products:[]}}));
  await page.goto('/e2e/package-f-purchasing-harness.html?view=receive');
  await expect(page.getByRole('heading',{name:/استلام بضاعة/})).toBeVisible();
  await expect(page.getByLabel('رقم وصل المورد (اختياري)',{exact:true})).toBeVisible();
  const quantities=page.getByRole('status',{name:'الكميات الداخلة حسب الصنف'});
  await expect(quantities).toContainText('عصير برتقال');await expect(quantities).toContainText('باكيت');
  await expect(quantities).not.toContainText('إجمالي الوحدات');await expect(page.locator('body')).not.toContainText('Goods Receipt Note');
});

test('P1 partial receipt asks for its reason on selection and a known denial cannot enable saving',async({page})=>{
  const product='88880000-0000-4000-8000-000000000002',supplier='88880000-0000-4000-8000-000000000003',warehouse='88880000-0000-4000-8000-000000000004';
  await page.route('**/rest/v1/rpc/get_supplier_replacement_options_v1',r=>r.fulfill({json:{contractVersion:208,products:[],suppliers:[],warehouses:[],lastSuppliers:[]}}));
  await page.route('**/rest/v1/rpc/get_supplier_replacements_page_v1',r=>r.fulfill({json:{contractVersion:208,page:1,pageSize:25,totalCount:1,pendingQuantity:2,cases:[{id:'88880000-0000-4000-8000-000000000005',productId:product,productName:'عصير',supplierId:supplier,supplierName:'المورد',warehouseId:warehouse,branchId:'branch',origin:'shop',quantity:2,commercialQuantity:2,unitsPerCommercialUnit:1,unitName:'باكيت',baseUnitName:'باكيت',pendingQuantity:2,receivedQuantity:0,writtenOffQuantity:0,occurredAt:'2026-10-21T10:00:00Z',events:[]}]}}));
  const calls:Record<string,unknown>[]=[];await page.route('**/rest/v1/rpc/preview_supplier_replacement_v1',r=>{calls.push(r.request().postDataJSON());return r.fulfill({json:{contractVersion:208,action:'receive',eligible:false,blockedReason:'SUPPLIER_REPLACEMENT_EXCEEDS_PENDING'}});});
  await page.goto('/e2e/supplier-replacement208-harness.html?role=manager');
  await page.getByRole('button',{name:'المعلّق',exact:true}).click();await expect(page.getByLabel('سبب العملية',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'معاينة استلام جزئي',exact:true}).click();
  const reason=page.getByLabel('سبب العملية',{exact:true});await expect(reason).toBeFocused();
  await expect(page.getByRole('button',{name:'معاينة التفاصيل'})).toBeDisabled();expect(calls).toHaveLength(0);
  await reason.fill('استلام جزء من المورد');await page.getByRole('button',{name:'معاينة التفاصيل'}).click();
  await expect(page.getByRole('alert')).toContainText('العدد أكبر من البضاعة المتبقية لدى المورد');
  expect(calls).toEqual([{p_action:'receive',p_payload:{caseId:'88880000-0000-4000-8000-000000000005',quantity:2,reason:'استلام جزء من المورد'}}]);
  await expect(page.getByRole('button',{name:'تأكيد وحفظ العملية'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'معاينة رفض المورد'})).toHaveCount(0);
});
