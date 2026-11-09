import {test,expect} from './isolated-test';
test.use({hasTouch:true});
test('verified lite navigation hides accounting everywhere and browser back retains prior commercial screen',async({page})=>{
 await page.setViewportSize({width:390,height:1000});
 await page.route('**/rpc/lite1_operating_mode',route=>route.fulfill({json:{contractVersion:'sales-only-phase2-v1',fullAccounting:false}}));
 await page.goto('/e2e/sales-only-phase2-navigation-harness.html');
 await expect(page.getByTestId('active-screen')).toHaveText('more');
 await expect(page.locator('[data-navigation-id="inventory-current"]')).toHaveCount(0);
 await expect(page.locator('[data-side-nav="inventory"]')).toHaveCount(0);
 await expect(page.locator('[data-navigation-id="supplier-receiving"]')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'إطفاء المحاسبة والمخزون',exact:true})).toHaveCount(0);
 await page.locator('[data-bottom-tab="products"]').tap();await expect(page.getByTestId('active-screen')).toHaveText('products');
 await page.locator('[data-bottom-tab="orders"]').tap();await expect(page.getByTestId('active-screen')).toHaveText('orders');
 await page.goBack();await expect(page.getByTestId('active-screen')).toHaveText('products');
 await page.setViewportSize({width:1280,height:900});
 await expect(page.locator('[data-side-nav="products"]')).toBeVisible();
 await expect(page.locator('[data-side-nav="inventory"]')).toHaveCount(0);
 await expect(page.locator('[data-side-nav="purchases"]')).toHaveCount(0);
});
test('mode owner control keeps unknown result fenced and only reads again;nonowner has no control',async({page})=>{
 let mutations=0,reads=0;
 await page.route('**/rpc/lite1_operating_mode',route=>{reads++;return route.fulfill({json:{contractVersion:'sales-only-phase2-v1',fullAccounting:true}});});
 await page.route('**/rpc/lite1_set_mode2',route=>{mutations++;return route.abort('failed');});
 await page.goto('/e2e/sales-only-phase2-navigation-harness.html');
 const panel=page.getByRole('region',{name:'وضع التشغيل'});await expect(panel).toBeVisible();
 await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'إطفاء المحاسبة والمخزون',exact:true}).click();
 // With the unauthenticated local GoTrue fixture the AAL2/identity preflight
 // fails closed before mutation;the same unknown-state fence is required.
 await expect(panel.getByRole('alert')).toContainText('MODE-01');expect(mutations).toBe(0);
 await expect(panel.getByRole('checkbox')).toBeDisabled();
 await panel.getByRole('button',{name:'إعادة قراءة وضع التشغيل'}).click();await expect.poll(()=>reads).toBeGreaterThan(1);expect(mutations).toBe(0);
 await page.goto('/e2e/sales-only-phase2-navigation-harness.html?role=view_only');
 await expect(page.getByRole('region',{name:'وضع التشغيل'})).toHaveCount(0);
});
