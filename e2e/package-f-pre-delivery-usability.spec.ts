import {test,expect} from './isolated-test';
import {checkLayout} from './package-f-layout';
import {posFixtureIds} from './package-f-pos.fixture';

for(const width of [390,1440]) {
  test(`payment choice advertises existing partial path from first glance ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:width===390?844:1100});
    await page.goto('/e2e/package-f-pos-harness.html?theme=light');
    const choice=page.getByRole('radio',{name:'دين / دفع جزئي',exact:true}).filter({visible:true});
    await expect(choice).toBeVisible();
    await expect(page.getByRole('radio',{name:'كاش',exact:true}).filter({visible:true})).toBeChecked();
    await page.evaluate(()=>document.fonts.ready);
    await checkLayout(page,page.getByTestId('pos-workbench'));
    const box=await choice.boundingBox();expect(box).not.toBeNull();
    expect(await choice.evaluate(e=>e.scrollHeight<=e.clientHeight)).toBe(true);
    await page.screenshot({path:info.outputPath(`after-payment-${width}.png`),fullPage:true});
    await page.locator('[data-pos-product-card]').first().click();
    await choice.click();
    await expect(page.getByLabel('المدفوع الآن',{exact:true})).toBeVisible();
    await expect(page.getByLabel('اختيار العميل',{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });

  test(`daily close stays primary and exceptional corrections are folded ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:width===390?844:1100});
    await page.goto('/e2e/package-f-cash-harness.html?theme=light');
    const section=page.getByTestId('shift-exceptional-correction');
    await expect(section).not.toHaveAttribute('open');
    await expect(page.getByRole('button',{name:'إلغاء وردية فُتحت بالخطأ',exact:true})).toBeHidden();
    await expect(page.getByRole('button',{name:'إلغاء الوردية وعكس جميع عملياتها',exact:true})).toBeHidden();
    if(width===390){
      const close=page.getByTestId('cash-count-open');await expect(close).toBeVisible();
      await close.click();await expect(page.getByRole('dialog',{name:'إغلاق الوردية',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'رجوع للصندوق',exact:true}).click();
    }else await expect(page.getByTestId('cash-close-submit')).toBeVisible();
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath(`after-shifts-folded-${width}.png`)});
    await section.locator('summary').click();
    await expect(section).toContainText('لا تستخدم الإلغاء أو العكس للإغلاق اليومي');
    await expect(section.getByRole('button',{name:'إلغاء وردية فُتحت بالخطأ',exact:true})).toBeVisible();
    await expect(section.getByRole('button',{name:'إلغاء الوردية وعكس جميع عملياتها',exact:true})).toBeVisible();
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:info.outputPath(`after-shifts-${width}.png`),fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });

  test(`unknown sale has actionable private text and recovers the exact original request ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:width===390?844:1100});
    const requests:unknown[]=[];
    const sensitive='اسم زبون خاص 0799999999 12345.678 token=secret basket=private SQL_INTERNAL_999';
    await page.route('**/rest/v1/rpc/create_pos_sale_v2',route=>{
      requests.push(route.request().postDataJSON());
      return route.fulfill({status:500,json:{code:'XX000',message:sensitive,details:sensitive,hint:sensitive}});
    });
    await page.goto('/e2e/package-f-pos-harness.html?theme=light');
    await page.locator('[data-pos-product-card]').first().click();
    await page.locator('[data-testid="pos-complete-sale"]:visible').click();
    const notice=page.getByRole('status').filter({hasText:'لم نتأكد هل البيع انحفظ'});
    await expect(notice).toContainText('استخدم استرجاع المحاولة؛ لا تنشئ بيعاً جديداً');
    await expect(notice).toContainText('POS-03');await expect(page.locator('body')).not.toContainText(sensitive);
    await expect(page.locator('[data-testid="pos-complete-sale"]:visible')).toBeDisabled();
    const key=`nawasrah:pos-v2:attempt:v1:${posFixtureIds.actor}`;
    const pending=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)!),key);
    expect(pending.status).toBe('OUTCOME_UNKNOWN');expect(requests).toHaveLength(1);
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:info.outputPath(`after-error-${width}.png`),fullPage:true});
    await page.reload();
    await page.getByRole('button',{name:'استرجاع محاولة البيع',exact:true}).click();
    await expect.poll(()=>requests.length).toBe(2);expect(requests[1]).toEqual(requests[0]);
    const recovered=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)!),key);
    expect(recovered.request).toEqual(pending.request);
    await expect(notice).toContainText('POS-03');
  });

  test(`aftercare read failure never shows raw technical or customer values ${width}`,async({page})=>{
    await page.setViewportSize({width,height:width===390?844:1100});
    const sensitive='اسم خاص 0799999999 12345.678 SQL_INTERNAL_999 token=secret';
    await page.route('**/rest/v1/rpc/get_admin_sales_aftercare_context_v1',route=>route.fulfill({status:500,json:{message:sensitive,code:'XX000',details:sensitive}}));
    await page.goto('/e2e/aftercare-cleanup-harness.html');
    await expect(page.getByText(/مرجع: RET-02/)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(sensitive);
    await expect(page.getByRole('button',{name:'إرجاع أو استبدال',exact:true})).toHaveCount(0);
  });
}
