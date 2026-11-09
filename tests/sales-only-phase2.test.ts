import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {bridges,sha256} from '../scripts/testing/sales-only-phase1-bridges.mjs';
import {sourceBeforeSalesOnlyPhase2,salesOnlyPhase2Pins} from '../scripts/audit/source-before-sales-only-phase2.mjs';
import {untrackedPreviewSource,costOnlyPreviewFragments,guestFeatureFragment,sharedFeatureFragment} from '../scripts/testing/sales-only-phase2-commercial.mjs';
import {liteReturnSource,returnSourceHunks} from '../scripts/testing/sales-only-phase2-returns.mjs';
import {liteStatementSource,statementHunks} from '../scripts/testing/sales-only-phase2-statement.mjs';

const root=new URL('../',import.meta.url),read=(file:string)=>readFileSync(new URL(file,root),'utf8').replaceAll('\r\n','\n');
test('only owner-approved monitoring bridge diff changes;other7 byte-identical to85',()=>{
 const pins=JSON.parse(read('docs/design/sales-only-phase2/approved-bridge-pins.json'));
 const split=(s:string)=>Object.fromEntries(s.split('--- DB219/').slice(1).map(x=>[x.split('\n')[0],'--- DB219/'+x]));
 const before=split(execFileSync('git',['show',pins.baseline+':docs/design/sales-only-phase1/bridges.patch'],{cwd:root,encoding:'utf8'}));
 const after=split(read('docs/design/sales-only-phase1/bridges.patch'));
 assert.equal(Object.keys(after).length,8);
 for(const name of Object.keys(after)){
  assert.equal(sha256(before[name]),pins.bridges[name].beforeSha256);
  assert.equal(sha256(after[name]),pins.bridges[name].approvedSha256);
  if(name!=='run_advanced_monitoring_checks')assert.equal(after[name],before[name]);
 }
 const h=bridges.find(b=>b.name==='run_advanced_monitoring_checks')!.hunks[0];
 assert.equal(h.to,h.from.replace('\n      AND NOT EXISTS (','\n      AND NOT sales_lite1.is_order(o.id)\n      AND NOT EXISTS ('));
 assert.equal(h.count??1,1);
 assert.equal(execFileSync('git',['diff',pins.baseline,'--','supabase/migrations','docs/design/sales-only-phase1/frozen-functions.json'],{cwd:root,encoding:'utf8'}),'');
});
test('phase2 metadata inverse is exact;unknown bytes remain visible;runtime state isphase2',()=>{
 assert.deepEqual(Object.keys(salesOnlyPhase2Pins.entries).sort(),["customer-web/scripts/generate-seo-pages.mjs","customer-web/src/App.tsx","customer-web/src/components/CartDrawer.tsx","customer-web/src/components/MerchandisingSections.tsx","customer-web/src/components/ParcelBuilderModal.tsx","customer-web/src/components/ProductCard.tsx","customer-web/src/components/ProductDetailsModal.tsx","customer-web/src/components/ProductPurchaseControl.tsx","customer-web/src/components/StoreHero.tsx","customer-web/src/services/catalog.service.ts","customer-web/src/services/operatingCatalog.ts","customer-web/src/services/orders.service.ts","customer-web/src/services/receipts.service.ts","customer-web/src/types/catalog.ts","customer-web/src/utils/cart.ts","customer-web/src/utils/catalogView.ts","customer-web/src/utils/operatingRead.ts","customer-web/src/utils/productDetails.ts","customer-web/src/utils/storefrontUnits.ts","customer-web/tests/public-pos-receipt.test.ts","customer-web/tests/sales-only-catalog.test.ts","customer-web/tests/storefront-management.test.ts","docs/agent/PHASE_STATUS.md","docs/agent/project-state.json","e2e/admin-lifecycle-recovery.spec.ts","e2e/aftercare215-wizard-harness.tsx","e2e/isolated-test.ts","e2e/owner-alert-links-harness.tsx","e2e/package-e-closing-harness.tsx","e2e/package-f-cheques-harness.tsx","e2e/package-f-customers-harness.tsx","e2e/package-f-go-live-harness.tsx","e2e/package-f-orders-harness.tsx","e2e/package-f-pos-harness.tsx","e2e/package-f-product-workbook-harness.tsx","e2e/package-f-products-harness.tsx","e2e/package-f-public-receipt210.spec.ts","e2e/phase6-package-a-harness.tsx","scripts/operations/check-go-live-files.ps1","scripts/operations/go-live-files/check.ts","scripts/operations/go-live-files/cli.ts","scripts/testing/product-workbook-db-transport.mjs","scripts/testing/run-customer-isolated-build.mjs","scripts/testing/run-storefront-budget-browser.mjs","scripts/testing/storefront-speed-fixture.mjs","src/App.tsx","src/components/common/Header.tsx","src/components/layout/BottomTabs.tsx","src/components/layout/NavigationShell.tsx","src/components/layout/SideNav.tsx","src/components/modals/AllModals.tsx","src/features/cheques/ChequeRegistrationForm.tsx","src/features/cheques/ChequesView.tsx","src/features/dashboard/DashboardHome.tsx","src/features/dashboard/DashboardView.tsx","src/features/dashboard/SalesOnlyDashboardView.tsx","src/features/goLive/GoLiveSetupView.tsx","src/features/goLive/OpeningChequesCard.tsx","src/features/goLive/ProductWorkbookImportPanel.tsx","src/features/goLive/goLiveImport.ts","src/features/goLive/openingChequesImport.ts","src/features/goLive/productWorkbook.ts","src/features/more/MoreMenuView.tsx","src/features/operatingMode/ManualAvailabilityPanel.tsx","src/features/operatingMode/OpeningEpochPanel.tsx","src/features/operatingMode/OperatingModePanel.tsx","src/features/operatingMode/OperatingModeProvider.tsx","src/features/operatingMode/modeReader.ts","src/features/operatingMode/navigationPolicy.ts","src/features/operatingMode/openingEpoch.ts","src/features/operatingMode/operatingModeContext.ts","src/features/orders/AdminAftercarePanel.tsx","src/features/orders/AftercareWizard215.tsx","src/features/orders/OrderDetailModal.tsx","src/features/orders/aftercare215Draft.ts","src/features/pos/PosParcelBuilder.tsx","src/features/pos/PosProductCard.tsx","src/features/pos/PosView.tsx","src/features/pos/posV2Cart.ts","src/features/pos/salesOnlyPos.ts","src/features/products/ProductDetailModal.tsx","src/features/products/ProductFormModal.tsx","src/features/products/ProductsView.tsx","src/features/reports/ReportsCenterView.tsx","src/features/reports/SalesOnlyReportsView.tsx","src/features/shifts/CashFlowSummary.tsx","src/features/shifts/SalesOnlyShiftClosingReportModal.tsx","src/features/shifts/ShiftClosingReportModal.tsx","src/features/shifts/ShiftsView.tsx","src/services/supabase/adminCustomerV2Lifecycle.ts","src/services/supabase/aftercare215.service.ts","src/services/supabase/aftercare215Rpc.ts","src/services/supabase/customerStatement.service.ts","src/services/supabase/dashboard.service.ts","src/services/supabase/expenses-shifts.service.ts","src/services/supabase/manualAvailability.service.ts","src/services/supabase/openingEpoch.service.ts","src/services/supabase/operatingMode.service.ts","src/services/supabase/operatingModeCommand.ts","src/services/supabase/operatingOrdersPage.ts","src/services/supabase/orders.service.ts","src/services/supabase/posV2.service.ts","src/services/supabase/posV2Recovery.ts","src/services/supabase/posV2Validation.ts","src/services/supabase/productWorkbook.service.ts","src/services/supabase/reportingDispatch.service.ts","src/services/supabase/reports.service.ts","src/services/supabase/salesAftercare.service.ts","src/services/supabase/salesOnlyDelivery.ts","src/services/supabase/salesOnlyHome.service.ts","src/services/supabase/salesOnlyOrderContext.ts","src/services/supabase/salesOnlyOrderTransition.ts","src/services/supabase/salesOnlyReport.service.ts","src/services/supabase/salesOnlyShiftReport.ts","src/types/index.ts","src/utils/aftercare215Contracts.ts","src/utils/posKnownRejectionCopy.ts","supabase/functions/submit-guest-order/index.ts","supabase/functions/submit-guest-order/operatingMode.ts","tests/aftercare215-closing.test.ts","tests/cutover-publication-order.test.ts","tests/frankfurt-public-config.test.ts","tests/phase36-admin-integration.test.ts","tests/product-workbook-service.test.ts"]);
 for(const file of Object.keys(salesOnlyPhase2Pins.entries)){
  const current=read(file),pin=salesOnlyPhase2Pins.entries[file];
  const old=pin.beforeText===null?null:execFileSync('git',['show',salesOnlyPhase2Pins.baseline+':'+file],{cwd:root,encoding:'utf8'}).replaceAll('\r\n','\n');
  if(pin.beforeText===null)assert.throws(()=>execFileSync('git',['cat-file','-e',salesOnlyPhase2Pins.baseline+':'+file],{cwd:root,stdio:'ignore'}));
  assert.equal(sourceBeforeSalesOnlyPhase2(file,current),old);
  assert.equal(sourceBeforeSalesOnlyPhase2(file,current+'UNKNOWN'),current+'UNKNOWN');
 }
 const state=JSON.parse(read('docs/agent/project-state.json'));assert.equal(state.currentPhase,'SALES_ONLY_PHASE2');assert.equal(state.migrationCeiling,219);assert.equal(state.phaseSALES_ONLY_PHASE2ImplementationAllowed,true);
});
test('private preview keeps pinned commercial body;3cost fragments and exact shared actor guard only',()=>{
 const sql=read('supabase/migrations/132_package_d_system_unification.sql');
 const start=sql.indexOf('CREATE OR REPLACE FUNCTION public.preview_guest_promotion_v2(');
 const tail=sql.slice(start),begin=tail.indexOf('AS $$')+5,end=tail.indexOf('$$;',begin);
 assert.ok(start>0&&begin>5&&end>begin);
 const row={signature:'preview_guest_promotion_v2(jsonb,text,text)',source:tail.slice(begin,end)};
 const actual=untrackedPreviewSource(row);let expected=row.source;
 costOnlyPreviewFragments.forEach((fragment,i)=>{expected=expected.replace(fragment,i===1?'          )\n        INTO v_component_total, v_invalid_component_count':'');});
 expected=expected.replace(guestFeatureFragment,sharedFeatureFragment);
 assert.equal(actual,expected);assert.doesNotMatch(actual,/wac_cost|v_missing_wac/);
 assert.throws(()=>untrackedPreviewSource({...row,source:row.source+' '}),/COMMERCIAL_ORIGINAL_SOURCE_DRIFT/);
 const plan=read('docs/design/sales-only-phase2/commercial-plan.sql');
 assert.doesNotMatch(plan,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER)\b/u);
 assert.match(plan,/public\.phase3_canonicalize_sale_request_internal/);
 assert.match(plan,/public\.phase2_allocate_largest_remainder_internal/);
 assert.match(plan,/public\.parcel209_effective_only_internal/);
});
test('guest writer preservescard/defaultaddress;newwriters share one parcel materializer',()=>{
 const guest=read('docs/design/sales-only-phase2/guest-writer.sql');
 assert.doesNotMatch(guest,/UPDATE public\.(?:customers|customer_addresses)|DELETE FROM public\.(?:customers|customer_addresses)/u);
 assert.match(guest,/lat IS NOT NULL,false\)/);
 assert.match(guest,/sales_lite2\.materialize\(oid,op,plan,'customer_v2',phone,promotion\)/);
 const pos=read('docs/design/sales-only-phase2/pos-writer.sql');
 assert.match(pos,/sales_lite2\.materialize\(oid,op,plan,'admin_pos'\)/);
 assert.equal((pos.match(/CREATE FUNCTION sales_lite2.materialize/g)??[]).length,1);
 assert.match(guest,/FOR UPDATE;END IF;[\s\S]*plan:=sales_lite2.plan/);
 assert.match(guest,/recent>=3/);assert.match(guest,/INTERVAL '10 minutes'/i);
 assert.doesNotMatch(guest,/UPDATE public\.business_operations|inventory_movements|order_inventory_reservations/);
});
test('lite lifecycle uses existing orderlock/payment writer;no stock or historywriter replacement',()=>{
 const sql=read('docs/design/sales-only-phase2/guest-lifecycle.sql');
 assert.match(sql,/public\.phase4_lock_customer_order_context_internal\(p_order,method<>'debt',false\)/);
 assert.match(sql,/public\.record_customer_order_payment_once/);
 assert.match(sql,/o.status NOT IN\('ready','out_for_delivery'\)/);
 assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION|inventory_movements|inventory_balances|order_inventory_reservations|UPDATE public\.business_operations/);
 assert.match(sql,/collected>total/);assert.match(sql,/PHASE3_CUSTOMER_SETTLEMENT_REFERENCE_REQUIRED/);
});

