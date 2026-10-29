import {test,expect} from './isolated-test';
import {damage215Page,nonOwnerDamage215Page} from './aftercare215-damage.fixture';
const harness='/e2e/package-f-trial-owner-r-harness.html';
for(const role of ['owner','manager','warehouse_keeper'])test(`215 damage ledger390 ${role} shows three states and historical parcels without duplicating loss`,async({page},info)=>{
  await page.setViewportSize({width:390,height:844});const requests:Array<Record<string,unknown>>=[];
  await page.route('**/rest/v1/rpc/get_damage_ledger_page_v2',route=>{
    const a=route.request().postDataJSON();requests.push(a);const raw=structuredClone(role==='owner'?damage215Page:nonOwnerDamage215Page()) as Record<string,unknown>;
    Object.assign(raw,{from:a.p_from,to:a.p_to,state:a.p_state,page:a.p_page});return route.fulfill({json:raw});
  });
  await page.goto(harness+'?role='+role);await page.getByRole('tab',{name:'سجل التالف',exact:true}).click();const panel=page.getByTestId('damage-history');
  await expect(panel).toContainText('عصير تجريبي');await expect(panel).toContainText('الكمية: 1 طرد + 2 باكيت');await expect(panel).toContainText('بانتظار المورد: 1 باكيت');
  await expect(panel).toContainText('انتهى مع المورد: 1 باكيت');await expect(panel).toContainText('خسارة نهائية عليّ: 1 طرد');expect(await panel.locator('[data-damage-history-row]').count()).toBe(1);
  if(role==='owner'){await expect(panel).toContainText('صافي خسارة الفترة:');await expect(panel).toContainText('6.000 د.أ');await expect(panel).toContainText('تكلفة الباكيت التاريخية');}
  else{await expect(panel).not.toContainText('تكلفة الباكيت');await expect(panel).not.toContainText('6.000');await expect(panel.getByText('⋯ قرارات المصدر',{exact:true})).toHaveCount(0);}
  const card=panel.locator('[data-damage-history-row]').first();await card.scrollIntoViewIfNeeded();await card.screenshot({path:info.outputPath(`damage215-${role}-card-390.png`)});
  expect(await card.evaluate(card=>{const outer=card.getBoundingClientRect();return [...card.querySelectorAll('button,h4,p,dl')].every(e=>{const r=e.getBoundingClientRect();return !r.width||r.left>=outer.left-1&&r.right<=outer.right+1;});})).toBe(true);
  await panel.getByText('حركات المصدر في الفترة',{exact:true}).click();await expect(panel).toContainText('من مرتجع زبون');await expect(panel).toContainText('أُرسل للمورد');await expect(panel).toContainText('استُبدل من المورد');
  await panel.getByLabel('الحالة',{exact:true}).selectOption('pending_supplier');await expect.poll(()=>requests.at(-1)?.p_state).toBe('pending_supplier');await expect(panel).toContainText('خسارة نهائية عليّ: 1 طرد');
  await panel.getByLabel('الفترة',{exact:true}).selectOption('range');await panel.getByLabel('من تاريخ',{exact:true}).fill('2026-10-01');await panel.getByLabel('إلى تاريخ',{exact:true}).fill('2026-10-28');
  await expect.poll(()=>requests.at(-1)?.p_from).toBe('2026-09-30T21:00:00.000Z');await expect.poll(()=>requests.at(-1)?.p_to).toBe('2026-10-28T21:00:00.000Z');await expect(panel).toContainText('عصير تجريبي');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`damage215-${role}-390.png`)});
});
test('215 damage privacy rejects an owner DTO delivered to manager rather than hiding its values with CSS',async({page})=>{
  await page.route('**/rest/v1/rpc/get_damage_ledger_page_v2',route=>{const a=route.request().postDataJSON();return route.fulfill({json:{...damage215Page,from:a.p_from,to:a.p_to}});});
  await page.goto(harness+'?role=manager');await page.getByRole('tab',{name:'سجل التالف',exact:true}).click();await expect(page.getByTestId('damage-history').getByRole('alert')).toContainText('لا يطابق صلاحية');await expect(page.getByTestId('damage-history')).not.toContainText('6.000');
});
test('215 damage reversal with no remaining bad packets is labelled as reversal rather than a warranty cost difference',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.route('**/rest/v1/rpc/get_damage_ledger_page_v2',route=>{
    const a=route.request().postDataJSON(),raw=structuredClone(damage215Page) as any;
    Object.assign(raw,{from:a.p_from,to:a.p_to,periodLossInMinorUnits:'-500',quantitySummary:[]});Object.assign(raw.rows[0],{quantity:0,pendingQuantity:0,receivedQuantity:0,creditedQuantity:0,finishedSupplierQuantity:0,finalOwnerQuantity:0,financialOnly:true,states:[],periodLossInMinorUnits:'-500',document:null});
    raw.rows[0].movements=[{...raw.rows[0].movements[0],action:'supplier_reverse',quantity:1,lossDeltaInMinorUnits:'-500'}];return route.fulfill({json:raw});
  });
  await page.goto(harness);await page.getByRole('tab',{name:'سجل التالف',exact:true}).click();const panel=page.getByTestId('damage-history');await expect(panel).toContainText('عكس أو إعادة تصنيف بلا باكيتات تالفة متبقية');await expect(panel).not.toContainText('فرق تكلفة استبدال بلا');await expect(panel).toContainText('−0.500');
});
