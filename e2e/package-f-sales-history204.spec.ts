import AxeBuilder from '@axe-core/playwright';
import {expect,test,type Page} from './isolated-test';
import {checkLayout} from './package-f-layout';
import {analyzePackageFAccessibility} from './package-f-accessibility';
import {homeFixture} from './package-f-home.fixture';
const base=process.env.ADMIN_BASE_URL??'http://127.0.0.1:4173';
const id=(n:number)=>`92700000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const at='2026-10-19T12:00:00+03:00';
const rows=Array.from({length:30},(_,n)=>({id:id(n+1),orderNumber:`INV-${String(n+1).padStart(3,'0')}`,listedAt:at,firstCompletedAt:n<3?at:null,dateBasis:n<3?'completion':'creation',customerName:n===0?'سوبرماركت الحي الكبير للمواد التموينية والمشروبات':`عميل ${n+1}`,customerPhone:'0790000000',totalInMinorUnits:[12050,14500,29500][n]??1000,paymentMethod:n===0?'cash':n===2?'cliq':'debt',paymentStatus:n===0?'paid':'unpaid',source:n===0?'pos':n===3?null:'website',status:n<3?'completed':n===3?'completed':'new',countsAsSale:n<3}));
function payload(input:Record<string,unknown>,empty=false){
  let values=empty?[]:rows.filter(r=>(!input.p_sales_only||r.countsAsSale)&&(input.p_payment_method==='all'||!input.p_payment_method||r.paymentMethod===input.p_payment_method)&&(input.p_source==='all'||!input.p_source||(input.p_source==='unknown'?r.source===null:r.source===input.p_source))&&(!input.p_customer_search||r.customerName.includes(String(input.p_customer_search)))&&(!input.p_number_search||r.orderNumber.includes(String(input.p_number_search))));
  if(input.p_period==='all')values=[...values];
  const page=Number(input.p_page??1),size=Number(input.p_page_size??25),sales=values.filter(r=>r.countsAsSale);
  return {success:true,generatedAt:at,timeZone:'Asia/Amman',page,pageSize:size,totalCount:values.length,totalPages:Math.max(1,Math.ceil(values.length/size)),period:{kind:input.p_period??'day',fromDate:input.p_period==='all'?null:String(input.p_from_date??'2026-10-19'),toDate:input.p_period==='all'?null:String(input.p_to_date??'2026-10-19')},summary:{invoiceCount:values.length,salesCount:sales.length,salesInMinorUnits:sales.reduce((sum,r)=>sum+r.totalInMinorUnits,0),undatedInvoiceCount:values.filter(r=>r.status==='completed'&&!r.firstCompletedAt).length},rows:values.slice((page-1)*size,page*size)};
}
async function api(page:Page,mode:{empty?:boolean;failed?:boolean;malformed?:boolean}={}){
  const reads:Record<string,unknown>[]=[],replacementReads:Record<string,unknown>[]=[],writes:string[]=[];
  await page.route('**/rest/v1/**',async route=>{
    const request=route.request(),url=new URL(request.url()),name=url.pathname.split('/').at(-1)!;
    if(name==='get_sales_history_page'){
      const input=request.postDataJSON();reads.push(input);
      return mode.failed?route.fulfill({status:500,json:{message:'فشل قراءة معزول'}}):route.fulfill({json:mode.malformed?{success:true}:payload(input,mode.empty)});
    }
    if(name==='get_supplier_replacements_page_v1'){replacementReads.push(request.postDataJSON());return route.fulfill({json:{contractVersion:208,page:1,pageSize:25,totalCount:0,pendingQuantity:0,pendingValueInMinorUnitsExact:'0.000000',cases:[]}});}
    if(name==='get_home_dashboard')return route.fulfill({json:{...homeFixture,financialFactsStatus:'available',summary:{...homeFixture.summary,todaySalesInMinorUnits:56050,todayCompletedOrders:3}}});
    if(name==='get_admin_sales_aftercare_context_v1')return route.fulfill({json:{contractVersion:403,serverTime:at,supported:false,capability:'legacy_pos_v1_unsupported',baseItems:[],parcelInstances:[],returns:[],replacements:[],order:{id:request.postDataJSON().p_order_id,orderNumber:'INV-001',status:'completed',saleContract:null,source:'pos',branchId:id(200),warehouseId:id(201),completedAt:null,deadlineAt:null,withinWindow:false}}});
    if(request.method()!=='GET'){writes.push(name);return route.fulfill({status:403,json:{message:'Mutations forbidden in sales204 harness'}});}
    if(name==='orders'){
      const orderId=url.searchParams.get('id')?.replace(/^eq\./u,'')??id(1),row=rows.find(r=>r.id===orderId)??rows[0];
      return route.fulfill({json:{id:row.id,order_number:row.orderNumber,source:row.source,customer_id:id(401),customer_name_snapshot:row.customerName,customers:{id:id(401),full_name:row.customerName,phone:'0790000000'},customer_addresses:null,status:row.status,payment_method:row.paymentMethod,payment_status:row.paymentStatus,subtotal_in_minor_units:row.totalInMinorUnits,delivery_fee_in_minor_units:0,discount_in_minor_units:0,total_in_minor_units:row.totalInMinorUnits,amount_paid_in_minor_units:row.totalInMinorUnits,branch_id:id(200),created_at:at,updated_at:at,order_status_history:[],sales_returns:[],order_items:[{id:id(701),commercial_line_kind:'base_unit',product_id:id(101),product_name_snapshot:'مياه تاريخية باسم الفاتورة',sku_snapshot:'OLD-WATER',quantity:1,unit_price_in_minor_units:10000,line_total_in_minor_units:10000,products:{cost_price_in_minor_units:1000,base_unit:{name_ar:'باكيت'},product_images:[]}},{id:id(702),commercial_line_kind:'configurable_parcel',product_id:id(102),product_name_snapshot:'طرد شيبس مشكّل تاريخي',sku_snapshot:'OLD-MIX',quantity:1,unit_price_in_minor_units:2050,line_total_in_minor_units:2050,products:{base_unit:{name_ar:'باكيت'},product_images:[]}}]}});
    }
    if(name==='order_parcel_instances')return route.fulfill({json:[{id:id(801),order_item_id:id(702),instance_sequence:1,units_per_parcel_snapshot:20,parcel_unit_name_snapshot:'طرد'}]});
    if(name==='order_parcel_components')return route.fulfill({json:[{id:id(811),parcel_instance_id:id(801),product_id:id(111),base_quantity:10,product_name_snapshot:'جبنة قديمة',sku_snapshot:'CHEESE-OLD',base_unit_name_snapshot:'باكيت'},{id:id(812),parcel_instance_id:id(801),product_id:id(112),base_quantity:10,product_name_snapshot:'شطة قديمة',sku_snapshot:'CHILI-OLD',base_unit_name_snapshot:'باكيت'}]});
    return route.fulfill({json:[]});
  });
  return {reads,replacementReads,writes};
}
const open=(page:Page,query='')=>page.goto(`${base}/e2e/package-f-sales-history-harness.html?${query}`);
for(const width of [390,1440])for(const theme of ['light','dark'])test(`204 live paged history/details/print/axe ${width} ${theme}`,async({page})=>{
  await page.setViewportSize({width,height:1000});const proof=await api(page);await open(page,`theme=${theme}`);
  await expect(page.getByTestId('sales-history-summary')).toContainText('56.050');await expect(page.getByTestId('sales-history-summary')).toContainText('30 فاتورة');
  await expect(page.getByText('صفحة 1 من 2',{exact:true})).toBeVisible();await checkLayout(page,page.getByTestId('sales-history'));
  const axe=await analyzePackageFAccessibility(page,new AxeBuilder({page}));expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact??'')).map(v=>v.id)).toEqual([]);
  await page.getByRole('button',{name:'التالي',exact:true}).click();await expect(page.getByText('صفحة 2 من 2',{exact:true})).toBeVisible();expect(proof.reads.at(-1)?.p_page).toBe(2);
  await page.getByRole('button',{name:'السابق',exact:true}).click();await expect(page.getByText('صفحة 1 من 2',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'فتح الفاتورة INV-001',exact:true}).filter({visible:true}).click();
  const dialog=page.getByRole('dialog',{name:'الفاتورة INV-001',exact:true});await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('order-commercial-summary')).toContainText('مياه تاريخية باسم الفاتورة');await expect(dialog.getByTestId('order-commercial-summary')).toContainText('طرد شيبس مشكّل تاريخي');
  await dialog.locator('summary').filter({hasText:'إجراءات الفاتورة والمرتجع'}).click();await expect(dialog).toContainText('هذا بيع POS تاريخي');
  await checkLayout(page,dialog);await page.evaluate(()=>{window.print=()=>{document.body.dataset.printCalls='1';};});await dialog.getByRole('button',{name:'طباعة الوصل',exact:true}).click();
  const receipt=page.getByRole('dialog',{name:'إيصال البيع',exact:true});await expect(receipt.getByTestId('sale-receipt-document')).toContainText('طرد شيبس مشكّل تاريخي');
  await receipt.getByRole('button',{name:'طباعة / PDF',exact:true}).click();await receipt.getByRole('button',{name:'إغلاق الإيصال',exact:true}).click();
  await dialog.getByLabel('خيارات طباعة إضافية',{exact:true}).click();await dialog.getByRole('button',{name:'طباعة ورقة التجهيز',exact:true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-print-calls','1');await expect(dialog.getByTestId('order-commercial-summary')).toContainText('جبنة قديمة');
  await page.emulateMedia({media:'print'});await expect(page.getByTestId('sales-history')).not.toBeVisible();await expect(dialog.getByText('شطة قديمة',{exact:false}).first()).toBeVisible();await expect(dialog.getByTestId('order-commercial-summary')).toContainText('12.050');expect(proof.writes).toEqual([]);
});
test('204 filters are sent to server and reset page;invoice method/source never guessed',async({page})=>{
  const proof=await api(page);await open(page);await expect(page.getByTestId('sales-history-summary')).toBeVisible();
  await page.getByLabel('طريقة دفع الفاتورة',{exact:true}).selectOption('cliq');await expect(page.getByTestId('sales-history-summary')).toContainText('29.500');expect(proof.reads.at(-1)?.p_payment_method).toBe('cliq');
  await page.getByLabel('طريقة دفع الفاتورة',{exact:true}).selectOption('all');await page.getByLabel('المصدر',{exact:true}).selectOption('unknown');await expect(page.getByTestId('sales-history-summary')).toContainText('1 فاتورة');await expect(page.getByTestId('sales-history-summary')).toContainText('وقت بيع مسجّل');
  await page.getByLabel('المصدر',{exact:true}).selectOption('all');await page.getByLabel('الزبون أو الهاتف',{exact:true}).fill('عميل 2');await expect.poll(()=>proof.reads.at(-1)?.p_customer_search).toBe('عميل 2');
  await page.getByLabel('الزبون أو الهاتف',{exact:true}).fill('');await page.getByLabel('بحث برقم الفاتورة',{exact:true}).fill('INV-001');await expect.poll(()=>proof.reads.at(-1)?.p_number_search).toBe('INV-001');
  await page.getByRole('button',{name:'مدى',exact:true}).click();await page.getByLabel('من تاريخ',{exact:true}).fill('2026-10-01');await page.getByLabel('إلى تاريخ',{exact:true}).fill('2026-10-19');await expect.poll(()=>proof.reads.at(-1)?.p_from_date).toBe('2026-10-01');await expect.poll(()=>proof.reads.at(-1)?.p_to_date).toBe('2026-10-19');
  await page.getByRole('button',{name:'كل التواريخ',exact:true}).click();await expect.poll(()=>proof.reads.at(-1)?.p_period).toBe('all');expect(proof.reads.at(-1)?.p_from_date).toBeNull();expect(proof.reads.every(r=>r.p_page===1)).toBe(true);expect(proof.writes).toEqual([]);
});
test('204 success zero,malformed/error,loading and denied role remain distinct',async({page})=>{
  const mode:{empty?:boolean;failed?:boolean;malformed?:boolean}={empty:true};const proof=await api(page,mode);await open(page);await expect(page.getByTestId('sales-history-summary')).toContainText('0.000');await expect(page.getByText('لا توجد فواتير ضمن هذه الفلاتر.',{exact:true})).toBeVisible();
  mode.empty=false;mode.failed=true;await page.getByRole('button',{name:'تحديث سجل المبيعات',exact:true}).click();await expect(page.getByRole('alert')).toContainText('فشل قراءة معزول');await expect(page.getByTestId('sales-history-summary')).toHaveCount(0);
  mode.failed=false;mode.malformed=true;await page.getByRole('button',{name:'إعادة المحاولة',exact:true}).click();await expect(page.getByRole('alert')).toContainText('بيانات سجل المبيعات غير مكتملة');await expect(page.getByTestId('sales-history-summary')).toHaveCount(0);
  const count=proof.reads.length;await open(page,'role=warehouse_keeper');await expect(page.getByRole('alert')).toContainText('لا تملك صلاحية');expect(proof.reads.length).toBe(count);await expect(page.locator('[data-side-nav="sales_history"]')).toHaveCount(0);
  mode.malformed=false;await open(page,'role=mixed');await expect(page.getByTestId('sales-history-summary')).toContainText('56.050');expect(proof.reads.length).toBeGreaterThan(count);
});
test('204 Home last sales uses canonical reader and view-all reaches same live history',async({page})=>{
  await page.setViewportSize({width:390,height:1000});const proof=await api(page);await open(page,'home');
  const card=page.getByTestId('home-recent-sales');await expect(card).toBeVisible();await expect(card.getByRole('button',{name:/فتح الفاتورة/})).toHaveCount(3);
  expect(proof.reads.some(r=>r.p_sales_only===true&&r.p_page_size===5&&r.p_period==='day')).toBe(true);await expect(page.getByTestId('home-kpis')).toContainText('56.050');
  await card.getByRole('button',{name:'عرض الكل',exact:false}).click();await expect(page.getByTestId('sales-history-summary')).toContainText('56.050');expect(proof.reads.at(-1)?.p_sales_only).toBe(false);expect(proof.writes).toEqual([]);
});
test('204 loading is explicit and a delayed previous filter cannot overwrite the current response',async({page})=>{
  await api(page);let release:()=>void=()=>undefined,first=true;
  const barrier=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/rest/v1/rpc/get_sales_history_page',async route=>{
    const input=route.request().postDataJSON();
    if(first){first=false;await barrier;await route.fulfill({json:payload(input)}).catch(()=>undefined);}
    else await route.fulfill({json:payload(input)});
  });
  await open(page);await expect(page.getByRole('status')).toContainText('جاري تحميل سجل المبيعات');
  await expect(page.getByTestId('sales-history-summary')).toHaveCount(0);
  await page.getByLabel('طريقة دفع الفاتورة',{exact:true}).selectOption('cliq');
  await expect(page.getByTestId('sales-history-summary')).toContainText('29.500');release();
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await expect(page.getByTestId('sales-history-summary')).toContainText('29.500');
  await expect(page.getByTestId('sales-history-summary')).not.toContainText('56.050');
});

// The outer history dialog must retain the existing order's busy close guard.
test('204 busy invoice cannot close on Escape before its existing action settles',async({page})=>{
  await api(page);let release:()=>void=()=>undefined,markStarted:()=>void=()=>undefined;
  const barrier=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{markStarted=resolve;});
  await page.route('**/rest/v1/rpc/accept_order_for_preparation',async route=>{markStarted();await barrier;await route.fulfill({json:{success:true}});});
  await open(page);await page.getByRole('button',{name:'فتح الفاتورة INV-005',exact:true}).filter({visible:true}).click();
  const dialog=page.getByRole('dialog',{name:'الفاتورة INV-005',exact:true}),detail=dialog.locator('.order-detail');
  await dialog.getByRole('button',{name:'قبول الطلب وبدء التجهيز',exact:true}).click();await started;
  try{await expect(detail).toHaveAttribute('aria-busy','true');await page.keyboard.press('Escape');await expect(dialog).toBeVisible();}
  finally{release();}
  await expect(detail).toHaveAttribute('aria-busy','false');await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
});
