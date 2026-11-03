import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {sqlLiteral as q} from '../operations/trial-reset-core.mjs';
import {rehearsal219Services} from './rehearsal219-services.mjs';
export async function prepareRehearsalCutover219({sql,ownerId,root,output}){
 const api=await rehearsal219Services({sql,ownerId,root,output});
 const fingerprint=()=>sql("SELECT md5((to_jsonb(s)-'orders_enabled'-'updated_at'-'updated_by')::text) FROM storefront_settings s;");
 try{
  const before=await fingerprint();
  const amounts=JSON.parse(await sql("SELECT jsonb_build_object('minimumOrder',minimum_order_in_minor_units::text,'insideRamthaDeliveryFee',inside_ramtha_delivery_fee_in_minor_units::text,'outsideRamthaDeliveryFee',outside_ramtha_delivery_fee_in_minor_units::text) FROM storefront_settings;"));
  const settings=await api.storefront.fetchStorefrontSettings();
  for(const [field,amount]of Object.entries(amounts)){
   assert.ok(Number.isSafeInteger(Number(amount)),'REHEARSAL_SETTINGS_AMOUNT_CANNOT_ROUND');
   assert.equal(String(Math.round(settings[field]*1000)),amount,'REHEARSAL_SETTINGS_AMOUNT_CANNOT_ROUND');
  }
  await api.storefront.saveStorefrontSettings({...settings,ordersEnabled:false});
  assert.equal(await fingerprint(),before,'REHEARSAL_SETTINGS_CUSTOM_VALUES_CHANGED');
  assert.equal(await sql(`SELECT NOT orders_enabled AND updated_by=${q(ownerId)}::uuid FROM storefront_settings;`),'t');
  assert.equal(await sql('SHOW cron.launch_active_jobs;'),'off');
  return {ownerSettingsSaved:true,ordersDisabled:true,customSettingsHashBefore:before,customSettingsHashAfter:before,
   onlyExpectedMetadataChanged:['orders_enabled','updated_by','updated_at'],writers:'owned network-none clone;cron launcher off;no Edge or other clients',serviceCalls:[...api.calls]};
 }finally{api.close();}
}
export async function rehearseOpeningData219({sql,ownerId,root,output}){
 const api=await rehearsal219Services({sql,ownerId,root,output});
 const json=async s=>JSON.parse(await sql(s));
 try{
  const category=await json("SELECT to_jsonb(c) FROM categories c WHERE is_active ORDER BY code LIMIT 1;");
  const unit=await json("SELECT to_jsonb(u) FROM units u ORDER BY code LIMIT 1;");
  const warehouse=await sql("SELECT id FROM warehouses WHERE code='WH-MAIN';"),branch=await sql("SELECT id FROM branches WHERE code='BR-MAIN';");
  await api.goLive.setGoLiveMainBranch(branch);
  const workbook=async(kind,rows,prepare,extra)=>{
   const headers=api.importer.GO_LIVE_COLUMNS[kind];
   const sheet=[headers.map(c=>c.header),...rows.map(row=>headers.map(c=>row[c.key]??''))];
   const file=path.join(output,'dummy-'+kind+'.xlsx');await writeFile(file,api.xlsx.writeXlsx([{name:'بيانات وهمية',rows:sheet}]));
   const parsed=await api.xlsx.readXlsxFirstSheet(new Uint8Array(await readFile(file)));
   const mapped=api.importer.mapSheet(kind,parsed);assert.deepEqual(mapped.fileErrors,[]);
   const result=prepare(mapped.rows,extra);assert.deepEqual(result.errors,[]);return result.payload;
  };
  const common={barcode:'',category_name:category.name_ar,base_unit_name:unit.name_ar,purchase_unit_name:unit.name_ar,
   units_per_purchase_unit:'6',sale_unit_name:unit.name_ar,units_per_sale_unit:'6',sale_package_price:'6.000',
   purchase_package_price:'3.000',cost_per_base_unit:'0.500',min_stock_level:'1',parcel_only:'لا'};
  const products=await workbook('products',[
   {...common,sku:'REHEARSAL-REGULAR',name_ar:'صنف وهمي طرد وباكيت'},
   {...common,sku:'REHEARSAL-PARCEL',name_ar:'صنف وهمي طرد فقط',units_per_purchase_unit:'10',units_per_sale_unit:'10',sale_package_price:'15.000',purchase_package_price:'5.000',parcel_only:'نعم'},
  ],api.importer.prepareProducts);
  assert.deepEqual((await api.goLive.dryRunBatch('products',products)).errors,[]);
  assert.equal((await api.goLive.saveBatch('products','rehearsal-products-save',products)).created,2);
  const family=await api.products.createProductFamilyWithFlavorsInSupabase({sku:'REHEARSAL-FAMILY',nameAr:'عصير وهمي بنكهات',categoryId:category.id,
   unitId:unit.id,warehouseId:warehouse,unitsPerPackage:6,unitsPerSalePackage:6,salePackagePrice:6,defaultPurchasePrice:3,costPrice:0.5,
   flavors:[{nameAr:'برتقال وهمي'},{nameAr:'توت وهمي'}]});assert.equal(family.success,true,'REHEARSAL_FLAVOR_SERVICE_FAILED');
  const available=await api.inventory.fetchInventoryOpeningSetupFromSupabase(warehouse);
  const stockRows=available.products.filter(p=>p.sku.startsWith('REHEARSAL-')).map(p=>({code:p.sku,name:p.productName,package_count:p.sku==='REHEARSAL-REGULAR'?'4':'2',loose_units:p.sku==='REHEARSAL-REGULAR'?'2':'0'}));
  assert.equal(stockRows.length,4,'REHEARSAL_FOUR_STOCKABLE_PRODUCTS_REQUIRED');
  const stock=await workbook('stock',stockRows,api.importer.prepareStock,available.products);
  await api.inventory.applyInventoryOpeningSetupInSupabase({warehouseId:warehouse,rows:stock,notes:'مخزون افتتاحي وهمي للبروفة فقط',idempotencyKey:'rehearsal-opening-stock'});
  const customers=await workbook('customers',[{customer_phone:'0790000001',customer_name:'زبون وهمي للبروفة',amount:'12.000',original_date:'2026-10-01',notes:'دين قديم، ليس بيعاً'}],api.importer.prepareCustomers);
  assert.deepEqual((await api.goLive.dryRunBatch('customers',customers)).errors,[]);
  await api.goLive.saveBatch('customers','rehearsal-customer-save',customers,true);
  const suppliers=await workbook('suppliers',[{supplier_phone:'0790000002',supplier_name:'مورد وهمي للبروفة',direction:'له',amount:'20.000',original_date:'2026-10-01',notes:'رصيد افتتاحي وهمي'}],api.importer.prepareSuppliers);
  assert.deepEqual((await api.goLive.dryRunBatch('suppliers',suppliers)).errors,[]);
  await api.goLive.saveBatch('suppliers','rehearsal-supplier-save',suppliers,true);
  const sheet=api.chequeImport.openingChequeTemplateRows();sheet[1]=['وارد','قيد الانتظار','بنك وهمي','REHEARSAL-001','2026-12-01','5.000','زبون وهمي للبروفة','0790000001','','','2026-10-01','','ضمن الدين القديم 12.000؛ليس ديناً إضافياً'];
  const chequeFile=path.join(output,'dummy-opening-cheques.xlsx');await writeFile(chequeFile,api.xlsx.writeXlsx([{name:'شيكات وهمية',rows:sheet}]));
  const cheques=api.chequeImport.prepareOpeningChequeSheet(await api.xlsx.readXlsxFirstSheet(new Uint8Array(await readFile(chequeFile))));assert.deepEqual(cheques.errors,[]);
  assert.deepEqual((await api.cheques.previewOpeningCheques(branch,cheques.rows)).errors,[]);
  assert.equal((await api.cheques.saveOpeningCheques(branch,'rehearsal-opening-cheque',cheques.rows)).created,1);
  await api.goLive.finishGoLiveSetup('إنهاء بداية التشغيل');assert.equal((await api.goLive.fetchGoLiveStatus()).finished,true);
  const customer=await sql("SELECT id FROM customers WHERE full_name='زبون وهمي للبروفة';"),product=await sql("SELECT id FROM products WHERE sku='REHEARSAL-REGULAR';");
  const cashRows=[['المبلغ الافتتاحي (د.أ)'],['100.000']];await writeFile(path.join(output,'dummy-opening-drawer.xlsx'),api.xlsx.writeXlsx([{name:'تحضير حقل فتح الوردية،ليس استيراداً',rows:cashRows}]));
  return {api,warehouse,branch,customer,product,proof:{workbooks:6,products:2,flavorFamily:1,flavors:2,stockRows:4,customerOpening:12000,supplierOpening:20000,cheque:5000,chequeIncludedInDebt:true,setupFinished:true,serviceCalls:[...api.calls],identity:'test-only AAL2 claims for preserved verified owner UUID;no login or MFA row edits'}};
 }catch(error){api.close();throw error;}
}
export async function rehearseFirstSales219({sql,day}){
 const {api,warehouse,branch,customer,product}=day;
 const call=async(name,args)=>(await api.rpc(name,args)).data;
 const opened=await call('open_cash_shift',{p_branch_id:branch,p_opening_cash_in_minor_units:100000});
 const shift=opened.shiftId??opened.shift?.id??opened.id;
 assert.ok(shift,'REHEARSAL_SHIFT_ID_REQUIRED');
 const line=(kind)=>kind==='unit'?{commercial_line_kind:'base_unit',product_id:product,base_quantity:2,price_authority:'server_catalog',line_discount_in_minor_units:0}:
  {commercial_line_kind:'legacy_single_sku_parcel',product_id:product,parcel_quantity:1,units_per_parcel:6,price_authority:'server_catalog',line_discount_in_minor_units:0};
 const cash=await call('create_pos_sale_v2',{p_warehouse_id:warehouse,p_branch_id:branch,p_customer_id:null,p_customer_name:'زبون نقدي',p_payment_method:'cash',p_lines:[line('unit')],p_discount_in_minor_units:0,p_amount_received_in_minor_units:2000,p_idempotency_key:'rehearsal-first-cash-sale'});
 assert.equal(cash.totalInMinorUnits,2000);
 const partial=await call('create_pos_sale_with_initial_payment_v1',{p_warehouse_id:warehouse,p_branch_id:branch,p_customer_id:customer,p_customer_name:'زبون وهمي للبروفة',p_lines:[line('parcel')],p_discount_in_minor_units:0,p_initial_paid_in_minor_units:4000,p_initial_payment_method:'cash',p_reference_number:null,p_idempotency_key:'rehearsal-first-partial-sale'});
 assert.deepEqual([partial.totalInMinorUnits,partial.amountPaidInMinorUnits,partial.remainingInMinorUnits],[6000,4000,2000]);
 const expected=JSON.parse(await sql(`SELECT jsonb_build_object('stock',(SELECT on_hand_quantity FROM inventory_balances WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)}),'debt',public.phase42_customer_receivable_total_internal(${q(customer)}));`));
 assert.deepEqual(expected,{stock:18,debt:14000});
 await call('close_cash_shift',{p_shift_id:shift,p_actual_cash_in_minor_units:106000,p_discrepancy_reason:null});
 const close=await call('get_cash_shift_closing_report',{p_shift_id:shift});
 assert.equal(close.reconciliation.expectedCashInMinorUnits,106000);assert.equal(close.reconciliation.actualCashInMinorUnits,106000);assert.equal(close.reconciliation.cashDiscrepancyInMinorUnits,0);
 const home=await call('get_home_dashboard',{});assert.equal(home.summary.monthSalesInMinorUnits,8000);assert.equal(home.summary.monthProfitInMinorUnits,4000);
 return {openingCash:100000,cashSale:2000,partialSale:6000,partialCash:4000,newDebt:2000,totalDebt:14000,expectedCash:106000,countedCash:106000,discrepancy:0,remainingRegularPackets:18,sales:8000,profit:4000,closingBalanced:true};
}
