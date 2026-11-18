import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium,webkit,expect,devices} from '@playwright/test';
import {startOn225BrowserFixture,goldenId} from './on225-browser-fixture.mjs';
import {golden225AccountingOracle} from './on225-golden-oracle.mjs';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from './verification-source-freeze.mjs';

assert.equal(process.argv.length,2,'ON225_BROWSER_GOLDEN_NO_TARGET_ARGUMENTS');
const root=path.resolve(import.meta.dirname,'../..');
const output=path.join(root,'test-results/on225-browser-golden');
await mkdir(output,{recursive:true});
const expected=golden225AccountingOracle();
const report={ok:false,hostedAccess:false,identity:'Synthetic owner AAL2 against local PostgreSQL via pinned PostgREST',cases:[]};
const productName='صنف الكرتونة';
const button=(page,name)=>page.getByRole('button',{name,exact:true});
const money=(minor)=>(minor/1000).toFixed(3);
const stock=db=>db.json(`SELECT jsonb_build_object('quantity',b.on_hand_quantity,'value',round(b.on_hand_quantity*p.wac_cost_in_minor_units_exact),
 'wac',p.wac_cost_in_minor_units_exact) FROM public.inventory_balances b JOIN public.products p ON p.id=b.product_id
 WHERE b.product_id='${db.product}' AND b.warehouse_id='${db.warehouse}';`);
const settings=db=>db.json(`SELECT jsonb_build_object('unit',p.sale_price_in_minor_units,'parcel',p.default_sale_price_in_minor_units,
 'enabled',coalesce(s.parcel_enabled,true),'originalUnit',s.original_unit_price,'originalParcel',s.original_parcel_price)
 FROM public.products p LEFT JOIN public.product_sale_pricing_state225 s ON s.product_id=p.id WHERE p.id='${db.product}';`);

