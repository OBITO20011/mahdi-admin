import {test,expect} from './isolated-test';
const actor='92600000-0000-4000-8000-000000000001',order='00000000-0000-4000-8000-000000000002',operation='92600000-0000-4000-8000-000000000010',token='92600000-0000-4000-8000-000000000011';
test('lite delivery UI retains lostreply across reload and recovers same metadata/key via actual service',async({page})=>{
 await page.setViewportSize({width:390,height:1000});const sent:Record<string,unknown>[]=[];const mutations=new Set<string>();
 await page.route('**/rest/v1/orders*',route=>route.fulfill({json:{operation_id:operation}}));await page.route('**/rest/v1/business_operations*',route=>route.fulfill({json:{id:operation,operation_type:'lite1_guest'}}));
 await page.route('**/rpc/lite1_delivery2',route=>{const args=route.request().postDataJSON();sent.push(args);mutations.add(args.p_key);if(sent.length===1)return route.abort('failed');return route.fulfill({json:{success:true,order_id:order,status:'out_for_delivery',accountingTracked:false,estimated_arrival_at:'2026-11-09T22:20:00Z',tracking_token:token,driver_phone:'0791234567'}});});
 await page.goto('/e2e/package-f-orders-harness.html?select=1&liteDelivery=1');await page.getByRole('button',{name:'بدء التوصيل وتحديد وقت الوصول',exact:true}).click();await page.getByRole('textbox',{name:/^رقم هاتف السائق/}).fill('0791234567');await page.getByRole('button',{name:'بدء التوصيل',exact:true}).click();
 await expect(page.getByRole('button',{name:'استرجاع التوصيل المحفوظ',exact:true})).toBeVisible();expect(sent).toHaveLength(1);const key=sent[0].p_key;
 await page.reload();await page.getByRole('button',{name:'استرجاع التوصيل المحفوظ',exact:true}).click();await expect.poll(()=>sent.length).toBe(2);await expect(page.getByRole('button',{name:'استرجاع التوصيل المحفوظ',exact:true})).toHaveCount(0);expect(sent[1]).toEqual(sent[0]);expect(mutations.size).toBe(1);
 const journal=await page.evaluate(({actor,order})=>{const k='nawasrah:lite-delivery2:http://127.0.0.1:4176:'+actor+':'+order;return JSON.parse(localStorage.getItem(k)!);},{actor,order});expect(journal.status).toBe('SUCCEEDED');expect(journal.key).toBe(key);
});
