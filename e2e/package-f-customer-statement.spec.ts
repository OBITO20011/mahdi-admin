import AxeBuilder from '@axe-core/playwright';
import {test,expect,type Page} from './isolated-test';
import {analyzePackageFAccessibility} from './package-f-accessibility';
import {checkLayout} from './package-f-layout';
import {customersFixture} from './package-f-customers.fixture';
import {customerStatementFixture} from './customer-statement.fixture';

async function open(page:Page,theme:string,width:number,extra=''){
  await page.setViewportSize({width,height:900});
  await page.goto(`/e2e/package-f-customers-harness.html?theme=${theme}${extra}`);
  await page.getByRole('button',{name:'فتح ملف بقالة أبو خالد',exact:true}).filter({visible:true}).click();
  if(width<1024)await page.getByRole('tab',{name:'كشف الحساب',exact:true}).click();
}
async function audit(page:Page){
  await page.evaluate(()=>document.fonts.ready);
  await checkLayout(page,page.getByTestId('customer-detail'));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.getByTestId('customer-detail')).not.toContainText(/[٠-٩]/u);
  const result=await analyzePackageFAccessibility(page,new AxeBuilder({page}));
  expect(result.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
}
for(const theme of ['light','dark'])for(const width of [390,820,1440])test(`statement ${theme} ${width}: authoritative balances,older paging,Latin dates and containment`,async({page})=>{
  await open(page,theme,width);
  const section=page.getByTestId('customer-statement');await expect(section).toBeVisible();
  if(width>=820){
    const region=section.getByRole('region',{name:'حركات كشف حساب العميل',exact:true});
    await expect(region).toHaveAttribute('tabindex','0');await region.focus();await expect(region).toBeFocused();
  }
  await expect(section.getByTestId('statement-closing')).toContainText('860.500');
  const rows=section.locator('[data-statement-movement]').filter({visible:true});await expect(rows).toHaveCount(25);
  await expect(section.getByText('تاريخ غير متاح',{exact:true})).toHaveCount(0);
  await section.getByRole('button',{name:'تحميل المزيد',exact:true}).click();
  await expect(rows).toHaveCount(28);await expect(section.getByRole('button',{name:'تحميل المزيد',exact:true})).toHaveCount(0);
  await expect(section.getByText('تاريخ غير متاح',{exact:true}).filter({visible:true})).toBeVisible();
  const ids=await rows.evaluateAll(elements=>elements.map(e=>e.getAttribute('data-statement-movement')));
  expect(ids).toEqual(Array.from({length:28},(_,n)=>`statement-${28-n}`));
  const oldest=rows.last();await oldest.scrollIntoViewIfNeeded();await expect(oldest).toBeInViewport();
  if(width===390){
    await expect(page.getByTestId('customer-payment-sticky')).toBeInViewport();
    const box=await oldest.boundingBox(),footer=await page.getByTestId('customer-payment-footer').boundingBox();
    expect(box!.y+box!.height).toBeLessThanOrEqual(footer!.y);
  }
  await audit(page);
});
for(const theme of ['light','dark'])test(`statement unavailable ${theme}: no fabricated zero,keyboard tab and update control`,async({page})=>{
  await open(page,theme,390,'&unavailable');
  await expect(page.getByTestId('customer-statement').getByRole('alert')).toContainText('كشف الحساب غير متاح');
  await expect(page.getByTestId('statement-closing')).toHaveCount(0);
  const tab=page.getByRole('tab',{name:'كشف الحساب',exact:true});await tab.focus();
  await page.keyboard.press('Tab');await expect(page.getByRole('tabpanel',{name:'كشف الحساب',exact:true})).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'تحديث كشف الحساب',exact:true})).toBeFocused();
  await audit(page);
});
test('statement live adapter: exact new RPC and failed older page cannot overwrite the existing balance',async({page})=>{
  const calls:Array<{name:string;args:Record<string,unknown>}>=[];let invalid=true;
  const customer=customersFixture[2];
  await page.route('**/rest/v1/rpc/**',route=>{
    const name=route.request().url().split('/').at(-1)!,args=route.request().postDataJSON();calls.push({name,args});
    if(name==='get_customer_statement'){
      const data=customerStatementFixture(customer.id,860500,Number(args.p_page));
      if(invalid&&args.p_page===2)data.closing_balance_in_minor_units=1;
      return route.fulfill({json:data});
    }
    return route.fulfill({json:{items:[],unreadCount:0}});
  });
  await open(page,'light',390,'&statementLive');
  const section=page.getByTestId('customer-statement');await expect(section.getByTestId('statement-closing')).toContainText('860.500');
  await section.getByRole('button',{name:'تحميل المزيد',exact:true}).click();
  await expect(section.getByRole('alert')).toContainText('تغيّرت الحركات');
  await expect(section.locator('[data-statement-movement]').filter({visible:true})).toHaveCount(25);
  await expect(section.getByTestId('statement-closing')).toContainText('860.500');
  expect(calls.filter(c=>c.name==='get_customer_statement')).toEqual([
    {name:'get_customer_statement',args:{p_customer_id:customer.id,p_page:1,p_page_size:25}},
    {name:'get_customer_statement',args:{p_customer_id:customer.id,p_page:2,p_page_size:25}},
  ]);
  invalid=false;await section.getByRole('button',{name:'تحديث كشف الحساب',exact:true}).click();
  await expect(section.getByRole('alert')).toHaveCount(0);
  await section.getByRole('button',{name:'تحميل المزيد',exact:true}).click();
  await expect(section.locator('[data-statement-movement]').filter({visible:true})).toHaveCount(28);
});