async function runDay(browserType,engine,device){
  const db=await startOn225BrowserFixture(root,engine);
  let browser,page,stage='launch';
  const unexpected=[];
  const proof={engine,history:db.history};
  try{
    browser=await browserType.launch();
    const context=await browser.newContext({...device,locale:'ar-JO',serviceWorkers:'block',reducedMotion:'reduce'});
    context.on('response',response=>{
      if(response.status()>=400&&response.url().includes('/rest/v1/'))
        unexpected.push({status:response.status(),path:new URL(response.url()).pathname});
    });
    const origins=new Set([db.adminUrl,db.shopUrl]);
    const routed=url=>!origins.has(url.origin)&&!['about:','blob:','data:'].includes(url.protocol);
    await context.route(routed,async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin==='http://127.0.0.1:4176'){
        assert.ok(request.frame().url().startsWith(db.shopUrl+'/'),'ON225_GOLDEN_ONLY_SHOP_USES_VIRTUAL_ENDPOINT');
        const cors={'access-control-allow-origin':db.shopUrl,'access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'};
        if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
        assert.match(url.pathname,/^\/rest\/v1\/rpc\/[a-z][a-z0-9_]+$/u);
        const response=await route.fetch({url:db.shopUrl+url.pathname+url.search,maxRedirects:0});
        return route.fulfill({response,headers:{...response.headers(),...cors}});
      }
      unexpected.push({origin:url.origin});
      return route.abort('blockedbyclient');
    });
    page=await context.newPage();
    page.on('pageerror',error=>unexpected.push({pageError:error.name}));
    context.on('requestfailed',request=>{
      const url=new URL(request.url());
      if(origins.has(url.origin))unexpected.push({path:url.pathname,resource:request.resourceType(),result:request.failure()?.errorText});
    });
    const pendingAssets=new Set();
    let documentRequests=0,documentResponses=0;
    context.on('request',request=>{if(origins.has(new URL(request.url()).origin)){pendingAssets.add(request);if(request.isNavigationRequest())documentRequests++;}});
    context.on('response',response=>{if(response.request().isNavigationRequest())documentResponses++;});
    context.on('requestfinished',request=>pendingAssets.delete(request));
    context.on('requestfailed',request=>pendingAssets.delete(request));
    const navigate=async(target,url)=>{
      try{return await target.goto(url,{waitUntil:'domcontentloaded'});}
      catch(error){
        const paths=[...pendingAssets].map(request=>new URL(request.url()).pathname);
        unexpected.push({navigationPath:new URL(url).pathname,pendingAssets:paths.slice(0,30),pendingCount:paths.length,documentRequests,documentResponses,server:db.navigations.slice(-8)});
        throw error;
      }
    };
    const view=name=>navigate(page,db.adminUrl+'/e2e/on225-golden-harness.html?view='+name);
    const saveImage=name=>page.screenshot({path:path.join(output,engine+'-'+name+'.png'),fullPage:true});
    const rpcResponse=(name,select=()=>true)=>page.waitForResponse(response=>response.url().endsWith('/rpc/'+name)&&response.request().method()==='POST'&&select(response.request().postDataJSON()));
    const submit=async(name,click,select)=>{
      const pending=rpcResponse(name,select);
      await click();
      const result=await pending;
      assert.ok(result.ok(),name+' '+result.status()+' '+(await result.text()).slice(0,1500));
      return result.json();
    };
    const saveBelowCost=async(form,wac)=>{
      const rejected=rpcResponse('update_product_master_v7',args=>args.p_below_cost_confirmation==null);
      await button(form,'حفظ التعديلات').click();
      const response=await rejected;
      assert.equal(response.status(),400);
      assert.match((await response.json()).message,/^PRICES225_BELOW_WAC_CONFIRMATION_REQUIRED:/u);
      const warning=form.getByRole('alert',{name:'تأكيد السعر تحت التكلفة'});
      await expect(warning).toContainText(wac);
      return submit('update_product_master_v7',()=>button(warning,'أكّد الحفظ بهذا السعر').click(),
        args=>args.p_below_cost_confirmation?.acknowledged===true);
    };
    const assertPrice=async value=>expect.poll(()=>settings(db)).toEqual(value);
    const openProduct=async()=>{
      await view('product');
      const form=page.getByRole('dialog');
      await expect(form.getByLabel('سعر بيع باكيت',{exact:true})).toBeVisible();
      return form;
    };
    const receive=async(number,includeBox,basePrice)=>{
      await view('receiving');
      await page.getByLabel('المورد',{exact:true}).selectOption(goldenId(301));
      await expect(page.getByText('مستودع اليوم',{exact:true}).first()).toBeVisible();
      await page.getByText('معلومات سند إضافية (اختياري)',{exact:true}).click();
      await page.getByLabel('مثال: INV-9908',{exact:true}).fill(number);
      const add=async()=>{
        await page.getByRole('textbox',{name:/ابحث باسم المنتج/}).fill(productName);
        await page.locator('[data-receiving-product-result]').filter({hasText:productName}).click();
      };
      await add();
      if(includeBox)await add();
      const lines=page.locator('[data-receiving-line]');
      await expect(lines).toHaveCount(includeBox?2:1);
      if(includeBox){
        const parcel=lines.first();
        await parcel.getByRole('radio',{name:'طرد',exact:true}).click();
        await parcel.getByLabel('كم طرد؟',{exact:true}).fill('1');
        await parcel.getByLabel('سعر طرد',{exact:true}).fill('9.600');
      }
      const single=lines.last();
      await single.getByRole('radio',{name:'باكيت',exact:true}).click();
      await single.getByLabel('كم باكيت؟',{exact:true}).fill('2');
      await single.getByLabel('سعر باكيت',{exact:true}).fill(basePrice);
      const result=await submit('create_direct_supplier_receipt_v2',()=>button(page,'حفظ واستلام البضاعة').click());
      assert.equal(result.success,true);
    };
    const sale=async(kind,quantity,price)=>{
      await view('pos');
      const card=page.locator('[data-pos-product="'+db.product+'"]');
      const add=card.locator('[data-pos-add-method="'+kind+'"]');
      for(let n=0;n<quantity;n++)await add.click();
      if(device.isMobile)await button(page,'مراجعة السلة والعميل').click();
      const result=await submit('create_pos_sale_v2',()=>page.getByTestId('pos-complete-sale').filter({visible:true}).click());
      assert.equal(result.success,true);
      const receipt=page.getByRole('dialog',{name:'إيصال البيع',exact:true});
      await expect(receipt).toContainText(money(price));
      return db.json(`SELECT jsonb_build_object('order',i.order_id,'quantity',i.quantity,'total',i.line_total_in_minor_units,
        'unitCost',i.unit_cost_snapshot_in_minor_units_exact,'cogs',i.cogs_in_minor_units,'profit',i.profit_in_minor_units)
        FROM public.order_items i WHERE i.order_id='${result.orderId}';`);
    };
    const catalogue=async()=>{
      const shopPage=await context.newPage();
      shopPage.on('pageerror',error=>unexpected.push({pageError:error.name,area:'shop'}));
      await navigate(shopPage,db.shopUrl+'/#catalog');
      await expect(shopPage.getByTestId('catalog-products-grid')).toBeVisible();
      const detailsButton=shopPage.getByRole('button',{name:'عرض تفاصيل '+productName,exact:true});
      await detailsButton.first().click();
      return shopPage;
    };

    stage='opening';
    await view('opening');
    await page.getByPlaceholder('ابحث باسم الصنف أو رمز الصنف أو الباركود...',{exact:true}).fill('E-CARTON');
    await expect(page.getByText(productName,{exact:true})).toBeVisible();
    await page.getByLabel('باقي باكيت',{exact:true}).fill('10');
    await button(page,'مراجعة واعتماد المخزون الافتتاحي').click();
    await submit('apply_inventory_opening_setup',()=>button(page,'نعم، اعتمد الجرد').click());
    await expect.poll(()=>stock(db)).toEqual({quantity:10,value:8000,wac:800});

    stage='open drawer';
    await view('shift');
    await page.getByLabel('العهدة الافتتاحية (د.أ)',{exact:true}).fill('0');
    const opened=await submit('open_cash_shift',()=>button(page,'فتح وردية جديدة').click());
    const shift=opened.shiftId??opened.shift_id??opened.id;
    assert.ok(shift,'opened shift');

    stage='mixed supplier invoice';
    await receive('BROWSER-225-1',true,'0.850');
    await expect.poll(()=>stock(db)).toEqual({quantity:24,value:19300,wac:Number(expected.firstWacMicro)/1e6});

    stage='discount and storefront';
    console.log(JSON.stringify({engine,stage,openingAndMixedReceipt:true}));
    let form=await openProduct();
    await form.getByLabel('سعر بيع الطرد',{exact:true}).fill('11.000');
    await submit('update_product_master_v7',()=>button(form,'حفظ التعديلات').click());
    await assertPrice({unit:1000,parcel:11000,enabled:true,originalUnit:null,originalParcel:12000});
    let shopPage=await catalogue();
    await expect(shopPage.getByRole('dialog')).toContainText('1.000');
    await expect(shopPage.getByRole('dialog')).toContainText('11.000');
    await shopPage.screenshot({path:path.join(output,engine+'-store-prices.png'),fullPage:true});
    await shopPage.close();

    stage='cash unit and parcel sales';
    const original=await sale('base_unit',2,2000),parcel=await sale('legacy_single_sku_parcel',1,11000);
    assert.deepEqual([original.quantity,original.total,original.cogs],[2,2000,expected.saleCogs[0]]);
    assert.deepEqual([parcel.quantity,parcel.total,parcel.cogs,parcel.unitCost],[12,11000,9650,Number(expected.firstWacMicro)/1e6]);
    await saveImage('pos-parcel-receipt');

    stage='active parcel without enough stock, but singles available';
    await expect.poll(()=>stock(db)).toEqual({quantity:10,value:8042,wac:Number(expected.firstWacMicro)/1e6});
    shopPage=await catalogue();
    await expect(shopPage.getByRole('region',{name:'إضافة باكيت',exact:true}).getByRole('button',{name:/إضافة .* باكيت من/})).toBeEnabled();
    await shopPage.close();

    stage='pause and confirm loss';
    form=await openProduct();
    const unit=form.getByLabel('سعر بيع باكيت',{exact:true}),save=button(form,'حفظ التعديلات');
    await unit.fill('0.500');
    await expect(save).toBeDisabled();
    await button(form,'الطرد: متاح للبيع').click();
    await saveBelowCost(form,'0.804');
    await assertPrice({unit:500,parcel:11000,enabled:false,originalUnit:1000,originalParcel:12000});
    const loss=await sale('base_unit',1,500);
    assert.deepEqual([loss.total,loss.cogs,loss.profit],[500,expected.saleCogs[2],expected.loss]);

    stage='stock below one parcel and invalid reactivation';
    shopPage=await catalogue();
    const detail=shopPage.getByRole('dialog');
    await expect(detail).toContainText('0.500');
    await expect(detail.getByRole('region',{name:'إضافة باكيت',exact:true}).getByRole('button',{name:/إضافة .* باكيت من/})).toBeEnabled();
    await expect(detail).not.toContainText('11.000');
    await shopPage.close();
    form=await openProduct();
    await button(form,'الطرد: موقوف مؤقتاً').click();
    await expect(button(form,'حفظ التعديلات')).toBeDisabled();
    await form.getByLabel('سعر بيع الطرد',{exact:true}).fill('6.000');
    await saveBelowCost(form,'0.804');
    await assertPrice({unit:500,parcel:6000,enabled:true,originalUnit:1000,originalParcel:12000});

    stage='pause again before restoring the original single price';
    form=await openProduct();
    await button(form,'الطرد: متاح للبيع').click();
    await saveBelowCost(form,'0.804');
    await assertPrice({unit:500,parcel:6000,enabled:false,originalUnit:1000,originalParcel:12000});

    stage='receipt warning dismiss keeps original';
    await receive('BROWSER-225-2',false,'1.000');
    const review=page.getByRole('region',{name:'مراجعة أسعار البيع بعد الاستلام'});
    await expect(review).toContainText('1.000');
    await expect(review).toContainText('0.840');
    const pricingBefore=await settings(db);
    await button(review,'خلّيه هيك').click();
    await expect(review.getByRole('heading',{name:productName})).toHaveCount(0);
    assert.deepEqual(await settings(db),pricingBefore);
    stage='manual raise preserves or clears the original single price';
    form=await openProduct();
    await form.getByLabel('سعر بيع باكيت',{exact:true}).fill('0.800');
    await saveBelowCost(form,'0.840');
    await assertPrice({unit:800,parcel:6000,enabled:false,originalUnit:1000,originalParcel:12000});
    form=await openProduct();
    await form.getByLabel('سعر بيع باكيت',{exact:true}).fill('1.000');
    await submit('update_product_master_v7',()=>button(form,'حفظ التعديلات').click());
    await assertPrice({unit:1000,parcel:6000,enabled:false,originalUnit:null,originalParcel:12000});
    form=await openProduct();
    await form.getByLabel('سعر بيع باكيت',{exact:true}).fill('0.500');
    await saveBelowCost(form,'0.840');
    await assertPrice({unit:500,parcel:6000,enabled:false,originalUnit:1000,originalParcel:12000});
    form=await openProduct();
    await form.getByLabel('سعر بيع باكيت',{exact:true}).fill('1.200');
    await submit('update_product_master_v7',()=>button(form,'حفظ التعديلات').click());
    await assertPrice({unit:1200,parcel:6000,enabled:false,originalUnit:null,originalParcel:12000});
    form=await openProduct();
    await form.getByLabel('سعر بيع باكيت',{exact:true}).fill('0.500');
    await saveBelowCost(form,'0.840');
    await assertPrice({unit:500,parcel:6000,enabled:false,originalUnit:1200,originalParcel:12000});
    form=await openProduct();
    await form.getByRole('button',{name:/رجّع السعر الأصلي لـباكيت/}).click();
    await submit('update_product_master_v7',()=>button(form,'حفظ التعديلات').click());
    await assertPrice({unit:1200,parcel:6000,enabled:false,originalUnit:null,originalParcel:12000});

    stage='partial return from original invoice';
    db.selectReturnOrder(original.order);
    await navigate(page,db.adminUrl+'/e2e/aftercare215-fullstack-harness.html');
    await button(page,'إرجاع أو استبدال').click();
    await button(page,'التالي').click();
    await button(page,'باكيتات').click();
    await button(page,'التالي').click();
    await page.getByLabel('فحصت الباكيتات الراجعة',{exact:true}).check();
    await button(page,'التالي').click();
    await button(page,'التالي').click();
    await button(page,'معاينة التفاصيل').click();
    await expect(page.getByTestId('aftercare215-preview')).toContainText('1.000');
    await submit('settle_admin_sales_return_v2',()=>button(page,'تأكيد الإرجاع').click());
    const returns=await db.json(`SELECT coalesce(jsonb_agg(merchandise_refund_amount_in_minor_units),'[]')
      FROM public.sales_return_events WHERE order_id='${original.order}';`);
    assert.deepEqual(returns,[expected.refund]);
    await expect.poll(()=>stock(db)).toEqual({quantity:expected.quantity,value:expected.inventoryValue,wac:Number(expected.finalWacMicro)/1e6});

    stage='close and reconcile';
    await view('shift');
    if(device.isMobile)await page.getByTestId('cash-count-open').click();
    await page.getByLabel('الكاش الفعلي بعد عدّ الصندوق',{exact:true}).filter({visible:true}).fill(money(expected.cash));
    await submit('close_cash_shift',()=>page.getByTestId('cash-close-submit').filter({visible:true}).click());
    const reportDialog=page.getByRole('dialog',{name:'تقرير الإغلاق اليومي',exact:true});
    await expect(reportDialog).toContainText(money(expected.cash));
    await saveImage('closing');
    const closing=await db.rpc(`get_cash_shift_closing_report('${shift}')`);
    assert.deepEqual([closing.reconciliation.expectedCashInMinorUnits,closing.reconciliation.actualCashInMinorUnits,
      closing.reconciliation.cashDiscrepancyInMinorUnits],[expected.cash,expected.cash,0]);
    const day="(now() AT TIME ZONE 'Asia/Amman')::date";
    const period=await db.rpc(`get_operational_business_report('${db.branch}',${day},${day})`);
    const daily=await db.rpc(`build_business_summary('daily',${day},${day},now())`,'service_role');
    for(const {sales} of [period,daily])assert.deepEqual([sales.netSalesInMinorUnits,
      sales.cogsInMinorUnits-sales.restockRecoveryInMinorUnits,sales.netProfitInMinorUnits],
    [expected.revenue,expected.cogs,expected.profit]);
    assert.equal(period.balances.supplierDueInMinorUnits,expected.supplierPayable);
    assert.ok(db.calls.some(call=>call.name==='public_storefront_catalog_page225'&&call.status===200&&call.role==='anon'));
    assert.equal(unexpected.filter(row=>row.origin).length,0,'ON225_GOLDEN_EXTERNAL_REQUEST');
    return {...proof,ok:true,expected,inventory:await stock(db),calls:db.calls,diagnosticResponses:unexpected};
  }catch(error){
    if(page)await page.screenshot({path:path.join(output,engine+'-failure.png'),fullPage:true}).catch(()=>undefined);
    report.cases.push({...proof,ok:false,stage,detail:String(error.message).slice(0,2400),calls:db.calls,diagnosticResponses:unexpected});
    throw error;
  }finally{
    await browser?.close();
    await db.close();
  }
}

try{
  const frozen=await readVerificationSourceFreeze(root);
  for(const [engine,type,device] of [['Chromium',chromium,{...devices['Desktop Chrome'],viewport:{width:1280,height:900}}],
    ['WebKit',webkit,{...devices['iPhone 13'],viewport:{width:390,height:844}}]]){
    report.cases.push(await runDay(type,engine,device));
  }
  assertVerificationSourceFreeze(frozen,await readVerificationSourceFreeze(root));
  report.ok=true;
}catch(error){
  report.error=String(error.message).slice(0,2400);
  process.exitCode=1;
}finally{
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({ok:report.ok,output,error:report.error,engines:report.cases.map(({engine,ok,stage})=>({engine,ok,stage}))}));
}
