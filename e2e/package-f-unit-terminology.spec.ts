import AxeBuilder from '@axe-core/playwright';
import {test,expect} from './isolated-test';
import {checkLayout} from './package-f-layout';
import {analyzePackageFAccessibility} from './package-f-accessibility';

for(const theme of ['light','dark'])for(const width of [390,820,1440])test(`base-unit terms ${theme} ${width}: real units, no PCS for new products, stable amounts`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto(`/e2e/package-f-products-harness.html?theme=${theme}&view=form`);
  const dialog=page.getByRole('dialog');
  const unit=dialog.getByRole('combobox',{name:'الوحدة الأساسية',exact:true});
  await expect(unit.locator('option')).toHaveText(['باكيت','شوال','قنينة']);
  await dialog.getByLabel('سعر شراء الطرد',{exact:true}).fill('24');
  await dialog.getByLabel('عدد باكيت في طرد الشراء',{exact:true}).fill('24');
  await expect(dialog.getByLabel('سعر شراء باكيت',{exact:true})).toHaveValue('1');
  for(const name of ['شوال','قنينة','باكيت']){
    await unit.selectOption(name);
    await expect(dialog.getByLabel(`عدد ${name} في طرد الشراء`,{exact:true})).toHaveValue('24');
    await expect(dialog.getByLabel(`سعر شراء ${name}`,{exact:true})).toHaveValue('1');
    await expect(dialog).not.toContainText(/حبة|حبات/u);
  }
  await checkLayout(page,page.getByTestId('products-workbench'));
  const result=await analyzePackageFAccessibility(page,new AxeBuilder({page}));
  expect(result.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
});

for(const theme of ['light','dark'])for(const width of [390,820,1440])test(`POS content label ${theme} ${width}: packet default then real product unit`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto(`/e2e/package-f-pos-harness.html?theme=${theme}&base-unit=sack`);
  await expect(page.getByRole('radio',{name:'باكيت',exact:true})).toBeVisible();
  if(width<1024)await page.getByRole('button',{name:'مراجعة السلة والعميل',exact:true}).click();
  await expect(page.getByTestId('pos-cart-base-units').filter({visible:true})).toHaveText('0 باكيت');
  if(width<1024)await page.getByRole('button',{name:'رجوع للبيع',exact:true}).click();
  await page.locator('[data-pos-product-card]').first().click();
  await expect(page.getByRole('radio',{name:'شوال',exact:true})).toBeVisible();
  if(width<1024)await page.getByRole('button',{name:'مراجعة السلة والعميل',exact:true}).click();
  await expect(page.getByTestId('pos-cart-base-units').filter({visible:true})).toHaveText('24 شوال');
  await expect(page.getByTestId('pos-workbench')).not.toContainText(/وحدة الصنف|وحدات صغرى/u);
  await checkLayout(page,page.getByTestId('pos-workbench'));
  const result=await analyzePackageFAccessibility(page,new AxeBuilder({page}));
  expect(result.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
});
