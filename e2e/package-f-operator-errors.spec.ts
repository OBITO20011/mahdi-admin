import {test,expect,type Page} from './isolated-test';
import {wizard215Scenario,wizard215Order} from './aftercare215-wizard.fixture';
import {checkLayout} from './package-f-layout';

const privateText='اسم خاص 0799999999 12345.678 token=secret basket=private';
const id=(n:number)=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const rejections=[
  ['PHASE3_POS_OPEN_SHIFT_REQUIRED','افتح وردية الصندوق قبل إتمام البيع.'],
  ['PHASE3_POS_INSUFFICIENT_INVENTORY','المخزون المتاح لأحد مكونات البيع غير كافٍ.'],
  ['PARCEL209_UNIT_SALE_FORBIDDEN','هذا الصنف بيتباع بالطرد بس. احذف سطر المفرد وأضفه كطرد؛ لا تتغيّر السلة تلقائياً.'],
] as const;

async function openCart(page:Page){
  const open=page.getByRole('button',{name:'مراجعة السلة والعميل',exact:true});
  if(await open.isVisible())await open.click();
}

for(const width of [390,1440]){
  for(const [identity,copy] of rejections)test(`known POS ${identity} stays specific with reference ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:900});let writes=0;
    await page.route('**/rest/v1/rpc/create_pos_sale_v2',route=>{
      writes++;return route.fulfill({status:400,json:{code:'P0001',message:`${identity}: ${privateText}`}});
    });
    await page.goto('/e2e/package-f-pos-harness.html?toast=1');
    await page.locator('[data-pos-product-card]').first().click();
    await page.locator('[data-testid="pos-complete-sale"]:visible').click();
    const alert=page.getByRole('alert');await expect(alert).toHaveText(`${copy} مرجع: POS-04`);
    await expect(page.locator('body')).not.toContainText(privateText);
    await expect(alert).not.toContainText(identity);expect(writes).toBe(1);
    await checkLayout(page,alert);
    await page.screenshot({path:info.outputPath(`specific-${identity}-${width}.png`),fullPage:true});
  });

  test(`partial local validation keeps the precise upper-bound message ${width}`,async({page})=>{
    await page.setViewportSize({width,height:900});let writes=0;
    await page.route('**/rest/v1/rpc/create_pos_sale*',route=>{writes++;return route.abort();});
    await page.goto('/e2e/package-f-pos-harness.html?toast=1');
    await page.locator('[data-pos-product-card]').first().click();await openCart(page);
    await page.getByRole('radio',{name:'دين / دفع جزئي',exact:true}).filter({visible:true}).click();
    await page.getByLabel('اختيار العميل',{exact:true}).selectOption('55555555-5555-4555-8555-555555555555');
    await page.getByLabel('المدفوع الآن',{exact:true}).fill('99.000');
    await expect(page.locator('#pos-initial-paid-help')).toHaveText('المدفوع الآن أكبر من صافي الفاتورة. مرجع: POS-02');
    expect(writes).toBe(0);
    await page.getByLabel('المدفوع الآن',{exact:true}).fill('1.1234');
    await expect(page.locator('#pos-initial-paid-help')).toHaveText('اكتب المدفوع الآن بثلاث خانات عشرية كحد أقصى. مرجع: POS-02');
    expect(writes).toBe(0);
  });

  for(const [code,copy] of [
    ['PHASE4_RETURN_WINDOW_EXPIRED','انتهت مهلة المرتجع أو الاستبدال الأصلية (48 ساعة).'],
    ['AFTERCARE215_REFUND_METHOD_REQUIRED','اختر كاش أو CliQ لفرق المال الفعلي. خفض الذمة وحده لا يرد مالاً سبق دفعه.'],
    ['AFTERCARE215_REFUND_REFERENCE_REQUIRED','مرجع CliQ: اكتب مرجع التحويل قبل التأكيد.'],
  ])test(`known aftercare read ${code} stays specific and private ${width}`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await page.route('**/rest/v1/rpc/get_admin_sales_aftercare_context_v1',route=>route.fulfill({status:400,json:{code:'P0001',message:`${code}: ${privateText}`}}));
    await page.goto('/e2e/aftercare-cleanup-harness.html');
    await expect(page.getByText(`${copy} مرجع: RET-02`,{exact:true})).toBeVisible();
    await expect(page.locator('body')).not.toContainText(privateText);
  });

  test(`aftercare mutation rejection retains expiry instruction and original recovery ${width}`,async({page})=>{
    await page.setViewportSize({width,height:900});
    const {context}=wizard215Scenario('cash');
    await page.route('**/rest/v1/rpc/get_admin_sales_aftercare_context_v1',r=>r.fulfill({json:context}));
    await page.goto('/e2e/aftercare-cleanup-harness.html');
    await expect(page.getByRole('button',{name:'إرجاع أو استبدال',exact:true})).toBeEnabled();
    const original=await page.evaluate(async({actor,order,source})=>{
      // @ts-expect-error Live isolated Vite module; real browser persistence.
      const {runAdminAftercareMutation}=await import('/src/services/supabase/adminAftercareRecovery.ts');
      let key='';try{await runAdminAftercareMutation({auth:{getUser:async()=>({data:{user:{id:actor}},error:null})}} as never,order,'replacement','START_NEW',
        {items:[{sourceKind:'base_order_item',sourceId:source,quantity:12}],reason:'عيب في الطرد',notes:null},
        async(k:string)=>{key=k;throw Error('synthetic lost reply');});}catch{/* Keep the real pending attempt. */}
      return key;
    },{actor:id(70),order:wizard215Order.id,source:id(2)});
    let received:Record<string,unknown>|undefined;
    await page.route('**/rest/v1/rpc/settle_sales_replacement_v1',route=>{
      received=route.request().postDataJSON();
      return route.fulfill({status:400,json:{code:'P0001',message:`PHASE4_RETURN_WINDOW_EXPIRED: ${privateText}`}});
    });
    await page.reload();await page.getByRole('button',{name:'استعادة الاستبدال',exact:true}).click();
    await expect(page.locator('output[role="status"]')).toHaveText('انتهت مهلة المرتجع أو الاستبدال الأصلية (48 ساعة). مرجع: RET-01');
    expect(received?.p_idempotency_key).toBe(original);
    await expect(page.getByRole('button',{name:'إرجاع أو استبدال',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'استعادة الاستبدال',exact:true})).toBeVisible();
    await expect(page.locator('body')).not.toContainText(privateText);
  });
}
