import {test,expect} from './isolated-test';
import {checkLayout} from './package-f-layout';
for(const width of [360,390,1440])test(`T-A formed parcel with bottle/can units shows packets and keeps original guest payload ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:950});
 const writes:string[]=[];await page.route('**/rest/v1/**',route=>{writes.push(new URL(route.request().url()).pathname);return route.fulfill({json:[]});});
 await page.goto('/e2e/package-f-trial-ta-harness.html');const dialog=page.getByRole('dialog');
 await expect(dialog.getByRole('heading',{name:'اختر ٣ باكيت',exact:true})).toBeVisible();await expect(dialog).not.toContainText(/قنينة|زجاجة|علبة|كرتونة/u);
 await page.getByRole('button',{name:'زيادة توت',exact:true}).click();await page.getByRole('button',{name:'زيادة توت',exact:true}).click();await page.getByRole('button',{name:'زيادة برتقال',exact:true}).click();
 await page.getByRole('button',{name:'إضافة الطرد للسلة',exact:true}).click();
 const result=await page.evaluate(()=>(window as unknown as {trialTA:{payload:unknown;savedUnit:string;componentUnits:string[];catalogUnchanged:boolean}}).trialTA);
 expect(result.catalogUnchanged).toBe(true);expect(result.savedUnit).toBe('كرتونة');expect(result.componentUnits).toEqual(['قنينة','علبة']);expect(result.payload).toEqual([{commercial_line_kind:'configurable_parcel',family_product_id:'12800000-0000-4000-8000-000000000001',parcel_configuration_id:'12800000-0000-4000-8000-000000000002',configuration_revision:7,expected_unit_price_in_minor_units:1500,parcel_instances:[{components:[{product_id:'12800000-0000-4000-8000-000000000003',base_quantity:2},{product_id:'12800000-0000-4000-8000-000000000004',base_quantity:1}]}]}]);
 await checkLayout(page,dialog);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(writes).toEqual([]);await page.screenshot({path:info.outputPath('trial-ta-formed-parcel.png'),fullPage:true});
});
