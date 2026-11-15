import {test,expect} from './isolated-test';

test.use({hasTouch:true,locale:'ar-JO'});
test.describe.configure({retries:0});
for(const mode of ['OFF','ON']){
 const suffix=mode==='ON'?'&full':'';
 test(`${mode} iPhone-width storefront keeps complete Latin prices and counts in an Arabic browser`,async({page},info)=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(`/e2e/price-visibility-harness.html?view=cards&columns=1${suffix}`);
  const cards=page.getByTestId('price-grid');await expect(cards.locator('article')).toHaveCount(4);
  await expect(cards).toContainText('1,234.750 د.أ');
  await expect(cards).not.toContainText(/[٠-٩۰-۹]/);
  await expect(cards).toContainText('1 نكهات');
  const price=cards.getByText('1,234.750 د.أ',{exact:true}).first();await expect(price).toBeVisible();
  const bounds=await price.evaluate(e=>{let node=e;while(node.clientWidth===0&&node.parentElement)node=node.parentElement;return{width:node.clientWidth,scroll:node.scrollWidth};});expect(bounds.width).toBeGreaterThan(0);expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
  await page.screenshot({path:info.outputPath(`store-390-${mode}.png`),fullPage:true});
 });
 test(`${mode} iPhone-width POS keeps its exact Latin amount and actual unit`,async({page},info)=>{
  await page.setViewportSize({width:390,height:844});
  // This display test uses fixed reads; realtime must remain in-browser too.
  await page.routeWebSocket(url=>url.hostname==='127.0.0.1'&&url.port==='4176',socket=>socket.close());
  await page.goto('/e2e/package-f-pos-harness.html?toast&no-mix'+(mode==='OFF'?'&sales-only':''));
  const card=page.getByTestId('pos-product-list').locator('article').first();await expect(card).toBeVisible();
  await expect(card).toContainText('21.600');await expect(card).toContainText('0.900');await expect(card).not.toContainText(/[٠-٩۰-۹]/);
  await page.screenshot({path:info.outputPath(`pos-390-${mode}.png`),fullPage:true});
 });
}
