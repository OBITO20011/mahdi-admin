import {test,expect} from './isolated-test';
import {checkLayout} from './package-f-layout';
import AxeBuilder from '@axe-core/playwright';
import {inventoryProducts} from './package-f-inventory.fixture';

for(const width of [390,1440])test(`POS selected customer debt is a read-only warning,not a sale block ${width}`,async({page})=>{
  await page.setViewportSize({width,height:960});await page.goto('/e2e/package-f-pos-harness.html?theme=dark');
  await page.locator('[data-pos-product-card]').first().click();
  if(width<1024)await page.getByRole('button',{name:'مراجعة السلة والعميل',exact:true}).click();
  await page.getByLabel('اختيار العميل',{exact:true}).selectOption('55555555-5555-4555-8555-555555555555');
  const debt=page.getByTestId('pos-customer-debt').filter({visible:true});
  await expect(debt).toContainText('عليه 45.000');await expect(debt).toContainText('حد الدين 40.000');
  await expect(debt).toContainText('تجاوز الحد');await expect(debt).toHaveClass(/text-nw-warn/u);
  await checkLayout(page,page.getByTestId('pos-workbench'));
  const accessibility=await new AxeBuilder({page}).include('[data-testid="pos-workbench"]').analyze();
  expect(accessibility.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
  if(width<1024)await page.getByRole('button',{name:'رجوع للبيع',exact:true}).click();
  await expect(page.locator('[data-testid="pos-complete-sale"]:visible')).toBeEnabled();
});
test('POS zero debt remains zero and does not show a limit warning',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await page.goto('/e2e/package-f-pos-harness.html?zero-debt=1');
  await page.getByLabel('اختيار العميل',{exact:true}).selectOption('55555555-5555-4555-8555-555555555555');
  await expect(page.getByTestId('pos-customer-debt')).toContainText('عليه 0.000');
  await expect(page.getByTestId('pos-customer-debt')).not.toContainText('تجاوز الحد');
  await checkLayout(page,page.getByTestId('pos-workbench'));
});
test('available stock filter crosses the existing RPC adapter instead of filtering a visible page',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  const statuses:string[]=[];
  await page.route('**/rest/v1/rpc/get_admin_inventory_product_page',async route=>{
    const args=route.request().postDataJSON();statuses.push(args.p_status);
    await route.fulfill({json:{products:args.p_status==='available'?inventoryProducts.filter(p=>p.available_quantity>0):inventoryProducts,
      total_count:args.p_status==='available'?124:126,metrics:{total_items:126,active_items:120,available_stock:124,
        total_cost_in_minor_units:18642300,total_retail_in_minor_units:23100000,low_stock:7,out_of_stock:2,stagnant:4}}});
  });
  await page.goto('/e2e/package-f-inventory-harness.html?live=1');
  await page.getByRole('tablist',{name:'حالة المخزون'}).getByRole('tab',{name:/متوفر/u}).click();
  await expect.poll(()=>statuses.includes('available')).toBe(true);
  await expect(page.locator('[data-inventory-product-row]')).toHaveCount(23);
  await expect(page.getByRole('columnheader',{name:'القيمة',exact:true})).toHaveCount(0);
  await expect(page.locator('[data-inventory-product-row]').first()).toContainText('48 باكيت');
  await checkLayout(page,page.getByTestId('inventory-workbench'));
});
