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
