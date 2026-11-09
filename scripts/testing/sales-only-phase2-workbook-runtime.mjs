import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';
import {productWorkbookDbTransport} from './product-workbook-db-transport.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

export async function verifyLiteWorkbookImport(c,report){
 const {sql,json,id,q,j,executor}=c,actor=id(1);
 const model=await tsImport('../../src/features/goLive/productWorkbook.ts',import.meta.url);
 const ref=await json(`SELECT jsonb_build_object('category',(SELECT name_ar FROM public.categories WHERE id=(SELECT category_id FROM public.products WHERE id=${q(id(103))})),
 'packet',(SELECT code FROM public.units WHERE id=(SELECT unit_id FROM public.products WHERE id=${q(id(103))})),
 'carton',(SELECT code FROM public.units WHERE id=(SELECT sale_unit_id FROM public.products WHERE id=${q(id(100))})));`);
 const columns=model.productWorkbookColumns('sales-only'),flavors=model.flavorWorkbookColumns('sales-only');
 const values=sku=>({sku,name_ar:sku==='LITEIMPORT-ONE'?'ﺑﺮﺍﻭﻧﻲ اختبار':'عائلة اختبار مبسطة',category_name:ref.category,base_unit_name:ref.packet,purchase_unit_name:ref.carton,units_per_purchase_unit:'12',sale_unit_name:ref.carton,units_per_sale_unit:'12',sale_package_price:'9.000',sale_method:'الاثنين',packet_price:'0.750'});
 const plan=model.prepareProductWorkbook([columns.map(c=>c.header),...['LITEIMPORT-ONE','LITEIMPORT-FAMILY'].map(s=>columns.map(c=>values(s)[c.key]??''))],
 [flavors.map(c=>c.header),...['ليمون','برتقال'].map((name,i)=>flavors.map(c=>({master_sku:'LITEIMPORT-FAMILY',name,barcode:i?'':'000123456789'}[c.key]??'')))],'sales-only');
 assert.deepEqual(plan.errors,[]);assert.equal(plan.products[0].data.cost_per_base_unit_in_minor_units,'0');
 const before=await readApplicationFingerprint(executor);
 const auth=text=>`BEGIN;SELECT set_config('request.jwt.claims',${j({sub:actor,role:'authenticated',aal:'aal2'})}::text,true);SET LOCAL ROLE authenticated;SET LOCAL statement_timeout='8s';${text}COMMIT;`;
 const bridge=await productWorkbookDbTransport({json,auth,actor,container:'supabase_db_nawasrah-sales-lite2-epoch-test'});
 bridge.loseCreate();await assert.rejects(bridge.service.saveProductWorkbook(plan,actor,bridge.storage));
 const idsBeforeResume=await json("SELECT jsonb_agg(id ORDER BY id) FROM public.products WHERE sku LIKE 'LITEIMPORT-%' OR sku LIKE 'GI-%';");
 await bridge.service.saveProductWorkbook(plan,actor,bridge.storage);
 const products=await json("SELECT jsonb_agg(jsonb_build_object('id',id,'sku',sku,'name',name_ar,'barcode',barcode,'cost',cost_price_in_minor_units,'price',default_sale_price_in_minor_units,'parent',flavor_master_product_id,'master',is_flavor_master) ORDER BY sku) FROM public.products WHERE sku LIKE 'LITEIMPORT-%';");
 assert.equal(products.length,4);assert.deepEqual(products.map(p=>p.id).sort(),idsBeforeResume.sort());assert.ok(products.every(p=>p.cost===0&&p.price===9000));
 assert.equal(products.find(p=>p.sku==='LITEIMPORT-ONE').name,'براوني اختبار');assert.equal(products.find(p=>p.sku.endsWith('-ليمون')).barcode,'000123456789');
 assert.equal(bridge.calls.filter(c=>c.name==='create_product_family_with_flavors_v2'&&c.success).length,1);
 assert.equal(bridge.calls.filter(c=>c.name==='import_go_live_products_v1'&&c.success).length,1);
 const snapshot=await readApplicationFingerprint(executor);await bridge.service.saveProductWorkbook(plan,actor,bridge.storage);assert.deepEqual(await readApplicationFingerprint(executor),snapshot,'COMPLETE_LITE_IMPORT_REPLAY_ZERO_WRITES');
 for(const table of ['orders','order_items','customer_payments','cash_shifts','inventory_movements','order_inventory_reservations'])assert.equal(snapshot.tables[table],before.tables[table],table);
 assert.equal(Number(await sql("SELECT count(*) FROM public.inventory_balances b JOIN public.products p ON p.id=b.product_id WHERE p.sku LIKE 'LITEIMPORT-%' AND(b.on_hand_quantity<>0 OR b.reserved_quantity<>0);")),0);
 // Keep the independent six-row opening-epoch fixture unchanged. This is test
 // fixture retirement only;the verified imported identities remain in the DB.
 await sql("UPDATE public.products SET is_active=false WHERE sku LIKE 'LITEIMPORT-%';");
 report.cases.push({name:'actual lite workbook parser+durable service→existing219import/family/update RPCs;4identities/leadingzeros/normalizedname/zerocoststock;lostcreate samefamily;complete replay zerowrites;8s role timeout',passed:true});
}
