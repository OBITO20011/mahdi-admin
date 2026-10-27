import {test,expect} from './isolated-test';

for(const screen of ['reports','inventory','shifts']){
 test(`owner Telegram link opens actual App ${screen} without discarding other URL state`,async({page})=>{
  await page.goto('/e2e/owner-alert-links-harness.html?screen='+screen+'&keep=1#saved');
  await expect.poll(()=>page.evaluate(()=>window.__OWNER_ALERT_TAB__())).toBe(screen);
  await expect(page).toHaveURL(/\?keep=1#saved$/u);
 });
 test(`unauthenticated Telegram ${screen} link stays behind actual App login`,async({page})=>{
  await page.goto('/e2e/owner-alert-links-harness.html?screen='+screen+'&auth=no');
  await expect.poll(()=>page.evaluate(()=>window.__OWNER_ALERT_TAB__())).toBe('home');
  await expect(page).toHaveURL(new RegExp('screen='+screen));
 });
}
test('stock reader cannot navigate to cash or reports through alert links',async({page})=>{
 for(const screen of ['reports','shifts']){
  await page.goto('/e2e/owner-alert-links-harness.html?screen='+screen+'&role=warehouse_keeper');
  await expect.poll(()=>page.evaluate(()=>window.__OWNER_ALERT_TAB__())).toBe('home');
  await expect(page).toHaveURL(new RegExp('screen='+screen));
 }
});
test('unassigned account and arbitrary screen cannot select a protected view',async({page})=>{
 await page.goto('/e2e/owner-alert-links-harness.html?screen=reports&role=unassigned');
 await expect.poll(()=>page.evaluate(()=>window.__OWNER_ALERT_TAB__())).toBe('home');
 await page.goto('/e2e/owner-alert-links-harness.html?screen=users');
 await expect.poll(()=>page.evaluate(()=>window.__OWNER_ALERT_TAB__())).toBe('home');
});