test('lite return preserves pinned215 entitlement algorithm and physical-source identity;unknown body refused',()=>{
 const sql=read('supabase/migrations/215_inspected_aftercare_and_supplier_credit.sql');
 const tail=sql.slice(sql.indexOf('CREATE FUNCTION public.tb215_prepare_return_internal(')),begin=tail.indexOf('AS $$')+5,end=tail.indexOf('$$;',begin);
 const row={signature:'tb215_prepare_return_internal(jsonb)',source:tail.slice(begin,end)};
 let expected=row.source;for(const [from,to] of returnSourceHunks)expected=expected.replace(from,()=>to);
 assert.equal(liteReturnSource(row),expected);
 assert.throws(()=>liteReturnSource({...row,source:row.source+'UNKNOWN'}),/RETURN_ORIGINAL_SOURCE_DRIFT/);
 assert.match(expected,/public\.phase43_assert_return_physical_source_internal/);
 assert.match(expected,/public\.phase42_order_financial_position_internal/);
 const writer=read('docs/design/sales-only-phase2/returns.sql');
 assert.doesNotMatch(writer,/CREATE OR REPLACE FUNCTION|INSERT INTO public\.(?:inventory_movements|sales_return_events)|UPDATE public\.(?:products|order_items)/);
 assert.match(writer,/return_money_requires_shift CHECK\(money_refund=0 OR shift_id IS NOT NULL\)/);
 assert.match(writer,/REVOKE ALL ON FUNCTION public\.lite1_return/);
});

