import {test,expect} from './isolated-test';
import {checkLayout} from './package-f-layout';
import {analyzePackageFAccessibility,waitForPackageFMotion} from './package-f-accessibility';

for(const theme of ['light','dark'])for(const width of [390,820,1440]){
  test(`owner warehouses ${theme} ${width}`,async({page})=>{
    await page.setViewportSize({width,height:844});await page.goto('/e2e/package-f-warehouses-harness.html?theme='+theme);
    await expect(page.getByRole('heading',{name:'المستودع الرئيسي',exact:true})).toBeVisible();
    await page.evaluate(()=>document.fonts.ready);
    expect(await page.evaluate(()=>document.fonts.check('600 16px "IBM Plex Sans Arabic"'))).toBe(true);
    expect(await page.evaluate(()=>Array.from(document.fonts).some(font=>font.family.includes('IBM Plex Sans Arabic')&&font.status==='loaded'))).toBe(true);
    const add=page.getByRole('button',{name:'مستودع جديد',exact:true});await expect(add).toBeInViewport();
    await expect(page.getByRole('heading',{name:'مستودع متوقف',exact:true})).toBeVisible();
    await checkLayout(page,page.locator('main'));expect((await analyzePackageFAccessibility(page)).violations).toEqual([]);
    await page.getByRole('button',{name:'تعديل المستودع',exact:true}).first().click();
    const dialog=page.getByRole('dialog');await expect(dialog).toHaveAttribute('data-state','open');await waitForPackageFMotion(page);
    await expect(dialog.getByRole('checkbox',{name:'المستودع نشط'})).toBeDisabled();
    await expect(dialog.getByRole('combobox',{name:'الفرع',exact:true})).toBeDisabled();
    await dialog.getByRole('textbox',{name:'اسم المستودع',exact:true}).fill('مستودع المحل');
    await checkLayout(page,dialog);expect((await analyzePackageFAccessibility(page)).violations).toEqual([]);
    await dialog.getByRole('button',{name:'حفظ المستودع',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading',{name:'مستودع المحل',exact:true})).toBeVisible();
    const payload=await page.evaluate(()=>Reflect.get(window,'warehouseCalls').filter((c:{name:string})=>c.name==='save_owner_warehouse_v1'));
    expect(payload).toEqual([{name:'save_owner_warehouse_v1',args:{p_id:'warehouse-main',p_code:'WH-MAIN',p_name:'مستودع المحل',p_branch_id:'branch-main',p_is_active:true,p_expected_updated_at:'2026-10-19T00:00:00+00:00'}}]);
    await page.getByTestId('warehouse-warehouse-history').getByRole('button',{name:'تعديل المستودع',exact:true}).click();
    await expect(dialog).toHaveAttribute('data-state','open');
    await expect(dialog.getByRole('checkbox',{name:'المستودع نشط'})).toBeDisabled();
    await expect(dialog.getByText('لا يمكن التعطيل بعد أي حركة مخزون، حتى لو كان الرصيد صفراً. تغيير الاسم مسموح.',{exact:true})).toBeVisible();
    await expect(dialog.getByRole('textbox',{name:'اسم المستودع',exact:true})).toBeEnabled();
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
    await page.getByTestId('warehouse-warehouse-product').getByRole('button',{name:'تعديل المستودع',exact:true}).click();
    await expect(dialog).toHaveAttribute('data-state','open');
    await expect(dialog.getByRole('checkbox',{name:'المستودع نشط'})).toBeDisabled();
    await expect(dialog.getByText('لا يمكن تعطيل مستودع مرتبط بصنف، حتى برصيد صفر ودون حركة. تغيير الاسم مسموح.',{exact:true})).toBeVisible();
    await expect(dialog.getByRole('textbox',{name:'اسم المستودع',exact:true})).toBeEnabled();
    await checkLayout(page,dialog);expect((await analyzePackageFAccessibility(page)).violations).toEqual([]);
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
    await add.click();await expect(dialog).toHaveAttribute('data-state','open');
    await dialog.getByRole('textbox',{name:'اسم المستودع',exact:true}).fill('مستودع جديد للمحل');
    await expect(dialog.getByText('الفرع: الفرع الرئيسي',{exact:true})).toBeVisible();
    await dialog.getByRole('button',{name:'حفظ المستودع',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading',{name:'مستودع جديد للمحل',exact:true})).toBeVisible();
    const inactive=page.getByTestId('warehouse-warehouse-inactive');
    await inactive.getByRole('button',{name:'تعديل المستودع',exact:true}).click();await expect(dialog).toHaveAttribute('data-state','open');
    await expect(dialog.getByRole('checkbox',{name:'المستودع نشط'})).toBeEnabled();
    await dialog.getByRole('checkbox',{name:'المستودع نشط'}).check();
    await dialog.getByRole('button',{name:'حفظ المستودع',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect(inactive.getByText('نشط',{exact:true})).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/[٠-٩]/u);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}
for(const theme of ['light','dark']){
  test(`warehouse owner authority ${theme}`,async({page})=>{
    await page.goto(`/e2e/package-f-warehouses-harness.html?theme=${theme}&role=cashier`);
    await expect(page.getByText('إدارة الفروع والمستودعات متاحة للمالك فقط.',{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>Reflect.get(window,'warehouseCalls'))).toEqual([]);
  });
  test(`single warehouse defaults same ID and restores choice ${theme}`,async({page})=>{
    await page.goto(`/e2e/package-f-warehouses-harness.html?theme=${theme}&choice=1`);
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByRole('status',{name:'المعرف المرسل'})).toHaveText('warehouse-main');
    await page.getByRole('button',{name:'تغيير عدد المستودعات'}).click();
    await expect(page.getByRole('combobox')).toBeVisible();
    await page.getByRole('combobox').selectOption('warehouse-empty');
    await expect(page.getByRole('status',{name:'المعرف المرسل'})).toHaveText('warehouse-empty');
  });
}
