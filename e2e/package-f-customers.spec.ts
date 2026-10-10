import AxeBuilder from '@axe-core/playwright';
import {expect,test,type Page} from './isolated-test';
import {customersFixture} from './package-f-customers.fixture';

const url=(query='')=>`http://127.0.0.1:4173/e2e/package-f-customers-harness.html?${query}`;
const shellRequests = [
  {name:'get_operational_orders_page',args:{p_page:1,p_page_size:1,p_filter:'action',p_search:null,p_sort:'newest'}},
  {name:'get_stock_alert_notifications',args:{p_include_resolved:false,p_limit:100}},
];

test('accepted Cash harness makes the exact two pre-existing shell requests without Customers',async({page})=>{
  const calls:Array<{name:string;args:Record<string,unknown>}>=[];
  await page.route('**/rest/v1/rpc/**',route=>{
    calls.push({name:route.request().url().split('/').at(-1)!,args:route.request().postDataJSON()});
    return route.fulfill({json:{items:[],unreadCount:0}});
  });
  await page.goto('http://127.0.0.1:4173/e2e/package-f-cash-harness.html?theme=light');
  await expect(page.getByTestId('cash-scroll')).toBeVisible();
  await expect.poll(()=>[...calls].sort((a,b)=>a.name.localeCompare(b.name))).toEqual(shellRequests);
});
async function audit(page:Page) {
  await page.evaluate(()=>document.fonts.ready);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.getByTestId('customers-workbench')).not.toContainText(/[٠-٩]/u);
  const result=await new AxeBuilder({page}).analyze();
  expect(result.violations.filter(row=>row.impact==='serious'||row.impact==='critical')).toEqual([]);
  const escaped=await page.getByTestId('customers-workbench').evaluate(root=>{
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),failures:string[]=[];
    while(walker.nextNode()) {
      const node=walker.currentNode,parent=node.parentElement;
      if(!node.textContent?.trim()||!parent||parent.closest('.sr-only')||!parent.getClientRects().length||parent.closest('option'))continue;
      // Tables may scroll inside their shell, but text must stay inside its cell.
      const box=parent.closest('p,h1,h2,h3,button,td,th,figcaption,div')??parent;
      const bounds=box.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(node);
      for(const rect of range.getClientRects())if(rect.width&&(rect.left<bounds.left-1||rect.right>bounds.right+1))failures.push(node.textContent.trim());
    }
    return failures;
  });
  expect(escaped).toEqual([]);
}
for(const theme of ['light','dark'])for(const width of [390,820,1440]) {
  test(`Customers ${theme} ${width}: real controller,aging,Latin digits,containment and axe`,async({page})=>{
    await page.setViewportSize({width,height:900});await page.goto(url(`theme=${theme}`));
    await expect(page.getByRole('heading',{name:'العملاء والذمم',exact:true})).toBeVisible();
    await expect(page.getByTestId('customer-aging-summary')).toContainText('5,611.000');
    await expect(page.getByRole('tab',{name:'كل العملاء',exact:true})).toBeVisible();
    await expect(page.getByRole('tab',{name:'عليهم دين',exact:true})).toHaveCount(0);
    await audit(page);
    await page.getByRole('button',{name:'فتح ملف بقالة أبو خالد',exact:true}).filter({visible:true}).click();
    await expect(page.getByTestId('customer-detail')).toContainText('860.500');
    await expect(page.getByTestId('customer-aging-detail')).toContainText('عمر غير متاح');
    await expect(page.getByTestId('customer-aging-detail')).toContainText('50.000');
    if(width===390) {
      await expect(page.getByTestId('customer-detail')).toBeInViewport();
      await expect(page.getByTestId('customer-payment-sticky')).toBeInViewport();
    }
    await audit(page);
    await page.getByRole('button',{name:'رجوع للعملاء',exact:true}).click();
    await expect(page.getByTestId('customer-detail')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'فتح ملف بقالة أبو خالد',exact:true}).filter({visible:true})).toBeVisible();
  });
}