test('parallel statement adds only provenlite movements and completiondate;canonical mismatch guard retained',()=>{
 const sql=read('supabase/migrations/192_cheque_compensation_receivable_readers.sql');
 const tail=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.get_customer_statement(')),begin=tail.indexOf('AS $$')+5,end=tail.indexOf('$$;',begin);
 const row={signature:'get_customer_statement(uuid,integer,integer)',source:tail.slice(begin,end)};
 let expected=row.source;for(const [from,to] of statementHunks)expected=expected.replace(from,()=>to);
 assert.equal(liteStatementSource(row),expected);
 assert.match(expected,/v_evidence_total IS DISTINCT FROM v_canonical/);
 assert.match(expected,/sales_lite1\.is_order\(r.order_id\)/);
 assert.doesNotMatch(expected,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER)\b/u);
 assert.throws(()=>liteStatementSource({...row,source:row.source+'UNKNOWN'}),/STATEMENT_ORIGINAL_SOURCE_DRIFT/);
});

test('opening epoch isquarantined,atomic anddistinctfrom047;ownerAAL2 andcount/seal/busy guards',()=>{
 const sql=read('docs/design/sales-only-phase2/opening-epoch.sql');
 assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION|(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:orders|order_items|customers|customer_payments|go_live_setup_state|inventory_opening_sessions|inventory_opening_items)/);
 assert.equal((sql.match(/auth\.jwt\(\)->>'aal' IS DISTINCT FROM 'aal2'/g)??[]).length,3);
 assert.deepEqual([...sql.matchAll(/CREATE FUNCTION public\.(\w+)\(/g)].map(m=>m[1]),['lite1_preview_epoch2','lite1_activate_epoch2','lite1_epoch_catalog2']);
 for(const name of ['lite1_preview_epoch2','lite1_activate_epoch2','lite1_epoch_catalog2']){assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.'+name));assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.'+name));}
 assert.match(sql,/FOR UPDATE NOWAIT/);assert.match(sql,/SHARE ROW EXCLUSIVE MODE NOWAIT/);
 assert.match(sql,/LITE2_EPOCH_COMPLETE_COUNT_REQUIRED/);assert.match(sql,/LITE2_EPOCH_PREVIEW_CHANGED/);
 assert.match(sql,/LITE2_EPOCH_GO_LIVE_NOT_FINISHED/);assert.match(sql,/reservation_state='active'/);
 assert.match(sql,/CREATE TRIGGER lite2_immutable/);
 const flip=sql.indexOf('UPDATE sales_lite1.mode SET full_accounting=true'),stock=sql.indexOf('UPDATE public.products SET cost_price');
 assert.ok(flip>sql.indexOf('LITE2_EPOCH_PREVIEW_CHANGED')&&stock>flip);
 assert.match(read('docs/design/sales-only-phase2/entrypoints.sql'),/REVOKE ALL ON FUNCTION public\.lite1_set_mode\(BOOLEAN\)/);
});