test('existing real CRM adapter preserves every status/search/sort/page request;136 is the only new RPC',async({page})=>{
  const calls:Array<{name:string;args:Record<string,unknown>}>=[];
  await page.route('**/rest/v1/rpc/**',route=>{
    const name=route.request().url().split('/').at(-1)!;
    const args=route.request().postDataJSON();calls.push({name,args});
    const data=name==='get_crm_customer_page'?{customers:customersFixture,total_count:24}
      :name==='get_customer_debt_aging'?{total_in_minor_units:0,days_0_7_in_minor_units:0,days_8_30_in_minor_units:0,days_over_30_in_minor_units:0,age_unavailable_in_minor_units:0,overdue_customer_count:0,over_limit_customer_count:0}:{};
    return route.fulfill({json:data});
  });
  await page.goto(url('live'));
  await expect.poll(()=>calls.filter(row=>row.name==='get_crm_customer_page').length).toBe(1);
  for(const [label,value] of [['النشطون','active'],['VIP','vip'],['غير النشطين','inactive'],['المحظورون','blocked'],['كل العملاء','all']]) {
    await page.getByRole('tab',{name:label,exact:true}).click();
    await expect.poll(()=>calls.filter(row=>row.name==='get_crm_customer_page').at(-1)?.args.p_status).toBe(value);
  }
  await page.getByRole('searchbox',{name:'البحث في العملاء'}).fill('079');
  await expect.poll(()=>calls.filter(row=>row.name==='get_crm_customer_page').at(-1)?.args.p_search).toBe('079');
  await page.getByRole('combobox',{name:'ترتيب العملاء'}).selectOption('most_orders');
  await expect.poll(()=>calls.filter(row=>row.name==='get_crm_customer_page').at(-1)?.args).toEqual({p_page:1,p_page_size:8,p_search:'079',p_status:'all',p_sort:'most_orders'});
  await page.getByRole('button',{name:'التالي',exact:true}).click();
  await expect.poll(()=>calls.filter(row=>row.name==='get_crm_customer_page').at(-1)?.args.p_page).toBe(2);
  await expect.poll(()=>[...new Set(calls.map(row=>row.name))].sort()).toEqual([
    'get_crm_customer_page','get_customer_debt_aging','get_operational_orders_page','get_stock_alert_notifications',
  ]);
  expect(calls.filter(row=>shellRequests.some(shell=>shell.name===row.name)).sort((a,b)=>a.name.localeCompare(b.name))).toEqual(shellRequests);
});

test('missing or incoherent aging is unavailable,never a zero balance or invented age',async({page})=>{
  await page.goto(url('unavailable'));
  await expect(page.getByTestId('customer-aging-summary')).toContainText('عمر الديون غير متاح');
  await expect(page.getByTestId('customer-aging-summary')).not.toContainText('0.000');
  await page.getByRole('button',{name:'فتح ملف بقالة أبو خالد',exact:true}).filter({visible:true}).click();
  await expect(page.getByTestId('customer-aging-detail')).toContainText('عمر الدين غير متاح');
  await expect(page.getByTestId('customer-detail')).toContainText('860.500');
});

test('profile payment keeps exact existing order-bound CliQ payload and busy guard',async({page})=>{
  const writes:Array<Record<string,unknown>>=[];
  let releasePayment:()=>void=()=>{};
  const paymentGate=new Promise<void>(resolve=>{releasePayment=resolve;});
  const orderId='fa100000-0000-4000-8000-000000000001';
  await page.route('**/rest/v1/rpc/**',async route=>{
    const name=route.request().url().split('/').at(-1);
    if(name==='get_customer_outstanding_orders_page')return route.fulfill({json:{orders:[{
      id:orderId,order_number:'W-10479',customer_id:customersFixture[2].id,customer_name:customersFixture[2].full_name,
      customer_phone:customersFixture[2].phone,total_in_minor_units:1000000,amount_paid_in_minor_units:500000,
      amount_due_in_minor_units:500000,payment_status:'partially_paid',created_at:'2026-10-09T10:18:00Z',
    }],total_count:1,summary:{due_in_minor_units:500000,customer_count:1}}});
    if(name==='record_customer_order_payment_once'){
      writes.push(route.request().postDataJSON());await paymentGate;
      return route.fulfill({json:{payment_number:'RCPT-1',remaining_in_minor_units:454877}});
    }
    return route.fulfill({json:{items:[],unreadCount:0}});
  });
  try{
    await page.setViewportSize({width:390,height:900});await page.goto(url('theme=light'));
    await page.getByRole('button',{name:'فتح ملف بقالة أبو خالد',exact:true}).filter({visible:true}).click();
    await page.getByTestId('customer-payment-sticky').getByRole('button').click();
    const dialog=page.getByRole('dialog',{name:'تسجيل دفعة على طلب مستحق',exact:true});
    await expect(dialog).toHaveAttribute('data-state','open');
    await expect(dialog.getByLabel('الطلب والعميل *')).toHaveValue(orderId);
    await dialog.getByLabel('طريقة الدفع *').selectOption('cliq');
    await dialog.getByLabel('مبلغ الدفعة (د.أ) *').fill('45.123');
    const save=dialog.getByRole('button',{name:'حفظ سند القبض وتحديث الذمة',exact:true});
    await save.click();expect(writes).toEqual([]); // required reference remains fail-closed.
    await dialog.getByLabel('رقم مرجع CliQ *').fill(' REF-45 ');
    await dialog.getByLabel('ملاحظات (اختياري)').fill(' دفعة جزئية ');
    await save.click();await expect.poll(()=>writes.length).toBe(1);
    await expect(dialog.locator('form')).toHaveAttribute('aria-busy','true');
    await expect(dialog.getByRole('button',{name:'جاري حفظ السند...'})).toBeDisabled();
    expect(writes[0]).toEqual({p_order_id:orderId,p_amount_in_minor_units:45123,p_payment_method:'cliq',
      p_reference_number:'REF-45',p_notes:'دفعة جزئية',p_idempotency_key:expect.stringMatching(/^[0-9a-f-]{36}$/u)});
    releasePayment();await expect(dialog).toHaveCount(0);expect(writes).toHaveLength(1);
  }finally{releasePayment();}
});
