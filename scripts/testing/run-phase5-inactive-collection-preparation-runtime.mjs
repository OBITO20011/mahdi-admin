import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {assertPhase5DbLint} from './phase5-db-lint-policy.mjs';
import {functionEvents} from '../analysis/build-phase5-authority-ledger.mjs';
import {inspectReceiptV2TriggerEffectContract,deriveReceiptV2AlertTransition} from '../analysis/inspect-phase5-writer-admission.mjs';
import {inspectReceiptV2TransitiveRowRequirements,assertReceiptV2TransitiveRowRequirements} from '../analysis/inspect-phase5-writer-admission.mjs';
import {deriveReceiptV2StockStages,assertReceiptV2StockStages} from '../analysis/inspect-phase5-writer-admission.mjs';
import {bindReceiptV2SourceEffectUnion,assertReceiptV2SourceEffectUnion} from '../analysis/inspect-phase5-writer-admission.mjs';
import {resolveReceiptV2CapturedAlertEvents,assertReceiptV2CapturedAlertEvents} from '../analysis/inspect-phase5-writer-admission.mjs';
import {resolveReceiptV2StockCandidateRequirements} from '../analysis/inspect-phase5-writer-admission.mjs';
import {bindReceiptV2StockResourceUnion,assertReceiptV2StockResourceUnion} from '../analysis/inspect-phase5-writer-admission.mjs';
import {qualifySourceScalarValue,qualifyPreparedSourceRow,assertPreparedSourceRow} from '../analysis/inspect-phase5-writer-admission.mjs';
import {inspectReceiptV2InstalledValueRequirements,inspectReceiptV2LiteralSourcePins,inspectReceiptV2RowRequirements,assertReceiptV2RowRequirements,bindReceiptV2ItemProjectionRequirements,assertReceiptV2ItemProjectionRequirements,bindReceiptV2PrimaryProjectionRequirements,assertReceiptV2PrimaryProjectionRequirements,bindReceiptV2UpdateProjectionRequirements,assertReceiptV2UpdateProjectionRequirements,inspectReceiptV2UpdateRequirements,decodeReceiptV2LiteralRequirement} from '../analysis/inspect-phase5-writer-admission.mjs';
import {captureCustomerCollectionRequest,customerCollectionPostgresText,
  fingerprintCustomerCollectionRequest,assertCustomerCollectionResult} from '../../src/services/supabase/customerPaymentContract.ts';

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname,'../..');
const projectId = 'nawasrah-phase5-slice5-preparation-test';
const container = `supabase_db_${projectId}`;
const cli = path.join(root,'node_modules/supabase/dist/supabase.js');
const owner = '92400000-0000-0000-0000-000000000001';
const branch = '92400000-0000-0000-0000-000000000200';
const warehouse = '92400000-0000-0000-0000-000000000201';
const product = '92400000-0000-0000-0000-000000000101';
const q = (s) => `'${String(s).replaceAll("'","''")}'`;
const j = (v) => `${q(JSON.stringify(v))}::jsonb`;
const passed = [];
const legacyFocused = process.argv.includes('--legacy-focused');
const shiftPaymentFocused = process.argv.includes('--shift-payment-discovery-focused');
const shiftTriggerIdentityFocused = process.argv.includes('--shift-trigger-identity-focused');
const inventorySideEffectPlanFocused = process.argv.includes('--inventory-side-effect-plan-focused');
const inventoryAuthorityFocused = process.argv.includes('--inventory-authority-focused');
const inventoryIdentityFocused = process.argv.includes('--inventory-identity-focused');
const completionIdentityFocused = process.argv.includes('--completion-identity-focused');
const completionRowsFocused = process.argv.includes('--completion-rows-focused');
const completionProgressFocused = process.argv.includes('--completion-progress-focused');
const completionLockUnionFocused = process.argv.includes('--completion-lock-union-focused');
const transportSourceFocused = process.argv.includes('--transport-source-focused');
const readMarkResourcesFocused = process.argv.includes('--read-mark-resources-focused');
const readMarkResourcesOnlyFocused = process.argv.includes('--read-mark-resources-only-focused');
const writerAdmissionFocused = process.argv.includes('--writer-admission-focused');
const receivingPrewriteFocused = process.argv.includes('--receiving-prewrite-focused');
const productCreationPrewriteFocused = process.argv.includes('--product-creation-prewrite-focused');
const receivingFutureIdentitiesFocused = process.argv.includes('--receiving-future-identities-focused');
const productAncillaryIdentitiesFocused = process.argv.includes('--product-ancillary-identities-focused');
const receiptV2AllocationFocused = process.argv.includes('--receipt-v2-allocation-focused');
const sourceTypedValuesFocused = process.argv.includes('--source-typed-values-focused');
const receiptV2ResourceUnionFocused = process.argv.includes('--receipt-v2-resource-union-focused') || sourceTypedValuesFocused;
const receiptV2TriggerEffectsFocused = process.argv.includes('--receipt-v2-trigger-effects-focused') || receiptV2ResourceUnionFocused;
const receiptV2EventsUpdatesFocused = process.argv.includes('--receipt-v2-events-updates-focused');
const receiptV2PrimaryBindingsFocused = process.argv.includes('--receipt-v2-primary-bindings-focused') || receiptV2EventsUpdatesFocused;
const receiptV2ItemBindingsFocused = process.argv.includes('--receipt-v2-item-bindings-focused') || receiptV2PrimaryBindingsFocused;
const receiptV2RowRequirementsFocused = process.argv.includes('--receipt-v2-row-requirements-focused') || receiptV2ItemBindingsFocused;
const receiptV2LiteralValuesFocused = process.argv.includes('--receipt-v2-literal-values-focused') || receiptV2RowRequirementsFocused;
const receiptV2InstalledValuesFocused = process.argv.includes('--receipt-v2-installed-values-focused') || receiptV2LiteralValuesFocused;
const receiptV2PrewriteFocused = process.argv.includes('--receipt-v2-prewrite-focused') || receiptV2InstalledValuesFocused;
const parentExecuteFocused = process.argv.includes('--parent-execute-focused') || readMarkResourcesFocused;
const parentSourceFocused = process.argv.includes('--parent-source-focused') || parentExecuteFocused;
const stockWriterSourceFocused = process.argv.includes('--stock-writer-source-focused') || parentSourceFocused || readMarkResourcesOnlyFocused;
const completionTriggerRowsFocused = process.argv.includes('--completion-trigger-rows-focused')||completionProgressFocused||completionLockUnionFocused;
assert.ok([legacyFocused,shiftPaymentFocused,shiftTriggerIdentityFocused,inventorySideEffectPlanFocused,inventoryAuthorityFocused,inventoryIdentityFocused,completionIdentityFocused,completionRowsFocused,completionTriggerRowsFocused,transportSourceFocused,stockWriterSourceFocused,writerAdmissionFocused,receivingPrewriteFocused,productCreationPrewriteFocused,receivingFutureIdentitiesFocused,productAncillaryIdentitiesFocused,receiptV2AllocationFocused,receiptV2PrewriteFocused,receiptV2TriggerEffectsFocused].filter(Boolean).length<=1,
  'focused modes are mutually exclusive');
const inventoryIdentityCoverage=inventoryIdentityFocused ||
  ![legacyFocused,shiftPaymentFocused,shiftTriggerIdentityFocused,inventorySideEffectPlanFocused,inventoryAuthorityFocused,completionIdentityFocused,completionRowsFocused,completionTriggerRowsFocused,transportSourceFocused,stockWriterSourceFocused,writerAdmissionFocused,receivingPrewriteFocused,productCreationPrewriteFocused,receivingFutureIdentitiesFocused,productAncillaryIdentitiesFocused,receiptV2AllocationFocused,receiptV2PrewriteFocused,receiptV2TriggerEffectsFocused].some(Boolean);
let workdir = '';
let checks = 0;
const sql = (text, expectFailure = false, databaseRole = 'postgres') => new Promise((resolve,reject) => {
  assert.ok(['postgres','supabase_admin'].includes(databaseRole),'isolated fault-injection roles only');
  const child = spawn('docker',['exec','-i',container,'psql','-U',databaseRole,'-d','postgres',
    '-X','-q','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],
  {cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  // Decode UTF-8 across pipe chunks, not each Buffer independently: full row
  // samples may split an Arabic character exactly at an OS pipe boundary.
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  let stdout = ''; let stderr = '';
  child.stdout.on('data',(value) => { stdout += value; });
  child.stderr.on('data',(value) => { stderr += value; });
  child.on('error',reject);
  child.on('close',(code) => {
    if ((code !== 0) !== expectFailure) reject(new Error(`SQL exit ${code}: ${stderr}`));
    else resolve({stdout,stderr});
  });
  child.stdin.end(`SET statement_timeout='10s';\n${text}`);
});
const json = async (text) => JSON.parse((await sql(text)).stdout.trim().split(/\r?\n/u).at(-1));
const fails = async (text, pattern = /PHASE5_/u, databaseRole = 'postgres') => {
  let output;
  try { output=await sql(`BEGIN; ${text} ROLLBACK;`,true,databaseRole); }
  catch (error) { throw new Error(`Expected rejection ${pattern} was not observed`,{cause:error}); }
  assert.match(output.stderr,pattern); checks += 1;
};
const holdSQL = async (statement, name = 'S5-GENERATION-HOLDER') => {
  const child = spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres',
    '-X','-q','-At','-v','ON_ERROR_STOP=1'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  let stderr = ''; let output = '';
  child.stderr.on('data',(value) => { stderr += value; });
  const closed = new Promise((resolve,reject) => {
    child.on('error',reject);
    child.on('close',(code) => code === 0 ? resolve() : reject(new Error(`Holder exit ${code}: ${stderr}`)));
  });
  // Observe early failure immediately; release/readiness still propagate it.
  void closed.catch(() => {});
  // Readiness comes AFTER the actual row lock, not a guessed startup sleep.
  try {
    await new Promise((resolve,reject) => {
      const timer = setTimeout(() => reject(new Error('SQL holder readiness missing')),10000);
      child.stdout.on('data',(value) => {
        output += value;
        if (output.includes('S5-HOLDER-READY')) { clearTimeout(timer); resolve(); }
      });
      child.on('error',(error) => { clearTimeout(timer); reject(error); });
      child.on('close',() => { clearTimeout(timer); reject(new Error(`SQL holder closed before release: ${stderr}`)); });
      child.stdin.write(`SET statement_timeout='10s'; BEGIN;
        SET LOCAL application_name=${q(name)};
        ${statement}
        SELECT 'S5-HOLDER-READY';\n`);
    });
  } catch (error) {
    child.stdin.end('ROLLBACK;\n\\q\n');
    await closed;
    throw error;
  }
  return async (finish = 'ROLLBACK') => {
    assert.ok(['ROLLBACK','COMMIT'].includes(finish));
    child.stdin.end(`${finish};\n\\q\n`); await closed;
    return output;
  };
};
const holdGeneration = () => holdSQL('SELECT singleton FROM phase5_private.authority_generation WHERE singleton FOR UPDATE;');
const fingerprintQuery = `SELECT to_jsonb(encode(extensions.digest(jsonb_build_object(
  'generation',(SELECT jsonb_agg(to_jsonb(t)) FROM phase5_private.authority_generation t),
  'receipts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY generation) FROM phase5_private.activation_receipts t),
  'contexts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM phase5_private.mutation_contexts t),
  'attempts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY financial_operation_id) FROM phase5_private.collection_attempt_envelopes t),
  'operations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM phase5_private.financial_operation_events t),
  'collections',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM phase5_private.collection_events t),
  'payments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.customer_payments t),
  'audits',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.audit_logs t),
  'orders',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.orders t),
  'history',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.order_status_history t),
  'products',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.products t),
  'customers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.customers t),
  'addresses',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.customer_addresses t),
  'authIdentities',(SELECT jsonb_agg(jsonb_build_object('id',id) ORDER BY id) FROM auth.users),
  'profiles',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.profiles t),
  'branches',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.branches t),
  'warehouses',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.warehouses t),
  'roles',(SELECT jsonb_agg(to_jsonb(t) ORDER BY user_id,role_id) FROM public.user_roles t),
  'shifts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.cash_shifts t),
  'shiftReversals',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.cash_shift_reversals t),
  'shiftReversalOperations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.cash_shift_reversal_operations t),
  'expenses',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.operational_expenses t),
  'supplierDomain',jsonb_build_object(
  'supplierPayments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.supplier_payments t),
  'supplierPaymentReversals',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.supplier_payment_reversals t),
  'suppliers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.suppliers t),
  'supplierReceipts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.supplier_receipts t),
  'supplierReceiptItems',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.supplier_receipt_items t),
  'supplierReceiptLines',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.supplier_receipt_commercial_lines t),
  'purchaseOrders',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.purchase_orders t),
  'purchaseOrderItems',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.purchase_order_items t),
  'purchaseReceipts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.purchase_receipts t),
  'purchaseReceiptItems',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.purchase_receipt_items t),
  'purchaseReceiptLines',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.purchase_receipt_commercial_lines t),
  'receiptWac',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.phase2_receipt_wac_snapshots t),
  'supplierInvoices',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.supplier_financial_invoice_identities t)),
  'businessOperations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.business_operations t),
  'items',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.order_items t),
  'reservations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.order_inventory_reservations t),
  'instances',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.order_parcel_instances t),
  'components',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.order_parcel_components t),
  'balances',(SELECT jsonb_agg(to_jsonb(t) ORDER BY product_id,warehouse_id) FROM public.inventory_balances t),
  'inventory',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.inventory_movements t)
  ,'stockAlerts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stock_alerts t)
  ,'stockAlertReads',(SELECT jsonb_agg(to_jsonb(t) ORDER BY stock_alert_id,user_id) FROM public.stock_alert_reads t)
  ,'automationEvents',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.automation_events t)
  ,'automationDeliveries',(SELECT jsonb_agg(to_jsonb(t) ORDER BY event_id,channel) FROM public.automation_event_deliveries t)
  ,'returns',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.sales_returns t)
  ,'returnItems',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.sales_return_items t)
  ,'returnEvents',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.sales_return_events t)
  ,'inspections',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.sales_return_component_inspections t)
  ,'consumptions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.sales_aftercare_consumptions t)
  ,'returnEffects',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.phase42_return_inventory_effects t)
  ,'returnSettlement',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.phase42_return_settlement_evidence t)
  ,'replacementEvents',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.sales_replacement_events t)
  ,'replacementItems',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.sales_replacement_items t)
  ,'replacementEffects',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.phase43_replacement_inventory_effects t)
  ,'replacementSettlement',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.phase43_replacement_settlement_evidence t)
  ,'costGuards',(SELECT jsonb_agg(to_jsonb(t) ORDER BY transaction_id,row_kind,row_id) FROM public.phase3_customer_cost_finalization_guards t)
  ,'lifecycleGuards',(SELECT jsonb_agg(to_jsonb(t) ORDER BY transaction_id,order_id,target_status) FROM public.phase3_customer_lifecycle_transition_guards t)
  )::text,'sha256'),'hex'));`;
const fingerprint = () => json(fingerprintQuery);
// Diagnostic content uses the exact same covered object as the assertion.
// Only hashes/changed field names are printed, never captured business values.
const fingerprintContentQuery = fingerprintQuery
  .replace(/^SELECT to_jsonb\(encode\(extensions\.digest\(/u,'SELECT ')
  .replace(/::text,'sha256'\),'hex'\)\);$/u,';');
assert.notEqual(fingerprintContentQuery,fingerprintQuery);
const fingerprintContent = () => json(fingerprintContentQuery);
const fingerprintContentDiff = (before,after) => {
  const flatten = (snapshot) => Object.fromEntries(Object.entries(snapshot).flatMap(([key,value]) =>
    key==='supplierDomain' ? Object.entries(value).map(([child,rows])=>[`${key}.${child}`,rows]) : [[key,value]]));
  const left=flatten(before),right=flatten(after);
  const hash=(value)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return Object.keys(left).filter((key)=>hash(left[key])!==hash(right[key])).map((key)=>({
    domain:key,beforeCount:left[key]?.length??0,afterCount:right[key]?.length??0,
    beforeHash:hash(left[key]),afterHash:hash(right[key]),
    rowFieldNames:[...new Set([...(left[key]??[]),...(right[key]??[])].flatMap((row)=>Object.keys(row)))],
  }));
};
const money = (v) => `SELECT phase5_private.wire_money_v1(${v === undefined ? 'NULL' : j(v)});`;

// Focused Legacy acquisition matrix, also retained in the complete default run.
// No public guard is disabled. Generation instrumentation is private/disposable
// and restored before returning; context/source/evidence barriers stay installed.
const legacyAcquisition = async (claims,args,migrationHash) => {
  const discover=`phase5_private.discover_legacy_completion_resources_v1(${args})`;
  const acquire=`phase5_private.lock_legacy_completion_plan_v1(${args})`;
  const before=await fingerprint();
  const plan=await json(`${claims} SELECT ${discover};`);
  const id=plan.commercial.orderId;
  const shift=plan.commercial.selectedShift.id;
  assert.equal(plan.planState,'LEGACY_RESOURCES_DISCOVERED_ONLY');
  assert.equal(plan.locksHeld,false); assert.equal(plan.executionAuthority,false); checks+=3;
  assert.deepEqual(plan.rootGates,[`phase4-order|${id}`]);
  assert.deepEqual(plan.sharedGates,[`cash-shift-full-reversal:${shift}`]);
  assert.deepEqual(plan.inventoryGates,[`inventory-product:${product}`]); checks+=3;
  assert.equal(new Set(plan.resources.map((n)=>`${n.relation}|${n.id}`)).size,plan.resources.length); checks+=1;
  const inventory=plan.resources.filter((n)=>n.relation==='public.inventory_balances');
  assert.deepEqual(inventory.map((n)=>n.row),await json(`SELECT jsonb_agg(to_jsonb(b) ORDER BY product_id,warehouse_id)
    FROM public.inventory_balances b WHERE product_id=${q(product)};`)); checks+=1;
  for(const n of plan.resources.filter((n)=>n.relation==='auth.users')) {
    assert.deepEqual(n.row,{id:n.id}); assert.equal(n.mode,'KEY_SHARE'); checks+=2;
  }
  const expectedFkParents=['public.branches','public.cash_shifts','public.customers','public.profiles',
    'public.products','public.orders','public.warehouses','public.customer_addresses','public.promotion_codes','public.business_operations',
    'public.order_parcel_components','public.order_inventory_reservations','public.supplier_receipt_items',
    'public.purchase_receipt_items','public.inventory_movements'];
  assert.deepEqual(await json(`SELECT jsonb_agg(DISTINCT c.confrelid::regclass::text ORDER BY c.confrelid::regclass::text)
    FROM pg_constraint c WHERE c.contype='f' AND c.conrelid IN ('public.orders'::regclass,'public.order_items'::regclass,
      'public.order_status_history'::regclass,'public.customer_payments'::regclass,'public.inventory_movements'::regclass,'public.audit_logs'::regclass);`),
    [...expectedFkParents,'public.product_parcel_configurations'].map((name)=>name.replace('public.','')).sort()); checks+=1;
  // Null modern FKs are rejected at discovery rather than treated as parents.
  for(const relation of ['public.orders','public.cash_shifts','public.order_items','public.order_status_history',
    'public.customers','public.customer_addresses','public.branches','public.warehouses','public.products','public.profiles','public.roles','public.user_roles','public.audit_logs']) {
    assert.ok(plan.resources.some((n)=>n.relation===relation),relation); checks+=1;
  }
  assert.equal(await fingerprint(),before,'legacy-resources-zero-write'); checks+=1;
  await fails(`${claims} SELECT ${acquire};`,/55000.*PREPARATION_ONLY/u);
  await fails(`SELECT set_config('request.jwt.claims','{}',false); SELECT ${acquire};`,/42501.*LEGACY_ACTOR_UNAUTHORIZED/u);
  for(const role of ['anon','authenticated','service_role']) {
    for(const call of [discover,acquire,`phase5_private.assert_legacy_completion_resources_unchanged_v1(${args},${j(plan)})`]) {
      await fails(`${claims} SET LOCAL ROLE ${role}; SELECT ${call};`,/permission denied/u);
    }
  }
  for(const mutation of [
    `UPDATE public.orders SET internal_notes='Legacy root drift' WHERE id=${q(id)};`,
    `UPDATE public.customers SET full_name='Legacy parent drift' WHERE id=${q(plan.commercial.sourceOrder.customer_id)};`,
    `UPDATE public.order_items SET product_name_snapshot='Legacy item drift' WHERE order_id=${q(id)};`,
    `UPDATE public.audit_logs SET details='{}' WHERE entity_name='orders' AND entity_id=${q(id)};`,
    `UPDATE public.inventory_balances SET on_hand_quantity=on_hand_quantity+1 WHERE id=${q(inventory[0].id)};`,
    `UPDATE public.cash_shifts SET opening_cash_in_minor_units=opening_cash_in_minor_units+1 WHERE id=${q(shift)};`,
  ]) await fails(`${claims} ${mutation} SELECT phase5_private.assert_legacy_completion_resources_unchanged_v1(
    ${args},${j(plan)});`,/40001.*LEGACY_RESOURCES_CHANGED_RETRY/u);
  const maintenance=`ALTER TABLE phase5_private.authority_generation DISABLE TRIGGER phase5_preparation_generation_barrier;
    ALTER TABLE phase5_private.activation_receipts DISABLE TRIGGER phase5_preparation_activation_barrier;`;
  const restoreBarriers=`ALTER TABLE phase5_private.authority_generation ENABLE TRIGGER phase5_preparation_generation_barrier;
    ALTER TABLE phase5_private.activation_receipts ENABLE TRIGGER phase5_preparation_activation_barrier;`;
  const deadlocks=await json(`SELECT to_jsonb(deadlocks) FROM pg_stat_database WHERE datname=current_database();`);
  // Committed test-only private control setup lets independent connections see
  // the same generation. This is NOT an activated public path or source writer.
  await sql(`BEGIN; ${maintenance} UPDATE phase5_private.authority_generation SET generation=1,authority_state='ACTIVE';
    INSERT INTO phase5_private.activation_receipts VALUES(1,'128',${q(migrationHash)},
      '9A74EB14788EA668BDE88DAC95561AD8DA2F734EC47EAA87491AB0F181E06099',clock_timestamp(),txid_current());
    ${restoreBarriers} COMMIT;`);
  try {
    const lockedBefore=await fingerprint();
    const locked=await json(`BEGIN; ${claims} SELECT ${acquire}; ROLLBACK;`);
    assert.deepEqual(locked,{...plan,planState:'LEGACY_RESOURCES_LOCKED_ONLY',locksHeld:true}); checks+=1;
    assert.equal(await fingerprint(),lockedBefore,'legacy-locks-zero-write'); checks+=1;
    await fails(`${claims} SELECT id FROM public.orders WHERE id=${q(id)} FOR UPDATE;
      SELECT ${acquire};`,/40001.*LEGACY_LATE_ENTRY_RETRY/u);
    for(const [statement,pattern] of [
      ['SELECT singleton FROM phase5_private.authority_generation WHERE singleton FOR UPDATE;',/40001.*GENERATION_BUSY_RETRY/u],
      [`SELECT id FROM public.cash_shifts WHERE id=${q(shift)} FOR UPDATE;`,/40001.*LEGACY_CONTENTION_RETRY/u],
      [`SELECT id FROM public.orders WHERE id=${q(id)} FOR UPDATE;`,/40001.*LEGACY_CONTENTION_RETRY/u],
      [`SELECT id FROM public.order_items WHERE order_id=${q(id)} FOR UPDATE;`,/40001.*LEGACY_CONTENTION_RETRY/u],
      [`SELECT id FROM public.audit_logs WHERE entity_name='orders' AND entity_id=${q(id)} FOR UPDATE;`,/40001.*LEGACY_CONTENTION_RETRY/u],
      [`SELECT id FROM public.inventory_balances WHERE id=${q(inventory[0].id)} FOR UPDATE;`,/40001.*LEGACY_CONTENTION_RETRY/u],
      [`SELECT id FROM public.profiles WHERE id=${q(owner)} FOR UPDATE;`,/40001.*LEGACY_CONTENTION_RETRY/u],
    ]) {
      const release=await holdSQL(statement,'S5-LEGACY-ROW-HOLDER');
      try { await fails(`${claims} SELECT ${acquire};`,pattern); }
      finally { await release(); }
      assert.equal(await fingerprint(),lockedBefore); checks+=1;
    }
    // Both scheduling labels use real independent sessions and observed wait,
    // not sleep-based simulated concurrency or retry-masked success.
    for(const direction of ['A-first','B-first']) {
      const release=await holdSQL(`SELECT pg_advisory_xact_lock(hashtextextended('phase4-order|${id}',0));`,
        `S5-LEGACY-${direction}-ROOT-HOLDER`);
      const waiter=sql(`BEGIN; ${claims} SET LOCAL application_name='S5-LEGACY-ROOT-WAITER';
        SELECT ${acquire}; ROLLBACK;`);
      void waiter.catch(()=>{});
      try {
        let waiting=false;
        const deadline=Date.now()+8000;
        while(!waiting && Date.now()<deadline) {
          waiting=await json(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity
            WHERE application_name='S5-LEGACY-ROOT-WAITER' AND wait_event_type='Lock' AND wait_event='advisory'));`);
        }
        assert.equal(waiting,true,'Legacy root waiter must be observed'); checks+=1;
        assert.equal(await json(`SELECT to_jsonb(count(*)) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
          JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE a.application_name='S5-LEGACY-ROOT-WAITER' AND l.granted AND n.nspname='public'
            AND l.mode<>'AccessShareLock';`),0,'root gate precedes Shift/source/FK row acquisition'); checks+=1;
      } finally { await release(); }
      await waiter; assert.equal(await fingerprint(),lockedBefore); checks+=1;
    }
    assert.equal(await json(`SELECT to_jsonb(deadlocks) FROM pg_stat_database WHERE datname=current_database();`),deadlocks,
      'legacy-deadlock-delta'); checks+=1;
    await fails(`${claims} INSERT INTO phase5_private.mutation_contexts DEFAULT VALUES;`,/PHASE5_PREPARATION_ONLY/u);
  } finally {
    await sql(`BEGIN; ${maintenance} UPDATE phase5_private.authority_generation SET generation=0,authority_state='PRIVATE_INACTIVE';
      DELETE FROM phase5_private.activation_receipts; ${restoreBarriers} COMMIT;`);
  }
  assert.equal(await fingerprint(),before,'Legacy acquisition/control restoration is content-sensitive zero-write'); checks+=1;
  passed.push('Legacy canonical acquisition ONLY: exact source/item/global SKU/FK resources, actor-first generation fence, root then shared Shift/Shift row/Order/SKU/resources, NOWAIT row contention in independent sessions, both observed root-wait directions, deadlockDelta0, no context/receipt/executor/source write and generation0 restoration');
};

// PREWRITE Legacy context only; every instrumentation change is transaction
// rollback-only, private and restored. No public guard or completion constraint
// is disabled. Sequence gaps are allowed, not reset or counted as money writes.
const legacyInstrumentation = (claims,migrationHash) => `${claims}
    ALTER TABLE phase5_private.authority_generation DISABLE TRIGGER phase5_preparation_generation_barrier;
    ALTER TABLE phase5_private.activation_receipts DISABLE TRIGGER phase5_preparation_activation_barrier;
    UPDATE phase5_private.authority_generation SET generation=1,authority_state='ACTIVE';
    INSERT INTO phase5_private.activation_receipts VALUES(1,'128',${q(migrationHash)},
      '9A74EB14788EA668BDE88DAC95561AD8DA2F734EC47EAA87491AB0F181E06099',clock_timestamp(),txid_current());
    CREATE OR REPLACE FUNCTION phase5_private.reject_preparation_write_v1()
    RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $probe$
    BEGIN IF TG_TABLE_SCHEMA='phase5_private' AND TG_TABLE_NAME='mutation_contexts'
      AND TG_OP IN ('INSERT','UPDATE') AND NEW.purpose='LEGACY_WEBSITE_COMPLETION' THEN RETURN NEW; END IF;
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_PREPARATION_ONLY'; END $probe$;
    CREATE OR REPLACE FUNCTION phase5_private.guard_collection_control_history_v1()
    RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $probe$
    BEGIN IF TG_TABLE_SCHEMA='phase5_private' AND TG_TABLE_NAME='mutation_contexts' AND TG_OP='UPDATE'
      AND OLD.purpose='LEGACY_WEBSITE_COMPLETION' THEN RETURN NEW; END IF;
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COLLECTION_CONTROL_IMMUTABLE'; END $probe$;`;
const legacyContext = async (claims,args,migrationHash) => {
  const before=await fingerprint();
  const guards=() => json(`SELECT to_jsonb(md5(string_agg(pg_get_functiondef(p.oid),'' ORDER BY p.oid)))
    FROM pg_proc p WHERE p.oid IN ('phase5_private.reject_preparation_write_v1()'::regprocedure,
      'phase5_private.guard_collection_control_history_v1()'::regprocedure);`);
  const guardsBefore=await guards();
  const instrument=legacyInstrumentation(claims,migrationHash);
  const call=`phase5_private.enter_legacy_completion_context_v1(${args})`;
  const assertion='phase5_private.assert_legacy_completion_context_v1((SELECT id FROM legacy_context_probe))';
  const setup=`${instrument} CREATE TEMP TABLE legacy_context_probe AS SELECT ${call} id;`;
  await fails(`${claims} SELECT ${call};`,/55000.*PREPARATION_ONLY/u);
  await fails(`SELECT set_config('request.jwt.claims','{}',false); SELECT ${call};`,/42501.*LEGACY_ACTOR_UNAUTHORIZED/u);
  const sourceQuery=fingerprintQuery.replace(
    "'contexts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM phase5_private.mutation_contexts t),",
    "'contexts',NULL,");
  assert.notEqual(sourceQuery,fingerprintQuery);
  const sourceScalar=`(${sourceQuery.replace(/;$/u,'')})`;
  const orderId=args.split(',')[0];
  for(const [method,amount,reference,receiptRequired] of [
    ['cash',300,null,true],['cliq',300,'LEGACY-CONTEXT',true],['cash',5000,null,false],
    ['debt',0,null,false],['cash',0,null,false],['cash_on_delivery',0,null,false],
  ]) {
    const controlArgs=`${orderId},${q(method)},${amount},NULL,${reference?q(reference):'NULL'},NULL`;
    const result=await json(`BEGIN; ${instrument}
      CREATE TEMP TABLE legacy_business_before AS ${sourceQuery}
      CREATE TEMP TABLE legacy_context_probe AS SELECT phase5_private.enter_legacy_completion_context_v1(${controlArgs}) id;
      SELECT jsonb_build_object('context',${assertion},'noBusinessWrites',
        ${sourceScalar}=(SELECT to_jsonb FROM legacy_business_before)); ROLLBACK;`);
    const c=result.context; const p=c.locked_plan;
    assert.equal(result.noBusinessWrites,true,'legacy-context-no-business-write');
    assert.equal(c.purpose,'LEGACY_WEBSITE_COMPLETION'); assert.equal(c.operation_id,null);
    assert.equal(p.invocationId,c.id); assert.equal(p.model.executionAuthority,false);
    assert.equal(p.model.financial.receiptRequired,receiptRequired);
    assert.equal(p.model.orderFinal.amount_paid_in_minor_units,amount);
    assert.equal(p.model.inventoryDemand.length,1);
    assert.equal(p.model.inventoryDemand[0].movementTuple.quantity,-5);
    assert.equal(p.model.balanceEndpoints[0].after.on_hand_quantity,p.model.balanceEndpoints[0].before.on_hand_quantity-5);
    if(receiptRequired) {
      assert.ok(p.receipt.paymentId && p.receipt.auditId); assert.match(p.receipt.paymentNumber,/^CRV-[0-9]{8}-[0-9]{6,}$/u);
      assert.equal(p.model.receiptTuple.cash_shift_id,p.sourcePlan.commercial.selectedShift.id);
      assert.equal(p.model.receiptTuple.payment_method,method);
      checks+=4;
    } else { assert.equal(p.receipt,null); assert.equal(p.model.receiptTuple,null); checks+=2; }
    checks+=10; assert.equal(await fingerprint(),before,'legacy-context-rollback'); checks+=1;
  }
  // Repeated proof has no writes even to the context; no execution/admission.
  assert.equal(await json(`BEGIN; ${setup} SELECT to_jsonb(${assertion}=${assertion}); ROLLBACK;`),true); checks+=1;
  await fails(`${setup} SET CONSTRAINTS phase5_private.phase5_context_completion IMMEDIATE;`,/55000.*LEGACY_COMPLETION_INCOMPLETE/u);
  const commitFailure=await sql(`BEGIN; ${setup} COMMIT;`,true);
  assert.match(commitFailure.stderr,/55000.*LEGACY_COMPLETION_INCOMPLETE/u); checks+=1;
  // Independent private anchor model: repeated product lines remain TWO
  // identities/tuples. This is a pure multiplicity probe, not a source permit.
  assert.equal(await json(`BEGIN; ${instrument} DO $probe$ DECLARE p jsonb; c jsonb; a jsonb; b jsonb; m jsonb;
    BEGIN p:=phase5_private.lock_legacy_completion_plan_v1(${args}); c:=p->'commercial'; a:=c->'sourceItems'->0;
      b:=a||jsonb_build_object('id',gen_random_uuid());
      c:=c||jsonb_build_object('sourceItems',jsonb_build_array(a,b),'sourceDemand',
        (SELECT jsonb_agg(jsonb_build_object('itemId',s->'id','productId',s->'product_id','quantity',s->'quantity') ORDER BY s->>'id')
          FROM jsonb_array_elements(jsonb_build_array(a,b)) s));
      m:=phase5_private.derive_legacy_completion_model_v1(p||jsonb_build_object('commercial',c),transaction_timestamp());
      IF jsonb_array_length(m->'inventoryDemand')<>2 OR m->'inventoryDemand'->0->>'itemId'=m->'inventoryDemand'->1->>'itemId'
        OR (m->'balanceEndpoints'->0->'before'->>'on_hand_quantity')::bigint-
          (m->'balanceEndpoints'->0->'after'->>'on_hand_quantity')::bigint<>10 THEN
        RAISE EXCEPTION 'legacy-duplicate-item-multiset'; END IF; END $probe$;
      SELECT 'true'::jsonb; ROLLBACK;`),true); checks+=1;
  for(const corruption of [
    'transaction_id=transaction_id+1',`actor_id='92400000-0000-0000-0000-000000000002'`,
    'operation_id=gen_random_uuid()',"request_fingerprint=repeat('A',64)",
    "locked_plan=jsonb_set(locked_plan,'{eventAt}','null')",
    "locked_plan=jsonb_set(locked_plan,'{invocationId}',to_jsonb(gen_random_uuid()))",
    "locked_plan=jsonb_set(locked_plan,'{model,orderFinal,amount_paid_in_minor_units}','999')",
    "locked_plan=jsonb_set(locked_plan,'{model,receiptTuple}','null')",
    "locked_plan=jsonb_set(locked_plan,'{movementSequences}',jsonb_build_object((SELECT key FROM jsonb_object_keys(locked_plan->'movementSequences') key LIMIT 1),NULL))",
    "locked_plan=jsonb_set(locked_plan,'{historyId}',locked_plan->'completionAuditId')",
    "locked_plan=jsonb_set(locked_plan,'{receipt,paymentNumber}','null')",
    "locked_plan=jsonb_set(locked_plan,'{sourcePlan,commercial,sourceOrder,id}',to_jsonb(gen_random_uuid()))",
    "normalized_request=jsonb_set(normalized_request,'{requestedAmountInMinorUnits}','null')",
  ]) {
    await fails(`${setup} UPDATE phase5_private.mutation_contexts SET ${corruption} WHERE id=(SELECT id FROM legacy_context_probe);
      SELECT ${assertion};`,/PHASE5_LEGACY_|PHASE5_WIRE_/u);
    assert.equal(await fingerprint(),before,'context-corrupt rollback'); checks+=1;
    assert.equal(await guards(),guardsBefore); checks+=1;
  }
  for(const role of ['anon','authenticated','service_role']) {
    for(const protectedCall of [call,`phase5_private.assert_legacy_completion_context_v1(${q(randomUUID())})`,
      `phase5_private.complete_legacy_completion_context_v1(${q(randomUUID())})`,
      `phase5_private.derive_legacy_completion_model_v1('{}',now())`]) {
      await fails(`${claims} SET LOCAL ROLE ${role}; SELECT ${protectedCall};`,/permission denied/u);
    }
  }
  assert.equal(await guards(),guardsBefore); assert.equal(await fingerprint(),before); checks+=2;
  // Independently compare the frozen pure expectations to the UNCHANGED real
  // historical public writer in the same rollback-only transaction/clock.
  // This is compatibility proof, NOT a new Legacy executor or deferred success.
  for(const [method,amount,reference] of [['cash',300,null],['cliq',300,'LEGACY-MODEL'],['cash',5000,null],['debt',0,null]]) {
    const controlArgs=`${orderId},${q(method)},${amount},NULL,${reference?q(reference):'NULL'},NULL`;
    const actual=await json(`BEGIN; ${instrument} CREATE TEMP TABLE legacy_context_probe AS
      SELECT phase5_private.enter_legacy_completion_context_v1(${controlArgs}) id;
      SELECT ${assertion};
      SELECT public.complete_website_order_with_settlement(${controlArgs});
      SELECT jsonb_build_object('orderMatches',(SELECT to_jsonb(o) FROM public.orders o WHERE id=${orderId})=
        (SELECT locked_plan->'model'->'orderFinal' FROM phase5_private.mutation_contexts WHERE id=(SELECT id FROM legacy_context_probe)),
        'historyMatches',EXISTS(SELECT 1 FROM public.order_status_history h,phase5_private.mutation_contexts c
          WHERE c.id=(SELECT id FROM legacy_context_probe) AND h.order_id=c.order_id AND h.new_status='completed'
            AND (to_jsonb(h)-'id')=c.locked_plan->'model'->'historyTuple'),
        'balanceMatches',NOT EXISTS(SELECT 1 FROM phase5_private.mutation_contexts c,
          jsonb_array_elements(c.locked_plan->'model'->'balanceEndpoints') e
          LEFT JOIN public.inventory_balances b ON b.id=(e->>'balanceId')::uuid
          WHERE c.id=(SELECT id FROM legacy_context_probe) AND to_jsonb(b) IS DISTINCT FROM e->'after'),
        'fullReceiptAndAuditMatches',NOT EXISTS(SELECT 1 FROM phase5_private.mutation_contexts c,
          jsonb_array_elements(phase5_private.derive_legacy_completion_writes_v1(to_jsonb(c))->'writes') s
          WHERE c.id=(SELECT id FROM legacy_context_probe) AND s->>'action'='INSERT'
            AND s->>'relation' IN ('public.customer_payments','public.audit_logs')
            AND NOT EXISTS(SELECT 1 FROM (
              SELECT to_jsonb(a)-'id' row_data FROM public.audit_logs a
                WHERE s->>'relation'='public.audit_logs' AND (a.entity_id=c.order_id
                  OR a.entity_id IN (SELECT id FROM public.customer_payments WHERE order_id=c.order_id))
              UNION ALL SELECT to_jsonb(p)-'id'-'payment_number' FROM public.customer_payments p
                WHERE s->>'relation'='public.customer_payments' AND p.order_id=c.order_id
            ) actual WHERE actual.row_data=CASE WHEN s->>'relation'='public.customer_payments'
              THEN (s->'after')-'id'-'payment_number' ELSE
                ((s->'after')-'id')||jsonb_build_object('entity_id',CASE WHEN s->'after'->>'entity_name'='customer_payments'
                  THEN (SELECT to_jsonb(id) FROM public.customer_payments WHERE order_id=c.order_id)
                  ELSE to_jsonb(c.order_id) END,
                  'details',(s->'after'->'details')||CASE WHEN s->'after'->'details' ? 'payment_number'
                    THEN jsonb_build_object('payment_number',(SELECT payment_number FROM public.customer_payments WHERE order_id=c.order_id))
                    WHEN s->'after'->'details'->'customer_payment_number'<>'null'::jsonb
                    THEN jsonb_build_object('customer_payment_number',(SELECT payment_number FROM public.customer_payments WHERE order_id=c.order_id))
                    ELSE '{}'::jsonb END) END)),
        'receiptMatches',NOT EXISTS(SELECT 1 FROM public.customer_payments p,phase5_private.mutation_contexts c
          WHERE c.id=(SELECT id FROM legacy_context_probe) AND p.order_id=c.order_id
            AND EXISTS(SELECT 1 FROM jsonb_each(CASE WHEN c.locked_plan->'model'->'receiptTuple'='null'::jsonb
              THEN '{}'::jsonb ELSE c.locked_plan->'model'->'receiptTuple' END) expected
              WHERE to_jsonb(p)->expected.key IS DISTINCT FROM expected.value)));
      ROLLBACK;`);
    assert.deepEqual(actual,{orderMatches:true,historyMatches:true,balanceMatches:true,receiptMatches:true,fullReceiptAndAuditMatches:true}); checks+=5;
    assert.equal(await fingerprint(),before,'real-historical-model-rollback'); checks+=1;
  }
  await legacySourcePermissions(claims,args,instrument);
  await legacyExecutor(claims,args,instrument);
  passed.push('Legacy PREWRITE guard controls: exact source/request/actor/transaction/gates, private invocation not business operation, six historical financial controls, per-item multiplicity/endpoints, generated IDs/sequences, corruption rejection, initial zero business writes, incomplete immediate/deferred COMMIT55000 and role denial. The separately tested executor consumes this initial frozen context; all instrumentation rolls back, sequence gaps allowed, no public activation or historical replay.');
};

// Permission rehearsal only: test-owned DML runs in rollback-only transactions
// under ALL unchanged public triggers. This is not a candidate Legacy executor.
const legacySourcePermissions = async (claims,args,instrument) => {
  const before=await fingerprint();
  const orderId=args.split(',')[0];
  const setup=(method='cash',amount=300,reference=null) => `${instrument}
    CREATE TEMP TABLE legacy_context_probe AS SELECT phase5_private.enter_legacy_completion_context_v1(
      ${orderId},${q(method)},${amount},NULL,${reference?q(reference):'NULL'},NULL) id;
    SELECT phase5_private.assert_legacy_completion_context_v1((SELECT id FROM legacy_context_probe));`;
  const model=`phase5_private.derive_legacy_completion_writes_v1(
    phase5_private.assert_legacy_completion_permit_v1((SELECT id FROM legacy_context_probe)))`;
  // Explicit fixed relation/action dispatch. Do not disable public guards or
  // use replication-role bypass; resulting trigger effects remain authoritative.
  const applyStep=`CASE s->>'relation'
    WHEN 'public.orders' THEN
      UPDATE public.orders SET
        delivery_fee_in_minor_units=(s->'after'->>'delivery_fee_in_minor_units')::bigint,
        total_in_minor_units=(s->'after'->>'total_in_minor_units')::bigint,
        payment_method=s->'after'->>'payment_method',amount_paid_in_minor_units=(s->'after'->>'amount_paid_in_minor_units')::bigint,
        payment_status=s->'after'->>'payment_status',status=s->'after'->>'status',
        payment_reference_number=s->'after'->>'payment_reference_number',
        payment_confirmed_at=(s->'after'->>'payment_confirmed_at')::timestamptz,
        payment_confirmed_by=(s->'after'->>'payment_confirmed_by')::uuid,
        cash_shift_id=(s->'after'->>'cash_shift_id')::uuid,
        delivery_completed_at=(s->'after'->>'delivery_completed_at')::timestamptz
      WHERE id=(s->>'id')::uuid;
    WHEN 'public.inventory_balances' THEN
      UPDATE public.inventory_balances SET on_hand_quantity=(s->'after'->>'on_hand_quantity')::numeric,
        reserved_quantity=(s->'after'->>'reserved_quantity')::numeric WHERE id=(s->>'id')::uuid;
    WHEN 'public.inventory_movements' THEN INSERT INTO public.inventory_movements
      SELECT (jsonb_populate_record(NULL::public.inventory_movements,s->'after')).*;
    WHEN 'public.order_status_history' THEN INSERT INTO public.order_status_history
      SELECT (jsonb_populate_record(NULL::public.order_status_history,s->'after')).*;
    WHEN 'public.audit_logs' THEN INSERT INTO public.audit_logs
      SELECT (jsonb_populate_record(NULL::public.audit_logs,s->'after')).*;
    WHEN 'public.customer_payments' THEN INSERT INTO public.customer_payments
      SELECT (jsonb_populate_record(NULL::public.customer_payments,s->'after')).*;
    ELSE RAISE EXCEPTION 'test relation unsupported'; END CASE;`;
  const rehearse=(limit,after='',corrupt='') => `DO $stage$ DECLARE c uuid; w jsonb; s jsonb; i int:=0;
    BEGIN c:=(SELECT id FROM legacy_context_probe); w:=(${model})->'writes';
      FOR s IN SELECT value FROM jsonb_array_elements(w) LOOP i:=i+1;
        EXIT WHEN i>${limit};
        PERFORM phase5_private.assert_legacy_completion_source_tuple_v1(c,i,s->>'relation',s->>'action',s->'before',s->'after');
        ${applyStep}
        PERFORM phase5_private.assert_legacy_completion_prefix_v1(c,i+1);
      END LOOP;
      ${corrupt}
      ${after}
    END $stage$;`;
  for(const [method,amount,reference,length] of [
    ['cash',300,null,10],['cliq',300,'LEGACY-SOURCE',10],['cash',5000,null,7],['debt',0,null,7],['cash',0,null,7],
  ]) {
    const writes=await json(`BEGIN; ${setup(method,amount,reference)} SELECT ${model}; ROLLBACK;`);
    assert.equal(writes.executionAuthority,false); assert.equal(writes.writes.length,length); checks+=2;
    if(length===10) {
      const payment=writes.writes.find((s) => s.relation==='public.customer_payments').after;
      assert.equal(payment.amount_in_minor_units,300); assert.equal(payment.payment_method,method);
      assert.equal(payment.idempotency_key,null); assert.equal(payment.is_reversed,false);
      assert.equal(payment.reference_number,reference); assert.ok(payment.cash_shift_id); checks+=6;
      assert.ok(writes.writes.findIndex((s) => s.relation==='public.customer_payments')>
        writes.writes.findIndex((s) => s.relation==='public.orders' && s.after.amount_paid_in_minor_units===300)); checks+=1;
    }
    // Every full prefix, not just final cardinality, must match actual triggered
    // rows. Failure after ANY step and final incomplete completion roll back.
    for(let n=0;n<=length;n+=1) {
      assert.equal(await json(`BEGIN; ${setup(method,amount,reference)} ${rehearse(n)}
        SELECT to_jsonb(phase5_private.assert_legacy_completion_prefix_v1((SELECT id FROM legacy_context_probe),${n+1}));
        ROLLBACK;`),true,'legacy-source-prefix'); checks+=1;
      if(n<length) await fails(`${setup(method,amount,reference)} ${rehearse(n)}
        SELECT phase5_private.complete_legacy_completion_context_v1((SELECT id FROM legacy_context_probe));`,
      /55000.*LEGACY_COMPLETION_INCOMPLETE/u);
      else {
        assert.equal(await json(`BEGIN; ${setup(method,amount,reference)} ${rehearse(n)}
          SELECT to_jsonb(phase5_private.complete_legacy_completion_context_v1((SELECT id FROM legacy_context_probe)));
          SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;`),true); checks+=1;
      }
      assert.equal(await fingerprint(),before,'legacy-source-staged-rollback'); checks+=1;
    }
    console.log(`Legacy source-prefix rehearsal verified: ${method}/${amount}; ${length} exact writes; only exact final prefix admits completion.`);
  }
  // Full tuple faults BEFORE write; unchanged fields and NULLs are part of
  // authority. Ordinal cannot skip or repeat a valid earlier source transition.
  for(const mutation of [
    "s:=jsonb_set(s,'{after,total_in_minor_units}','999999')",
    "s:=jsonb_set(s,'{after,id}',to_jsonb(gen_random_uuid()))",
    "s:=jsonb_set(s,'{before,status}','\"completed\"')",
    "s:=jsonb_set(s,'{after,payment_confirmed_by}','null')",
    "s:=jsonb_set(s,'{after,notes}','\"unauthorized\"')",
    "s:=jsonb_set(s,'{action}','\"DELETE\"')",
  ]) await fails(`${setup()} DO $probe$ DECLARE c uuid; s jsonb; BEGIN
    c:=(SELECT id FROM legacy_context_probe); s:=(${model})->'writes'->0; ${mutation};
    PERFORM phase5_private.assert_legacy_completion_source_tuple_v1(c,1,s->>'relation',s->>'action',s->'before',s->'after');
    END $probe$;`,/42501.*LEGACY_SOURCE_TUPLE_INVALID/u);
  for(const ordinal of [0,2,11,12]) await fails(`${setup()} SELECT phase5_private.assert_legacy_completion_prefix_v1(
    (SELECT id FROM legacy_context_probe),${ordinal});`,/42501.*LEGACY_SOURCE_(STEP|PREFIX)_INVALID/u);
  await fails(`${setup()} ${rehearse(1,`PERFORM phase5_private.assert_legacy_completion_prefix_v1(c,1);`)}`,
    /42501.*LEGACY_SOURCE_PREFIX_INVALID/u); // legacy-source-skip-repeat
  // Full receipt fields, before insertion, cannot be caller-chosen or partially
  // accepted even when amount/cardinality match the legitimate payment.
  for(const [field,value] of [
    ['amount_in_minor_units',"'301'"],['customer_id',"'null'"],['order_id',`to_jsonb(gen_random_uuid())`],
    ['cash_shift_id',"'null'"],['created_by',"'null'"],['payment_method',`'"cliq"'::jsonb`],
    ['reference_number',`'"changed"'::jsonb`],['notes',`'"changed"'::jsonb`],
    ['idempotency_key',`'"invented-modern-key"'::jsonb`],['is_reversed',"'true'"],
  ]) await fails(`${setup()} ${rehearse(7,`s:=w->7; s:=jsonb_set(s,ARRAY['after',${q(field)}],${value}::jsonb);
    PERFORM phase5_private.assert_legacy_completion_source_tuple_v1(c,8,s->>'relation',s->>'action',s->'before',s->'after');`)}`,
    /42501.*LEGACY_SOURCE_TUPLE_INVALID/u); // legacy-receipt-full-row
  for(const corruption of [
    `UPDATE public.orders SET internal_notes='changed-source' WHERE id=${orderId};`,
    `UPDATE public.order_items SET quantity=quantity+1 WHERE order_id=${orderId};`,
    `UPDATE public.audit_logs SET details='{}' WHERE entity_name='orders' AND entity_id=${orderId};`,
    `INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id) VALUES(${q(owner)},'EXTRA','orders',${orderId});`,
    `INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id) VALUES(${q(owner)},'EXTRA','wrong_entity_kind',${orderId});`,
    `INSERT INTO public.order_status_history(order_id,old_status,new_status,changed_by) VALUES(${orderId},'ready','ready',${q(owner)});`,
    `DELETE FROM public.order_items WHERE order_id=${orderId};`,
  ]) await fails(`${setup()} ${corruption} SELECT phase5_private.assert_legacy_completion_prefix_v1(
    (SELECT id FROM legacy_context_probe),1);`,/42501.*LEGACY_SOURCE_(PREFIX|SET)_INVALID/u); // legacy-source-extra-row
  // Future IDs must remain absent until their exact insertion step.
  await fails(`${setup()} DO $probe$ DECLARE s jsonb; BEGIN s:=(${model})->'writes'->7;
    INSERT INTO public.customer_payments SELECT (jsonb_populate_record(NULL::public.customer_payments,s->'after')).*;
    END $probe$; SELECT phase5_private.assert_legacy_completion_prefix_v1((SELECT id FROM legacy_context_probe),1);`,
  /42501.*LEGACY_SOURCE_PREFIX_INVALID/u);
  // Removing an already-produced row while preserving a plausible parent is
  // rejected by the live-prefix proof, not adopted as a lower-progress stage.
  await fails(`${setup()} ${rehearse(10,`DELETE FROM public.audit_logs WHERE id=(w->9->>'id')::uuid;
    PERFORM phase5_private.assert_legacy_completion_prefix_v1(c,11);`)}`,
  /42501.*LEGACY_SOURCE_PREFIX_INVALID/u);
  for(const role of ['anon','authenticated','service_role']) {
    for(const call of [
      `phase5_private.assert_legacy_completion_permit_v1(${q(randomUUID())})`,
      "phase5_private.derive_legacy_completion_writes_v1('{}')",
      "phase5_private.read_legacy_completion_source_row_v1('public.orders','00000000-0000-0000-0000-000000000000')",
      `phase5_private.assert_legacy_completion_prefix_v1(${q(randomUUID())},1)`,
      `phase5_private.assert_legacy_completion_source_tuple_v1(${q(randomUUID())},1,'public.orders','UPDATE',NULL,'{}')`,
    ]) await fails(`${claims} SET LOCAL ROLE ${role}; SELECT ${call};`,/permission denied/u); // legacy-source-role-denial
  }
  assert.equal(await fingerprint(),before,'legacy-source-staged-rollback'); checks+=1;
  passed.push('Legacy frozen receipt/source permissions: exact full typed receipts/history/audits/movements, per-item balance chain, every staged prefix under unchanged public triggers, tuple/NULL/value/identity/set faults and three-role denials. Every incomplete prefix rejects55000; only the exact final prefix admits deferred INITIAL proof. No public activation or modern Legacy evidence.');
};

// Candidate execution, unlike the test-owned permission rehearsal above.
// All private activation instrumentation is rollback-only; public guards remain.
const legacyExecutor = async (claims,args,instrument,expectedQuantities=[5]) => {
  const before=await fingerprint(); const orderId=args.split(',')[0];
  const operationCount=await json('SELECT to_jsonb(count(*)) FROM phase5_private.financial_operation_events;');
  const setup=(method='cash',amount=300,reference=null) => `${instrument}
    CREATE TEMP TABLE legacy_context_probe AS SELECT phase5_private.enter_legacy_completion_context_v1(
      ${orderId},${q(method)},${amount},NULL,${reference?q(reference):'NULL'},NULL) id;`;
  const c='(SELECT id FROM legacy_context_probe)';
  const run=`phase5_private.execute_legacy_completion_prelocked_v1(${c})`;
  const complete=`phase5_private.complete_legacy_completion_context_v1(${c})`;
  const total=expectedQuantities.reduce((sum,quantity) => sum+quantity,0)*1000;
  const length=2*expectedQuantities.length+8;
  // Compare ORIGINAL public result on a separate rollback transaction, mapping
  // only independently generated receipt numbers. All other fields equal.
  for(const [method,amount,reference] of [['cash',300,null],['cliq',300,'LEGACY-EXECUTOR'],
    ['cash',total,null],['cliq',total,'LEGACY-FULL'],['debt',0,null],['cash',0,null]]) {
    const publicResult=await json(`BEGIN; ${claims} SELECT public.complete_website_order_with_settlement(
      ${orderId},${q(method)},${amount},NULL,${reference?q(reference):'NULL'},NULL); ROLLBACK;`);
    const outcome=await json(`BEGIN; ${setup(method,amount,reference)}
      CREATE TEMP TABLE legacy_result AS SELECT ${run} result;
      SET CONSTRAINTS ALL IMMEDIATE;
      SELECT jsonb_build_object('result',(SELECT result FROM legacy_result),
        'complete',${complete},'repeat',${complete},
        'movements',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.inventory_movements t WHERE reference_id=${orderId}),
        'sourceItems',(SELECT jsonb_agg(jsonb_build_object('id',id,'quantity',quantity) ORDER BY id) FROM public.order_items WHERE order_id=${orderId}),
        'frozen',(SELECT locked_plan FROM phase5_private.mutation_contexts WHERE id=${c}),
        'modern',(SELECT count(*) FROM phase5_private.collection_events WHERE order_id=${orderId}),
        'operationCount',(SELECT count(*) FROM phase5_private.financial_operation_events),
        'operation',(SELECT operation_id FROM public.orders WHERE id=${orderId})); ROLLBACK;`);
    const expected={...publicResult,customer_payment_number:outcome.result.customer_payment_number};
    assert.deepEqual(outcome.result,expected,'legacy-executor-result-compatibility'); checks+=1;
    assert.equal(outcome.complete,true); assert.equal(outcome.repeat,true);
    assert.equal(outcome.operation,null); assert.equal(outcome.modern,0);
    assert.equal(outcome.operationCount,operationCount); checks+=5;
    assert.deepEqual(outcome.sourceItems.map((item) => item.quantity).sort((a,b)=>a-b),
      [...expectedQuantities].sort((a,b)=>a-b)); checks+=1;
    assert.equal(outcome.movements.length,expectedQuantities.length); checks+=1;
    // Per frozen item identity; aggregate totals cannot substitute a movement.
    let running=outcome.frozen.model.balanceEndpoints[0].before.on_hand_quantity;
    for(const item of outcome.sourceItems) {
      const movement=outcome.movements.find((row)=>row.id===outcome.frozen.movementIds[item.id]);
      assert.ok(movement); assert.equal(movement.product_id,product);
      assert.equal(movement.quantity,-item.quantity); assert.equal(movement.balance_before,running);
      running-=item.quantity; assert.equal(movement.balance_after,running); checks+=5;
    }
    assert.equal(running,outcome.frozen.model.balanceEndpoints[0].after.on_hand_quantity); checks+=1;
    assert.equal(await fingerprint(),before,'legacy-executor-exact-final rollback'); checks+=1;
  }
  // Failure AFTER EVERY candidate write, including the last. Trigger injection
  // is transaction-local disposable test DDL, not disabled public protection.
  for(let stop=1;stop<=length;stop+=1) {
    const fault=`CREATE TEMP TABLE legacy_fault_count(n int); INSERT INTO legacy_fault_count VALUES(0);
      CREATE FUNCTION pg_temp.legacy_write_fault() RETURNS trigger LANGUAGE plpgsql AS $fault$
      DECLARE counter int; BEGIN UPDATE pg_temp.legacy_fault_count SET n=n+1 RETURNING n INTO counter;
        IF counter=${stop} THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='LEGACY_AFTER_WRITE_FAULT'; END IF;
        RETURN NULL; END $fault$;
      ${['orders','inventory_balances','inventory_movements','order_status_history','audit_logs','customer_payments']
        .map((table)=>`CREATE TRIGGER zz_legacy_fault AFTER INSERT OR UPDATE ON public.${table}
          FOR EACH STATEMENT EXECUTE FUNCTION pg_temp.legacy_write_fault();`).join('\n')}`;
    await fails(`${setup()} ${fault} SELECT ${run};`,/P0001.*LEGACY_AFTER_WRITE_FAULT/u);
    assert.equal(await fingerprint(),before,'legacy-executor-after-every-write'); checks+=1;
  }
  for(const corruption of [
    `UPDATE public.orders SET internal_notes='invalid-final' WHERE id=${orderId};`,
    `DELETE FROM public.inventory_movements WHERE id=(SELECT (locked_plan->'movementIds'->>key)::uuid
      FROM phase5_private.mutation_contexts,jsonb_object_keys(locked_plan->'movementIds') key WHERE id=${c} LIMIT 1);`,
    `UPDATE public.inventory_movements SET balance_after=balance_after+1 WHERE reference_id=${orderId};`,
    `INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id) VALUES(${q(owner)},'EXTRA','wrong-kind',${orderId});`,
    `DELETE FROM public.customer_payments WHERE order_id=${orderId};`,
  ]) {
    await fails(`${setup()} SELECT ${run}; ${corruption} SET CONSTRAINTS ALL IMMEDIATE;`,
      /55000.*LEGACY_COMPLETION_INCOMPLETE/u);
    assert.equal(await fingerprint(),before,'legacy-executor-deferred-corruption'); checks+=1;
  }
  await fails(`${setup()} SELECT phase5_private.record_legacy_completion_payment_prelocked_v1(${c},${q(randomUUID())});`,
    /42501.*LEGACY_RECEIPT_IDENTITY_INVALID/u);
  await fails(`${setup()} SELECT ${run}; SELECT ${run};`,/LEGACY_CONTEXT_CHANGED_RETRY|LEGACY_SOURCE_INVALID/u);
  if(expectedQuantities.length>1) {
    await fails(`${setup()} SELECT ${run}; DO $fault$ DECLARE frozen jsonb; a public.inventory_movements%ROWTYPE; b uuid;
      BEGIN SELECT locked_plan INTO frozen FROM phase5_private.mutation_contexts WHERE id=${c};
        SELECT * INTO STRICT a FROM public.inventory_movements WHERE id=(SELECT value::uuid
          FROM jsonb_each_text(frozen->'movementIds') ORDER BY key LIMIT 1);
        SELECT value::uuid INTO b FROM jsonb_each_text(frozen->'movementIds') ORDER BY key OFFSET 1 LIMIT 1;
        DELETE FROM public.inventory_movements WHERE id=b;
        a.id:=gen_random_uuid(); a.mutation_sequence:=nextval('public.inventory_movement_mutation_seq');
        INSERT INTO public.inventory_movements SELECT a.*;
      END $fault$; SET CONSTRAINTS ALL IMMEDIATE;`,/55000.*LEGACY_COMPLETION_INCOMPLETE/u);
    assert.equal(await fingerprint(),before,'legacy-executor-repeated-SKU substitution rollback'); checks+=1;
  }
  for(const role of ['anon','authenticated','service_role']) for(const call of [run,complete,
    `phase5_private.assert_legacy_completion_payment_v1(${c})`,
    `phase5_private.record_legacy_completion_payment_prelocked_v1(${c},${q(randomUUID())})`]) {
    await fails(`${claims} SET LOCAL ROLE ${role}; SELECT ${call.replaceAll(c,q(randomUUID()))};`,/permission denied/u);
  }
  assert.equal(await fingerprint(),before); checks+=1;
  passed.push(`Legacy private INITIAL executor: ${expectedQuantities.length} real historical items (${expectedQuantities.join(',')}); per-item generated identities and full triggered balance chains; six public-result compatibility controls; failure after every write, deferred corruption, double-execution and three-role denial; rollback-only exact full-state restoration. No committed historical replay or public activation.`);
};

// Real COMMIT/races of the PRIVATE executor, in this disposable full schema only.
// Private instrumentation is visible to the independent test connections;
// public function bodies, guards and grants are never replaced or disabled.
const legacyCommittedRuntime = async (claims,migrationHash,createReady,createRepeated,branchId) => {
  const guardQuery=`SELECT jsonb_agg(pg_get_functiondef(p.oid) ORDER BY p.oid)
    FROM pg_proc p WHERE p.oid IN ('phase5_private.reject_preparation_write_v1()'::regprocedure,
      'phase5_private.guard_collection_control_history_v1()'::regprocedure);`;
  const guardsBefore=await json(guardQuery);
  const publicBefore=await json(`SELECT to_jsonb(md5(string_agg(pg_get_functiondef(p.oid),'' ORDER BY p.oid)))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f';`);
  const maintenance=`ALTER TABLE phase5_private.authority_generation DISABLE TRIGGER phase5_preparation_generation_barrier;
    ALTER TABLE phase5_private.activation_receipts DISABLE TRIGGER phase5_preparation_activation_barrier;`;
  const restoreBarriers=`ALTER TABLE phase5_private.authority_generation ENABLE TRIGGER phase5_preparation_generation_barrier;
    ALTER TABLE phase5_private.activation_receipts ENABLE TRIGGER phase5_preparation_activation_barrier;`;
  const setup=(id,method='cash') => `${claims} CREATE TEMP TABLE legacy_commit_context AS SELECT
    phase5_private.enter_legacy_completion_context_v1(${q(id)},${q(method)},300,NULL,
      ${method==='cliq'?q('LEGACY-COMMITTED-CLIQ'):'NULL'},NULL) id;`;
  const run='phase5_private.execute_legacy_completion_prelocked_v1((SELECT id FROM legacy_commit_context))';
  const prepared=(id,method='cash') => `${setup(id,method)} CREATE TEMP TABLE legacy_commit_result AS SELECT ${run} result;`;
  const stateQuery=(id) => `SELECT jsonb_build_object(
    'order',(SELECT to_jsonb(t) FROM public.orders t WHERE id=${q(id)}),
    'items',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.order_items t WHERE order_id=${q(id)}),
    'movements',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.inventory_movements t WHERE reference_id=${q(id)}),
    'payments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.customer_payments t WHERE order_id=${q(id)}),
    'context',(SELECT to_jsonb(t) FROM phase5_private.mutation_contexts t WHERE order_id=${q(id)}),
    'modern',(SELECT count(*) FROM phase5_private.collection_events WHERE order_id=${q(id)}));`;
  const proveCommitted=async (id,method,quantities) => {
    const state=await json(stateQuery(id)); const frozen=state.context.locked_plan;
    assert.equal(state.order.status,'completed'); assert.equal(state.order.operation_id,null);
    assert.equal(state.order.amount_paid_in_minor_units,300); assert.equal(state.modern,0);
    assert.equal(state.payments.length,1); assert.equal(state.payments[0].id,frozen.receipt.paymentId);
    assert.equal(state.payments[0].payment_method,method); assert.equal(state.payments[0].amount_in_minor_units,300);
    assert.equal(state.payments[0].created_by,owner); checks+=9;
    assert.deepEqual(state.items.map(n=>n.quantity).sort((a,b)=>a-b),quantities);
    assert.equal(state.movements.length,state.items.length); checks+=2;
    let running=frozen.model.balanceEndpoints[0].before.on_hand_quantity;
    for(const item of state.items) {
      const movement=state.movements.find(n=>n.id===frozen.movementIds[item.id]);
      assert.ok(movement); assert.equal(movement.product_id,item.product_id);
      assert.equal(movement.warehouse_id,state.order.warehouse_id);
      assert.equal(movement.quantity,-item.quantity); assert.equal(movement.balance_before,running);
      running-=item.quantity; assert.equal(movement.balance_after,running); checks+=6;
    }
    assert.equal(running,frozen.model.balanceEndpoints[0].after.on_hand_quantity); checks+=1;
    const before=await fingerprint();
    // No idempotency identity exists in this historical signature. Reject a
    // second completion, never manufacture success replay from a receipt.
    await fails(`${setup(id,method)} SELECT ${run};`,/23514.*LEGACY_SOURCE_INVALID/u);
    assert.equal(await fingerprint(),before,'legacy-committed-second-attempt-zero-write'); checks+=1;
    await fails(`${claims} SELECT phase5_private.complete_legacy_completion_context_v1(${q(state.context.id)});`,
      /42501.*LEGACY_CONTEXT_INVALID/u); // transaction identity cannot be reused
    assert.equal(await fingerprint(),before); checks+=1;
  };
  const waitForLock=async (name,event) => {
    const deadline=Date.now()+8000; let waiting=false;
    while(!waiting && Date.now()<deadline) waiting=await json(`SELECT to_jsonb(EXISTS(SELECT 1
      FROM pg_stat_activity WHERE application_name=${q(name)} AND wait_event_type='Lock'
        ${event?`AND wait_event=${q(event)}`:''}));`);
    assert.equal(waiting,true,`${name}: actual DB wait required`); checks+=1;
  };
  const deadlocksBefore=await json('SELECT to_jsonb(deadlocks) FROM pg_stat_database WHERE datname=current_database();');
  await sql(`BEGIN; ${legacyInstrumentation(claims,migrationHash)} ${restoreBarriers} COMMIT;`);
  try {
    // Legitimate actual deferred COMMIT (not SET CONSTRAINTS followed by rollback).
    for(const [method,create,quantities] of [['cash',createReady,[5]],['cliq',createRepeated,[5,5]]]) {
      const id=await create();
      const result=await json(`BEGIN; ${prepared(id,method)} SELECT result FROM legacy_commit_result; COMMIT;`);
      assert.equal(result.success,true); assert.equal(result.amount_paid_in_minor_units,300);
      assert.equal(result.remaining_in_minor_units,quantities.reduce((a,b)=>a+b,0)*1000-300); checks+=3;
      await proveCommitted(id,method,quantities);
      console.log(`Legacy actual deferred COMMIT verified: ${method}; ${quantities.length} historical source items.`);
    }
    // A caught source failure leaves the prewrite context behind. Deferred
    // COMMIT must still reject; catching the error cannot commit partial state.
    const failedId=await createReady();
    for(const stop of [1,10]) {
      const before=await fingerprint();
      const fault=`CREATE TEMP TABLE legacy_caught_count(n int); INSERT INTO legacy_caught_count VALUES(0);
        CREATE FUNCTION pg_temp.legacy_caught_fault() RETURNS trigger LANGUAGE plpgsql AS $fault$
        DECLARE counter int; BEGIN UPDATE pg_temp.legacy_caught_count SET n=n+1 RETURNING n INTO counter;
          IF counter=${stop} THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='LEGACY_CAUGHT_WRITE_FAULT'; END IF;
          RETURN NULL; END $fault$;
        ${['orders','inventory_balances','inventory_movements','order_status_history','audit_logs','customer_payments']
          .map(table=>`CREATE TRIGGER zz_legacy_caught AFTER INSERT OR UPDATE ON public.${table}
            FOR EACH STATEMENT EXECUTE FUNCTION pg_temp.legacy_caught_fault();`).join('\n')}`;
      const rejected=await sql(`BEGIN; ${setup(failedId)} ${fault}
        DO $caught$ BEGIN BEGIN PERFORM ${run}; RAISE EXCEPTION 'QA_EXPECTED_SOURCE_FAILURE';
          EXCEPTION WHEN SQLSTATE 'P0001' THEN
            IF SQLERRM<>'LEGACY_CAUGHT_WRITE_FAULT' THEN RAISE; END IF; END;
          PERFORM phase5_private.assert_legacy_completion_context_v1((SELECT id FROM legacy_commit_context));
        END $caught$; COMMIT;`,true);
      assert.match(rejected.stderr,/55000.*LEGACY_COMPLETION_INCOMPLETE/u);
      assert.equal(await fingerprint(),before,'legacy-caught-failure-deferred-COMMIT'); checks+=2;
    }
    // Hold the ACTUAL fully-written winner before COMMIT, then observe the
    // independently executing loser blocked on the same canonical root gate.
    for(const direction of ['A-wins','B-wins']) {
      const id=await createReady(); const name=`S5-LEGACY-COMMIT-${direction}-LOSER`;
      const winnerMethod=direction==='A-wins'?'cash':'cliq';
      const loserMethod=direction==='A-wins'?'cliq':'cash';
      const finish=await holdSQL(`${prepared(id,winnerMethod)} SET CONSTRAINTS ALL IMMEDIATE;
        SELECT 'LEGACY-WINNER-FINGERPRINT|'||(${fingerprintQuery.replace(/;$/u,'')})::text;`,
        `S5-LEGACY-COMMIT-${direction}-WINNER`);
      const loser=sql(`BEGIN; SET LOCAL application_name=${q(name)}; ${prepared(id,loserMethod)} COMMIT;`,true);
      void loser.catch(()=>{}); let winnerOutput;
      try { await waitForLock(name,'advisory'); }
      finally { winnerOutput=await finish('COMMIT'); }
      const rejected=await loser;
      assert.match(rejected.stderr,/23514.*LEGACY_SOURCE_INVALID|40001.*LEGACY_RESOURCES_CHANGED_RETRY/u);
      assert.doesNotMatch(rejected.stderr,/40P01|57014/u); checks+=2;
      const expected=JSON.parse(winnerOutput.split(/\r?\n/u).find(n=>n.startsWith('LEGACY-WINNER-FINGERPRINT|')).split('|')[1]);
      assert.equal(await fingerprint(),expected,'legacy-race-loser-zero-partial-content'); checks+=1;
      await proveCommitted(id,winnerMethod,[5]);
      console.log(`Legacy same-root operational race verified: ${direction}; ${winnerMethod} committed; loser zero partial writes.`);
    }
    // Actual Shift-close boundary, both directions; this is not a simulated
    // lock-only holder. Close-first rejects before writes, completion-first
    // closes only after the committed receipt is visible to the real report.
    for(const direction of ['completion-first','close-first']) {
      for(const id of await json(`SELECT coalesce(jsonb_agg(id),'[]') FROM public.cash_shifts
        WHERE branch_id=${q(branchId)} AND status='open';`)) {
        const summary=await json(`${claims} SELECT public.get_cash_shift_summary(${q(id)});`);
        await json(`${claims} SELECT public.close_cash_shift(${q(id)},${summary.expectedCashInMinorUnits},NULL);`);
      }
      const opened=await json(`${claims} SELECT public.open_cash_shift(${q(branchId)},0);`);
      assert.equal(opened.success,true); checks+=1;
      const id=await createReady();
      const shift=(await json(`${claims} SELECT phase5_private.discover_legacy_completion_plan_v1(
        ${q(id)},'cash',300,NULL,NULL,NULL);`)).selectedShift.id;
      if(direction==='completion-first') {
        const finish=await holdSQL(`${prepared(id)} SET CONSTRAINTS ALL IMMEDIATE;`,'S5-LEGACY-SHIFT-WINNER');
        const closer=sql(`BEGIN; SET LOCAL application_name='S5-LEGACY-CLOSE-WAITER'; ${claims}
          SELECT public.close_cash_shift(${q(shift)},300,NULL); COMMIT;`);
        void closer.catch(()=>{});
        try { await waitForLock('S5-LEGACY-CLOSE-WAITER'); } finally { await finish('COMMIT'); }
        const closed=JSON.parse((await closer).stdout.trim().split(/\r?\n/u).at(-1));
        assert.equal(closed.success,true); checks+=1; await proveCommitted(id,'cash',[5]);
        const summary=await json(`${claims} SELECT public.get_cash_shift_summary(${q(shift)});`);
        assert.equal(summary.expectedCashInMinorUnits,300); checks+=1;
      } else {
        const finish=await holdSQL(`${claims} SELECT public.close_cash_shift(${q(shift)},0,NULL);
          SELECT 'LEGACY-CLOSE-FINGERPRINT|'||(${fingerprintQuery.replace(/;$/u,'')})::text;`,'S5-LEGACY-CLOSED-WINNER');
        let rejected;
        try { rejected=await sql(`BEGIN; ${prepared(id)} COMMIT;`,true); }
        finally {
          const output=await finish('COMMIT');
          const expected=JSON.parse(output.split(/\r?\n/u).find(n=>n.startsWith('LEGACY-CLOSE-FINGERPRINT|')).split('|')[1]);
          assert.equal(await fingerprint(),expected,'legacy-close-first-loser-zero-partial'); checks+=1;
        }
        assert.match(rejected.stderr,/40001.*LEGACY_CONTENTION_RETRY/u);
        assert.doesNotMatch(rejected.stderr,/40P01|57014/u); checks+=2;
        assert.equal((await json(stateQuery(id))).order.status,'ready'); checks+=1;
      }
      console.log(`Legacy actual completion/Shift-close race verified: ${direction}.`);
    }
    const closeBranchShifts=async () => {
      for(const shift of await json(`SELECT coalesce(jsonb_agg(id),'[]') FROM public.cash_shifts
        WHERE branch_id=${q(branchId)} AND status='open';`)) {
        const summary=await json(`${claims} SELECT public.get_cash_shift_summary(${q(shift)});`);
        assert.equal((await json(`${claims} SELECT public.close_cash_shift(
          ${q(shift)},${summary.expectedCashInMinorUnits},NULL);`)).success,true); checks+=1;
      }
    };
    const freshShift=async () => {
      await closeBranchShifts();
      assert.equal((await json(`${claims} SELECT public.open_cash_shift(${q(branchId)},0);`)).success,true); checks+=1;
      return json(`SELECT to_jsonb(id) FROM public.cash_shifts WHERE branch_id=${q(branchId)} AND status='open';`);
    };
    const markedFingerprint=(output,marker) => JSON.parse(output.split(/\r?\n/u)
      .find(line=>line.startsWith(`${marker}|`)).slice(marker.length+1));
    const mark=(marker) => `SELECT '${marker}|'||(${fingerprintQuery.replace(/;$/u,'')})::text;`;
    const payment=(id,method) => `public.record_customer_order_payment(${q(id)},200,${q(method)},
      ${method==='cliq'?q('LEGACY-INTERSECTION-CLIQ'):'NULL'},'Slice5 isolated intersection')`;
    const provePayment=async (id,result,method,paid) => {
      assert.equal(result.success,true); assert.equal(result.order_id,id); checks+=2;
      const state=await json(stateQuery(id));
      assert.equal(state.order.amount_paid_in_minor_units,paid);
      const receipt=state.payments.find(row=>row.id===result.payment_id);
      assert.ok(receipt); assert.equal(receipt.order_id,id); assert.equal(receipt.created_by,owner);
      assert.equal(receipt.amount_in_minor_units,200); assert.equal(receipt.payment_method,method); checks+=6;
      assert.equal(state.movements.length,1); assert.equal(state.movements[0].quantity,-5); checks+=2;
      return state;
    };
    // Current PUBLIC full-Shift control, not the future explicit-tender Phase5
    // batch. Seed one genuinely supported expense so reversal is not an empty
    // Shift shortcut. Legacy completion introduces new membership; frozen
    // discovery must reject rather than acquiring newly discovered late locks.
    for(const direction of ['completion-first','reversal-first']) {
      const shift=await freshShift(); const id=await createReady();
      const expense=await json(`${claims} SELECT public.create_operational_expense(
        ${q(branchId)},'Slice5','Isolated full-Shift control',100,'cash',NULL);`);
      assert.equal(expense.success,true); checks+=1;
      const preview=await json(`${claims} SELECT public.preview_cash_shift_full_reversal(${q(shift)});`);
      assert.equal(preview.canExecute,true);
      assert.deepEqual(preview.operations.map(row=>[row.operationType,row.originalRecordId]),
        [['operational_expense',expense.expenseId]]); checks+=2;
      const reverse=`public.reverse_cash_shift_with_operations(${q(shift)},'Slice5 isolated reversal',${q(randomUUID())})`;
      if(direction==='completion-first') {
        const finish=await holdSQL(`${prepared(id)} SET CONSTRAINTS ALL IMMEDIATE;
          ${mark('LEGACY-FULL-SHIFT-WINNER')}`,'S5-LEGACY-FULL-SHIFT-COMPLETION');
        const loser=sql(`BEGIN; SET LOCAL application_name='S5-LEGACY-FULL-SHIFT-REVERSE-WAITER';
          ${claims} SELECT ${reverse}; COMMIT;`,true);
        void loser.catch(()=>{}); let output;
        try { await waitForLock('S5-LEGACY-FULL-SHIFT-REVERSE-WAITER','advisory'); }
        finally { output=await finish('COMMIT'); }
        const rejected=await loser;
        assert.match(rejected.stderr,/40001.*PHASE4_LOCK_PLAN_CHANGED_RETRY/u);
        assert.doesNotMatch(rejected.stderr,/40P01|57014|55P03/u); checks+=2;
        assert.equal(await fingerprint(),markedFingerprint(output,'LEGACY-FULL-SHIFT-WINNER'),
          'legacy-full-shift-reversal-loser-zero-partial-content'); checks+=1;
        await proveCommitted(id,'cash',[5]);
        assert.equal(await json(`SELECT to_jsonb(count(*)) FROM public.cash_shift_reversals WHERE shift_id=${q(shift)};`),0); checks+=1;
      } else {
        const finish=await holdSQL(`${claims} CREATE TEMP TABLE legacy_shift_result AS SELECT ${reverse} result;
          SELECT 'LEGACY-FULL-SHIFT-RESULT|'||result::text FROM legacy_shift_result;
          ${mark('LEGACY-FULL-SHIFT-WINNER')}`,'S5-LEGACY-FULL-SHIFT-REVERSED');
        const loser=sql(`BEGIN; SET LOCAL application_name='S5-LEGACY-FULL-SHIFT-COMPLETION-WAITER';
          ${prepared(id)} COMMIT;`,true);
        void loser.catch(()=>{}); let output;
        try { await waitForLock('S5-LEGACY-FULL-SHIFT-COMPLETION-WAITER','advisory'); }
        finally { output=await finish('COMMIT'); }
        const rejected=await loser;
        // The real reversal committed the Shift to reversed. Rediscovery
        // therefore rejects the exact historical open-Shift prerequisite,
        // rather than returning a generic changed-plan retry.
        assert.match(rejected.stderr,/23514.*PHASE4_OPEN_SHIFT_REQUIRED/u);
        assert.doesNotMatch(rejected.stderr,/40P01|57014|55P03/u); checks+=2;
        assert.equal(await fingerprint(),markedFingerprint(output,'LEGACY-FULL-SHIFT-WINNER'),
          'legacy-completion-full-shift-loser-zero-partial-content'); checks+=1;
        const result=markedFingerprint(output,'LEGACY-FULL-SHIFT-RESULT');
        assert.equal(result.success,true); assert.equal(result.shiftId,shift); checks+=2;
        const state=await json(stateQuery(id));
        assert.equal(state.order.status,'ready'); assert.equal(state.context,null);
        assert.equal(state.payments,null); assert.equal(state.movements,null); checks+=4;
        const durable=await json(`SELECT jsonb_build_object('shift',(SELECT to_jsonb(t) FROM public.cash_shifts t WHERE id=${q(shift)}),
          'reversal',(SELECT to_jsonb(t) FROM public.cash_shift_reversals t WHERE shift_id=${q(shift)}),
          'operations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.cash_shift_reversal_operations t WHERE shift_id=${q(shift)}),
          'expense',(SELECT to_jsonb(t) FROM public.operational_expenses t WHERE id=${q(expense.expenseId)}));`);
        assert.equal(durable.shift.status,'reversed'); assert.equal(durable.reversal.status,'completed');
        assert.equal(durable.operations.length,1); assert.equal(durable.operations[0].original_record_id,expense.expenseId);
        assert.equal(durable.operations[0].operation_type,'operational_expense');
        assert.equal(durable.operations[0].reversal_id,durable.reversal.id);
        assert.equal(durable.expense.is_reversed,true); checks+=7;
        assert.equal(durable.reversal.actual_effect.cash_in_minor_units,100);
        for(const field of ['cliq_in_minor_units','customer_balance_in_minor_units','inventory_base_units_delta']) {
          assert.equal(durable.reversal.actual_effect[field],0); checks+=1;
        }
        assert.equal(durable.expense.amount_in_minor_units,100);
        assert.equal(durable.expense.payment_method,'cash'); assert.equal(durable.expense.reversed_by,owner);
        assert.equal(durable.operations[0].status,'reversed'); checks+=5;
      }
      console.log(`Legacy/current PUBLIC full-Shift intersection verified: ${direction}; membership retry/open-Shift rejection; zero loser footprint.`);
    }
    // A same-root payment cannot precede historical Completion. Once the
    // actual completion commits, the waiting current public payment is a
    // legitimate distinct receipt, not replay or duplicated initial collection.
    for(const method of ['cash','cliq']) {
      await freshShift(); const id=await createReady(); const before=await fingerprint();
      await fails(`${claims} SELECT ${payment(id,method)};`,/P0001.*يمكن تسجيل الدفعة على طلب مكتمل فقط/u);
      assert.equal(await fingerprint(),before,'legacy-ready-payment-zero-write'); checks+=1;
      const finish=await holdSQL(`${prepared(id)} SET CONSTRAINTS ALL IMMEDIATE;`,'S5-LEGACY-SAME-ROOT-COMPLETION');
      const waiter=sql(`BEGIN; SET LOCAL application_name='S5-LEGACY-SAME-ROOT-PAYMENT';
        ${claims} SELECT ${payment(id,method)}; COMMIT;`);
      void waiter.catch(()=>{});
      try { await waitForLock('S5-LEGACY-SAME-ROOT-PAYMENT','advisory'); } finally { await finish('COMMIT'); }
      const result=JSON.parse((await waiter).stdout.trim().split(/\r?\n/u).at(-1));
      const state=await provePayment(id,result,method,500);
      assert.equal(state.payments.length,2);
      const initial=state.payments.find(row=>row.id===state.context.locked_plan.receipt.paymentId);
      assert.ok(initial); assert.equal(initial.amount_in_minor_units,300); assert.notEqual(initial.id,result.payment_id);
      assert.equal(state.modern,0); checks+=5;
      console.log(`Legacy same-root completion/current payment verified: ${method}; exact distinct300+200 receipts.`);
    }
    // Different root Orders share an actual Shift. Payment-first does not
    // acquire the private shared advisory gate, so NOWAIT Shift-row acquisition
    // must roll back the candidate before any source write. Completion-first
    // lets the real public payer wait safely and commit on its own sale.
    for(const direction of ['completion-first','payment-first']) {
      const other=await createReady();
      assert.equal((await json(`${claims} SELECT public.complete_website_order_with_settlement(
        ${q(other)},'debt',0,NULL,NULL,NULL);`)).success,true); checks+=1;
      const shift=await freshShift(); const id=await createReady();
      const method=direction==='completion-first'?'cliq':'cash'; let result;
      if(direction==='completion-first') {
        const finish=await holdSQL(`${prepared(id)} SET CONSTRAINTS ALL IMMEDIATE;`,'S5-LEGACY-CROSS-SALE-COMPLETION');
        const waiter=sql(`BEGIN; SET LOCAL application_name='S5-LEGACY-CROSS-SALE-PAYMENT-WAITER';
          ${claims} SELECT ${payment(other,method)}; COMMIT;`);
        void waiter.catch(()=>{});
        try { await waitForLock('S5-LEGACY-CROSS-SALE-PAYMENT-WAITER'); } finally { await finish('COMMIT'); }
        result=JSON.parse((await waiter).stdout.trim().split(/\r?\n/u).at(-1));
        await proveCommitted(id,'cash',[5]);
      } else {
        const finish=await holdSQL(`${claims} CREATE TEMP TABLE legacy_payment_result AS SELECT ${payment(other,method)} result;
          SELECT 'LEGACY-CROSS-SALE-RESULT|'||result::text FROM legacy_payment_result;
          ${mark('LEGACY-CROSS-SALE-WINNER')}`,'S5-LEGACY-CROSS-SALE-PAYMENT');
        let rejected; let output;
        try { rejected=await sql(`BEGIN; ${prepared(id)} COMMIT;`,true); }
        finally { output=await finish('COMMIT'); }
        assert.match(rejected.stderr,/40001.*LEGACY_CONTENTION_RETRY/u);
        assert.doesNotMatch(rejected.stderr,/40P01|57014|55P03/u); checks+=2;
        assert.equal(await fingerprint(),markedFingerprint(output,'LEGACY-CROSS-SALE-WINNER'),
          'legacy-cross-sale-payment-loser-zero-partial-content'); checks+=1;
        result=markedFingerprint(output,'LEGACY-CROSS-SALE-RESULT');
        const state=await json(stateQuery(id));
        assert.equal(state.order.status,'ready'); assert.equal(state.context,null);
        assert.equal(state.payments,null); assert.equal(state.movements,null); checks+=4;
      }
      const state=await provePayment(other,result,method,200);
      assert.equal(state.payments.length,1); assert.equal(state.payments[0].cash_shift_id,shift);
      assert.equal(state.context,null); assert.equal(state.modern,0); checks+=4;
      console.log(`Legacy/current cross-sale payment intersection verified: ${direction}; per-sale identities preserved.`);
    }
    await closeBranchShifts();
    const deadlocksAfter=await json('SELECT to_jsonb(deadlocks) FROM pg_stat_database WHERE datname=current_database();');
    assert.equal(deadlocksAfter-deadlocksBefore,0,'legacy-operational-deadlockDelta'); checks+=1;
  } finally {
    await sql(`BEGIN; ${maintenance} UPDATE phase5_private.authority_generation SET generation=0,authority_state='PRIVATE_INACTIVE';
      DELETE FROM phase5_private.activation_receipts; ${restoreBarriers} ${guardsBefore.map(def=>`${def};`).join('\n')} COMMIT;`);
  }
  assert.deepEqual(await json(guardQuery),guardsBefore); checks+=1;
  assert.equal(await json(`SELECT to_jsonb(md5(string_agg(pg_get_functiondef(p.oid),'' ORDER BY p.oid)))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f';`),publicBefore); checks+=1;
  // Leave a normal open historical Shift for the unchanged remaining controls.
  assert.equal((await json(`${claims} SELECT public.open_cash_shift(${q(branchId)},0);`)).success,true); checks+=1;
  await fails(`${claims} SELECT phase5_private.enter_legacy_completion_context_v1(
    ${q(await createReady())},'cash',300,NULL,NULL,NULL);`,/55000.*PREPARATION_ONLY/u);
  passed.push('Legacy PRIVATE committed-state runtime: real Cash and repeated-SKU CliQ deferred COMMIT, separate-connection exact per-item receipt/movement proof, second completion rejects/no fabricated historical replay, caught first/last-write failures reject deferred COMMIT with full rollback, same-root completion A/B directions, actual Shift-close both directions, current public full-Shift membership-change races both directions with a supported expense, same-root Cash/CliQ post-completion distinct payment and premature payment rejection, cross-sale current payment both directions with per-sale exact identity/loser full-content zero footprint, measured deadlockDelta0; all private barriers/generation0 and public definitions restored. Not public activation, future explicit-tender full-Shift batch or all-writer concurrency sign-off.');
};

// Permanent rollback-only source-binding matrix. It runs in the complete
// default suite too; the focused flag is not a whole-candidate certification.
const shiftInstructionRuntime = async (claims) => {
  const fixtureBranch=randomUUID(); const fixtureWarehouse=randomUUID();
  const customerId=randomUUID();
  const setupFor=(quantity=1,cliqAmount=300,cashAmount=200) => `${claims}
    INSERT INTO public.branches(id,code,name_ar,is_active)
      VALUES(${q(fixtureBranch)},${q('S5-'+fixtureBranch)},'Private instruction fixture',true);
    INSERT INTO public.warehouses(id,branch_id,code,name_ar,is_active)
      VALUES(${q(fixtureWarehouse)},${q(fixtureBranch)},${q('S5-'+fixtureWarehouse)},'Private instruction warehouse',true);
    INSERT INTO public.inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity)
      VALUES(${q(fixtureWarehouse)},${q(product)},100,0);
    INSERT INTO public.customers(id,full_name,phone,credit_limit_in_minor_units)
      VALUES(${q(customerId)},'Instruction customer','0792223333',100000);
    CREATE TEMP TABLE qa_shift_instruction_state(instructions jsonb,shift_id uuid,order_id uuid,
      baseline jsonb,advisory_count bigint);
    DO $fixture$ DECLARE sale jsonb; result jsonb; p public.customer_payments%ROWTYPE;
      a jsonb; s uuid; instructions jsonb:='[]'::jsonb; method text;
    BEGIN
      result:=public.open_cash_shift(${q(fixtureBranch)},0);
      SELECT id INTO STRICT s FROM public.cash_shifts WHERE branch_id=${q(fixtureBranch)} AND status='open';
      sale:=public.create_pos_sale_v2(${q(fixtureWarehouse)},${q(fixtureBranch)},${q(customerId)}::uuid,
        'Instruction fixture','debt',${j([{commercial_line_kind:'base_unit',product_id:product,
          base_quantity:quantity,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,${1000*quantity},${q(randomUUID())});
      FOR method IN SELECT unnest(ARRAY['cliq','cash']) LOOP
        result:=public.record_customer_order_payment((sale->>'orderId')::uuid,
          CASE WHEN method='cliq' THEN ${cliqAmount} ELSE ${cashAmount} END,method,
          CASE WHEN method='cliq' THEN 'SOURCE-CLIQ' END,'Instruction source');
        SELECT * INTO STRICT p FROM public.customer_payments WHERE payment_number=result->>'payment_number';
        a:=phase5_private.anchor_existing_collection_v1(${q(owner)},p.order_id,p.id,gen_random_uuid()::text);
        instructions:=instructions||jsonb_build_array(jsonb_build_object('originalPaymentId',p.id,
          'originalCollectionId',a->>'collectionEventId','orderId',p.order_id,'idempotencyKey',gen_random_uuid()::text,
          'actualTenderMethod',CASE WHEN method='cliq' THEN 'cash' ELSE 'cliq' END,
          'tenderReference',CASE WHEN method='cash' THEN 'ACTUAL-CLIQ-REVERSAL' END,
          'executionShiftId',CASE WHEN method='cliq' THEN s END));
      END LOOP;
      INSERT INTO qa_shift_instruction_state(instructions,shift_id,order_id) VALUES(instructions,s,(sale->>'orderId')::uuid);
    END; $fixture$;`;
  const setup=setupFor();
  const expr=fingerprintQuery.trim().replace(/;$/u,'');
  const request='(SELECT instructions FROM qa_shift_instruction_state)';
  const shift='(SELECT shift_id FROM qa_shift_instruction_state)';
  const discover=(input=request,actor=q(owner),target=shift) =>
    `phase5_private.discover_shift_payment_instructions_v1(${actor},${target},${input})`;
  const frozen=`CREATE TEMP TABLE qa_shift_frozen AS SELECT ${discover()} AS plan;
    UPDATE qa_shift_instruction_state SET baseline=(${expr}),
      advisory_count=(SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory');`;
  const globalBefore=await fingerprint();
  const clean=await json(`BEGIN; ${setup} ${frozen}
    SELECT jsonb_build_object('plan',${discover()},'same',${discover()}=(SELECT plan FROM qa_shift_frozen),
      'fingerprintSame',(${expr})=(SELECT baseline FROM qa_shift_instruction_state),
      'locksSame',(SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory')=
        (SELECT advisory_count FROM qa_shift_instruction_state)); ROLLBACK;`);
  assert.equal(clean.same,true); assert.equal(clean.fingerprintSame,true); assert.equal(clean.locksSame,true);
  assert.equal(clean.plan.completeFor,'CUSTOMER_PAYMENT_SOURCE_BINDING_ONLY');
  assert.equal(clean.plan.planState,'DISCOVERED_NOT_LOCKED'); assert.equal(clean.plan.children.length,2);
  assert.deepEqual(clean.plan.children.map((n) => n.payment.amount_in_minor_units).sort((a,b) => a-b),[200,300]);
  for(const child of clean.plan.children) {
    assert.notEqual(child.instruction.actualTenderMethod,child.payment.payment_method);
    assert.equal(child.instruction.originalPaymentId,child.payment.id);
    assert.equal(child.instruction.originalCollectionId,child.collection.id);
    assert.equal(child.order.id,child.payment.order_id);
    assert.equal(child.instruction.actualTenderMethod==='cash',child.executionShift!==null);
    assert.equal(child.position.collectionCoverageInMinorUnits,500); checks+=6;
  }
  assert.equal(await fingerprint(),globalBefore); checks+=9;
  passed.push('shift-instruction-explicit-cross-tender; shift-instruction-read-only: real POS/receipts/126 anchors, no source fabrication, content fingerprint and advisory count unchanged');
  const instructions=clean.plan.children.map((n) => n.instruction);
  for(const invalid of [undefined,null,{},true,0]) {
    await fails(`SELECT phase5_private.assert_shift_payment_instructions_v1(${invalid===undefined?'NULL':j(invalid)});`,/22023.*SHIFT_INSTRUCTIONS_INVALID/u);
  }
  for(const field of Object.keys(instructions[0])) {
    const missing={...instructions[0]}; delete missing[field];
    await fails(`SELECT phase5_private.assert_shift_payment_instructions_v1(${j([missing,instructions[1]])});`,/22023.*WIRE_KEYS_INVALID/u);
  }
  for(const change of [{actualTenderMethod:null},{actualTenderMethod:'card'},{actualTenderMethod:1},
    {idempotencyKey:null},{idempotencyKey:' '},{idempotencyKey:' key'},
    {originalPaymentId:null},{originalCollectionId:null},{orderId:null},
    {actualTenderMethod:'cash',executionShiftId:null},
    {actualTenderMethod:'cliq',executionShiftId:randomUUID(),tenderReference:'REF'},
    {actualTenderMethod:'cliq',executionShiftId:null,tenderReference:null},
    {tenderReference:123},{tenderReference:' '},{tenderReference:'x'.repeat(121)}]) {
    await fails(`SELECT phase5_private.assert_shift_payment_instructions_v1(${j([{...instructions[0],...change},instructions[1]])});`,/22023.*(?:SHIFT_INSTRUCTIONS_INVALID|WIRE_UUID_INVALID)/u);
  }
  for(const field of ['originalPaymentId','originalCollectionId','idempotencyKey']) {
    await fails(`SELECT phase5_private.assert_shift_payment_instructions_v1(${j([instructions[0],
      {...instructions[1],[field]:instructions[0][field]}])});`,/22023.*SHIFT_INSTRUCTIONS_DUPLICATE_IDENTITY/u);
  }
  const reject=async (input,pattern,extra='',actor=q(owner),target=shift) => {
    await fails(`${setup} ${extra} SELECT ${discover(input,actor,target)};`,pattern);
    assert.equal(await fingerprint(),globalBefore); checks+=1;
  };
  await reject(`(${request}-0)`,/23514.*SHIFT_PAYMENT_EXACT_SET_REQUIRED/u);
  await reject(`(${request}||jsonb_build_array((${request}->0)||jsonb_build_object('originalPaymentId',${q(randomUUID())},
    'originalCollectionId',${q(randomUUID())},'idempotencyKey',${q(randomUUID())})))`,/23514.*SHIFT_PAYMENT_EXACT_SET_REQUIRED/u);
  for(const field of ['orderId','originalCollectionId']) {
    await reject(`jsonb_set(${request},'{0,${field}}',to_jsonb(${q(randomUUID())}::text))`,/23514.*SHIFT_PAYMENT_SOURCE_INVALID/u);
  }
  await reject(`jsonb_set(${request},'{0,executionShiftId}',to_jsonb(${q(randomUUID())}::text))`,/23514.*SHIFT_PAYMENT_SOURCE_INCOMPLETE/u);
  passed.push('shift-instruction-exact-set: missing/extra/duplicate identities and wrong Order/collection/execution Shift reject with full rollback');
  const driftCases=[`UPDATE public.orders SET internal_notes='Changed content' WHERE id=(SELECT order_id FROM qa_shift_instruction_state);`,
    `UPDATE public.cash_shifts SET opening_cash_in_minor_units=1 WHERE id=${shift};`,
    `UPDATE public.customer_payments SET notes='Changed receipt' WHERE id=(${request}->0->>'originalPaymentId')::uuid;`];
  for(const mutation of driftCases) {
    await fails(`${setup} ${frozen} ${mutation}
      SELECT phase5_private.assert_shift_payment_instructions_unchanged_v1(${q(owner)},${shift},${request},
        (SELECT plan FROM qa_shift_frozen));`,/40001.*SHIFT_INSTRUCTIONS_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),globalBefore); checks+=1;
  }
  const reverse=await json(`BEGIN; ${setup} SELECT ${discover(`(SELECT jsonb_agg(n ORDER BY ordinal DESC)
    FROM qa_shift_instruction_state, jsonb_array_elements(instructions) WITH ORDINALITY AS a(n,ordinal))`)};
    ROLLBACK;`);
  // Fresh fixtures have generated identities, so order invariance is proved
  // within the SAME fixture, not by comparing unrelated creation attempts.
  assert.equal(reverse.children.length,2); checks+=1;
  assert.equal(await json(`BEGIN; ${setup} SELECT to_jsonb(${discover()}=${discover(`(SELECT jsonb_agg(n ORDER BY ordinal DESC)
    FROM qa_shift_instruction_state, jsonb_array_elements(instructions) WITH ORDINALITY AS a(n,ordinal))`)}); ROLLBACK;`),true); checks+=1;
  passed.push('shift-instruction-source-drift: content-sensitive Order/Shift/receipt revalidation and deterministic instruction ordering');
  const union=`phase5_private.discover_shift_payment_union_v1(${q(owner)},${shift},${request})`;
  const unionClean=await json(`BEGIN; ${setup} ${frozen}
    SELECT jsonb_build_object('plan',${union},'fingerprintSame',(${expr})=(SELECT baseline FROM qa_shift_instruction_state),
      'locksSame',(SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory')=
        (SELECT advisory_count FROM qa_shift_instruction_state)); ROLLBACK;`);
  assert.equal(unionClean.fingerprintSame,true); assert.equal(unionClean.locksSame,true); checks+=2;
  const unionPlan=unionClean.plan;
  assert.equal(unionPlan.completeFor,'CUSTOMER_PAYMENT_REVERSAL_CHILDREN_ONLY');
  assert.equal(unionPlan.planState,'DISCOVERED_UNION_NOT_LOCKED');
  assert.deepEqual(unionPlan.capacities,[{orderId:unionPlan.orders[0].row.id,fullReversalAmountInMinorUnits:'500',
    coverageBeforeInMinorUnits:'500',candidateCoverageInMinorUnits:'0',settledDebtReductionInMinorUnits:'0',
    settledMoneyRefundInMinorUnits:'0',candidateOutstandingInMinorUnits:'1000',candidateCollectedDeliveryInMinorUnits:'0'}]); checks+=3;
  assert.equal(unionPlan.orders.length,1); assert.equal(unionPlan.shifts.length,1);
  assert.equal(unionPlan.shifts[0].mode,'UPDATE');
  assert.deepEqual(unionPlan.rootGates,[`phase4-order|${unionPlan.orders[0].row.id}`]);
  assert.deepEqual(unionPlan.keyGates,[...unionPlan.keyGates].sort());
  assert.equal(unionPlan.keyGates.length,6);
  assert.equal(new Set(unionPlan.resources.map((n) => `${n.relation}:${n.id}`)).size,unionPlan.resources.length);
  assert.equal(unionPlan.resources.filter((n) => n.relation==='public.customer_payments').length,2);
  assert.ok(unionPlan.resources.filter((n) => n.relation==='public.customer_payments').every((n) => n.mode==='UPDATE'));
  for(const relation of ['public.profiles','public.customers','public.branches','public.warehouses','public.products']) {
    assert.ok(unionPlan.parents.some((n) => n.relation===relation),relation); checks+=1;
  }
  assert.ok(unionPlan.actorRoles.some((n) => n.role.code==='owner')); checks+=10;
  assert.equal(await json(`BEGIN; ${setup} SELECT to_jsonb(${union}=phase5_private.discover_shift_payment_union_v1(
    ${q(owner)},${shift},(SELECT jsonb_agg(n ORDER BY ordinal DESC) FROM qa_shift_instruction_state,
      jsonb_array_elements(instructions) WITH ORDINALITY AS a(n,ordinal)))); ROLLBACK;`),true); checks+=1;
  passed.push('shift-payment-union-resources: per-identity sorted keys/roots/shared Shift, strongest Shift mode, complete payment/evidence rows and typed FK parents; partial child domain only, no acquisition/write authority');
  const addAnotherSale=`DO $other$ DECLARE sale jsonb; result jsonb; p public.customer_payments%ROWTYPE; a jsonb;
    BEGIN sale:=public.create_pos_sale_v2(${q(fixtureWarehouse)},${q(fixtureBranch)},${q(customerId)},
      'Second independent sale','debt',${j([{commercial_line_kind:'base_unit',product_id:product,
        base_quantity:1,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,1000,${q(randomUUID())});
      result:=public.record_customer_order_payment((sale->>'orderId')::uuid,100,'cliq','SECOND-CLIQ',NULL);
      SELECT * INTO STRICT p FROM public.customer_payments WHERE payment_number=result->>'payment_number';
      a:=phase5_private.anchor_existing_collection_v1(${q(owner)},p.order_id,p.id,gen_random_uuid()::text);
      UPDATE qa_shift_instruction_state SET instructions=instructions||jsonb_build_array(jsonb_build_object(
        'originalPaymentId',p.id,'originalCollectionId',a->>'collectionEventId','orderId',p.order_id,
        'idempotencyKey',gen_random_uuid()::text,'actualTenderMethod','cliq','tenderReference','SECOND-REVERSAL','executionShiftId',NULL));
    END; $other$;`;
  const multiple=await json(`BEGIN; ${setup} ${addAnotherSale} SELECT ${union}; ROLLBACK;`);
  assert.equal(multiple.orders.length,2); assert.equal(multiple.keyGates.length,9);
  assert.equal(multiple.sharedGates.length,3);
  assert.deepEqual(multiple.rootGates,multiple.orders.map((n) => `phase4-order|${n.row.id}`).sort());
  assert.deepEqual(multiple.capacities.map((n) => n.fullReversalAmountInMinorUnits).sort(),['100','500']);
  assert.ok(multiple.capacities.every((n) => n.candidateCoverageInMinorUnits==='0' && n.candidateOutstandingInMinorUnits==='1000'));
  assert.equal(multiple.resources.filter((n) => n.relation==='public.customer_payments').length,3);
  for(const order of multiple.orders) {
    const children=multiple.sourcePlan.children.filter((n) => n.order.id===order.row.id);
    assert.ok(children.every((n) => n.payment.order_id===order.row.id && n.source.orderId===order.row.id)); checks+=1;
  }
  assert.equal(await fingerprint(),globalBefore); checks+=8;
  await fails(`${setup} ${addAnotherSale} CREATE TEMP TABLE qa_multi AS SELECT ${union} AS plan;
    SELECT phase5_private.derive_payment_reversal_candidate_v1(
      (SELECT n->'facts' FROM qa_multi,jsonb_array_elements(plan->'sourcePlan'->'children') n
        WHERE n->'payment'->>'amount_in_minor_units'='100'),
      (SELECT jsonb_build_array(n->'source') FROM qa_multi,jsonb_array_elements(plan->'sourcePlan'->'children') n
        WHERE n->'payment'->>'amount_in_minor_units'='300'));`,/23514.*REVERSAL_CANDIDATE_SOURCE_INVALID/u);
  const historicalSource=`DO $historical$ DECLARE summary jsonb; result jsonb; s uuid;
    p public.customer_payments%ROWTYPE; a jsonb;
    BEGIN summary:=public.get_cash_shift_summary(${shift});
      result:=public.close_cash_shift(${shift},(summary->>'expectedCashInMinorUnits')::bigint,NULL);
      result:=public.open_cash_shift(${q(fixtureBranch)},0);
      SELECT id INTO STRICT s FROM public.cash_shifts WHERE branch_id=${q(fixtureBranch)} AND status='open';
      result:=public.record_customer_order_payment((SELECT order_id FROM qa_shift_instruction_state),100,'cliq','LATER-CLIQ',NULL);
      SELECT * INTO STRICT p FROM public.customer_payments WHERE payment_number=result->>'payment_number';
      a:=phase5_private.anchor_existing_collection_v1(${q(owner)},p.order_id,p.id,gen_random_uuid()::text);
      UPDATE qa_shift_instruction_state SET shift_id=s,instructions=jsonb_build_array(jsonb_build_object(
        'originalPaymentId',p.id,'originalCollectionId',a->>'collectionEventId','orderId',p.order_id,
        'idempotencyKey',gen_random_uuid()::text,'actualTenderMethod','cash','tenderReference',NULL,'executionShiftId',s));
    END; $historical$;`;
  const historical=await json(`BEGIN; ${setup} ${historicalSource} SELECT ${union}; ROLLBACK;`);
  assert.equal(historical.shifts.length,2);
  assert.equal(historical.shifts.find((n) => n.row.status==='closed').mode,'KEY_SHARE');
  assert.equal(historical.shifts.find((n) => n.row.status==='open').mode,'UPDATE');
  assert.equal(historical.resources.filter((n) => n.relation==='public.customer_payments').length,3);
  assert.equal(historical.capacities[0].coverageBeforeInMinorUnits,'600');
  assert.equal(historical.capacities[0].candidateCoverageInMinorUnits,'500');
  assert.equal(historical.capacities[0].fullReversalAmountInMinorUnits,'100');
  assert.equal(historical.sourcePlan.children[0].instruction.actualTenderMethod,'cash');
  assert.equal(historical.sourcePlan.children[0].payment.payment_method,'cliq');
  assert.equal(await fingerprint(),globalBefore); checks+=10;
  passed.push('shift-payment-union-multiple-roots-and-historical-Shift: independent per-sale capacity/source tuples, cross-sale substitution rejection, real public Shift close/new open, historical KEY_SHARE versus selected current UPDATE merged before acquisition');
  for(const mutation of [`UPDATE public.profiles SET full_name='Changed parent' WHERE id=${q(owner)};`,
    `UPDATE public.products SET min_stock_level=min_stock_level+1 WHERE id=${q(product)};`,
    `UPDATE public.warehouses SET name_ar='Changed warehouse' WHERE id=${q(fixtureWarehouse)};`]) {
    await fails(`${setup} CREATE TEMP TABLE qa_union_frozen AS SELECT ${union} AS plan; ${mutation}
      SELECT phase5_private.assert_shift_payment_union_unchanged_v1(${q(owner)},${shift},${request},(SELECT plan FROM qa_union_frozen));`,
    /40001.*SHIFT_UNION_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),globalBefore); checks+=1;
  }
  await fails(`${setup} UPDATE qa_shift_instruction_state SET instructions=jsonb_set(instructions,'{0,idempotencyKey}',
    (SELECT to_jsonb(idempotency_key) FROM phase5_private.financial_operation_events
      WHERE actor_scope_id=${q(owner)} AND request_identity_snapshot->>'orderId'=(SELECT order_id::text FROM qa_shift_instruction_state) LIMIT 1));
    SELECT ${union};`,/23505.*SHIFT_CHILD_KEY_ALREADY_OWNED/u);
  assert.equal(await fingerprint(),globalBefore); checks+=1;
  passed.push('shift-payment-union-drift: full profile/product/warehouse content drift and existing actor/key ownership reject without lasting fixture/business writes');
  // Independent arithmetic anchors: total2000, collected1600, Return1000
  // => debt reduction400/refund600. Each exact payment900/700 alone is safe;
  // the joint1600 reversal is unsafe. Never patch Return financial evidence.
  const jointReversal=`${setupFor(2,900,700)}
    SELECT public.settle_sales_return_v1((SELECT order_id FROM qa_shift_instruction_state),${q(randomUUID())},
      (SELECT jsonb_build_array(jsonb_build_object('return_scope','base_unit','order_item_id',id,
        'quantity',1,'stock_disposition','damaged')) FROM public.order_items
        WHERE order_id=(SELECT order_id FROM qa_shift_instruction_state)),
      'Joint candidate capacity fixture','cliq','S5-JOINT-RETURN',NULL);
    CREATE TEMP TABLE qa_joint_plan AS SELECT ${discover()} AS plan;`;
  const individual=await json(`BEGIN; ${jointReversal}
    SELECT jsonb_agg(phase5_private.derive_payment_reversal_candidate_v1(n->'facts',jsonb_build_array(n->'source'))
      ORDER BY n->'payment'->>'amount_in_minor_units') FROM qa_joint_plan,jsonb_array_elements(plan->'children') n;
    ROLLBACK;`);
  assert.deepEqual(individual.map((n) => n.fullReversalAmountInMinorUnits),['700','900']);
  assert.deepEqual(individual.map((n) => n.candidateCoverageInMinorUnits),['900','700']);
  assert.ok(individual.every((n) => n.settledDebtReductionInMinorUnits==='400' && n.settledMoneyRefundInMinorUnits==='600'));
  await fails(`${jointReversal} SELECT ${union};`,/23514.*REVERSAL_CANDIDATE_CAPACITY_EXCEEDED/u);
  assert.equal(await fingerprint(),globalBefore); checks+=4;
  await fails(`${jointReversal} SELECT phase5_private.derive_payment_reversal_candidate_v1(
    (SELECT n->'facts' FROM qa_joint_plan,jsonb_array_elements(plan->'children') n LIMIT 1),
    (SELECT jsonb_build_array(n->'source',n->'source') FROM qa_joint_plan,jsonb_array_elements(plan->'children') n LIMIT 1));`,
  /23514.*REVERSAL_CANDIDATE_IDENTITY_INVALID/u);
  await fails(`${jointReversal} SELECT phase5_private.derive_payment_reversal_candidate_v1(
    (SELECT n->'facts' FROM qa_joint_plan,jsonb_array_elements(plan->'children') n LIMIT 1),
    (SELECT jsonb_build_array(jsonb_set(n->'source','{amountInMinorUnits}','1'::jsonb))
      FROM qa_joint_plan,jsonb_array_elements(plan->'children') n LIMIT 1));`,/23514.*REVERSAL_CANDIDATE_SOURCE_INVALID/u);
  passed.push('shift-payment-union-capacity: real public Return settlement in rollback-owned fixture, full exact900/700 payments individually valid but jointly rejected; duplicate/altered source tuples rejected, debt/refund/delivery arithmetic retained');
  const supplierId=randomUUID();
  const receivingLine={client_line_id:randomUUID(),purchase_order_item_id:null,line_kind:'base_unit',
    family_product_id:null,parcel_configuration_id:null,configuration_revision:null,commercial_quantity:2,
    units_per_parcel:null,base_unit_name:'باكيت',parcel_unit_name:null,gross_amount_in_minor_units:300,
    line_discount_in_minor_units:0,components:[{product_id:product,base_quantity:2,explicit_merchandise_cost_in_minor_units:null}]};
  const retainedWithSources=`${setup}
    INSERT INTO public.suppliers(id,company_name,is_active) VALUES(${q(supplierId)},'Retained real supplier',true);
    SELECT public.create_direct_supplier_receipt_v2(p_supplier_id:=${q(supplierId)},
      p_warehouse_id:=${q(fixtureWarehouse)},p_branch_id:=${q(fixtureBranch)},
      p_amount_paid_at_receipt_in_minor_units:=100,p_payment_method:='cash',
      p_idempotency_key:=${q(randomUUID())},p_lines:=${j([receivingLine])});
    SELECT public.create_operational_expense(${q(fixtureBranch)},'transport','Retained source expense',50,'cash',NULL);
    CREATE TEMP TABLE qa_retained_po AS SELECT public.create_purchase_order_v2(
      p_supplier_id:=${q(supplierId)},p_branch_id:=${q(fixtureBranch)},p_warehouse_id:=${q(fixtureWarehouse)},
      p_idempotency_key:=${q(randomUUID())},p_lines:=${j([{...receivingLine,client_line_id:randomUUID()}])}) AS result;
    UPDATE public.purchase_orders SET status='approved',approved_by=${q(owner)},approved_at=NOW()
      WHERE id=(SELECT (result->>'purchase_order_id')::uuid FROM qa_retained_po);
    SELECT public.record_supplier_payment(p_supplier_id:=${q(supplierId)},
      p_purchase_order_id:=(SELECT (result->>'purchase_order_id')::uuid FROM qa_retained_po),
      p_amount_in_minor_units:=60,p_payment_method:='cliq',p_reference_number:='RETAINED-PO-60',
      p_idempotency_key:=${q(randomUUID())});`;
  const retained=`phase5_private.discover_shift_retained_resources_v1(${q(owner)},${shift})`;
  const retainedFrozen=`CREATE TEMP TABLE qa_retained_frozen AS SELECT ${retained} AS plan;
    UPDATE qa_shift_instruction_state SET baseline=(${expr}),advisory_count=
      (SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory');`;
  const retainedClean=await json(`BEGIN; ${retainedWithSources} ${retainedFrozen}
    SELECT jsonb_build_object('plan',${retained},'same',${retained}=(SELECT plan FROM qa_retained_frozen),
      'contentSame',(${expr})=(SELECT baseline FROM qa_shift_instruction_state),'locksSame',
      (SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory')=
        (SELECT advisory_count FROM qa_shift_instruction_state)); ROLLBACK;`);
  assert.equal(retainedClean.same,true); assert.equal(retainedClean.contentSame,true); assert.equal(retainedClean.locksSame,true);
  assert.equal(retainedClean.plan.executionAuthority,false);
  assert.equal(retainedClean.plan.completeFor,'RETAINED_SOURCE_RESOURCE_SNAPSHOT_ONLY');
  const rr=retainedClean.plan.resources;
  assert.deepEqual(rr.filter((n)=>n.relation==='public.supplier_payments').map((n)=>n.row.amount_in_minor_units).sort((a,b)=>a-b),[60,100]);
  assert.deepEqual(rr.filter((n)=>n.relation==='public.operational_expenses').map((n)=>n.row.amount_in_minor_units),[50]);
  for(const relation of ['public.orders','public.order_items','public.supplier_receipts','public.supplier_receipt_items',
    'public.supplier_receipt_commercial_lines','public.purchase_orders','public.purchase_order_items',
    'public.inventory_balances','public.inventory_movements']) {
    assert.ok(rr.some((n)=>n.relation===relation),relation); checks+=1;
  }
  assert.ok(rr.filter((n)=>n.relation==='public.inventory_balances').length>1,'all SKU warehouses retained');
  assert.ok(retainedClean.plan.parents.some((n)=>n.relation==='public.suppliers' && n.id===supplierId && n.mode==='UPDATE'));
  assert.equal(retainedClean.plan.sharedGates.filter((n)=>n.startsWith('supplier-payment-reversal:')).length,2);
  assert.equal(new Set(rr.map((n)=>`${n.relation}:${n.id}`)).size,rr.length);
  assert.equal(await fingerprint(),globalBefore); checks+=11;
  passed.push('shift-retained-real-sources: actual public POS/payment/direct receipt/PO payment/expense source paths; exact full rows, SKU all-warehouse balances/chronology, supplier context/gates and read-only fingerprints');
  for(const mutation of [
    `UPDATE public.suppliers SET company_name='Retained content drift' WHERE id=${q(supplierId)};`,
    `UPDATE public.operational_expenses SET description='Retained content drift' WHERE shift_id=${shift};`,
    `UPDATE public.purchase_orders SET notes='Retained content drift' WHERE id=(SELECT (result->>'purchase_order_id')::uuid FROM qa_retained_po);`,
    `UPDATE public.inventory_balances SET reserved_quantity=reserved_quantity+1 WHERE warehouse_id=${q(warehouse)} AND product_id=${q(product)};`,
    `SELECT public.create_operational_expense(${q(fixtureBranch)},'transport','Late member',1,'cash',NULL);`]) {
    await fails(`${retainedWithSources} ${retainedFrozen} ${mutation}
      SELECT phase5_private.assert_shift_retained_resources_unchanged_v1(${q(owner)},${shift},(SELECT plan FROM qa_retained_frozen));`,
    /40001.*SHIFT_RETAINED_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),globalBefore); checks+=1;
  }
  const crossShift=await json(`BEGIN; ${retainedWithSources}
    SELECT public.close_cash_shift(${shift},(public.get_cash_shift_summary(${shift})->>'expectedCashInMinorUnits')::bigint,NULL);
    SELECT public.open_cash_shift(${q(fixtureBranch)},0);
    SELECT public.record_supplier_payment(p_supplier_id:=${q(supplierId)},
      p_purchase_order_id:=(SELECT (result->>'purchase_order_id')::uuid FROM qa_retained_po),
      p_amount_in_minor_units:=40,p_payment_method:='cliq',p_reference_number:='RETAINED-PO-40',p_idempotency_key:=${q(randomUUID())});
    SELECT ${retained}; ROLLBACK;`);
  assert.deepEqual(crossShift.resources.filter((n)=>n.relation==='public.supplier_payments')
    .map((n)=>n.row.amount_in_minor_units).sort((a,b)=>a-b),[40,60,100]);
  assert.equal(crossShift.parents.filter((n)=>n.relation==='public.cash_shifts').length,2);
  assert.ok(crossShift.parents.filter((n)=>n.relation==='public.cash_shifts').every((n)=>n.mode==='UPDATE'));
  assert.equal(crossShift.sharedGates.filter((n)=>n.startsWith('cash-shift-full-reversal:')).length,2);
  assert.equal(crossShift.sharedGates.filter((n)=>n.startsWith('supplier-payment-reversal:')).length,2);
  assert.equal(await fingerprint(),globalBefore); checks+=6;
  passed.push('shift-retained-content-drift: full supplier/expense/PO/other-warehouse content and late membership rejection; real closed/current Shift supplier payments share one document and retain both strongest existing Shift domains');
  const merged=`phase5_private.discover_shift_merged_resources_v1(${q(owner)},${shift},${request})`;
  const mergedFrozen=`CREATE TEMP TABLE qa_merged_frozen AS SELECT ${merged} AS plan;
    UPDATE qa_shift_instruction_state SET baseline=(${expr}),advisory_count=
      (SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory');`;
  const mergedClean=await json(`BEGIN; ${retainedWithSources} ${mergedFrozen}
    SELECT jsonb_build_object('plan',${merged},'same',${merged}=(SELECT plan FROM qa_merged_frozen),
      'contentSame',(${expr})=(SELECT baseline FROM qa_shift_instruction_state),'locksSame',
      (SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory')=
        (SELECT advisory_count FROM qa_shift_instruction_state)); ROLLBACK;`);
  assert.equal(mergedClean.same,true); assert.equal(mergedClean.contentSame,true); assert.equal(mergedClean.locksSame,true);
  const mp=mergedClean.plan;
  assert.equal(mp.executionAuthority,false); assert.equal(mp.futureBatchChildIdentityComplete,false);
  assert.equal(mp.completeFor,'MERGED_SOURCE_RESOURCES_ONLY');
  const resourceIdentity=(n)=>`${n.relation}:${n.id}`;
  const sourceRows=[...mp.paymentPlan.resources,...mp.paymentPlan.parents,
    ...mp.paymentPlan.orders.map(n=>({relation:'public.orders',id:n.row.id,row:n.row,mode:n.mode})),
    ...mp.paymentPlan.shifts.map(n=>({relation:'public.cash_shifts',id:n.row.id,row:n.row,mode:n.mode})),
    ...mp.retainedPlan.resources,...mp.retainedPlan.parents];
  const modes=['KEY_SHARE','SHARE','NO_KEY_UPDATE','UPDATE'];
  const expectedByIdentity=new Map();
  for(const r of sourceRows) {
    const prior=expectedByIdentity.get(resourceIdentity(r));
    if(prior) { assert.deepEqual(r.row,prior.row); if(modes.indexOf(r.mode)>modes.indexOf(prior.mode)) prior.mode=r.mode; }
    else expectedByIdentity.set(resourceIdentity(r),{row:r.row,mode:r.mode});
  }
  assert.equal(mp.resources.length,expectedByIdentity.size);
  assert.equal(new Set(mp.resources.map(resourceIdentity)).size,mp.resources.length);
  for(const r of mp.resources) assert.deepEqual({row:r.row,mode:r.mode},expectedByIdentity.get(resourceIdentity(r)));
  assert.deepEqual(mp.rootGates,[...new Set([...mp.paymentPlan.rootGates,...mp.retainedPlan.rootGates])].sort());
  assert.deepEqual(mp.sharedGates,[...new Set([...mp.paymentPlan.sharedGates,...mp.retainedPlan.sharedGates])].sort());
  assert.deepEqual(mp.customerPaymentKeyGates,mp.paymentPlan.keyGates);
  assert.deepEqual(mp.capacities,mp.paymentPlan.capacities);
  assert.ok(mp.resources.find(n=>n.relation==='public.products' && n.id===product).mode==='UPDATE');
  assert.ok(mp.resources.filter(n=>n.relation==='public.customer_payments').every(n=>n.mode==='UPDATE'));
  assert.equal(mp.resources.find(n=>n.relation==='public.suppliers' && n.id===supplierId).mode,'UPDATE');
  const ordinalRelation=['public.supplier_receipts','public.purchase_receipts','public.purchase_orders','public.suppliers'];
  const selectedOrder=mp.resources.filter(n=>ordinalRelation.includes(n.relation)).map(n=>n.relation);
  assert.deepEqual(selectedOrder,[...selectedOrder].sort((a,b)=>ordinalRelation.indexOf(a)-ordinalRelation.indexOf(b)));
  for(let i=1;i<mp.resources.length;i++) {
    const a=mp.resources[i-1],b=mp.resources[i];
    assert.ok(a.rank<b.rank || (a.rank===b.rank && (a.ordinal<b.ordinal ||
      (a.ordinal===b.ordinal && (a.relation<b.relation || (a.relation===b.relation && a.id<b.id))))));
  }
  assert.equal(await fingerprint(),globalBefore); checks+=19;
  passed.push('shift-merged-exact-resources: actual source-domain bidirectional identity/content union, strongest per-row modes, fixed supplier ordering and sorted root/shared domains; read-only/no lock or future batch identity authority');
  const pureId=randomUUID();
  const pureRows=modes.map(mode=>({relation:'public.products',id:pureId,row:{id:pureId},mode,rank:999}));
  const pure=await json(`SELECT phase5_private.merge_shift_resource_snapshots_v1(${j(pureRows)});`);
  assert.deepEqual(pure,[{relation:'public.products',id:pureId,row:{id:pureId},mode:'UPDATE',rank:5,ordinal:1}]); checks+=1;
  for(const rows of [null,{},'rows']) await fails(`SELECT phase5_private.merge_shift_resource_snapshots_v1(${j(rows)});`,/22023.*SHIFT_MERGE_ROWS_REQUIRED/u);
  for(const mutate of [r=>({...r,id:null}),r=>({...r,row:null}),r=>({...r,mode:null}),
    r=>({...r,mode:'ACCESS_EXCLUSIVE'}),r=>({...r,relation:'public.unreviewed_relation'}),
    r=>({...r,id:randomUUID()}),r=>({...r,row:{id:randomUUID()}})]) {
    await fails(`SELECT phase5_private.merge_shift_resource_snapshots_v1(${j([mutate(pureRows[0])])});`,
      /23514.*SHIFT_MERGE_RESOURCE_INVALID/u);
  }
  await fails(`SELECT phase5_private.merge_shift_resource_snapshots_v1(${j([
    pureRows[0],{...pureRows[1],row:{id:pureId,cost:1}}])});`,/40001.*SHIFT_MERGE_CONTENT_CHANGED_RETRY/u);
  const modePairs=await json(`SELECT jsonb_build_object('share',phase5_private.merge_shift_resource_snapshots_v1(${j(pureRows.slice(0,2))}),
    'noKey',phase5_private.merge_shift_resource_snapshots_v1(${j(pureRows.slice(0,3))}),
    'empty',phase5_private.merge_shift_resource_snapshots_v1('[]'::jsonb),
    'reversed',phase5_private.merge_shift_resource_snapshots_v1(${j([...pureRows].reverse())}));`);
  assert.equal(modePairs.share[0].mode,'SHARE'); assert.equal(modePairs.noKey[0].mode,'NO_KEY_UPDATE');
  assert.deepEqual(modePairs.empty,[]); assert.deepEqual(modePairs.reversed,pure); checks+=4;
  passed.push('shift-merged-pure-adversarial: exact identity/content not aggregate counts, NULL/unknown relation/mode rejection, fixed rank ignores caller rank, strongest mode and order-independent deterministic union; pure inputs never authority');
  const mergedHistorical=await json(`BEGIN; ${setup} ${historicalSource} SELECT ${merged}; ROLLBACK;`);
  assert.equal(mergedHistorical.resources.filter(n=>n.relation==='public.cash_shifts').length,2);
  assert.ok(mergedHistorical.resources.filter(n=>n.relation==='public.cash_shifts').every(n=>n.mode==='UPDATE'));
  assert.equal(mergedHistorical.paymentPlan.shifts.find(n=>n.row.status==='closed').mode,'KEY_SHARE');
  assert.equal(mergedHistorical.capacities[0].fullReversalAmountInMinorUnits,'100'); checks+=4;
  for(const mutation of [
    `UPDATE public.profiles SET full_name='Merged drift' WHERE id=${q(owner)};`,
    `UPDATE public.suppliers SET company_name='Merged drift' WHERE id=${q(supplierId)};`,
    `UPDATE public.inventory_balances SET reserved_quantity=reserved_quantity+1 WHERE warehouse_id=${q(warehouse)} AND product_id=${q(product)};`,
    `SELECT public.create_operational_expense(${q(fixtureBranch)},'transport','Merged late member',1,'cash',NULL);`]) {
    await fails(`${retainedWithSources} ${mergedFrozen} ${mutation}
      SELECT phase5_private.assert_shift_merged_resources_unchanged_v1(${q(owner)},${shift},${request},(SELECT plan FROM qa_merged_frozen));`,
      /40001.*SHIFT_MERGED_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),globalBefore); checks+=1;
  }
  await fails(`${jointReversal} SELECT ${merged};`,/23514.*REVERSAL_CANDIDATE_CAPACITY_EXCEEDED/u);
  assert.equal(await fingerprint(),globalBefore); checks+=1;
  passed.push('shift-merged-drift: full content and membership rediscovery, historical KEY_SHARE upgraded before acquisition to retained UPDATE, joint full-reversal financial capacity unchanged; all rejected fixtures roll back');
  const batchReason='Private immutable batch preparation'; const batchKey=randomUUID();
  const batchCall=`phase5_private.allocate_shift_batch_identity_v1(${q(owner)},${shift},${q(batchReason)},${q(batchKey)},${request})`;
  const batchFrozen=`CREATE TEMP TABLE qa_batch_identity AS SELECT ${batchCall} AS plan;
    UPDATE qa_shift_instruction_state SET baseline=(${expr}),advisory_count=
      (SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory');`;
  const batchAssert=(v='(SELECT plan FROM qa_batch_identity)',reason=q(batchReason),key=q(batchKey))=>
    `phase5_private.assert_shift_batch_identity_v1(${q(owner)},${shift},${reason},${key},${request},${v})`;
  const batchClean=await json(`BEGIN; ${retainedWithSources}
    UPDATE qa_shift_instruction_state SET baseline=(${expr}),advisory_count=
      (SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory');
    CREATE TEMP TABLE qa_batch_identity AS SELECT ${batchCall} AS plan;
    SELECT jsonb_build_object('plan',(SELECT plan FROM qa_batch_identity),'valid',${batchAssert()},
      'contentSame',(${expr})=(SELECT baseline FROM qa_shift_instruction_state),'locksSame',
      (SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory')=
        (SELECT advisory_count FROM qa_shift_instruction_state)); ROLLBACK;`);
  assert.equal(batchClean.valid,true); assert.equal(batchClean.contentSame,true); assert.equal(batchClean.locksSame,true);
  const bp=batchClean.plan;
  assert.equal(bp.executionAuthority,false); assert.equal(bp.planState,'PREALLOCATED_IDENTITIES_NOT_CLAIMED');
  assert.equal(bp.completeFor,'BATCH_HEADER_CHILD_PRIMITIVE_IDENTITY_ONLY');
  assert.deepEqual(bp.request,{requestVersion:'phase5-shift-batch-preparation-v1',actorId:owner,
    shiftId:bp.sourcePlan.shiftId,reason:batchReason,idempotencyKey:batchKey,
    instructions:bp.sourcePlan.paymentPlan.sourcePlan.instructions});
  assert.match(bp.requestFingerprint,/^[0-9A-F]{64}$/u);
  assert.deepEqual(bp.children.map(n=>n.operationType),['customer_payment','customer_payment','operational_expense','pos_sale','supplier_payment','supplier_payment']);
  const batchIds=[bp.batchId];
  for(const child of bp.children) {
    batchIds.push(child.childId,child.auditId);
    if(child.operationType==='operational_expense') { assert.equal(child.primitiveId,child.auditId); assert.equal(child.idempotencyKey,null); }
    else {
      batchIds.push(child.primitiveId);
      if(child.operationType==='customer_payment') {
        batchIds.push(child.financialOperationId); assert.equal(child.idempotencyKey,child.instruction.idempotencyKey);
        assert.equal(child.originalRecordId,child.instruction.originalPaymentId);
      } else {
        assert.equal(child.financialOperationId,null);
        assert.equal(child.idempotencyKey,`shift:${bp.batchId}:${child.operationType==='pos_sale'?'pos':'supplier'}:${child.originalRecordId}`);
      }
    }
  }
  assert.equal(new Set(batchIds).size,batchIds.length);
  assert.equal(new Set(bp.keyGates).size,bp.keyGates.length); assert.deepEqual(bp.keyGates,[...bp.keyGates].sort());
  assert.ok(bp.keyGates.includes(`${owner}:${batchKey}`));
  assert.equal(await fingerprint(),globalBefore); checks+=16;
  passed.push('shift-batch-identity-read-only: real target source kinds exactly bound to immutable actor/Shift/reason/key/instructions/fingerprint, server-preallocated distinct header/child/audit/primitive/financial IDs and source-derived legacy keys; no source writes, context, locks or execution/FK completeness authority');
  const batchReject=async(mutation,pattern=/23514.*PHASE5_SHIFT_BATCH_/u)=>{
    await fails(`${retainedWithSources} ${batchFrozen} ${mutation} SELECT ${batchAssert()};`,pattern);
    assert.equal(await fingerprint(),globalBefore); checks+=1;
  };
  for(const mutation of [
    `UPDATE qa_batch_identity SET plan=jsonb_set(plan,'{executionAuthority}','true'::jsonb);`,
    `UPDATE qa_batch_identity SET plan=jsonb_set(plan,'{request,actorId}',to_jsonb(${q(randomUUID())}::text));`,
    `UPDATE qa_batch_identity SET plan=jsonb_set(plan,'{request,reason}','"Different reason"'::jsonb);`,
    `UPDATE qa_batch_identity SET plan=jsonb_set(plan,'{requestFingerprint}','"WRONG"'::jsonb);`,
    `UPDATE qa_batch_identity SET plan=jsonb_set(plan,'{children}',(plan->'children')-0);`,
    `UPDATE qa_batch_identity SET plan=jsonb_set(plan,'{children}',(plan->'children')||jsonb_build_array(plan->'children'->0));`,
    `UPDATE qa_batch_identity SET plan=jsonb_set(plan,'{children,0,originalRecordId}',plan->'children'->1->'originalRecordId');`,
    `UPDATE qa_batch_identity SET plan=jsonb_set(plan,'{children,0,instruction,actualTenderMethod}',
      to_jsonb(CASE WHEN plan->'children'->0->'instruction'->>'actualTenderMethod'='cash' THEN 'cliq'::text ELSE 'cash'::text END));`,
    `UPDATE qa_batch_identity SET plan=jsonb_set(plan,'{children,0,idempotencyKey}','"Wrong source child key"'::jsonb);`,
    `UPDATE qa_batch_identity SET plan=jsonb_set(plan,'{keyGates}','[]'::jsonb);`,
  ]) await batchReject(mutation);
  await batchReject(`UPDATE qa_batch_identity SET plan=jsonb_set(plan,'{children,0,childId}',plan->'children'->1->'childId');`,
    /23505.*FUTURE_ID_ALREADY_OWNED/u);
  await batchReject(`UPDATE qa_batch_identity SET plan=jsonb_set(plan,'{children,0,childId}',plan->'children'->0->'originalRecordId');`,
    /23505.*FUTURE_ID_ALREADY_OWNED/u);
  await batchReject(`INSERT INTO public.audit_logs(id,user_id,action,entity_name,entity_id,details)
    SELECT (plan->'children'->0->>'auditId')::uuid,${q(owner)},'ISOLATED_PREALLOCATION_CONFLICT','cash_shifts',${shift},'{}'::jsonb FROM qa_batch_identity;`,
    /23505.*FUTURE_ID_ALREADY_OWNED/u);
  await batchReject(`UPDATE public.suppliers SET company_name='Identity source drift' WHERE id=${q(supplierId)};`,
    /40001.*BATCH_SOURCE_CHANGED_RETRY/u);
  await batchReject(`SELECT public.create_operational_expense(${q(fixtureBranch)},'transport','Late identity member',1,'cash',NULL);`,
    /40001.*BATCH_SOURCE_CHANGED_RETRY/u);
  for(const [reason,key] of [[null,batchKey],['bad ',batchKey],[batchReason,'short'],[batchReason,null]]) {
    await fails(`${retainedWithSources} SELECT phase5_private.allocate_shift_batch_identity_v1(${q(owner)},${shift},
      ${reason===null?'NULL':q(reason)},${key===null?'NULL':q(key)},${request});`,/22023.*BATCH_REQUEST_INVALID/u);
  }
  await fails(`${retainedWithSources} SELECT phase5_private.allocate_shift_batch_identity_v1(${q(owner)},${shift},${q(batchReason)},
    (SELECT idempotency_key FROM phase5_private.financial_operation_events WHERE actor_scope_id=${q(owner)} LIMIT 1),${request});`,
    /23505.*BATCH_KEY_ALREADY_OWNED/u);
  await fails(`${retainedWithSources} SELECT phase5_private.allocate_shift_batch_identity_v1(${q(owner)},${shift},${q(batchReason)},
    (SELECT instructions->0->>'idempotencyKey' FROM qa_shift_instruction_state),${request});`,/23505.*BATCH_DUPLICATE_KEY/u);
  // Reverse the array, not its source binding: validation is identity-set based.
  assert.equal(await json(`BEGIN; ${retainedWithSources} ${batchFrozen}
    UPDATE qa_batch_identity SET plan=jsonb_set(plan,'{children}',(SELECT jsonb_agg(n ORDER BY ordinal DESC)
      FROM qa_batch_identity,jsonb_array_elements(plan->'children') WITH ORDINALITY a(n,ordinal)));
    SELECT to_jsonb(${batchAssert()}); ROLLBACK;`),true); checks+=1;
  assert.equal(await fingerprint(),globalBefore); checks+=1;
  passed.push('shift-batch-identity-adversarial: missing/extra/substituted source, request/tender/key/gate mismatch, duplicate/source-owned/persisted future ID, actor-key ownership and late source drift reject with full content rollback; reordering does not alter per-identity coverage');
  const manifestCall=`phase5_private.allocate_shift_batch_manifest_v1(${q(owner)},${shift},${q(batchReason)},${q(batchKey)},${request})`;
  const manifestAssert=(v='(SELECT plan FROM qa_shift_manifest)')=>
    `phase5_private.assert_shift_batch_manifest_v1(${q(owner)},${shift},${q(batchReason)},${q(batchKey)},${request},${v})`;
  const manifestFrozen=`UPDATE qa_shift_instruction_state SET baseline=(${expr}),advisory_count=
    (SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory');
    CREATE TEMP TABLE qa_shift_manifest AS SELECT ${manifestCall} AS plan;`;
  const manifestClean=await json(`BEGIN; ${retainedWithSources} ${manifestFrozen}
    SELECT jsonb_build_object('plan',(SELECT plan FROM qa_shift_manifest),'valid',${manifestAssert()},
      'same',(${expr})=(SELECT baseline FROM qa_shift_instruction_state),'locksSame',
      (SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory')=(SELECT advisory_count FROM qa_shift_instruction_state)); ROLLBACK;`);
  assert.equal(manifestClean.valid,true); assert.equal(manifestClean.same,true); assert.equal(manifestClean.locksSame,true);
  const insertionManifest=manifestClean.plan;
  assert.equal(insertionManifest.executionAuthority,false); assert.equal(insertionManifest.transactionContextComplete,false);
  assert.equal(insertionManifest.sourceWriteTriggerClosureComplete,false); assert.equal(insertionManifest.completeFor,'PLANNED_INSERT_FK_AND_POS_INVENTORY_ONLY');
  assert.equal(insertionManifest.allocation.inventory.length,1); assert.equal(insertionManifest.allocation.histories.length,1);
  assert.equal(insertionManifest.allocation.inventory[0].productId,product); assert.equal(insertionManifest.allocation.inventory[0].warehouseId,fixtureWarehouse);
  assert.equal(insertionManifest.allocation.inventory[0].baseQuantity,1); assert.equal(insertionManifest.allocation.inventory[0].parcelComponentId,null);
  assert.equal(insertionManifest.allocation.inventory[0].orderItemId,insertionManifest.allocation.inventory[0].itemSnapshot.id);
  assert.ok(insertionManifest.foreignKeys.some(e=>e.constraint==='fk_phase5_reversal_exact_original_collection'));
  assert.ok(insertionManifest.foreignKeys.some(e=>e.constraint==='inventory_movements_component_operation_fk'&&e.parentState==='NOT_APPLICABLE'));
  assert.ok(insertionManifest.foreignKeys.some(e=>e.parentState==='FUTURE_NOT_CLAIMED'&&e.parentRelation==='public.cash_shift_reversals'));
  assert.ok(insertionManifest.foreignKeys.some(e=>e.parentState==='FUTURE_NOT_CLAIMED'&&e.parentRelation==='phase5_private.financial_operation_events'));
  assert.ok(insertionManifest.foreignKeys.filter(e=>e.parentState==='EXISTING_NOT_LOCKED').every(e=>insertionManifest.existingResources.some(r=>r.relation===e.parentRelation&&r.id===e.parentId)));
  assert.equal(await fingerprint(),globalBefore); checks+=20;
  passed.push('shift-manifest-exact-inventory: actual115 per-item projection, distinct future movement/history/batch-audit IDs, planned composite/simple FK parents from full-schema catalog including future batch/financial events; symbolic post-lock event slots are not timestamps or DML. Read-only/no lock/context/trigger-completeness authority');
  const manifestReject=async(mutation,pattern=/23514.*PHASE5_SHIFT_MANIFEST_/u)=>{
    await fails(`${retainedWithSources} ${manifestFrozen} ${mutation} SELECT ${manifestAssert()};`,pattern);
    assert.equal(await fingerprint(),globalBefore); checks+=1;
  };
  for(const mutation of [
    `UPDATE qa_shift_manifest SET plan=jsonb_set(plan,'{allocation,inventory}','[]'::jsonb);`,
    `UPDATE qa_shift_manifest SET plan=jsonb_set(plan,'{allocation,inventory}',(plan->'allocation'->'inventory')||jsonb_build_array(plan->'allocation'->'inventory'->0));`,
    `UPDATE qa_shift_manifest SET plan=jsonb_set(plan,'{allocation,inventory,0,orderItemId}',to_jsonb(${q(randomUUID())}::text));`,
    `UPDATE qa_shift_manifest SET plan=jsonb_set(plan,'{allocation,inventory,0,productId}',to_jsonb(${q(randomUUID())}::text));`,
    `UPDATE qa_shift_manifest SET plan=jsonb_set(plan,'{allocation,inventory,0,baseQuantity}','99'::jsonb);`,
    `UPDATE qa_shift_manifest SET plan=jsonb_set(plan,'{allocation,inventory,0,warehouseId}',to_jsonb(${q(randomUUID())}::text));`,
    `UPDATE qa_shift_manifest SET plan=jsonb_set(plan,'{allocation,histories}','[]'::jsonb);`,
  ]) await manifestReject(mutation);
  await manifestReject(`UPDATE qa_shift_manifest SET plan=jsonb_set(plan,'{allocation,inventory,0,movementId}',plan->'allocation'->'batchAuditId');`,/23505.*FUTURE_ID_ALREADY_OWNED/u);
  await manifestReject(`UPDATE qa_shift_manifest SET plan=jsonb_set(plan,'{allocation,inventory,0,movementId}',plan->'allocation'->'inventory'->0->'orderItemId');`,/23505.*FUTURE_ID_ALREADY_OWNED/u);
  await manifestReject(`INSERT INTO public.audit_logs(id,user_id,action,entity_name,entity_id,details)
    SELECT (plan->'allocation'->>'batchAuditId')::uuid,${q(owner)},'ISOLATED_FK_ID_CONFLICT','cash_shifts',${shift},'{}'::jsonb FROM qa_shift_manifest;`,/23505.*FUTURE_ID_ALREADY_OWNED/u);
  await manifestReject(`UPDATE qa_shift_manifest SET plan=jsonb_set(plan,'{foreignKeys}','[]'::jsonb);`,/40001.*MANIFEST_CHANGED_RETRY/u);
  await manifestReject(`UPDATE qa_shift_manifest SET plan=jsonb_set(plan,'{transactionContextComplete}','true'::jsonb);`,/40001.*MANIFEST_CHANGED_RETRY/u);
  await manifestReject(`UPDATE public.suppliers SET company_name='Manifest full row drift' WHERE id=${q(supplierId)};`,/40001.*BATCH_SOURCE_CHANGED_RETRY/u);
  // Pure FK oracle cannot confer authority. Challenge its bidirectional parent
  // coverage with real catalog edges, including composite original-collection FK.
  const fkCall=(rows="(SELECT plan->'plannedInsertFkRows' FROM qa_shift_manifest)",parents="(SELECT plan->'existingResources' FROM qa_shift_manifest)")=>
    `phase5_private.shift_insert_fk_coverage_v1(${rows},${parents})`;
  await fails(`${retainedWithSources} ${manifestFrozen} SELECT ${fkCall(undefined,
    `(SELECT jsonb_agg(r) FROM qa_shift_manifest,jsonb_array_elements(plan->'existingResources') r WHERE r->>'relation'<>'public.profiles')`)};`,/23514.*FK_PARENT_NOT_EXACTLY_ONE/u);
  await fails(`${retainedWithSources} ${manifestFrozen} SELECT ${fkCall(undefined,
    `(SELECT (plan->'existingResources')||jsonb_build_array(r) FROM qa_shift_manifest,jsonb_array_elements(plan->'existingResources') r WHERE r->>'relation'='public.profiles' LIMIT 1)`)};`,/23514.*FK_PARENT_NOT_EXACTLY_ONE/u);
  await fails(`${retainedWithSources} ${manifestFrozen} SELECT ${fkCall(
    `(SELECT jsonb_agg(CASE WHEN r->>'relation'='phase5_private.payment_reversal_events' THEN jsonb_set(r,'{row,reversed_amount_in_minor_units}','999'::jsonb) ELSE r END) FROM qa_shift_manifest,jsonb_array_elements(plan->'plannedInsertFkRows') r)`)};`,/23514.*FK_PARENT_NOT_EXACTLY_ONE/u);
  await fails(`${retainedWithSources} ${manifestFrozen} SELECT ${fkCall(
    `(SELECT jsonb_agg(CASE WHEN r->>'relation'='public.inventory_movements' THEN r||jsonb_build_object('row',(r->'row')-'reservation_id') ELSE r END) FROM qa_shift_manifest,jsonb_array_elements(plan->'plannedInsertFkRows') r)`)};`,/23514.*FK_COLUMN_UNPLANNED/u);
  assert.equal(await fingerprint(),globalBefore); checks+=1;
  passed.push('shift-manifest-fk-adversarial: per-item missing/extra/substitution/product/warehouse/quantity and UUID ownership reject; missing/duplicate existing FK parent, composite original-collection amount mismatch and missing nullable FK column fail closed; no manufactured parent or dynamic SQL');
  // Same-row-count source drift is caught by authorized full rediscovery.
  await manifestReject(`UPDATE public.inventory_balances SET on_hand_quantity=on_hand_quantity+1 WHERE warehouse_id=${q(fixtureWarehouse)} AND product_id=${q(product)};`,/40001.*BATCH_SOURCE_CHANGED_RETRY/u);
  await fails(`${retainedWithSources} ${manifestFrozen}
    ALTER TABLE public.audit_logs ADD COLUMN qa_unplanned_parent uuid;
    ALTER TABLE public.audit_logs ADD CONSTRAINT qa_unplanned_parent_fk FOREIGN KEY(qa_unplanned_parent) REFERENCES public.profiles(id);
    SELECT ${manifestAssert()};`,/23514.*FK_COLUMN_UNPLANNED/u);
  await fails(`${retainedWithSources} ${manifestFrozen}
    ALTER TABLE phase5_private.payment_reversal_events DROP CONSTRAINT fk_phase5_reversal_operation_event;
    ALTER TABLE phase5_private.payment_reversal_events ADD CONSTRAINT fk_phase5_reversal_operation_event
      FOREIGN KEY(financial_operation_id,operation_type,operation_event_at)
      REFERENCES phase5_private.financial_operation_events(id,operation_type,operation_event_at) MATCH FULL;
    SELECT ${fkCall(`(SELECT jsonb_agg(CASE WHEN r->>'relation'='phase5_private.payment_reversal_events'
      THEN jsonb_set(r,'{row,operation_event_at}','null'::jsonb) ELSE r END)
      FROM qa_shift_manifest,jsonb_array_elements(plan->'plannedInsertFkRows') r)`)};`,/23514.*FK_PARTIAL_NULL_INVALID/u);
  assert.equal(await fingerprint(),globalBefore); checks+=1;
  // Real second POS sale with two equal-SKU/equal-quantity items: no aggregate
  // count or quantity can identify which immutable item a movement belongs to.
  const equalSkuSale=`CREATE TEMP TABLE qa_manifest_equal_sku AS SELECT public.create_pos_sale_v2(
    ${q(fixtureWarehouse)},${q(fixtureBranch)},${q(customerId)},'Equal SKU distinct identities','debt',
    ${j([0,1].map(()=>({commercial_line_kind:'base_unit',product_id:product,base_quantity:1,
      price_authority:'server_catalog',line_discount_in_minor_units:0})))},0,2000,${q(randomUUID())}) AS result;`;
  const equalSku=await json(`BEGIN; ${retainedWithSources} ${equalSkuSale} ${manifestFrozen}
    SELECT jsonb_build_object('valid',${manifestAssert()},'rows',
      (SELECT jsonb_agg(n ORDER BY n->>'orderItemId') FROM qa_shift_manifest,jsonb_array_elements(plan->'allocation'->'inventory') n
       WHERE n->>'orderId'=(SELECT result->>'orderId' FROM qa_manifest_equal_sku)),
      'same',(${expr})=(SELECT baseline FROM qa_shift_instruction_state)); ROLLBACK;`);
  assert.equal(equalSku.valid,true); assert.equal(equalSku.same,true); assert.equal(equalSku.rows.length,2);
  assert.ok(equalSku.rows.every(n=>n.productId===product&&n.baseQuantity===1));
  assert.equal(new Set(equalSku.rows.map(n=>n.orderItemId)).size,2);
  assert.equal(new Set(equalSku.rows.map(n=>n.movementId)).size,2); checks+=6;
  for(const winnerOrdinal of [0,1]) {
    await fails(`${retainedWithSources} ${equalSkuSale} ${manifestFrozen}
      UPDATE qa_shift_manifest SET plan=jsonb_set(plan,'{allocation,inventory}',
        (SELECT jsonb_agg(CASE WHEN n->>'orderId'=(SELECT result->>'orderId' FROM qa_manifest_equal_sku)
          THEN (SELECT selected-'movementId' FROM jsonb_array_elements(plan->'allocation'->'inventory') selected
            WHERE selected->>'orderId'=(SELECT result->>'orderId' FROM qa_manifest_equal_sku)
            ORDER BY selected->>'orderItemId' OFFSET ${winnerOrdinal} LIMIT 1)||jsonb_build_object('movementId',n->'movementId')
          ELSE n END) FROM jsonb_array_elements(plan->'allocation'->'inventory') n));
      SELECT ${manifestAssert()};`,/23514.*MANIFEST_PER_ITEM_EXACT_SET_REQUIRED/u);
    assert.equal(await fingerprint(),globalBefore); checks+=1;
  }
  passed.push('shift-manifest-full-drift: actual full resource/source/catalog coverage rederived; content-sensitive snapshot or manifest tampering cannot assert a held plan or execution authority');
  passed.push('shift-manifest-equal-SKU-bijection: real two equal-quantity/SKU POS items have distinct immutable item and future movement IDs; A,B to A,A and B,B substitution reject with unchanged counts/quantity and distinct movement UUIDs. Rollback-only catalog new-FK and MATCH FULL partial NULL controls fail closed');
  const typedContextCall=`phase5_private.allocate_shift_context_plan_v1(${q(owner)},${shift},${q(batchReason)},${q(batchKey)},${request})`;
  const contextOrder='(SELECT order_id FROM qa_shift_instruction_state)';
  const typedContextAssert=(v='(SELECT plan FROM qa_shift_context)')=>
    `phase5_private.assert_shift_context_plan_v1(${q(owner)},${shift},${q(batchReason)},${q(batchKey)},${request},${v})`;
  const typedContextFrozen=`UPDATE qa_shift_instruction_state SET baseline=(${expr}),advisory_count=
    (SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory');
    CREATE TEMP TABLE qa_shift_context AS SELECT ${typedContextCall} AS plan;`;
  const typedContextClean=await json(`BEGIN; ${retainedWithSources} ${typedContextFrozen}
    SELECT jsonb_build_object('plan',(SELECT plan FROM qa_shift_context),'valid',${typedContextAssert()},
      'same',(${expr})=(SELECT baseline FROM qa_shift_instruction_state),'locksSame',
      (SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory')=(SELECT advisory_count FROM qa_shift_instruction_state)); ROLLBACK;`);
  assert.equal(typedContextClean.valid,true); assert.equal(typedContextClean.same,true); assert.equal(typedContextClean.locksSame,true);
  const plannedContexts=typedContextClean.plan.contextRows.map(n=>n.row);
  assert.equal(plannedContexts.length,7); assert.equal(plannedContexts[0].shift_source_kind,'BATCH');
  assert.equal(plannedContexts[0].order_id,null); assert.equal(plannedContexts[0].shift_source_id,typedContextClean.plan.manifest.identityPlan.request.shiftId);
  assert.equal(typedContextClean.plan.executionAuthority,false); assert.equal(typedContextClean.plan.heldPlanComplete,false);
  assert.equal(typedContextClean.plan.sourceWriteTriggerClosureComplete,false);
  assert.ok(plannedContexts.filter(n=>['supplier_payment','operational_expense'].includes(n.shift_source_kind)).every(n=>n.order_id===null));
  assert.ok(plannedContexts.filter(n=>['pos_sale','customer_payment'].includes(n.shift_source_kind)).every(n=>n.order_id!==null));
  assert.ok(plannedContexts.slice(1).every(n=>n.parent_context_id===plannedContexts[0].id&&n.parent_context_kind==='BATCH'
    &&JSON.stringify(n.transaction_id)===JSON.stringify(plannedContexts[0].transaction_id)));
  assert.equal(new Set(plannedContexts.map(n=>n.id)).size,7);
  assert.equal(typedContextClean.plan.foreignKeys.filter(n=>n.constraint==='phase5_context_shift_parent'&&n.parentState==='FUTURE_NOT_CLAIMED').length,6);
  checks+=15;
  passed.push('shift-context-typed-root: real six-source Shift plans one Shift-rooted parent and six exactly bound children; supplier/expense have no fabricated Order, POS/customer preserve their real roots; common symbolic post-lock transaction and composite parent FK, zero source/context writes or advisory locks');
  const contextReject=async (mutation,pattern=/40001.*CONTEXT_PLAN_CHANGED_RETRY/u)=>{
    await fails(`${retainedWithSources} ${typedContextFrozen} ${mutation} SELECT ${typedContextAssert()};`,pattern);
    assert.equal(await fingerprint(),globalBefore); checks+=1;
  };
  for(const mutation of [
    `UPDATE qa_shift_context SET plan=jsonb_set(plan,'{contextRows,0,row,order_id}',to_jsonb(${contextOrder}::text));`,
    `UPDATE qa_shift_context SET plan=jsonb_set(plan,'{contextRows,1,row,parent_context_id}',to_jsonb(${q(randomUUID())}::text));`,
    `UPDATE qa_shift_context SET plan=jsonb_set(plan,'{contextRows,1,row,shift_source_id}',to_jsonb(${q(randomUUID())}::text));`,
    `UPDATE qa_shift_context SET plan=jsonb_set(plan,'{contextRows,1,row,transaction_id}','1'::jsonb);`,
    `UPDATE qa_shift_context SET plan=jsonb_set(plan,'{contextRows,1,row,actor_id}',to_jsonb(${q(randomUUID())}::text));`,
    `UPDATE qa_shift_context SET plan=jsonb_set(plan,'{heldPlanComplete}','true'::jsonb);`,
    `UPDATE qa_shift_context SET plan=jsonb_set(plan,'{sourceWriteTriggerClosureComplete}','true'::jsonb);`,
    `UPDATE qa_shift_context SET plan=jsonb_set(plan,'{executionAuthority}','true'::jsonb);`,
    `UPDATE qa_shift_context SET plan=jsonb_set(plan,'{foreignKeys}','[]'::jsonb);`,
  ]) await contextReject(mutation);
  for(const allocationMutation of [
    `(plan->'contextAllocation')||jsonb_build_object('children',(plan->'contextAllocation'->'children')-0)`,
    `(plan->'contextAllocation')||jsonb_build_object('children',(plan->'contextAllocation'->'children')||jsonb_build_array(plan->'contextAllocation'->'children'->0))`,
    `jsonb_set(plan->'contextAllocation','{children,0,childId}',to_jsonb(${q(randomUUID())}::text))`,
  ]) await contextReject(`UPDATE qa_shift_context SET plan=jsonb_set(plan,'{contextAllocation}',${allocationMutation});`,/23514.*CONTEXT_CHILD_EXACT_SET_REQUIRED/u);
  await contextReject(`UPDATE qa_shift_context SET plan=jsonb_set(plan,'{contextAllocation,children,0,contextId}',plan->'contextAllocation'->'batchContextId');`,/23505.*CONTEXT_ID_ALREADY_OWNED/u);
  await contextReject(`UPDATE qa_shift_context SET plan=jsonb_set(plan,'{contextAllocation,batchContextId}',plan->'manifest'->'identityPlan'->'batchId');`,/23505.*CONTEXT_ID_ALREADY_OWNED/u);
  await contextReject(`UPDATE public.suppliers SET company_name='Typed context source drift' WHERE id=${q(supplierId)};`,/40001.*BATCH_SOURCE_CHANGED_RETRY/u);
  passed.push('shift-context-adversarial: exact child context bijection, duplicate/source-owned IDs, root/parent/actor/transaction/request/flag/FK substitution and current source drift fail closed with full-state rollback');
  // Only the privileged rollback fixture removes the inactive INSERT barrier.
  // It tests declarative shape/FKs, never operational authority or completion.
  const actualContextRows=`CREATE TEMP TABLE qa_context_rows AS
    SELECT ordinal,n->'row'||jsonb_build_object('transaction_id',txid_current()) AS row
    FROM qa_shift_context,jsonb_array_elements(plan->'contextRows') WITH ORDINALITY a(n,ordinal);`;
  const insertContextRow=(selector)=>`INSERT INTO phase5_private.mutation_contexts
    SELECT (jsonb_populate_record(NULL::phase5_private.mutation_contexts,row)).* FROM qa_context_rows WHERE ${selector};`;
  await fails(`${retainedWithSources} ${typedContextFrozen} ${actualContextRows} ${insertContextRow('ordinal=1')}`,/55000.*PHASE5_PREPARATION_ONLY/u);
  const contextSchemaSetup=`${retainedWithSources} ${typedContextFrozen} ${actualContextRows}
    ALTER TABLE phase5_private.mutation_contexts DISABLE TRIGGER phase5_preparation_context_barrier;`;
  const schemaValid=await json(`BEGIN; ${contextSchemaSetup}
    ${insertContextRow('ordinal=1')} ${insertContextRow('ordinal>1')}
    SELECT jsonb_build_object('count',(SELECT count(*) FROM phase5_private.mutation_contexts),
      'rootless',(SELECT count(*) FROM phase5_private.mutation_contexts WHERE order_id IS NULL),
      'generation',(SELECT generation FROM phase5_private.authority_generation WHERE singleton)); ROLLBACK;`);
  assert.deepEqual(schemaValid,{count:7,rootless:4,generation:0}); checks+=1;
  const orderPurposes=['CUSTOMER_COLLECTION','CUSTOMER_PAYMENT_REVERSAL','POS_CREATION','CUSTOMER_COMPLETION',
    'LEGACY_WEBSITE_COMPLETION','RETURN_SETTLEMENT','REPLACEMENT_ISSUANCE','POS_CANCELLATION','SHIFT_CLOSE'];
  const orderContextInsert=(orderValue)=>`INSERT INTO phase5_private.mutation_contexts
    (id,transaction_id,generation,actor_id,order_id,purpose,operation_id,normalized_request,request_fingerprint,locked_plan)
    SELECT gen_random_uuid(),txid_current(),1,${q(owner)},${orderValue},p,gen_random_uuid(),'{}',repeat('A',64),'{}'
    FROM unnest(ARRAY[${orderPurposes.map(q).join(',')}]) p;`;
  assert.deepEqual(await json(`BEGIN; ${contextSchemaSetup} ${orderContextInsert(contextOrder)}
    SELECT jsonb_build_object('count',(SELECT count(*) FROM phase5_private.mutation_contexts),
      'allOrderRooted',NOT EXISTS(SELECT 1 FROM phase5_private.mutation_contexts WHERE order_id IS NULL OR shift_id IS NOT NULL
        OR parent_context_id IS NOT NULL OR shift_source_kind IS NOT NULL)); ROLLBACK;`),{count:9,allOrderRooted:true}); checks+=1;
  await fails(`${contextSchemaSetup} ${orderContextInsert('NULL')}`,/23514.*phase5_context_root_shape/u);
  await fails(`${contextSchemaSetup} ${insertContextRow('ordinal=1')}
    SET CONSTRAINTS phase5_private.phase5_context_completion IMMEDIATE;`,/22023.*PHASE5_WIRE_KEYS_INVALID/u);
  await fails(`${retainedWithSources} SELECT phase5_private.enter_authority_context_v1(${q(owner)},'SHIFT_REVERSAL',NULL,'{}');`,
    /42501.*CONTEXT_PURPOSE_OR_ACTOR_UNSUPPORTED/u);
  assert.equal(await fingerprint(),globalBefore); checks+=1;
  for(const [selector,field,value] of [
    ['ordinal=1','order_id',`to_jsonb(${contextOrder}::text)`],
    ['ordinal=1','shift_source_id',`to_jsonb(${q(randomUUID())}::text)`],
    ['ordinal=1','shift_source_kind',`'null'::jsonb`],
    ['ordinal=1','purpose',`'"CUSTOMER_COLLECTION"'::jsonb`],
    ['ordinal>1','parent_context_id',`'null'::jsonb`],
    ['ordinal>1','parent_context_kind',`'null'::jsonb`],
    ["row->>'shift_source_kind'='pos_sale'",'order_id',`'null'::jsonb`],
    ["row->>'shift_source_kind'='supplier_payment'",'order_id',`to_jsonb(${contextOrder}::text)`],
    ["row->>'shift_source_kind'='operational_expense'",'order_id',`to_jsonb(${contextOrder}::text)`],
  ]) {
    await fails(`${contextSchemaSetup} UPDATE qa_context_rows SET row=jsonb_set(row,${q(`{${field}}`)},${value}) WHERE ${selector};
      ${insertContextRow('ordinal=1')} ${insertContextRow('ordinal>1')}`,/23514.*phase5_context_root_shape/u);
    assert.equal(await fingerprint(),globalBefore); checks+=1;
  }
  for(const [field,value] of [
    ['transaction_id','to_jsonb(txid_current()+1)'],
    ['actor_id',`to_jsonb('92400000-0000-0000-0000-000000000002'::text)`],
    ['shift_id',`(SELECT to_jsonb(id::text) FROM public.cash_shifts WHERE branch_id=${q(fixtureBranch)} AND status='open')`],
    ['parent_context_id',`to_jsonb(${q(randomUUID())}::text)`],
  ]) {
    const distinctShift=field==='shift_id'?`SELECT public.close_cash_shift(${shift},(public.get_cash_shift_summary(${shift})->>'expectedCashInMinorUnits')::bigint,NULL);
      SELECT public.open_cash_shift(${q(fixtureBranch)},0);`:'';
    await fails(`${contextSchemaSetup} ${distinctShift} ${insertContextRow('ordinal=1')}
      UPDATE qa_context_rows SET row=jsonb_set(row,${q(`{${field}}`)},${value}) WHERE ordinal>1;
      ${insertContextRow('ordinal>1')}`,/23503.*phase5_context_shift_parent/u);
    assert.equal(await fingerprint(),globalBefore); checks+=1;
  }
  // A child cannot name another child as its BATCH parent.
  await fails(`${contextSchemaSetup} ${insertContextRow('ordinal=1')} ${insertContextRow('ordinal=2')}
    UPDATE qa_context_rows SET row=jsonb_set(row,'{parent_context_id}',(SELECT row->'id' FROM qa_context_rows WHERE ordinal=2)) WHERE ordinal=3;
    ${insertContextRow('ordinal=3')}`,/23503.*phase5_context_shift_parent/u);
  assert.equal(await fingerprint(),globalBefore); checks+=1;
  passed.push('shift-context-parent-fk: rollback-only actual context inserts prove exact shared txid/generation/actor/Shift/BATCH-parent FK; NULL/missing/fabricated roots, orphan or child-as-parent reject. Genuine rootless nodes are accepted only by schema fixture, not an execution permit');
  passed.push('shift-context-barrier: normal privileged context INSERT still rejects55000 under generation0; all nine other purposes preserve mandatory real Order and NULL Shift metadata. Rootless planned context cannot pass existing permit entry or deferred completion; privileged shape fixtures roll back complete content and leave barriers/public authority unchanged');
  const sideProducts=`ARRAY[${q(product)}::uuid]`;
  const sideCall=`phase5_private.discover_shift_inventory_side_effects_v1(${q(owner)},${sideProducts})`;
  const sideAssert=(v='(SELECT plan FROM qa_side_effects)')=>
    `phase5_private.assert_shift_inventory_side_effects_unchanged_v1(${q(owner)},${sideProducts},${v})`;
  const sideFixture=`${setup}
    UPDATE public.products SET min_stock_level=5 WHERE id=${q(product)};
    UPDATE public.inventory_balances SET on_hand_quantity=0 WHERE product_id=${q(product)} AND warehouse_id=${q(fixtureWarehouse)};
    UPDATE public.inventory_balances SET on_hand_quantity=2 WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)};
    INSERT INTO public.stock_alert_reads(stock_alert_id,user_id)
      SELECT a.id,p.id FROM public.stock_alerts a CROSS JOIN public.profiles p
      WHERE a.product_id=${q(product)} AND a.warehouse_id=${q(fixtureWarehouse)} AND a.status='active'
        AND p.id IN (${q(owner)},'92400000-0000-0000-0000-000000000002');
    INSERT INTO public.stock_alerts(product_id,warehouse_id,severity,status,available_quantity,threshold_quantity)
      VALUES(${q(product)},${q(fixtureWarehouse)},'low_stock','resolved',9,5);`;
  const sideFreeze=`CREATE TEMP TABLE qa_side_effects AS SELECT ${sideCall} plan;
    UPDATE qa_shift_instruction_state SET baseline=(${expr}),advisory_count=
      (SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory');`;
  const absentSide=await json(`BEGIN; ${setup} ${sideFreeze} SELECT jsonb_build_object('plan',(SELECT plan FROM qa_side_effects),
    'valid',${sideAssert()},'same',(${expr})=(SELECT baseline FROM qa_shift_instruction_state)); ROLLBACK;`);
  assert.equal(absentSide.valid,true);assert.equal(absentSide.same,true);
  assert.ok(absentSide.plan.domains.length>=2);assert.ok(absentSide.plan.domains.every(n=>n.activeAlert===null));
  assert.equal(absentSide.plan.compositeResources.length,0);assert.equal(absentSide.plan.executionAuthority,false);
  assert.equal(absentSide.plan.futureWriteOwnershipComplete,false);assert.equal(absentSide.plan.locksHeld,false);checks+=8;
  const presentSide=await json(`BEGIN; ${sideFixture} ${sideFreeze} SELECT jsonb_build_object('plan',(SELECT plan FROM qa_side_effects),
    'valid',${sideAssert()},'same',(${expr})=(SELECT baseline FROM qa_shift_instruction_state),
    'locksSame',(SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory')=
      (SELECT advisory_count FROM qa_shift_instruction_state),'retained',${retained},'merged',${merged}); ROLLBACK;`);
  assert.equal(presentSide.valid,true);assert.equal(presentSide.same,true);assert.equal(presentSide.locksSame,true);
  assert.equal(presentSide.plan.compositeResources.length,2);
  assert.equal(presentSide.plan.resources.filter(n=>n.relation==='public.stock_alerts').length,3);
  assert.ok(presentSide.plan.resources.some(n=>n.relation==='public.automation_events'));
  assert.equal(new Set(presentSide.plan.compositeResources.map(n=>n.id)).size,2);
  assert.ok(presentSide.plan.compositeResources.every(n=>n.id===`${n.identity.stock_alert_id}|${n.identity.user_id}`));
  assert.equal(presentSide.plan.catalog.functions.length,5);assert.equal(presentSide.plan.catalog.triggers.length,8);
  assert.equal(presentSide.plan.catalog.sequence.maximum,'9223372036854775807');
  assert.equal(presentSide.plan.catalog.sequenceLastValueIsBusinessEvidence,false);
  assert.equal(presentSide.plan.foreignKeys.length,10);
  assert.ok(presentSide.plan.foreignKeys.every(n=>n.parentState==='EXISTING_NOT_LOCKED'));
  assert.equal(presentSide.retained.compositeResources.length,2);assert.equal(presentSide.merged.compositeResources.length,2);
  assert.equal(presentSide.merged.resources.filter(n=>n.relation==='public.stock_alerts').length,3);
  assert.ok(presentSide.merged.resources.filter(n=>n.relation==='public.stock_alerts').every(n=>n.mode==='UPDATE'));
  assert.equal(await fingerprint(),globalBefore);checks+=19;
  passed.push('shift-side-effect-domains: absent/active/resolved alerts and two warehouses in existing SKU domain, real composite read identities, full outbox conflicts/FK parents merged without fake UUIDs; pinned catalog and bigint decimal string; zero source writes/advisories and no future ownership authority');
  const sideReject=async(mutation,pattern=/40001.*SIDE_EFFECT_CHANGED_RETRY/u)=>{
    await fails(`${sideFixture} ${sideFreeze} ${mutation} SELECT ${sideAssert()};`,pattern);
    assert.equal(await fingerprint(),globalBefore);checks+=1;
  };
  for(const mutation of [
    `UPDATE public.stock_alerts SET available_quantity=available_quantity+1 WHERE product_id=${q(product)};`,
    `UPDATE public.stock_alerts SET severity='low_stock' WHERE product_id=${q(product)} AND warehouse_id=${q(fixtureWarehouse)} AND status='active';`,
    `DELETE FROM public.stock_alert_reads WHERE user_id='92400000-0000-0000-0000-000000000002';`,
    `INSERT INTO public.stock_alert_reads(stock_alert_id,user_id) SELECT id,${q(owner)} FROM public.stock_alerts WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)} AND status='active';`,
    `DELETE FROM public.stock_alert_reads WHERE user_id='92400000-0000-0000-0000-000000000002';
      INSERT INTO public.stock_alert_reads(stock_alert_id,user_id) SELECT id,${q(owner)} FROM public.stock_alerts WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)} AND status='active';`,
    `UPDATE public.profiles SET full_name='Read parent content drift' WHERE id='92400000-0000-0000-0000-000000000002';`,
    `UPDATE public.automation_events SET payload=payload||'{"fault":"content"}'::jsonb WHERE event_key LIKE 'stock_alert:%';`,
    `UPDATE public.automation_events SET event_key=event_key||':changed' WHERE event_key LIKE 'stock_alert:%';`,
    `UPDATE qa_side_effects SET plan=jsonb_set(plan,'{compositeResources}','[]'::jsonb);`,
    `UPDATE qa_side_effects SET plan=jsonb_set(plan,'{futureWriteOwnershipComplete}','true'::jsonb);`,
    `UPDATE qa_side_effects SET plan=jsonb_set(plan,'{domains,0,activeAlert}','{}'::jsonb);`,
  ]) await sideReject(mutation);
  await fails(`${setup} ${sideFreeze}
    UPDATE public.inventory_balances SET on_hand_quantity=0 WHERE product_id=${q(product)} AND warehouse_id=${q(fixtureWarehouse)};
    SELECT ${sideAssert()};`,/40001.*SIDE_EFFECT_CHANGED_RETRY/u);
  assert.equal(await fingerprint(),globalBefore);checks+=1;
  // No sequence head enters the snapshot: ordinary allocation gaps are allowed.
  const sequenceGap=await json(`BEGIN; ${sideFixture} ${sideFreeze} SELECT nextval('public.inventory_movement_mutation_seq');
    SELECT jsonb_build_object('valid',${sideAssert()},'same',(${expr})=(SELECT baseline FROM qa_shift_instruction_state)); ROLLBACK;`);
  assert.equal(sequenceGap.valid,true);assert.equal(sequenceGap.same,true);checks+=2;
  passed.push('shift-side-effect-content-drift: row-count-preserving alert/outbox/profile mutation, missing/extra/substituted composite reads and absent-to-active membership drift reject; permitted nontransactional sequence allocation does not become business evidence');
  for(const [mutation,pattern] of [
    [`ALTER FUNCTION public.sync_stock_alert(uuid,uuid,integer,integer) SET search_path=pg_catalog;`,/23514.*SIDE_EFFECT_FUNCTION_DRIFT/u],
    [`ALTER TABLE public.inventory_balances DISABLE TRIGGER trg_sync_stock_alert_from_balance;`,/23514.*SIDE_EFFECT_TRIGGER_DRIFT/u],
    [`CREATE TRIGGER qa_extra_side_effect BEFORE UPDATE ON public.stock_alert_reads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();`,/23514.*SIDE_EFFECT_TRIGGER_DRIFT/u],
    [`ALTER TABLE public.stock_alerts DROP CONSTRAINT stock_alerts_product_id_fkey;`,/23514.*SIDE_EFFECT_FK_DRIFT/u],
    [`ALTER TABLE public.stock_alerts ADD COLUMN qa_parent uuid REFERENCES public.profiles(id);`,/23514.*SIDE_EFFECT_FK_DRIFT/u],
    [`DROP INDEX public.idx_stock_alerts_active_product_warehouse;`,/23514.*SIDE_EFFECT_INDEX_DRIFT/u],
    [`ALTER SEQUENCE public.inventory_movement_mutation_seq INCREMENT BY 2;`,/23514.*SIDE_EFFECT_SEQUENCE_DRIFT/u],
  ]) await sideReject(mutation,pattern);
  await fails(`${claims} SELECT phase5_private.discover_shift_inventory_side_effects_v1(${q(randomUUID())},NULL);`,/42501.*SHIFT_ACTOR_UNAUTHORIZED/u);
  await fails(`${claims} SELECT phase5_private.discover_shift_inventory_side_effects_v1(${q(owner)},NULL);`,/22023.*PRODUCTS_REQUIRED/u);
  await fails(`${claims} SELECT phase5_private.discover_shift_inventory_side_effects_v1(${q(owner)},ARRAY[${q(product)}::uuid,${q(product)}::uuid]);`,/23514.*PRODUCT_SET_INVALID/u);
  await fails(`${claims} SELECT phase5_private.discover_shift_inventory_side_effects_v1(${q(owner)},ARRAY[${q(randomUUID())}::uuid]);`,/23514.*PRODUCT_SET_INVALID/u);
  for(const role of ['anon','authenticated','service_role']) for(const call of [
    'phase5_private.shift_inventory_side_effect_catalog_v1()',sideCall,
    `phase5_private.assert_shift_inventory_side_effects_unchanged_v1(${q(owner)},${sideProducts},'{}'::jsonb)`]) {
    await fails(`${claims} SET LOCAL ROLE ${role}; SELECT ${call};`,/permission denied/u);
  }
  assert.equal(await fingerprint(),globalBefore);checks+=1;
  passed.push('shift-side-effect-catalog-drift: fixed function/trigger/FK/index/sequence envelope fails closed, unknown trigger rejected rather than adopted; actor-first NULL/unknown/duplicate inputs and three app-role denial; all rollback-only catalog faults restored');
  // Exercise the exact previously observed transitive writes through unchanged
  // public RPCs. Existing vs new key branches are deliberately distinct.
  for(const eventMode of ['existing-key','new-key']) {
    const pb=randomUUID();const pw=randomUUID();
    const threshold=`UPDATE public.products SET min_stock_level=5 WHERE id=${q(product)};`;
    const publicSide=await json(`BEGIN; ${claims}
      INSERT INTO public.branches(id,code,name_ar,is_active) VALUES(${q(pb)},${q('S5-'+pb)},'Source closure real RPC',true);
      INSERT INTO public.warehouses(id,branch_id,code,name_ar,is_active) VALUES(${q(pw)},${q(pb)},${q('S5-'+pw)},'Source closure real warehouse',true);
      ${eventMode==='existing-key'?threshold:''}
      INSERT INTO public.inventory_balances(product_id,warehouse_id,on_hand_quantity,reserved_quantity) VALUES(${q(product)},${q(pw)},2,0);
      SELECT public.open_cash_shift(${q(pb)},0);
      CREATE TEMP TABLE qa_public_side_sale AS SELECT public.create_pos_sale_v2(${q(pw)},${q(pb)},NULL,'Real side-effect fixture','cash',
        ${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:2,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,2000,${q(randomUUID())}) result;
      ${eventMode==='new-key'?threshold:''}
      INSERT INTO public.stock_alert_reads(stock_alert_id,user_id) SELECT id,${q(owner)} FROM public.stock_alerts WHERE product_id=${q(product)} AND warehouse_id=${q(pw)} AND status='active';
      CREATE TEMP TABLE qa_public_side_before AS SELECT (SELECT to_jsonb(t) FROM public.stock_alerts t WHERE product_id=${q(product)} AND warehouse_id=${q(pw)} AND status='active') alert,
        (SELECT count(*) FROM public.automation_events) events,(SELECT last_value FROM public.inventory_movement_mutation_seq) seq,
        ${sideCall} plan;
      CREATE TEMP TABLE qa_public_side_result AS SELECT public.reverse_cash_shift_with_operations(
        (SELECT id FROM public.cash_shifts WHERE branch_id=${q(pb)} AND status='open'),'Source closure actual public proof',${q(randomUUID())}) result;
      SELECT jsonb_build_object('saleSuccess',(SELECT result->'success' FROM qa_public_side_sale),'batchSuccess',(SELECT result->'success' FROM qa_public_side_result),
        'beforeSeverity',alert->'severity','afterSeverity',(SELECT severity FROM public.stock_alerts WHERE id=(alert->>'id')::uuid),
        'readsAfter',(SELECT count(*) FROM public.stock_alert_reads WHERE stock_alert_id=(alert->>'id')::uuid),
        'eventDelta',(SELECT count(*) FROM public.automation_events)-events,'sequenceDelta',(SELECT last_value FROM public.inventory_movement_mutation_seq)-seq,
        'alertPlanned',EXISTS(SELECT 1 FROM jsonb_array_elements(plan->'resources') n WHERE n->'row'->>'id'=alert->>'id'),
        'readPlanned',EXISTS(SELECT 1 FROM jsonb_array_elements(plan->'compositeResources') n WHERE n->'row'->>'stock_alert_id'=alert->>'id'),
        'restored',(SELECT on_hand_quantity FROM public.inventory_balances WHERE product_id=${q(product)} AND warehouse_id=${q(pw)})) FROM qa_public_side_before;
      ROLLBACK;`);
    assert.equal(publicSide.saleSuccess,true);assert.equal(publicSide.batchSuccess,true);
    assert.equal(publicSide.beforeSeverity,'out_of_stock');assert.equal(publicSide.afterSeverity,'low_stock');
    assert.equal(publicSide.readsAfter,0);assert.equal(publicSide.eventDelta,eventMode==='new-key'?1:0);
    assert.equal(publicSide.sequenceDelta,1);assert.equal(publicSide.alertPlanned,true);assert.equal(publicSide.readPlanned,true);
    assert.equal(publicSide.restored,2);assert.equal(await fingerprint(),globalBefore);checks+=11;
  }
  passed.push('shift-side-effect-public-trigger-regression: actual owner/AAL2 Cash POS and full-Shift RPC restore2, update same alert severity/delete read and exercise existing0/new1 outbox branches; every existing alert/read is now planned. Sequence gaps explicitly allowed only in disposable state; complete business content rollback, generation0/private barriers preserved');
  await reject(request,/42501.*SHIFT_ACTOR_UNAUTHORIZED/u,'',q(randomUUID()),q(randomUUID()));
  for(const jwt of [{sub:owner,role:'authenticated',aal:'aal1'},
    {sub:'92400000-0000-0000-0000-000000000002',role:'authenticated',aal:'aal2'}]) {
    await reject(request,/P0001/u,`SELECT set_config('request.jwt.claims',${q(JSON.stringify(jwt))},false);`,q(jwt.sub),q(randomUUID()));
  }
  for(const role of ['anon','authenticated','service_role']) {
    for(const call of [`phase5_private.assert_shift_payment_instructions_v1(${j(instructions)})`,
      discover(request),`phase5_private.assert_shift_payment_instructions_unchanged_v1(${q(owner)},${shift},${request},'{}'::jsonb)`,
      union,`phase5_private.assert_shift_payment_union_unchanged_v1(${q(owner)},${shift},${request},'{}'::jsonb)`,
      retained,`phase5_private.assert_shift_retained_resources_unchanged_v1(${q(owner)},${shift},'{}'::jsonb)`,
      merged,`phase5_private.assert_shift_merged_resources_unchanged_v1(${q(owner)},${shift},${request},'{}'::jsonb)`,
      `phase5_private.merge_shift_resource_snapshots_v1('[]'::jsonb)`,
      batchCall,batchAssert("'{}'::jsonb"),`phase5_private.derive_shift_batch_sources_v1('{}'::jsonb)`,
      manifestCall,manifestAssert("'{}'::jsonb"),`phase5_private.shift_pos_inventory_identities_v1('{}'::jsonb)`,
      typedContextCall,typedContextAssert("'{}'::jsonb"),
      `phase5_private.complete_shift_context_plan_v1(${q(owner)},${shift},${q(batchReason)},${q(batchKey)},${request},'{}'::jsonb,'{}'::jsonb)`,
      `phase5_private.shift_insert_fk_coverage_v1('[]'::jsonb,'[]'::jsonb)`,
      `phase5_private.complete_shift_batch_manifest_v1(${q(owner)},${shift},${q(batchReason)},${q(batchKey)},${request},'{}'::jsonb,'{}'::jsonb)`,
      `phase5_private.derive_payment_reversal_candidate_v1('{}'::jsonb,'[]'::jsonb)`]) {
      await fails(`${setup} SET LOCAL ROLE ${role}; SELECT ${call};`,/42501.*permission denied/u);
    }
  }
  assert.equal(await fingerprint(),globalBefore); checks+=1;
  passed.push('shift-instruction-role-denial: owner/AAL2/actor before source discovery; three application roles denied every new helper');
};

// Source-contract review only: unchanged public triggers generate UUIDs at INSERT.
// Removing selected alert/outbox fixture rows is privileged rollback-only setup,
// not a claim that a supported application mutation can delete those rows.
// No source trigger/default/ACL is changed and no private permit is exercised.
const shiftTriggerIdentityReviewRuntime = async (claims) => {
  const before=await fingerprint();
  const defaults=await json(`SET search_path=pg_catalog;
    SELECT jsonb_object_agg(n.nspname||'.'||c.relname,pg_get_expr(d.adbin,d.adrelid))
    FROM pg_attrdef d JOIN pg_class c ON c.oid=d.adrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=d.adnum
    WHERE a.attname='id' AND c.oid IN ('public.stock_alerts'::regclass,'public.automation_events'::regclass);`);
  assert.deepEqual(defaults,{'public.stock_alerts':'gen_random_uuid()','public.automation_events':'gen_random_uuid()'});
  checks+=1;
  for(const scenario of ['existing-key','missing-outbox-key','missing-active-alert']) {
    const b=randomUUID();const w=randomUUID();const batchKey=randomUUID();
    const expr=fingerprintQuery.trim().replace(/;$/u,'');
    const proof=await json(`BEGIN; ${claims}
      INSERT INTO public.branches(id,code,name_ar,is_active) VALUES(${q(b)},${q('S5-'+b)},'Trigger identity review',true);
      INSERT INTO public.warehouses(id,branch_id,code,name_ar,is_active)
        VALUES(${q(w)},${q(b)},${q('S5-'+w)},'Trigger identity review',true);
      UPDATE public.products SET min_stock_level=5 WHERE id=${q(product)};
      INSERT INTO public.inventory_balances(product_id,warehouse_id,on_hand_quantity,reserved_quantity)
        VALUES(${q(product)},${q(w)},2,0);
      CREATE TEMP TABLE qa_trigger_identity_shift AS SELECT public.open_cash_shift(${q(b)},0) result;
      CREATE TEMP TABLE qa_trigger_identity_sale AS SELECT public.create_pos_sale_v2(${q(w)},${q(b)},NULL,
        'Trigger identity source review','cash',${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:2,
          price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,2000,${q(randomUUID())}) result;
      CREATE TEMP TABLE qa_trigger_identity_original AS SELECT id FROM public.stock_alerts
        WHERE product_id=${q(product)} AND warehouse_id=${q(w)} AND status='active';
      INSERT INTO public.stock_alert_reads(stock_alert_id,user_id) SELECT id,${q(owner)} FROM qa_trigger_identity_original;
      ${scenario==='missing-outbox-key'?`DELETE FROM public.automation_events WHERE event_key=
        'stock_alert:'||(SELECT id::text FROM qa_trigger_identity_original)||':low_stock:'||floor(extract(epoch FROM now()))::bigint::text;`:''}
      ${scenario==='missing-active-alert'?`DELETE FROM public.stock_alerts WHERE id=(SELECT id FROM qa_trigger_identity_original);`:''}
      CREATE TEMP TABLE qa_trigger_identity_frozen AS SELECT
        phase5_private.allocate_shift_context_plan_v1(${q(owner)},
          (SELECT id FROM public.cash_shifts WHERE branch_id=${q(b)} AND status='open'),
          'Trigger identity source review',${q(batchKey)},'[]'::jsonb) plan,
        (SELECT count(*) FROM public.automation_events) event_count,now() source_trigger_time,(${expr}) baseline;
      CREATE TEMP TABLE qa_trigger_identity_after AS SELECT public.reverse_cash_shift_with_operations(
        (SELECT id FROM public.cash_shifts WHERE branch_id=${q(b)} AND status='open'),
        'Trigger identity source review',${q(batchKey)}) result;
      SELECT jsonb_build_object('saleSuccess',(SELECT result->'success' FROM qa_trigger_identity_sale),
        'reverseSuccess',(SELECT result->'success' FROM qa_trigger_identity_after),
        'inventory',(SELECT on_hand_quantity FROM public.inventory_balances WHERE product_id=${q(product)} AND warehouse_id=${q(w)}),
        'alert',to_jsonb(a),'originalAlertId',(SELECT id FROM qa_trigger_identity_original),
        'event',to_jsonb(e),'eventDelta',(SELECT count(*) FROM public.automation_events)-f.event_count,
        'readsAfter',(SELECT count(*) FROM public.stock_alert_reads WHERE stock_alert_id=a.id),
        'exactTime',a.last_updated_at=f.source_trigger_time,
        'keyMatchesActualAlertAndSourceTime',e.event_key='stock_alert:'||a.id::text||':low_stock:'||floor(extract(epoch FROM f.source_trigger_time))::bigint::text,
        'alertWasPlanned',EXISTS(SELECT 1 FROM jsonb_array_elements(f.plan->'manifest'->'existingResources') n
          WHERE n->>'relation'='public.stock_alerts' AND n->>'id'=a.id::text),
        'eventWasPlanned',EXISTS(SELECT 1 FROM jsonb_array_elements(f.plan->'manifest'->'existingResources') n
          WHERE n->>'relation'='public.automation_events' AND n->>'id'=e.id::text),
        'plannedNewAlertOrOutboxRows',(SELECT count(*) FROM jsonb_array_elements(f.plan->'manifest'->'plannedInsertFkRows') n
          WHERE n->>'relation' IN ('public.stock_alerts','public.automation_events')),
        'actualIdsOutsidePlannedInsertSet',NOT EXISTS(SELECT 1 FROM jsonb_array_elements(f.plan->'manifest'->'plannedInsertFkRows') n
          WHERE n->>'id' IN (a.id::text,e.id::text)),
        'stillPreparation',f.plan->'executionAuthority'='false'::jsonb AND f.plan->'heldPlanComplete'='false'::jsonb,
        'contentChanged',(${expr}) IS DISTINCT FROM f.baseline)
      FROM qa_trigger_identity_frozen f JOIN public.stock_alerts a ON a.product_id=${q(product)} AND a.warehouse_id=${q(w)} AND a.status='active'
        JOIN public.automation_events e ON e.event_key='stock_alert:'||a.id::text||':low_stock:'||floor(extract(epoch FROM f.source_trigger_time))::bigint::text;
      ROLLBACK;`);
    assert.equal(proof.saleSuccess,true);assert.equal(proof.reverseSuccess,true);assert.equal(proof.inventory,2);
    assert.equal(proof.alert.severity,'low_stock');assert.equal(proof.alert.status,'active');
    assert.equal(proof.readsAfter,0);assert.equal(proof.exactTime,true);assert.equal(proof.keyMatchesActualAlertAndSourceTime,true);
    assert.equal(proof.event.entity_id,proof.alert.id);assert.equal(proof.event.event_type,'low_stock');
    assert.equal(proof.plannedNewAlertOrOutboxRows,0);assert.equal(proof.actualIdsOutsidePlannedInsertSet,true);
    assert.equal(proof.stillPreparation,true);assert.equal(proof.contentChanged,true);
    assert.equal(proof.eventDelta,scenario==='existing-key'?0:1);
    assert.equal(proof.alertWasPlanned,scenario!=='missing-active-alert');
    assert.equal(proof.eventWasPlanned,scenario==='existing-key');
    if(scenario==='missing-active-alert') assert.notEqual(proof.alert.id,proof.originalAlertId);
    else assert.equal(proof.alert.id,proof.originalAlertId);
    assert.equal(await fingerprint(),before);
    checks+=19;
    passed.push(`shift-trigger-identity-${scenario}: actual unchanged public Cash POS/full-Shift RPC; exact existing/new UUID membership and transaction-time event key, full business rollback; no private execution permission`);
  }
  assert.equal(await json(`SELECT to_jsonb(generation) FROM phase5_private.authority_generation WHERE singleton;`),0);
  checks+=1;
  passed.push('shift-trigger-identity-contract-limit: current private manifest owns neither new alert nor outbox UUID; current014/057/099 defaults generate them inside unchanged triggers. Existing-key row is covered, new rows are not preallocated/consumed from the private plan. No trigger/default/GUC/ACL suppression or source behavior correction applied');
};

const shiftInventoryIdentityUnionRuntime = async ({setup,args,before,scenario}) => {
  const plan=`phase5_private.plan_shift_inventory_identity_union_v1(${args},
    (SELECT plan->'contextPlan' FROM qa_side_effect_plan),
    (SELECT plan->'inventoryModel'->'allocation' FROM qa_side_effect_plan))`;
  const prepared=`${setup} CREATE TEMP TABLE qa_identity_union AS SELECT ${plan} plan;`;
  const assertion=`phase5_private.assert_shift_inventory_identity_union_v1(${args},(SELECT plan FROM qa_identity_union))`;
  const expr=fingerprintQuery.trim().replace(/;$/u,'');
  const clean=await json(`BEGIN; ${prepared} SELECT jsonb_build_object('plan',(SELECT plan FROM qa_identity_union),
    'valid',${assertion},'same',(${expr})=(SELECT content FROM qa_side_effect_baseline),
    'locksSame',(SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory')=(SELECT locks FROM qa_side_effect_baseline)); ROLLBACK;`);
  assert.equal(clean.valid,true);assert.equal(clean.same,true);assert.equal(clean.locksSame,true);
  const union=clean.plan;
  assert.deepEqual(union.plannedRows,[...union.parentRows,...union.stockRows]);
  assert.equal(new Set(union.plannedRows.map(n=>n.id)).size,union.plannedRows.length);
  assert.ok(union.parentRows.some(n=>n.relation==='phase5_private.mutation_contexts'));
  assert.ok(union.parentRows.some(n=>n.relation==='public.inventory_movements'));
  assert.equal(union.stockRows.length,scenario==='existing-key'?0:scenario==='missing-outbox-key'?1:2);
  for(const n of union.plannedRows) assert.equal(n.id,n.row.id);
  for(const edge of union.foreignKeys) {
    assert.ok(union.plannedRows.some(n=>n.relation===edge.relation&&n.id===edge.id));
    if(edge.parentState==='FUTURE_NOT_CLAIMED') assert.ok(union.plannedRows.some(n=>n.relation===edge.parentRelation&&n.id===edge.parentId));
  }
  for(const key of ['durableClaimsCreated','locksHeld','executionAuthority','futureWriteOwnershipComplete','sourceWriteTriggerClosureComplete']) assert.equal(union[key],false);
  assert.equal(await fingerprint(),before);checks+=16;
  if(scenario==='missing-active-alert') {
    const mutations=[
      ['{plannedRows}',"(plan->'plannedRows')-0"],
      ['{plannedRows}',"(plan->'plannedRows')||jsonb_build_array(plan->'plannedRows'->0)"],
      ['{parentRows,1}',"plan->'parentRows'->0"],
      ['{stockRows,0,id}',"plan->'parentRows'->0->'id'"],
      ['{plannedRows,0,row,id}',j(randomUUID())],
      ['{foreignKeys}',"'[]'::jsonb"],
      ['{foreignKeys,0,parentId}',j(randomUUID())],
      ['{existingResources,0,row,id}',j(randomUUID())],
      ['{sourcePlan,identityManifest,eventKeyBindings}',"'[]'::jsonb"],
      ['{directPlannedInsertCoverageComplete}',"'false'::jsonb"],
      ['{executionAuthority}',"'true'::jsonb"],
    ];
    for(const [path,value] of mutations) {
      await fails(`${prepared} UPDATE qa_identity_union SET plan=jsonb_set(plan,${q(path)},${value}); SELECT ${assertion};`,
        /40001.*PHASE5_IDENTITY_UNION_CHANGED_RETRY/u);
      assert.equal(await fingerprint(),before);checks+=1;
    }
    // A new alert UUID may not alias a future inventory movement or context.
    for(const rowIndex of [0,1]) {
      await fails(`${prepared} UPDATE qa_side_effect_plan SET plan=jsonb_set(plan,'{inventoryModel,allocation,0,alertId}',
        (SELECT plan->'parentRows'->${rowIndex}->'id' FROM qa_identity_union)); SELECT ${plan};`,
        /23505.*PHASE5_SIDE_EFFECT_FUTURE_ID_ALREADY_OWNED/u);
      assert.equal(await fingerprint(),before);checks+=1;
    }
    for(const role of ['anon','authenticated','service_role']) {
      for(const call of [plan,assertion]) await fails(`${prepared} SET LOCAL ROLE ${role}; SELECT ${call};`,/42501.*permission denied/u);
    }
    assert.equal(await fingerprint(),before);checks+=1;
  }
  passed.push(`shift-inventory-identity-union-${scenario}: exact parent/context/source/alert/event UUID union and combined direct FK coverage, collisions/tuple substitutions reject; no durable claims/locks/consumer authority`);
};

const inventoryIdentityManifestRuntime = async ({setup,model,wrapper,baseline,before,label,adversarial=false}) => {
  const compiler=`phase5_private.derive_inventory_identity_manifest_v1(${q(owner)},${model},
    ARRAY(SELECT jsonb_array_elements_text(plan->'identityManifest'->'reservedIdentities')::uuid FROM qa_identity_plan))`;
  const assertion=`phase5_private.assert_inventory_identity_manifest_v1(${q(owner)},${model},
    ARRAY(SELECT jsonb_array_elements_text(plan->'identityManifest'->'reservedIdentities')::uuid FROM qa_identity_plan),
    (SELECT plan->'identityManifest' FROM qa_identity_plan))`;
  const prepared=`${setup} CREATE TEMP TABLE qa_identity_plan AS SELECT ${wrapper} plan;`;
  const expr=fingerprintQuery.trim().replace(/;$/u,'');
  const clean=await json(`BEGIN; ${prepared} SELECT jsonb_build_object('plan',(SELECT plan FROM qa_identity_plan),
    'valid',${assertion},'unchanged',(${expr})=(SELECT content FROM ${baseline}),
    'locksSame',(SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory')=(SELECT locks FROM ${baseline})); ROLLBACK;`);
  assert.equal(clean.valid,true);assert.equal(clean.unchanged,true);assert.equal(clean.locksSame,true);
  const manifest=clean.plan.identityManifest;
  assert.equal(clean.plan.sourceBindingComplete,true);assert.equal(manifest.sourceBindingComplete,false);
  for(const key of ['durableClaimsCreated','locksHeld','executionAuthority','futureWriteOwnershipComplete']) {
    assert.equal(clean.plan[key],false);assert.equal(manifest[key],false);
  }
  assert.equal(manifest.authoritySnapshot.executionAllowed,false);
  assert.deepEqual(manifest.sourceSteps,clean.plan.parentPlan.inventoryModel.sourceSteps);
  assert.deepEqual(manifest.uuidClaims.map(c=>({relation:c.relation,id:c.id,row:c.row})),clean.plan.parentPlan.inventoryModel.plannedInserts);
  assert.equal(new Set(manifest.uuidClaims.map(c=>c.id)).size,manifest.uuidClaims.length);
  assert.ok(manifest.reservedIdentities.includes(owner));
  for(const binding of manifest.eventKeyBindings) {
    const step=clean.plan.parentPlan.inventoryModel.steps[binding.ordinal-1];
    assert.deepEqual(binding.source,step.source);assert.deepEqual(binding.invocation,step.eventInvocation);
    assert.deepEqual(binding.storedRow,step.storedEvent);
    if(binding.disposition==='REUSE_PREEXISTING') {
      assert.equal(binding.ownerOrdinal,null);assert.equal(binding.ownerStepId,null);
    } else {
      const ownerClaim=manifest.uuidClaims.find(c=>c.relation==='public.automation_events'&&c.id===binding.eventId);
      assert.ok(ownerClaim);assert.equal(binding.ownerOrdinal,ownerClaim.ordinal);assert.equal(binding.ownerStepId,ownerClaim.stepId);
    }
  }
  assert.equal(await fingerprint(),before);checks+=18;
  if(adversarial) {
    assert.ok(manifest.uuidClaims.length>=2);assert.ok(manifest.eventKeyBindings.length>0);
    const mutations=[
      ['{identityManifest,uuidClaims}',"(plan->'identityManifest'->'uuidClaims')-0"],
      ['{identityManifest,uuidClaims}',"(plan->'identityManifest'->'uuidClaims')||jsonb_build_array(plan->'identityManifest'->'uuidClaims'->0)"],
      ['{identityManifest,uuidClaims,1}',"plan->'identityManifest'->'uuidClaims'->0"],
      ['{identityManifest,uuidClaims,0,stepId}',"'\"FOREIGN-STEP\"'::jsonb"],
      ['{identityManifest,uuidClaims,0,source,orderItemId}',j(randomUUID())],
      ['{identityManifest,uuidClaims,0,row,id}',j(randomUUID())],
      ['{identityManifest,eventKeyBindings,0,eventId}',j(randomUUID())],
      ['{identityManifest,eventKeyBindings,0,ownerOrdinal}',"'99'::jsonb"],
      ['{identityManifest,eventKeyBindings,0,storedRow,payload,availableQuantity}',"'99'::jsonb"],
      ['{identityManifest,eventKeyBindings}',"'[]'::jsonb"],
      ['{identityManifest,readDeletions}',"'null'::jsonb"],
      ['{identityManifest,durableClaimsCreated}',"'true'::jsonb"],
      ['{identityManifest,authoritySnapshot}',"'{}'::jsonb"],
    ];
    for(const [path,value] of mutations) {
      await fails(`${prepared} UPDATE qa_identity_plan SET plan=jsonb_set(plan,${q(path)},${value}); SELECT ${assertion};`,
        /40001.*PHASE5_IDENTITY_MANIFEST_CHANGED_RETRY/u);
      assert.equal(await fingerprint(),before);checks+=1;
    }
    await fails(`${prepared} SELECT phase5_private.derive_inventory_identity_manifest_v1(${q(owner)},${model},
      ARRAY[(SELECT (plan->'identityManifest'->'uuidClaims'->0->>'id')::uuid FROM qa_identity_plan)]);`,
    /23505.*PHASE5_IDENTITY_PARENT_COLLISION/u);
    for(const reserved of ['NULL::uuid[]','ARRAY[NULL::uuid]']) {
      await fails(`${prepared} SELECT phase5_private.derive_inventory_identity_manifest_v1(${q(owner)},${model},${reserved});`,
        /22023.*PHASE5_IDENTITY_PLAN_REQUIRED/u);
    }
    await fails(`${prepared} SELECT phase5_private.derive_inventory_identity_manifest_v1(${q(randomUUID())},${model},ARRAY[]::uuid[]);`,
      /42501.*PHASE5_IDENTITY_ACTOR_UNAUTHORIZED/u);
    await fails(`${prepared} ALTER FUNCTION phase5_private.plan_shift_inventory_identity_manifest_v1(uuid,uuid,text,text,jsonb,jsonb,jsonb)
      SET search_path=public; SELECT ${assertion};`,/40001.*PHASE5_IDENTITY_MANIFEST_CHANGED_RETRY/u);
    for(const role of ['anon','authenticated','service_role']) {
      for(const call of [wrapper,compiler,assertion]) {
        await fails(`${prepared} SET LOCAL ROLE ${role}; SELECT ${call};`,/42501.*permission denied/u);
      }
    }
    assert.equal(await fingerprint(),before);checks+=1;
  }
  passed.push(`inventory-identity-manifest-${label}: exact per-source insert/key/read tuples, immutable first owner, fresh authority drift and zero-write preparation; NOT durable claims/consumer authority`);
};

// Private planning proof, NOT operational trigger consumption. Actual public
// sales provide independent immutable item/source anchors. All fault fixtures
// are rollback-only; no public guard/default/trigger/ACL is changed.
const inventorySideEffectPlanRuntime = async (claims) => {
  const before=await fingerprint();
  const expr=fingerprintQuery.trim().replace(/;$/u,'');
  for(const scenario of ['existing-key','missing-outbox-key','missing-active-alert']) {
    const b=randomUUID();const w=randomUUID();const key=randomUUID();
    const shift='(SELECT id FROM public.cash_shifts WHERE branch_id='+q(b)+" AND status='open')";
    const args=`${q(owner)},${shift},'Private side-effect plan',${q(key)},'[]'::jsonb`;
    const setup=`${claims}
      INSERT INTO public.branches(id,code,name_ar,is_active) VALUES(${q(b)},${q('S5-'+b)},'Side effect plan',true);
      INSERT INTO public.warehouses(id,branch_id,code,name_ar,is_active) VALUES(${q(w)},${q(b)},${q('S5-'+w)},'Side effect plan',true);
      UPDATE public.products SET min_stock_level=5 WHERE id=${q(product)};
      INSERT INTO public.inventory_balances(product_id,warehouse_id,on_hand_quantity,reserved_quantity) VALUES(${q(product)},${q(w)},2,0);
      SELECT public.open_cash_shift(${q(b)},0);
      CREATE TEMP TABLE qa_side_effect_sale AS SELECT public.create_pos_sale_v2(${q(w)},${q(b)},NULL,'Two source identities','cash',
        ${j([1,1].map(quantity=>({commercial_line_kind:'base_unit',product_id:product,base_quantity:quantity,
          price_authority:'server_catalog',line_discount_in_minor_units:0})))},0,2000,${q(randomUUID())}) result;
      CREATE TEMP TABLE qa_side_effect_alert AS SELECT id FROM public.stock_alerts WHERE product_id=${q(product)} AND warehouse_id=${q(w)} AND status='active';
      INSERT INTO public.stock_alert_reads(stock_alert_id,user_id) SELECT id,${q(owner)} FROM qa_side_effect_alert;
      ${scenario==='missing-outbox-key'?`DELETE FROM public.automation_events WHERE event_key='stock_alert:'||
        (SELECT id::text FROM qa_side_effect_alert)||':low_stock:'||floor(extract(epoch FROM now()))::bigint::text;`:''}
      ${scenario==='missing-active-alert'?`DELETE FROM public.stock_alerts WHERE id=(SELECT id FROM qa_side_effect_alert);`:''}
      CREATE TEMP TABLE qa_side_effect_baseline AS SELECT (${expr}) content,
        (SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory') locks;
      CREATE TEMP TABLE qa_side_effect_plan AS SELECT phase5_private.allocate_shift_inventory_side_effect_plan_v1(${args}) plan;`;
    const assertion=`phase5_private.assert_shift_inventory_side_effect_plan_v1(${args},(SELECT plan FROM qa_side_effect_plan))`;
    const clean=await json(`BEGIN; ${setup} SELECT jsonb_build_object('plan',(SELECT plan FROM qa_side_effect_plan),
      'valid',${assertion},'sale',(SELECT result->'success' FROM qa_side_effect_sale),'same',(${expr})=(SELECT content FROM qa_side_effect_baseline),
      'locksSame',(SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory')=(SELECT locks FROM qa_side_effect_baseline)); ROLLBACK;`);
    assert.equal(clean.valid,true);assert.equal(clean.sale,true);assert.equal(clean.same,true);assert.equal(clean.locksSame,true);
    assert.equal(clean.plan.sourceBindingComplete,true);assert.equal(clean.plan.executionAuthority,false);
    assert.equal(clean.plan.futureWriteOwnershipComplete,false);assert.equal(clean.plan.sourceWriteTriggerClosureComplete,false);
    const model=clean.plan.inventoryModel;
    assert.equal(model.sourceBindingComplete,false);assert.equal(model.steps.length,2);
    assert.deepEqual(model.steps.map(s=>[s.source.onHandBefore,s.source.onHandAfter]),[[0,1],[1,2]]);
    assert.notEqual(model.steps[0].source.orderItemId,model.steps[1].source.orderItemId);
    assert.equal(model.steps[0].source.orderId,clean.plan.contextPlan.manifest.allocation.inventory[0].orderId);
    assert.equal(model.steps[0].eventDisposition,scenario==='existing-key'?'REUSE_PREEXISTING':'INSERT_NEW');
    assert.equal(model.steps[1].eventDisposition,'NONE');
    assert.equal(model.steps[0].deletedReads.length,scenario==='missing-active-alert'?0:1);
    assert.equal(model.steps[1].deletedReads.length,0);
    assert.equal(model.plannedInserts.filter(n=>n.relation==='public.stock_alerts').length,scenario==='missing-active-alert'?1:0);
    assert.equal(model.plannedInserts.filter(n=>n.relation==='public.automation_events').length,scenario==='existing-key'?0:1);
    assert.equal(model.steps[0].storedEvent.payload.availableQuantity,scenario==='existing-key'?2:1);
    assert.equal(model.steps[0].eventInvocation.payload.availableQuantity,1);
    assert.equal(model.steps[0].storedEvent.entity_id,model.steps[0].alertAfter.id);
    assert.equal(model.sourceTransactionAt,model.steps[0].alertAfter.last_updated_at);
    assert.equal(await fingerprint(),before);checks+=24;
    passed.push(`inventory-side-effect-source-binding-${scenario}: actual two-item POS -> independently verified context/manifest -> exact ordered model/allocation, first-wins payload and zero source/advisory writes; no claims/execution`);
    if(inventoryIdentityCoverage) await inventoryIdentityManifestRuntime({setup,before,label:`POS-${scenario}`,
      model:"(SELECT plan->'inventoryModel' FROM qa_side_effect_plan)",baseline:'qa_side_effect_baseline',
      wrapper:`phase5_private.plan_shift_inventory_identity_manifest_v1(${args},
        (SELECT plan->'contextPlan' FROM qa_side_effect_plan),(SELECT plan->'inventoryModel'->'allocation' FROM qa_side_effect_plan))`,
      adversarial:scenario==='missing-active-alert'});
    if(inventoryIdentityCoverage) await shiftInventoryIdentityUnionRuntime({setup,args,before,scenario});
    if(scenario==='missing-outbox-key') {
      const mutations=[
        "plan=jsonb_set(plan,'{executionAuthority}','true'::jsonb)",
        "plan=jsonb_set(plan,'{inventoryModel,steps,0,source,onHandAfter}','99'::jsonb)",
        "plan=jsonb_set(plan,'{inventoryModel,steps,0,alertAfter,available_quantity}','99'::jsonb)",
        "plan=jsonb_set(plan,'{inventoryModel,steps,0,storedEvent,payload,availableQuantity}','99'::jsonb)",
        "plan=jsonb_set(plan,'{inventoryModel,steps}',(plan->'inventoryModel'->'steps')-0)",
        "plan=jsonb_set(plan,'{inventoryModel,allocation}',(plan->'inventoryModel'->'allocation')||jsonb_build_array(plan->'inventoryModel'->'allocation'->0))",
        "plan=jsonb_set(plan,'{inventoryModel,allocation,1}',plan->'inventoryModel'->'allocation'->0)",
        "plan=jsonb_set(plan,'{inventoryModel,allocation,0,eventId}','null'::jsonb)",
        `plan=jsonb_set(plan,'{inventoryModel,allocation,0,eventId}',to_jsonb(${q(product)}::text))`,
        `plan=jsonb_set(plan,'{inventoryModel,allocation,0,eventId}',plan->'contextPlan'->'contextAllocation'->'batchContextId')`,
        `plan=jsonb_set(plan,'{inventoryModel,allocation,1,eventId}',to_jsonb(${q(randomUUID())}::text))`,
        "plan=jsonb_set(plan,'{contextPlan,manifest,allocation,inventory,1}',plan->'contextPlan'->'manifest'->'allocation'->'inventory'->0)",
      ];
      for(const mutation of mutations) {
        await fails(`${setup} UPDATE qa_side_effect_plan SET ${mutation}; SELECT ${assertion};`);
        assert.equal(await fingerprint(),before);checks+=1;
      }
      for(const mutation of [
        `UPDATE public.warehouses SET name_ar='Different payload label' WHERE id=${q(w)};`,
        `UPDATE public.stock_alert_reads SET read_at=read_at-interval '1 hour' WHERE stock_alert_id=(SELECT id FROM qa_side_effect_alert);`,
        `DELETE FROM public.stock_alert_reads WHERE stock_alert_id=(SELECT id FROM qa_side_effect_alert);`,
      ]) {
        await fails(`${setup} ${mutation} SELECT ${assertion};`);
        assert.equal(await fingerprint(),before);checks+=1;
      }
      passed.push('inventory-side-effect-plan-corruption: altered flags/quantities/alert/payload/missing/extra/substituted allocation, absent/owned/context UUID, A,B -> A,A item identity and same-count label/read drift reject with rollback');
      const kernel=`phase5_private.model_inventory_alert_steps_v1(${q(owner)},
        (SELECT plan->'inventoryModel'->'sourceSteps' FROM qa_side_effect_plan),NULL)`;
      const sequenceProof=await json(`BEGIN; ${setup}
        CREATE TEMP TABLE qa_side_effect_chain AS
        SELECT jsonb_agg((seed-'stepId')||jsonb_build_object('stepId','HYPOTHETICAL-'||ord,
          'onHandBefore',v.before_qty,'onHandAfter',v.after_qty) ORDER BY ord) source_steps
        FROM (SELECT plan->'inventoryModel'->'sourceSteps'->0 seed FROM qa_side_effect_plan) s
        CROSS JOIN (VALUES(1,0,1),(2,1,0),(3,0,2),(4,2,6),(5,6,1)) v(ord,before_qty,after_qty);
        CREATE TEMP TABLE qa_side_effect_chain_model AS
          SELECT phase5_private.model_inventory_alert_steps_v1(${q(owner)},(SELECT source_steps FROM qa_side_effect_chain),NULL) model;
        SELECT jsonb_build_object('model',model,'identityManifest',${inventoryIdentityCoverage
          ? `phase5_private.derive_inventory_identity_manifest_v1(${q(owner)},model,ARRAY[]::uuid[])`
          : "'null'::jsonb"}) FROM qa_side_effect_chain_model; ROLLBACK;`);
      const sequence=sequenceProof.model;
      assert.equal(sequence.sourceBindingComplete,false);
      assert.deepEqual(sequence.steps.map(s=>s.eventDisposition),['INSERT_NEW','REUSE_PREEXISTING','REUSE_EARLIER_PLANNED','NONE','INSERT_NEW']);
      assert.equal(sequence.steps[2].storedEvent.payload.availableQuantity,1);
      assert.equal(sequence.steps[2].eventInvocation.payload.availableQuantity,2);
      assert.equal(sequence.steps[0].storedEvent.id,sequence.steps[2].storedEvent.id);
      assert.equal(sequence.steps[3].alertAfter.status,'resolved');
      assert.notEqual(sequence.steps[0].alertAfter.id,sequence.steps[4].alertAfter.id);
      assert.equal(sequence.plannedInserts.length,3);
      assert.deepEqual(sequence.steps.map(s=>s.deletedReads.length),[1,0,0,0,0]);
      assert.equal(await fingerprint(),before);checks+=10;
      if(inventoryIdentityCoverage) {
        const identity=sequenceProof.identityManifest;
        assert.equal(identity.sourceBindingComplete,false);assert.equal(identity.durableClaimsCreated,false);
        assert.equal(identity.uuidClaims.length,3);
        const first=identity.eventKeyBindings.find(b=>b.ordinal===1);
        const repeated=identity.eventKeyBindings.find(b=>b.ordinal===3);
        assert.equal(repeated.disposition,'REUSE_EARLIER_PLANNED');
        assert.equal(repeated.ownerOrdinal,first.ordinal);assert.equal(repeated.ownerStepId,first.stepId);
        assert.equal(repeated.eventId,first.eventId);
        assert.equal(repeated.storedRow.payload.availableQuantity,1);
        assert.equal(repeated.invocation.payload.availableQuantity,2);
        assert.notEqual(identity.eventKeyBindings.find(b=>b.ordinal===5).eventId,first.eventId);
        checks+=10;
        passed.push('inventory-identity-first-owner: hypothetical repeated key has one UUID owner despite distinct later invocation payload; resolved/new alert gets a distinct owner and generic model remains unbound');
      }
      for(const field of ['sourceKind','onHandBefore']) {
        await fails(`${setup} UPDATE qa_side_effect_plan SET plan=jsonb_set(plan,'{inventoryModel,sourceSteps,0,${field}}','null'::jsonb);
          SELECT ${kernel};`);
      }
      // componentId JSON null is valid for Base Unit; absent is not.
      await fails(`${setup} UPDATE qa_side_effect_plan SET plan=jsonb_set(plan,'{inventoryModel,sourceSteps,0}',
        (plan->'inventoryModel'->'sourceSteps'->0)-'componentId'); SELECT ${kernel};`);
      for(const quantity of [-1,1.1,'1']) {
        await fails(`${setup} UPDATE qa_side_effect_plan SET plan=jsonb_set(plan,'{inventoryModel,sourceSteps,0,onHandAfter}',${j(quantity)});
          SELECT ${kernel};`,/22023.*QUANTITY_INVALID/u);
      }
      passed.push('inventory-side-effect-ordered-model: hypothetical five-step same-SKU severity/resolution/new-alert chain, first-wins repeated key with distinct payload; unbound model explicitly cannot mint source authority');
      for(const role of ['anon','authenticated','service_role']) {
        for(const call of [kernel,assertion,
          `phase5_private.allocate_shift_inventory_side_effect_plan_v1(${args})`,
          `phase5_private.complete_shift_inventory_side_effect_plan_v1(${args},(SELECT plan->'contextPlan' FROM qa_side_effect_plan),
            (SELECT plan->'inventoryModel'->'allocation' FROM qa_side_effect_plan))`]) {
          await fails(`${setup} SET LOCAL ROLE ${role}; SELECT ${call};`,/permission denied/u);
        }
      }
      await fails(`${setup} SELECT phase5_private.model_inventory_alert_steps_v1(${q(randomUUID())},'[]',NULL);`,/42501.*ACTOR_UNAUTHORIZED/u);
      passed.push('inventory-side-effect-role-denial: all four helpers denied anon/authenticated/service_role; actor-first guard rejects another actor; four barriers/generation0 retained');
    }
  }
  assert.equal(await fingerprint(),before);checks+=1;
};

const completionInventoryIdentityUnionRuntime = async ({setup,args,kind,before}) => {
  // Missing active alerts forces genuine future stock rows, not a count-only
  // empty-set proof. Fixture setup is rollback-only and baseline follows it.
  setup=setup.replace('CREATE TEMP TABLE qa_completion_side_baseline',
    `DELETE FROM public.stock_alerts WHERE product_id IN (${q(product)},'92400000-0000-0000-0000-000000000102');
      CREATE TEMP TABLE qa_completion_side_baseline`);
  const plan=`phase5_private.plan_${kind}_inventory_identity_union_v1(${args},
    (SELECT plan->'inventoryModel'->'allocation' FROM qa_completion_side_plan),NULL)`;
  const prepared=`${setup} CREATE TEMP TABLE qa_completion_union AS SELECT ${plan} plan;`;
  const assertion=`phase5_private.assert_${kind}_inventory_identity_union_v1(${args},(SELECT plan FROM qa_completion_union))`;
  const expr=fingerprintQuery.trim().replace(/;$/u,'');
  const clean=await json(`BEGIN; ${prepared} SELECT jsonb_build_object('plan',(SELECT plan FROM qa_completion_union),
    'valid',${assertion},'same',(${expr})=(SELECT content FROM qa_completion_side_baseline),
    'locksSame',(SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory')=(SELECT locks FROM qa_completion_side_baseline)); ROLLBACK;`);
  assert.equal(clean.valid,true);assert.equal(clean.same,true);assert.equal(clean.locksSame,true);
  const u=clean.plan.inventoryUnion,sources=clean.plan.sourcePlan.inventoryModel.sourceSteps;
  assert.equal(clean.plan.sourceBindingComplete,true);assert.equal(u.sourceBindingComplete,false);
  assert.deepEqual(u.plannedRows,[...u.parentRows,...u.stockRows]);
  assert.ok(u.stockRows.some(n=>n.relation==='public.stock_alerts'));
  assert.ok(u.stockRows.some(n=>n.relation==='public.automation_events'));
  assert.equal(new Set(u.plannedRows.map(n=>n.id)).size,u.plannedRows.length);
  assert.deepEqual(u.movementAllocation.map(n=>n.sourceId),sources.map(n=>n.sourceId));
  assert.equal(u.parentRows.length,sources.length);
  for(const [i,m] of u.parentRows.entries()) {
    const s=sources[i];assert.equal(m.id,m.row.id);assert.equal(m.id,u.movementAllocation[i].movementId);
    assert.equal(m.sourceId,s.sourceId);assert.equal(m.row.reference_id,s.orderId);
    assert.equal(m.row.warehouse_id,s.warehouseId);assert.equal(m.row.product_id,s.productId);
    assert.equal(m.row.quantity,s.onHandAfter-s.onHandBefore);
    assert.equal(m.row.operation_id,kind==='customer'?clean.plan.sourcePlan.sourcePlan.creation.id:null);
    assert.equal(m.row.reservation_id,kind==='customer'?s.sourceId:null);
    assert.equal(m.row.parcel_component_id,s.componentId);
  }
  assert.ok(u.existingResources.some(n=>n.relation==='public.user_roles'&&n.id.includes(':')));
  for(const e of u.foreignKeys.filter(n=>n.parentState!=='NOT_APPLICABLE')) {
    assert.ok([...u.plannedRows,...u.existingResources].some(p=>p.relation===e.parentRelation&&p.id===e.parentId));
  }
  for(const target of [clean.plan,u]) for(const flag of ['durableClaimsCreated','locksHeld','executionAuthority','futureWriteOwnershipComplete','futureCompletionInsertCoverageComplete']) assert.equal(target[flag],false);
  assert.equal(await fingerprint(),before);checks+=18;
  const mutations=[
    ['{inventoryUnion,parentRows}',"(plan->'inventoryUnion'->'parentRows')-0"],
    ['{inventoryUnion,parentRows}',"(plan->'inventoryUnion'->'parentRows')||jsonb_build_array(plan->'inventoryUnion'->'parentRows'->0)"],
    ['{inventoryUnion,parentRows,1}',"plan->'inventoryUnion'->'parentRows'->0"],
    ['{inventoryUnion,plannedRows,0,row,quantity}',"'99'::jsonb"],
    ['{inventoryUnion,plannedRows,0,row,reference_id}',j(randomUUID())],
    ['{inventoryUnion,plannedRows,0,row,warehouse_id}',j(randomUUID())],
    ['{inventoryUnion,foreignKeys}',"'[]'::jsonb"],
    ['{inventoryUnion,identityManifest,eventKeyBindings}',"'[]'::jsonb"],
    ['{inventoryUnion,existingResources,0,row,id}',j(randomUUID())],
    ['{inventoryUnion,futureCompletionInsertCoverageComplete}',"'true'::jsonb"],
  ];
  for(const [path,value] of mutations) {
    await fails(`${prepared} UPDATE qa_completion_union SET plan=jsonb_set(plan,${q(path)},${value}); SELECT ${assertion};`,/40001.*PHASE5_COMPLETION_UNION_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),before);checks+=1;
  }
  const replan=`phase5_private.plan_${kind}_inventory_identity_union_v1(${args},
    (SELECT plan->'sourcePlan'->'inventoryModel'->'allocation' FROM qa_completion_union),
    (SELECT plan->'inventoryUnion'->'movementAllocation' FROM qa_completion_union))`;
  for(const [path,value,pattern] of [
    ['{inventoryUnion,movementAllocation}',"(plan->'inventoryUnion'->'movementAllocation')-0",/23514.*SOURCE_EXACT_SET_REQUIRED/u],
    ['{inventoryUnion,movementAllocation}',"(plan->'inventoryUnion'->'movementAllocation')||jsonb_build_array(plan->'inventoryUnion'->'movementAllocation'->0)",/23514.*SOURCE_EXACT_SET_REQUIRED/u],
    ['{inventoryUnion,movementAllocation,1,sourceId}',"plan->'inventoryUnion'->'movementAllocation'->0->'sourceId'",/23514.*SOURCE_EXACT_SET_REQUIRED/u],
    ['{inventoryUnion,movementAllocation,1,movementId}',"plan->'inventoryUnion'->'movementAllocation'->0->'movementId'",/23505.*ID_COLLISION/u],
    ['{inventoryUnion,movementAllocation,0,movementId}',j(product),/23505.*ID_COLLISION/u],
    ['{inventoryUnion,movementAllocation,0,movementId}',"plan->'inventoryUnion'->'stockRows'->0->'id'",/23505.*PHASE5_IDENTITY_PARENT_COLLISION/u],
    ['{inventoryUnion,movementAllocation,0,movementId}',"'null'::jsonb",/22023|23514/u],
  ]) {
    await fails(`${prepared} UPDATE qa_completion_union SET plan=jsonb_set(plan,${q(path)},${value}); SELECT ${replan};`,pattern);
    assert.equal(await fingerprint(),before);checks+=1;
  }
  for(const role of ['anon','authenticated','service_role']) for(const call of [plan,assertion]) {
    await fails(`${prepared} SET LOCAL ROLE ${role}; SELECT ${call};`,/42501.*permission denied/u);
  }
  assert.equal(await fingerprint(),before);checks+=1;
  passed.push(`completion-inventory-union-${kind}: per-source movements and genuine alert/event rows, exact ordered identity/FK coverage; duplicate-masks-missing, wrong source/quantity/warehouse, UUID collision and unsupported roles reject; composite resources preserved, clean/rollback content and advisory counts unchanged; NOT complete completion context/receipt ownership`);
};

const completionControlIdentityUnionRuntime = async ({setup,args,kind,before}) => {
  const expr=fingerprintQuery.trim().replace(/;$/u,'');
  // Guest routing may choose a canonical warehouse outside the fixed Phase3
  // fixture branch. Open the actual order's Shift through its supported RPC
  // before capturing the baseline for the Cash/CliQ completion controls.
  setup=setup.replace('CREATE TEMP TABLE qa_completion_side_baseline',`
    SELECT public.open_cash_shift(o.branch_id,0) FROM public.orders o
    WHERE o.id=(SELECT (result->>'order_id')::uuid FROM qa_completion_side_sale)
      AND NOT EXISTS(SELECT 1 FROM public.cash_shifts s WHERE s.branch_id=o.branch_id AND s.status='open');
    CREATE TEMP TABLE qa_completion_side_baseline`);
  const sequenceExpr=`jsonb_build_object('movement',(SELECT jsonb_build_object('lastValue',last_value,'isCalled',is_called) FROM public.inventory_movement_mutation_seq),
    'payment',(SELECT jsonb_build_object('lastValue',last_value,'isCalled',is_called) FROM public.customer_payment_number_seq))`;
  const constraints=await json(`SELECT coalesce(jsonb_agg(jsonb_build_object('relation',ns.nspname||'.'||t.relname,
    'name',c.conname,'parent',pn.nspname||'.'||pt.relname,'columns',(SELECT jsonb_agg(jsonb_build_object('source',a.attname,'target',pa.attname))
    FROM unnest(c.conkey,c.confkey) k(s,p) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.s
    JOIN pg_attribute pa ON pa.attrelid=c.confrelid AND pa.attnum=k.p))),'[]') FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=t.relnamespace
    JOIN pg_class pt ON pt.oid=c.confrelid JOIN pg_namespace pn ON pn.oid=pt.relnamespace
    WHERE c.contype='f' AND ns.nspname IN ('public','phase5_private');`);
  for(const mode of ['debt','partial-cash','partial-cliq','full-cash']) {
    const alteredArgs=args.replace("'debt',0",mode==='debt'?"'debt',0":mode==='full-cash'?"'cash',NULL":
      mode==='partial-cash'?"'cash',300":"'cliq',300").replace(',NULL,NULL,NULL',
      mode==='partial-cliq'?",NULL,'S5-COMPLETION-IDENTITY',NULL":',NULL,NULL,NULL');
    const planner=`phase5_private.plan_${kind}_completion_identity_union_v1`;
    const plan=`${planner}(${alteredArgs},NULL,NULL,NULL)`;
    const prepared=`${setup} CREATE TEMP TABLE qa_control_sequences AS SELECT ${sequenceExpr} contents;
      CREATE TEMP TABLE qa_control_union AS SELECT ${plan} plan;`;
    const assertion=`phase5_private.assert_${kind}_completion_identity_union_v1(${alteredArgs},(SELECT plan FROM qa_control_union))`;
    const result=await json(`BEGIN;${prepared} SELECT jsonb_build_object('plan',(SELECT plan FROM qa_control_union),
      'valid',${assertion},'same',(${expr})=(SELECT content FROM qa_completion_side_baseline),
      'sequenceSame',${sequenceExpr}=(SELECT contents FROM qa_control_sequences),
      'locksSame',(SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory')=(SELECT locks FROM qa_completion_side_baseline));ROLLBACK;`);
    assert.equal(result.valid,true);assert.equal(result.same,true);assert.equal(result.sequenceSame,true);assert.equal(result.locksSame,true);
    const p=result.plan,rows=p.controlRows,partial=mode.startsWith('partial');
    assert.equal(rows.length,partial?(kind==='customer'?10:6):4);
    assert.equal(p.sourceBindingComplete,true);assert.equal(p.identityAndDirectFkCoverageComplete,true);
    for(const flag of ['fullRowSemanticsComplete','futureWriteOwnershipComplete','executionAuthority','durableClaimsCreated','locksHeld']) assert.equal(p[flag],false);
    assert.deepEqual(p.plannedRows,[...p.inventoryPlan.inventoryUnion.plannedRows,...rows]);
    assert.equal(new Set(p.identityOwners.map(n=>n.id)).size,p.identityOwners.length);
    const orderId=p.sourceKind==='customer'?p.sourceUnion.parent.orderId:p.sourceUnion.commercial.orderId;
    const contexts=rows.filter(n=>n.relation==='phase5_private.mutation_contexts');
    const shiftResources=p.inventoryPlan.inventoryUnion.existingResources.filter(n=>n.relation==='public.cash_shifts');
    assert.ok(shiftResources.length>0,'actual open Shift remains a typed inventory resource');
    assert.ok(shiftResources.every(n=>n.id===n.row.id));
    assert.equal(contexts.length,kind==='customer'&&partial?2:1);
    assert.ok(contexts.every(n=>n.row.order_id===orderId&&n.row.actor_id===owner));
    assert.ok(contexts.every(n=>typeof n.row.transaction_id==='object'));
    if(kind==='legacy'){
      assert.equal(contexts[0].row.operation_id,null);assert.equal(p.childLink,null);
      assert.ok(rows.every(n=>!n.relation.startsWith('phase5_private.')||n.relation==='phase5_private.mutation_contexts'));
      assert.ok(rows.every(n=>n.relation!=='public.business_operations'));
    } else if(partial) {
      const envelope=rows.find(n=>n.relation==='phase5_private.collection_attempt_envelopes').row;
      assert.equal(envelope.financial_operation_id,p.sourceUnion.child.identities.operationId);
      assert.equal(envelope.context_id,p.childLink.childContextId);
      assert.deepEqual(envelope.request_snapshot,p.sourceUnion.child.request);
      const financial=rows.find(n=>n.relation==='phase5_private.financial_operation_events').row;
      const collection=rows.find(n=>n.relation==='phase5_private.collection_events').row;
      assert.deepEqual(collection.operation_event_at,financial.operation_event_at);
      assert.equal(collection.cash_shift_id,mode==='partial-cliq'?null:p.sourceUnion.child.shiftId);
    }
    // Actual catalog-derived FK coverage, including the context four-column FK
    // and financial operation three-column FK, with per-row parent identity.
    let edges=0;
    for(const row of p.plannedRows)for(const fk of constraints.filter(c=>c.relation===row.relation)){
      edges++;
      const edge=p.foreignKeys.filter(e=>e.relation===row.relation&&e.id===row.id&&e.constraint===fk.name);
      assert.equal(edge.length,1);
      for(const col of fk.columns){assert.ok(Object.hasOwn(row.row,col.source));assert.deepEqual(edge[0].sourceTuple[col.source],row.row[col.source]);}
      if(fk.columns.every(col=>row.row[col.source]!==null)){
        const parents=[...p.plannedRows,...p.existingResources].filter(n=>n.relation===fk.parent&&
          fk.columns.every(col=>JSON.stringify(n.row[col.target])===JSON.stringify(row.row[col.source])));
        assert.equal(parents.length,1);assert.equal(edge[0].parentId,parents[0].id);
      }else assert.equal(edge[0].parentState,'NOT_APPLICABLE');
    }
    assert.equal(p.foreignKeys.length,edges);assert.equal(await fingerprint(),before);checks+=12;
    if(mode==='debt'||mode==='partial-cliq'){
      for(const mutation of [
        "jsonb_set(plan,'{controlRows}',(plan->'controlRows')-0)",
        "jsonb_set(plan,'{controlRows}',(plan->'controlRows')||jsonb_build_array(plan->'controlRows'->0))",
        "jsonb_set(plan,'{controlRows,0,row,order_id}',to_jsonb(gen_random_uuid()))",
        "jsonb_set(plan,'{controlRows,0,row,operation_id}',to_jsonb(gen_random_uuid()))",
        "jsonb_set(plan,'{foreignKeys}','[]')",
        "jsonb_set(plan,'{requiredExecutionSlots,transaction}','99')",
        "jsonb_set(plan,'{fullRowSemanticsComplete}','true')",
        "jsonb_set(plan,'{allocation,historyId}',plan#>'{allocation,contextId}')",
        "jsonb_set(plan,'{allocation,contextId}',plan#>'{inventoryPlan,inventoryUnion,parentRows,0,id}')",
        "jsonb_set(plan,'{allocation,contextId}','null')",
      ]) {
        await fails(`${prepared} UPDATE qa_control_union SET plan=${mutation};SELECT ${assertion};`,/PHASE5_/u);
        assert.equal(await fingerprint(),before);checks++;
      }
      await fails(`${prepared} UPDATE public.inventory_balances SET on_hand_quantity=on_hand_quantity+1
        WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)};SELECT ${assertion};`,/PHASE5_/u);
      assert.equal(await fingerprint(),before);checks++;
      if(partial&&kind==='customer'){
        for(const mutation of ["jsonb_set(plan,'{childLink,childContextId}',plan#>'{allocation,contextId}')",
          "jsonb_set(plan,'{sourceUnion,child,request,amountInMinorUnits}','\"999\"')",
          "jsonb_set(plan,'{allocation,contextId}',plan#>'{sourceUnion,child,identities,operationId}')"]){
          await fails(`${prepared} UPDATE qa_control_union SET plan=${mutation};SELECT ${assertion};`,/PHASE5_/u);
          assert.equal(await fingerprint(),before);checks++;
        }
      }
      if(partial&&kind==='legacy'){
        await fails(`${prepared} UPDATE qa_control_union SET plan=jsonb_set(plan,'{allocation,receipt}','null');SELECT ${assertion};`,/PHASE5_/u);
        assert.equal(await fingerprint(),before);checks++;
      }
      // Literal arguments keep denial attributable to the actual private API,
      // rather than permissions on a postgres-owned temporary fixture table.
      const literalArgs=alteredArgs.replace("(SELECT (result->>'order_id')::uuid FROM qa_completion_side_sale)",q(orderId));
      for(const role of ['anon','authenticated','service_role'])for(const call of [
        `${planner}(${literalArgs},NULL,NULL,NULL)`,
        `phase5_private.assert_${kind}_completion_identity_union_v1(${literalArgs},${j(p)})`])
        await fails(`SET LOCAL ROLE ${role};SELECT ${call};`,/42501.*permission denied/u);
    }
    passed.push(`completion-control-identities-${kind}-${mode}: exact identity/FK projection, symbolic post-lock slots, source/actor/receipt binding; no business writes, sequence allocation, lock or execution admission`);
  }
};

// Model/ownership protocol only: no stored progress or INSERT authority. The
// existing four barriers must remain intact even after a COMPLETE simulation.
const completionProgressRuntime = async ({prepared,kind,before,groups}) => {
  const setup=`${prepared}
    CREATE TEMP TABLE qa_completion_progress AS SELECT phase5_private.model_completion_progress_v1(plan,'[]'::jsonb) progress
      FROM qa_execution_groups;`;
  // One transition call per statement, each under the unchanged10s budget.
  // Every same group/write is covered in one atomic BEGIN/ROLLBACK transaction;
  // no manufactured final history and no intermediate business commit.
  const protocolExpr='(SELECT plan FROM qa_execution_groups)';
  const advanceSql=event=>`UPDATE qa_completion_progress SET progress=phase5_private.advance_completion_progress_v1(${protocolExpr},progress,${event});`;
  const complete=groups.flatMap((g,gi)=>[
    `DO $$ BEGIN IF jsonb_array_length(${protocolExpr}->'groups')<>${groups.length}
      OR jsonb_array_length(${protocolExpr}#>'{groups,${gi},writes}')<>${g.writes.length}
      THEN RAISE EXCEPTION 'PROGRESS_GROUP_COUNT_DRIFT'; END IF; END $$;`,
    advanceSql(`jsonb_build_object('kind','BEGIN_GROUP','groupOrdinal',${gi+1},'beforeStates',${protocolExpr}#>'{groups,${gi},beforeStates}')`),
    ...g.writes.map((_,wi)=>advanceSql(`jsonb_build_object('kind','OBSERVE_WRITE','groupOrdinal',${gi+1},'writeOrdinal',${wi+1},'instruction',${protocolExpr}#>'{groups,${gi},writes,${wi}}')`)),
    advanceSql(`jsonb_build_object('kind','FINISH_GROUP','groupOrdinal',${gi+1},'afterStates',${protocolExpr}#>'{groups,${gi},afterStates}')`),
  ]).join('\n');
  // The COMPLETE fixture for rejection tests is freshly reconstructed and
  // fully validated by the model from this transaction's canonical protocol.
  // The clean proof above/below still exercises EVERY actual advance call.
  // Repeating that same clean traversal for each corruption adds no coverage.
  const reconstruct=`UPDATE qa_completion_progress SET progress=phase5_private.model_completion_progress_v1(${protocolExpr},
    (SELECT jsonb_agg(event ORDER BY group_no,event_no) FROM
      jsonb_array_elements(${protocolExpr}->'groups') WITH ORDINALITY x(g,group_no)
      CROSS JOIN LATERAL (
        SELECT 0 event_no,jsonb_build_object('kind','BEGIN_GROUP','groupOrdinal',g->'ordinal','beforeStates',g->'beforeStates') event
        UNION ALL SELECT write_no::integer,jsonb_build_object('kind','OBSERVE_WRITE','groupOrdinal',g->'ordinal',
          'writeOrdinal',write_no,'instruction',w) FROM jsonb_array_elements(g->'writes') WITH ORDINALITY y(w,write_no)
        UNION ALL SELECT jsonb_array_length(g->'writes')+1,jsonb_build_object('kind','FINISH_GROUP','groupOrdinal',g->'ordinal','afterStates',g->'afterStates')
      ) trace));`;
  const proof=await json(`BEGIN;${setup}${complete}SELECT jsonb_build_object('progress',progress,
    'complete',phase5_private.assert_completion_progress_complete_v1((SELECT plan FROM qa_execution_groups),progress),
    'contextsNull',NOT EXISTS(SELECT 1 FROM jsonb_array_elements((SELECT plan#>'{rowSample,businessSample,businessInsertRows}'
      FROM qa_execution_groups)) n WHERE n->>'relation'='phase5_private.mutation_contexts' AND n->'row'->'side_effect_progress' IS DISTINCT FROM 'null'::jsonb))
    FROM qa_completion_progress;ROLLBACK;`);
  assert.equal(proof.complete,true);assert.equal(proof.contextsNull,true);
  const p=proof.progress;assert.equal(p.state,'COMPLETE');
  assert.deepEqual(p.observedInsertClaims,p.expectedInsertClaims);
  assert.equal(new Set(p.expectedInsertClaims.map(n=>`${n.relation}|${n.id}`)).size,p.expectedInsertClaims.length);
  assert.ok(p.expectedInsertClaims.some(n=>n.relation==='public.inventory_movements'));
  assert.ok(p.expectedInsertClaims.some(n=>n.relation==='phase5_private.mutation_contexts'));
  for(const flag of ['durableClaimsCreated','progressRecorded','locksHeld','executionAuthority'])assert.equal(p[flag],false);
  assert.equal(await fingerprint(),before);checks+=11;
  console.log(`Completion progress ${kind}: EVERY advance transition and complete exact-set proof passed; checking corruptions.`);
  const initial='(SELECT progress FROM qa_completion_progress)';
  const protocol='(SELECT plan FROM qa_execution_groups)';
  const begin=`jsonb_build_object('kind','BEGIN_GROUP','groupOrdinal',1,'beforeStates',${protocol}->'initialStates')`;
  const write=`jsonb_build_object('kind','OBSERVE_WRITE','groupOrdinal',1,'writeOrdinal',1,'instruction',${protocol}#>'{groups,0,writes,0}')`;
  const active=`SELECT phase5_private.advance_completion_progress_v1(${protocol},${initial},${begin})`;
  const afterBegin=`UPDATE qa_completion_progress SET progress=(${active});`;
  const afterWrite=`${afterBegin}UPDATE qa_completion_progress SET progress=phase5_private.advance_completion_progress_v1(${protocol},${initial},${write});`;
  const faults=[
    ['',write,'WRITE_INVALID'],
    ['',`jsonb_set(${begin},'{groupOrdinal}','2')`,'BEGIN_INVALID'],
    ['',`jsonb_set(${begin},'{beforeStates}','{}')`,'BEGIN_INVALID'],
    [afterBegin,begin,'BEGIN_INVALID'],
    [afterBegin,`jsonb_build_object('kind','FINISH_GROUP','groupOrdinal',1,'afterStates',${protocol}#>'{groups,0,afterStates}')`,'FINISH_INVALID'],
    [afterBegin,`jsonb_set(${write},'{writeOrdinal}','2')`,'WRITE_INVALID'],
    [afterBegin,`jsonb_set(${write},'{instruction,after,actor_id}',to_jsonb(gen_random_uuid()))`,'WRITE_INVALID'],
    [afterWrite,write,'WRITE_INVALID'],
    [afterWrite,`jsonb_build_object('kind','FINISH_GROUP','groupOrdinal',1,'afterStates','{}'::jsonb)`,'FINISH_INVALID'],
    ['',"'null'::jsonb",'EVENT_INVALID'],
    [reconstruct,begin,'AFTER_COMPLETE'],
  ];
  for(const [prefix,event,error] of faults) {
    await fails(`${setup}${prefix}SELECT phase5_private.advance_completion_progress_v1(${protocol},${initial},${event});`,
      new RegExp(`23514.*PHASE5_COMPLETION_PROGRESS_${error}`,'u'));
    assert.equal(await fingerprint(),before);checks++;
  }
  for(const mutation of ["jsonb_set(progress,'{completedWrites}','999')",
    "jsonb_set(progress,'{state}','\"COMPLETE\"')","jsonb_set(progress,'{observedInsertClaims}','[]')",
    "jsonb_set(progress,'{contextId}',to_jsonb(gen_random_uuid()))","jsonb_set(progress,'{executionAuthority}','true')",
    "jsonb_set(progress,'{events}','null')"]) {
    // Empty observed claims is changed only after completing the model.
    const prefix=mutation.includes('observedInsertClaims')?reconstruct:'';
    await fails(`${setup}${prefix}UPDATE qa_completion_progress SET progress=${mutation};
      SELECT phase5_private.advance_completion_progress_v1(${protocol},${initial},${begin});`,/23514.*PHASE5_COMPLETION_PROGRESS_STATE_INVALID|23514.*PHASE5_COMPLETION_PROGRESS_INPUT_INVALID/u);
    assert.equal(await fingerprint(),before);checks++;
  }
  await fails(`${setup}SELECT phase5_private.assert_completion_progress_complete_v1(${protocol},${initial});`,/23514.*PHASE5_COMPLETION_PROGRESS_INCOMPLETE/u);
  await fails(`${setup}${reconstruct}INSERT INTO phase5_private.mutation_contexts DEFAULT VALUES;`,/55000.*PHASE5_PREPARATION_ONLY/u);
  for(const role of ['anon','authenticated','service_role'])for(const call of [
    `phase5_private.fold_completion_progress_v1(NULL,NULL)`,
    `phase5_private.model_completion_progress_v1(NULL,NULL)`,
    `phase5_private.advance_completion_progress_v1(NULL,NULL,NULL)`,
    `phase5_private.assert_completion_progress_complete_v1(NULL,NULL)`])
    await fails(`SET LOCAL ROLE ${role};SELECT ${call};`,/42501.*permission denied/u);
  assert.equal(await fingerprint(),before);checks++;
  passed.push(`completion-progress-${kind}: full monotone begin/write/finish model, exact INSERT identity receipts and prefix equality, duplicate/skipped/forged/extra events rejected; no durable claim, held locks, writes or authority; barriers and role denial retained`);
  console.log(`Completion progress ${kind}: focused ownership/progress model verified; durable execution remains CLOSED.`);
};

const completionExecutionGroupsRuntime = async ({prep,args,kind,scenario,before}) => {
  if(scenario==='existing')prep=prep.replace('CREATE TEMP TABLE qa_trigger_baseline',`
    UPDATE public.stock_alerts SET severity='out_of_stock' WHERE product_id=${q(product)} AND status='active';
    INSERT INTO public.stock_alert_reads(stock_alert_id,user_id)
      SELECT id,${q(owner)} FROM public.stock_alerts WHERE product_id=${q(product)} AND status='active'
      ON CONFLICT(stock_alert_id,user_id) DO NOTHING;
    CREATE TEMP TABLE qa_trigger_baseline`);
  const planner=`phase5_private.plan_${kind}_completion_execution_groups_v1`;
  const prepared=`${prep}CREATE TEMP TABLE qa_execution_groups AS SELECT ${planner}(${args},
    (SELECT plan FROM qa_trigger_identity),(SELECT slots FROM qa_trigger_slots)) plan;`;
  const assertion=`phase5_private.assert_${kind}_completion_execution_groups_v1(${args},(SELECT plan FROM qa_execution_groups))`;
  const expr=fingerprintQuery.trim().replace(/;$/u,'');
  const result=await json(`BEGIN;${prepared}SELECT jsonb_build_object('plan',(SELECT plan FROM qa_execution_groups),
    'valid',${assertion},'same',(${expr})=(SELECT content FROM qa_trigger_baseline));ROLLBACK;`);
  assert.equal(result.valid,true);assert.equal(result.same,true);
  const p=result.plan;assert.equal(p.sourceBindingComplete,true);assert.equal(p.groupBoundariesComplete,true);
  for(const f of ['executionAuthority','progressRecorded','durableClaimsCreated','locksHeld'])assert.equal(p[f],false);
  const contexts=p.rowSample.businessSample.businessInsertRows.filter(n=>n.relation==='phase5_private.mutation_contexts');
  assert.equal(p.groups.filter(g=>g.kind==='CONTEXT_PRELUDE').length,contexts.length);
  let state=p.initialStates;
  for(const [i,g] of p.groups.entries()) {
    assert.equal(g.ordinal,i+1);assert.deepEqual(g.beforeStates,state);state=g.afterStates;
    assert.ok(g.writes.length>0);
    if(g.kind==='BALANCE_WITH_SYNCHRONOUS_TRIGGERS') {
      assert.equal(g.writes[0].relation,'public.inventory_balances');
      assert.equal(g.writes[0].id,g.source.balanceId);
      const s=p.rowSample.triggerSample.steps.find(n=>n.source.sourceId===g.source.sourceId);
      assert.ok(s);assert.deepEqual(g.writes.slice(1),s.writes);
      const row=Object.values(g.afterStates).find(n=>n.relation==='public.inventory_balances'&&n.identity.id===g.source.balanceId);
      assert.deepEqual(row.row,g.writes[0].after);
    }
  }
  assert.deepEqual(state,p.finalStates);
  assert.deepEqual(p.groups.filter(g=>g.kind!=='CONTEXT_PRELUDE').flatMap(g=>g.writes),p.rowSample.writes);
  const insertRows=p.groups.flatMap(g=>g.writes).filter(w=>w.action==='INSERT').map(w=>({relation:w.relation,
    id:w.id??w.identity.id,row:w.after}));
  const ordered=rows=>rows.toSorted((a,b)=>`${a.relation}|${a.id}`.localeCompare(`${b.relation}|${b.id}`));
  assert.deepEqual(ordered(insertRows),ordered(p.rowSample.plannedInsertRows));
  for(const n of Object.values(p.initialStates))if(insertRows.some(w=>w.relation===n.relation&&w.id===n.identity.id))assert.equal(n.row,null);
  const balanceGroups=p.groups.filter(g=>g.kind==='BALANCE_WITH_SYNCHRONOUS_TRIGGERS');
  assert.equal(balanceGroups.length,kind==='customer'?3:2);
  const repeated=balanceGroups.filter(g=>g.source.productId===product);
  assert.equal(repeated.length,2);assert.equal(repeated[1].source.onHandBefore,repeated[0].source.onHandAfter);
  const readWrites=p.groups.flatMap(g=>g.writes).filter(w=>w.relation==='public.stock_alert_reads');
  if(scenario==='existing') {
    assert.ok(readWrites.length>0,'composite read deletion must be exercised');
    for(const w of readWrites) {
      assert.equal(w.action,'DELETE');assert.equal(w.identity.user_id,owner);
      assert.deepEqual(w.identity,{stock_alert_id:w.before.stock_alert_id,user_id:w.before.user_id});assert.equal(w.after,null);
      assert.ok(Object.values(p.finalStates).some(n=>n.relation===w.relation&&n.row===null&&
        n.identity.stock_alert_id===w.identity.stock_alert_id&&n.identity.user_id===w.identity.user_id));
    }
    const actualReadDeletion=await json(`BEGIN;${prepared}
      UPDATE public.inventory_balances SET on_hand_quantity=${repeated[0].source.onHandAfter},reserved_quantity=${repeated[0].source.reservedAfter}
      WHERE id=${q(repeated[0].source.balanceId)};
      SELECT to_jsonb(NOT EXISTS(SELECT 1 FROM public.stock_alert_reads WHERE stock_alert_id=${q(readWrites[0].identity.stock_alert_id)} AND user_id=${q(owner)}));ROLLBACK;`);
    assert.equal(actualReadDeletion,true);assert.equal(await fingerprint(),before);checks+=3;
  }
  assert.equal(await fingerprint(),before);checks+=20;
  const balanceIndex=p.groups.findIndex(g=>g.kind==='BALANCE_WITH_SYNCHRONOUS_TRIGGERS');
  const laterBalanceIndex=p.groups.findLastIndex(g=>g.kind==='BALANCE_WITH_SYNCHRONOUS_TRIGGERS');
  const mutations=[
    "jsonb_set(plan,'{groups}',(plan->'groups')-0)",
    "jsonb_set(plan,'{groups,1}',plan->'groups'->0)",
    `jsonb_set(plan,'{groups,${laterBalanceIndex},source}',plan#>'{groups,${balanceIndex},source}')`,
    `jsonb_set(plan,'{groups,${balanceIndex},writes}',jsonb_build_array(plan#>'{groups,${balanceIndex},writes,0}'))`,
    `jsonb_set(plan,'{groups,${balanceIndex},afterStates}',plan#>'{groups,${balanceIndex},beforeStates}')`,
    "jsonb_set(plan,'{initialStates}','{}')",
    "jsonb_set(plan,'{finalStates}','null')",
    "jsonb_set(plan,'{progressRecorded}','true')",
    "jsonb_set(plan,'{groups}',(plan->'groups')||jsonb_build_array(plan->'groups'->0))",
  ];
  for(const mutation of mutations) {
    const changed=await json(`BEGIN;${prepared}SELECT to_jsonb((${mutation}) IS DISTINCT FROM plan) FROM qa_execution_groups;ROLLBACK;`);
    assert.equal(changed,true,'every execution-group fault must actually change the source-bound sample');
    await fails(`${prepared}UPDATE qa_execution_groups SET plan=${mutation};SELECT ${assertion};`,/40001.*PHASE5_COMPLETION_GROUPS_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),before);checks++;
  }
  // Contradictory full prefixes cannot be hidden by equal row counts.
  await fails(`${prepared}SELECT phase5_private.derive_completion_execution_groups_v1(
    jsonb_set((SELECT plan->'rowSample' FROM qa_execution_groups),'{writes,0,before,on_hand_quantity}','999'));`,
  /23514.*PHASE5_COMPLETION_GROUP_ORDER_INVALID/u);
  await fails(`${prepared}SELECT phase5_private.derive_completion_execution_groups_v1(NULL);`,/42501.*PHASE5_COMPLETION_GROUP_SAMPLE_INVALID/u);
  const literalArgs=args.replace("(SELECT (result->>'order_id')::uuid FROM qa_completion_side_sale)",q(p.rowSample.businessSample.contextSample.order_id));
  if(completionProgressFocused&&scenario==='existing'&&args.includes("'cliq',300"))await completionProgressRuntime({prepared,kind,before,groups:p.groups});
  for(const role of ['anon','authenticated','service_role'])for(const call of [
    `${planner}(${literalArgs},${j(p.rowSample.businessSample.identityPlan)},${j(p.rowSample.businessSample.sampleValues)})`,
    `phase5_private.assert_${kind}_completion_execution_groups_v1(${literalArgs},${j(p)})`,
    `phase5_private.derive_completion_execution_groups_v1(${j(p.rowSample)})`])
    await fails(`SET LOCAL ROLE ${role};SELECT ${call};`,/42501.*permission denied/u);
  assert.equal(await fingerprint(),before);checks++;
  passed.push(`completion-execution-groups-${kind}: indivisible balance/trigger groups, exact full prefixes and INSERT coverage, repeated-SKU chains, NULL/content/substitution rejection and real-role denial; samples only`);
  console.log(`Completion execution groups ${kind}: full group/prefix matrix verified; preparation only.`);
};

const completionTriggerRowsRuntime = async ({setup,args,kind,before}) => {
  const expr=fingerprintQuery.trim().replace(/;$/u,'');
  setup=setup.replace('CREATE TEMP TABLE qa_completion_side_baseline',`
    SELECT public.open_cash_shift(o.branch_id,0) FROM public.orders o
    WHERE o.id=(SELECT (result->>'order_id')::uuid FROM qa_completion_side_sale)
      AND NOT EXISTS(SELECT 1 FROM public.cash_shifts s WHERE s.branch_id=o.branch_id AND s.status='open');
    CREATE TEMP TABLE qa_completion_side_baseline`);
  // Hypothetical kernel chain, deliberately NOT a commercial completion:
  // out -> low -> out -> low in one epoch keeps the first event payload; resolution
  // then creates a new alert. Composite read deletion occurs exactly once.
  const chain=await json(`BEGIN;${setup}
    INSERT INTO public.stock_alert_reads(stock_alert_id,user_id)
      SELECT a.id,${q(owner)} FROM public.stock_alerts a WHERE a.status='active' AND a.product_id=${q(product)}
        AND a.warehouse_id=(SELECT (plan#>>'{inventoryModel,sourceSteps,0,warehouseId}')::uuid FROM qa_completion_side_plan)
      ON CONFLICT(stock_alert_id,user_id) DO NOTHING;
    -- Remove only this rollback fixture's current low-stock key so the first
    -- low invocation is a planned INSERT, not a setup-created event.
    DELETE FROM public.automation_events e WHERE e.event_type='low_stock'
      AND e.event_key='stock_alert:'||e.entity_id::text||':low_stock:'||floor(extract(epoch FROM transaction_timestamp()))::bigint::text
      AND e.entity_id IN (SELECT a.id FROM public.stock_alerts a WHERE a.product_id=${q(product)} AND a.status='active');
    CREATE TEMP TABLE qa_chain_baseline AS SELECT (${expr}) content;
    CREATE TEMP TABLE qa_chain_steps AS SELECT jsonb_agg((plan#>'{inventoryModel,sourceSteps,0}')||jsonb_build_object(
      'stepId','hypothetical-'||ord,'onHandBefore',CASE ord WHEN 1 THEN 100 WHEN 2 THEN 0 WHEN 3 THEN 1 WHEN 4 THEN 0 WHEN 5 THEN 2 ELSE 200 END,
      'onHandAfter',CASE ord WHEN 2 THEN 1 WHEN 4 THEN 2 WHEN 5 THEN 200 ELSE 0 END,
      'reservedBefore',CASE ord WHEN 1 THEN (plan#>'{inventoryModel,sourceSteps,0,reservedBefore}') ELSE '0'::jsonb END,'reservedAfter',0) ORDER BY ord) steps
      FROM qa_completion_side_plan CROSS JOIN generate_series(1,6) ord;
    CREATE TEMP TABLE qa_chain_model AS SELECT phase5_private.model_inventory_alert_steps_v1(${q(owner)},(SELECT steps FROM qa_chain_steps),NULL) model;
    CREATE TEMP TABLE qa_chain_rows AS SELECT phase5_private.derive_inventory_trigger_row_sample_v1(${q(owner)},(SELECT model FROM qa_chain_model),ARRAY[]::uuid[]) sample;
    SELECT jsonb_build_object('sample',(SELECT sample FROM qa_chain_rows),'same',(${expr})=(SELECT content FROM qa_chain_baseline));ROLLBACK;`);
  assert.equal(chain.same,true);assert.equal(chain.sample.sourceBindingComplete,false);
  assert.equal(chain.sample.executionAuthority,false);assert.equal(chain.sample.steps.length,6);
  assert.deepEqual(chain.sample.sourceModel.steps.map(n=>n.alertAfter.status),['active','active','active','active','resolved','active']);
  assert.deepEqual(chain.sample.sourceModel.steps.map(n=>n.eventDisposition),['INSERT_NEW','INSERT_NEW','REUSE_EARLIER_PLANNED','REUSE_EARLIER_PLANNED','NONE','INSERT_NEW']);
  assert.equal(chain.sample.plannedInserts.filter(n=>n.relation==='public.automation_events').length,3);
  assert.equal(chain.sample.plannedInserts.filter(n=>n.relation==='public.stock_alerts').length,1);
  assert.deepEqual(chain.sample.steps[0].writes.map(n=>`${n.relation}|${n.action}`),[
    'public.stock_alerts|UPDATE','public.automation_events|INSERT','public.stock_alert_reads|DELETE']);
  assert.equal(chain.sample.steps.flatMap(n=>n.writes).filter(n=>n.relation==='public.stock_alert_reads').length,1);
  assert.deepEqual(chain.sample.sourceModel.steps[3].storedEvent,chain.sample.sourceModel.steps[1].storedEvent);
  assert.notDeepEqual(chain.sample.sourceModel.steps[3].eventInvocation.payload,chain.sample.sourceModel.steps[1].eventInvocation.payload);
  assert.equal(await fingerprint(),before);checks+=12;
  passed.push(`trigger-kernel-${kind}: six-step severity/first-wins/resolution/new-alert chain and exact composite read deletion; hypothetical and unbound`);
  for(const scenario of ['existing','absent'])for(const mode of ['debt','partial-cliq']) {
    if(completionProgressFocused&&!(scenario==='existing'&&mode==='partial-cliq'))continue;
    const a=mode==='debt'?args:args.replace("'debt',0","'cliq',300").replace(',NULL,NULL,NULL',",NULL,'TRIGGER-SAMPLE-CLIQ',NULL");
    const planner=`phase5_private.plan_${kind}_completion_trigger_rows_v1`;
    const adjustment=scenario==='absent'?`DELETE FROM public.stock_alerts WHERE product_id IN (${q(product)},'92400000-0000-0000-0000-000000000102');`:'';
    const prep=`${setup}${adjustment}
      CREATE TEMP TABLE qa_trigger_baseline AS SELECT (${expr}) content,
        (SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory') locks;
      CREATE TEMP TABLE qa_trigger_identity AS SELECT phase5_private.plan_${kind}_completion_identity_union_v1(${a},NULL,NULL,NULL) plan;
      CREATE TEMP TABLE qa_trigger_slots AS SELECT jsonb_build_object('eventAt',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'eventTimeZone',current_setting('TimeZone'),'transactionId','123456','paymentSequenceValue',${mode==='debt'?"'null'::jsonb":"to_jsonb('321'::text)"},
        'movementSequences',(SELECT jsonb_agg(jsonb_build_object('sourceId',source_id,'sequenceValue',(100+ord)::text) ORDER BY ord) FROM (
        ${kind==='customer'?`SELECT n->>'id' source_id,row_number() OVER(ORDER BY n->'row'->>'product_id',n->>'id') ord
          FROM jsonb_array_elements((SELECT plan#>'{sourceUnion,parent,resources}' FROM qa_trigger_identity)) n WHERE n->>'relation'='public.order_inventory_reservations'`:
          `SELECT n->>'id' source_id,row_number() OVER(ORDER BY n->>'id' COLLATE "C") ord
          FROM jsonb_array_elements((SELECT plan#>'{sourceUnion,commercial,sourceItems}' FROM qa_trigger_identity)) n`}) ordered_sources)) slots;
      CREATE TEMP TABLE qa_trigger_sample AS SELECT ${planner}(${a},(SELECT plan FROM qa_trigger_identity),(SELECT slots FROM qa_trigger_slots)) plan;`;
    const assertion=`phase5_private.assert_${kind}_completion_trigger_rows_v1(${a},(SELECT plan FROM qa_trigger_sample))`;
    const clean=await json(`BEGIN;${prep}SELECT jsonb_build_object('plan',(SELECT plan FROM qa_trigger_sample),'valid',${assertion},
      'same',(${expr})=(SELECT content FROM qa_trigger_baseline),'locksSame',(SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory')=(SELECT locks FROM qa_trigger_baseline));ROLLBACK;`);
    assert.equal(clean.valid,true);assert.equal(clean.same,true);assert.equal(clean.locksSame,true);
    const p=clean.plan;assert.equal(p.businessAndStockRowSampleComplete,true);assert.equal(p.sourceBindingComplete,true);
    for(const flag of ['executionAuthority','triggerIdentitiesConsumed','durableClaimsCreated','locksHeld','futureWriteOwnershipComplete'])assert.equal(p[flag],false);
    const stock=p.triggerSample.plannedInserts;
    assert.equal(stock.filter(n=>n.relation==='public.stock_alerts').length,scenario==='absent'?(kind==='customer'?2:1):0);
    assert.equal(stock.filter(n=>n.relation==='public.automation_events').length,scenario==='absent'?(kind==='customer'?2:1):0);
    assert.equal(p.triggerSample.steps.length,kind==='customer'?3:2);
    assert.equal(p.writes.filter(n=>n.relation==='public.inventory_movements').length,kind==='customer'?3:2);
    assert.equal(new Set(p.plannedInsertRows.map(n=>`${n.relation}|${n.id}`)).size,p.plannedInsertRows.length);
    // Check retained real trigger behavior, with only random UUIDs mapped to
    // their admitted sample counterparts. Full row content is compared.
    const actual=await json(`BEGIN;${prep}
      DO $$ DECLARE s jsonb; actual_alert jsonb; expected_alert jsonb; actual_event jsonb; expected_event jsonb; expected jsonb;
        mapping jsonb:='{}'::jsonb; expected_id text;
      BEGIN
        FOR s IN SELECT value FROM jsonb_array_elements((SELECT plan#>'{triggerSample,sourceModel,steps}' FROM qa_trigger_sample)) LOOP
          UPDATE public.inventory_balances SET on_hand_quantity=(s#>>'{source,onHandAfter}')::integer,
            reserved_quantity=(s#>>'{source,reservedAfter}')::integer WHERE id=(s#>>'{source,balanceId}')::uuid;
          expected_alert:=s->'alertAfter';
          SELECT to_jsonb(a) INTO actual_alert FROM public.stock_alerts a WHERE a.product_id=(s#>>'{source,productId}')::uuid
            AND a.warehouse_id=(s#>>'{source,warehouseId}')::uuid AND a.status='active';
          IF s->>'alertAction' IN ('INSERT','UPDATE') AND expected_alert->>'status'='active' THEN
            IF actual_alert IS NULL OR actual_alert-'id' IS DISTINCT FROM expected_alert-'id' THEN RAISE EXCEPTION 'TRIGGER_ALERT_FULL_ROW_MISMATCH'; END IF;
            mapping:=mapping||jsonb_build_object(actual_alert->>'id',expected_alert->'id');
          END IF;
          IF s->>'eventDisposition'='INSERT_NEW' THEN
            SELECT to_jsonb(e) INTO actual_event FROM public.automation_events e WHERE e.entity_id=(actual_alert->>'id')::uuid
              AND e.event_type=actual_alert->>'severity' AND e.created_at=transaction_timestamp();
            expected_event:=s->'storedEvent'; expected_id:=expected_event->>'entity_id';
            actual_event:=jsonb_set(jsonb_set(jsonb_set(actual_event,'{entity_id}',to_jsonb(expected_id)),
              '{payload,stockAlertId}',to_jsonb(expected_id)),'{event_key}',to_jsonb(replace(actual_event->>'event_key',actual_alert->>'id',expected_id)));
            IF actual_event IS NULL OR actual_event-'id' IS DISTINCT FROM expected_event-'id' THEN RAISE EXCEPTION 'TRIGGER_EVENT_FULL_ROW_MISMATCH'; END IF;
          END IF;
        END LOOP;
      END $$;SELECT 'true'::jsonb;ROLLBACK;`);
    assert.equal(actual,true);assert.equal(await fingerprint(),before);checks+=15;
    await completionExecutionGroupsRuntime({prep,args:a,kind,scenario,before});
    for(const mutation of [
      "jsonb_set(plan,'{triggerSample,steps}',(plan#>'{triggerSample,steps}')-0)",
      "jsonb_set(plan,'{triggerSample,steps,1}',plan#>'{triggerSample,steps,0}')",
      "jsonb_set(plan,'{triggerSample,steps,0,source,warehouseId}',to_jsonb(gen_random_uuid()))",
      "jsonb_set(plan,'{writes,0,after,on_hand_quantity}','999')",
      "jsonb_set(plan,'{triggerSample,identityManifest,eventKeyBindings}','null')",
      "jsonb_set(plan,'{triggerSample,eventInvocations}','null')",
      "jsonb_set(plan,'{plannedInsertRows}',(plan->'plannedInsertRows')||jsonb_build_array(plan->'plannedInsertRows'->0))",
      "jsonb_set(plan,'{triggerIdentitiesConsumed}','true')",
      "jsonb_set(plan,'{businessSample,sampleValues,eventAt}','\"2025-01-01T00:00:00.000000Z\"')",
    ]) {
      await fails(`${prep}UPDATE qa_trigger_sample SET plan=${mutation};SELECT ${assertion};`,/40001.*PHASE5_|23514.*PHASE5_COMPLETION_TRIGGER_CLOCK_INVALID/u);
      assert.equal(await fingerprint(),before);checks++;
    }
    await fails(`${prep}UPDATE public.products SET name_ar='Altered immutable payload label' WHERE id=${q(product)};SELECT ${assertion};`,/40001.*PHASE5_/u);
    await fails(`${prep}SELECT ${planner}(${a},(SELECT plan FROM qa_trigger_identity),jsonb_set((SELECT slots FROM qa_trigger_slots),'{eventAt}','null'));`,/22023.*PHASE5_/u);
    await fails(`${prep}ALTER TABLE public.stock_alerts ADD COLUMN unreviewed_extra text;SELECT ${assertion};`,/23514.*PHASE5_TRIGGER_ROW_COLUMNS_INVALID|40001.*PHASE5_/u);
    const literalArgs=a.replace("(SELECT (result->>'order_id')::uuid FROM qa_completion_side_sale)",q(p.businessSample.contextSample.order_id));
    for(const role of ['anon','authenticated','service_role'])for(const call of [
      `${planner}(${literalArgs},${j(p.businessSample.identityPlan)},${j(p.businessSample.sampleValues)})`,
      `phase5_private.assert_${kind}_completion_trigger_rows_v1(${literalArgs},${j(p)})`,
      `phase5_private.compose_completion_trigger_row_sample_v1(${j(p.businessSample)})`,
      `phase5_private.derive_inventory_trigger_row_sample_v1(${q(owner)},${j(p.triggerSample.sourceModel)},ARRAY[]::uuid[])`])
      await fails(`SET LOCAL ROLE ${role};SELECT ${call};`,/42501.*permission denied/u);
    assert.equal(await fingerprint(),before);checks++;
    passed.push(`completion-trigger-rows-${kind}-${scenario}-${mode}: per-source full stock rows and nested write order, real unchanged trigger comparison, identity/clock/source drift rejection, app-role denial and rollback; preparation only`);
  }
};

const completionBusinessRowsRuntime = async ({setup,args,kind,before}) => {
  const expr=fingerprintQuery.trim().replace(/;$/u,'');
  setup=setup.replace('CREATE TEMP TABLE qa_completion_side_baseline',`
    SELECT public.open_cash_shift(o.branch_id,0) FROM public.orders o
    WHERE o.id=(SELECT (result->>'order_id')::uuid FROM qa_completion_side_sale)
      AND NOT EXISTS(SELECT 1 FROM public.cash_shifts s WHERE s.branch_id=o.branch_id AND s.status='open');
    CREATE TEMP TABLE qa_completion_side_baseline`);
  const sequenceExpr=`jsonb_build_object('movement',(SELECT jsonb_build_object('lastValue',last_value,'isCalled',is_called) FROM public.inventory_movement_mutation_seq),
    'payment',(SELECT jsonb_build_object('lastValue',last_value,'isCalled',is_called) FROM public.customer_payment_number_seq))`;
  for(const mode of ['debt','partial-cash','partial-cliq','full-cash']) {
    const partial=mode.startsWith('partial');
    const alteredArgs=args.replace("'debt',0",mode==='debt'?"'debt',0":mode==='full-cash'?"'cash',NULL":
      mode==='partial-cash'?"'cash',300":"'cliq',300").replace(',NULL,NULL,NULL',
      mode==='partial-cliq'?",NULL,'ROW-SAMPLE-CLIQ',NULL":',NULL,NULL,NULL');
    const planner=`phase5_private.plan_${kind}_completion_business_rows_v1`;
    const prepared=`${setup} CREATE TEMP TABLE qa_row_sequences AS SELECT ${sequenceExpr} contents;
      CREATE TEMP TABLE qa_row_identity AS SELECT phase5_private.plan_${kind}_completion_identity_union_v1(${alteredArgs},NULL,NULL,NULL) plan;
      CREATE TEMP TABLE qa_row_slots AS SELECT jsonb_build_object('eventAt','2026-10-04T21:30:00.123456Z',
        'eventTimeZone','Asia/Amman','transactionId','123456','movementSequences',
        (SELECT jsonb_agg(jsonb_build_object('sourceId',source_id,'sequenceValue',(1000+ord)::text) ORDER BY ord) FROM (
          ${kind==='customer'?`SELECT n->>'id' source_id,row_number() OVER(ORDER BY n->'row'->>'product_id',n->>'id') ord
            FROM jsonb_array_elements((SELECT plan#>'{sourceUnion,parent,resources}' FROM qa_row_identity)) n
            WHERE n->>'relation'='public.order_inventory_reservations'`:
            `SELECT n->>'id' source_id,row_number() OVER(ORDER BY n->>'id' COLLATE "C") ord
            FROM jsonb_array_elements((SELECT plan#>'{sourceUnion,commercial,sourceItems}' FROM qa_row_identity)) n`}) ordered_sources),
        'paymentSequenceValue',${partial?"to_jsonb('1234567'::text)":"'null'::jsonb"}) slots;
      CREATE TEMP TABLE qa_row_sample AS SELECT ${planner}(${alteredArgs},(SELECT plan FROM qa_row_identity),(SELECT slots FROM qa_row_slots)) plan;`;
    const assertion=`phase5_private.assert_${kind}_completion_business_rows_v1(${alteredArgs},(SELECT plan FROM qa_row_sample))`;
    const result=await json(`BEGIN;${prepared} SELECT jsonb_build_object('plan',(SELECT plan FROM qa_row_sample),'valid',${assertion},
      'saleUnits',(SELECT units_per_sale_unit FROM public.products WHERE id=${q(product)}),
      'same',(${expr})=(SELECT content FROM qa_completion_side_baseline),'sequenceSame',${sequenceExpr}=(SELECT contents FROM qa_row_sequences),
      'locksSame',(SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory')=(SELECT locks FROM qa_completion_side_baseline));ROLLBACK;`);
    for(const flag of ['valid','same','sequenceSame','locksSame']) assert.equal(result[flag],true);
    const p=result.plan;
    for(const flag of ['sampleOnly','businessRowSampleComplete','sourceBindingComplete'])assert.equal(p[flag],true);
    for(const flag of ['clockAndSequenceValuesAuthoritative','stockTriggerRowsComplete','executionAuthority','durableClaimsCreated','locksHeld','futureWriteOwnershipComplete'])assert.equal(p[flag],false);
    assert.equal(p.executionSlotCatalog.sequences.length,2);
    assert.equal(p.executionSlotCatalog.valuesAllocated,false);assert.equal(p.executionSlotCatalog.authorityQualified,false);
    assert.equal(new Set(p.businessInsertRows.map(n=>`${n.relation}|${n.id}`)).size,p.businessInsertRows.length);
    const movements=p.writes.filter(n=>n.relation==='public.inventory_movements');
    assert.equal(movements.length,kind==='customer'?3:2);
    // Legacy input quantity is a SALE PACKAGE, unlike modern base_quantity.
    // The fixture's parent/child inheritance gives five base units per package.
    // Verify the actual canonical product anchor independently of the model.
    if(kind==='legacy')assert.equal(result.saleUnits,5);
    assert.deepEqual(movements.map(n=>Math.abs(n.after.quantity)).sort(),kind==='customer'?[2,2,3]:[5,5]);
    assert.ok(movements.every(n=>n.after.created_at==='2026-10-04T21:30:00.123456+00:00'));
    const balances=p.writes.filter(n=>n.relation==='public.inventory_balances');
    assert.ok(balances.every(n=>n.before.on_hand_quantity-n.after.on_hand_quantity>0));
    const sameSku=balances.filter(n=>n.before.product_id===product);
    assert.equal(sameSku.length,2);assert.deepEqual(sameSku[1].before,sameSku[0].after);
    const finalOrder=p.writes.filter(n=>n.relation==='public.orders').at(-1).after;
    assert.equal(finalOrder.status,'completed');
    assert.equal(finalOrder.amount_paid_in_minor_units,mode==='debt'?0:partial?300:finalOrder.total_in_minor_units);
    const payments=p.businessInsertRows.filter(n=>n.relation==='public.customer_payments');
    assert.equal(payments.length,partial?1:0);
    if(partial) {
      const payment=payments[0].row;
      assert.equal(payment.amount_in_minor_units,300);assert.equal(payment.is_reversed,false);
      assert.equal(payment.payment_method,mode==='partial-cliq'?'cliq':'cash');
      assert.equal(payment.payment_number,`CRV-${kind==='customer'?'20261004':'20261005'}-1234567`);
    }
    if(kind==='legacy') {
      assert.equal(p.contextSample.operation_id,null);
      assert.ok(p.businessInsertRows.every(n=>!n.relation.startsWith('phase5_private.')||n.relation==='phase5_private.mutation_contexts'));
      assert.ok(p.businessInsertRows.every(n=>n.relation!=='public.business_operations'));
    } else {
      const operation=p.businessInsertRows.find(n=>n.relation==='public.business_operations');
      assert.equal(operation.id,p.contextSample.operation_id);
      if(partial) {
        const envelope=p.businessInsertRows.find(n=>n.relation==='phase5_private.collection_attempt_envelopes').row;
        assert.equal(envelope.financial_operation_id,p.identityPlan.sourceUnion.child.identities.operationId);
        assert.deepEqual(envelope.request_snapshot,p.identityPlan.sourceUnion.child.request);
      }
    }
    assert.equal(await fingerprint(),before);checks+=22;
    // Exact rederivation includes source transitions, result, full insert rows,
    // catalog ownership and sequence configuration; no aggregate-only proof.
    for(const mutation of [
      "jsonb_set(plan,'{businessInsertRows}',(plan->'businessInsertRows')-0)",
      "jsonb_set(plan,'{businessInsertRows}',(plan->'businessInsertRows')||jsonb_build_array(plan->'businessInsertRows'->0))",
      "jsonb_set(plan,'{businessInsertRows,0,row,transaction_id}','999')",
      "jsonb_set(plan,'{writes,0,after,on_hand_quantity}','999')",
      "jsonb_set(plan,'{contextSample,order_id}',to_jsonb(gen_random_uuid()))",
      "jsonb_set(plan,'{contextSample,locked_plan,eventAt}','\"2027-01-01T00:00:00.000000Z\"')",
      "jsonb_set(plan,'{executionSlotCatalog,sequences,0,owner}','\"authenticated\"')",
      "jsonb_set(plan,'{clockAndSequenceValuesAuthoritative}','true')",
      "jsonb_set(plan,'{executionAuthority}','true')",
      "jsonb_set(plan,'{foreignKeys}','[]')",
    ]) {
      await fails(`${prepared} UPDATE qa_row_sample SET plan=${mutation};SELECT ${assertion};`,/40001.*PHASE5_COMPLETION_BUSINESS_ROWS_CHANGED_RETRY/u);
      assert.equal(await fingerprint(),before);checks++;
    }
    for(const mutation of [
      "jsonb_set(slots,'{eventAt}','null')","jsonb_set(slots,'{eventAt}','\"not-a-clock\"')",
      "jsonb_set(slots,'{eventTimeZone}','\"Invalid/Zone\"')","jsonb_set(slots,'{transactionId}','\"0\"')",
      "jsonb_set(slots,'{movementSequences}',(slots->'movementSequences')-0)",
      "jsonb_set(slots,'{movementSequences,1,sourceId}',slots#>'{movementSequences,0,sourceId}')",
      "jsonb_set(slots,'{movementSequences,1,sequenceValue}',slots#>'{movementSequences,0,sequenceValue}')",
      "jsonb_set(slots,'{movementSequences,0,sequenceValue}','\"9999\"')",
      "jsonb_set(slots,'{movementSequences,0,sequenceValue}','\"-1\"')",
      `jsonb_set(slots,'{paymentSequenceValue}',${partial?"'null'::jsonb":"'\"1\"'::jsonb"})`,
    ]) {
      await fails(`${prepared} UPDATE qa_row_slots SET slots=${mutation};SELECT ${planner}(${alteredArgs},(SELECT plan FROM qa_row_identity),(SELECT slots FROM qa_row_slots));`,/22023.*PHASE5_|23514.*PHASE5_/u);
      assert.equal(await fingerprint(),before);checks++;
    }
    await fails(`${prepared} UPDATE public.inventory_balances SET on_hand_quantity=on_hand_quantity+1
      WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)};SELECT ${assertion};`,/40001.*PHASE5_/u);
    await fails(`${prepared} ALTER SEQUENCE public.inventory_movement_mutation_seq INCREMENT BY 2;SELECT ${assertion};`,/23514.*PHASE5_SHIFT_SIDE_EFFECT_SEQUENCE_DRIFT/u);
    await fails(`${prepared} REVOKE ALL ON SEQUENCE public.customer_payment_number_seq FROM anon;SELECT ${assertion};`,/40001.*PHASE5_/u);
    const literalArgs=alteredArgs.replace("(SELECT (result->>'order_id')::uuid FROM qa_completion_side_sale)",q(p.contextSample.order_id));
    for(const role of ['anon','authenticated','service_role'])for(const call of [
      `${planner}(${literalArgs},${j(p.identityPlan)},${j(p.sampleValues)})`,
      `phase5_private.assert_${kind}_completion_business_rows_v1(${literalArgs},${j(p)})`,
      `phase5_private.derive_completion_business_row_sample_v1(${j(p.identityPlan)},${j(p.sampleValues)})`,
      'phase5_private.completion_execution_slot_catalog_v1()'])
      await fails(`SET LOCAL ROLE ${role};SELECT ${call};`,/42501.*permission denied/u);
    await fails(`${prepared} INSERT INTO phase5_private.mutation_contexts(id,transaction_id,generation,actor_id,order_id,purpose,operation_id,normalized_request,request_fingerprint,locked_plan)
      SELECT (c->>'id')::uuid,(c->>'transaction_id')::bigint,(c->>'generation')::bigint,(c->>'actor_id')::uuid,
        (c->>'order_id')::uuid,c->>'purpose',(c->>'operation_id')::uuid,c->'normalized_request',c->>'request_fingerprint',c->'locked_plan'
      FROM (SELECT plan->'contextSample' c FROM qa_row_sample) x;`,/55000.*PHASE5_PREPARATION_ONLY/u);
    assert.equal(await fingerprint(),before);checks++;
    passed.push(`completion-business-row-samples-${kind}-${mode}: source-bound full business rows, actual column/FK identities, distinct per-source sequences and receipt semantics; row/result/source/sequence/ACL drift and unsupported callers reject; zero content/advisory/sequence changes; hypothetical values confer no permit`);
  }
};

const completionLockUnionRuntime = async ({setup,args,kind,claims}) => {
  // Commit legitimate fixture setup, then enter acquisition from NEW sessions
  // without fixture-held row/FK locks. The disposable stack owns these rows.
  const orderId=await json(`BEGIN;${setup}
    SELECT public.open_cash_shift(o.branch_id,0) FROM public.orders o
      WHERE o.id=(SELECT (result->>'order_id')::uuid FROM qa_completion_side_sale)
        AND NOT EXISTS(SELECT 1 FROM public.cash_shifts s WHERE s.branch_id=o.branch_id AND s.status='open');
    INSERT INTO public.stock_alert_reads(stock_alert_id,user_id)
      SELECT id,${q(owner)} FROM public.stock_alerts WHERE status='active'
        AND product_id IN (${q(product)},'92400000-0000-0000-0000-000000000102')
      ON CONFLICT(stock_alert_id,user_id) DO NOTHING;
    SELECT to_jsonb((result->>'order_id')::text) FROM qa_completion_side_sale;COMMIT;`);
  const literal=args.replace("(SELECT (result->>'order_id')::uuid FROM qa_completion_side_sale)",q(orderId));
  const sourceArgs=`${q(kind)},${kind==='customer'?literal:literal.replace(`${q(orderId)},`,`${q(orderId)},NULL,`)}`;
  const prepare=`${claims}
    CREATE TEMP TABLE qa_lock_identity AS SELECT phase5_private.plan_${kind}_completion_identity_union_v1(${literal},NULL,NULL,NULL) plan;
    CREATE TEMP TABLE qa_lock_slots AS SELECT jsonb_build_object('eventAt',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'eventTimeZone',current_setting('TimeZone'),'transactionId','123456','paymentSequenceValue','null'::jsonb,
      'movementSequences',(SELECT jsonb_agg(jsonb_build_object('sourceId',source_id,'sequenceValue',(100+ord)::text) ORDER BY ord) FROM (
        ${kind==='customer'?`SELECT n->>'id' source_id,row_number() OVER(ORDER BY n->'row'->>'product_id',n->>'id') ord
          FROM jsonb_array_elements((SELECT plan#>'{sourceUnion,parent,resources}' FROM qa_lock_identity)) n WHERE n->>'relation'='public.order_inventory_reservations'`:
          `SELECT n->>'id' source_id,row_number() OVER(ORDER BY n->>'id' COLLATE "C") ord
          FROM jsonb_array_elements((SELECT plan#>'{sourceUnion,commercial,sourceItems}' FROM qa_lock_identity)) n`}) sources)) slots;
    CREATE TEMP TABLE qa_lock_protocol AS SELECT phase5_private.plan_${kind}_completion_execution_groups_v1(${literal},
      (SELECT plan FROM qa_lock_identity),(SELECT slots FROM qa_lock_slots)) protocol;
    CREATE TEMP TABLE qa_lock_plan AS SELECT phase5_private.plan_completion_lock_union_v1(${sourceArgs},(SELECT protocol FROM qa_lock_protocol)) plan;`;
  const call=`phase5_private.acquire_completion_lock_union_v1(${sourceArgs},(SELECT plan FROM qa_lock_plan))`;
  const before=await fingerprint();
  const deadlocks=await json('SELECT to_jsonb(deadlocks) FROM pg_stat_database WHERE datname=current_database();');
  const clean=await json(`BEGIN;${prepare} SELECT ${call};ROLLBACK;`);
  assert.equal(clean.locksHeld,true);assert.equal(clean.executionAuthority,false);
  assert.equal(clean.heldContextAuthority,false);assert.equal(clean.writerClosed,false);
  assert.equal(clean.absencePredicatesFenced,false);assert.equal(clean.contextCreated,false);
  assert.equal(clean.durableClaimsCreated,false);assert.equal(clean.progressRecorded,false);
  assert.ok(clean.resources.some(n=>n.relation==='public.stock_alerts'));
  assert.ok(clean.resources.some(n=>n.relation==='public.stock_alert_reads'),'actual composite read rows must be acquired');checks++;
  assert.equal(new Set(clean.resources.map(n=>`${n.relation}|${n.id}`)).size,clean.resources.length);
  assert.equal(await fingerprint(),before);checks+=11;
  // Cover real Shift/FK resources and the owned modern financial child while
  // retaining the exact same uncompleted commercial fixture.
  for(const tender of ['cash','cliq']) {
    const variant=literal.replace("'debt',0,NULL,NULL,NULL",`${q(tender)},300,NULL,${tender==='cliq'?q('S5-LOCK-CLIQ'):"NULL"},NULL`);
    assert.notEqual(variant,literal);
    const variantSource=`${q(kind)},${kind==='customer'?variant:variant.replace(`${q(orderId)},`,`${q(orderId)},NULL,`)}`;
    const variantPrepare=prepare.replaceAll(literal,variant).replaceAll(sourceArgs,variantSource)
      .replace("'paymentSequenceValue','null'::jsonb","'paymentSequenceValue','\"20261006\"'::jsonb");
    const v=await json(`BEGIN;${variantPrepare}SELECT phase5_private.acquire_completion_lock_union_v1(${variantSource},(SELECT plan FROM qa_lock_plan));ROLLBACK;`);
    assert.equal(v.locksHeld,true);assert.equal(v.executionAuthority,false);
    // Current completion contracts require the open Shift for collected money,
    // including CliQ; this does not invent any Cash movement for CliQ.
    assert.ok(v.resources.some(r=>r.relation==='public.cash_shifts'));
    assert.equal(await fingerprint(),before);checks+=4;
  }
  const compositeIndex=clean.resources.findIndex(r=>r.relation==='public.stock_alert_reads');
  for(const mutation of [
    "plan=jsonb_set(plan,'{resources}',(plan->'resources')-0)",
    "plan=jsonb_set(plan,'{resources}',(plan->'resources')||jsonb_build_array(plan->'resources'->0))",
    "plan=jsonb_set(plan,'{resources,0,mode}','\"KEY_SHARE\"')",
    "plan=jsonb_set(plan,'{resources,0,row}','{}')",
    "plan=jsonb_set(plan,'{inventoryGates}','[]')",
    "plan=jsonb_set(plan,'{executionAuthority}','true')",
    "plan=jsonb_set(plan,'{protocol,sourceBindingComplete}','null')",
    `plan=jsonb_set(plan,'{resources,${compositeIndex},id}','"foreign-composite-key"')`,
    `plan=jsonb_set(plan,'{resources,${compositeIndex},row,user_id}','"92400000-0000-0000-0000-000000000002"')`,
  ]) {
    await fails(`${prepare}UPDATE qa_lock_plan SET ${mutation};SELECT ${call};`,/40001.*(?:PHASE5_COMPLETION_LOCK_PLAN_CHANGED|PHASE5_COMPLETION_GROUPS_CHANGED_RETRY)/u);
    assert.equal(await fingerprint(),before);checks++;
  }
  for(const early of [`SELECT id FROM public.orders WHERE id=${q(orderId)} FOR UPDATE;`,
    `SELECT pg_advisory_xact_lock(hashtextextended('inventory-product:${product}',0));`]) {
    await fails(`${prepare}${early}SELECT ${call};`,/40001.*PHASE5_COMPLETION_LOCK_LATE_ENTRY_RETRY/u);
    assert.equal(await fingerprint(),before);checks++;
  }
  // The merge is generic but cannot bypass the source-qualified acquirer.
  const n=clean.resources.find(r=>r.relation==='public.products');
  const merged=await json(`SELECT phase5_private.merge_completion_lock_resources_v1(${j([n,{...n,mode:'SHARE',rank:7}])});`);
  assert.equal(merged.length,1);assert.equal(merged[0].mode,'NO_KEY_UPDATE');assert.equal(merged[0].rank,5);checks+=3;
  await fails(`SELECT phase5_private.merge_completion_lock_resources_v1(${j([n,{...n,row:{...n.row,min_stock_level:999}}])});`,/40001.*PHASE5_COMPLETION_LOCK_RESOURCE_INVALID/u);
  for(const role of ['anon','authenticated','service_role']) {
    await fails(`SET LOCAL ROLE ${role};SELECT phase5_private.merge_completion_lock_resources_v1(${j([n])});`,/42501.*permission denied/u);
    await fails(`SET LOCAL ROLE ${role};SELECT phase5_private.plan_completion_lock_union_v1(${sourceArgs},${j(clean.protocol)});`,/42501.*permission denied/u);
    await fails(`SET LOCAL ROLE ${role};SELECT phase5_private.acquire_completion_lock_union_v1(${sourceArgs},${j({...clean,locksHeld:false})});`,/42501.*permission denied/u);
  }
  // Actual fully acquired union holds real row locks in an independent session.
  const release=await holdSQL(`${prepare}SELECT ${call};`,'S5-COMPLETION-UNION-HOLDER');
  try {
    for(const r of clean.resources.filter(r=>['public.stock_alerts','public.inventory_balances','public.products'].includes(r.relation)).slice(0,5))
      await fails(`SELECT id FROM ${r.relation} WHERE id=${q(r.id)} FOR UPDATE NOWAIT;`,/55P03.*could not obtain lock/u);
    const read=clean.resources.find(r=>r.relation==='public.stock_alert_reads');
    await fails(`SELECT user_id FROM public.stock_alert_reads WHERE stock_alert_id=${q(read.row.stock_alert_id)}
      AND user_id=${q(read.row.user_id)} FOR UPDATE NOWAIT;`,/55P03.*could not obtain lock/u);
  } finally {await release();}
  assert.equal(await fingerprint(),before);checks++;
  for(const direction of ['A','B']) {
    const finish=await holdSQL(`SELECT pg_advisory_xact_lock(hashtextextended('phase4-order|${orderId}',0));`,`S5-COMPLETION-ROOT-${direction}`);
    const waitingCall=sql(`BEGIN;SET LOCAL application_name='S5-COMPLETION-UNION-WAITER';${prepare}SELECT ${call};ROLLBACK;`);
    void waitingCall.catch(()=>{});
    try {
      let waiting=false;const deadline=Date.now()+8000;
      while(!waiting&&Date.now()<deadline)waiting=await json(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE application_name='S5-COMPLETION-UNION-WAITER' AND wait_event_type='Lock' AND wait_event='advisory'));`);
      assert.equal(waiting,true,'actual canonical root wait must be observed');checks++;
    } finally {await finish();}
    const result=JSON.parse((await waitingCall).stdout.trim().split(/\r?\n/u).at(-1));
    assert.equal(result.locksHeld,true);assert.equal(result.executionAuthority,false);
    assert.equal(await fingerprint(),before);checks+=3;
  }
  // Freeze the source, observe the real root wait, then alter that source in a
  // third isolated session. Revalidation must reject AFTER lock acquisition.
  const driftRelease=await holdSQL(`SELECT pg_advisory_xact_lock(hashtextextended('phase4-order|${orderId}',0));`,'S5-COMPLETION-DRIFT-ROOT');
  const driftCall=sql(`BEGIN;SET LOCAL application_name='S5-COMPLETION-DRIFT-WAITER';${prepare}SELECT ${call};ROLLBACK;`,true);
  void driftCall.catch(()=>{});
  let driftBefore;
  try {
    let waiting=false;const deadline=Date.now()+8000;
    while(!waiting&&Date.now()<deadline)waiting=await json(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity
      WHERE application_name='S5-COMPLETION-DRIFT-WAITER' AND wait_event_type='Lock' AND wait_event='advisory'));`);
    assert.equal(waiting,true,'source drift requires actual observed wait');checks++;
    await sql(`UPDATE public.products SET name_ar=name_ar||' lock-drift' WHERE id=${q(product)};`);
    driftBefore=await fingerprint();assert.notEqual(driftBefore,before);checks++;
  } finally {await driftRelease();}
  const driftResult=await driftCall;
  assert.match(driftResult.stderr,/40001.*PHASE5_COMPLETION_LOCK_ROW_CHANGED/u);checks++;
  assert.equal(await fingerprint(),driftBefore);checks++;
  const afterDeadlocks=await json('SELECT to_jsonb(deadlocks) FROM pg_stat_database WHERE datname=current_database();');
  assert.equal(afterDeadlocks-deadlocks,0);checks++;
  passed.push(`completion-lock-union-${kind}: actual generation0 source-qualified acquisition, exact strongest-mode merge, held source/alert rows and both observed root-wait labels; sampled deadlockDelta=0; mutations/late-entry/real-role admission reject, full durable content unchanged; no held-context/absence-fence/execution authority`);
};

const completionSideEffectAdaptersRuntime = async (claims) => {
  const before=await fingerprint();
  const expr=fingerprintQuery.trim().replace(/;$/u,'');
  const customerLines=[{commercial_line_kind:'base_unit',product_id:product,base_quantity:2,expected_unit_price_in_minor_units:1000},
    {commercial_line_kind:'configurable_parcel',family_product_id:'92400000-0000-0000-0000-000000000100',
      parcel_configuration_id:'92400000-0000-0000-0000-000000000300',configuration_revision:1,
      expected_unit_price_in_minor_units:5000,parcel_instances:[{components:[{product_id:product,base_quantity:2},
        {product_id:'92400000-0000-0000-0000-000000000102',base_quantity:3}]}]}];
  for(const kind of ['customer','legacy']) {
    const requestKey=randomUUID();
    const sourceOrder="(SELECT (result->>'order_id')::uuid FROM qa_completion_side_sale)";
    const args=kind==='customer'?`${sourceOrder},${q(requestKey)},'debt',0,NULL,NULL,NULL`:
      `${sourceOrder},'debt',0,NULL,NULL,NULL`;
    const plan=`phase5_private.plan_${kind}_inventory_side_effects_v1(${args},NULL)`;
    const assertion=`phase5_private.assert_${kind}_inventory_side_effects_v1(${args},(SELECT plan FROM qa_completion_side_plan))`;
    const submit=kind==='customer'?`
      SELECT set_config('request.jwt.claim.role','service_role',false);
      CREATE TEMP TABLE qa_completion_side_sale AS SELECT public.submit_guest_customer_order_v2(${q(randomUUID())},repeat('c',64),repeat('d',64),
        'Side-effect Customer source','0791234599','إربد','الرمثا','الحي الشرقي','شارع الاختبار',NULL,NULL,NULL,NULL,NULL,NULL,
        ${j(customerLines)},NULL,'cash_on_delivery','inside_ramtha',7000,0,100,7100) result;
      ${claims} UPDATE public.orders SET status='ready' WHERE id=${sourceOrder};`:`
      SET LOCAL ROLE authenticated;
      CREATE TEMP TABLE qa_completion_side_sale AS SELECT public.create_customer_order(
        p_customer_full_name=>'Side-effect historical source',p_customer_phone=>'0781234599',p_governorate=>'إربد',p_city=>'الرمثا',
        p_area=>'الحي الشرقي',p_street=>'شارع الاختبار',p_branch_id=>${q(branch)},p_warehouse_id=>${q(warehouse)},
        p_items=>${j([{product_id:product,quantity:1},{product_id:product,quantity:1}])},p_source=>'website') result;
      RESET ROLE;
      SELECT public.accept_order_for_preparation(${sourceOrder},'Side-effect Legacy acceptance');
      SELECT public.update_order_status(${sourceOrder},'ready','Side-effect Legacy ready');`;
    const setup=`${claims}
      UPDATE public.configurable_parcel_feature_settings SET feature_state='ENABLED';
      UPDATE public.storefront_settings SET orders_enabled=true,minimum_order_in_minor_units=0,inside_ramtha_delivery_fee_in_minor_units=100;
      INSERT INTO public.inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity)
        SELECT w.id,sku,100,0 FROM public.warehouses w JOIN public.branches b ON b.id=w.branch_id
        CROSS JOIN unnest(ARRAY[${q(product)}::uuid,'92400000-0000-0000-0000-000000000102'::uuid]) sku WHERE w.is_active AND b.is_active
        ON CONFLICT(warehouse_id,product_id) DO UPDATE SET on_hand_quantity=100,reserved_quantity=0;
      UPDATE public.products SET min_stock_level=101 WHERE id IN (${q(product)},'92400000-0000-0000-0000-000000000102');
      ${submit}
      CREATE TEMP TABLE qa_completion_side_baseline AS SELECT (${expr}) content,
        (SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory') locks;
      CREATE TEMP TABLE qa_completion_side_plan AS SELECT ${plan} plan;`;
    if(completionLockUnionFocused) {
      await completionLockUnionRuntime({setup,args,kind,claims});
      continue;
    }
    const result=await json(`BEGIN; ${setup} SELECT jsonb_build_object('plan',(SELECT plan FROM qa_completion_side_plan),
      'valid',${assertion},'unchanged',(${expr})=(SELECT content FROM qa_completion_side_baseline),
      'locksSame',(SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory')=(SELECT locks FROM qa_completion_side_baseline)); ROLLBACK;`);
    assert.equal(result.valid,true);assert.equal(result.unchanged,true);assert.equal(result.locksSame,true);
    assert.equal(result.plan.sourceBindingComplete,true);assert.equal(result.plan.executionAuthority,false);
    assert.equal(result.plan.locksHeld,false);assert.equal(result.plan.futureWriteOwnershipComplete,false);
    const steps=result.plan.inventoryModel.steps;
    const sources=steps.map(s=>s.source);
    assert.equal(sources.length,kind==='customer'?3:2);
    assert.equal(new Set(sources.map(s=>s.sourceId)).size,sources.length);
    assert.ok(sources.every(s=>s.orderId===sources[0].orderId));
    assert.ok(sources.every(s=>s.sourceKind===(kind==='customer'?'CUSTOMER_COMPLETION':'LEGACY_WEBSITE_COMPLETION')));
    if(kind==='customer') {
      assert.deepEqual(sources.map(s=>s.onHandBefore-s.onHandAfter).sort(),[2,2,3]);
      assert.ok(sources.every(s=>s.onHandBefore-s.onHandAfter===s.reservedBefore-s.reservedAfter));
      assert.ok(sources.every(s=>s.operationId===result.plan.sourcePlan.creation.id));
      assert.equal(sources.filter(s=>s.componentId!==null).length,2);
    } else {
      assert.ok(sources.every(s=>s.operationId===null && s.componentId===null));
      assert.equal(result.plan.sourcePlan.commercial.sourceOrder.operation_id,null);
      const expected=result.plan.sourcePlan.commercial.sourceItems;
      assert.deepEqual(sources.map(s=>s.orderItemId),expected.map(s=>s.id).sort());
      for(const s of sources) {
        const item=expected.find(i=>i.id===s.orderItemId);
        assert.equal(s.onHandBefore-s.onHandAfter,item.quantity);
        assert.equal(s.reservedAfter,Math.max(0,s.reservedBefore-item.quantity));
      }
    }
    const sameSku=sources.filter(s=>s.productId===product);
    assert.equal(sameSku.length,2);assert.equal(sameSku[1].onHandBefore,sameSku[0].onHandAfter);
    assert.equal(sameSku[1].reservedBefore,sameSku[0].reservedAfter);
    assert.equal(await fingerprint(),before);checks+=20;
    if(inventoryIdentityCoverage) await inventoryIdentityManifestRuntime({setup,before,label:kind,
      model:"(SELECT plan->'inventoryModel' FROM qa_completion_side_plan)",baseline:'qa_completion_side_baseline',
      wrapper:`phase5_private.plan_${kind}_inventory_identity_manifest_v1(${args},
        (SELECT plan->'inventoryModel'->'allocation' FROM qa_completion_side_plan))`});
    if(inventoryIdentityCoverage) await completionInventoryIdentityUnionRuntime({setup,args,kind,before});
    if(completionTriggerRowsFocused) {
      await completionTriggerRowsRuntime({setup,args,kind,before});
      continue;
    }
    if(completionRowsFocused) {
      await completionBusinessRowsRuntime({setup,args,kind,before});
      continue;
    }
    if(![legacyFocused,shiftPaymentFocused,shiftTriggerIdentityFocused,inventorySideEffectPlanFocused,inventoryAuthorityFocused,inventoryIdentityFocused,completionIdentityFocused].some(Boolean))
      await completionBusinessRowsRuntime({setup,args,kind,before});
    if(completionIdentityFocused || ![legacyFocused,shiftPaymentFocused,shiftTriggerIdentityFocused,inventorySideEffectPlanFocused,inventoryAuthorityFocused,inventoryIdentityFocused].some(Boolean))
      await completionControlIdentityUnionRuntime({setup,args,kind,before});
    for(const mutation of [
      "plan=jsonb_set(plan,'{executionAuthority}','true')",
      "plan=jsonb_set(plan,'{inventoryModel,steps,0,source,orderItemId}',plan->'inventoryModel'->'steps'->1->'source'->'orderItemId')",
      "plan=jsonb_set(plan,'{inventoryModel,steps,0,source,onHandAfter}','99')",
      "plan=jsonb_set(plan,'{inventoryModel,allocation}','null')",
      "plan=jsonb_set(plan,'{inventoryModel,steps}',(plan->'inventoryModel'->'steps')-0)",
    ]) {
      await fails(`${setup} UPDATE qa_completion_side_plan SET ${mutation}; SELECT ${assertion};`);
      assert.equal(await fingerprint(),before);checks+=1;
    }
    for(const mutation of [
      `UPDATE public.warehouses SET name_ar='Changed frozen name' WHERE id=(SELECT (plan->'inventoryModel'->'sourceSteps'->0->>'warehouseId')::uuid FROM qa_completion_side_plan);`,
      `UPDATE public.products SET min_stock_level=102 WHERE id=${q(product)};`,
    ]) {
      await fails(`${setup} ${mutation} SELECT ${assertion};`);
      assert.equal(await fingerprint(),before);checks+=1;
    }
    const salesClaims=`SELECT set_config('request.jwt.claims','{"sub":"92400000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}',false);`;
    const sales=await json(`BEGIN; ${setup} ${salesClaims} SELECT ${plan}; ROLLBACK;`);
    assert.equal(sales.sourceBindingComplete,true);
    assert.equal(sales.inventoryModel.actorId,'92400000-0000-0000-0000-000000000002');
    assert.equal(await fingerprint(),before);checks+=3;
    for(const role of ['anon','authenticated','service_role']) {
      for(const call of [plan,assertion]) await fails(`${setup} SET LOCAL ROLE ${role}; SELECT ${call};`,/permission denied/u);
      if(inventoryIdentityCoverage) await fails(`${setup} SET LOCAL ROLE ${role};
        SELECT phase5_private.plan_${kind}_inventory_identity_manifest_v1(${args},
          (SELECT plan->'inventoryModel'->'allocation' FROM qa_completion_side_plan));`,/42501.*permission denied/u);
    }
    // No widening of the old owner/AAL2 POS boundary via the shared kernel.
    await fails(`${setup} ${salesClaims} SELECT phase5_private.discover_shift_inventory_side_effects_v1(
      '92400000-0000-0000-0000-000000000002',ARRAY[${q(product)}::uuid]);`,
    /P0001: ليس لديك صلاحية Phase5 private inventory side-effect planning\./u);
    await fails(`${setup} ${salesClaims} SELECT phase5_private.discover_shift_inventory_side_effects_v1(
      ${q(randomUUID())},NULL);`,/42501.*PHASE5_SHIFT_ACTOR_UNAUTHORIZED/u);
    assert.equal(await fingerprint(),before);checks+=1;
    // Real profile roles: Customer126 admits accountant; Legacy060 must not.
    const accountant=`DELETE FROM public.user_roles WHERE user_id='92400000-0000-0000-0000-000000000002';
      INSERT INTO public.roles(code,name_ar) VALUES('accountant','Isolated Accountant') ON CONFLICT(code) DO NOTHING;
      INSERT INTO public.user_roles(user_id,role_id) SELECT '92400000-0000-0000-0000-000000000002',id FROM public.roles WHERE code='accountant';`;
    if(kind==='customer') {
      const allowed=await json(`BEGIN; ${setup} ${accountant} ${salesClaims} SELECT ${plan}; ROLLBACK;`);
      assert.equal(allowed.sourceBindingComplete,true);checks+=1;
    } else await fails(`${setup} ${accountant} ${salesClaims} SELECT ${plan};`,/42501.*LEGACY_ACTOR_UNAUTHORIZED/u);
    assert.equal(await fingerprint(),before);checks+=1;
    passed.push(`completion-side-effect-source-binding-${kind}: real source lifecycle, per-reservation/item order and repeated SKU running tuples; exact source/content/NULL corruption rollback, source-specific Sales/accountant authority and private role denial; no locks/claims/execution`);
  }
};

// This rehearses target ACLs/statement bindings ONLY in disposable transactions.
// The installed migration does not alter public authority. No source closure,
// context, acquisition, activation or execution permit is inferred from it.
const inventoryAuthorityRuntime = async (claims) => {
  const before=await fingerprint();
  const tables=['products','inventory_balances','stock_alerts','stock_alert_reads','automation_events'];
  const catalog='phase5_private.inventory_authority_catalog_v1()';
  const target=`phase5_private.assert_inventory_authority_target_v1(${catalog})`;
  const freeze=`CREATE TEMP TABLE qa_authority_snapshot AS SELECT ${catalog} AS envelope;`;
  const compare='SELECT phase5_private.assert_inventory_authority_snapshot_v1((SELECT envelope FROM qa_authority_snapshot));';
  const converge=tables.map(t=>`REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public.${t}
    FROM PUBLIC,anon,authenticated,service_role;
    CREATE TRIGGER phase5_inventory_no_truncate BEFORE TRUNCATE ON public.${t}
      FOR EACH STATEMENT EXECUTE FUNCTION phase5_private.reject_inventory_truncate_v1();
    ALTER TABLE public.${t} ENABLE ALWAYS TRIGGER phase5_inventory_no_truncate;`).join('\n');
  const qualified={directAuthorityQualified:true,writerClosed:false,activationReady:false,
    executionAllowed:false,scope:'FIVE_RELATION_DIRECT_AUTHORITY_ONLY'};
  const observed=await json(`SELECT ${catalog};`);
  assert.equal(observed.relations.length,5);assert.equal(observed.writerClosed,false);
  assert.equal(observed.executionAllowed,false);assert.ok(observed.effectiveAuthority.some(a=>a.mutation));checks+=4;
  assert.equal(await json(`SELECT to_jsonb(phase5_private.assert_inventory_authority_snapshot_v1(${j(observed)}));`),true);checks+=1;
  await fails(`SELECT ${target};`,/PHASE5_INVENTORY_PROHIBITED_AUTHORITY/u);
  for(const value of ['NULL',"'null'::jsonb","'{}'::jsonb","'[]'::jsonb"])
    await fails(`SELECT phase5_private.assert_inventory_authority_snapshot_v1(${value});`,/PHASE5_INVENTORY_AUTHORITY_DRIFT/u);
  assert.equal(await fingerprint(),before);checks+=1;
  passed.push('authority-snapshot-zero-write: baseline is diagnostic only; residual authority cannot self-approve target');
  console.log('Inventory authority diagnostic snapshot and baseline rejection verified.');

  // All current catalog/ACL/roles/defaults/SD bodies are independently frozen.
  for(const mutation of [
    'GRANT UPDATE(name_ar) ON public.products TO authenticated;',
    'GRANT REFERENCES(id) ON public.products TO PUBLIC;',
    'CREATE ROLE qa_authority_delegate; GRANT qa_authority_delegate TO authenticated WITH INHERIT FALSE, SET TRUE;',
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM authenticated;',
    'ALTER TABLE public.inventory_balances DISABLE TRIGGER USER;',
    'ALTER FUNCTION public.mark_stock_alert_read(uuid) SET search_path=public;',
    "SELECT cron.alter_job(jobid,active:=NOT active) FROM cron.job WHERE jobname='run-advanced-monitoring';",
  ]) {
    await fails(`${freeze} ${mutation} ${compare}`,/PHASE5_INVENTORY_AUTHORITY_DRIFT/u);
    assert.equal(await fingerprint(),before);checks+=1;
  }
  assert.deepEqual(await json(`BEGIN; ${converge} SELECT ${target}; ROLLBACK;`),qualified);checks+=1;
  assert.deepEqual(await json(`SELECT ${catalog};`),observed);checks+=1;
  passed.push('authority-target-rollback-only: five fixed relations, strict no-direct-write/non-row rights and ALWAYS statement guards; writerClosed/activationReady/executionAllowed remain false');
  console.log('Inventory authority rollback-only target qualification verified.');

  for(const mutation of [
    'GRANT UPDATE(name_ar) ON public.products TO authenticated;',
    'GRANT REFERENCES(id) ON public.products TO PUBLIC;',
    'GRANT SELECT ON public.products TO authenticated WITH GRANT OPTION;',
    'CREATE ROLE qa_authority_delegate; GRANT TRUNCATE ON public.inventory_balances TO qa_authority_delegate; GRANT qa_authority_delegate TO authenticated WITH INHERIT FALSE, SET TRUE;',
    'GRANT pg_write_all_data TO authenticated;',
    'GRANT pg_maintain TO authenticated;',
    'GRANT CREATE ON SCHEMA public TO authenticated;',
    'GRANT SET ON PARAMETER session_replication_role TO authenticated;',
  ]) {
    // Predefined-role fault injection needs the actual disposable superuser;
    // postgres is intentionally unable to grant these roles in Supabase.
    await fails(`${converge} ${mutation} SELECT ${target};`,/PHASE5_INVENTORY_PROHIBITED_AUTHORITY/u,'supabase_admin');
    assert.equal(await fingerprint(),before);checks+=1;
  }
  for(const mutation of [
    'ALTER TABLE public.products DISABLE TRIGGER phase5_inventory_no_truncate;',
    'ALTER TABLE public.products ENABLE TRIGGER phase5_inventory_no_truncate;',
    'DROP TRIGGER phase5_inventory_no_truncate ON public.products;',
    "CREATE OR REPLACE FUNCTION phase5_private.reject_inventory_truncate_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN RETURN NULL; END; $$;",
  ]) await fails(`${converge} ${mutation} SELECT ${target};`,/PHASE5_INVENTORY_TRUNCATE_GUARD_INVALID/u);
  await fails(`${converge} ALTER TABLE public.products OWNER TO authenticated; SELECT ${target};`,
    /PHASE5_INVENTORY_(?:PROHIBITED_AUTHORITY|RELATION_AUTHORITY_INVALID)/u,'supabase_admin');
  passed.push('authority-effective-drift: column/PUBLIC/grant-option/SET ROLE/write-all/maintain/schema/replication/owner and disabled/replaced/missing/origin-only guard reject');

  for(const role of ['anon','authenticated','service_role']) {
    for(const t of tables) {
      for(const command of [`INSERT INTO public.${t} DEFAULT VALUES;`,`TRUNCATE public.${t} CASCADE;`,
        `UPDATE public.${t} SET ${t==='stock_alert_reads'?'read_at=read_at':'id=id'};`,
        `DELETE FROM public.${t};`])
        await fails(`${converge} SET LOCAL ROLE ${role}; ${command}`,/42501/u);
    }
    for(const fn of ['inventory_authority_catalog_v1()',
      "assert_inventory_authority_snapshot_v1('{}'::jsonb)","assert_inventory_authority_target_v1('{}'::jsonb)"])
      await fails(`SET LOCAL ROLE ${role}; SELECT phase5_private.${fn};`,/42501/u);
  }
  const alert=randomUUID(), event=randomUUID();
  const nonempty=`INSERT INTO public.stock_alerts(id,product_id,warehouse_id,severity,available_quantity,threshold_quantity)
      VALUES(${q(alert)},${q(product)},${q(warehouse)},'low_stock',100,101);
    INSERT INTO public.stock_alert_reads(stock_alert_id,user_id) VALUES(${q(alert)},${q(owner)});
    INSERT INTO public.automation_events(id,event_key,event_type,entity_id,payload)
      VALUES(${q(event)},${q('qa-authority:'+event)},'low_stock',${q(alert)},'{"isolated":true}'::jsonb);`;
  // Deliberately regrant TRUNCATE: prove the guard, not only an ACL error. Each
  // transaction starts nonempty, and failure rolls back both fixture and DDL.
  for(const mode of ['origin','replica']) {
    for(const t of tables) {
      const replication=mode==='replica'?'SET LOCAL session_replication_role=replica;':'';
      // Owner exercises CASCADE because unrelated FK tables are intentionally
      // not granted to an app role. The unconditional guard also rejects owner.
      await fails(`${nonempty} ${converge} ${replication}
        TRUNCATE ONLY public.${t} RESTART IDENTITY CASCADE;`,
        /42501.*PHASE5_INVENTORY_TRUNCATE_FORBIDDEN/u,'supabase_admin');
      assert.equal(await fingerprint(),before);checks+=1;
    }
  }
  await fails(`${nonempty} ${converge} GRANT TRUNCATE ON public.stock_alert_reads TO authenticated;
    SET LOCAL session_replication_role=replica; SET LOCAL ROLE authenticated;
    TRUNCATE public.stock_alert_reads RESTART IDENTITY;`,/42501.*PHASE5_INVENTORY_TRUNCATE_FORBIDDEN/u,'supabase_admin');
  await fails(`${nonempty} ${converge}
    TRUNCATE public.stock_alerts,public.stock_alert_reads RESTART IDENTITY CASCADE;`,
    /42501.*PHASE5_INVENTORY_TRUNCATE_FORBIDDEN/u,'supabase_admin');
  passed.push('authority-nonempty-truncate: owner ONLY/multi-table/CASCADE/RESTART IDENTITY and origin/replica guard rejection; authenticated retained-TRUNCATE grant also rejected in replica mode; exact source/delivery/content rollback');

  // Real approved public SD paths are preserved under the simulated target.
  const compatibility=await json(`BEGIN; ${nonempty} ${converge} ${claims}
    CREATE TEMP TABLE qa_authority_compatibility(label text,value jsonb);
    GRANT INSERT ON qa_authority_compatibility TO authenticated,service_role;
    SET LOCAL ROLE authenticated;
    INSERT INTO qa_authority_compatibility VALUES('adjust',public.adjust_inventory_stock(${q(warehouse)},${q(product)},99,'Isolated authority compatibility','stock_count'));
    INSERT INTO qa_authority_compatibility VALUES('read',public.mark_stock_alert_read(${q(alert)}));
    RESET ROLE;
    CREATE TEMP TABLE qa_event_frozen AS SELECT to_jsonb(e) AS row FROM public.automation_events e WHERE id=${q(event)};
    SET LOCAL ROLE service_role;
    INSERT INTO qa_authority_compatibility VALUES('claim',public.claim_automation_deliveries('telegram',50,120));
    INSERT INTO qa_authority_compatibility VALUES('ack',public.complete_automation_delivery(${q(event)},'telegram',true,NULL));
    RESET ROLE;
    SELECT jsonb_build_object('adjust',(SELECT value->'success' FROM qa_authority_compatibility WHERE label='adjust'),
      'read',(SELECT value->'success' FROM qa_authority_compatibility WHERE label='read'),
      'claim',(SELECT value->'success' FROM qa_authority_compatibility WHERE label='claim'),
      'claimedExactEvent',EXISTS(SELECT 1 FROM qa_authority_compatibility, jsonb_array_elements(value->'items') i WHERE label='claim' AND i->>'eventId'=${q(event)}),
      'ack',(SELECT value->'success' FROM qa_authority_compatibility WHERE label='ack'),
      'deliveryStatus',(SELECT status FROM public.automation_event_deliveries WHERE event_id=${q(event)} AND channel='telegram'),
      'sourceUnchanged',(SELECT to_jsonb(e) FROM public.automation_events e WHERE id=${q(event)})=(SELECT row FROM qa_event_frozen),
      'directQualified',${target}->'directAuthorityQualified');
    ROLLBACK;`);
  assert.deepEqual(compatibility,{adjust:true,read:true,claim:true,claimedExactEvent:true,ack:true,
    deliveryStatus:'delivered',sourceUnchanged:true,directQualified:true});checks+=8;
  assert.equal(await fingerprint(),before);checks+=1;
  assert.deepEqual(await json(`SELECT ${catalog};`),observed);checks+=1;
  passed.push('authority-real-public-compatibility: owner inventory adjustment and read-mark plus service claim/ack preserve exact delivery and source content; all target DDL/ACL/fixture state rolled back');

  // Independent-audit counterexamples: freeze BEFORE the authority mutation.
  // A failure before compare is not accepted as drift proof. The SQL helpers
  // below assert the injected catalog fact before invoking the shared assertion.
  const driftCase = async (name,setup,mutation,proof) => {
    try {
      await fails(`${setup} ${freeze} ${mutation} ${proof} ${compare}`,
        /40001.*PHASE5_INVENTORY_AUTHORITY_DRIFT/u,'supabase_admin');
    } catch (error) {
      throw new Error(`Authority completeness probe failed: ${name}`,{cause:error});
    }
    assert.equal(await fingerprint(),before);checks+=1;
    assert.deepEqual(await json(`SELECT ${catalog};`),observed);checks+=1;
    passed.push(`authority-completeness:${name}: real catalog mutation detected; exact data/catalog rollback`);
  };
  const procedureDefinition = `CREATE PROCEDURE public.qa_authority_procedure()
    LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
    UPDATE public.products SET name_ar='isolated authority corruption' WHERE id=${q(product)};
    $$; ALTER PROCEDURE public.qa_authority_procedure() OWNER TO postgres;
    REVOKE ALL ON PROCEDURE public.qa_authority_procedure() FROM PUBLIC,anon,authenticated,service_role;
    DO $$ BEGIN IF has_function_privilege('authenticated','public.qa_authority_procedure()','EXECUTE')
      THEN RAISE EXCEPTION 'PROCEDURE_SETUP_NOT_PRIVATE'; END IF; END $$;`;
  const procedureProof = `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_proc
    WHERE oid='public.qa_authority_procedure()'::regprocedure AND prokind='p' AND prosecdef
      AND has_function_privilege('authenticated',oid,'EXECUTE')) THEN
    RAISE EXCEPTION 'PROCEDURE_FAULT_NOT_INJECTED'; END IF; END $$;`;
  await driftCase('new-procedure', '', `${procedureDefinition}
    GRANT EXECUTE ON PROCEDURE public.qa_authority_procedure() TO authenticated;`,procedureProof);
  await driftCase('procedure-execute-grant',procedureDefinition,
    'GRANT EXECUTE ON PROCEDURE public.qa_authority_procedure() TO authenticated;',procedureProof);
  await driftCase('procedure-body',procedureDefinition,
    `CREATE OR REPLACE PROCEDURE public.qa_authority_procedure() LANGUAGE sql SECURITY DEFINER
      SET search_path=pg_catalog AS $$ SELECT 42 $$;`,
    `DO $$ BEGIN IF position('42' IN pg_get_functiondef('public.qa_authority_procedure()'::regprocedure))=0
      THEN RAISE EXCEPTION 'PROCEDURE_FAULT_NOT_INJECTED'; END IF; END $$;`);
  await driftCase('procedure-search-path',procedureDefinition,
    'ALTER PROCEDURE public.qa_authority_procedure() SET search_path=public;',
    `DO $$ BEGIN IF (SELECT proconfig FROM pg_proc WHERE oid='public.qa_authority_procedure()'::regprocedure)
      IS DISTINCT FROM ARRAY['search_path=public'] THEN RAISE EXCEPTION 'PROCEDURE_FAULT_NOT_INJECTED'; END IF; END $$;`);
  await driftCase('procedure-owner',procedureDefinition,
    'ALTER PROCEDURE public.qa_authority_procedure() OWNER TO supabase_admin;',
    `DO $$ BEGIN IF (SELECT proowner FROM pg_proc WHERE oid='public.qa_authority_procedure()'::regprocedure)
      IS DISTINCT FROM 'supabase_admin'::regrole THEN RAISE EXCEPTION 'PROCEDURE_FAULT_NOT_INJECTED'; END IF; END $$;`);

  const windowSetup=`CREATE FUNCTION public.qa_authority_window() RETURNS integer WINDOW
    LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
      UPDATE public.products SET name_ar='isolated WINDOW authority' WHERE id=${q(product)};
      RETURN 17; END $$;
    ALTER FUNCTION public.qa_authority_window() OWNER TO postgres;
    REVOKE ALL ON FUNCTION public.qa_authority_window() FROM PUBLIC,anon,authenticated,service_role;`;
  const windowProof=`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_proc
      WHERE oid='public.qa_authority_window()'::regprocedure AND prokind='w' AND prosecdef
        AND has_function_privilege('authenticated',oid,'EXECUTE')) THEN
      RAISE EXCEPTION 'WINDOW_FAULT_NOT_INJECTED'; END IF; END $$;
    SET LOCAL ROLE authenticated; SELECT public.qa_authority_window() OVER(); RESET ROLE;
    DO $$ BEGIN IF (SELECT name_ar FROM public.products WHERE id=${q(product)})
      IS DISTINCT FROM 'isolated WINDOW authority' THEN RAISE EXCEPTION 'WINDOW_NOT_EXECUTED'; END IF; END $$;`;
  await driftCase('new-window','',`${windowSetup}
    GRANT EXECUTE ON FUNCTION public.qa_authority_window() TO authenticated;`,windowProof);
  await driftCase('window-execute-grant',windowSetup,
    'GRANT EXECUTE ON FUNCTION public.qa_authority_window() TO authenticated;',windowProof);
  await driftCase('window-body',windowSetup,`CREATE OR REPLACE FUNCTION public.qa_authority_window()
    RETURNS integer WINDOW LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN RETURN 42; END $$;`,
    `DO $$ BEGIN IF position('42' IN pg_get_functiondef('public.qa_authority_window()'::regprocedure))=0
      THEN RAISE EXCEPTION 'WINDOW_FAULT_NOT_INJECTED'; END IF; END $$;`);
  await driftCase('window-config',windowSetup,'ALTER FUNCTION public.qa_authority_window() SET search_path=public;',
    `DO $$ BEGIN IF (SELECT proconfig FROM pg_proc WHERE oid='public.qa_authority_window()'::regprocedure)
      IS DISTINCT FROM ARRAY['search_path=public'] THEN RAISE EXCEPTION 'WINDOW_FAULT_NOT_INJECTED'; END IF; END $$;`);
  await driftCase('window-owner',windowSetup,'ALTER FUNCTION public.qa_authority_window() OWNER TO supabase_admin;',
    `DO $$ BEGIN IF (SELECT proowner FROM pg_proc WHERE oid='public.qa_authority_window()'::regprocedure)
      IS DISTINCT FROM 'supabase_admin'::regrole THEN RAISE EXCEPTION 'WINDOW_FAULT_NOT_INJECTED'; END IF; END $$;`);

  // Deliberately OUTSIDE public/phase5_private: the aggregate dependency edge
  // must bring the support function definition/owner/config/ACL into the reader.
  const supportSetup=`CREATE SCHEMA qa_callable_support;
    GRANT USAGE ON SCHEMA qa_callable_support TO authenticated;
    CREATE FUNCTION qa_callable_support.step(s integer,x integer) RETURNS integer
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
      UPDATE public.products SET name_ar='isolated AGGREGATE authority' WHERE id=${q(product)};
      RETURN coalesce(s,0)+x; END $$;
    ALTER FUNCTION qa_callable_support.step(integer,integer) OWNER TO postgres;
    REVOKE ALL ON FUNCTION qa_callable_support.step(integer,integer) FROM PUBLIC,anon,authenticated,service_role;`;
  const aggregateDefinition=`CREATE AGGREGATE public.qa_authority_aggregate(integer)
    (SFUNC=qa_callable_support.step,STYPE=integer,INITCOND='0');
    ALTER AGGREGATE public.qa_authority_aggregate(integer) OWNER TO postgres;
    REVOKE ALL ON FUNCTION public.qa_authority_aggregate(integer) FROM PUBLIC,anon,authenticated,service_role;`;
  const aggregateSetup=`${supportSetup} ${aggregateDefinition}`;
  const aggregateProof=`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_proc
      WHERE oid='public.qa_authority_aggregate(integer)'::regprocedure AND prokind='a'
        AND has_function_privilege('authenticated',oid,'EXECUTE'))
      OR has_function_privilege('authenticated','qa_callable_support.step(integer,integer)','EXECUTE') THEN
      RAISE EXCEPTION 'AGGREGATE_FAULT_NOT_INJECTED'; END IF; END $$;
    SET LOCAL ROLE authenticated;
    SELECT public.qa_authority_aggregate(x) FROM(VALUES(1)) input(x); RESET ROLE;
    DO $$ BEGIN IF (SELECT name_ar FROM public.products WHERE id=${q(product)})
      IS DISTINCT FROM 'isolated AGGREGATE authority' THEN RAISE EXCEPTION 'AGGREGATE_NOT_EXECUTED'; END IF; END $$;`;
  await driftCase('new-aggregate',supportSetup,`${aggregateDefinition}
    GRANT EXECUTE ON FUNCTION public.qa_authority_aggregate(integer) TO authenticated;`,aggregateProof);
  await driftCase('aggregate-execute-grant',aggregateSetup,
    'GRANT EXECUTE ON FUNCTION public.qa_authority_aggregate(integer) TO authenticated;',aggregateProof);
  await driftCase('aggregate-support-body',aggregateSetup,
    `CREATE OR REPLACE FUNCTION qa_callable_support.step(s integer,x integer) RETURNS integer
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN RETURN 42; END $$;`,
    `DO $$ BEGIN IF position('42' IN pg_get_functiondef('qa_callable_support.step(integer,integer)'::regprocedure))=0
      THEN RAISE EXCEPTION 'AGGREGATE_FAULT_NOT_INJECTED'; END IF; END $$;`);
  await driftCase('aggregate-support-owner',aggregateSetup,
    'ALTER FUNCTION qa_callable_support.step(integer,integer) OWNER TO supabase_admin;',
    `DO $$ BEGIN IF (SELECT proowner FROM pg_proc WHERE oid='qa_callable_support.step(integer,integer)'::regprocedure)
      IS DISTINCT FROM 'supabase_admin'::regrole THEN RAISE EXCEPTION 'AGGREGATE_FAULT_NOT_INJECTED'; END IF; END $$;`);
  await driftCase('aggregate-support-config',aggregateSetup,
    'ALTER FUNCTION qa_callable_support.step(integer,integer) SET search_path=public;',
    `DO $$ BEGIN IF (SELECT proconfig FROM pg_proc WHERE oid='qa_callable_support.step(integer,integer)'::regprocedure)
      IS DISTINCT FROM ARRAY['search_path=public'] THEN RAISE EXCEPTION 'AGGREGATE_FAULT_NOT_INJECTED'; END IF; END $$;`);
  await driftCase('aggregate-support-acl',aggregateSetup,
    'GRANT EXECUTE ON FUNCTION qa_callable_support.step(integer,integer) TO authenticated;',
    `DO $$ BEGIN IF NOT has_function_privilege('authenticated','qa_callable_support.step(integer,integer)','EXECUTE')
      THEN RAISE EXCEPTION 'AGGREGATE_FAULT_NOT_INJECTED'; END IF; END $$;`);
  await driftCase('aggregate-owner',aggregateSetup,
    'ALTER AGGREGATE public.qa_authority_aggregate(integer) OWNER TO supabase_admin;',
    `DO $$ BEGIN IF (SELECT proowner FROM pg_proc WHERE oid='public.qa_authority_aggregate(integer)'::regprocedure)
      IS DISTINCT FROM 'supabase_admin'::regrole THEN RAISE EXCEPTION 'AGGREGATE_FAULT_NOT_INJECTED'; END IF; END $$;`);
  await driftCase('aggregate-support-schema-acl',aggregateSetup,
    'REVOKE USAGE ON SCHEMA qa_callable_support FROM authenticated;',
    `DO $$ BEGIN IF has_schema_privilege('authenticated','qa_callable_support','USAGE')
      THEN RAISE EXCEPTION 'AGGREGATE_FAULT_NOT_INJECTED'; END IF; END $$;`);
  await driftCase('aggregate-metadata-same-oid',aggregateSetup,
    `UPDATE pg_catalog.pg_aggregate SET agginitval='7'
      WHERE aggfnoid='public.qa_authority_aggregate(integer)'::regprocedure;`,
    `DO $$ BEGIN IF (SELECT agginitval FROM pg_aggregate WHERE aggfnoid='public.qa_authority_aggregate(integer)'::regprocedure)
      IS DISTINCT FROM '7' THEN RAISE EXCEPTION 'AGGREGATE_FAULT_NOT_INJECTED'; END IF; END $$;`);
  await driftCase('aggregate-definition-same-count',aggregateSetup,
    `DROP AGGREGATE public.qa_authority_aggregate(integer);
      CREATE AGGREGATE public.qa_authority_aggregate(integer)
        (SFUNC=qa_callable_support.step,STYPE=integer,INITCOND='7');`,
    `DO $$ BEGIN IF (SELECT agginitval FROM pg_aggregate WHERE aggfnoid='public.qa_authority_aggregate(integer)'::regprocedure)
      IS DISTINCT FROM '7' OR (SELECT count(*) FROM pg_proc WHERE proname='qa_authority_aggregate')<>1
      THEN RAISE EXCEPTION 'AGGREGATE_FAULT_NOT_INJECTED'; END IF; END $$;`);
  await driftCase('aggregate-support-retarget',`${aggregateSetup}
    CREATE FUNCTION qa_callable_support.alternate(s integer,x integer) RETURNS integer
      LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce(s,0)+x $$;`,
    `DROP AGGREGATE public.qa_authority_aggregate(integer);
      CREATE AGGREGATE public.qa_authority_aggregate(integer)
        (SFUNC=qa_callable_support.alternate,STYPE=integer,INITCOND='0');`,
    `DO $$ BEGIN IF (SELECT aggtransfn FROM pg_aggregate WHERE aggfnoid='public.qa_authority_aggregate(integer)'::regprocedure)
      IS DISTINCT FROM 'qa_callable_support.alternate(integer,integer)'::regprocedure
      THEN RAISE EXCEPTION 'AGGREGATE_FAULT_NOT_INJECTED'; END IF; END $$;`);

  // Existing aggregates must survive clean JSON wire round-trip without
  // calling pg_get_functiondef on prokind=a or silently losing support kinds.
  const cleanCallable=await json(`BEGIN; ${windowSetup} ${aggregateSetup}
    CREATE TEMP TABLE qa_wire AS SELECT (${catalog})::text::jsonb AS snapshot;
    SELECT jsonb_build_object('matches',phase5_private.assert_inventory_authority_snapshot_v1((SELECT snapshot FROM qa_wire)),
      'supportCaptured',EXISTS(SELECT 1 FROM jsonb_array_elements((SELECT snapshot->'functions' FROM qa_wire)) f
        WHERE (f->>'oid')::oid='qa_callable_support.step(integer,integer)'::regprocedure),
      'aggregateCaptured',EXISTS(SELECT 1 FROM jsonb_array_elements((SELECT snapshot->'functions' FROM qa_wire)) f
        WHERE f->>'kind'='a' AND f->>'aggregateSha256' IS NOT NULL)); ROLLBACK;`);
  assert.deepEqual(cleanCallable,{matches:true,supportCaptured:true,aggregateCaptured:true});checks+=3;
  assert.equal(await fingerprint(),before);checks+=1;
  assert.deepEqual(await json(`SELECT ${catalog};`),observed);checks+=1;
  const operatorSetup=`CREATE SCHEMA qa_callable_support;
    CREATE FUNCTION qa_callable_support.less(a integer,b integer) RETURNS boolean
      LANGUAGE sql IMMUTABLE AS $$ SELECT a<b $$;
    CREATE OPERATOR qa_callable_support.< (FUNCTION=qa_callable_support.less,LEFTARG=integer,RIGHTARG=integer);
    ALTER OPERATOR qa_callable_support.< (integer,integer) OWNER TO postgres;
    CREATE FUNCTION public.qa_operator_consumer(a integer,b integer) RETURNS boolean
      LANGUAGE sql BEGIN ATOMIC SELECT a OPERATOR(qa_callable_support.<) b; END;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_depend WHERE classid='pg_proc'::regclass
      AND objid='public.qa_operator_consumer(integer,integer)'::regprocedure
      AND refclassid='pg_operator'::regclass AND refobjid='qa_callable_support.<(integer,integer)'::regoperator)
      THEN RAISE EXCEPTION 'OPERATOR_DEPENDENCY_NOT_BOUND'; END IF; END $$;`;
  await driftCase('routine-operator-owner',operatorSetup,
    'ALTER OPERATOR qa_callable_support.< (integer,integer) OWNER TO supabase_admin;',
    `DO $$ BEGIN IF (SELECT oprowner FROM pg_operator WHERE oid='qa_callable_support.<(integer,integer)'::regoperator)
      IS DISTINCT FROM 'supabase_admin'::regrole THEN RAISE EXCEPTION 'OPERATOR_FAULT_NOT_INJECTED'; END IF; END $$;`);
  await driftCase('routine-operator-support-body',operatorSetup,
    `CREATE OR REPLACE FUNCTION qa_callable_support.less(a integer,b integer) RETURNS boolean
      LANGUAGE sql IMMUTABLE AS $$ SELECT a>b $$;`,
    `DO $$ BEGIN IF position('a>b' IN pg_get_functiondef('qa_callable_support.less(integer,integer)'::regprocedure))=0
      THEN RAISE EXCEPTION 'OPERATOR_FAULT_NOT_INJECTED'; END IF; END $$;`);
  for(const role of ['anon','authenticated','service_role']) {
    await fails(`SET LOCAL ROLE ${role}; CREATE FUNCTION public.qa_forbidden_window() RETURNS integer
      WINDOW LANGUAGE sql AS $$ SELECT 1 $$;`,/42501/u);
    await fails(`${aggregateSetup} SET LOCAL ROLE ${role}; CREATE AGGREGATE public.qa_forbidden_aggregate(integer)
      (SFUNC=qa_callable_support.step,STYPE=integer,INITCOND='0');`,/42501/u,'supabase_admin');
  }
  await fails(`${windowSetup} UPDATE pg_catalog.pg_proc SET prokind='x'
    WHERE oid='public.qa_authority_window()'::regprocedure; SELECT ${catalog};`,
    /55000.*PHASE5_INVENTORY_CALLABLE_KIND_UNSUPPORTED/u,'supabase_admin');
  await fails(`${aggregateSetup} DELETE FROM pg_catalog.pg_aggregate
    WHERE aggfnoid='public.qa_authority_aggregate(integer)'::regprocedure; SELECT ${catalog};`,
    /55000.*PHASE5_INVENTORY_CALLABLE_KIND_UNSUPPORTED/u,'supabase_admin');
  assert.equal(await fingerprint(),before);checks+=1;
  assert.deepEqual(await json(`SELECT ${catalog};`),observed);checks+=1;
  passed.push('callable-kind-completeness: WINDOW/AGGREGATE real execution, external support closure, clean wire replay, unknown/incomplete catalog fail-closed and actual app-role creation denials; all rollback-only');

  // Privileged catalog faults ONLY in disposable rollback-only transactions.
  // Pinned builtins deliberately lack pg_depend edges. Prove direct capture
  // before freezing; otherwise rejection could hide a failed fixture setup.
  const pinnedSetup=`CREATE AGGREGATE public.qa_pinned_aggregate(integer)
    (SFUNC=pg_catalog.int4larger,STYPE=integer,INITCOND='0',SORTOP = >);
    DO $$ DECLARE e jsonb:=${catalog}; s oid:='pg_catalog.int4larger(integer,integer)'::regprocedure;
      o oid:='pg_catalog.>(integer,integer)'::regoperator; BEGIN
      IF EXISTS(SELECT 1 FROM pg_depend WHERE classid='pg_proc'::regclass
        AND objid='public.qa_pinned_aggregate(integer)'::regprocedure
        AND ((refclassid='pg_proc'::regclass AND refobjid=s)
          OR (refclassid='pg_operator'::regclass AND refobjid=o)))
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e->'functions') f WHERE (f->>'oid')::oid=s)
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e->'routineOperators') f WHERE (f->>'oid')::oid=o)
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e->'functions') f
          WHERE (f->>'oid')::oid=(SELECT oprcode FROM pg_operator WHERE oid=o))
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e->'functions') f
          WHERE (f->>'oid')::oid=(SELECT oprrest FROM pg_operator WHERE oid=o))
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e->'functions') f
          WHERE (f->>'oid')::oid=(SELECT oprjoin FROM pg_operator WHERE oid=o))
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e->'callableReferences') f
          WHERE (f->>'objid')::oid='public.qa_pinned_aggregate(integer)'::regprocedure
            AND (f->>'refobjid')::oid=s) THEN RAISE EXCEPTION 'PINNED_REFERENCE_NOT_CAPTURED'; END IF;
    END $$;`;
  const pinnedProc="'pg_catalog.int4larger(integer,integer)'::regprocedure";
  for(const [name,mutation,predicate] of [
    ['pinned-support-config','ALTER FUNCTION pg_catalog.int4larger(integer,integer) SET search_path=public;',
      `proconfig=ARRAY['search_path=public']`],
    ['pinned-support-owner','ALTER FUNCTION pg_catalog.int4larger(integer,integer) OWNER TO postgres;',
      `proowner='postgres'::regrole`],
    ['pinned-support-acl','REVOKE EXECUTE ON FUNCTION pg_catalog.int4larger(integer,integer) FROM PUBLIC;',
      `NOT has_function_privilege('authenticated',oid,'EXECUTE')`],
    ['pinned-support-definition',`UPDATE pg_catalog.pg_proc SET prosrc='int4smaller' WHERE oid=${pinnedProc};`,
      `prosrc='int4smaller'`],
  ]) await driftCase(name,pinnedSetup,mutation,
    `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=${pinnedProc} AND ${predicate})
      THEN RAISE EXCEPTION 'PINNED_FAULT_NOT_INJECTED'; END IF; END $$;`);
  const pinnedOperator="'pg_catalog.>(integer,integer)'::regoperator";
  await driftCase('pinned-sortop-implementation',pinnedSetup,
    `UPDATE pg_catalog.pg_operator SET oprcode='pg_catalog.int4lt(integer,integer)'::regprocedure
      WHERE oid=${pinnedOperator};`,
    `DO $$ BEGIN IF NOT (1>2) OR (SELECT oprcode FROM pg_operator WHERE oid=${pinnedOperator})
      IS DISTINCT FROM 'pg_catalog.int4lt(integer,integer)'::regprocedure
      THEN RAISE EXCEPTION 'PINNED_FAULT_NOT_INJECTED'; END IF; END $$;`);
  for(const [name,field,fn] of [
    ['pinned-sortop-restriction','oprrest','pg_catalog.eqsel(internal,oid,internal,integer)'],
    ['pinned-sortop-join','oprjoin','pg_catalog.eqjoinsel(internal,oid,internal,smallint,internal)'],
  ]) await driftCase(name,pinnedSetup,
    `UPDATE pg_catalog.pg_operator SET ${field}=${q(fn)}::regprocedure WHERE oid=${pinnedOperator};`,
    `DO $$ BEGIN IF (SELECT ${field} FROM pg_operator WHERE oid=${pinnedOperator}) IS DISTINCT FROM ${q(fn)}::regprocedure
      THEN RAISE EXCEPTION 'PINNED_FAULT_NOT_INJECTED'; END IF; END $$;`);
  await driftCase('pinned-operator-support-config',pinnedSetup,
    'ALTER FUNCTION pg_catalog.scalargtsel(internal,oid,internal,integer) SET search_path=public;',
    `DO $$ BEGIN IF (SELECT proconfig FROM pg_proc
      WHERE oid='pg_catalog.scalargtsel(internal,oid,internal,integer)'::regprocedure)
      IS DISTINCT FROM ARRAY['search_path=public'] THEN RAISE EXCEPTION 'PINNED_FAULT_NOT_INJECTED'; END IF; END $$;`);
  // Function planner support is another direct pinned link, separate from an
  // aggregate transition. Freeze AFTER adding that link, then mutate its target.
  await driftCase('pinned-routine-planner-support',`${pinnedSetup}
    CREATE FUNCTION public.qa_planner_source(integer) RETURNS integer LANGUAGE sql AS $$ SELECT $1 $$;
    CREATE TEMP TABLE qa_planner_support AS SELECT prosupport::oid AS oid FROM pg_proc
      WHERE prosupport<>0 ORDER BY oid LIMIT 1;
    UPDATE pg_catalog.pg_proc SET prosupport=(SELECT oid FROM qa_planner_support)
      WHERE oid='public.qa_planner_source(integer)'::regprocedure;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements((${catalog})->'functions') f
      WHERE (f->>'oid')::oid=(SELECT oid FROM qa_planner_support))
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements((${catalog})->'callableReferences') f
        WHERE (f->>'objid')::oid='public.qa_planner_source(integer)'::regprocedure
          AND (f->>'refobjid')::oid=(SELECT oid FROM qa_planner_support))
      THEN RAISE EXCEPTION 'PINNED_REFERENCE_NOT_CAPTURED'; END IF; END $$;`,
    `DO $$ BEGIN EXECUTE format('ALTER FUNCTION %s SET search_path=public',
      (SELECT oid::regprocedure FROM qa_planner_support)); END $$;`,
    `DO $$ BEGIN IF (SELECT proconfig FROM pg_proc WHERE oid=(SELECT oid FROM qa_planner_support))
      IS DISTINCT FROM ARRAY['search_path=public'] THEN RAISE EXCEPTION 'PINNED_FAULT_NOT_INJECTED'; END IF; END $$;`);
  const pinnedWire=await json(`BEGIN; ${pinnedSetup} ${freeze}
    SELECT jsonb_build_object('matches',phase5_private.assert_inventory_authority_snapshot_v1(
      (SELECT envelope::text::jsonb FROM qa_authority_snapshot)),
      'closureValid',(${catalog})->'referenceClosureValid'); ROLLBACK;`);
  assert.deepEqual(pinnedWire,{matches:true,closureValid:true});checks+=2;
  assert.equal(await fingerprint(),before);checks+=1;
  assert.deepEqual(await json(`SELECT ${catalog};`),observed);checks+=1;
  passed.push('pinned-reference-wire: support/operator/support-routine captured without dependency rows; clean repeated serialized snapshot and exact rollback');
  await fails(`${pinnedSetup} UPDATE pg_catalog.pg_aggregate SET aggtransfn=4294967294::oid
    WHERE aggfnoid='public.qa_pinned_aggregate(integer)'::regprocedure; SELECT ${catalog};`,
    /55000.*PHASE5_INVENTORY_CALLABLE_REFERENCE_INVALID/u,'supabase_admin');
  assert.equal(await fingerprint(),before);checks+=1;
  assert.deepEqual(await json(`SELECT ${catalog};`),observed);checks+=1;
  passed.push('pinned-missing-reference: dangling direct support OID fails closed rather than disappearing; catalog/business state restored');

  const sequenceSetup='CREATE SEQUENCE public.qa_authority_sequence; ALTER SEQUENCE public.qa_authority_sequence OWNER TO postgres;';
  const sequenceProof=`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_depend
    WHERE classid='pg_class'::regclass AND objid='public.qa_authority_sequence'::regclass
      AND refclassid='pg_class'::regclass AND refobjid='public.products'::regclass AND deptype='a')
    THEN RAISE EXCEPTION 'SEQUENCE_FAULT_NOT_INJECTED'; END IF; END $$;`;
  await driftCase('sequence-owned-by',sequenceSetup,
    'ALTER SEQUENCE public.qa_authority_sequence OWNED BY public.products.name_ar;',sequenceProof);
  await driftCase('sequence-ownership-removed',`${sequenceSetup}
    ALTER SEQUENCE public.qa_authority_sequence OWNED BY public.products.name_ar;`,
    'ALTER SEQUENCE public.qa_authority_sequence OWNED BY NONE;',
    `DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_depend WHERE classid='pg_class'::regclass
      AND objid='public.qa_authority_sequence'::regclass AND deptype='a')
      THEN RAISE EXCEPTION 'SEQUENCE_FAULT_NOT_INJECTED'; END IF; END $$;`);
  const consumerSetup=`${sequenceSetup} CREATE TABLE public.qa_authority_sequence_consumer(id bigint);
    ALTER TABLE public.qa_authority_sequence_consumer OWNER TO postgres;`;
  const defaultReferenceProof=`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_depend
    WHERE classid='pg_attrdef'::regclass AND refclassid='pg_class'::regclass
      AND refobjid='public.qa_authority_sequence'::regclass)
    THEN RAISE EXCEPTION 'SEQUENCE_FAULT_NOT_INJECTED'; END IF; END $$;`;
  await driftCase('sequence-incoming-default',consumerSetup,
    `ALTER TABLE public.qa_authority_sequence_consumer ALTER COLUMN id SET DEFAULT nextval('public.qa_authority_sequence');`,
    defaultReferenceProof);
  await driftCase('sequence-incoming-default-removed',`${consumerSetup}
    ALTER TABLE public.qa_authority_sequence_consumer ALTER COLUMN id SET DEFAULT nextval('public.qa_authority_sequence');`,
    'ALTER TABLE public.qa_authority_sequence_consumer ALTER COLUMN id DROP DEFAULT;',
    `DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_depend WHERE classid='pg_attrdef'::regclass
      AND refclassid='pg_class'::regclass AND refobjid='public.qa_authority_sequence'::regclass)
      THEN RAISE EXCEPTION 'SEQUENCE_FAULT_NOT_INJECTED'; END IF; END $$;`);

  // Only a disabled disposable job is mutated. No job executes against a
  // changed endpoint; transaction rollback restores the original destination.
  const jobSetup=`CREATE TEMP TABLE qa_authority_job AS SELECT jobid,nodename,nodeport FROM cron.job
    WHERE jobname='run-advanced-monitoring';
    DO $$ BEGIN IF (SELECT count(*) FROM qa_authority_job)<>1
      THEN RAISE EXCEPTION 'JOB_FIXTURE_MISSING'; END IF; END $$;
    SELECT cron.alter_job(jobid,active:=false) FROM qa_authority_job;`;
  for(const field of ['nodeport','nodename']) {
    const value=field==='nodeport'?'j.nodeport+1':"j.nodename||'-isolated-drift'";
    await driftCase(`cron-${field}`,jobSetup,
      `UPDATE cron.job j SET ${field}=${value} FROM qa_authority_job old WHERE j.jobid=old.jobid;`,
      `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM cron.job j JOIN qa_authority_job old USING(jobid)
        WHERE NOT j.active AND j.${field} IS DISTINCT FROM old.${field})
        THEN RAISE EXCEPTION 'JOB_FAULT_NOT_INJECTED'; END IF; END $$;`);
  }
  console.log('Inventory authority routine/dependency/job endpoint completeness verified.');
};

const transportSourceRuntime = async () => {
  const id=randomUUID();
  const prepare=`INSERT INTO public.automation_events(id,event_key,event_type,entity_id,payload)
    VALUES(${q(id)},${q('slice5-transport-'+id)},'low_stock',${q(product)},'{"isolated":"transport-source"}');
    CREATE TEMP TABLE qa_transport AS SELECT phase5_private.plan_transport_source_envelope_v1(ARRAY[${q(id)}]::uuid[]) plan;`;
  const assertion=`SELECT phase5_private.assert_transport_source_envelope_v1(ARRAY[${q(id)}]::uuid[],(SELECT plan FROM qa_transport));`;
  const before=await fingerprint();
  for(const success of [true,false]) {
    const result=await json(`BEGIN;${prepare}
      SET LOCAL ROLE service_role;SELECT public.claim_automation_deliveries('telegram',50,30);
      SELECT public.complete_automation_delivery(${q(id)},'telegram',${success},'isolated failure');RESET ROLE;
      ${assertion}SELECT jsonb_build_object('source',(SELECT plan->'sourceRows' FROM qa_transport),
        'current',(SELECT jsonb_agg(to_jsonb(e)) FROM public.automation_events e WHERE id=${q(id)}),
        'status',(SELECT status FROM public.automation_event_deliveries WHERE event_id=${q(id)} AND channel='telegram'),
        'attempts',(SELECT attempt_count FROM public.automation_event_deliveries WHERE event_id=${q(id)} AND channel='telegram'),
        'flags',(SELECT plan-'sourceRows'-'transportCatalog'-'authorityCatalog' FROM qa_transport));ROLLBACK;`);
    assert.deepEqual(result.source,result.current);assert.equal(result.status,success?'delivered':'failed');
    assert.equal(result.attempts,1);assert.equal(result.flags.deliveryStateIsBusinessEvidence,false);
    assert.equal(result.flags.executionAuthority,false);assert.equal(result.flags.writerClosed,false);
    assert.equal(await fingerprint(),before);checks++;
  }
  const dead=await json(`BEGIN;${prepare}SET LOCAL ROLE service_role;
    SELECT public.claim_automation_deliveries('whatsapp',50,30);RESET ROLE;
    UPDATE public.automation_event_deliveries SET attempt_count=10 WHERE event_id=${q(id)} AND channel='whatsapp';
    SET LOCAL ROLE service_role;SELECT public.complete_automation_delivery(${q(id)},'whatsapp',false,'retry budget exhausted');RESET ROLE;
    ${assertion}SELECT to_jsonb(status) FROM public.automation_event_deliveries WHERE event_id=${q(id)} AND channel='whatsapp';ROLLBACK;`);
  assert.equal(dead,'dead_letter');assert.equal(await fingerprint(),before);checks++;
  for(const field of ['event_key','event_type','entity_id','payload','created_at']) {
    const value={event_key:q('changed-source'),event_type:q('out_of_stock'),entity_id:q(randomUUID()),payload:"'{\"changed\":true}'::jsonb",created_at:"created_at+interval '1 second'"}[field];
    await fails(`${prepare}UPDATE public.automation_events SET ${field}=${value} WHERE id=${q(id)};${assertion}`,
      /40001.*PHASE5_TRANSPORT_SOURCE_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),before);
  }
  for(const fault of ["plan-'sourceRows'","jsonb_set(plan,'{sourceRows}','null')",
    "jsonb_set(plan,'{executionAuthority}','true')","jsonb_set(plan,'{authorityCatalog}','{}')",
    "jsonb_set(plan,'{transportCatalog,columns}','[]')"])
    await fails(`${prepare}UPDATE qa_transport SET plan=${fault};${assertion}`,/40001.*PHASE5_TRANSPORT_SOURCE_CHANGED_RETRY/u);
  for(const ids of ['NULL::uuid[]',"'{}'::uuid[]",`ARRAY[NULL]::uuid[]`,`ARRAY[${q(id)},${q(id)}]::uuid[]`])
    await fails(`SELECT phase5_private.plan_transport_source_envelope_v1(${ids});`,/22023.*PHASE5_TRANSPORT_SOURCE_IDENTITIES_REQUIRED/u);
  await fails(`SELECT phase5_private.plan_transport_source_envelope_v1(ARRAY[${q(id)}]::uuid[]);`,/40001.*PHASE5_TRANSPORT_SOURCE_MISSING/u);
  for(const role of ['anon','authenticated','service_role']) {
    await fails(`SET LOCAL ROLE ${role};SELECT phase5_private.plan_transport_source_envelope_v1(ARRAY[${q(id)}]::uuid[]);`,/42501.*permission denied/u);
    await fails(`SET LOCAL ROLE ${role};SELECT phase5_private.assert_transport_source_envelope_v1(ARRAY[${q(id)}]::uuid[],NULL);`,/42501.*permission denied/u);
    if(role!=='service_role')for(const call of ["public.claim_automation_deliveries('telegram',1,30)",`public.complete_automation_delivery(${q(id)},'telegram',true,NULL)`])
      await fails(`SET LOCAL ROLE ${role};SELECT ${call};`,/42501.*permission denied/u);
  }
  for(const fault of [
    'GRANT EXECUTE ON FUNCTION public.claim_automation_deliveries(text,integer,integer) TO anon;',
    'GRANT EXECUTE ON FUNCTION public.complete_automation_delivery(uuid,text,boolean,text) TO service_role WITH GRANT OPTION;',
    'ALTER FUNCTION public.claim_automation_deliveries(text,integer,integer) SECURITY INVOKER;',
    'ALTER FUNCTION public.complete_automation_delivery(uuid,text,boolean,text) SET search_path=public;',
    `CREATE OR REPLACE FUNCTION public.claim_automation_deliveries(p_channel text,p_limit integer DEFAULT 10,p_lease_seconds integer DEFAULT 120) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $tamper$ BEGIN RETURN '{}'::jsonb;END; $tamper$;`,
  ])await fails(`${prepare}${fault}${assertion}`,/55000.*PHASE5_TRANSPORT_RPC_CONTRACT_INVALID/u);
  await fails(`${prepare}ALTER TABLE public.automation_event_deliveries ALTER COLUMN attempt_count SET DEFAULT 99;${assertion}`,
    /40001.*PHASE5_TRANSPORT_SOURCE_CHANGED_RETRY/u);
  assert.equal(await fingerprint(),before);
  const catalog=await json(`SELECT jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(proowner),'sd',prosecdef,'config',proconfig))
    FROM pg_proc WHERE oid IN ('phase5_private.plan_transport_source_envelope_v1(uuid[])'::regprocedure,
      'phase5_private.assert_transport_source_envelope_v1(uuid[],jsonb)'::regprocedure);`);
  assert.equal(catalog.length,2);for(const f of catalog){assert.equal(f.owner,'postgres');assert.equal(f.sd,false);assert.deepEqual(f.config,['search_path=pg_catalog']);}
  checks++;passed.push('real unchanged service-role claim/complete success/failure/dead-letter preserves complete source; exact source/catalog/ACL/body faults and real app-role denial; rollback fingerprints unchanged');
};

const stockWriterSourceRuntime = async (claims) => {
  const before=await fingerprint();
  const plan=await json('SELECT phase5_private.plan_stock_writer_source_envelope_v1();');
  assert.equal(plan.routines.length,7);assert.equal(plan.triggerBindings.length,3);
  assert.equal(new Set(plan.routines.map(r=>r.signature)).size,7);
  for(const field of ['completeWriterLedger','earlyGateQualified','defaultsQualified','writerClosed',
    'absencePredicatesFenced','locksHeld','heldContextAuthority','executionAuthority']) assert.equal(plan[field],false);
  const prepare='CREATE TEMP TABLE qa_stock_writer AS SELECT phase5_private.plan_stock_writer_source_envelope_v1() plan;';
  const assertion='SELECT phase5_private.assert_stock_writer_source_envelope_v1((SELECT plan FROM qa_stock_writer));';
  assert.equal(await json(`SELECT to_jsonb(phase5_private.assert_stock_writer_source_envelope_v1(${j(plan)}));`),true);checks++;
  for(const fault of ["NULL::jsonb","'null'::jsonb","plan-'routines'","jsonb_set(plan,'{routines}','[]')",
    "jsonb_set(plan,'{routines,1}',plan->'routines'->0)","jsonb_set(plan,'{triggerBindings}','[]')",
    ...['completeWriterLedger','earlyGateQualified','defaultsQualified','writerClosed','absencePredicatesFenced',
      'locksHeld','heldContextAuthority','executionAuthority'].map(f=>`jsonb_set(plan,'{${f}}','true')`)]) {
    await fails(`${prepare}SELECT phase5_private.assert_stock_writer_source_envelope_v1(${fault}) FROM qa_stock_writer;`,
      /40001.*PHASE5_STOCK_WRITER_SOURCE_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),before);
  }
  for(const fault of [
    'ALTER FUNCTION public.sync_stock_alert(uuid,uuid,integer,integer) SECURITY INVOKER;',
    'ALTER FUNCTION public.mark_stock_alert_read(uuid) SET search_path=public;',
    'ALTER FUNCTION public.mark_all_stock_alerts_read() STABLE;',
    'ALTER FUNCTION public.sync_stock_alert_from_balance() STRICT;',
    'DROP FUNCTION public.sync_stock_alert(uuid,uuid,integer,integer) CASCADE;',
    `CREATE OR REPLACE FUNCTION public.mark_stock_alert_read(p_stock_alert_id uuid) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fault$ BEGIN RETURN '{}'::jsonb; END; $fault$;`,
    `ALTER FUNCTION public.mark_stock_alert_read(uuid) OWNER TO supabase_admin;
      DO $$ BEGIN IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.mark_stock_alert_read(uuid)'::regprocedure)
        IS DISTINCT FROM 'supabase_admin' THEN RAISE EXCEPTION 'OWNER_FAULT_NOT_INJECTED';END IF;END $$;`,
  ]) {
    await fails(`${prepare}${fault}${assertion}`,/55000.*PHASE5_STOCK_WRITER_SOURCE_CONTRACT_INVALID/u,'supabase_admin');
    assert.equal(await fingerprint(),before);
    assert.deepEqual(await json('SELECT phase5_private.plan_stock_writer_source_envelope_v1();'),plan);
  }
  for(const fault of [
    'ALTER TABLE public.inventory_balances ENABLE ALWAYS TRIGGER trg_sync_stock_alert_from_balance;',
    'ALTER TABLE public.stock_alerts ENABLE ALWAYS TRIGGER trg_enqueue_stock_automation_event;',
    'DROP TRIGGER trg_sync_stock_alert_from_product ON public.products;',
    `CREATE TRIGGER "EXTRA_STOCK_BINDING" AFTER UPDATE ON public.stock_alerts FOR EACH ROW
      EXECUTE FUNCTION public.enqueue_stock_automation_event();`,
    `DROP TRIGGER trg_sync_stock_alert_from_product ON public.products;
      CREATE TRIGGER trg_sync_stock_alert_from_product AFTER UPDATE OF is_active ON public.products
        FOR EACH ROW EXECUTE FUNCTION public.sync_stock_alert_from_product();`,
    `DROP TRIGGER trg_enqueue_stock_automation_event ON public.stock_alerts;
      CREATE TRIGGER trg_enqueue_stock_automation_event BEFORE INSERT OR UPDATE OF status,severity ON public.stock_alerts
        FOR EACH ROW EXECUTE FUNCTION public.enqueue_stock_automation_event();`,
    `DROP TRIGGER trg_sync_stock_alert_from_balance ON public.inventory_balances;
      CREATE TRIGGER trg_sync_stock_alert_from_balance AFTER INSERT OR UPDATE OF on_hand_quantity,reserved_quantity
        ON public.inventory_balances FOR EACH ROW WHEN (NEW.on_hand_quantity<0)
        EXECUTE FUNCTION public.sync_stock_alert_from_balance();`,
  ]) {
    await fails(`${prepare}${fault}${assertion}`,/55000.*PHASE5_STOCK_WRITER_TRIGGER_CONTRACT_INVALID/u);
    assert.equal(await fingerprint(),before);
    assert.deepEqual(await json('SELECT phase5_private.plan_stock_writer_source_envelope_v1();'),plan);
  }
  for(const fault of [
    'GRANT EXECUTE ON FUNCTION public.mark_stock_alert_read(uuid) TO anon;',
    'ALTER TABLE public.stock_alert_reads ALTER COLUMN read_at SET DEFAULT clock_timestamp();',
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT UPDATE ON TABLES TO anon WITH GRANT OPTION;',
  ]) {
    await fails(`${prepare}${fault}${assertion}`,/40001.*PHASE5_STOCK_WRITER_SOURCE_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),before);
  }
  // Self-capture may diagnose current authority, never qualify it. This grant
  // can be observed afresh but cannot make an execution/early-gate permit.
  const self=await json(`BEGIN;GRANT EXECUTE ON FUNCTION public.mark_stock_alert_read(uuid) TO anon;
    SELECT phase5_private.plan_stock_writer_source_envelope_v1();ROLLBACK;`);
  assert.notDeepEqual(self.authorityCatalog,plan.authorityCatalog);
  assert.equal(self.writerClosed,false);assert.equal(self.executionAuthority,false);checks++;
  assert.equal(await fingerprint(),before);
  // Exercise unchanged historical public trigger/read-mark behavior, not an
  // inactive Phase5 executor. Real authenticated actor and real nested DML.
  const compatibility=await json(`BEGIN;${prepare}${claims}
    UPDATE public.products SET min_stock_level=1000 WHERE id=${q(product)};
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.stock_alerts WHERE product_id=${q(product)} AND status='active')
      THEN RAISE EXCEPTION 'SOURCE_FAULT_NOT_INJECTED';END IF;END $$;
    SET LOCAL ROLE authenticated;SELECT public.mark_all_stock_alerts_read();RESET ROLE;
    SELECT public.mark_stock_alert_read((SELECT id FROM public.stock_alerts WHERE product_id=${q(product)} AND status='active' LIMIT 1));
    UPDATE public.inventory_balances SET on_hand_quantity=0 WHERE product_id=${q(product)};
    ${assertion}SELECT jsonb_build_object('alerts',(SELECT count(*) FROM public.stock_alerts WHERE product_id=${q(product)}),
      'events',(SELECT count(*) FROM public.automation_events WHERE payload->>'productId'=${q(product)}),
      'sourceUnchanged',(SELECT plan=phase5_private.plan_stock_writer_source_envelope_v1() FROM qa_stock_writer));ROLLBACK;`);
  assert.ok(compatibility.alerts>0);assert.ok(compatibility.events>0);assert.equal(compatibility.sourceUnchanged,true);
  assert.equal(await fingerprint(),before);checks++;
  for(const role of ['anon','authenticated','service_role']) for(const call of [
    'phase5_private.plan_stock_writer_source_envelope_v1()',
    'phase5_private.assert_stock_writer_source_envelope_v1(NULL)',
  ]) { await fails(`SET LOCAL ROLE ${role};SELECT ${call};`,/42501.*permission denied/u);assert.equal(await fingerprint(),before); }
  const installed=await json(`SELECT jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(proowner),
    'sd',prosecdef,'config',proconfig)) FROM pg_proc WHERE oid IN
    ('phase5_private.plan_stock_writer_source_envelope_v1()'::regprocedure,
     'phase5_private.assert_stock_writer_source_envelope_v1(jsonb)'::regprocedure);`);
  assert.equal(installed.length,2);for(const f of installed){assert.equal(f.owner,'postgres');assert.equal(f.sd,false);assert.deepEqual(f.config,['search_path=pg_catalog']);}
  checks++;passed.push('seven independent historical stock/read/event bodies and exact three trigger bindings; catalog/default/ACL/owner/shape faults reject; unchanged real authenticated read marks and nested stock events compatible; six private role denials and complete rollback; never early-gate or execution authority');
};

// Observe supported historical paths, not hypothetical Phase5 admission.
// Every instrumented trigger/function and all business effects roll back.
const writerAdmissionRuntime = async (claims) => {
  const other='92400000-0000-0000-0000-000000000102';
  const unit='92400000-0000-0000-0000-000000000010';
  const category='92400000-0000-0000-0000-000000000011';
  const before=await fingerprint();
  const authority=await json('SELECT phase5_private.inventory_authority_catalog_v1();');
  const trace=`CREATE TEMP TABLE qa_first_write_trace(ordinal bigint GENERATED ALWAYS AS IDENTITY,relation text,id uuid,gates jsonb);
    CREATE FUNCTION pg_temp.qa_observe_first_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path=pg_catalog AS $observe$
    DECLARE ids uuid[]; gates jsonb;
    BEGIN
      IF TG_TABLE_NAME='products' THEN ids:=ARRAY[NEW.id];
      ELSE SELECT array_agg(DISTINCT product_id ORDER BY product_id) INTO ids
        FROM public.purchase_order_items WHERE purchase_order_id=NEW.purchase_order_id; END IF;
      SELECT jsonb_agg(jsonb_build_object('productId',id,'held',EXISTS(
        SELECT 1 FROM pg_catalog.pg_locks l WHERE l.pid=pg_catalog.pg_backend_pid()
          AND l.locktype='advisory' AND l.granted AND l.mode='ExclusiveLock' AND l.objsubid=1
          AND l.classid=((key>>32)&4294967295)::oid AND l.objid=(key&4294967295)::oid)) ORDER BY id)
        INTO gates FROM (SELECT id,pg_catalog.hashtextextended('inventory-product:'||id::text,0) key FROM unnest(ids) id) keys;
      INSERT INTO pg_temp.qa_first_write_trace(relation,id,gates) VALUES(TG_TABLE_SCHEMA||'.'||TG_TABLE_NAME,NEW.id,gates);
      RETURN NEW;
    END; $observe$;
    CREATE TRIGGER aa_qa_admission_first_write BEFORE INSERT ON public.products
      FOR EACH ROW EXECUTE FUNCTION pg_temp.qa_observe_first_write();
    CREATE TRIGGER aa_qa_admission_first_write BEFORE INSERT ON public.purchase_receipts
      FOR EACH ROW EXECUTE FUNCTION pg_temp.qa_observe_first_write();`;
  const familyArgs=`'QA-ADMISSION-FAMILY',NULL,'Admission isolated family',NULL,${q(category)},NULL,
    ${q(unit)},${q(unit)},1,0,${q(unit)},1,1000,0,0,NULL,${q(warehouse)},NULL,
    ${j([{nameAr:'A',openingSalePackages:0},{nameAr:'B',openingSalePackages:0}])}`;
  const family=await json(`BEGIN;${claims}${trace}SET LOCAL ROLE authenticated;
    SELECT public.create_product_family_with_flavors_v1(${familyArgs}); RESET ROLE;
    SELECT jsonb_build_object('trace',(SELECT jsonb_agg(to_jsonb(t) ORDER BY ordinal) FROM qa_first_write_trace t),
      'children',(SELECT jsonb_agg(jsonb_build_object('id',p.id,'parent',p.flavor_master_product_id) ORDER BY p.flavor_name_ar)
        FROM public.products p JOIN public.products root ON root.id=p.flavor_master_product_id WHERE root.sku='QA-ADMISSION-FAMILY'));
    ROLLBACK;`);
  assert.equal(family.trace.length,3);assert.equal(family.children.length,2);checks+=2;
  assert.equal(new Set(family.trace.map(t=>t.id)).size,3);checks++;
  assert.equal(family.trace[0].relation,'public.products');checks++;
  for(const child of family.children){assert.equal(child.parent,family.trace[0].id);
    assert.ok(family.trace.slice(1).some(t=>t.id===child.id));checks+=2;}
  for(const row of family.trace){assert.deepEqual(row.gates,[{productId:row.id,held:false}]);checks++;}
  assert.equal(await fingerprint(),before);assert.deepEqual(await json('SELECT phase5_private.inventory_authority_catalog_v1();'),authority);checks+=2;
  passed.push('actual authenticated family RPC observes master then two distinct future child IDs before any corresponding inventory gate; historical path remains unqualified for Phase5 activation');
  const supplier=randomUUID(),po=randomUUID(),itemA=randomUUID(),itemB=randomUUID();
  const fixture=`INSERT INTO public.suppliers(id,company_name) VALUES(${q(supplier)},'Admission isolated');
    INSERT INTO public.purchase_orders(id,purchase_order_number,supplier_id,warehouse_id,status,created_by)
      VALUES(${q(po)},'QA-ADMISSION-PO',${q(supplier)},${q(warehouse)},'approved',${q(owner)});
    INSERT INTO public.purchase_order_items(id,purchase_order_id,product_id,ordered_quantity,purchase_price_in_minor_units,line_total_in_minor_units)
      VALUES(${q(itemA)},${q(po)},${q(product)},2,0,0),(${q(itemB)},${q(po)},${q(other)},2,300,600);`;
  // Valid but deliberately wrong payload product identities cannot decide the
  // product domain: actual PO items are the independent authoritative source.
  const items=[{purchase_order_item_id:itemA,product_id:other,received_quantity:1,unit_cost_in_minor_units:0},
    {purchase_order_item_id:itemB,product_id:product,received_quantity:1,unit_cost_in_minor_units:300}];
  const receive=(value)=>`public.receive_purchase_order(${q(po)},${q(warehouse)},NULL,NULL,${j(value)})`;
  const receipt=await json(`BEGIN;${fixture}${claims}${trace}SET LOCAL ROLE authenticated;
    SELECT ${receive(items)};RESET ROLE;
    SELECT jsonb_build_object('trace',(SELECT jsonb_agg(to_jsonb(t) ORDER BY ordinal) FROM qa_first_write_trace t),
      'items',(SELECT jsonb_agg(jsonb_build_object('poItem',purchase_order_item_id,'product',product_id,
        'quantity',received_quantity,'cost',unit_cost_in_minor_units) ORDER BY purchase_order_item_id)
        FROM public.purchase_receipt_items WHERE purchase_receipt_id IN (SELECT id FROM public.purchase_receipts WHERE purchase_order_id=${q(po)})));
    ROLLBACK;`);
  assert.equal(receipt.trace.length,1);assert.equal(receipt.trace[0].relation,'public.purchase_receipts');checks+=2;
  assert.deepEqual(receipt.trace[0].gates,[{productId:product,held:true},{productId:other,held:true}]);checks++;
  assert.deepEqual(receipt.items,[{poItem:itemA,product,quantity:1,cost:0},{poItem:itemB,product:other,quantity:1,cost:300}]
    .sort((a,b)=>a.poItem<b.poItem?-1:1));checks++;
  assert.equal(await fingerprint(),before);assert.deepEqual(await json('SELECT phase5_private.inventory_authority_catalog_v1();'),authority);checks+=2;
  const missingCost=structuredClone(items);delete missingCost[0].unit_cost_in_minor_units;
  await fails(`${fixture}${claims}${trace}SET LOCAL ROLE authenticated;SELECT ${receive(missingCost)};`,/22023.*PHASE2_LEGACY_COST_REQUIRED/u);
  assert.equal(await fingerprint(),before);checks++;
  await fails(`${claims}SET LOCAL ROLE authenticated;SELECT public._receive_purchase_order_impl(${q(po)},${q(warehouse)},NULL,NULL,${j(items)});`,/42501.*permission denied for function/u);
  assert.equal(await fingerprint(),before);checks++;
  const catalog=await json(`SELECT jsonb_build_object(
    'foreignKeys',(SELECT jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,
      'definition',pg_get_constraintdef(c.oid,true)) ORDER BY c.conrelid::regclass::text,c.conname) FROM pg_constraint c
      WHERE c.contype='f' AND c.conrelid IN ('public.products'::regclass,'public.purchase_receipts'::regclass,'public.purchase_receipt_items'::regclass)),
    'defaults',(SELECT jsonb_agg(jsonb_build_object('table',d.adrelid::regclass::text,'column',a.attname,
      'expression',pg_get_expr(d.adbin,d.adrelid)) ORDER BY d.adrelid::regclass::text,a.attnum)
      FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE d.adrelid IN ('public.products'::regclass,'public.purchase_receipts'::regclass)),
    'triggers',(SELECT jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,
      'function',t.tgfoid::regprocedure::text,'definition',pg_get_triggerdef(t.oid,true)) ORDER BY t.tgrelid::regclass::text,t.tgname)
      FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid IN ('public.products'::regclass,'public.inventory_balances'::regclass))
  );`);
  for(const table of ['products','purchase_receipts']){
    assert.ok(catalog.defaults.some(d=>d.table===table&&d.column==='id'&&d.expression.includes('gen_random_uuid')));checks++;
  }
  assert.ok(catalog.foreignKeys.some(f=>f.table==='products'&&f.definition.includes('flavor_master_product_id')));checks++;
  assert.ok(catalog.foreignKeys.some(f=>f.table==='purchase_receipts'&&f.definition.includes('received_by')));checks++;
  assert.ok(catalog.triggers.some(t=>t.table==='inventory_balances'&&t.function.includes('sync_stock_alert')));checks++;
  assert.deepEqual(await json('SELECT phase5_private.inventory_authority_catalog_v1();'),authority);checks++;
  passed.push('actual authenticated receiving header observes the complete PO-item SKU gate set; zero cost and source-product authority preserved; actor/internal ACL and rollback/content/catalog restoration verified');
  passed.push('installed FK/default/trigger graph captured: future UUID defaults, flavor parent/profile/PO parents and stock side effects; capture is not all-writer or absence-fence qualification');
};

const receivingPrewriteRuntime = async (claims) => {
  const other='92400000-0000-0000-0000-000000000102';
  const supplier=randomUUID(),po=randomUUID(),itemA=randomUUID(),itemB=randomUUID();
  const before=await fingerprint();
  await sql(`INSERT INTO public.suppliers(id,company_name) VALUES(${q(supplier)},'Receiving prewrite isolated');
    INSERT INTO public.purchase_orders(id,purchase_order_number,supplier_id,warehouse_id,status,created_by)
      VALUES(${q(po)},'QA-PREWRITE-PO',${q(supplier)},${q(warehouse)},'approved',${q(owner)});
    INSERT INTO public.purchase_order_items(id,purchase_order_id,product_id,ordered_quantity,purchase_price_in_minor_units,line_total_in_minor_units)
      VALUES(${q(itemA)},${q(po)},${q(product)},2,0,0),(${q(itemB)},${q(po)},${q(other)},2,300,600);`);
  const baseline=await fingerprint();
  const items=[{purchase_order_item_id:itemA,product_id:other,received_quantity:1,unit_cost_in_minor_units:0},
    {purchase_order_item_id:itemB,product_id:product,received_quantity:1,unit_cost_in_minor_units:300}];
  const args=(value=items)=>`${q(po)},NULL,'delivery','notes',${j(value)}`;
  const discovery=`phase5_private.discover_receiving_prewrite_v1(${args()})`;
  const setup=`CREATE TEMP TABLE qa_receiving_plan AS SELECT ${discovery} plan;`;
  const assertion=`SELECT phase5_private.assert_receiving_prewrite_v1(${args()},(SELECT plan FROM qa_receiving_plan));`;
  const acquisition=`phase5_private.acquire_receiving_prewrite_v1(${args()},(SELECT plan FROM qa_receiving_plan))`;
  const plan=await json(`${claims}SELECT ${discovery};`);
  assert.deepEqual(plan.productIds,[product,other]);assert.equal(plan.effectiveWarehouseId,warehouse);checks+=2;
  assert.deepEqual(plan.lines.map(l=>[l.source.id,l.source.product_id,l.quantity,l.cost]),
    [[itemA,product,1,0],[itemB,other,1,300]]);checks++;
  const anchors=await json(`SELECT jsonb_agg(jsonb_build_object('productId',p.id,'quantity',
    (SELECT sum(b.on_hand_quantity) FROM public.inventory_balances b WHERE b.product_id=p.id),'wac',
    coalesce(p.wac_cost_in_minor_units_exact,p.cost_price_in_minor_units::numeric)) ORDER BY p.id)
    FROM public.products p WHERE p.id IN (${q(product)},${q(other)});`);
  assert.deepEqual(plan.domains.map(d=>({productId:d.productId,quantity:d.allWarehouseQuantity,wac:d.exactWac})),anchors);checks++;
  for(const d of plan.domains){assert.equal(d.targetBalance.product_id,d.productId);assert.equal(d.targetBalance.warehouse_id,warehouse);checks+=2;}
  for(const flag of ['locksHeld','futureIdentityClaimed','numberClaimed','defaultsQualified','allowedInvokerClosure',
    'absencePredicatesFenced','writerClosed','heldContextAuthority','executionAuthority']){assert.equal(plan[flag],false);checks++;}
  assert.ok(plan.resources.some(r=>r.relation==='public.suppliers'&&r.id===supplier));
  assert.equal(plan.resources.filter(r=>r.relation==='public.purchase_order_items').length,2);checks+=2;
  const rootIndex=plan.resources.findIndex(r=>r.relation==='public.purchase_orders');
  const childIndex=plan.resources.findIndex(r=>r.relation==='public.purchase_order_items');
  const lastSkuIndex=plan.resources.findLastIndex(r=>['public.products','public.inventory_balances'].includes(r.relation));
  assert.ok(lastSkuIndex<rootIndex&&rootIndex<childIndex,'inventory resources precede PO header, which precedes PO children');checks++;
  const clean=await json(`BEGIN;${claims}${setup}SELECT ${acquisition};ROLLBACK;`);
  assert.equal(clean.locksHeld,true);assert.equal(clean.executionAuthority,false);checks+=2;
  const held=await json(`BEGIN;${claims}${setup}SELECT ${acquisition};
    SELECT jsonb_build_object('gates',(SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND granted),
      'balances',(SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND relation='public.inventory_balances'::regclass AND mode='RowShareLock'),
      'receipts',(SELECT count(*) FROM public.purchase_receipts WHERE purchase_order_id=${q(po)}));ROLLBACK;`);
  assert.deepEqual(held,{gates:2,balances:1,receipts:0});checks++;
  assert.equal(await fingerprint(),baseline);checks++;
  for(const value of ['NULL::jsonb',"'null'::jsonb",'plan-\'resources\'',"jsonb_set(plan,'{resources,1}',plan->'resources'->0)",
    "jsonb_set(plan,'{executionAuthority}','true')","jsonb_set(plan,'{lines,0,source,product_id}',to_jsonb('"+other+"'::text))"]){
    await fails(`${claims}${setup}SELECT phase5_private.assert_receiving_prewrite_v1(${args()},${value}) FROM qa_receiving_plan;`,
      /40001.*PHASE5_RECEIVING_PREWRITE_CHANGED_RETRY/u);assert.equal(await fingerprint(),baseline);checks++;
  }
  for(const fault of [
    `UPDATE public.purchase_order_items SET ordered_quantity=3 WHERE id=${q(itemA)};`,
    `UPDATE public.purchase_order_items SET product_id=${q(other)} WHERE id=${q(itemA)};`,
    `UPDATE public.purchase_orders SET notes='changed' WHERE id=${q(po)};`,
    `UPDATE public.suppliers SET company_name='changed' WHERE id=${q(supplier)};`,
    `UPDATE public.warehouses SET name_ar='changed' WHERE id=${q(warehouse)};`,
    `UPDATE public.products SET wac_cost_in_minor_units_exact=990 WHERE id=${q(product)};`,
    `UPDATE public.inventory_balances SET on_hand_quantity=on_hand_quantity+1 WHERE product_id=${q(product)};`,
    `INSERT INTO public.purchase_order_items(purchase_order_id,product_id,ordered_quantity,purchase_price_in_minor_units,line_total_in_minor_units)
      VALUES(${q(po)},${q(other)},1,0,0);`,
    `INSERT INTO public.purchase_receipts(receipt_number,purchase_order_id,supplier_id,warehouse_id,received_by)
      VALUES('QA-PREWRITE-NUMBER',${q(po)},${q(supplier)},${q(warehouse)},${q(owner)});`,
  ]){
    await fails(`${claims}${setup}${fault}${assertion}`,/40001.*PHASE5_RECEIVING_PREWRITE_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),baseline);checks++;
  }
  await fails(`${claims}${setup}SELECT id FROM public.purchase_orders WHERE id=${q(po)} FOR UPDATE;SELECT ${acquisition};`,
    /40001.*PHASE5_RECEIVING_LATE_ENTRY_RETRY/u);
  await fails(`${claims}${setup}SELECT pg_advisory_xact_lock(918123);SELECT ${acquisition};`,/40001.*PHASE5_RECEIVING_LATE_ENTRY_RETRY/u);
  for(const role of ['anon','authenticated','service_role'])for(const call of [discovery,
    `phase5_private.acquire_receiving_prewrite_v1(${args()},NULL)`,
    `phase5_private.assert_receiving_prewrite_v1(${args()},NULL)`])
    await fails(`${claims}GRANT USAGE ON SCHEMA phase5_private TO ${role};SET LOCAL ROLE ${role};SELECT ${call};`,
      /42501.*permission denied for function/u);
  const missing=structuredClone(items);delete missing[0].unit_cost_in_minor_units;
  await fails(`${claims}SELECT phase5_private.discover_receiving_prewrite_v1(${args(missing)});`,/22023.*PHASE2_LEGACY_COST_REQUIRED/u);
  const excess=structuredClone(items);excess.push({...excess[0],received_quantity:2});
  await fails(`${claims}SELECT phase5_private.discover_receiving_prewrite_v1(${args(excess)});`,/23514.*PHASE5_RECEIVING_CAPACITY_INVALID/u);
  await fails(`${claims}ALTER FUNCTION public.assert_erp_role(text[],text) SECURITY INVOKER;SELECT ${discovery};`,
    /55000.*PHASE5_RECEIVING_ACTOR_CONTRACT_INVALID/u);
  await fails(`SELECT set_config('request.jwt.claims','{}',true);SELECT ${discovery};`,/P0001.*يجب تسجيل الدخول/u);
  // Session1 holds the REAL existing inventory gate. Session2 reaches a wait,
  // then independently re-reads supplier drift committed by session1.
  const release=await holdSQL(`SELECT pg_advisory_xact_lock(hashtextextended('inventory-product:${product}',0));
    UPDATE public.suppliers SET company_name='committed drift' WHERE id=${q(supplier)};`,'S5-RECEIVING-PREWRITE-HOLDER');
  const waiting=sql(`BEGIN;${claims}SET LOCAL application_name='S5-RECEIVING-PREWRITE-WAITER';
    ${setup}SELECT ${acquisition};ROLLBACK;`,true);
  try {
    let observed=false;
    for(let i=0;i<80;i++){
      observed=await json(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='S5-RECEIVING-PREWRITE-WAITER'
        AND wait_event_type='Lock' AND wait_event='advisory'));`);
      if(observed)break;
      await new Promise(resolve=>setTimeout(resolve,40));
    }
    assert.equal(observed,true,'must observe actual second-session advisory wait');checks++;
  } finally {await release('COMMIT');}
  assert.match((await waiting).stderr,/40001.*PHASE5_RECEIVING_PREWRITE_CHANGED_RETRY/u);checks++;
  const drifted=await fingerprint();assert.notEqual(drifted,baseline);checks++;
  const refreshed=await json(`BEGIN;${claims}${setup}SELECT ${acquisition};ROLLBACK;`);
  assert.equal(refreshed.locksHeld,true);assert.equal(await fingerprint(),drifted);checks+=2;
  const compatibility=await json(`BEGIN;${claims}SET LOCAL ROLE authenticated;
    SELECT public.receive_purchase_order(${q(po)},NULL,'delivery','notes',${j(items)});ROLLBACK;`);
  assert.equal(compatibility.success,true);assert.equal(await fingerprint(),drifted);checks+=2;
  await sql(`DELETE FROM public.purchase_order_items WHERE purchase_order_id=${q(po)};
    DELETE FROM public.purchase_orders WHERE id=${q(po)};DELETE FROM public.suppliers WHERE id=${q(supplier)};`);
  assert.equal(await fingerprint(),before);checks++;
  passed.push('receiving prewrite real acquisition before business DML, exact whole PO/WAC/actor/stock/number resource drift rejection; real second-session advisory wait rejects committed supplier drift, refreshed plan acquires; historical public receiving and zero cost preserved; no execution/absence/identity authority; owned fixtures restored');
};

// Actual current public RPC effects, not a future Phase5 executor/claim.
// Each fixture, current writer call and observation lives in one rollback-only
// transaction. Existing business guards/triggers remain enabled throughout.
const receiptV2TriggerEffectsRuntime = async (claims) => {
  const migrationSources=new Map(await Promise.all((await readdir(path.join(root,'supabase/migrations')))
    .filter(n=>/^\d{3}_/u.test(n)&&Number(n.slice(0,3))<=127).sort().map(async name=>
      [name,(await readFile(path.join(root,'supabase/migrations',name),'utf8')).replace(/\r\n?/gu,'\n')])));
  const sources=functionEvents([...migrationSources].map(([filename,source])=>({filename,source}))).state;
  const contract=inspectReceiptV2TriggerEffectContract(sources,migrationSources),baseline=await fingerprint();
  const catalog=await json('SELECT phase5_private.shift_inventory_side_effect_catalog_v1();');
  assert.equal(catalog.functions.length,5);assert.equal(catalog.triggers.length,8);checks+=2;
  const live=await json(`SELECT jsonb_agg(jsonb_build_object('signature',s.signature,'body',p.prosrc,
    'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig) ORDER BY s.signature)
    FROM unnest(ARRAY[${contract.nodes.map(n=>q(n.signature)).join(',')}]) s(signature)
    JOIN pg_proc p ON p.oid=to_regprocedure(s.signature);`);
  assert.equal(live.length,contract.nodes.length);checks++;
  for(const n of contract.nodes){
    const found=live.find(f=>f.signature===n.signature);assert.ok(found);checks++;
    assert.equal(createHash('sha256').update(found.body.replace(/\r\n?/gu,'\n')).digest('hex').toUpperCase(),n.bodySha256);checks++;
    assert.equal(found.owner,'postgres','canonical isolated executor owner, not inferred live Production owner');checks++;
    assert.equal(found.definer,n.securityMode==='DEFINER');checks++;
    assert.deepEqual(found.config,[`search_path=${n.searchPath}`]);checks++;
  }
  const defaults=await json(`SELECT jsonb_object_agg(c.relname,pg_get_expr(d.adbin,d.adrelid)) FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum JOIN pg_class c ON c.oid=d.adrelid
    WHERE a.attname='id' AND c.oid IN ('public.stock_alerts'::regclass,'public.automation_events'::regclass);`);
  assert.deepEqual(defaults,{stock_alerts:'gen_random_uuid()',automation_events:'gen_random_uuid()'});checks++;
  const transitiveInstalled=await json(`SELECT jsonb_agg(jsonb_build_object('relation',c.relname,
    'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
      'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated)
      ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY c.relname)
    FROM pg_class c WHERE c.oid IN ('public.stock_alerts'::regclass,'public.stock_alert_reads'::regclass,'public.automation_events'::regclass);`);
  const transitiveRequirements=inspectReceiptV2TransitiveRowRequirements(sources,migrationSources,transitiveInstalled);
  assert.equal(assertReceiptV2TransitiveRowRequirements(sources,migrationSources,transitiveInstalled,transitiveRequirements),true);checks++;
  assert.equal(transitiveRequirements.tables.reduce((n,t)=>n+t.columns.length,0),19);checks++;
  assert.equal(transitiveRequirements.writes.length,6);checks++;
  for(const corrupt of [
    rows=>{rows[0].columns.pop();},rows=>{rows.push(structuredClone(rows[0]));},
    rows=>{rows[0].columns[0].type='text';},rows=>{rows[0].columns[0].default='now()';},
    rows=>{rows[0].columns[0].notNull=false;},rows=>{rows[0].columns[0].identity='a';},
  ]){const bad=structuredClone(transitiveInstalled);corrupt(bad);
    assert.throws(()=>inspectReceiptV2TransitiveRowRequirements(sources,migrationSources,bad),/TRANSITIVE_SCHEMA_DRIFT/u);checks++;}
  const transitiveFks=await json(`SELECT jsonb_agg(jsonb_build_object('tuple',jsonb_build_array(n.nspname||'.'||c.relname,a.attname,
    pn.nspname||'.'||p.relname,pa.attname),'validated',fk.convalidated,
    'keyCount',cardinality(fk.conkey),'parentKeyCount',cardinality(fk.confkey)) ORDER BY c.relname,a.attname)
    FROM pg_constraint fk JOIN pg_class c ON c.oid=fk.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_class p ON p.oid=fk.confrelid JOIN pg_namespace pn ON pn.oid=p.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=fk.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid=p.oid AND pa.attnum=fk.confkey[1]
    WHERE fk.contype='f' AND fk.conrelid IN ('public.stock_alerts'::regclass,'public.stock_alert_reads'::regclass,'public.automation_events'::regclass);`);
  const tupleSort=(rows)=>rows.toSorted((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  for(const fk of transitiveFks){assert.equal(fk.validated,true);assert.equal(fk.keyCount,1);assert.equal(fk.parentKeyCount,1);checks+=3;}
  assert.deepEqual(tupleSort(transitiveFks.map(f=>f.tuple)),tupleSort(transitiveRequirements.foreignKeyRequirements));checks++;
  assert.equal(await fingerprint(),baseline,'complete transitive requirements are read-only');checks++;
  const primaryRelations=['business_operations','supplier_receipts','supplier_receipt_items','supplier_receipt_commercial_lines',
    'purchase_receipts','purchase_receipt_items','purchase_receipt_commercial_lines','supplier_payments',
    'inventory_balances','inventory_movements','phase2_receipt_wac_snapshots','supplier_financial_invoice_identities','audit_logs'];
  const primaryInstalled=await json(`SELECT jsonb_agg(jsonb_build_object('relation',c.relname,
    'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
      'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated)
      ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      AND c.relname=ANY(ARRAY[${primaryRelations.map(q).join(',')}]);`);
  for(const fault of [
    'ALTER TABLE public.inventory_balances DISABLE TRIGGER trg_sync_stock_alert_from_balance;',
    'CREATE TRIGGER qa_extra_receipt_effect AFTER UPDATE ON public.stock_alert_reads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();',
    'ALTER FUNCTION public.enqueue_stock_automation_event() SET search_path=pg_catalog;',
  ]){
    await fails(`${fault}SELECT phase5_private.shift_inventory_side_effect_catalog_v1();`,/23514.*SIDE_EFFECT_(TRIGGER|FUNCTION)_DRIFT/u);
    assert.equal(await fingerprint(),baseline,'transitive catalog fault exact rollback');checks++;
  }
  const scenarios=[
    {name:'absent-zero-insert-then-resolve',opening:null,quantity:3,method:'deferred',dedup:false},
    {name:'out-to-low-delete-reads',opening:0,quantity:1,method:'cash',dedup:false},
    {name:'same-low-retain-reads',opening:1,quantity:1,method:'cliq',dedup:false},
    {name:'existing-low-resolve-retain-reads',opening:2,quantity:1,method:'deferred',dedup:false},
    {name:'out-to-low-existing-event-dedup',opening:0,quantity:1,method:'cliq',dedup:true},
  ];
  for(const kind of ['DIRECT_V2','PO_V2'])for(const scenario of scenarios){
    const supplier=randomUUID(),po=randomUUID(),item=randomUUID(),client=randomUUID(),key=randomUUID();
    const paid=scenario.method==='deferred'?0:50,reference=scenario.method==='cliq'?'S5-CLIQ-EFFECT':null;
    const line={client_line_id:client,line_kind:'base_unit',commercial_quantity:scenario.quantity,base_unit_name:'باكيت',
      gross_amount_in_minor_units:scenario.quantity*100,line_discount_in_minor_units:0,
      components:[{product_id:product,base_quantity:scenario.quantity}],...(kind==='PO_V2'?{purchase_order_item_id:item}:{})};
    const common={warehouse_id:warehouse,supplier_invoice_number:null,supplier_invoice_date:null,received_at:null,
      header_discount_in_minor_units:'0',supplier_freight_in_minor_units:'0',legacy_tax_in_minor_units:'0',
      amount_paid_at_receipt_in_minor_units:String(paid),payment_method:scenario.method,payment_reference:reference,
      notes:null,idempotency_key:key,lines:[line]};
    const request=kind==='DIRECT_V2'?{...common,supplier_id:supplier,branch_id:branch,internal_notes:null}
      :{...common,purchase_order_id:po,supplier_delivery_note:null};
    const fixture=`INSERT INTO public.suppliers(id,company_name,is_active) VALUES(${q(supplier)},'Receipt effect fixture',true);
      INSERT INTO public.purchase_orders(id,purchase_order_number,supplier_id,branch_id,warehouse_id,status,created_by)
        VALUES(${q(po)},${q('S5-EFFECT-'+po)},${q(supplier)},${q(branch)},${q(warehouse)},'approved',${q(owner)});
      INSERT INTO public.purchase_order_items(id,purchase_order_id,product_id,ordered_quantity,purchase_price_in_minor_units,line_total_in_minor_units,commercial_line_kind)
        VALUES(${q(item)},${q(po)},${q(product)},${scenario.quantity},100,${scenario.quantity*100},'base_unit');
      DELETE FROM public.stock_alerts WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)};
      UPDATE public.products SET min_stock_level=2 WHERE id=${q(product)};
      ${scenario.opening===null?`DELETE FROM public.inventory_balances WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)};`
        :`UPDATE public.inventory_balances SET on_hand_quantity=${scenario.opening},reserved_quantity=0 WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)};
          INSERT INTO public.stock_alert_reads(stock_alert_id,user_id) SELECT id,${q(owner)} FROM public.stock_alerts
            WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)} AND status='active';`}
      ${scenario.dedup?`INSERT INTO public.automation_events(event_key,event_type,entity_id,payload)
        SELECT 'stock_alert:'||id::text||':low_stock:'||floor(extract(epoch FROM NOW()))::bigint::text,
          'low_stock',id,'{"sentinel":"preserve-existing-event"}'::jsonb FROM public.stock_alerts
          WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)} AND status='active';`:''}`;
    const call=kind==='DIRECT_V2'?`public.create_direct_supplier_receipt_v2(p_supplier_id:=${q(supplier)},
      p_warehouse_id:=${q(warehouse)},p_branch_id:=${q(branch)},p_lines:=${j(request.lines)},
      p_amount_paid_at_receipt_in_minor_units:=${paid},p_payment_method:=${q(scenario.method)},
      p_payment_reference:=${reference===null?'NULL':q(reference)},p_idempotency_key:=${q(key)})`
      :`public.receive_purchase_order_v2(p_purchase_order_id:=${q(po)},p_warehouse_id:=${q(warehouse)},p_lines:=${j(request.lines)},
        p_amount_paid_at_receipt_in_minor_units:=${paid},p_payment_method:=${q(scenario.method)},
        p_payment_reference:=${reference===null?'NULL':q(reference)},p_idempotency_key:=${q(key)})`;
    const actual=await json(`BEGIN;${claims}SET LOCAL TIME ZONE 'UTC';${fixture}
      CREATE TEMP TABLE qa_receipt_effect_before AS SELECT NOW() event_time,
        (SELECT to_jsonb(a) FROM public.stock_alerts a WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)} AND status='active') alert,
        (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.stock_alerts a WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)}) alerts,
        (SELECT jsonb_agg(to_jsonb(n) ORDER BY n.stock_alert_id,n.user_id) FROM public.stock_alert_reads n JOIN public.stock_alerts a ON a.id=n.stock_alert_id
          WHERE a.product_id=${q(product)} AND a.warehouse_id=${q(warehouse)}) reads,
        (SELECT to_jsonb(p) FROM public.products p WHERE id=${q(product)}) product,
        (SELECT to_jsonb(w) FROM public.warehouses w WHERE id=${q(warehouse)}) warehouse,
        (SELECT to_jsonb(n) FROM public.inventory_balances n WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)}) balance,
        (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.automation_events e) events,
        (SELECT id FROM public.cash_shifts WHERE branch_id=${q(branch)} AND status='open') shift_id;
      CREATE TEMP TABLE qa_receipt_effect_plan AS SELECT phase5_private.discover_receipt_v2_prewrite_v1(${q(kind)},${j(request)}) plan;
      SELECT phase5_private.assert_receipt_v2_prewrite_v1(${q(kind)},${j(request)},plan) FROM qa_receipt_effect_plan;
      CREATE TEMP TABLE qa_receipt_effect_ids AS SELECT phase5_private.allocate_receipt_v2_future_uuids_v1(${q(kind)},${j(request)}) minted;
      CREATE TEMP TABLE qa_receipt_effect_source AS SELECT minted->'allocation' allocation,
        phase5_private.derive_receipt_v2_item_rows_v1(${q(kind)},${j(request)},minted->'allocation') plan FROM qa_receipt_effect_ids;
      SELECT phase5_private.assert_receipt_v2_item_rows_v1(${q(kind)},${j(request)},allocation,plan) FROM qa_receipt_effect_source;
      CREATE TEMP TABLE qa_receipt_stock_candidates AS SELECT
        phase5_private.allocate_receipt_v2_stock_candidates_v1(${q(kind)},${j(request)},allocation) candidate
        FROM qa_receipt_effect_source;
      SELECT phase5_private.assert_receipt_v2_stock_candidates_v1(${q(kind)},${j(request)},s.allocation,c.candidate)
        FROM qa_receipt_effect_source s CROSS JOIN qa_receipt_stock_candidates c;
      CREATE TEMP TABLE qa_receipt_stock_resource_union AS SELECT
        phase5_private.derive_receipt_v2_stock_resource_union_v1(${q(kind)},${j(request)},s.allocation,c.candidate) plan
        FROM qa_receipt_effect_source s CROSS JOIN qa_receipt_stock_candidates c;
      SELECT phase5_private.assert_receipt_v2_stock_resource_union_v1(${q(kind)},${j(request)},s.allocation,u.plan)
        FROM qa_receipt_effect_source s CROSS JOIN qa_receipt_stock_resource_union u;
      ${["'null'::jsonb","c-'allocation'","jsonb_set(c,'{executionAuthority}','true')",
        "jsonb_set(c,'{durableIdentityClaimed}','true')","jsonb_set(c,'{afterWaitRevalidated}','true')",
        "jsonb_set(c,'{clock,epochFloorSeconds}','\"0\"')","jsonb_set(c,'{allocation}','[]')",
        "jsonb_set(c,'{stages}','[]')"].map(fault=>`DO $qa$ DECLARE c jsonb; a jsonb; bad jsonb;
      BEGIN
        SELECT candidate INTO c FROM qa_receipt_stock_candidates;
        SELECT allocation INTO a FROM qa_receipt_effect_source;
        bad:=${fault};
          BEGIN
            PERFORM phase5_private.assert_receipt_v2_stock_candidates_v1(${q(kind)},${j(request)},a,bad);
            RAISE EXCEPTION 'QA_STOCK_FORGERY_ACCEPTED';
          EXCEPTION WHEN SQLSTATE '40001' OR SQLSTATE '22023' THEN NULL; END;
      END $qa$;`).join('\n')}
      DO $qa$ DECLARE c jsonb; a jsonb; candidate_id uuid; key_value text;
      BEGIN
        SELECT candidate INTO c FROM qa_receipt_stock_candidates;
        SELECT allocation INTO a FROM qa_receipt_effect_source;
        SELECT (s->>'eventId')::uuid INTO candidate_id FROM jsonb_array_elements(c->'allocation') s WHERE s->>'eventId' IS NOT NULL LIMIT 1;
        IF candidate_id IS NOT NULL THEN
          BEGIN
            INSERT INTO public.automation_events(id,event_key,event_type,entity_id,payload)
              VALUES(candidate_id,'qa-occupied-stock-uuid','low_stock',${q(product)},'{}');
            PERFORM phase5_private.assert_receipt_v2_stock_candidates_v1(${q(kind)},${j(request)},a,c);
            RAISE EXCEPTION 'QA_STOCK_UUID_RECHECK_ACCEPTED';
          EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
          SELECT s->>'eventKey' INTO key_value FROM jsonb_array_elements(c->'stages') s WHERE s->>'eventDisposition'='INSERT_NEW' LIMIT 1;
          BEGIN
            INSERT INTO public.automation_events(event_key,event_type,entity_id,payload)
              VALUES(key_value,'out_of_stock',${q(product)},'{"sentinel":"after-capture"}');
            PERFORM phase5_private.assert_receipt_v2_stock_candidates_v1(${q(kind)},${j(request)},a,c);
            RAISE EXCEPTION 'QA_STOCK_KEY_RECHECK_ACCEPTED';
          EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '40001' THEN NULL; END;
        END IF;
      END $qa$;
      SET LOCAL ROLE authenticated;
      CREATE TEMP TABLE qa_receipt_effect_result AS SELECT ${call} result;
      RESET ROLE;
      SELECT jsonb_build_object('result',r.result,'beforeAlert',b.alert,'beforeEvents',b.events,'eventTime',b.event_time,
        'sourceProjection',(SELECT plan FROM qa_receipt_effect_source),
        'stockCandidates',(SELECT candidate FROM qa_receipt_stock_candidates),
        'stockResourceUnion',(SELECT plan FROM qa_receipt_stock_resource_union),
        'beforeAlerts',b.alerts,'beforeReads',b.reads,'beforeProduct',b.product,'beforeWarehouse',b.warehouse,'beforeBalance',b.balance,
        'epoch',floor(extract(epoch FROM b.event_time))::bigint::text,'expectedShift',b.shift_id,
        'balance',(SELECT to_jsonb(n) FROM public.inventory_balances n WHERE n.product_id=${q(product)} AND n.warehouse_id=${q(warehouse)}),
        'alerts',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.stock_alerts n WHERE n.product_id=${q(product)} AND n.warehouse_id=${q(warehouse)}),
        'reads',(SELECT count(*) FROM public.stock_alert_reads n JOIN public.stock_alerts a ON a.id=n.stock_alert_id
          WHERE a.product_id=${q(product)} AND a.warehouse_id=${q(warehouse)}),
        'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.automation_events e),
        'payments',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.supplier_payments n WHERE operation_id=(r.result->>'operation_id')::uuid),
        'deliveries',(SELECT count(*) FROM public.automation_event_deliveries))
      FROM qa_receipt_effect_result r CROSS JOIN qa_receipt_effect_before b;ROLLBACK;`);
    assert.equal(actual.result.success,true,kind+' '+scenario.name+' actual authenticated public RPC');checks++;
    const union=bindReceiptV2SourceEffectUnion(sources,migrationSources,primaryInstalled,transitiveInstalled,kind,actual.sourceProjection);
    assert.equal(assertReceiptV2SourceEffectUnion(sources,migrationSources,primaryInstalled,transitiveInstalled,kind,actual.sourceProjection,union),true);checks++;
    if(paid>0){assert.equal(union.payment.triggerShift.value,actual.expectedShift);checks++;
      assert.equal(union.payment.triggerShift.sourceKind,kind);checks++;
      assert.equal(union.payment.columns.find(c=>c.name==='cash_shift_id').value,actual.payments[0].cash_shift_id);checks++;}
    else {assert.equal(union.payment,null);checks++;}
    for(const flag of ['sourcePlanValidatedByThisAnalysis','eventKeyResolutionComplete','futureIdentitySetResolved',
      'durableIdentityClaimed','fullTypedWriteTuplesQualified','writerInvokerAbsenceConvergence','locksHeld','executionAuthority']){
      assert.equal(union[flag],false);checks++;}
    const snapshot={targets:[{productId:product,warehouseId:warehouse,productName:actual.beforeProduct.name_ar,
      warehouseName:actual.beforeWarehouse.name_ar,active:actual.beforeProduct.is_active,threshold:actual.beforeProduct.min_stock_level,
      beforeAvailable:actual.beforeBalance?.available_quantity??null,
      afterAvailable:(actual.beforeBalance?.available_quantity??0)+scenario.quantity}],
      alerts:actual.beforeAlerts??[],reads:actual.beforeReads??[],
      events:(actual.beforeEvents??[]).filter(e=>(actual.beforeAlerts??[]).some(a=>e.entity_id===a.id||e.event_key.startsWith('stock_alert:'+a.id+':')))};
    const staged=deriveReceiptV2StockStages(sources,migrationSources,transitiveInstalled,snapshot);
    assert.deepEqual(union.stock,staged,'whole source-plan union versus independent pre-RPC snapshot parity');checks++;
    const candidate=actual.stockCandidates;
    const stockExpected=resolveReceiptV2StockCandidateRequirements(sources,migrationSources,transitiveInstalled,
      snapshot,candidate.clock,candidate.allocation,actual.beforeEvents??[]);
    // SQL timestamptz JSON and the explicit UTC clock have equivalent spellings.
    // Canonicalize representation only, preserving PostgreSQL microseconds.
    const canonicalTimes=value=>{
      if(Array.isArray(value))return value.map(canonicalTimes);
      if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,canonicalTimes(v)]));
      if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/u.test(value))
        return value.replace(/\+00:00$/u,'Z').replace(/(\.\d*?[1-9])0+Z$/u,'$1Z').replace(/\.0+Z$/u,'Z');
      return value;
    };
    assert.deepEqual(canonicalTimes(candidate.stages),canonicalTimes(stockExpected.stages),
      'candidate stages derived from independent pre-RPC source, not observed effects');checks++;
    assert.deepEqual(candidate.itemPlan,actual.sourceProjection,'whole request/resource/payment union retained');checks++;
    const resourceUnion=bindReceiptV2StockResourceUnion(sources,migrationSources,primaryInstalled,transitiveInstalled,
      kind,actual.sourceProjection,candidate.clock,candidate.allocation,actual.beforeEvents??[]);
    assert.equal(assertReceiptV2StockResourceUnion(sources,migrationSources,primaryInstalled,transitiveInstalled,
      kind,actual.sourceProjection,candidate.clock,candidate.allocation,actual.beforeEvents??[],resourceUnion),true);checks++;
    assert.deepEqual(resourceUnion.resources.slice(0,union.retainedCompleteSourceResources.length),
      union.retainedCompleteSourceResources,'entire original union preserved');checks++;
    assert.deepEqual(canonicalTimes(resourceUnion.stock.stages),canonicalTimes(candidate.stages));checks++;
    for(const field of ['resources','keyRequirements','futureIdentityRequirements']){
      assert.deepEqual(canonicalTimes(actual.stockResourceUnion[field]),canonicalTimes(resourceUnion[field]),
        'private DB resource union versus independent complete source requirements '+field);checks++;
    }
    assert.equal(actual.stockResourceUnion.sourcePlanFreshlyRevalidated,true);checks++;
    for(const flag of ['foreignKeysInstalledValidated','typedFullRowsQualified','writerInvokerAbsenceConvergence',
      'durableIdentityClaimed','absencePredicatesFenced','afterWaitRevalidated','locksHeld','heldContextAuthority','executionAuthority']){
      assert.equal(actual.stockResourceUnion[flag],false);checks++;
    }
    for(const key of resourceUnion.keyRequirements){
      assert.equal(key.absenceFenced,false);assert.equal(key.afterWaitRevalidated,false);checks+=2;
      if(key.observedRow){
        assert.deepEqual(resourceUnion.resources.find(r=>r.relation==='public.automation_events'&&r.id===key.observedRow.id)?.row,
          key.observedRow,'global first-owner full row included exactly');checks++;
      }else {assert.ok(resourceUnion.futureIdentityRequirements.some(r=>r.relation==='public.automation_events'&&r.id===key.candidateId));checks++;}
    }
    for(const flag of ['sourcePlanValidatedByThisAnalysis','clockAuthorityQualified','foreignKeysInstalledValidated',
      'typedFullRowsQualified','writerInvokerAbsenceConvergence','durableIdentityClaimed','absencePredicatesFenced',
      'afterWaitRevalidated','locksHeld','executionAuthority']){assert.equal(resourceUnion[flag],false);checks++;}
    assert.equal(candidate.clock.epochFloorSeconds,actual.epoch);checks++;
    assert.equal(canonicalTimes(candidate.clock.timestampUtc),canonicalTimes(actual.eventTime));checks++;
    assert.equal(candidate.serverAllocated,true);assert.equal(candidate.freshSourceAndCollisionRevalidation,true);checks+=2;
    for(const flag of ['durableIdentityClaimed','absencePredicatesFenced','afterWaitRevalidated','fullWriteTuples',
      'writerInvokerClosure','locksHeld','heldContextAuthority','executionAuthority']){assert.equal(candidate[flag],false);checks++;}
    const eventClock={timestampUtc:actual.eventTime,epochFloorSeconds:actual.epoch};
    const resolvedEvents=resolveReceiptV2CapturedAlertEvents(sources,migrationSources,transitiveInstalled,
      union.stock.retainedSnapshot,eventClock);
    assert.equal(assertReceiptV2CapturedAlertEvents(sources,migrationSources,transitiveInstalled,
      union.stock.retainedSnapshot,eventClock,resolvedEvents),true);checks++;
    for(const d of resolvedEvents.decisions){
      if(d.status==='UNRESOLVED_FUTURE_ALERT_IDENTITY'){
        assert.equal(d.eventKey,null,'new source alert UUID never borrowed from observed after-effect evidence');checks++;
        continue;
      }
      const live=actual.alerts.find(a=>a.id===d.after.id);
      assert.deepEqual(live,d.after,'captured alert full OLD/NEW actual transaction-time parity');checks++;
      if(d.outbox){
        const actualEvent=actual.events.find(e=>e.event_key===d.outbox.eventKey);assert.ok(actualEvent);checks++;
        if(d.outbox.action==='PRESERVE_EXACT_CAPTURED_EVENT'){
          assert.deepEqual(actualEvent,d.outbox.capturedRow,'resolved exact-key conflict preserves all captured event content');checks++;
        }else {
          const {id:observedDefaultId,...actualWithoutId}=actualEvent;
          assert.ok(observedDefaultId);checks++;
          assert.deepEqual(actualWithoutId,d.outbox.newRowWithoutId,'independent source-derived event tuple except unallocated default UUID');checks++;
        }
      }
    }
    for(const flag of ['clockAuthorityQualified','futureIdentitySetResolved','absenceFenceHeld',
      'durableIdentityClaimed','fullTypedWriteTuplesQualified','locksHeld','executionAuthority']){
      assert.equal(resolvedEvents[flag],false);checks++;
    }
    assert.equal(assertReceiptV2StockStages(sources,migrationSources,transitiveInstalled,snapshot,staged),true);checks++;
    const projectedFinal=staged.stages.at(-1);
    assert.ok(projectedFinal);checks++;
    const liveFinal=actual.alerts.find(a=>a.product_id===product&&a.warehouse_id===warehouse);assert.ok(liveFinal);checks++;
    for(const [column,binding] of Object.entries(projectedFinal.alert.after)){
      if(binding.requirement==='BOUND_CAPTURED_OR_SOURCE_VALUE'){
        assert.deepEqual(liveFinal[column],binding.value,'symbolic OLD/NEW source-column parity '+column);checks++;
      }
    }
    assert.equal((snapshot.reads.length-staged.stages.reduce((n,s)=>n+s.deletedReads.length,0)),actual.reads,
      'exact ordered source read deletion identity coverage');checks++;
    for(const flag of ['sourcePlanValidatedByThisAnalysis','actualEventValuesAllocated','futureIdentitySetResolved',
      'paymentUnionComplete','durableIdentityClaimed','locksHeld','executionAuthority']){assert.equal(staged[flag],false);checks++;}
    const opening=scenario.opening??0;
    assert.equal(actual.balance.on_hand_quantity,opening+scenario.quantity);checks++;
    assert.equal(actual.balance.reserved_quantity,0);assert.equal(actual.balance.available_quantity,opening+scenario.quantity);checks+=2;
    const first=scenario.opening===null?deriveReceiptV2AlertTransition(contract,{active:true,available:0,threshold:2,previousSeverity:null}):null;
    const final=deriveReceiptV2AlertTransition(contract,{active:true,available:opening+scenario.quantity,threshold:2,
      previousSeverity:first?.severity??actual.beforeAlert?.severity??null});
    assert.equal(actual.alerts.length,1,'per-SKU/warehouse alert, never aggregate-only coverage');checks++;
    const alert=actual.alerts[0];
    assert.equal(alert.product_id,product);assert.equal(alert.warehouse_id,warehouse);checks+=2;
    assert.equal(alert.available_quantity,opening+scenario.quantity);assert.equal(alert.threshold_quantity,2);checks+=2;
    assert.equal(alert.status,final.action==='RESOLVE'?'resolved':'active');checks++;
    if(final.severity!==null){assert.equal(alert.severity,final.severity);checks++;}
    assert.equal(alert.last_updated_at,actual.eventTime);checks++;
    if(actual.beforeAlert){assert.equal(alert.id,actual.beforeAlert.id,'existing identity retained');checks++;}
    assert.equal(actual.reads,scenario.opening===null||final.deleteReads?0:1);checks++;
    if(final.action==='RESOLVE'){assert.equal(alert.resolved_at,actual.eventTime);checks++;}
    const beforeEvents=actual.beforeEvents??[],events=actual.events??[];
    for(const before of beforeEvents){assert.deepEqual(events.find(e=>e.id===before.id),before,'old event content preserved');checks++;}
    const inserted=events.filter(e=>!beforeEvents.some(before=>before.id===e.id));
    const emissions=[...(first?.emitOutbox?[{severity:first.severity,available:0}]:[]),
      ...(final.emitOutbox&&!scenario.dedup?[{severity:final.severity,available:opening+scenario.quantity}]:[])];
    assert.equal(inserted.length,emissions.length,'exact operation-trigger event delta');checks++;
    for(const expected of emissions){
      const event=inserted.find(e=>e.event_key===`stock_alert:${alert.id}:${expected.severity}:${actual.epoch}`);assert.ok(event);checks++;
      assert.equal(event.entity_id,alert.id);assert.equal(event.event_type,expected.severity);checks+=2;
      for(const [field,value] of Object.entries({stockAlertId:alert.id,productId:product,warehouseId:warehouse,
        availableQuantity:expected.available,thresholdQuantity:2,severity:expected.severity,updatedAt:actual.eventTime})){
        assert.equal(event.payload[field],value,'source-derived outbox '+field);checks++;
      }
    }
    assert.equal(actual.deliveries,0,'outbox insert is not an implicit delivery');checks++;
    assert.equal((actual.payments??[]).length,paid>0?1:0);checks++;
    if(paid>0){const payment=actual.payments[0];assert.equal(payment.supplier_id,supplier);checks++;
      assert.equal(payment.amount_in_minor_units,paid);assert.equal(payment.payment_method,scenario.method);checks+=2;
      assert.equal(payment.reference_number,reference);assert.equal(payment.cash_shift_id,actual.expectedShift);checks+=2;
      assert.equal(payment.operation_id,actual.result.operation_id);checks++;
      assert.equal(payment[kind==='DIRECT_V2'?'supplier_receipt_id':'purchase_receipt_id'],actual.result.receipt_id);checks++;
    }
    assert.equal(await fingerprint(),baseline,'entire trigger/payment/default public fixture exact rollback');checks++;
  }
  const clockAlert=randomUUID(),clockInputs=['1969-12-31T23:59:59.000001Z','1969-12-31T23:59:59.999999Z',
    '1970-01-01T00:00:00Z','1970-01-01T00:00:00.000001Z','1970-01-01T00:00:00.999999Z',
    '2000-02-29T23:59:59.999999Z','2026-10-06T03:00:00.123456+03:00'];
  const clockProof=await json(`BEGIN;SET LOCAL TIME ZONE 'UTC';
    SELECT jsonb_agg(jsonb_build_object('clock',jsonb_build_object('timestampUtc',t,
      'epochFloorSeconds',floor(extract(epoch FROM t))::bigint::text),
      'key','stock_alert:'||${q(clockAlert)}||':low_stock:'||floor(extract(epoch FROM t))::bigint::text) ORDER BY t)
      FROM (VALUES ${clockInputs.map(t=>`(${q(t)}::timestamptz)`).join(',')}) v(t);ROLLBACK;`);
  for(const proof of clockProof){
    const snapshot={targets:[{productId:product,warehouseId:warehouse,productName:'UTC control',warehouseName:'UTC control',
      active:true,threshold:2,beforeAvailable:0,afterAvailable:1}],
      alerts:[{id:clockAlert,product_id:product,warehouse_id:warehouse,severity:'out_of_stock',status:'active',
        available_quantity:0,threshold_quantity:2,first_triggered_at:proof.clock.timestampUtc,
        last_updated_at:proof.clock.timestampUtc,resolved_at:null}],reads:[],events:[]};
    const resolved=resolveReceiptV2CapturedAlertEvents(sources,migrationSources,transitiveInstalled,snapshot,proof.clock);
    assert.equal(resolved.decisions[0].outbox.eventKey,proof.key,'PostgreSQL microsecond/negative-epoch exact key parity');checks++;
    assert.equal(resolved.decisions[0].outbox.newRowWithoutId.payload.updatedAt,proof.clock.timestampUtc);checks++;
  }
  assert.equal(await fingerprint(),baseline,'clock/key representation controls are content-zero-write');checks++;
  for(const role of ['anon','authenticated','service_role']){
    await fails(`GRANT USAGE ON SCHEMA phase5_private TO ${role};SET LOCAL ROLE ${role};
      SELECT phase5_private.shift_inventory_side_effect_catalog_v1();`,/42501.*permission denied for function/u);
    assert.equal(await fingerprint(),baseline);checks++;
    for(const call of [
      "derive_receipt_v2_stock_candidates_v1('DIRECT_V2','{}','{}','[]')",
      "allocate_receipt_v2_stock_candidates_v1('DIRECT_V2','{}','{}')",
      "assert_receipt_v2_stock_candidates_v1('DIRECT_V2','{}','{}','{}')",
      "derive_receipt_v2_stock_resource_union_v1('DIRECT_V2','{}','{}','{}')",
      "assert_receipt_v2_stock_resource_union_v1('DIRECT_V2','{}','{}','{}')",
    ]){
      await fails(`GRANT USAGE ON SCHEMA phase5_private TO ${role};SET LOCAL ROLE ${role};SELECT phase5_private.${call};`,
        /42501.*permission denied for function/u);
      assert.equal(await fingerprint(),baseline,'stock candidate helper denial exact rollback');checks++;
    }
  }
  for(const flag of ['installedCatalogValidated','defaultsEvaluated','transitiveIdentityOwned','fullWriteTuplesQualified','locksHeld','executionAuthority']){
    assert.equal(contract[flag],false);checks++;
  }
  passed.push('Receipt V2 source-bound server stock alert/outbox candidate allocation and fresh collision/key revalidation; independent pre-RPC ordered stage/full tuple parity across Direct/PO; exact first-wins reuse and retained complete source/payment union; forged authority/source/clock/key and occupied UUID reject; actual public effects and prior clock controls preserved, exact rollback and all-app-role denials. Candidates NOT durable ownership/absence fences/after-wait context/execution');
};

const sourceTypedValuesRuntime = async (claims) => {
  const baseline=await fingerprint();
  const names=['business_operations','supplier_receipts','supplier_receipt_items','supplier_receipt_commercial_lines',
    'purchase_receipts','purchase_receipt_items','purchase_receipt_commercial_lines','supplier_payments',
    'inventory_balances','inventory_movements','phase2_receipt_wac_snapshots','supplier_financial_invoice_identities',
    'audit_logs','product_images','products','suppliers','purchase_orders','purchase_order_items'];
  const installed=await json(`SELECT jsonb_agg(jsonb_build_object('relation',c.relname,'columns',
    (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
      'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated)
      ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(ARRAY[${names.map(q).join(',')}]);`);
  assert.equal(installed.length,names.length);checks++;
  const prove=async(relation,values)=>{
    const qualified=qualifyPreparedSourceRow(installed,relation,values);
    assert.equal(assertPreparedSourceRow(installed,relation,values,[],qualified),true);checks++;
    const row=await json(`SELECT to_jsonb(jsonb_populate_record(NULL::${relation},${j(values)}));`);
    for(const c of qualified.columns.filter(c=>c.state==='KNOWN_SOURCE_VALUE_TYPE_CHECKED')){
      const typed=qualifySourceScalarValue(c,row[c.name]);
      assert.equal(typed.type,c.typed.type);checks++;
      if(c.typed.encoding==='EXACT_INTEGER')assert.equal(BigInt(typed.value),BigInt(c.typed.value));
      else if(c.typed.encoding==='EXACT_DECIMAL_NO_ROUNDING')assert.equal(Number(typed.value),Number(c.typed.value));
      else assert.deepEqual(typed.value,c.typed.value);
      checks++;
    }
    if(qualified.columns.some(c=>c.state==='EXACT_GENERATED_REQUIREMENT')){
      const actual=await json(`SELECT to_jsonb((${q(String(values.on_hand_quantity))}::integer-${q(String(values.reserved_quantity))}::integer)::text);`);
      assert.equal(actual,qualified.columns.find(c=>c.state==='EXACT_GENERATED_REQUIREMENT').typed.value);checks++;
    }
    for(const flag of ['postgresCastParityProven','defaultsEvaluated','foreignKeysQualified','fullTypedWriteTuplesQualified',
      'durableIdentityClaimed','locksHeld','executionAuthority']){assert.equal(qualified[flag],false);checks++;}
    assert.equal(await fingerprint(),baseline,'type casts do not write/default/claim business state');checks++;
  };
  // Source-qualified projections are created and asserted inside a rollback-only
  // fixture, then retained as immutable evidence for READ-ONLY registered casts.
  for(const kind of ['DIRECT_V2','PO_V2']){
    const supplier=randomUUID(),po=randomUUID(),item=randomUUID(),client=randomUUID(),key=randomUUID();
    const lines=[{client_line_id:client,line_kind:'base_unit',commercial_quantity:2,base_unit_name:'باكيت',
      gross_amount_in_minor_units:201,line_discount_in_minor_units:1,components:[{product_id:product,base_quantity:2}],
      ...(kind==='PO_V2'?{purchase_order_item_id:item}:{})}];
    const request={warehouse_id:warehouse,supplier_invoice_number:'TYPE-INVOICE',supplier_invoice_date:'2026-10-06',
      received_at:'2026-10-06T00:00:00.123456Z',header_discount_in_minor_units:'1',supplier_freight_in_minor_units:'3',
      legacy_tax_in_minor_units:'17',amount_paid_at_receipt_in_minor_units:'50',payment_method:'cash',payment_reference:null,
      notes:'typed source',idempotency_key:key,lines,...(kind==='DIRECT_V2'?{supplier_id:supplier,branch_id:branch,internal_notes:null}
        :{purchase_order_id:po,supplier_delivery_note:null})};
    const plan=await json(`BEGIN;${claims}SET LOCAL TIME ZONE 'UTC';
      INSERT INTO public.suppliers(id,company_name,is_active) VALUES(${q(supplier)},'A2 type source',true);
      INSERT INTO public.purchase_orders(id,purchase_order_number,supplier_id,branch_id,warehouse_id,status,created_by)
        VALUES(${q(po)},${q('A2-'+po)},${q(supplier)},${q(branch)},${q(warehouse)},'approved',${q(owner)});
      INSERT INTO public.purchase_order_items(id,purchase_order_id,product_id,ordered_quantity,purchase_price_in_minor_units,
        line_total_in_minor_units,commercial_line_kind) VALUES(${q(item)},${q(po)},${q(product)},2,101,202,'base_unit');
      CREATE TEMP TABLE qa_type_ids AS SELECT phase5_private.allocate_receipt_v2_future_uuids_v1(${q(kind)},${j(request)})->'allocation' allocation;
      CREATE TEMP TABLE qa_type_source AS SELECT allocation,phase5_private.derive_receipt_v2_item_rows_v1(${q(kind)},${j(request)},allocation) plan FROM qa_type_ids;
      SELECT phase5_private.assert_receipt_v2_item_rows_v1(${q(kind)},${j(request)},allocation,plan) FROM qa_type_source;
      SELECT plan FROM qa_type_source;ROLLBACK;`);
    assert.equal(await fingerprint(),baseline);checks++;
    const f=plan.financialPlan,i=f.inventoryPlan,b=i.balancePlan;
    const source=kind==='DIRECT_V2'?'supplier_receipt':'purchase_receipt';
    const rows=[[`public.${source}s`,f.headerWithoutEventValues],['public.business_operations',f.operationWithoutResultAndTime],
      ['public.supplier_financial_invoice_identities',f.invoiceWithoutDefaults],['public.supplier_payments',f.paymentWithoutNotesTimeAndTrigger],
      ['public.audit_logs',Object.fromEntries(Object.entries(f.auditWithoutEventValues).filter(([name])=>name!=='detailsWithoutReceiptNumberAndWac'))],
      ...plan.commercialLines.map(n=>[`public.${source}_commercial_lines`,n.explicitRowWithoutFinalizedAt]),
      ...plan.items.map(n=>[`public.${source}_items`,n.explicitRow]),
      ...i.movements.map(n=>['public.inventory_movements',n.explicitRowWithoutEventValues??n.explicitRowWithoutEventTimeAndSequence??n.explicitRow]),
      ...i.wacRows.map(n=>['public.phase2_receipt_wac_snapshots',n.explicitRow])];
    for(const [relation,value] of rows)if(value!==null)await prove(relation,value);
    for(const balance of b.rows)await prove('public.inventory_balances',balance.afterWithoutEventTime);
    // UPDATE patch fields use exact installed target types; missing event fields
    // remain requirements, not fabricated NOW/sequence/receipt-number values.
    for(const [relation,patch] of [['public.products',i.productPatches[0].patchWithoutEventTime],
      ['public.suppliers',f.supplierPatchWithoutEventTime.patchWithoutEventTime],
      ...plan.purchaseOrderItemPatches.map(n=>['public.purchase_order_items',n.patchWithoutEventTime])])await prove(relation,patch);
  }
  const category='92400000-0000-0000-0000-000000000011',unit='92400000-0000-0000-0000-000000000010';
  const request={sku:'A2-TYPE-FAMILY',barcode:null,nameAr:'نوع',description:null,categoryId:category,brandId:null,
    unitId:unit,purchaseUnitId:null,unitsPerPurchaseUnit:1,defaultPurchasePriceInMinorUnits:'0',saleUnitId:unit,
    unitsPerSaleUnit:5,defaultSalePriceInMinorUnits:'5000',costPriceInMinorUnits:'7',minStockLevel:0,maxStockLevel:null,
    warehouseId:warehouse,imageUrl:'http://127.0.0.1/type.png',flavors:[{nameAr:'أ',openingSalePackages:0}]};
  const ancillary=await json(`BEGIN;${claims}SET LOCAL TIME ZONE 'UTC';
    CREATE TEMP TABLE qa_type_product AS SELECT phase5_private.allocate_product_ancillary_identities_v1('FAMILY_V1',${j(request)}) plan;
    SELECT phase5_private.assert_product_ancillary_identities_v1('FAMILY_V1',${j(request)},plan->'prewritePlan'->'allocation',plan->'allocation',
      plan||jsonb_build_object('serverAllocated',false)) FROM qa_type_product;
    SELECT plan FROM qa_type_product;ROLLBACK;`);
  assert.equal(await fingerprint(),baseline);checks++;
  for(const binding of ancillary.identityBindings)await prove(binding.relation,{id:binding.id,...binding.binding});
  // Adversarial server controls preserve statement_timeout10s and never INSERT.
  for(const expression of ["'2147483648'::integer","'9223372036854775808'::bigint","'2026-02-29'::date",
    "'not-uuid'::uuid","'2147483647'::integer-'-1'::integer"]){
    await fails(`SELECT ${expression};`,/22003|22008|22P02/u);assert.equal(await fingerprint(),baseline);checks++;
  }
  const rounding=await json("SELECT to_jsonb('1.0000001'::numeric(24,6)::text);");
  assert.equal(rounding,'1.000000');checks++;
  assert.throws(()=>qualifySourceScalarValue({type:'numeric(24,6)',notNull:true},'1.0000001'),/TYPED_VALUE_INVALID/u);checks++;
  const nulls=await json("SELECT jsonb_build_object('sqlNull',NULL::jsonb IS NULL,'jsonNull','null'::jsonb IS NULL);");
  assert.deepEqual(nulls,{sqlNull:true,jsonNull:false});checks++;
  assert.equal(await fingerprint(),baseline);checks++;
  passed.push('A2 source-asserted Direct/PO primary INSERT and UPDATE known values plus family ancillary balance/image/audit values: actual registered PostgreSQL row casts and generated integer arithmetic, precise NULL distinction, range/calendar/UUID/rounding rejection, content-zero-write. Defaults/time/number/sequence/FK/ownership/execution remain explicit obligations');
};

const receiptV2MultiSourceRuntime = async (claims) => {
  const baseline=await fingerprint(),second='92400000-0000-0000-0000-000000000102';
  const migrationSources=new Map(await Promise.all((await readdir(path.join(root,'supabase/migrations')))
    .filter(n=>/^[0-9]{3}_/u.test(n)&&Number(n.slice(0,3))<=127).sort().map(async n=>
      [n,(await readFile(path.join(root,'supabase/migrations',n),'utf8')).replace(/\r\n?/gu,'\n')])));
  const sources=functionEvents([...migrationSources].map(([filename,source])=>({filename,source}))).state;
  const relations=['business_operations','supplier_receipts','supplier_receipt_items','supplier_receipt_commercial_lines',
    'purchase_receipts','purchase_receipt_items','purchase_receipt_commercial_lines','supplier_payments','inventory_balances',
    'inventory_movements','phase2_receipt_wac_snapshots','supplier_financial_invoice_identities','audit_logs',
    'stock_alerts','stock_alert_reads','automation_events'];
  const installed=await json(`SELECT jsonb_agg(jsonb_build_object('relation',c.relname,'columns',
    (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
      'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated)
      ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(ARRAY[${relations.map(q).join(',')}]);`);
  const transitive=installed.filter(t=>['stock_alerts','stock_alert_reads','automation_events'].includes(t.relation));
  const primary=installed.filter(t=>!transitive.includes(t));
  for(const kind of ['DIRECT_V2','PO_V2'])for(const absent of [false,true]){
    const supplier=randomUUID(),po=randomUUID(),key=randomUUID(),otherWarehouse=randomUUID(),eventOwner=randomUUID();
    const specs=[{sku:product,qty:1,price:100},{sku:second,qty:1,price:90},{sku:product,qty:2,price:170}];
    const lines=specs.map(s=>({client_line_id:randomUUID(),line_kind:'base_unit',commercial_quantity:s.qty,
      base_unit_name:'باكيت',gross_amount_in_minor_units:s.qty*s.price,line_discount_in_minor_units:0,
      components:[{product_id:s.sku,base_quantity:s.qty}],...(kind==='PO_V2'?{purchase_order_item_id:randomUUID()}:{})}));
    const request={warehouse_id:warehouse,supplier_invoice_number:null,supplier_invoice_date:null,received_at:null,
      header_discount_in_minor_units:'0',supplier_freight_in_minor_units:'0',legacy_tax_in_minor_units:'0',
      amount_paid_at_receipt_in_minor_units:'0',payment_method:'deferred',payment_reference:null,notes:null,idempotency_key:key,lines,
      ...(kind==='DIRECT_V2'?{supplier_id:supplier,branch_id:branch,internal_notes:null}:{purchase_order_id:po,supplier_delivery_note:null})};
    const call=kind==='DIRECT_V2'?`public.create_direct_supplier_receipt_v2(p_supplier_id:=${q(supplier)},
      p_warehouse_id:=${q(warehouse)},p_branch_id:=${q(branch)},p_lines:=${j(lines)},
      p_amount_paid_at_receipt_in_minor_units:=0,p_payment_method:='deferred',p_idempotency_key:=${q(key)})`
      :`public.receive_purchase_order_v2(p_purchase_order_id:=${q(po)},p_warehouse_id:=${q(warehouse)},p_lines:=${j(lines)},
        p_amount_paid_at_receipt_in_minor_units:=0,p_payment_method:='deferred',p_idempotency_key:=${q(key)})`;
    const actual=await json(`BEGIN;${claims}SET LOCAL TIME ZONE 'UTC';
      INSERT INTO public.suppliers(id,company_name,is_active) VALUES(${q(supplier)},'A1 multi-source',true);
      INSERT INTO public.purchase_orders(id,purchase_order_number,supplier_id,branch_id,warehouse_id,status,created_by)
        VALUES(${q(po)},${q('A1-'+po)},${q(supplier)},${q(branch)},${q(warehouse)},'approved',${q(owner)});
      ${kind==='PO_V2'?lines.map((l,n)=>`INSERT INTO public.purchase_order_items(id,purchase_order_id,product_id,ordered_quantity,
        purchase_price_in_minor_units,line_total_in_minor_units,commercial_line_kind) VALUES(${q(l.purchase_order_item_id)},${q(po)},
        ${q(specs[n].sku)},${specs[n].qty},${specs[n].price},${specs[n].qty*specs[n].price},'base_unit');`).join('\n'):''}
      INSERT INTO public.warehouses(id,branch_id,code,name_ar,is_active) VALUES(${q(otherWarehouse)},${q(branch)},${q('A1-'+otherWarehouse)},'A1 other warehouse',true);
      INSERT INTO public.inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity)
        VALUES(${q(otherWarehouse)},${q(product)},7,0),(${q(otherWarehouse)},${q(second)},11,0);
      UPDATE public.products SET min_stock_level=10 WHERE id IN (${q(product)},${q(second)});
      DELETE FROM public.stock_alerts WHERE warehouse_id=${q(warehouse)} AND product_id IN (${q(product)},${q(second)});
      ${absent?`DELETE FROM public.inventory_balances WHERE warehouse_id=${q(warehouse)} AND product_id IN (${q(product)},${q(second)});`
        :`UPDATE public.inventory_balances SET on_hand_quantity=0,reserved_quantity=0 WHERE warehouse_id=${q(warehouse)} AND product_id IN (${q(product)},${q(second)});`}
      CREATE TEMP TABLE qa_multi_before AS SELECT
        (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.products p WHERE id IN (${q(product)},${q(second)})) products,
        (SELECT jsonb_agg(to_jsonb(b) ORDER BY product_id,warehouse_id) FROM public.inventory_balances b WHERE product_id IN (${q(product)},${q(second)})) balances,
        (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.stock_alerts a WHERE warehouse_id=${q(warehouse)} AND product_id IN (${q(product)},${q(second)})) alerts,
        (SELECT to_jsonb(w) FROM public.warehouses w WHERE id=${q(warehouse)}) warehouse;
      CREATE TEMP TABLE qa_multi_ids AS SELECT phase5_private.allocate_receipt_v2_future_uuids_v1(${q(kind)},${j(request)})->'allocation' allocation;
      CREATE TEMP TABLE qa_multi_stock AS SELECT phase5_private.allocate_receipt_v2_stock_candidates_v1(${q(kind)},${j(request)},allocation) candidate FROM qa_multi_ids;
      INSERT INTO public.automation_events(id,event_key,event_type,entity_id,payload)
        SELECT ${q(eventOwner)},candidate->'stages'->0->>'eventKey','low_stock',${q(product)},'{"sentinel":"global unrelated key owner"}' FROM qa_multi_stock;
        UPDATE qa_multi_stock SET candidate=phase5_private.derive_receipt_v2_stock_candidates_v1(${q(kind)},${j(request)},
          (SELECT allocation FROM qa_multi_ids),jsonb_set(candidate->'allocation','{0,eventId}','null'))||jsonb_build_object('serverAllocated',true);
      CREATE TEMP TABLE qa_multi_event_before AS SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') events FROM public.automation_events e;
      CREATE TEMP TABLE qa_multi_private_before AS SELECT (${fingerprintQuery.trim().replace(/;$/u,'')}) fingerprint;
      CREATE TEMP TABLE qa_receipt_stock_resource_union AS SELECT phase5_private.derive_receipt_v2_stock_resource_union_v1(
        ${q(kind)},${j(request)},i.allocation,s.candidate) plan FROM qa_multi_ids i CROSS JOIN qa_multi_stock s;
      SELECT phase5_private.assert_receipt_v2_stock_resource_union_v1(${q(kind)},${j(request)},i.allocation,u.plan)
        FROM qa_multi_ids i CROSS JOIN qa_receipt_stock_resource_union u;
      ${["p-'resources'","jsonb_set(p,'{resources}','[]')","jsonb_set(p,'{locksHeld}','true')",
        "jsonb_set(p,'{futureIdentityRequirements,0,owned}','true')",
        "jsonb_set(p,'{resources}',(p->'resources')||jsonb_build_array(p->'resources'->0))",
        "jsonb_set(p,'{keyRequirements,0,key}','\"foreign-key\"')"].map(fault=>`DO $qa$ DECLARE p jsonb; a jsonb;
        BEGIN SELECT plan INTO p FROM qa_receipt_stock_resource_union;SELECT allocation INTO a FROM qa_multi_ids;
          BEGIN PERFORM phase5_private.assert_receipt_v2_stock_resource_union_v1(${q(kind)},${j(request)},a,${fault});
            RAISE EXCEPTION 'QA_RESOURCE_FORGERY_ACCEPTED';
          EXCEPTION WHEN SQLSTATE '40001' OR SQLSTATE '22023' THEN NULL; END;
        END $qa$;`).join('\n')}
      CREATE TEMP TABLE qa_multi_private_after AS SELECT (${fingerprintQuery.trim().replace(/;$/u,'')}) fingerprint;
      SET LOCAL ROLE authenticated;
      CREATE TEMP TABLE qa_multi_result AS SELECT ${call} result;
      RESET ROLE;
      SELECT jsonb_build_object('result',r.result,'before',to_jsonb(b),'beforeEvents',e.events,'resourceUnion',u.plan,
        'operation',(SELECT to_jsonb(n) FROM public.business_operations n WHERE id=(r.result->>'operation_id')::uuid),
        'privateZeroWrite',(SELECT fingerprint FROM qa_multi_private_before)=(SELECT fingerprint FROM qa_multi_private_after),
        'items',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.${kind==='DIRECT_V2'?'supplier_receipt_items':'purchase_receipt_items'} n WHERE operation_id=(r.result->>'operation_id')::uuid),
        'lines',(SELECT jsonb_agg(to_jsonb(n) ORDER BY client_line_id) FROM public.${kind==='DIRECT_V2'?'supplier_receipt_commercial_lines':'purchase_receipt_commercial_lines'} n WHERE operation_id=(r.result->>'operation_id')::uuid),
        'balances',(SELECT jsonb_agg(to_jsonb(n) ORDER BY product_id) FROM public.inventory_balances n WHERE warehouse_id=${q(warehouse)} AND product_id IN (${q(product)},${q(second)})),
        'products',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.products n WHERE id IN (${q(product)},${q(second)})),
        'movements',(SELECT jsonb_agg(to_jsonb(n) ORDER BY mutation_sequence) FROM public.inventory_movements n WHERE operation_id=(r.result->>'operation_id')::uuid),
        'events',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.automation_events n))
        FROM qa_multi_result r CROSS JOIN qa_multi_before b CROSS JOIN qa_multi_event_before e CROSS JOIN qa_receipt_stock_resource_union u;ROLLBACK;`);
    assert.equal(actual.result.success,true);assert.equal(actual.privateZeroWrite,true,'private preparation and rejected plan faults are content-zero-write');checks+=2;
    const stock=actual.resourceUnion.stockCandidates,source=stock.itemPlan;
    assert.equal(actual.operation.request_fingerprint,source.financialPlan.operationWithoutResultAndTime.request_fingerprint,
      'actual public request equals private source identity, including explicit deferred tender');checks++;
    assert.equal(actual.operation.initiated_by,owner);assert.equal(actual.operation.idempotency_key,key);checks+=2;
    const canonicalTimes=value=>{
      if(Array.isArray(value))return value.map(canonicalTimes);
      if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,canonicalTimes(v)]));
      return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/u.test(value)
        ?value.replace(/\+00:00$/u,'Z').replace(/(\.\d*?[1-9])0+Z$/u,'$1Z').replace(/\.0+Z$/u,'Z'):value;
    };
    const snapshot={targets:[product,second].map(sku=>{
      const old=actual.before.products.find(p=>p.id===sku),balance=actual.before.balances.find(b=>b.product_id===sku&&b.warehouse_id===warehouse);
      return {productId:sku,warehouseId:warehouse,productName:old.name_ar,warehouseName:actual.before.warehouse.name_ar,
        active:old.is_active,threshold:old.min_stock_level,beforeAvailable:balance?.available_quantity??null,
        afterAvailable:(balance?.available_quantity??0)+specs.filter(s=>s.sku===sku).reduce((n,s)=>n+s.qty,0)};
    }),alerts:actual.before.alerts??[],reads:[],events:actual.beforeEvents.filter(e=>(actual.before.alerts??[])
      .some(a=>e.entity_id===a.id||e.event_key.startsWith('stock_alert:'+a.id+':')))};
    const independentlyExpected=resolveReceiptV2StockCandidateRequirements(sources,migrationSources,transitive,snapshot,
      stock.clock,stock.allocation,actual.beforeEvents);
    assert.deepEqual(canonicalTimes(stock.stages),canonicalTimes(independentlyExpected.stages),
      'multi-source stock expected from separate pre-RPC capture, never effects under test');checks++;
    const bound=bindReceiptV2StockResourceUnion(sources,migrationSources,primary,transitive,kind,source,stock.clock,stock.allocation,actual.beforeEvents);
    for(const field of ['resources','keyRequirements','futureIdentityRequirements']){
      assert.deepEqual(actual.resourceUnion[field],bound[field],'multi-source exact DB union '+field);checks++;
    }
    assert.equal(actual.items.length,3);assert.equal(actual.lines.length,3);assert.equal(actual.movements.length,3);checks+=3;
    for(const [index,l] of lines.entries()){
      const line=actual.lines.find(n=>n.client_line_id===l.client_line_id);assert.ok(line);checks++;
      const item=actual.items.filter(n=>n.commercial_line_id===line.id&&n.product_id===specs[index].sku);
      assert.equal(item.length,1,'per-client/component public item identity');checks++;
      assert.equal(item[0][kind==='DIRECT_V2'?'total_base_units':'received_quantity'],specs[index].qty);checks++;
      assert.equal(item[0].allocated_cost_in_minor_units,specs[index].qty*specs[index].price);checks++;
      const itemField=kind==='DIRECT_V2'?'supplier_receipt_item_id':'purchase_receipt_item_id';
      const movements=actual.movements.filter(m=>m[itemField]===item[0].id);
      assert.equal(movements.length,1,'per-client/component movement bijection');checks++;
      assert.equal(movements[0].product_id,specs[index].sku);assert.equal(movements[0].quantity,specs[index].qty);checks+=2;
      assert.equal(movements[0].warehouse_id,warehouse);assert.equal(movements[0].created_by,owner);checks+=2;
      assert.equal(movements[0].operation_id,actual.result.operation_id);assert.equal(movements[0].reference_id,actual.result.receipt_id);checks+=2;
    }
    for(const sku of [product,second]){
      const expectedQty=specs.filter(s=>s.sku===sku).reduce((n,s)=>n+s.qty,0);
      const expectedCost=specs.filter(s=>s.sku===sku).reduce((n,s)=>n+s.qty*s.price,0);
      const balance=actual.balances.find(n=>n.product_id===sku);assert.ok(balance);checks++;
      assert.equal(balance.available_quantity,expectedQty);checks++;
      const old=actual.before.products.find(n=>n.id===sku);
      const total=actual.before.balances.filter(n=>n.product_id===sku).reduce((n,b)=>n+b.on_hand_quantity,0);
      const scaled=value=>{const [whole,fraction='']=String(value).split('.');
        assert.match(whole,/^\d+$/u);assert.match(fraction,/^\d{0,6}$/u);
        return BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));};
      const numerator=BigInt(total)*scaled(old.wac_cost_in_minor_units_exact)+BigInt(expectedCost)*1000000n;
      const denominator=BigInt(total+expectedQty),expectedWac=(numerator*2n+denominator)/(denominator*2n);
      assert.equal(scaled(actual.products.find(n=>n.id===sku).wac_cost_in_minor_units_exact),expectedWac,
        'WAC expected from pre-RPC all-warehouse balance and distinct source costs');checks++;
      assert.ok(bound.resources.some(n=>n.relation==='public.inventory_balances'&&n.row.warehouse_id===otherWarehouse&&n.row.product_id===sku));checks++;
    }
    assert.ok(bound.resources.some(n=>n.relation==='public.automation_events'&&n.id===eventOwner),'global unrelated key owner');checks++;
    assert.deepEqual(actual.events.find(n=>n.id===eventOwner),actual.beforeEvents.find(n=>n.id===eventOwner));checks++;
    if(!absent){
      assert.equal(actual.events.filter(e=>e.event_key===stock.stages[0].eventKey).length,1,
        'actual public known-alert key reuses unrelated global first owner');checks++;
    }
    if(absent){
      for(const sku of [product,second]){
        const stages=stock.stages.filter(s=>s.productId===sku);assert.equal(stages.length,2);checks++;
        assert.equal(stages[1].before.id,stages[0].after.id);assert.equal(stages[1].after.status,'active');checks+=2;
      }
    }
    assert.equal(await fingerprint(),baseline,'multi-source full durable fixture rollback');checks++;
  }
  for(const role of ['anon','authenticated','service_role'])for(const helper of [
    "derive_receipt_v2_stock_resource_union_v1('DIRECT_V2','{}','{}','{}')",
    "assert_receipt_v2_stock_resource_union_v1('DIRECT_V2','{}','{}','{}')",
  ]){
    await fails(`GRANT USAGE ON SCHEMA phase5_private TO ${role};SET LOCAL ROLE ${role};SELECT phase5_private.${helper};`,
      /42501.*permission denied for function/u);
    assert.equal(await fingerprint(),baseline,'resource helper denial full rollback');checks++;
  }
  passed.push('A1 actual Direct/PO multi-SKU and repeated source occurrences with distinct quantities/costs; absent/existing balances, new-alert-retained and unrelated global-key owner; A2 private DB exact complete resource union, isolated plan faults/content-zero-write, per-item public evidence and pre-RPC all-warehouse WAC anchors, full rollback. No claims/held context/execution');
};

const receiptV2PrewriteRuntime = async (claims) => {
  const supplier=randomUUID(), po=randomUUID(), item=randomUUID(), remaining=randomUUID();
  const line={client_line_id:randomUUID(),line_kind:'base_unit',commercial_quantity:3,base_unit_name:'باكيت',
    gross_amount_in_minor_units:300,line_discount_in_minor_units:0,components:[{product_id:product,base_quantity:3}]};
  const direct={supplier_id:supplier,warehouse_id:warehouse,branch_id:branch,supplier_invoice_number:'  S5-V2-INVOICE  ',
    supplier_invoice_date:null,received_at:null,header_discount_in_minor_units:'1',supplier_freight_in_minor_units:'3',
    legacy_tax_in_minor_units:'17',amount_paid_at_receipt_in_minor_units:'50',payment_method:' Cash ',payment_reference:null,
    notes:' notes ',internal_notes:null,idempotency_key:randomUUID(),lines:[line]};
  const poRequest={purchase_order_id:po,warehouse_id:null,supplier_invoice_number:null,supplier_invoice_date:null,
    received_at:null,header_discount_in_minor_units:'1',supplier_freight_in_minor_units:'3',legacy_tax_in_minor_units:'17',
    amount_paid_at_receipt_in_minor_units:'0',payment_method:'deferred',payment_reference:null,supplier_delivery_note:' delivery ',
    notes:null,idempotency_key:randomUUID(),lines:[{...line,purchase_order_item_id:item}]};
  const outer=await fingerprint();
  const outerContent=receiptV2EventsUpdatesFocused ? await fingerprintContent() : null;
  let primaryFailure;
  await sql(`INSERT INTO public.suppliers(id,company_name,is_active) VALUES(${q(supplier)},'Modern V2 discovery',true);
    INSERT INTO public.purchase_orders(id,purchase_order_number,supplier_id,branch_id,warehouse_id,status,created_by)
      VALUES(${q(po)},'S5-V2-DISCOVERY',${q(supplier)},${q(branch)},${q(warehouse)},'approved',${q(owner)});
    INSERT INTO public.purchase_order_items(id,purchase_order_id,product_id,ordered_quantity,purchase_price_in_minor_units,line_total_in_minor_units,commercial_line_kind)
      VALUES(${q(item)},${q(po)},${q(product)},5,100,500,'base_unit'),(${q(remaining)},${q(po)},${q(product)},2,100,200,'base_unit');`);
  const restoreOwnedFixture = async () => {
    try {
      await sql(`DELETE FROM public.purchase_order_items WHERE purchase_order_id=${q(po)};DELETE FROM public.purchase_orders WHERE id=${q(po)};DELETE FROM public.suppliers WHERE id=${q(supplier)};`);
      // The dedicated catalog-only mode returns inside try; verify its complete
      // fixture restoration here, before that return can finish.
      if(receiptV2InstalledValuesFocused){assert.equal(await fingerprint(),outer,'installed-value-owned-fixture-cleanup-exact-content');checks++;}
    } catch(cleanupFailure) {
      if(outerContent)console.error('Receipt V2 cleanup content diff:',JSON.stringify(
        fingerprintContentDiff(outerContent,await fingerprintContent())));
      throw new AggregateError([primaryFailure,cleanupFailure].filter(Boolean),
        'Receipt V2 verification/cleanup failed; original failure retained',
        {cause:cleanupFailure});
    }
  };
  try {
    const baseline=await fingerprint();
    const discover=(r=direct,kind='DIRECT_V2')=>`phase5_private.discover_receipt_v2_prewrite_v1(${q(kind)},${j(r)})`;
    const assertion=(r=direct,kind='DIRECT_V2',p='plan')=>`SELECT to_jsonb(phase5_private.assert_receipt_v2_prewrite_v1(${q(kind)},${j(r)},${p})) FROM qa_v2_header;`;
    const setup=(r=direct,kind='DIRECT_V2')=>`CREATE TEMP TABLE qa_v2_header AS SELECT ${discover(r,kind)} plan;`;
    const d=await json(`${claims}SELECT ${discover()};`);
    // Independent installed-schema capture, not a permit to consume defaults.
    // All live columns are retained: omitted non-default NULL columns are not lost.
    const primaryRelations=['business_operations','supplier_receipts','supplier_receipt_items','supplier_receipt_commercial_lines',
      'purchase_receipts','purchase_receipt_items','purchase_receipt_commercial_lines','supplier_payments',
      'inventory_balances','inventory_movements','phase2_receipt_wac_snapshots','supplier_financial_invoice_identities','audit_logs'];
    const installed=await json(`SELECT jsonb_agg(jsonb_build_object('relation',c.relname,
      'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
        'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
        'default',pg_get_expr(def.adbin,def.adrelid)) ORDER BY a.attnum)
        FROM pg_attribute a LEFT JOIN pg_attrdef def ON def.adrelid=a.attrelid AND def.adnum=a.attnum
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
      'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,
        'internal',t.tgisinternal,'definition',pg_get_triggerdef(t.oid,true),'function',t.tgfoid::regprocedure::text,
        'body',p.prosrc,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig)
        ORDER BY t.tgname),'[]'::jsonb) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=c.oid))
      ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY(ARRAY[${primaryRelations.map(q).join(',')}]);`);
    assert.deepEqual(installed.map(t=>t.relation),[...primaryRelations].sort());checks++;
    for(const table of installed){
      assert.equal(table.columns.find(c=>c.name==='id')?.type,'uuid',table.relation+' primary UUID type');checks++;
      assert.ok(table.columns.every(c=>c.identity===''),table.relation+' no unmodelled identity columns');checks++;
      assert.deepEqual(table.columns.filter(c=>c.generated!=='').map(c=>[c.name,c.type,c.generated,c.default]),
        table.relation==='inventory_balances'
          ? [['available_quantity','integer','s','(on_hand_quantity - reserved_quantity)']] : [],
        table.relation+' exact source-defined generated column set');checks++;
      const captured=d.receiptCatalog.defaults.filter(c=>c.relation===table.relation||c.relation==='public.'+table.relation)
        .map(c=>[c.column,c.expression]);
      assert.deepEqual(captured,table.columns.filter(c=>c.default!==null).map(c=>[c.name,c.default]),
        table.relation+' independently complete installed default capture');checks++;
    }
    const movementSchema=installed.find(t=>t.relation==='inventory_movements');
    assert.equal(movementSchema.columns.find(c=>c.name==='mutation_sequence').default,null);checks++;
    const seqTrigger=movementSchema.triggers.find(t=>t.name==='trg_assign_inventory_movement_mutation_sequence');
    assert.ok(seqTrigger&&!seqTrigger.internal&&seqTrigger.enabled==='O');checks++;
    assert.match(seqTrigger.definition,/BEFORE INSERT ON inventory_movements/u);checks++;
    assert.match(seqTrigger.body,/IF NEW\.mutation_sequence IS NULL THEN\s+NEW\.mutation_sequence := NEXTVAL\('public\.inventory_movement_mutation_seq'\)/u);checks++;
    assert.equal(seqTrigger.owner,'postgres');assert.equal(seqTrigger.definer,true);checks+=2;
    const stockSchema=installed.find(t=>t.relation==='inventory_balances');
    assert.ok(stockSchema.triggers.some(t=>t.name==='trg_sync_stock_alert_from_balance'&&!t.internal&&t.enabled==='O'));checks++;
    const paymentSchema=installed.find(t=>t.relation==='supplier_payments');
    assert.ok(paymentSchema.triggers.some(t=>t.name==='trg_supplier_payment_open_shift'&&!t.internal&&t.enabled==='O'));checks++;
    const migrationSources=new Map(await Promise.all((await readdir(path.join(root,'supabase/migrations')))
      .filter(n=>/^\d{3}_/u.test(n)&&Number(n.slice(0,3))<=127).sort()
      .map(async name=>[name,(await readFile(path.join(root,'supabase/migrations',name),'utf8')).replace(/\r\n?/gu,'\n')])));
    const sourceFunctions=functionEvents([...migrationSources].map(([filename,source])=>({filename,source}))).state;
    const valueRequirements=inspectReceiptV2InstalledValueRequirements(sourceFunctions,migrationSources,installed);
    assert.equal(valueRequirements.writes.length,17);checks++;
    for(const write of valueRequirements.writes){
      const table=installed.find(t=>'public.'+t.relation===write.relation);
      assert.deepEqual(write.columns.map(c=>c.name),table.columns.map(c=>c.name),write.relation+' every installed column per source occurrence');checks++;
      assert.ok(write.columns.every(c=>!c.valueAllocated&&!c.ownershipQualified));checks++;
    }
    const balanceValues=valueRequirements.writes.find(w=>w.relation==='public.inventory_balances').columns;
    assert.equal(balanceValues.find(c=>c.name==='available_quantity').domain,'GENERATED_AVAILABLE_QUANTITY');checks++;
    assert.equal(balanceValues.find(c=>c.name==='id').domain,'OMITTED_UUID_REQUIRES_SERVER_ALLOCATION_AND_CLAIM');checks++;
    const movementValues=valueRequirements.writes.find(w=>w.relation==='public.inventory_movements').columns;
    assert.equal(movementValues.find(c=>c.name==='mutation_sequence').domain,'ACTUAL_NULL_ONLY_BEFORE_INSERT_SEQUENCE');checks++;
    for(const flag of ['defaultsEvaluated','sequenceConsumed','fullWriteTuplesQualified','triggerEffectsQualified','durableIdentityClaimed','locksHeld','executionAuthority']){
      assert.equal(valueRequirements[flag],false);checks++;
    }
    for(const [name,column] of [
      ['unknown-default',{name:'qa_unknown_default',type:'integer',notNull:true,identity:'',generated:'',default:'unreviewed_function()'}],
      ['required-omission',{name:'qa_required_omission',type:'integer',notNull:true,identity:'',generated:'',default:null}],
      ['wrong-generated',{name:'qa_wrong_generated',type:'integer',notNull:false,identity:'',generated:'s',default:'1'}],
      ['wrong-time-type',{name:'qa_wrong_time',type:'integer',notNull:true,identity:'',generated:'',default:'now()'}],
    ]){
      const corrupted=structuredClone(installed);corrupted.find(t=>t.relation==='inventory_balances').columns.push(column);
      assert.throws(()=>inspectReceiptV2InstalledValueRequirements(sourceFunctions,migrationSources,corrupted),/ADMISSION_RECEIPT_V2_/u,name);checks++;
    }
    assert.equal(await fingerprint(),baseline,'installed-value-classification-never-evaluates-defaults-or-writes');checks++;
    if(receiptV2LiteralValuesFocused){
      // Never interpolate arbitrary pg_attrdef text. The independent pure codec
      // must accept it first; only its bounded inert literal grammar is sent to
      // PostgreSQL for equivalence, in a rollback-only transaction.
      const literals=new Map();
      for(const write of valueRequirements.writes)for(const column of write.columns)
        if(column.domain==='OMITTED_LITERAL_DEFAULT_REQUIRES_TYPED_VALUE_PROOF'){
          const key=write.relation+'|'+column.name;
          const observed={relation:write.relation,column:column.name,type:column.type,notNull:column.notNull,expression:column.default};
          if(literals.has(key))assert.deepEqual(literals.get(key),observed,'same identity must agree across INSERT occurrences');
          literals.set(key,observed);
        }
      assert.ok(literals.size>0,'actual omitted literal defaults must be present');checks++;
      const literalPins=inspectReceiptV2LiteralSourcePins(migrationSources,[...literals.values()]);
      assert.equal(literalPins.pins.length,3);checks++;
      for(const corrupt of [
        rows=>{rows[1]={...rows[0]};},rows=>{rows.pop();},rows=>{rows.push({...rows[0]});},
        rows=>{rows[0].expression=rows[0].expression==='true'?'false':'true';},rows=>{rows[0].notNull=false;},
        rows=>{rows[0].type='integer';},rows=>{rows[0].column='unrelated';},
      ]){
        const rows=structuredClone([...literals.values()]);corrupt(rows);
        assert.throws(()=>inspectReceiptV2LiteralSourcePins(migrationSources,rows),/LITERAL_EXACT_SET_INVALID/u);checks++;
      }
      const synthetic=[
        ['9223372036854775807','bigint'],['-9223372036854775808','bigint'],
        ['0.000001','numeric(20,6)'],['true','boolean'],['false','boolean'],
        ["'owner''s'::text",'text'],["'عربي'::text",'text'],["'{}'::jsonb",'jsonb'],["'[]'::jsonb",'jsonb'],
      ].map(([expression,type],index)=>({relation:'SYNTHETIC',column:String(index),type,expression}));
      for(const literal of [...literals.values(),...synthetic]){
        const decoded=decodeReceiptV2LiteralRequirement(literal.expression,literal.type);
        const numeric=['EXACT_INTEGER_TEXT','EXACT_DECIMAL_TEXT'].includes(decoded.encoding);
        const actual=await json(`BEGIN;SELECT to_jsonb((${literal.expression})${numeric?'::text':''});ROLLBACK;`);
        assert.deepEqual(actual,decoded.value,literal.relation+'.'+literal.column+' PostgreSQL bounded literal equivalence');checks++;
      }
      for(const [expression,type] of [['now()','timestamp with time zone'],['gen_random_uuid()','uuid'],
        ["nextval('public.supplier_receipt_seq')",'bigint'],["'x'::text; SELECT 1",'text'],
        ['9223372036854775808','bigint'],["'{\"n\":9007199254740993}'::jsonb",'jsonb']]){
        assert.throws(()=>decodeReceiptV2LiteralRequirement(expression,type),/ADMISSION_RECEIPT_V2_LITERAL_/u);checks++;
      }
      assert.equal(await fingerprint(),baseline,'literal-equivalence-never-mutates-durable-content');checks++;
      passed.push(`bounded literal PostgreSQL equivalence: ${literals.size} actual omitted-default identities independently pinned to historical DDL/content; equal-count substitution/missing/extra/type/default/nullability drift rejects; nine synthetic precision/type controls; complete tuple ownership remains OPEN`);
    }
    if(receiptV2RowRequirementsFocused){
      const rows=inspectReceiptV2RowRequirements(sourceFunctions,migrationSources,installed);
      assert.equal(rows.writes.length,17);checks++;
      assert.equal(new Set(rows.writes.map(w=>w.identity)).size,17);checks++;
      for(const row of rows.writes){
        const table=installed.find(t=>'public.'+t.relation===row.relation);
        assert.deepEqual(row.columns.map(c=>c.name),table.columns.map(c=>c.name),'complete primary INSERT requirements '+row.identity);checks++;
        const body=sourceFunctions.get(row.signature).body;
        for(const column of row.columns)if(column.domain==='EXPLICIT_SOURCE_VALUE'){
          const binding=column.sourceBinding;
          assert.equal(body.slice(binding.offset,binding.offset+binding.expression.length),binding.expression);
          assert.equal(binding.column,column.name);
        }
        checks++;
      }
      const allColumns=rows.writes.flatMap(w=>w.columns);
      for(const requirement of ['EXPLICIT_SQL_NULL','OMITTED_SQL_NULL','HISTORICAL_TYPED_LITERAL',
        'SERVER_GENERATED_FROM_EXACT_ROW','ACTUAL_SERVER_UUID_AND_DURABLE_CLAIM_REQUIRED',
        'ACTUAL_TRANSACTION_TIMESTAMP','CAPTURED_RECEIVED_AT_OR_ACTUAL_TRANSACTION_TIMESTAMP',
        'ACTUAL_SOURCE_KIND_RECEIPT_NUMBER','ACTUAL_MOVEMENT_RETURNING_SEQUENCE',
        'NULL_BEFORE_TRIGGER_ACTUAL_SEQUENCE_AFTER_INSERT']){
        assert.ok(allColumns.some(c=>c.requirement===requirement),requirement);checks++;
      }
      for(const column of allColumns){
        if(['EXPLICIT_SQL_NULL','OMITTED_SQL_NULL'].includes(column.requirement))assert.equal(column.value,null);
        if(column.requirement.includes('ACTUAL')||column.requirement==='PINNED_SOURCE_EXPRESSION_NOT_EVALUATED')
          assert.ok(!Object.hasOwn(column,'value'),'no invented event/source value');
      }checks++;
      assert.equal(assertReceiptV2RowRequirements(sourceFunctions,migrationSources,installed,rows),true);checks++;
      for(const corrupt of [
        r=>{r.writes[1]=structuredClone(r.writes[0]);},r=>{r.writes.pop();},
        r=>{r.writes.push(structuredClone(r.writes[0]));},r=>{r.executionAuthority=true;},
        r=>{r.writes[0].columns[0].value='invented event';},
        r=>{r.writes[0].columns.find(c=>c.domain==='EXPLICIT_SOURCE_VALUE').sourceBinding.expression='other_source';},
        r=>{r.writes[0].columns.reverse();},
        r=>{r.writes.flatMap(w=>w.columns).find(c=>c.requirement==='HISTORICAL_TYPED_LITERAL').value='wrong';},
        r=>{r.writes.flatMap(w=>w.columns).find(c=>c.requirement==='NULL_BEFORE_TRIGGER_ACTUAL_SEQUENCE_AFTER_INSERT').beforeInsertValue=99;},
        r=>{r.writes.flatMap(w=>w.columns).find(c=>c.requirement==='SERVER_GENERATED_FROM_EXACT_ROW').inputs.reverse();},
      ]){
        const changed=structuredClone(rows);corrupt(changed);
        assert.throws(()=>assertReceiptV2RowRequirements(sourceFunctions,migrationSources,installed,changed),/ROW_REQUIREMENTS_CHANGED/u);checks++;
      }
      for(const flag of ['sourceExpressionsEvaluated','defaultsEvaluated','actualEventValuesAllocated','fullWriteTuplesQualified',
        'triggerEffectsQualified','durableIdentityClaimed','locksHeld','executionAuthority']){
        assert.equal(rows[flag],false);checks++;
      }
      assert.equal(await fingerprint(),baseline,'complete-row-requirements-no-durable-mutation');checks++;
      passed.push('seventeen exact source INSERT occurrences bind every installed primary column to its original VALUES expression, historical literal, explicit/omitted NULL, generated dependencies or unfilled actual runtime/claim requirement; source/identity/value/sequence/authority substitutions reject; NOT materialized tuples or execution authority');
    }
    if(receiptV2ItemBindingsFocused){
      const scenarios=[{kind:'DIRECT_V2',paidPo:false},{kind:'PO_V2',paidPo:false},
        ...(receiptV2EventsUpdatesFocused?[{kind:'PO_V2',paidPo:true}]:[])];
      for(const {kind,paidPo} of scenarios){
        const baseRequest=kind==='DIRECT_V2'?{...direct,lines:[line,{...line,client_line_id:randomUUID()}]}
          :{...poRequest,lines:poRequest.lines.flatMap(n=>[n,{...n,client_line_id:randomUUID(),purchase_order_item_id:remaining}]).map(n=>({...n,
            commercial_quantity:2,gross_amount_in_minor_units:200,components:[{product_id:product,base_quantity:2}]}))};
        const request=paidPo?{...baseRequest,supplier_invoice_number:' S5-PO-PAYMENT ',amount_paid_at_receipt_in_minor_units:'50',
          payment_method:'cash',received_at:'2001-02-03T04:05:06+03:00',lines:baseRequest.lines.map((n,index)=>index===0
            ?{...n,commercial_quantity:5,gross_amount_in_minor_units:500,components:[{product_id:product,base_quantity:5}]}:n)}:baseRequest;
        const minted=await json(`${claims}SELECT phase5_private.allocate_receipt_v2_future_uuids_v1(${q(kind)},${j(request)});`);
        const derive=`phase5_private.derive_receipt_v2_item_rows_v1(${q(kind)},${j(request)},${j(minted.allocation)})`;
        const setup=`CREATE TEMP TABLE qa_v2_binding_source AS SELECT ${derive} plan;`;
        const sourceAssert=p=>`phase5_private.assert_receipt_v2_item_rows_v1(${q(kind)},${j(request)},${j(minted.allocation)},${p})`;
        // PostgreSQL freshly rederives request/allocation/source truth BEFORE
        // the analysis bridge reads a plan. Shape is never that assertion.
        const proved=await json(`BEGIN;${claims}${setup}SELECT jsonb_build_object('plan',plan,'asserted',${sourceAssert('plan')}) FROM qa_v2_binding_source;ROLLBACK;`);
        assert.equal(proved.asserted,true);checks++;
        const projected=proved.plan;
        const bound=bindReceiptV2ItemProjectionRequirements(sourceFunctions,migrationSources,installed,kind,projected);
        assert.equal(assertReceiptV2ItemProjectionRequirements(sourceFunctions,migrationSources,installed,kind,projected,bound),true);checks++;
        assert.equal(bound.items.length,2);assert.equal(bound.commercialLines.length,2);checks+=2;
        assert.notEqual(bound.items[0].identity,bound.items[1].identity);checks++;
        for(const row of [...bound.items,...bound.commercialLines]){
          const table=installed.find(t=>'public.'+t.relation===row.relation);
          assert.deepEqual(row.columns.map(c=>c.name),table.columns.map(c=>c.name),'bound complete installed item/line columns');checks++;
          assert.ok(row.columns.filter(c=>c.requirement==='BOUND_SOURCE_PROJECTION_VALUE')
            .every(c=>c.projectionValidationRequired&&!c.typedValueFullyQualified));checks++;
        }
        assert.ok(bound.commercialLines.every(r=>r.columns.find(c=>c.name==='finalized_at').requirement==='ACTUAL_TRANSACTION_TIMESTAMP'));checks++;
        for(const corrupt of [
          p=>{p.items[1]=structuredClone(p.items[0]);},p=>{p.items.pop();},p=>{p.items.push(structuredClone(p.items[0]));},
          p=>{p.commercialLines[1]=structuredClone(p.commercialLines[0]);},
          p=>{p.items[0].explicitRow.commercial_line_id=p.items[1].explicitRow.commercial_line_id;},
          p=>{p.items[0].explicitRow.operation_id=p.items[0].explicitRow.id;},
          p=>{p.items[0].explicitRow.product_id=p.items[0].explicitRow.id;},
          p=>{p.items[0].explicitRow.finalized_at='invented';},p=>{p.executionAuthority=true;},
        ]){
          const wrong=structuredClone(projected);corrupt(wrong);
          assert.throws(()=>bindReceiptV2ItemProjectionRequirements(sourceFunctions,migrationSources,installed,kind,wrong),/ITEM_PROJECTION_INVALID/u);checks++;
        }
        for(const corruption of [
          "jsonb_set(plan,'{items,1}',plan->'items'->0)",
          "jsonb_set(plan,'{items}',(plan->'items')-0)",
          "jsonb_set(plan,'{items}',(plan->'items')||jsonb_build_array(plan->'items'->0))",
          "jsonb_set(plan,'{items,0,explicitRow,commercial_line_id}',plan#>'{items,1,explicitRow,commercial_line_id}')",
          "jsonb_set(plan,'{items,0,explicitRow,allocated_cost_in_minor_units}','999')",
          "jsonb_set(plan,'{executionAuthority}','true')",
        ]){
          await fails(`${claims}${setup}SELECT ${sourceAssert(corruption)} FROM qa_v2_binding_source;`,/40001.*PHASE5_RECEIPT_V2_ITEM_ROWS_CHANGED_RETRY/u);
          assert.equal(await fingerprint(),baseline,'DB source revalidation corruption zero-write');checks++;
        }
        const call=kind==='DIRECT_V2'?`public.create_direct_supplier_receipt_v2(
          p_supplier_id:=${q(supplier)},p_warehouse_id:=${q(warehouse)},p_branch_id:=${q(branch)},
          p_supplier_invoice_number:=${q(request.supplier_invoice_number)},p_header_discount_in_minor_units:=1,
          p_supplier_freight_in_minor_units:=3,p_legacy_tax_in_minor_units:=17,p_amount_paid_at_receipt_in_minor_units:=50,
          p_payment_method:='cash',p_notes:=' notes ',p_idempotency_key:=${q(request.idempotency_key)},p_lines:=${j(request.lines)})`
          :`public.receive_purchase_order_v2(p_purchase_order_id:=${q(po)},p_header_discount_in_minor_units:=1,
            p_supplier_freight_in_minor_units:=3,p_legacy_tax_in_minor_units:=17,p_payment_method:=${q(request.payment_method)},
            p_amount_paid_at_receipt_in_minor_units:=${q(request.amount_paid_at_receipt_in_minor_units)}::bigint,
            p_supplier_invoice_number:=${request.supplier_invoice_number===null?'NULL':q(request.supplier_invoice_number)},
            p_received_at:=${request.received_at===null?'NULL':q(request.received_at)+'::timestamptz'},
            p_supplier_delivery_note:=' delivery ',p_idempotency_key:=${q(request.idempotency_key)},p_lines:=${j(request.lines)})`;
        const lt=kind==='DIRECT_V2'?'supplier_receipt_commercial_lines':'purchase_receipt_commercial_lines';
        const it=kind==='DIRECT_V2'?'supplier_receipt_items':'purchase_receipt_items';
        const receiptField=kind==='DIRECT_V2'?'supplier_receipt_id':'purchase_receipt_id';
        const actual=await json(`BEGIN;${claims}CREATE TEMP TABLE qa_v2_binding_public AS SELECT ${call} result;
          SELECT jsonb_build_object('lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.line_sequence)
            FROM public.${lt} l WHERE l.${receiptField}=(SELECT (result->>'receipt_id')::uuid FROM qa_v2_binding_public)),
            'items',(SELECT jsonb_agg(jsonb_build_object('identity',l.client_line_id::text||'|'||i.product_id::text,'row',to_jsonb(i)) ORDER BY l.line_sequence,i.product_id)
              FROM public.${it} i JOIN public.${lt} l ON l.id=i.commercial_line_id AND l.operation_id=i.operation_id AND l.${receiptField}=i.${receiptField}
              WHERE i.operation_id=(SELECT (result->>'operation_id')::uuid FROM qa_v2_binding_public)));ROLLBACK;`);
        assert.equal(actual.items.length,bound.items.length);assert.equal(actual.lines.length,bound.commercialLines.length);checks+=2;
        for(const [rows,actualRows] of [[bound.commercialLines,actual.lines.map(r=>({identity:r.client_line_id,row:r}))],[bound.items,actual.items]])
          for(const row of rows){
            const found=actualRows.find(r=>r.identity===row.identity);assert.ok(found);checks++;
            for(const c of row.columns){
              if(c.requirement==='BOUND_SOURCE_PROJECTION_VALUE'&&!['id','operation_id',receiptField,'commercial_line_id'].includes(c.name)){
                assert.deepEqual(found.row[c.name],c.value,kind+' independently keyed actual RPC scalar '+c.name);checks++;
              }else if(c.requirement==='OMITTED_SQL_NULL'){
                assert.equal(found.row[c.name],null,'actual RPC nullable omission '+c.name);checks++;
              }
            }
          }
        assert.equal(await fingerprint(),baseline,'bound row public RPC scalar parity exact rollback');checks++;
        for(const flag of ['sourcePlanValidatedByThisAnalysis','actualEventValuesAllocated','fullWriteTuplesQualified',
          'triggerEffectsQualified','durableIdentityClaimed','locksHeld','executionAuthority']){
          assert.equal(bound[flag],false);checks++;
        }
        if(receiptV2PrimaryBindingsFocused){
          const primary=bindReceiptV2PrimaryProjectionRequirements(sourceFunctions,migrationSources,installed,kind,projected);
          assert.equal(assertReceiptV2PrimaryProjectionRequirements(sourceFunctions,migrationSources,installed,kind,projected,primary),true);checks++;
          const primaryRows=[primary.operation,primary.header,primary.invoice,primary.payment,primary.audit,...primary.movements,...primary.wac].filter(Boolean);
          for(const row of primaryRows){
            assert.deepEqual(row.columns.map(c=>c.name),installed.find(t=>'public.'+t.relation===row.relation).columns.map(c=>c.name));checks++;
            if(row.candidateIdentity){assert.equal(row.candidateIdentity.durableClaimed,false);
              assert.equal(row.columns.find(c=>c.name==='id').requirement,'ACTUAL_SERVER_UUID_AND_DURABLE_CLAIM_REQUIRED');checks+=2;}
          }
          assert.equal(primary.movements.length,2);assert.equal(primary.wac.length,1);checks+=2;
          assert.equal(primary.invoice===null,request.supplier_invoice_number===null);
          assert.equal(primary.payment===null,request.amount_paid_at_receipt_in_minor_units==='0');checks+=2;
          for(const corruption of [
            "jsonb_set(plan,'{financialPlan,headerWithoutEventValues,total_in_minor_units}','999')",
            "jsonb_set(plan,'{financialPlan,operationWithoutResultAndTime,request_fingerprint}','\"forged\"')",
            "jsonb_set(plan,'{financialPlan,auditWithoutEventValues,detailsWithoutReceiptNumberAndWac,inventory_acquisition_cost_in_minor_units}','999')",
            "jsonb_set(plan,'{financialPlan,inventoryPlan,movements,1}',plan#>'{financialPlan,inventoryPlan,movements,0}')",
            "jsonb_set(plan,'{financialPlan,inventoryPlan,wacRows,0,explicitRow,resulting_exact_wac_in_minor_units}','999')",
          ]){
            await fails(`${claims}${setup}SELECT ${sourceAssert(corruption)} FROM qa_v2_binding_source;`,/40001.*PHASE5_RECEIPT_V2_ITEM_ROWS_CHANGED_RETRY/u);
            assert.equal(await fingerprint(),baseline,'primary DB source corruption zero-write');checks++;
          }
          const receiptTable=kind==='DIRECT_V2'?'supplier_receipts':'purchase_receipts';
          const physicalFk=kind==='DIRECT_V2'?'supplier_receipt_item_id':'purchase_receipt_item_id';
          const actualPrimary=await json(`BEGIN;${claims}SET LOCAL TIME ZONE 'UTC';
            CREATE TEMP TABLE qa_v2_primary_clock AS SELECT NOW() tx_time,
              COALESCE(${request.received_at===null?'NULL::timestamptz':q(request.received_at)+'::timestamptz'},NOW()) received_time,
              TO_CHAR(NOW(),'YYYY') number_year,
              (SELECT last_value::text FROM public.supplier_receipt_seq) direct_sequence_before,
              (SELECT is_called FROM public.supplier_receipt_seq) direct_sequence_called;
            CREATE TEMP TABLE qa_v2_primary_public AS SELECT ${call} result;
            SELECT jsonb_build_object('result',b.result,'operation',to_jsonb(o),'header',to_jsonb(h),
              'events',(SELECT jsonb_build_object('transactionTime',tx_time,'receivedTime',received_time,'numberYear',number_year,
                'directBefore',direct_sequence_before,'directCalled',direct_sequence_called,
                'directAfter',(SELECT last_value::text FROM public.supplier_receipt_seq)) FROM qa_v2_primary_clock),
              'patches',jsonb_build_object('balances',(SELECT jsonb_agg(to_jsonb(n) ORDER BY product_id)
                  FROM public.inventory_balances n WHERE n.warehouse_id=${q(warehouse)} AND n.product_id=${q(product)}),
                'products',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.products n WHERE id=${q(product)}),
                'supplier',(SELECT to_jsonb(n) FROM public.suppliers n WHERE id=${q(supplier)}),
                'poItems',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.purchase_order_items n WHERE id=ANY(ARRAY[${q(item)},${q(remaining)}]::uuid[])),
                'po',(SELECT to_jsonb(n) FROM public.purchase_orders n WHERE id=${q(po)})),
              'invoice',(SELECT to_jsonb(n) FROM public.supplier_financial_invoice_identities n WHERE n.operation_id=o.id),
              'payment',(SELECT to_jsonb(p) FROM public.supplier_payments p WHERE p.operation_id=o.id),
              'audit',(SELECT to_jsonb(a) FROM public.audit_logs a WHERE a.entity_id=h.id AND a.action=${q(projected.financialPlan.auditWithoutEventValues.action)}),
              'movements',(SELECT jsonb_agg(jsonb_build_object('identity',l.client_line_id::text||'|'||m.product_id::text,'row',to_jsonb(m)) ORDER BY m.product_id,l.client_line_id)
                FROM public.inventory_movements m JOIN public.${it} i ON i.id=m.${physicalFk} AND i.operation_id=m.operation_id
                JOIN public.${lt} l ON l.id=i.commercial_line_id AND l.operation_id=i.operation_id WHERE m.operation_id=o.id),
              'wac',(SELECT jsonb_agg(jsonb_build_object('identity',w.product_id::text,'row',to_jsonb(w)) ORDER BY w.product_id)
                FROM public.phase2_receipt_wac_snapshots w WHERE w.operation_id=o.id))
            FROM qa_v2_primary_public b JOIN public.business_operations o ON o.id=(b.result->>'operation_id')::uuid
            JOIN public.${receiptTable} h ON h.id=(b.result->>'receipt_id')::uuid AND h.operation_id=o.id;ROLLBACK;`);
          const single=new Map([['OPERATION',actualPrimary.operation],['HEADER',actualPrimary.header],
            ['INVOICE',actualPrimary.invoice],['PAYMENT',actualPrimary.payment],['AUDIT',actualPrimary.audit]]);
          const regenerated=new Set(['id','operation_id',receiptField,'entity_id','reference_id',physicalFk,'commercial_line_id']);
          for(const row of primaryRows){
            const live=single.get(row.identity)??[...actualPrimary.movements,...actualPrimary.wac].find(r=>r.identity===row.identity)?.row;
            assert.ok(live,'actual primary row independently keyed '+row.identity);checks++;
            for(const c of row.columns){
              if(c.requirement==='BOUND_SOURCE_PROJECTION_VALUE'&&!regenerated.has(c.name)){
                assert.deepEqual(live[c.name],c.value,kind+' actual primary scalar '+row.identity+' '+c.name);checks++;
              }else if(c.requirement==='HISTORICAL_TYPED_LITERAL'){
                assert.deepEqual(live[c.name],c.value,'actual primary historical literal '+c.name);checks++;
              }
            }
          }
          assert.deepEqual(actualPrimary.operation.result_snapshot,actualPrimary.result,'actual stored result equals actual RPC result');checks++;
          for(const [name,value] of Object.entries(primary.deferredCompositeProjections.resultWithoutReceiptNumber))
            if(!['operation_id','receipt_id'].includes(name)){assert.deepEqual(actualPrimary.result[name],value);checks++;}
          for(const [name,value] of Object.entries(primary.deferredCompositeProjections.auditDetailsWithoutReceiptNumberAndWac))
            if(name!=='operation_id'){assert.deepEqual(actualPrimary.audit.details[name],value);checks++;}
          assert.equal(actualPrimary.audit.details.operation_id,actualPrimary.operation.id);checks++;
          assert.equal(actualPrimary.header.operation_id,actualPrimary.operation.id);checks++;
          assert.ok(actualPrimary.movements.every(r=>r.row.reference_id===actualPrimary.header.id&&r.row.operation_id===actualPrimary.operation.id));checks++;
          assert.ok(actualPrimary.wac.every(r=>r.row[receiptField]===actualPrimary.header.id&&r.row.operation_id===actualPrimary.operation.id));checks++;
          assert.equal(await fingerprint(),baseline,'primary public RPC exact content rollback');checks++;
          for(const flag of ['defaultOwnershipQualified','actualNumberAndSequenceQualified','balanceAndUpdatePatchBindingsComplete',
            'sourcePlanValidatedByThisAnalysis','fullWriteTuplesQualified','executionAuthority']){assert.equal(primary[flag],false);checks++;}
          if(receiptV2EventsUpdatesFocused){
            const updates=bindReceiptV2UpdateProjectionRequirements(sourceFunctions,migrationSources,installed,kind,projected);
            assert.equal(assertReceiptV2UpdateProjectionRequirements(sourceFunctions,migrationSources,installed,kind,projected,updates),true);checks++;
            assert.equal(inspectReceiptV2UpdateRequirements(sourceFunctions,migrationSources).writes.length,6);checks++;
            const patchGroups=[[updates.balances,actualPrimary.patches.balances],[updates.productPatches,actualPrimary.patches.products],
              [[updates.supplierPatch],[actualPrimary.patches.supplier]],[updates.poItems,actualPrimary.patches.poItems],
              [updates.poHeader?[updates.poHeader]:[],[actualPrimary.patches.po]]];
            for(const [expectedRows,liveRows] of patchGroups)for(const expected of expectedRows){
              const live=liveRows.find(n=>expected.relation==='public.inventory_balances'
                ?expected.identity===n.product_id+'|'+n.warehouse_id:expected.identity===n.id);
              assert.ok(live,'actual source-specific UPDATE identity');checks++;
              for(const a of expected.assignments)if(a.requirement==='BOUND_SOURCE_UPDATE_PROJECTION'){
                assert.deepEqual(live[a.column],a.value,'actual UPDATE value '+expected.relation+'.'+a.column);checks++;
              }
              assert.equal(live.updated_at,actualPrimary.events.transactionTime,'UPDATE time is actual transaction time');checks++;
              if(expected.relation==='public.inventory_balances')for(const key of ['on_hand_quantity','reserved_quantity','available_quantity']){
                assert.equal(live[key],expected.afterProjection[key],'exact balance/generated final projection');checks++;
              }
              if(expected.relation==='public.purchase_orders'){
                assert.equal(live.received_at,expected.prospectiveCompleted?actualPrimary.events.transactionTime:expected.priorReceivedAt);checks++;
              }
            }
            for(const corruption of [
              "jsonb_set(plan,'{financialPlan,inventoryPlan,balancePlan,rows,0,afterWithoutEventTime,on_hand_quantity}','999')",
              "jsonb_set(plan,'{financialPlan,inventoryPlan,productPatches,0,patchWithoutEventTime,cost_price_in_minor_units}','999')",
              "jsonb_set(plan,'{financialPlan,supplierPatchWithoutEventTime,patchWithoutEventTime,current_balance_in_minor_units}','999')",
              ...(kind==='PO_V2'?["jsonb_set(plan,'{purchaseOrderItemPatches,1}',plan->'purchaseOrderItemPatches'->0)"]:[]),
            ]){
              await fails(`${claims}${setup}SELECT ${sourceAssert(corruption)} FROM qa_v2_binding_source;`,/40001.*PHASE5_RECEIPT_V2_ITEM_ROWS_CHANGED_RETRY/u);
              assert.equal(await fingerprint(),baseline,'UPDATE source corruption rejects zero-write');checks++;
            }
            assert.equal(actualPrimary.header.received_at,actualPrimary.events.receivedTime);checks++;
            assert.equal(actualPrimary.header.phase2_finalized_at,actualPrimary.events.transactionTime);checks++;
            assert.equal(actualPrimary.operation.completed_at,actualPrimary.events.transactionTime);checks++;
            if(actualPrimary.payment){
              assert.equal(actualPrimary.payment.payment_date,actualPrimary.events.receivedTime);checks++;
              assert.equal(actualPrimary.payment.notes,'دفعة عند استلام السند '+actualPrimary.header.receipt_number);checks++;
              assert.ok(actualPrimary.payment.cash_shift_id);checks++;
            }
            if(paidPo){assert.notEqual(actualPrimary.events.receivedTime,actualPrimary.events.transactionTime);checks++;}
            const number=actualPrimary.header.receipt_number;
            assert.equal(actualPrimary.result.receipt_number,number);assert.equal(actualPrimary.audit.details.receipt_number,number);checks+=2;
            assert.match(number,new RegExp('^GRN-'+actualPrimary.events.numberYear+'-\\d{6}$','u'));checks++;
            if(kind==='DIRECT_V2'){
              const allocated=BigInt(actualPrimary.events.directBefore)+(actualPrimary.events.directCalled?1n:0n);
              assert.equal(actualPrimary.events.directAfter,allocated.toString());checks++;
              assert.equal(number,'GRN-'+actualPrimary.events.numberYear+'-'+allocated.toString().padStart(6,'0'));checks++;
            }else {
              assert.equal(actualPrimary.events.directAfter,actualPrimary.events.directBefore,'PO random number never consumes Direct sequence');checks++;
              assert.ok(!projected.financialPlan.inventoryPlan.balancePlan.candidates.requirements.prewrite.absenceObservations.poNumbers
                .some(n=>n.number===number),'PO number absent in independently captured prewrite rows');checks++;
            }
            const sorted=actualPrimary.movements.toSorted((a,b)=>a.row.product_id.localeCompare(b.row.product_id)||a.identity.localeCompare(b.identity));
            for(const movement of sorted){
              assert.equal(movement.row.notes,(kind==='DIRECT_V2'?'استلام مورد Phase 2 - ':'استلام أمر شراء Phase 2 - ')+number);checks++;
              assert.equal(movement.row.created_at,actualPrimary.events.transactionTime);checks++;
              assert.ok(Number.isSafeInteger(movement.row.mutation_sequence)&&movement.row.mutation_sequence>0);checks++;
            }
            for(const wac of actualPrimary.wac){
              const group=sorted.filter(m=>m.row.product_id===wac.identity);
              assert.ok(group.length>0);checks++;
              for(let n=1;n<group.length;n++){assert.ok(group[n].row.mutation_sequence>group[n-1].row.mutation_sequence);checks++;}
              assert.equal(wac.row.receipt_movement_sequence_max,group.at(-1).row.mutation_sequence,'actual last ordered INSERT RETURNING sequence, not invented');checks++;
            }
            assert.equal(await fingerprint(),baseline,'event/patch public runtime exact rollback');checks++;
            for(const flag of ['actualEventValuesAllocated','sourcePlanValidatedByThisAnalysis','triggerEffectsQualified','defaultOwnershipQualified','executionAuthority']){
              assert.equal(updates[flag],false);checks++;
            }
          }
        }
      }
      passed.push('Direct/PO two-client same-SKU line/item bijection and complete column bindings; fresh PostgreSQL source assertions BEFORE bridge; per-identity unchanged public RPC scalar/NULL parity and rollback; missing/extra/duplicate/foreign/cost/authority faults reject; event/default/claim authority remains OPEN');
      if(receiptV2PrimaryBindingsFocused)passed.push('primary financial/inventory source bindings and actual public RPC scalar/literal/partial-composite parity; default UUID ownership and event values are not materialized');
      if(receiptV2EventsUpdatesFocused)passed.push('six pinned primary UPDATE source occurrences and exact per-identity patch parity; Direct/PO actual transaction/received time, source-kind number and ordered movement RETURNING linkage; paid/invoiced complete PO with explicit past received-at; all business effects rollback, ownership/execution OPEN');
    }
    if(receiptV2InstalledValuesFocused){
      passed.push('installed thirteen-primary-relation column/default/generated catalog and pinned seventeen INSERT occurrences classified per column; unknown default/required omission/generated/time-type faults reject; no default/sequence allocation, tuple ownership or execution qualification');
      return;
    }
    assert.equal(await fingerprint(),baseline);checks++;
    assert.equal(d.mode,'NEW_REQUEST_DISCOVERED');assert.equal(d.effectiveSupplierId,supplier);assert.equal(d.effectiveWarehouseId,warehouse);checks+=3;
    assert.deepEqual(d.keyGates,[`supplier_receipt:${direct.idempotency_key}`]);checks++;
    assert.equal(d.invoiceGate,`supplier_invoice:${supplier}:s5-v2-invoice`);checks++;
    assert.equal(d.paymentShiftRows.length,1);checks++;
    assert.equal(d.canonicalRequest.payment_method,'cash');assert.equal(d.canonicalRequest.notes,'notes');checks+=2;
    const repeated={...direct,lines:[line,{...line,client_line_id:randomUUID()}]};
    const requirements=(r=repeated,kind='DIRECT_V2')=>`phase5_private.derive_receipt_v2_identity_requirements_v1(${q(kind)},${j(r)})`;
    const needed=await json(`${claims}SELECT ${requirements()};`);
    const clients=repeated.lines.map(n=>n.client_line_id);
    const wanted=['OPERATION','HEADER','AUDIT','INVOICE','PAYMENT',`WAC|${product}`,
      ...clients.flatMap(id=>[`LINE|${id}`,`ITEM|${id}|${product}`,`MOVEMENT|${id}|${product}`])];
    const balanceAbsent=await json(`SELECT to_jsonb(NOT EXISTS(SELECT 1 FROM public.inventory_balances
      WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)}));`);
    if(balanceAbsent)wanted.push(`BALANCE|${product}`);
    assert.deepEqual(needed.slots.map(n=>n.slotKey),wanted.sort(),'independent-per-client-component-identity-set');checks++;
    assert.equal(needed.slots.filter(n=>n.relation==='public.phase2_receipt_wac_snapshots').length,1);checks++;
    assert.deepEqual(needed.slots.filter(n=>n.relation==='public.supplier_receipt_items').map(n=>n.binding.component.baseQuantity),[3,3]);checks++;
    assert.equal(needed.slots.find(n=>n.slotKey==='OPERATION').binding.initiated_by,owner);checks++;
    for(const flag of ['fullWriteTuples','defaultsQualified','stockEffectIdentitiesComplete','futureIdentityAllocated','durableIdentityClaimed',
      'numberClaimed','absencePredicatesFenced','locksHeld','allowedInvokerClosure','heldContextAuthority','executionAuthority']){
      assert.equal(needed[flag],false);checks++;
    }
    const requiredPo=await json(`${claims}SELECT ${requirements(poRequest,'PO_V2')};`);
    assert.equal(requiredPo.slots.some(n=>n.slotKey==='PAYMENT'),false);
    assert.equal(requiredPo.slots.some(n=>n.slotKey==='INVOICE'),false);checks+=2;
    assert.equal(requiredPo.slots.find(n=>n.slotKey==='HEADER').relation,'public.purchase_receipts');checks++;
    assert.notEqual(requiredPo.numberDomain,needed.numberDomain);checks++;
    const absentProof=await json(`BEGIN;${claims}DELETE FROM public.inventory_balances
      WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)};SELECT ${requirements()};ROLLBACK;`);
    assert.deepEqual(absentProof.slots.filter(n=>n.slotKey.startsWith('BALANCE|')).map(n=>[n.slotKey,n.binding]),
      [[`BALANCE|${product}`,{product_id:product,warehouse_id:warehouse,on_hand_quantity:0,reserved_quantity:0}]],
      'absent-balance-identity-independent-source-control');checks++;
    assert.equal(await fingerprint(),baseline);checks++;
    const proofSetup=`CREATE TEMP TABLE qa_v2_identity AS SELECT ${requirements()} plan;`;
    const allocate=(r=repeated,k='DIRECT_V2')=>`phase5_private.allocate_receipt_v2_future_uuids_v1(${q(k)},${j(r)})`;
    const minted=await json(`${claims}SELECT ${allocate()};`);
    assert.deepEqual(minted.identityBindings.map(n=>n.slotKey),wanted.sort(),'server-uuid-exact-primary-slot-set');checks++;
    assert.equal(new Set(minted.identityBindings.map(n=>n.id)).size,wanted.length);checks++;
    assert.equal(minted.futureIdentityAllocated,true);assert.equal(minted.durableIdentityClaimed,false);checks+=2;
    const mintedPo=await json(`${claims}SELECT ${allocate(poRequest,'PO_V2')};`);
    assert.equal(mintedPo.identityBindings.some(n=>n.slotKey==='PAYMENT'||n.slotKey==='INVOICE'),false);checks++;
    const uuidDerive=(a=minted.allocation)=>`phase5_private.derive_receipt_v2_future_uuids_v1('DIRECT_V2',${j(repeated)},${j(a)})`;
    const uuidSetup=`CREATE TEMP TABLE qa_v2_uuid AS SELECT ${uuidDerive()} plan;`;
    const uuidAssert=(p='plan')=>`SELECT to_jsonb(phase5_private.assert_receipt_v2_future_uuids_v1('DIRECT_V2',${j(repeated)},${j(minted.allocation)},${p})) FROM qa_v2_uuid;`;
    await json(`BEGIN;${claims}${uuidSetup}${uuidAssert()}ROLLBACK;`);
    const cleanIds=minted.allocation.identities;
    const inventoryDerive=`phase5_private.derive_receipt_v2_inventory_rows_v1('DIRECT_V2',${j(repeated)},${j(minted.allocation)})`;
    const inventorySetup=`CREATE TEMP TABLE qa_v2_inventory AS SELECT ${inventoryDerive} plan;`;
    const inventoryAssert=(p='plan')=>`SELECT to_jsonb(phase5_private.assert_receipt_v2_inventory_rows_v1('DIRECT_V2',${j(repeated)},${j(minted.allocation)},${p})) FROM qa_v2_inventory;`;
    const inventoryPlan=await json(`${claims}SELECT ${inventoryDerive};`);
    assert.equal(inventoryPlan.movements.length,2);assert.equal(inventoryPlan.wacRows.length,1);checks+=2;
    assert.deepEqual(inventoryPlan.movements.map(n=>n.componentIdentity).sort(),repeated.lines.map(n=>n.client_line_id+'|'+product).sort());checks++;
    assert.equal(new Set(inventoryPlan.movements.map(n=>n.explicitRow.id)).size,2);checks++;
    assert.equal(new Set(inventoryPlan.movements.map(n=>n.explicitRow.supplier_receipt_item_id)).size,2);checks++;
    assert.equal(inventoryPlan.movements[0].explicitRow.balance_after,inventoryPlan.movements[1].explicitRow.balance_before);checks++;
    assert.equal(inventoryPlan.wacRows[0].lastMovementSlot,inventoryPlan.movements[1].slotKey);checks++;
    assert.equal(inventoryPlan.wacRows[0].explicitRow.received_base_quantity,6);checks++;
    assert.equal(inventoryPlan.wacRows[0].explicitRow.allocated_acquisition_cost_in_minor_units,602,'freight-in-tax-out-authoritative-cost');checks++;
    const poInventory=await json(`${claims}SELECT phase5_private.derive_receipt_v2_inventory_rows_v1('PO_V2',${j(poRequest)},${j(mintedPo.allocation)});`);
    assert.equal(poInventory.movements[0].explicitRow.supplier_receipt_item_id,null);checks++;
    assert.ok(poInventory.movements[0].explicitRow.purchase_receipt_item_id);checks++;
    assert.equal(poInventory.wacRows[0].explicitRow.supplier_receipt_id,null);checks++;
    assert.equal(poInventory.movements[0].explicitRow.reference_type,'purchase_receipt');checks++;
    await json(`BEGIN;${claims}${inventorySetup}${inventoryAssert()}ROLLBACK;`);
    for(const corrupted of ['NULL::jsonb',"'null'::jsonb","plan-'movements'","plan-'wacRows'",
      "jsonb_set(plan,'{movements,1}',plan->'movements'->0)",
      "jsonb_set(plan,'{movements,0,explicitRow,supplier_receipt_item_id}',to_jsonb('"+randomUUID()+"'::text))",
      "jsonb_set(plan,'{wacRows,0,explicitRow,allocated_acquisition_cost_in_minor_units}','999')",
      "jsonb_set(plan,'{wacRows,0,lastMovementSlot}',to_jsonb('wrong'::text))",
      "jsonb_set(plan,'{executionAuthority}','true')"]){
      await fails(`${claims}${inventorySetup}${inventoryAssert(corrupted)}`,/40001.*PHASE5_RECEIPT_V2_INVENTORY_ROWS_CHANGED_RETRY/u);
      assert.equal(await fingerprint(),baseline);checks++;
    }
    // Compare scalar/component semantics with the unchanged real public writer.
    // Public-generated UUIDs differ, so joins establish each actual ownership edge.
    const publicInventory=await json(`BEGIN;${claims}CREATE TEMP TABLE qa_v2_inventory_public AS SELECT public.create_direct_supplier_receipt_v2(
      p_supplier_id:=${q(supplier)},p_warehouse_id:=${q(warehouse)},p_branch_id:=${q(branch)},
      p_supplier_invoice_number:=${q(repeated.supplier_invoice_number)},p_header_discount_in_minor_units:=1,
      p_supplier_freight_in_minor_units:=3,p_legacy_tax_in_minor_units:=17,p_amount_paid_at_receipt_in_minor_units:=50,
      p_payment_method:='cash',p_notes:=' notes ',p_idempotency_key:=${q(repeated.idempotency_key)},p_lines:=${j(repeated.lines)}) result;
      SELECT jsonb_build_object('movements',(SELECT jsonb_agg(jsonb_build_object('componentIdentity',l.client_line_id::text||'|'||m.product_id::text,
        'explicitRow',jsonb_build_object('warehouse_id',m.warehouse_id,'product_id',m.product_id,'movement_type',m.movement_type,
          'quantity',m.quantity,'balance_before',m.balance_before,'balance_after',m.balance_after,'reference_type',m.reference_type,'created_by',m.created_by))
        ORDER BY l.client_line_id) FROM public.inventory_movements m
        JOIN public.supplier_receipt_items i ON i.id=m.supplier_receipt_item_id AND i.operation_id=m.operation_id AND i.supplier_receipt_id=m.reference_id
        JOIN public.supplier_receipt_commercial_lines l ON l.id=i.commercial_line_id AND l.operation_id=m.operation_id
        WHERE m.operation_id=(SELECT (result->>'operation_id')::uuid FROM qa_v2_inventory_public)),
        'wac',(SELECT to_jsonb(w)-ARRAY['id','operation_id','supplier_receipt_id','purchase_receipt_id','receipt_movement_sequence_max','created_at']
        FROM public.phase2_receipt_wac_snapshots w WHERE w.operation_id=(SELECT (result->>'operation_id')::uuid FROM qa_v2_inventory_public)),
        'actualSequenceLinked',(SELECT w.receipt_movement_sequence_max=m.mutation_sequence FROM public.phase2_receipt_wac_snapshots w
          JOIN public.inventory_movements m ON m.operation_id=w.operation_id AND m.product_id=w.product_id
          JOIN public.supplier_receipt_items i ON i.id=m.supplier_receipt_item_id
          JOIN public.supplier_receipt_commercial_lines l ON l.id=i.commercial_line_id
          WHERE w.operation_id=(SELECT (result->>'operation_id')::uuid FROM qa_v2_inventory_public)
          ORDER BY l.client_line_id DESC LIMIT 1));ROLLBACK;`);
    const scalarKeys=['warehouse_id','product_id','movement_type','quantity','balance_before','balance_after','reference_type','created_by'];
    assert.deepEqual(publicInventory.movements,inventoryPlan.movements.map(n=>({componentIdentity:n.componentIdentity,
      explicitRow:Object.fromEntries(scalarKeys.map(k=>[k,n.explicitRow[k]]))})));checks++;
    assert.deepEqual(publicInventory.wac,Object.fromEntries(Object.entries(inventoryPlan.wacRows[0].explicitRow)
      .filter(([k])=>!['id','operation_id','supplier_receipt_id','purchase_receipt_id'].includes(k))));checks++;
    assert.equal(publicInventory.actualSequenceLinked,true);checks++;
    assert.equal(await fingerprint(),baseline);checks++;
    const financialDerive=(r=repeated,a=minted.allocation,kind='DIRECT_V2')=>`phase5_private.derive_receipt_v2_financial_rows_v1(${q(kind)},${j(r)},${j(a)})`;
    const financialSetup=`CREATE TEMP TABLE qa_v2_financial AS SELECT ${financialDerive()} plan;`;
    const financialAssert=(p='plan')=>`SELECT to_jsonb(phase5_private.assert_receipt_v2_financial_rows_v1('DIRECT_V2',${j(repeated)},${j(minted.allocation)},${p})) FROM qa_v2_financial;`;
    const financialPlan=await json(`${claims}SELECT ${financialDerive()};`);
    const fh=financialPlan.headerWithoutEventValues;
    assert.equal(fh.inventory_acquisition_cost_snapshot_in_minor_units,602);checks++;
    assert.equal(fh.supplier_invoice_payable_total_snapshot_in_minor_units,619);checks++;
    assert.equal(fh.supplier_outstanding_balance_effect_snapshot_in_minor_units,569);checks++;
    assert.equal(fh.payment_status,'partially_paid');checks++;
    assert.equal(fh.supplier_invoice_number,'S5-V2-INVOICE');checks++;
    assert.equal(financialPlan.invoiceWithoutDefaults.normalized_invoice_number,'s5-v2-invoice');checks++;
    assert.equal(financialPlan.paymentWithoutNotesTimeAndTrigger.amount_in_minor_units,50);checks++;
    assert.equal(financialPlan.paymentWithoutNotesTimeAndTrigger.purchase_receipt_id,undefined);checks++;
    assert.equal(financialPlan.operationWithoutResultAndTime.initiated_by,owner);checks++;
    const rawSupplier=await json(`SELECT to_jsonb(s) FROM public.suppliers s WHERE id=${q(supplier)};`);
    assert.deepEqual(financialPlan.supplierPatchWithoutEventTime.before,rawSupplier);checks++;
    assert.equal(financialPlan.supplierPatchWithoutEventTime.patchWithoutEventTime.current_balance_in_minor_units,
      rawSupplier.current_balance_in_minor_units===null?null:rawSupplier.current_balance_in_minor_units+569);checks++;
    const fp=await json(`${claims}SELECT ${financialDerive(poRequest,mintedPo.allocation,'PO_V2')};`);
    assert.equal(fp.paymentWithoutNotesTimeAndTrigger,null);checks++;
    assert.equal(fp.invoiceWithoutDefaults,null);checks++;
    assert.equal(fp.headerWithoutEventValues.purchase_order_id,po);checks++;
    assert.equal(fp.resultWithoutReceiptNumber.is_fully_received,false);checks++;
    await json(`BEGIN;${claims}${financialSetup}${financialAssert()}ROLLBACK;`);
    for(const corrupted of ['NULL::jsonb',"'null'::jsonb","plan-'headerWithoutEventValues'",
      "jsonb_set(plan,'{headerWithoutEventValues,inventory_acquisition_cost_snapshot_in_minor_units}','619')",
      "jsonb_set(plan,'{paymentWithoutNotesTimeAndTrigger,amount_in_minor_units}','569')",
      "jsonb_set(plan,'{invoiceWithoutDefaults,normalized_invoice_number}','\"FOREIGN\"')",
      "jsonb_set(plan,'{operationWithoutResultAndTime,initiated_by}',to_jsonb('"+product+"'::text))",
      "jsonb_set(plan,'{supplierPatchWithoutEventTime,patchWithoutEventTime,current_balance_in_minor_units}','999')",
      "jsonb_set(plan,'{executionAuthority}','true')"]){
      await fails(`${claims}${financialSetup}${financialAssert(corrupted)}`,/40001.*PHASE5_RECEIPT_V2_FINANCIAL_ROWS_CHANGED_RETRY/u);
      assert.equal(await fingerprint(),baseline);checks++;
    }
    await fails(`${claims}${financialSetup}UPDATE public.suppliers SET current_balance_in_minor_units=current_balance_in_minor_units+1 WHERE id=${q(supplier)};${financialAssert()}`,
      /40001.*PHASE5_RECEIPT_V2_FINANCIAL_ROWS_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),baseline);checks++;
    const publicFinancial=await json(`BEGIN;${claims}CREATE TEMP TABLE qa_v2_financial_public AS SELECT public.create_direct_supplier_receipt_v2(
      p_supplier_id:=${q(supplier)},p_warehouse_id:=${q(warehouse)},p_branch_id:=${q(branch)},
      p_supplier_invoice_number:=${q(repeated.supplier_invoice_number)},p_header_discount_in_minor_units:=1,
      p_supplier_freight_in_minor_units:=3,p_legacy_tax_in_minor_units:=17,p_amount_paid_at_receipt_in_minor_units:=50,
      p_payment_method:='cash',p_notes:=' notes ',p_idempotency_key:=${q(repeated.idempotency_key)},p_lines:=${j(repeated.lines)}) result;
      SELECT jsonb_build_object('header',(SELECT to_jsonb(r) FROM public.supplier_receipts r WHERE r.id=(SELECT (result->>'receipt_id')::uuid FROM qa_v2_financial_public)),
        'payment',(SELECT to_jsonb(p) FROM public.supplier_payments p WHERE p.operation_id=(SELECT (result->>'operation_id')::uuid FROM qa_v2_financial_public)),
        'supplier',(SELECT to_jsonb(s) FROM public.suppliers s WHERE id=${q(supplier)}),
        'operation',(SELECT to_jsonb(o) FROM public.business_operations o WHERE id=(SELECT (result->>'operation_id')::uuid FROM qa_v2_financial_public)),
        'audit',(SELECT to_jsonb(a) FROM public.audit_logs a WHERE a.entity_id=(SELECT (result->>'receipt_id')::uuid FROM qa_v2_financial_public) AND action='CREATE_DIRECT_SUPPLIER_RECEIPT_V2'));ROLLBACK;`);
    for(const [key,value] of Object.entries(fh).filter(([k])=>!['id','operation_id'].includes(k))){assert.deepEqual(publicFinancial.header[key],value,'source header '+key);checks++;}
    for(const [key,value] of Object.entries(financialPlan.paymentWithoutNotesTimeAndTrigger).filter(([k])=>!['id','operation_id','supplier_receipt_id'].includes(k))){
      assert.deepEqual(publicFinancial.payment[key],value,'source payment '+key);checks++;}
    assert.equal(publicFinancial.supplier.current_balance_in_minor_units,financialPlan.supplierPatchWithoutEventTime.patchWithoutEventTime.current_balance_in_minor_units);checks++;
    for(const key of ['operation_type','idempotency_key','request_fingerprint','initiated_by']){assert.equal(publicFinancial.operation[key],financialPlan.operationWithoutResultAndTime[key]);checks++;}
    for(const key of ['user_id','action','entity_name']){assert.equal(publicFinancial.audit[key],financialPlan.auditWithoutEventValues[key]);checks++;}
    for(const [key,value] of Object.entries(financialPlan.auditWithoutEventValues.detailsWithoutReceiptNumberAndWac).filter(([k])=>k!=='operation_id')){
      assert.deepEqual(publicFinancial.audit.details[key],value,'source audit '+key);checks++;}
    assert.equal(await fingerprint(),baseline);checks++;
    const itemDerive=(r=repeated,a=minted.allocation,kind='DIRECT_V2')=>`phase5_private.derive_receipt_v2_item_rows_v1(${q(kind)},${j(r)},${j(a)})`;
    const itemSetup=`CREATE TEMP TABLE qa_v2_items AS SELECT ${itemDerive()} plan;`;
    const itemAssert=(p='plan')=>`SELECT to_jsonb(phase5_private.assert_receipt_v2_item_rows_v1('DIRECT_V2',${j(repeated)},${j(minted.allocation)},${p})) FROM qa_v2_items;`;
    const itemPlan=await json(`${claims}SELECT ${itemDerive()};`);
    assert.equal(itemPlan.commercialLines.length,2);checks++;
    assert.equal(itemPlan.items.length,2);checks++;
    assert.equal(new Set(itemPlan.items.map(n=>n.identity)).size,2);checks++;
    assert.equal(new Set(itemPlan.items.map(n=>n.explicitRow.id)).size,2);checks++;
    assert.deepEqual(itemPlan.commercialLines.map(n=>n.explicitRowWithoutFinalizedAt.line_sequence),[1,2]);checks++;
    assert.equal(itemPlan.items.reduce((s,n)=>s+n.explicitRow.total_base_units,0),6);checks++;
    assert.equal(itemPlan.items.reduce((s,n)=>s+n.explicitRow.allocated_cost_in_minor_units,0),602);checks++;
    assert.deepEqual(itemPlan.purchaseOrderItemPatches,[]);checks++;
    const poItemPlan=await json(`${claims}SELECT ${itemDerive(poRequest,mintedPo.allocation,'PO_V2')};`);
    assert.equal(poItemPlan.items[0].explicitRow.purchase_order_item_id,item);checks++;
    assert.equal(poItemPlan.purchaseOrderItemPatches.length,1);checks++;
    assert.equal(poItemPlan.purchaseOrderItemPatches[0].patchWithoutEventTime.received_quantity,3);checks++;
    await json(`BEGIN;${claims}${itemSetup}${itemAssert()}ROLLBACK;`);
    for(const corrupted of ['NULL::jsonb',"'null'::jsonb","plan-'items'","jsonb_set(plan,'{items}',(plan->'items')-0)",
      "jsonb_set(plan,'{items,1}',plan->'items'->0)","jsonb_set(plan,'{items}',(plan->'items')||jsonb_build_array(plan->'items'->0))",
      "jsonb_set(plan,'{commercialLines,1}',plan->'commercialLines'->0)",
      "jsonb_set(plan,'{items,0,explicitRow,commercial_line_id}',to_jsonb('"+product+"'::text))",
      "jsonb_set(plan,'{items,0,explicitRow,package_price_in_minor_units}','999')",
      "jsonb_set(plan,'{items,0,explicitRow,batch_number}','\"FOREIGN\"')",
      "jsonb_set(plan,'{executionAuthority}','true')"]){
      await fails(`${claims}${itemSetup}${itemAssert(corrupted)}`,/40001.*PHASE5_RECEIPT_V2_ITEM_ROWS_CHANGED_RETRY/u);
      assert.equal(await fingerprint(),baseline);checks++;
    }
    for(const [kind,r,projected] of [['DIRECT_V2',repeated,itemPlan],['PO_V2',poRequest,poItemPlan]]){
      const call=kind==='DIRECT_V2'?`public.create_direct_supplier_receipt_v2(
        p_supplier_id:=${q(supplier)},p_warehouse_id:=${q(warehouse)},p_branch_id:=${q(branch)},
        p_supplier_invoice_number:=${q(repeated.supplier_invoice_number)},p_header_discount_in_minor_units:=1,
        p_supplier_freight_in_minor_units:=3,p_legacy_tax_in_minor_units:=17,p_amount_paid_at_receipt_in_minor_units:=50,
        p_payment_method:='cash',p_notes:=' notes ',p_idempotency_key:=${q(r.idempotency_key)},p_lines:=${j(r.lines)})`
        :`public.receive_purchase_order_v2(p_purchase_order_id:=${q(po)},p_header_discount_in_minor_units:=1,
          p_supplier_freight_in_minor_units:=3,p_legacy_tax_in_minor_units:=17,p_payment_method:='deferred',
          p_supplier_delivery_note:=' delivery ',p_idempotency_key:=${q(r.idempotency_key)},p_lines:=${j(r.lines)})`;
      const lt=kind==='DIRECT_V2'?'supplier_receipt_commercial_lines':'purchase_receipt_commercial_lines';
      const it=kind==='DIRECT_V2'?'supplier_receipt_items':'purchase_receipt_items';
      const sourceColumn=kind==='DIRECT_V2'?'supplier_receipt_id':'purchase_receipt_id';
      const actual=await json(`BEGIN;${claims}CREATE TEMP TABLE qa_v2_items_public AS SELECT ${call} result;
        SELECT jsonb_build_object('lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.line_sequence) FROM public.${lt} l
          WHERE l.${sourceColumn}=(SELECT (result->>'receipt_id')::uuid FROM qa_v2_items_public)),
          'items',(SELECT jsonb_agg(jsonb_build_object('identity',l.client_line_id::text||'|'||i.product_id::text,'row',to_jsonb(i)) ORDER BY l.line_sequence,i.product_id)
            FROM public.${it} i JOIN public.${lt} l ON l.id=i.commercial_line_id AND l.operation_id=i.operation_id AND l.${sourceColumn}=i.${sourceColumn}
            WHERE i.operation_id=(SELECT (result->>'operation_id')::uuid FROM qa_v2_items_public)),
          'poItems',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.purchase_order_items i WHERE purchase_order_id=${q(po)}));ROLLBACK;`);
      for(const expected of projected.commercialLines){
        const found=actual.lines.find(n=>n.client_line_id===expected.identity);assert.ok(found);checks++;
        for(const [key,value] of Object.entries(expected.explicitRowWithoutFinalizedAt).filter(([k])=>!['id','operation_id',sourceColumn].includes(k))){
          assert.deepEqual(found[key],value,kind+' line '+key);checks++;}
      }
      assert.equal(actual.items.length,projected.items.length);checks++;
      for(const expected of projected.items){
        const found=actual.items.find(n=>n.identity===expected.identity);assert.ok(found);checks++;
        for(const [key,value] of Object.entries(expected.explicitRow).filter(([k])=>!['id','operation_id','commercial_line_id',sourceColumn].includes(k))){
          assert.deepEqual(found.row[key],value,kind+' item '+key);checks++;}
      }
      for(const patch of projected.purchaseOrderItemPatches){
        const found=actual.poItems.find(n=>n.id===patch.id);assert.ok(found);checks++;
        for(const [key,value] of Object.entries(patch.patchWithoutEventTime)){assert.equal(found[key],value,'PO patch '+key);checks++;}
      }
      assert.equal(await fingerprint(),baseline);checks++;
    }
    const balanceDerive=`phase5_private.derive_receipt_v2_balance_rows_v1('DIRECT_V2',${j(repeated)},${j(minted.allocation)})`;
    const balanceSetup=`CREATE TEMP TABLE qa_v2_balance AS SELECT ${balanceDerive} plan;`;
    const balanceAssert=(p='plan')=>`SELECT to_jsonb(phase5_private.assert_receipt_v2_balance_rows_v1('DIRECT_V2',${j(repeated)},${j(minted.allocation)},${p})) FROM qa_v2_balance;`;
    const balancePlan=await json(`${claims}SELECT ${balanceDerive};`);
    const rawBalance=await json(`SELECT to_jsonb(b) FROM public.inventory_balances b WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)};`);
    assert.equal(balancePlan.rows.length,1);checks++;
    assert.deepEqual(balancePlan.rows[0].before,rawBalance);checks++;
    const rawBalanceWithoutTime=Object.fromEntries(Object.entries(rawBalance).filter(([key])=>key!=='updated_at'));
    assert.deepEqual(balancePlan.rows[0].afterWithoutEventTime,{...rawBalanceWithoutTime,
      on_hand_quantity:rawBalance.on_hand_quantity+6,available_quantity:rawBalance.on_hand_quantity+6-rawBalance.reserved_quantity});checks++;
    assert.equal(balancePlan.rows[0].insertWithoutEventTime,null);checks++;
    assert.equal(balancePlan.rows[0].eventTimeRequirement,'ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION');checks++;
    await json(`BEGIN;${claims}${balanceSetup}${balanceAssert()}ROLLBACK;`);
    for(const corrupted of ["NULL::jsonb","'null'::jsonb","plan-'rows'",
      "jsonb_set(plan,'{rows,0,afterWithoutEventTime,available_quantity}','999')",
      "jsonb_set(plan,'{rows,0,afterWithoutEventTime,reserved_quantity}','999')",
      "jsonb_set(plan,'{executionAuthority}','true')"]){
      await fails(`${claims}${balanceSetup}${balanceAssert(corrupted)}`,/40001.*PHASE5_RECEIPT_V2_BALANCE_ROWS_CHANGED_RETRY/u);
      assert.equal(await fingerprint(),baseline);checks++;
    }
    await fails(`${claims}${balanceSetup}ALTER TABLE public.inventory_balances ADD COLUMN qa_unmodelled integer;${balanceAssert()}`,
      /40001.*PHASE5_RECEIPT_V2_BALANCE_SCHEMA_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),baseline);checks++;
    const absentBalancePlan=await json(`BEGIN;${claims}DELETE FROM public.inventory_balances WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)};
      CREATE TEMP TABLE qa_v2_absent_ids AS SELECT phase5_private.allocate_receipt_v2_future_uuids_v1('DIRECT_V2',${j(repeated)}) plan;
      SELECT phase5_private.derive_receipt_v2_balance_rows_v1('DIRECT_V2',${j(repeated)},plan->'allocation') FROM qa_v2_absent_ids;ROLLBACK;`);
    const inserted=absentBalancePlan.rows[0].insertWithoutEventTime;
    assert.deepEqual({...inserted,id:undefined},{id:undefined,warehouse_id:warehouse,product_id:product,on_hand_quantity:0,reserved_quantity:0,available_quantity:0});checks++;
    assert.equal(absentBalancePlan.rows[0].afterWithoutEventTime.on_hand_quantity,6);checks++;
    assert.equal(await fingerprint(),baseline);checks++;
    const candidates=[null,{identities:null},{identities:[...cleanIds].reverse()},
      {identities:cleanIds.slice(1)},{identities:[...cleanIds,cleanIds[0]]},
      {identities:cleanIds.map((n,i)=>i===1?{...n,id:cleanIds[0].id}:n)},
      ...[null,'00000000-0000-0000-0000-000000000000','not-a-uuid',product,owner,warehouse,line.client_line_id].map(id=>
        ({identities:cleanIds.map((n,i)=>i===0?{...n,id}:n)})),
      {identities:cleanIds.map((n,i)=>i===0?{...n,extra:true}:n)},
      {identities:cleanIds.map((n,i)=>i===0?{...n,slotKey:'PAYMENT|EXTRA'}:n)}];
    for(const a of candidates){
      await fails(`${claims}SELECT ${uuidDerive(a)};`,/PHASE5_(WIRE_|RECEIPT_V2_UUID_)/u);
      assert.equal(await fingerprint(),baseline);checks++;
    }
    for(const corrupted of ["plan-'identityBindings'","jsonb_set(plan,'{identityBindings,1}',plan->'identityBindings'->0)",
      "jsonb_set(plan,'{executionAuthority}','true')"]){
      await fails(`${claims}${uuidSetup}${uuidAssert(corrupted)}`,/40001.*PHASE5_RECEIPT_V2_UUID_CHANGED_RETRY/u);
      assert.equal(await fingerprint(),baseline);checks++;
    }
    // A new row can occupy a candidate after preparation; assertion must
    // reject rather than treating UUID generation as a durable reservation.
    await fails(`${claims}${uuidSetup}INSERT INTO public.audit_logs(id,user_id,action,entity_name,entity_id)
      VALUES(${q(cleanIds[0].id)},${q(owner)},'UUID_COLLISION_PROBE','suppliers',${q(supplier)});${uuidAssert()}`,
      /40001.*PHASE5_RECEIPT_V2_UUID_COLLISION_RETRY/u);
    assert.equal(await fingerprint(),baseline);checks++;
    const prove=(p='plan')=>`SELECT to_jsonb(phase5_private.assert_receipt_v2_identity_requirements_v1('DIRECT_V2',${j(repeated)},${p})) FROM qa_v2_identity;`;
    await json(`BEGIN;${claims}${proofSetup}${prove()}ROLLBACK;`);
    for(const mutated of ['NULL::jsonb',"'null'::jsonb","plan-'slots'",
      "jsonb_set(plan,'{slots}',(plan->'slots')-0)",
      "jsonb_set(plan,'{slots}',(plan->'slots')||jsonb_build_array(plan->'slots'->0))",
      "jsonb_set(plan,'{slots,1}',plan->'slots'->0)",
      "jsonb_set(plan,'{slots,0,binding,user_id}',to_jsonb('"+product+"'::text))",
      "jsonb_set(plan,'{durableIdentityClaimed}','true')"]){
      await fails(`${claims}${proofSetup}${prove(mutated)}`,/40001.*PHASE5_RECEIPT_V2_IDENTITY_REQUIREMENTS_CHANGED_RETRY/u);
      assert.equal(await fingerprint(),baseline);checks++;
    }
    await fails(`${claims}${proofSetup}UPDATE public.products SET wac_cost_in_minor_units_exact=91 WHERE id=${q(product)};${prove()}`,
      /40001.*PHASE5_RECEIPT_V2_IDENTITY_REQUIREMENTS_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),baseline);checks++;
    for(const flag of ['locksHeld','defaultsQualified','stockEffectIdentitiesComplete','futureIdentityClaimed','numberClaimed',
      'absencePredicatesFenced','allowedInvokerClosure','heldContextAuthority','executionAuthority']){assert.equal(d[flag],false);checks++;}
    assert.equal(d.receiptCatalog.sequences.length,2);checks++;
    const p=await json(`${claims}SELECT ${discover(poRequest,'PO_V2')};`);
    assert.equal(p.prospectivePoCompleted,false);assert.equal(p.paymentShiftRows.length,0);checks+=2;
    assert.deepEqual(p.keyGates,[`purchase_order_receipt_v2:${owner}:${poRequest.idempotency_key}`]);checks++;
    assert.equal(p.resources.filter(n=>n.relation==='public.purchase_order_items').length,2,'whole-PO-completion-membership');checks++;
    await json(`BEGIN;${claims}${setup()}${assertion()}ROLLBACK;`);
    await json(`BEGIN;${claims}${setup(poRequest,'PO_V2')}${assertion(poRequest,'PO_V2')}ROLLBACK;`);
    assert.equal(await fingerprint(),baseline);checks++;
    for(const mutation of ['NULL::jsonb',"'null'::jsonb","plan-'canonicalRequest'",
      "jsonb_set(plan,'{effectiveSupplierId}',to_jsonb('"+owner+"'::text))",
      "jsonb_set(plan,'{executionAuthority}','true')"]){
      await fails(`${claims}${setup()}${assertion(direct,'DIRECT_V2',mutation)}`,/40001.*PHASE5_RECEIPT_V2_PREWRITE_CHANGED_RETRY/u);
      assert.equal(await fingerprint(),baseline);checks++;
    }
    for(const fault of [`UPDATE public.suppliers SET company_name='drift' WHERE id=${q(supplier)};`,
      `UPDATE public.cash_shifts SET opening_cash_in_minor_units=1 WHERE branch_id=${q(branch)} AND status='open';`,
      `ALTER SEQUENCE public.supplier_receipt_seq INCREMENT BY 2;`]){
      await fails(`${claims}${setup()}${fault}${assertion()}`,/40001.*PHASE5_RECEIPT_V2_PREWRITE_CHANGED_RETRY/u);
      assert.equal(await fingerprint(),baseline);checks++;
    }
    for(const fault of [`UPDATE public.purchase_order_items SET ordered_quantity=6 WHERE id=${q(remaining)};`,
      `UPDATE public.purchase_order_items SET received_quantity=3 WHERE id=${q(item)};`,
      `UPDATE public.purchase_orders SET amount_paid_in_minor_units=1 WHERE id=${q(po)};`]){
      await fails(`${claims}${setup(poRequest,'PO_V2')}${fault}${assertion(poRequest,'PO_V2')}`,/PHASE5_RECEIPT_V2_(PREWRITE_CHANGED_RETRY|PO_CAPACITY_INVALID|PO_INVALID_OR_PREPAID)/u);
      assert.equal(await fingerprint(),baseline);checks++;
    }
    for(const r of [null,{...direct,extra:true},{...direct,supplier_id:null},{...direct,warehouse_id:null},
      {...direct,idempotency_key:'short'},{...direct,payment_method:'deferred'},{...direct,payment_method:'cliq'},
      {...direct,branch_id:null},{...direct,amount_paid_at_receipt_in_minor_units:null},
      {...direct,amount_paid_at_receipt_in_minor_units:'999'}, {...direct,notes:{unsafe:true}}]){
      await fails(`${claims}SELECT ${discover(r)};`,/PHASE5_(WIRE_|RECEIPT_V2_)/u);
      assert.equal(await fingerprint(),baseline);checks++;
    }
    // Feature policy is challenged with actual configurable-purchase lines,
    // separately from role admission and with whole durable-state rollback.
    const parcelLine={client_line_id:randomUUID(),line_kind:'configurable_parcel',
      family_product_id:'92400000-0000-0000-0000-000000000100',
      parcel_configuration_id:'92400000-0000-0000-0000-000000000300',configuration_revision:1,
      commercial_quantity:1,units_per_parcel:5,base_unit_name:'باكيت',parcel_unit_name:'طرد',
      gross_amount_in_minor_units:101,components:[{product_id:product,base_quantity:2},
        {product_id:'92400000-0000-0000-0000-000000000102',base_quantity:3}]};
    const featureDirect={...direct,amount_paid_at_receipt_in_minor_units:'0',payment_method:'deferred',lines:[parcelLine]};
    const featurePo={...poRequest,lines:[{...parcelLine,purchase_order_item_id:item}]};
    const parcelPoSource=`UPDATE public.purchase_order_items SET commercial_line_kind='configurable_parcel',
      family_product_id=${q(parcelLine.family_product_id)},parcel_configuration_id=${q(parcelLine.parcel_configuration_id)},
      product_id=${q(parcelLine.family_product_id)},ordered_quantity=10,
      configuration_revision=1,units_per_parcel_snapshot=5,parcel_quantity=2,received_parcel_quantity=0,
      base_unit_name_snapshot='باكيت',parcel_unit_name_snapshot='طرد',client_line_id=${q(parcelLine.client_line_id)},
      commercial_quantity_snapshot=2,gross_amount_snapshot_in_minor_units=202,
      line_discount_snapshot_in_minor_units=0,line_net_snapshot_in_minor_units=202 WHERE id=${q(item)};`;
    // Positive metadata / multi-component Purchase Package controls run the
    // unchanged public writers, not only the discovery/feature predicate.
    const branchMetadata={batch_number:'  S5-BATCH-A  ',production_date:'2026-01-02',expiry_date:'2028-03-04',notes:' component A '};
    const branchComponent=(component,index)=>({...component,...branchMetadata,
      batch_number:index===0?branchMetadata.batch_number:'S5-BATCH-B',
      production_date:index===0?branchMetadata.production_date:'2026-02-03',
      expiry_date:index===0?branchMetadata.expiry_date:'2028-04-05',notes:index===0?branchMetadata.notes:' component B '});
    const metadataLine={...line,components:line.components.map(branchComponent)};
    const metadataPackage={...parcelLine,components:parcelLine.components.map(branchComponent)};
    for(const [branchLabel,kind,r,sourceSetup] of [
      ['base-metadata','DIRECT_V2',{...direct,lines:[metadataLine]},''],
      ['base-metadata','PO_V2',{...poRequest,lines:[{...metadataLine,purchase_order_item_id:item}]},''],
      ['purchase-package','DIRECT_V2',{...featureDirect,lines:[metadataPackage]},''],
      ['purchase-package','PO_V2',{...featurePo,lines:[{...metadataPackage,purchase_order_item_id:item}]},parcelPoSource],
    ]){
      const call=kind==='DIRECT_V2'?`public.create_direct_supplier_receipt_v2(
        p_supplier_id:=${q(supplier)},p_warehouse_id:=${q(warehouse)},p_branch_id:=${q(r.branch_id)},
        p_supplier_invoice_number:=${q(r.supplier_invoice_number)},p_header_discount_in_minor_units:=1,
        p_supplier_freight_in_minor_units:=3,p_legacy_tax_in_minor_units:=17,
        p_amount_paid_at_receipt_in_minor_units:=${q(r.amount_paid_at_receipt_in_minor_units)}::bigint,
        p_payment_method:=${q(r.payment_method)},p_notes:=${q(r.notes)},p_idempotency_key:=${q(r.idempotency_key)},p_lines:=${j(r.lines)})`
        :`public.receive_purchase_order_v2(p_purchase_order_id:=${q(po)},p_header_discount_in_minor_units:=1,
          p_supplier_freight_in_minor_units:=3,p_legacy_tax_in_minor_units:=17,p_payment_method:='deferred',
          p_supplier_delivery_note:=' delivery ',p_idempotency_key:=${q(r.idempotency_key)},p_lines:=${j(r.lines)})`;
      const lt=kind==='DIRECT_V2'?'supplier_receipt_commercial_lines':'purchase_receipt_commercial_lines';
      const it=kind==='DIRECT_V2'?'supplier_receipt_items':'purchase_receipt_items';
      const sourceColumn=kind==='DIRECT_V2'?'supplier_receipt_id':'purchase_receipt_id';
      const proof=await json(`BEGIN;${claims}
        UPDATE public.configurable_parcel_feature_settings SET feature_state='ENABLED' WHERE feature_key='configurable_parcels';
        ${sourceSetup}
        CREATE TEMP TABLE qa_v2_branch_ids AS SELECT phase5_private.allocate_receipt_v2_future_uuids_v1(${q(kind)},${j(r)}) allocated;
        CREATE TEMP TABLE qa_v2_branch_plan AS SELECT phase5_private.derive_receipt_v2_item_rows_v1(${q(kind)},${j(r)},allocated->'allocation') plan FROM qa_v2_branch_ids;
        SELECT to_jsonb(phase5_private.assert_receipt_v2_item_rows_v1(${q(kind)},${j(r)},allocated->'allocation',plan))
          FROM qa_v2_branch_ids CROSS JOIN qa_v2_branch_plan;
        CREATE TEMP TABLE qa_v2_branch_public AS SELECT ${call} result;
        SELECT jsonb_build_object('projected',(SELECT plan FROM qa_v2_branch_plan),
          'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.line_sequence) FROM public.${lt} l
            WHERE l.operation_id=(SELECT (result->>'operation_id')::uuid FROM qa_v2_branch_public)),
          'items',(SELECT jsonb_agg(jsonb_build_object('identity',l.client_line_id::text||'|'||i.product_id::text,'row',to_jsonb(i)) ORDER BY l.line_sequence,i.product_id)
            FROM public.${it} i JOIN public.${lt} l ON l.id=i.commercial_line_id AND l.operation_id=i.operation_id AND l.${sourceColumn}=i.${sourceColumn}
            WHERE i.operation_id=(SELECT (result->>'operation_id')::uuid FROM qa_v2_branch_public)),
          'poItems',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.purchase_order_items i WHERE purchase_order_id=${q(po)}));ROLLBACK;`);
      const projected=proof.projected, label=kind+' '+branchLabel;
      assert.equal(proof.lines.length,projected.commercialLines.length,label+' exact line cardinality');checks++;
      assert.equal(proof.items.length,projected.items.length,label+' exact component cardinality');checks++;
      assert.deepEqual(proof.items.map(n=>n.identity).sort(),projected.items.map(n=>n.identity).sort(),label+' exact component identity');checks++;
      for(const expected of projected.commercialLines){
        const found=proof.lines.find(n=>n.client_line_id===expected.identity);assert.ok(found,label+' line identity');checks++;
        for(const [key,value] of Object.entries(expected.explicitRowWithoutFinalizedAt).filter(([k])=>!['id','operation_id',sourceColumn].includes(k))){
          assert.deepEqual(found[key],value,label+' line '+key);checks++;}
      }
      for(const expected of projected.items){
        const found=proof.items.find(n=>n.identity===expected.identity);assert.ok(found,label+' item identity');checks++;
        for(const [key,value] of Object.entries(expected.explicitRow).filter(([k])=>!['id','operation_id','commercial_line_id',sourceColumn].includes(k))){
          assert.deepEqual(found.row[key],value,label+' item '+key);checks++;}
        if(kind==='DIRECT_V2'){
          const component=r.lines.flatMap(n=>n.components).find(n=>n.product_id===found.row.product_id);
          for(const key of ['batch_number','production_date','expiry_date','notes']){
            assert.equal(found.row[key],component[key].trim(),label+' independent metadata '+key);checks++;}
        }
      }
      if(branchLabel==='purchase-package'){
        assert.equal(proof.items.length,2,label+' two distinct physical components');checks++;
        assert.deepEqual(proof.items.map(n=>[n.row.product_id,n.row.total_base_units??n.row.received_quantity]).sort(),
          [[product,2],['92400000-0000-0000-0000-000000000102',3]].sort(),label+' independently specified component quantities');checks++;
      }
      for(const patch of projected.purchaseOrderItemPatches){
        const found=proof.poItems.find(n=>n.id===patch.id);assert.ok(found,label+' source patch identity');checks++;
        for(const [key,value] of Object.entries(patch.patchWithoutEventTime)){assert.equal(found[key],value,label+' source patch '+key);checks++;}
      }
      assert.equal(await fingerprint(),baseline,label+' rollback exact content');checks++;
    }
    for(const kind of ['DIRECT_V2','PO_V2'])for(const feature of ['OFF','OWNER_PILOT','ENABLED'])for(const actorRole of ['owner','warehouse_keeper']){
      const request=kind==='DIRECT_V2'?featureDirect:featurePo;
      // Build valid historical source under allowed creation BEFORE setting
      // the tested feature/actor. Otherwise a fixture trigger can false-green
      // a rejection without ever reaching the discovery function under test.
      const prepare=`${claims}UPDATE public.configurable_parcel_feature_settings SET feature_state='ENABLED' WHERE feature_key='configurable_parcels';
        ${kind==='PO_V2'?parcelPoSource:''}
        UPDATE public.configurable_parcel_feature_settings SET feature_state=${q(feature)} WHERE feature_key='configurable_parcels';
        DELETE FROM public.user_roles WHERE user_id=${q(owner)};
        INSERT INTO public.user_roles(user_id,role_id) SELECT ${q(owner)},id FROM public.roles WHERE code=${q(actorRole)};
        DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id=${q(owner)} AND r.code=${q(actorRole)})
          THEN RAISE EXCEPTION 'FEATURE_ACTOR_FIXTURE_MISSING';END IF;END $$;`;
      const allowed=feature==='ENABLED'||(feature==='OWNER_PILOT'&&actorRole==='owner');
      if(allowed){
        const proof=await json(`BEGIN;${prepare}SELECT ${discover(request,kind)};ROLLBACK;`);
        assert.equal(proof.featureState,feature);assert.equal(proof.mode,'NEW_REQUEST_DISCOVERED');checks+=2;
      }else await fails(`${prepare}SELECT ${discover(request,kind)};`,/CONFIGURABLE_PARCEL_DISABLED/u);
      // Compare the independently pinned historical public feature authority,
      // without issuing stock or upgrading the private discovery to execution.
      if(allowed){await json(`BEGIN;${prepare}SELECT to_jsonb(public.assert_configurable_parcel_creation_allowed());ROLLBACK;`);checks++;}
      else await fails(`${prepare}SELECT public.assert_configurable_parcel_creation_allowed();`,/CONFIGURABLE_PARCEL_DISABLED/u);
      assert.equal(await fingerprint(),baseline,'parcel-feature-rollback-content');checks++;
    }
    await fails(`${claims}UPDATE public.configurable_parcel_feature_settings SET feature_state='ENABLED';
      ${setup(featureDirect)}UPDATE public.configurable_parcel_feature_settings SET feature_state='OFF';
      ${assertion(featureDirect)}`,/CONFIGURABLE_PARCEL_DISABLED/u);
    assert.equal(await fingerprint(),baseline);checks++;
    const noCash=await json(`${claims}SELECT ${discover({...direct,branch_id:null,amount_paid_at_receipt_in_minor_units:'0',payment_method:'deferred'})};`);
    assert.deepEqual(noCash.paymentShiftRows,[]);checks++;
    const bank=await json(`${claims}SELECT ${discover({...direct,branch_id:null,payment_method:'bank_transfer',payment_reference:'BANK-1'})};`);
    assert.deepEqual(bank.paymentShiftRows,[]);checks++;
    await fails(`${claims}SELECT ${discover({...poRequest,lines:[{...poRequest.lines[0],purchase_order_item_id:randomUUID()}]},'PO_V2')};`,/PHASE5_RECEIPT_V2_PO_ITEM_INVALID/u);
    const oversize={...poRequest,lines:[{...poRequest.lines[0],commercial_quantity:6,components:[{product_id:product,base_quantity:6}]}]};
    await fails(`${claims}SELECT ${discover(oversize,'PO_V2')};`,/PHASE5_RECEIPT_V2_PO_CAPACITY_INVALID/u);
    // Public113 clean controls bind the private canonical fingerprint to the
    // actual writer. Replay observation precedes current new-write eligibility.
    const committed=`CREATE TEMP TABLE qa_v2_public AS SELECT public.create_direct_supplier_receipt_v2(
      p_supplier_id:=${q(supplier)},p_warehouse_id:=${q(warehouse)},p_branch_id:=${q(branch)},
      p_supplier_invoice_number:=${q(direct.supplier_invoice_number)},p_header_discount_in_minor_units:=1,
      p_supplier_freight_in_minor_units:=3,p_legacy_tax_in_minor_units:=17,p_amount_paid_at_receipt_in_minor_units:=50,
      p_payment_method:='cash',p_notes:=' notes ',p_idempotency_key:=${q(direct.idempotency_key)},p_lines:=${j([line])}) result;`;
    const observed=await json(`BEGIN;${claims}${committed}
      UPDATE public.suppliers SET is_active=false WHERE id=${q(supplier)};
      SELECT jsonb_build_object('plan',${discover()},'actualFingerprint',(SELECT request_fingerprint FROM public.business_operations
        WHERE id=(SELECT (result->>'operation_id')::uuid FROM qa_v2_public)));ROLLBACK;`);
    assert.equal(observed.plan.mode,'EXISTING_PUBLIC_OUTCOME_OBSERVED');assert.equal(observed.plan.replayEvidenceQualified,false);checks+=2;
    assert.equal(observed.plan.fingerprint,observed.actualFingerprint,'canonical-public113-request-parity');checks++;
    await fails(`${claims}${committed}SELECT ${requirements(direct)};`,/PHASE5_RECEIPT_V2_EXISTING_OUTCOME_NOT_NEW_IDENTITIES/u);
    assert.equal(await fingerprint(),baseline);checks++;
    await fails(`${claims}${committed}SELECT ${discover({...direct,notes:'changed'})};`,/IDEMPOTENCY_CONFLICT/u);
    await fails(`${claims}${committed}SELECT ${discover({...direct,idempotency_key:randomUUID()})};`,/DUPLICATE_SUPPLIER_INVOICE/u);
    await fails(`${claims}${committed}SELECT set_config('request.jwt.claims','{"sub":"92400000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',false);
      SELECT ${discover()};`,/42501|صلاحية/u);
    assert.equal(await fingerprint(),baseline);checks++;
    const poParity=await json(`BEGIN;${claims}CREATE TEMP TABLE qa_v2_public_po AS SELECT public.receive_purchase_order_v2(
      p_purchase_order_id:=${q(po)},p_header_discount_in_minor_units:=1,p_supplier_freight_in_minor_units:=3,p_legacy_tax_in_minor_units:=17,
      p_payment_method:='deferred',p_supplier_delivery_note:=' delivery ',p_idempotency_key:=${q(poRequest.idempotency_key)},p_lines:=${j(poRequest.lines)}) result;
      SELECT jsonb_build_object('plan',${discover(poRequest,'PO_V2')},'actualFingerprint',(SELECT request_fingerprint FROM public.business_operations
        WHERE id=(SELECT (result->>'operation_id')::uuid FROM qa_v2_public_po)));ROLLBACK;`);
    assert.equal(poParity.plan.mode,'EXISTING_PUBLIC_OUTCOME_OBSERVED');assert.equal(poParity.plan.fingerprint,poParity.actualFingerprint);checks+=2;
    assert.equal(await fingerprint(),baseline);checks++;
    for(const role of ['anon','authenticated','service_role'])for(const call of [discover(),
      `phase5_private.assert_receipt_v2_prewrite_v1('DIRECT_V2',${j(direct)},NULL)`,requirements(),
      `phase5_private.assert_receipt_v2_identity_requirements_v1('DIRECT_V2',${j(repeated)},NULL)`,allocate(),uuidDerive(),
      `phase5_private.assert_receipt_v2_future_uuids_v1('DIRECT_V2',${j(repeated)},${j(minted.allocation)},NULL)`,balanceDerive,
      `phase5_private.assert_receipt_v2_balance_rows_v1('DIRECT_V2',${j(repeated)},${j(minted.allocation)},NULL)`,inventoryDerive,
      `phase5_private.assert_receipt_v2_inventory_rows_v1('DIRECT_V2',${j(repeated)},${j(minted.allocation)},NULL)`,financialDerive(),
      `phase5_private.assert_receipt_v2_financial_rows_v1('DIRECT_V2',${j(repeated)},${j(minted.allocation)},NULL)`,itemDerive(),
      `phase5_private.assert_receipt_v2_item_rows_v1('DIRECT_V2',${j(repeated)},${j(minted.allocation)},NULL)`]){
      await fails(`GRANT USAGE ON SCHEMA phase5_private TO ${role};SET LOCAL ROLE ${role};SELECT ${call};`,/42501.*permission denied for function/u);
      assert.equal(await fingerprint(),baseline);checks++;
    }
    const unlocked=await json(`BEGIN;${claims}SELECT ${discover()};SELECT jsonb_build_object('advisory',
      (SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory'),'rowWriteLocks',
      (SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND mode IN ('RowExclusiveLock','RowShareLock') AND relation IN
        ('public.products'::regclass,'public.inventory_balances'::regclass,'public.cash_shifts'::regclass,'public.purchase_orders'::regclass)));ROLLBACK;`);
    assert.deepEqual(unlocked,{advisory:0,rowWriteLocks:0},'discovery-never-acquires-write-or-row-gates');checks++;
    assert.equal(await fingerprint(),baseline);checks++;
    passed.push('modern113 typed request/public fingerprint and source eligibility; independent per-client/component future requirement exact-set, distinct per-SKU WAC/existing-vs-absent balance and conditional invoice/payment slots, existing-outcome refusal, forged/source-drift rejection; Direct/PO feature actor matrix; exact source-bound UUID candidate allocation/collision validation; explicit balance/movement/WAC and header/financial/payment/audit/line/item projections with actual public Direct financial/inventory and Direct/PO child scalar/quantity controls; forty-five app denials, lock-free zero-write discovery and exact rollback; no durable UUID/default/number ownership or execution');
  } catch(error) {
    primaryFailure=error;
    throw error;
  } finally {
    await restoreOwnedFixture();
  }
  assert.equal(await fingerprint(),outer,'owned-fixture-cleanup-exact-content');checks++;
};

const receiptV2AllocationRuntime = async (claims) => {
  const a='92400000-0000-0000-0000-000000000401';
  const b='92400000-0000-0000-0000-000000000402';
  const other='92400000-0000-0000-0000-000000000102';
  const supplier=randomUUID();
  const base=(id,sku,gross=101)=>({client_line_id:id,line_kind:'base_unit',commercial_quantity:3,
    base_unit_name:'باكيت',gross_amount_in_minor_units:gross,line_discount_in_minor_units:0,
    components:[{product_id:sku,base_quantity:3}]});
  const lines=[base(b,product),base(a,product)];
  const derive=(rows=lines,discount=1,freight=3,tax=17,paid=0,kind='DIRECT_V2')=>
    `phase5_private.derive_receipt_v2_line_allocation_v1(${q(kind)},${j(rows)},${discount},${freight},${tax},${paid})`;
  const baseline=await fingerprint();
  const plan=await json(`${claims}SELECT ${derive()};`);
  assert.deepEqual(plan.componentBindings.map(n=>[n.identity,n.baseQuantity,n.merchandiseNetCost,n.allocatedCost,n.exactUnitCost,n.legacyUnitCost]),
    [[`${a}|${product}`,3,101,102,34,34],[`${b}|${product}`,3,101,102,34,34]],'client-line-component-bijection');checks++;
  assert.deepEqual(plan.lineBindings.map(n=>[n.clientLineId,n.headerDiscount,n.freight]),[[a,1,2],[b,0,1]],'stable-largest-remainder-ties');checks++;
  assert.deepEqual([plan.net,plan.acquisition,plan.payable,plan.outstanding],[202,204,221,221]);checks++;
  const reordered=await json(`${claims}SELECT ${derive([...lines].reverse())};`);
  assert.deepEqual(reordered.componentBindings,plan.componentBindings);assert.equal(reordered.allocationFingerprint,plan.allocationFingerprint);checks+=2;
  for(const flag of ['headerIdentityAdmitted','purchaseOrderCapacityQualified','featureEligibilityQualified','defaultsQualified',
    'stockEffectIdentitiesComplete','paymentDomainsQualified','futureIdentityClaimed','numberClaimed','locksHeld',
    'absencePredicatesFenced','allowedInvokerClosure','heldContextAuthority','executionAuthority']){assert.equal(plan[flag],false);checks++;}
  const setup=`CREATE TEMP TABLE qa_v2_allocation AS SELECT ${derive()} plan;`;
  const assertion=(p='plan')=>`SELECT to_jsonb(phase5_private.assert_receipt_v2_line_allocation_v1('DIRECT_V2',${j(lines)},1,3,17,0,${p})) FROM qa_v2_allocation;`;
  await json(`BEGIN;${claims}${setup}${assertion()}ROLLBACK;`);
  assert.equal(await fingerprint(),baseline);checks++;
  for(const mutation of ['NULL::jsonb',"'null'::jsonb","plan-'componentBindings'",
    "jsonb_set(plan,'{componentBindings,1}',plan->'componentBindings'->0)",
    "jsonb_set(plan,'{componentBindings,0,allocatedCost}','99')", "jsonb_set(plan,'{executionAuthority}','true')"]){
    await fails(`${claims}${setup}${assertion(mutation)}`,/40001.*PHASE5_RECEIPT_V2_ALLOCATION_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),baseline);checks++;
  }
  for(const fault of [
    `UPDATE public.products SET wac_cost_in_minor_units_exact=77 WHERE id=${q(product)};`,
    `UPDATE public.inventory_balances SET on_hand_quantity=on_hand_quantity+1 WHERE product_id=${q(product)};`,
    `UPDATE public.units SET name_ar='drift' WHERE id='92400000-0000-0000-0000-000000000010';`,
  ]){await fails(`${claims}${setup}${fault}${assertion()}`,/40001.*PHASE5_RECEIPT_V2_ALLOCATION_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),baseline);checks++;}
  const faults=[null,[],[null],[{...lines[0],components:null}],[lines[0],lines[0]],
    [{...lines[0],client_line_id:null}],[{...lines[0],commercial_quantity:null}],
    [{...lines[0],gross_amount_in_minor_units:null}],
    [{...lines[0],components:[{product_id:null,base_quantity:3}]}],
    [{...lines[0],components:[{product_id:product,base_quantity:null}]}]];
  for(const rows of faults){await fails(`${claims}SELECT ${derive(rows)};`,/PHASE5_RECEIPT_V2_/u);
    assert.equal(await fingerprint(),baseline);checks++;}
  for(const amounts of [[null,0,0,0],[-1,0,0,0],[203,0,0,0],[0,0,0,203],[0,0,null,0]]){
    await fails(`${claims}SELECT ${derive(lines,...amounts.map(v=>v===null?'NULL':v))};`,/PHASE5_RECEIPT_V2_/u);
    assert.equal(await fingerprint(),baseline);checks++;}
  const zero=await json(`${claims}SELECT ${derive([base(a,product,0)],0,0,17,0)};`);
  assert.equal(zero.componentBindings[0].allocatedCost,0);assert.equal(zero.payable,17);checks+=2;
  const parcel={client_line_id:a,line_kind:'configurable_parcel',family_product_id:'92400000-0000-0000-0000-000000000100',
    parcel_configuration_id:'92400000-0000-0000-0000-000000000300',configuration_revision:1,
    commercial_quantity:1,units_per_parcel:5,base_unit_name:'باكيت',parcel_unit_name:'طرد',gross_amount_in_minor_units:101,
    components:[{product_id:product,base_quantity:2,explicit_merchandise_cost_in_minor_units:41},
      {product_id:other,base_quantity:3,explicit_merchandise_cost_in_minor_units:60}]};
  const p=await json(`${claims}SELECT ${derive([parcel],1,3,17,0)};`);
  assert.deepEqual(p.componentBindings.map(n=>[n.productId,n.baseQuantity,n.merchandiseNetCost,n.allocatedCost,n.exactUnitCost,n.legacyUnitCost]),
    [[product,2,41,42,21,21],[other,3,60,61,20.333333,20]],'independent-component-cost-truth');checks++;
  await fails(`${claims}SELECT ${derive([{...parcel,components:[parcel.components[0],{...parcel.components[1],explicit_merchandise_cost_in_minor_units:null}]}])};`,/PHASE5_RECEIPT_V2_COMPONENT_COST_INVALID/u);
  // Real current public direct113 writer: compare each item to independent
  // arithmetic, then discard ALL business effects. No new-path execution.
  const publicRows=await json(`BEGIN;${claims}INSERT INTO public.suppliers(id,company_name) VALUES(${q(supplier)},'V2 allocation control');
    CREATE TEMP TABLE qa_v2_result AS SELECT public.create_direct_supplier_receipt_v2(p_supplier_id:=${q(supplier)},
      p_warehouse_id:=${q(warehouse)},p_branch_id:=${q(branch)},p_header_discount_in_minor_units:=1,
      p_supplier_freight_in_minor_units:=3,p_legacy_tax_in_minor_units:=17,p_idempotency_key:=${q(randomUUID())},p_lines:=${j(lines)}) result;
    SELECT jsonb_agg(jsonb_build_array(l.client_line_id,i.product_id,i.total_base_units,i.merchandise_net_cost_in_minor_units,
      i.allocated_cost_in_minor_units,i.exact_unit_cost_in_minor_units,i.base_unit_cost_in_minor_units) ORDER BY l.client_line_id,i.product_id)
    FROM public.supplier_receipt_items i JOIN public.supplier_receipt_commercial_lines l ON l.id=i.commercial_line_id
      WHERE l.operation_id=(SELECT (result->>'operation_id')::uuid FROM qa_v2_result);ROLLBACK;`);
  assert.deepEqual(publicRows,[[a,product,3,101,102,34,34],[b,product,3,101,102,34,34]],'actual-public113-per-line-control');checks++;
  assert.equal(await fingerprint(),baseline,'public-control-and-fault-rollback-exact-content');checks++;
  const poRows=await json(`BEGIN;${claims}INSERT INTO public.suppliers(id,company_name) VALUES(${q(supplier)},'V2 PO allocation control');
    CREATE TEMP TABLE qa_v2_po AS SELECT public.create_purchase_order_v2(p_supplier_id:=${q(supplier)},p_branch_id:=${q(branch)},
      p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(randomUUID())},p_lines:=${j(lines)}) result;
    UPDATE public.purchase_orders SET status='approved',approved_by=${q(owner)},approved_at=NOW()
      WHERE id=(SELECT (result->>'purchase_order_id')::uuid FROM qa_v2_po);
    CREATE TEMP TABLE qa_v2_po_lines AS SELECT jsonb_agg(n||jsonb_build_object('purchase_order_item_id',i.id)
      ORDER BY n->>'client_line_id') rows FROM jsonb_array_elements(${j(lines)}) n JOIN public.purchase_order_items i
        ON i.client_line_id=(n->>'client_line_id')::uuid AND i.purchase_order_id=(SELECT (result->>'purchase_order_id')::uuid FROM qa_v2_po);
    CREATE TEMP TABLE qa_v2_po_plan AS SELECT phase5_private.derive_receipt_v2_line_allocation_v1('PO_V2',(SELECT rows FROM qa_v2_po_lines),1,3,17,0) plan;
    CREATE TEMP TABLE qa_v2_po_received AS SELECT public.receive_purchase_order_v2(
      p_purchase_order_id:=(SELECT (result->>'purchase_order_id')::uuid FROM qa_v2_po),p_header_discount_in_minor_units:=1,
      p_supplier_freight_in_minor_units:=3,p_legacy_tax_in_minor_units:=17,p_idempotency_key:=${q(randomUUID())},
      p_lines:=(SELECT rows FROM qa_v2_po_lines)) result;
    SELECT jsonb_build_object('expected',(SELECT plan->'componentBindings' FROM qa_v2_po_plan),'actual',
      (SELECT jsonb_agg(jsonb_build_array(l.client_line_id,i.product_id,i.received_quantity,i.merchandise_net_cost_in_minor_units,
        i.allocated_cost_in_minor_units,i.exact_unit_cost_in_minor_units,i.unit_cost_in_minor_units) ORDER BY l.client_line_id,i.product_id)
      FROM public.purchase_receipt_items i JOIN public.purchase_receipt_commercial_lines l ON l.id=i.commercial_line_id
      WHERE l.operation_id=(SELECT (result->>'operation_id')::uuid FROM qa_v2_po_received)));ROLLBACK;`);
  assert.deepEqual(poRows.actual,[[a,product,3,101,102,34,34],[b,product,3,101,102,34,34]],'actual-public113-PO-per-line-control');checks++;
  assert.deepEqual(poRows.expected.map(n=>[n.clientLineId,n.productId,n.baseQuantity,n.merchandiseNetCost,n.allocatedCost,n.exactUnitCost,n.legacyUnitCost]),poRows.actual);checks++;
  assert.equal(await fingerprint(),baseline);checks++;
  for(const role of ['anon','authenticated','service_role'])for(const call of [
    'phase5_private.assert_receipt_v2_allocation_sources_v1()',derive(),
    `phase5_private.assert_receipt_v2_line_allocation_v1('DIRECT_V2',${j(lines)},1,3,17,0,NULL)`]){
    await fails(`GRANT USAGE ON SCHEMA phase5_private TO ${role};SET LOCAL ROLE ${role};SELECT ${call};`,/42501.*permission denied for function/u);
    assert.equal(await fingerprint(),baseline);checks++;}
  await fails(`SELECT set_config('request.jwt.claims','{}',false);SELECT ${derive()};`,/42501|تسجيل الدخول/u);
  assert.equal(await fingerprint(),baseline);checks++;
  passed.push('modern113 shared exact client-line/component allocations, repeated SKU identity, stable ties, explicit parcel costs, NULL-safe bounds, immutable all-warehouse WAC/unit anchors, content drift rejection, actual public direct per-item control, nine app EXECUTE denials and zero durable rollback footprint; full header/resource admission OPEN');
};

const productAncillaryIdentitiesRuntime = async (claims) => {
  const master='92400000-0000-0000-0000-000000000100';
  const unit='92400000-0000-0000-0000-000000000010';
  const category='92400000-0000-0000-0000-000000000011';
  const family={sku:' S5-ANCILLARY ',barcode:null,nameAr:'عائلة هويات',description:null,categoryId:category,brandId:null,
    unitId:unit,purchaseUnitId:null,unitsPerPurchaseUnit:1,defaultPurchasePriceInMinorUnits:'0',saleUnitId:unit,
    unitsPerSaleUnit:5,defaultSalePriceInMinorUnits:'5000',costPriceInMinorUnits:'7',minStockLevel:0,maxStockLevel:null,
    warehouseId:warehouse,imageUrl:'http://127.0.0.1/root.png',flavors:[{nameAr:'أ',openingSalePackages:0},
      {nameAr:'ب',openingSalePackages:0,imageUrl:'http://127.0.0.1/b.png'}]};
  const productAllocation={rootId:randomUUID(),children:[{id:randomUUID(),skuClockText:'2026-10-05 11:00:00+00'},
    {id:randomUUID(),skuClockText:'2026-10-05 11:00:01+00'}]};
  const freshIds=(productId,isMaster=false)=>({productId,balanceId:randomUUID(),imageId:randomUUID(),
    packagingAuditId:randomUUID(),wholesaleAuditId:randomUUID(),imageAuditId:randomUUID(),packageAuditId:randomUUID(),
    flavorAuditId:isMaster?null:randomUUID()});
  const allocation={products:[freshIds(productAllocation.rootId,true),...productAllocation.children.map(c=>freshIds(c.id))],
    familyAuditId:randomUUID()};
  const content=async()=>[await fingerprint(),await json(`SELECT to_jsonb(encode(extensions.digest(
    COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.product_images t),'[]')::text,'sha256'),'hex'));`)];
  const baseline=await content();
  const derive=(request=family,p=productAllocation,a=allocation,kind='FAMILY_V1')=>
    `phase5_private.derive_product_ancillary_identities_v1(${q(kind)},${j(request)},${j(p)},${j(a)})`;
  const plan=await json(`${claims}SELECT ${derive()};`);
  assert.equal(plan.identityBindings.length,21);checks++;
  assert.equal(new Set(plan.identityBindings.map(x=>x.id)).size,21);checks++;
  for(const [i,p] of [productAllocation.rootId,...productAllocation.children.map(c=>c.id)].entries()){
    const rows=plan.identityBindings.filter(b=>b.productId===p&&b.owner!=='FAMILY_AUDIT');
    assert.equal(rows.length,i===0?6:7,'per-product-ancillary-bijection');checks++;
    const image=rows.find(b=>b.owner==='PRIMARY_IMAGE');
    assert.equal(image.binding.image_url,i===2?'http://127.0.0.1/b.png':family.imageUrl);checks++;
    assert.deepEqual(rows.find(b=>b.owner==='ZERO_BALANCE').binding,
      {product_id:p,warehouse_id:warehouse,on_hand_quantity:0,reserved_quantity:0});checks++;
    assert.equal(rows.find(b=>b.owner==='imageAuditId').binding.details.product_image_id,image.id);checks++;
    assert.equal(rows.find(b=>b.owner==='wholesaleAuditId').binding.details.wholesale_price_in_minor_units,1000);checks++;
    assert.equal(rows.find(b=>b.owner==='packagingAuditId').binding.details.purchase_unit_id,i===0?null:unit);checks++;
  }
  assert.equal(plan.identityBindings.find(b=>b.owner==='packagingAuditId').binding.details.sku,family.sku);checks++;
  assert.deepEqual(plan.identityBindings.find(b=>b.owner==='FAMILY_AUDIT').binding.details,{atomic:true,flavor_count:2});checks++;
  for(const flag of ['serverAllocated','durableIdentityClaimed','defaultsQualified','fullWriteTuples','stockEffectIdentitiesComplete',
    'absencePredicatesFenced','locksHeld','heldContextAuthority','executionAuthority']){assert.equal(plan[flag],false);checks++;}
  const setup=`CREATE TEMP TABLE qa_ancillary AS SELECT ${derive()} plan;`;
  const assertPlan=(expression='plan')=>`SELECT to_jsonb(phase5_private.assert_product_ancillary_identities_v1(
    'FAMILY_V1',${j(family)},${j(productAllocation)},${j(allocation)},${expression})) FROM qa_ancillary;`;
  await json(`BEGIN;${claims}${setup}${assertPlan()}ROLLBACK;`);
  assert.deepEqual(await content(),baseline);checks++;
  for(const mutation of ['NULL::jsonb',"'null'::jsonb","plan-'identityBindings'",
    "jsonb_set(plan,'{identityBindings,7}',plan->'identityBindings'->0)",
    "jsonb_set(plan,'{identityBindings,0,binding,on_hand_quantity}','1')",
    "jsonb_set(plan,'{identityBindings,1,binding,image_url}','\"wrong\"')",
    "jsonb_set(plan,'{executionAuthority}','true')"]){
    await fails(`${claims}${setup}${assertPlan(mutation)}`,/40001.*PHASE5_PRODUCT_ANCILLARY_CHANGED_RETRY/u);
    assert.deepEqual(await content(),baseline);checks++;
  }
  const faults=[];
  const copy=structuredClone(allocation);copy.products[2]={...copy.products[1]};faults.push(copy);
  const swapped=structuredClone(allocation);[swapped.products[1],swapped.products[2]]=[swapped.products[2],swapped.products[1]];faults.push(swapped);
  const duplicate=structuredClone(allocation);duplicate.products[2].imageId=duplicate.products[1].imageId;faults.push(duplicate);
  const alias=structuredClone(allocation);alias.familyAuditId=productAllocation.children[0].id;faults.push(alias);
  const occupied=structuredClone(allocation);occupied.products[0].balanceId=product;faults.push(occupied);
  const missing=structuredClone(allocation);missing.products.pop();faults.push(missing);
  const extra=structuredClone(allocation);extra.products.push(freshIds(randomUUID()));faults.push(extra);
  const absent=structuredClone(allocation);absent.products[1].imageAuditId=null;faults.push(absent);
  for(const bad of faults){
    await fails(`${claims}SELECT ${derive(family,productAllocation,bad)};`,/PHASE5_(?:PRODUCT_ANCILLARY_|WIRE_)/u);
    assert.deepEqual(await content(),baseline);checks++;
  }
  const noImage={...family,imageUrl:null,warehouseId:null,flavors:family.flavors.map(f=>({...f,imageUrl:null}))};
  const noImageIds=structuredClone(allocation);for(const n of noImageIds.products){n.imageId=null;n.imageAuditId=null;}
  noImageIds.products[0].balanceId=null;
  const minimal=await json(`${claims}SELECT ${derive(noImage,productAllocation,noImageIds)};`);
  assert.equal(minimal.identityBindings.filter(b=>b.owner==='PRIMARY_IMAGE').length,0);checks++;
  assert.equal(minimal.identityBindings.filter(b=>b.owner==='ZERO_BALANCE').length,2);checks++;
  await fails(`${claims}SELECT ${derive(noImage,productAllocation,allocation)};`,/PHASE5_PRODUCT_ANCILLARY_NOT_APPLICABLE/u);
  const allocated=await json(`BEGIN;${claims}SELECT phase5_private.allocate_product_ancillary_identities_v1('FAMILY_V1',${j(family)});ROLLBACK;`);
  assert.equal(allocated.serverAllocated,true);assert.equal(allocated.identityBindings.length,21);checks+=2;
  assert.notEqual(allocated.prewritePlan.allocation.rootId,productAllocation.rootId);checks++;
  assert.deepEqual(await content(),baseline);checks++;
  // Existing master's image is a source anchor, not a newly allocated root image.
  const flavor={masterId:master,nameAr:'صورة موروثة',openingSalePackages:0,warehouseId:null,imageUrl:null,barcode:null};
  const flavorAllocation={rootId:master,children:[{id:randomUUID(),skuClockText:'2026-10-05 11:00:02+00'}]};
  const flavorIds={products:[freshIds(flavorAllocation.children[0].id)],familyAuditId:null};
  const sourceImage=randomUUID();
  const flavorPlan=await json(`BEGIN;${claims}INSERT INTO public.product_images(id,product_id,image_url,is_primary)
    VALUES(${q(sourceImage)},${q(master)},'http://127.0.0.1/inherited.png',true);
    SELECT ${derive(flavor,flavorAllocation,flavorIds,'FLAVOR_V1')};ROLLBACK;`);
  assert.equal(flavorPlan.identityBindings.length,7);checks++;
  assert.equal(flavorPlan.identityBindings.find(b=>b.owner==='PRIMARY_IMAGE').binding.image_url,'http://127.0.0.1/inherited.png');checks++;
  const serverFlavor=await json(`BEGIN;${claims}INSERT INTO public.product_images(id,product_id,image_url,is_primary)
    VALUES(${q(sourceImage)},${q(master)},'http://127.0.0.1/inherited.png',true);
    SELECT phase5_private.allocate_product_ancillary_identities_v1('FLAVOR_V1',${j(flavor)});ROLLBACK;`);
  assert.equal(serverFlavor.serverAllocated,true);assert.equal(serverFlavor.identityBindings.length,7);checks+=2;
  assert.equal(serverFlavor.prewritePlan.allocation.rootId,master);checks++;
  assert.equal(serverFlavor.allocation.familyAuditId,null);checks++;
  assert.notEqual(serverFlavor.prewritePlan.allocation.children[0].id,flavorAllocation.children[0].id);checks++;
  await fails(`${claims}INSERT INTO public.product_images(id,product_id,image_url,is_primary)
    VALUES(${q(sourceImage)},${q(master)},'http://127.0.0.1/inherited.png',true);
    CREATE TEMP TABLE qa_ancillary AS SELECT ${derive(flavor,flavorAllocation,flavorIds,'FLAVOR_V1')} plan;
    UPDATE public.product_images SET image_url='http://127.0.0.1/drift.png' WHERE id=${q(sourceImage)};
    SELECT phase5_private.assert_product_ancillary_identities_v1('FLAVOR_V1',${j(flavor)},${j(flavorAllocation)},${j(flavorIds)},plan) FROM qa_ancillary;`,
    /40001.*PHASE5_PRODUCT_ANCILLARY_CHANGED_RETRY/u);
  for(const malformed of [null,{...allocation,unexpected:true},
    {...allocation,products:allocation.products.map((p,i)=>i===0?{...p,flavorAuditId:randomUUID()}:p)}]){
    await fails(`${claims}SELECT ${derive(family,productAllocation,malformed)};`,/PHASE5_(?:PRODUCT_ANCILLARY_|WIRE_)/u);
    assert.deepEqual(await content(),baseline);checks++;
  }
  for(const role of ['anon','authenticated','service_role'])for(const call of [derive(),
    `phase5_private.assert_product_ancillary_identities_v1('FAMILY_V1',${j(family)},${j(productAllocation)},${j(allocation)},NULL)`,
    `phase5_private.allocate_product_ancillary_identities_v1('FAMILY_V1',${j(family)})`]){
    await fails(`${claims}GRANT USAGE ON SCHEMA phase5_private TO ${role};SET LOCAL ROLE ${role};SELECT ${call};`,
      /42501.*permission denied for function/u);
  }
  // Independent current PUBLIC control: compare actual audit/image/balance
  // source tuples, not implementation-generated expected rows. Entire control rolls back.
  const actual=await json(`BEGIN;${claims}SET LOCAL ROLE authenticated;
    CREATE TEMP TABLE qa_actual_family AS SELECT public.create_product_family_with_flavors_v1(
      ${q(family.sku)},NULL,${q(family.nameAr)},NULL,${q(category)},NULL,${q(unit)},NULL,1,0,${q(unit)},5,5000,7,0,NULL,
      ${q(warehouse)},${q(family.imageUrl)},${j(family.flavors)}) result;
    RESET ROLE;
    SELECT jsonb_build_object('audits',(SELECT jsonb_agg(to_jsonb(a)) FROM public.audit_logs a WHERE entity_id IN
      (SELECT id FROM public.products WHERE id=(SELECT (result->>'productId')::uuid FROM qa_actual_family)
        OR flavor_master_product_id=(SELECT (result->>'productId')::uuid FROM qa_actual_family))),
      'products',(SELECT jsonb_agg(to_jsonb(p)) FROM public.products p WHERE id=(SELECT (result->>'productId')::uuid FROM qa_actual_family)
        OR flavor_master_product_id=(SELECT (result->>'productId')::uuid FROM qa_actual_family)),
      'images',(SELECT jsonb_agg(to_jsonb(i)) FROM public.product_images i WHERE product_id IN
        (SELECT id FROM public.products WHERE id=(SELECT (result->>'productId')::uuid FROM qa_actual_family)
          OR flavor_master_product_id=(SELECT (result->>'productId')::uuid FROM qa_actual_family))),
      'balances',(SELECT jsonb_agg(to_jsonb(b)) FROM public.inventory_balances b WHERE product_id IN
        (SELECT id FROM public.products WHERE id=(SELECT (result->>'productId')::uuid FROM qa_actual_family)
          OR flavor_master_product_id=(SELECT (result->>'productId')::uuid FROM qa_actual_family))));ROLLBACK;`);
  assert.equal(actual.audits.length,15);assert.equal(actual.images.length,3);assert.equal(actual.balances.length,3);checks+=3;
  const projectedAudit=plan.identityBindings.filter(b=>b.relation==='public.audit_logs');
  // Public defaults produce independent UUIDs/clock SKUs. Bind each actual row
  // to its own public product/URL first, then map ONLY these generated identities
  // to the hypothetical identity domain for exact per-product source comparison.
  const actualRoot=actual.products.find(p=>p.flavor_master_product_id===null);
  for(const issued of actual.products){
    const expectedProduct=plan.prewritePlan.futureProducts.find(p=>issued.id===actualRoot.id?p.kind==='MASTER':p.flavorNameAr===issued.flavor_name_ar);
    assert.ok(expectedProduct);checks++;
    const actualImage=actual.images.filter(i=>i.product_id===issued.id);
    assert.equal(actualImage.length,1);checks++;
    const expectedImage=plan.identityBindings.find(b=>b.productId===expectedProduct.id&&b.owner==='PRIMARY_IMAGE');
    assert.deepEqual({product_id:expectedProduct.id,image_url:actualImage[0].image_url,is_primary:actualImage[0].is_primary,display_order:actualImage[0].display_order},
      expectedImage.binding);checks++;
    const auditRows=actual.audits.filter(a=>a.entity_id===issued.id);
    const expectedRows=projectedAudit.filter(a=>a.productId===expectedProduct.id);
    assert.equal(auditRows.length,expectedRows.length);checks++;
    for(const expected of expectedRows){
      const rows=auditRows.filter(a=>a.action===expected.binding.action);assert.equal(rows.length,1);checks++;
      const row=rows[0],details=structuredClone(row.details);
      if(row.action==='CREATE_PRODUCT_WITH_PACKAGING'&&issued.id!==actualRoot.id){
        assert.equal(details.sku,issued.sku);checks++;details.sku=expectedProduct.sku;
      }
      if(row.action==='CREATE_PRODUCT_FLAVOR'){
        assert.equal(details.master_product_id,actualRoot.id);checks++;details.master_product_id=productAllocation.rootId;
      }
      if(row.action==='SET_PRODUCT_PRIMARY_IMAGE'){
        assert.equal(details.product_image_id,actualImage[0].id);checks++;details.product_image_id=expectedImage.id;
      }
      assert.deepEqual({user_id:row.user_id,action:row.action,entity_name:row.entity_name,entity_id:expectedProduct.id,details},expected.binding);checks++;
    }
    const balances=actual.balances.filter(b=>b.product_id===issued.id);assert.equal(balances.length,1);checks++;
    assert.deepEqual({product_id:expectedProduct.id,warehouse_id:balances[0].warehouse_id,on_hand_quantity:balances[0].on_hand_quantity,
      reserved_quantity:balances[0].reserved_quantity},plan.identityBindings.find(b=>b.productId===expectedProduct.id&&b.owner==='ZERO_BALANCE').binding);checks++;
  }
  assert.ok(actual.balances.every(b=>b.on_hand_quantity===0&&b.reserved_quantity===0));checks++;
  assert.deepEqual(await content(),baseline,'public-control-and-fault-rollback-exact-content');checks++;
  passed.push('product ancillary per-item UUID bijection, source013 images and012/019/103/070/071 audits, conditional nulls, real allocator and actual public control; zero writes, nine function denials; no claims/locks/default or stock-effect completion');
};

const receivingFutureIdentitiesRuntime = async (claims) => {
  const before=await fingerprint();
  const other='92400000-0000-0000-0000-000000000103';
  const supplier=randomUUID(),po=randomUUID(),itemA=randomUUID(),itemB=randomUUID(),target=randomUUID();
  await sql(`INSERT INTO public.suppliers(id,company_name) VALUES(${q(supplier)},'S5 future receipt');
    INSERT INTO public.warehouses(id,branch_id,code,name_ar) SELECT ${q(target)},branch_id,'S5-FUTURE-EMPTY','S5 future empty target'
      FROM public.warehouses WHERE id=${q(warehouse)};
    INSERT INTO public.purchase_orders(id,purchase_order_number,supplier_id,warehouse_id,status,created_by)
      VALUES(${q(po)},'S5-FUTURE-IDENTITIES',${q(supplier)},${q(target)},'approved',${q(owner)});
    INSERT INTO public.purchase_order_items(id,purchase_order_id,product_id,ordered_quantity,purchase_price_in_minor_units,line_total_in_minor_units)
      VALUES(${q(itemA)},${q(po)},${q(product)},5,0,0),(${q(itemB)},${q(po)},${q(other)},5,0,0);`);
  const baseline=await fingerprint();
  const items=[{purchase_order_item_id:itemA,product_id:other,received_quantity:1,unit_cost_in_minor_units:0},
    {purchase_order_item_id:itemA,product_id:other,received_quantity:0},
    {purchase_order_item_id:itemB,product_id:product,received_quantity:1,unit_cost_in_minor_units:0},
    {purchase_order_item_id:itemA,product_id:other,received_quantity:1,unit_cost_in_minor_units:0}];
  const args=`${q(po)},NULL,'delivery','notes',${j(items)}`;
  const number=await json(`SELECT to_jsonb('GRN-'||to_char(transaction_timestamp(),'YYYY')||'-7777');`);
  const allocation={receiptId:randomUUID(),auditId:randomUUID(),receiptNumber:number,
    lineIdentities:[1,3,4].map(ordinal=>({ordinal,receiptItemId:randomUUID(),movementId:randomUUID()})),
    balanceIdentities:[product,other].sort().map(productId=>({productId,id:randomUUID()}))};
  const derive=(a=allocation)=>`phase5_private.derive_receiving_future_identities_v1(${args},${j(a)})`;
  const setup=`CREATE TEMP TABLE qa_future_receipt AS SELECT ${derive()} plan;`;
  const assertion=`SELECT to_jsonb(phase5_private.assert_receiving_future_identities_v1(${args},${j(allocation)},(SELECT plan FROM qa_future_receipt)));`;
  const plan=await json(`${claims}SELECT ${derive()};`);
  assert.equal(plan.identityBindings.length,10);checks++;
  // Independent104 source truth: positive occurrences1,3,4, including repeated
  // A; zero occurrence2 creates no row. Payload product_id is NOT SKU authority.
  const receiptLines=plan.identityBindings.filter(x=>x.owner==='RECEIPT_LINE');
  assert.deepEqual(receiptLines.map(x=>[x.ordinal,x.binding.purchase_order_item_id,x.binding.product_id,
    x.binding.received_quantity,x.binding.unit_cost_in_minor_units]),
    [[1,itemA,product,1,0],[3,itemB,other,1,0],[4,itemA,product,1,0]],'positive-occurrence-bijection');checks++;
  assert.deepEqual(plan.identityBindings.filter(x=>x.owner==='ABSENT_TARGET_BALANCE').map(x=>x.binding),
    [product,other].sort().map(product_id=>({product_id,warehouse_id:target})),'missing-balance-owned-identity');checks++;
  assert.equal(new Set(plan.identityBindings.map(x=>x.id)).size,10);checks++;
  for(const n of plan.identityBindings.filter(x=>x.owner==='RECEIPT_MOVEMENT')){
    assert.equal(n.binding.reference_id,allocation.receiptId);assert.equal(n.binding.warehouse_id,target);checks+=2;
  }
  for(const flag of ['serverAllocated','durableIdentityClaimed','numberClaimed','defaultsQualified','fullWriteTuples',
    'stockEffectIdentitiesComplete','absencePredicatesFenced','heldContextAuthority','executionAuthority']){
    assert.equal(plan[flag],false);checks++;
  }
  await json(`BEGIN;${claims}${setup}${assertion}ROLLBACK;`);
  assert.equal(await fingerprint(),baseline,'zero-write-future-allocation');checks++;
  const allocated=await json(`BEGIN;${claims}SELECT phase5_private.allocate_receiving_future_identities_v1(${args});ROLLBACK;`);
  assert.equal(allocated.serverAllocated,true);assert.equal(allocated.durableIdentityClaimed,false);checks+=2;
  assert.equal(allocated.identityBindings.length,10);assert.match(allocated.allocation.receiptNumber,/^GRN-\d{4}-[1-9]\d{3}$/u);checks+=2;
  assert.equal(await fingerprint(),baseline);checks++;
  for(const mutation of [
    "NULL::jsonb","'null'::jsonb","plan-'identityBindings'",
    "jsonb_set(plan,'{durableIdentityClaimed}','true')",
    "jsonb_set(plan,'{identityBindings,4}',plan->'identityBindings'->2)",
    "jsonb_set(plan,'{identityBindings,2,binding,product_id}',to_jsonb('"+other+"'::text))",
    "jsonb_set(plan,'{identityBindings,2,binding,unit_cost_in_minor_units}','99')",
  ]){
    await fails(`${claims}${setup}SELECT phase5_private.assert_receiving_future_identities_v1(${args},${j(allocation)},${mutation}) FROM qa_future_receipt;`,
      /40001.*PHASE5_RECEIVING_FUTURE_IDENTITIES_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),baseline);checks++;
  }
  const invalids=[];
  const duplicate=structuredClone(allocation);duplicate.lineIdentities[1]={...duplicate.lineIdentities[0],ordinal:3};invalids.push(duplicate);
  const missing=structuredClone(allocation);missing.lineIdentities.pop();invalids.push(missing);
  const zero=structuredClone(allocation);zero.lineIdentities[1].ordinal=2;invalids.push(zero);
  const sameUuid=structuredClone(allocation);sameUuid.auditId=sameUuid.receiptId;invalids.push(sameUuid);
  const absent=structuredClone(allocation);absent.balanceIdentities.pop();invalids.push(absent);
  const extra=structuredClone(allocation);extra.balanceIdentities.push({...extra.balanceIdentities[0],id:randomUUID()});invalids.push(extra);
  const sourceId=structuredClone(allocation);sourceId.receiptId=po;invalids.push(sourceId);
  const malformed=structuredClone(allocation);malformed.receiptNumber='GRN-1900-7777';invalids.push(malformed);
  for(const a of invalids){
    await fails(`${claims}SELECT ${derive(a)};`,/(22023|40001).*PHASE5_/u);
    assert.equal(await fingerprint(),baseline,'duplicate-masks-missing-receipt-identity');checks++;
  }
  for(const fault of [
    `UPDATE public.purchase_order_items SET product_id=${q(other)} WHERE id=${q(itemA)};`,
    `INSERT INTO public.inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity) VALUES(${q(target)},${q(product)},0,0);`,
    `INSERT INTO public.purchase_receipts(id,receipt_number,purchase_order_id,warehouse_id,received_by)
      VALUES(${q(allocation.receiptId)},'S5-CONFLICT-OTHER-NUMBER',${q(po)},${q(target)},${q(owner)});`,
    `INSERT INTO public.purchase_receipts(receipt_number,purchase_order_id,warehouse_id,received_by)
      VALUES(${q(number)},${q(po)},${q(target)},${q(owner)});`,
  ]){
    await fails(`${claims}${setup}${fault}${assertion}`,/(22023|40001).*PHASE5_/u);
    assert.equal(await fingerprint(),baseline,'receipt-number-conflict');checks++;
  }
  for(const role of ['anon','authenticated','service_role'])for(const call of [derive(),
    `phase5_private.allocate_receiving_future_identities_v1(${args})`,
    `phase5_private.assert_receiving_future_identities_v1(${args},NULL,NULL)`]){
    await fails(`${claims}GRANT USAGE ON SCHEMA phase5_private TO ${role};SET LOCAL ROLE ${role};SELECT ${call};`,
      /42501.*permission denied for function/u);
    assert.equal(await fingerprint(),baseline);checks++;
  }
  const compatible=await json(`BEGIN;${claims}SET LOCAL ROLE authenticated;
    SELECT public.receive_purchase_order(${args});ROLLBACK;`);
  assert.equal(compatible.success,true);assert.equal(await fingerprint(),baseline);checks+=2;
  await sql(`DELETE FROM public.purchase_order_items WHERE purchase_order_id=${q(po)};
    DELETE FROM public.purchase_orders WHERE id=${q(po)};DELETE FROM public.suppliers WHERE id=${q(supplier)};
    DELETE FROM public.warehouses WHERE id=${q(target)};`);
  assert.equal(await fingerprint(),before);checks++;
  passed.push('Receipt future identity preparation: ordered positive source-occurrence bijection, absent balance distinct ownership, immutable request/source projections, actual server allocation, collision/NULL/substitution/delta rejections, nine direct role denials and unchanged public receipt control; zero durable writes. NOT claims, locks, defaults/number fencing, stock effects, execution or public activation.');
};

const productCreationPrewriteRuntime = async (claims) => {
  const master='92400000-0000-0000-0000-000000000100';
  const unit='92400000-0000-0000-0000-000000000010';
  const category='92400000-0000-0000-0000-000000000011';
  const family={sku:' S5-PREWRITE-FAMILY ',barcode:null,nameAr:'عائلة خاصة',description:null,categoryId:category,brandId:null,
    unitId:unit,purchaseUnitId:null,unitsPerPurchaseUnit:1,defaultPurchasePriceInMinorUnits:'0',saleUnitId:unit,
    unitsPerSaleUnit:5,defaultSalePriceInMinorUnits:'5000',costPriceInMinorUnits:'7',minStockLevel:0,maxStockLevel:null,
    warehouseId:warehouse,imageUrl:null,flavors:[{nameAr:'جديد أ',openingSalePackages:0},{nameAr:'جديد ب',openingSalePackages:0}]};
  const flavor={masterId:master,nameAr:'جديد خاص',openingSalePackages:0,warehouseId:null,imageUrl:null,barcode:'QA-FLAVOR-PRIVATE'};
  const familyAllocation={rootId:randomUUID(),children:[{id:randomUUID(),skuClockText:'2026-10-05 10:00:00+00'},
    {id:randomUUID(),skuClockText:'2026-10-05 10:00:01+00'}]};
  const flavorAllocation={rootId:master,children:[{id:randomUUID(),skuClockText:'2026-10-05 10:00:02+00'}]};
  // Complement the existing content-sensitive business fingerprint: creation
  // touches image/classification/unit domains absent from earlier receipt cases.
  const creationFingerprint=async()=>[await fingerprint(),await json(`SELECT to_jsonb(encode(extensions.digest(jsonb_build_object(
    'images',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.product_images t),
    'units',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.units t),
    'categories',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.categories t),
    'brands',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.brands t))::text,'sha256'),'hex'));`)];
  const baseline=await creationFingerprint();
  const discover=(kind,request,allocation)=>`phase5_private.discover_product_creation_prewrite_v1(${q(kind)},${j(request)},${j(allocation)})`;
  const acquire=(kind,request)=>`phase5_private.allocate_and_acquire_product_prewrite_v1(${q(kind)},${j(request)})`;
  const familyPlan=await json(`${claims}SELECT ${discover('FAMILY_V1',family,familyAllocation)};`);
  assert.equal(familyPlan.futureProducts.length,3);checks++;
  assert.deepEqual(familyPlan.futureProducts.map(p=>p.id),[familyAllocation.rootId,...familyAllocation.children.map(c=>c.id)]);checks++;
  assert.deepEqual(familyPlan.futureProducts.map(p=>p.openingQuantity),[0,0,0]);checks++;
  assert.equal(familyPlan.futureProducts[0].sku,'S5-PREWRITE-FAMILY');checks++;
  for(let i=0;i<2;i++){
    const suffix=createHash('md5').update(family.flavors[i].nameAr+familyAllocation.children[i].skuClockText).digest('hex').slice(0,8).toUpperCase();
    assert.equal(familyPlan.futureProducts[i+1].sku,'S5-PREWRITE-FAMILY-F-'+suffix);checks++;
  }
  assert.equal(familyPlan.gates.filter(g=>g.startsWith('inventory-product:')).length,3);checks++;
  for(const field of ['serverAllocated','locksHeld','durableIdentityClaimed','defaultsQualified','allowedInvokerClosure',
    'absencePredicatesFenced','writerClosed','heldContextAuthority','executionAuthority']){assert.equal(familyPlan[field],false);checks++;}
  const flavorPlan=await json(`${claims}SELECT ${discover('FLAVOR_V1',flavor,flavorAllocation)};`);
  assert.ok(flavorPlan.productIds.includes(master)&&flavorPlan.productIds.includes(product)&&
    flavorPlan.productIds.includes('92400000-0000-0000-0000-000000000102'));checks++;
  const immutableRoot=await json(`SELECT to_jsonb(t) FROM public.products t WHERE id=${q(master)};`);
  assert.deepEqual(flavorPlan.rootRow,immutableRoot);checks++;
  const autoWarehouse=await json('SELECT to_jsonb(id) FROM public.warehouses WHERE is_active ORDER BY created_at,id LIMIT 1;');
  assert.equal(flavorPlan.futureProducts[0].warehouseId,autoWarehouse);checks++;
  const ownSku='P3-FAMILY-F-'+createHash('md5').update(flavor.nameAr+flavorAllocation.children[0].skuClockText).digest('hex').slice(0,8).toUpperCase();
  const sameOwnKey=await json(`${claims}SELECT ${discover('FLAVOR_V1',{...flavor,barcode:ownSku},flavorAllocation)};`);
  assert.equal(sameOwnKey.futureProducts[0].barcode,ownSku);checks++;
  assert.equal(sameOwnKey.gates.filter(g=>g==='product_identifier:'+ownSku.toLowerCase()).length,1);checks++;
  const clean=await json(`BEGIN;${claims}CREATE TEMP TABLE qa_created_plan AS SELECT ${acquire('FAMILY_V1',family)} plan;
    SELECT jsonb_build_object('plan',plan,'allGatesHeld',NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(plan->'gates') g(gate)
      CROSS JOIN LATERAL (SELECT hashtextextended(g.gate,0) key) k WHERE NOT EXISTS(SELECT 1 FROM pg_locks l
        WHERE l.pid=pg_backend_pid() AND l.locktype='advisory' AND l.granted
          AND l.classid=((k.key>>32)&4294967295)::oid AND l.objid=(k.key&4294967295)::oid)),
      'futureRows',(SELECT count(*) FROM public.products WHERE id IN (SELECT (f->>'id')::uuid FROM jsonb_array_elements(plan->'futureProducts') f)))
      FROM qa_created_plan;ROLLBACK;`);
  assert.equal(clean.allGatesHeld,true);assert.equal(clean.futureRows,0);assert.equal(clean.plan.serverAllocated,true);
  assert.equal(clean.plan.locksHeld,true);assert.equal(clean.plan.executionAuthority,false);checks+=5;
  assert.equal(clean.plan.futureProducts.length,3);checks++;
  assert.notDeepEqual(clean.plan.allocation,familyAllocation,'real acquisition must allocate its own identities, not adopt the hypothetical fixture');checks++;
  const cleanFlavor=await json(`BEGIN;${claims}SELECT ${acquire('FLAVOR_V1',flavor)};ROLLBACK;`);
  assert.equal(cleanFlavor.locksHeld,true);assert.equal(cleanFlavor.futureProducts.length,1);checks+=2;
  assert.deepEqual(await creationFingerprint(),baseline);checks++;
  const setup=`CREATE TEMP TABLE qa_product_plan AS SELECT ${discover('FLAVOR_V1',flavor,flavorAllocation)} plan;`;
  const assertion=`SELECT phase5_private.assert_product_creation_prewrite_v1('FLAVOR_V1',${j(flavor)},${j(flavorAllocation)},(SELECT plan FROM qa_product_plan));`;
  for(const fault of ['NULL::jsonb',"'null'::jsonb","plan-'resources'","jsonb_set(plan,'{resources,1}',plan->'resources'->0)",
    "jsonb_set(plan,'{futureProducts,0,rootId}',to_jsonb('"+product+"'::text))","jsonb_set(plan,'{serverAllocated}','true')",
    "jsonb_set(plan,'{executionAuthority}','true')"]){
    await fails(`${claims}${setup}SELECT phase5_private.assert_product_creation_prewrite_v1('FLAVOR_V1',${j(flavor)},${j(flavorAllocation)},${fault}) FROM qa_product_plan;`,
      /40001.*PHASE5_PRODUCT_PREWRITE_CHANGED_RETRY/u);assert.deepEqual(await creationFingerprint(),baseline);checks++;
  }
  for(const fault of [
    `UPDATE public.products SET name_ar=name_ar||' drift' WHERE id=${q(master)};`,
    `UPDATE public.products SET cost_price_in_minor_units=cost_price_in_minor_units+1 WHERE id=${q(product)};`,
    `UPDATE public.inventory_balances SET on_hand_quantity=on_hand_quantity+1 WHERE product_id=${q(product)};`,
    `UPDATE public.warehouses SET name_ar=name_ar||' drift' WHERE id=${q(warehouse)};`,
    `UPDATE public.categories SET name_ar=name_ar||' drift' WHERE id=${q(category)};`,
    `INSERT INTO public.product_images(product_id,image_url) VALUES(${q(master)},'http://127.0.0.1/isolated-image');`,
  ]){
    await fails(`${claims}${setup}${fault}${assertion}`,/40001.*PHASE5_PRODUCT_PREWRITE_CHANGED_RETRY/u);
    assert.deepEqual(await creationFingerprint(),baseline);checks++;
  }
  const duplicateNames=structuredClone(family);duplicateNames.flavors[1].nameAr=' جديد أ ';
  const opening=structuredClone(family);opening.flavors[1].openingSalePackages=1;
  for(const [request,pattern] of /** @type {[typeof family,RegExp][]} */([
    [duplicateNames,/23505.*PHASE5_PRODUCT_FLAVOR_NAME_CONFLICT/u],
    [opening,/23514.*PHASE5_PRODUCT_V4_OPENING_STOCK_FORBIDDEN/u],
    [{...family,sku:'P3-A'},/23505.*PHASE5_PRODUCT_IDENTIFIER_CONFLICT/u],
    [{...family,barcode:'ROOT-BARCODE'},/23514.*PHASE5_PRODUCT_FAMILY_BARCODE_INVALID/u],
    [{...family,unitsPerSaleUnit:0},/23514.*PHASE5_PRODUCT_PACKAGING_INVALID/u],
  ]))await fails(`${claims}SELECT ${acquire('FAMILY_V1',request)};`,pattern);
  await fails(`${claims}SELECT ${acquire('FLAVOR_V1',{...flavor,barcode:'P3-FAMILY'})};`,/23505.*PHASE5_PRODUCT_IDENTIFIER_CONFLICT/u);
  await fails(`${claims}SELECT ${acquire('FLAVOR_V1',{...flavor,openingSalePackages:1})};`,/23514.*PHASE5_PRODUCT_V4_OPENING_STOCK_FORBIDDEN/u);
  const duplicateIds=structuredClone(familyAllocation);duplicateIds.children[1].id=duplicateIds.children[0].id;
  await fails(`${claims}SELECT ${discover('FAMILY_V1',family,duplicateIds)};`,/23505.*PHASE5_PRODUCT_FUTURE_ID_CONFLICT/u);
  await fails(`${claims}SELECT ${discover('FAMILY_V1',family,{...familyAllocation,rootId:master})};`,/23505.*PHASE5_PRODUCT_FUTURE_ID_CONFLICT/u);
  await fails(`${claims}SELECT id FROM public.products WHERE id=${q(master)} FOR UPDATE;SELECT ${acquire('FLAVOR_V1',flavor)};`,/40001.*PHASE5_PRODUCT_LATE_ENTRY_RETRY/u);
  await fails(`${claims}SELECT pg_advisory_xact_lock(712981);SELECT ${acquire('FAMILY_V1',family)};`,/40001.*PHASE5_PRODUCT_LATE_ENTRY_RETRY/u);
  await fails(`${claims}ALTER FUNCTION public.assert_erp_role(text[],text) SECURITY INVOKER;SELECT ${acquire('FAMILY_V1',family)};`,/55000.*PHASE5_PRODUCT_ACTOR_CONTRACT_INVALID/u);
  for(const role of ['anon','authenticated','service_role'])for(const call of [
    'phase5_private.assert_product_creation_actor_v1()',discover('FAMILY_V1',family,familyAllocation),acquire('FAMILY_V1',family),
    `phase5_private.assert_product_creation_prewrite_v1('FAMILY_V1',${j(family)},${j(familyAllocation)},NULL)`])
    await fails(`${claims}GRANT USAGE ON SCHEMA phase5_private TO ${role};SET LOCAL ROLE ${role};SELECT ${call};`,/42501.*permission denied for function/u);
  // Both scheduling directions, independent connections, real gate wait.
  // A dirty root visible only after the holder commits MUST invalidate capture.
  for(const suffix of ['A','B']){
    const previousName=await json(`SELECT to_jsonb(name_ar) FROM public.products WHERE id=${q(master)};`);
    const release=await holdSQL(`SELECT pg_advisory_xact_lock(hashtextextended('inventory-product:${master}',0));
      UPDATE public.products SET name_ar=name_ar||' committed ${suffix}' WHERE id=${q(master)};`,'S5-PRODUCT-PREWRITE-HOLDER-'+suffix);
    const waiterName='S5-PRODUCT-PREWRITE-WAITER-'+suffix;
    const waiting=sql(`BEGIN;${claims}SET LOCAL application_name=${q(waiterName)};SELECT ${acquire('FLAVOR_V1',flavor)};ROLLBACK;`,true);
    try{
      let observed=false;
      for(let i=0;i<80;i++){
        observed=await json(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(waiterName)}
          AND wait_event_type='Lock' AND wait_event='advisory'));`);
        if(observed)break;await new Promise(resolve=>setTimeout(resolve,40));
      }
      assert.equal(observed,true,'must observe actual product second-session advisory wait');checks++;
    }finally{await release('COMMIT');}
    assert.match((await waiting).stderr,/40001.*PHASE5_PRODUCT_PREWRITE_CHANGED_RETRY/u);checks++;
    const changed=await creationFingerprint();
    const refreshed=await json(`BEGIN;${claims}SELECT ${acquire('FLAVOR_V1',flavor)};ROLLBACK;`);
    assert.equal(refreshed.locksHeld,true);assert.deepEqual(await creationFingerprint(),changed);checks+=2;
    await sql(`UPDATE public.products SET name_ar=${q(previousName)} WHERE id=${q(master)};`);
    // Restoring a fixture name cannot restore server-generated updated_at; the
    // full-content baseline is tracked explicitly, never asserted by counts.
  }
  const afterRaces=await creationFingerprint();
  const publicControl=await json(`BEGIN;${claims}SET LOCAL ROLE authenticated;
    SELECT public.create_product_family_with_flavors_v1('S5-PUBLIC-CONTROL',NULL,'عائلة تحكم',NULL,${q(category)},NULL,
      ${q(unit)},${q(unit)},1,0,${q(unit)},5,5000,7,0,NULL,${q(warehouse)},NULL,${j(family.flavors)});ROLLBACK;`);
  assert.equal(publicControl.success,true);assert.equal(publicControl.flavorCount,2);checks+=2;
  assert.deepEqual(await creationFingerprint(),afterRaces);checks++;
  passed.push('server-allocated whole family/root/child inventory and shared identifier gates before parent locks; exact source/member/image/WAC/catalog revalidation, duplicate/cross-identifier/UUID/opening rejection; 12 direct role denials; two independent observed advisory waits reject committed root drift, refreshed acquisition zero-write; current public family control rolls back; no durable claims/context/execution/activation authority');
};

const readMarkResourcesRuntime = async (claims) => {
  const alert='92400000-0000-0000-0000-000000008001';
  const otherAlert='92400000-0000-0000-0000-000000008002';
  const otherActor='92400000-0000-0000-0000-000000000002';
  const scope=`'SINGLE',${q(alert)}`;
  const call=`phase5_private.discover_read_mark_resources_v1(${scope})`;
  const assertion=`SELECT phase5_private.assert_read_mark_resources_v1(${scope},(SELECT plan FROM qa_read_mark));`;
  const setup=`CREATE TEMP TABLE qa_read_mark AS SELECT ${call} plan;`;
  const before=await fingerprint();
  // Resolved fixtures deliberately bypass no inventory trigger or authority.
  await sql(`INSERT INTO public.stock_alerts(id,product_id,warehouse_id,severity,status,available_quantity,threshold_quantity)
    VALUES(${q(alert)},${q(product)},${q(warehouse)},'low_stock','resolved',1,2),
      (${q(otherAlert)},${q(product)},${q(warehouse)},'low_stock','resolved',1,2);
    INSERT INTO public.stock_alert_reads(stock_alert_id,user_id)
    VALUES(${q(alert)},${q(owner)}),(${q(alert)},${q(otherActor)});`);
  const baseline=await fingerprint();
  const plan=await json(`${claims}SELECT ${call};`);
  assert.deepEqual(plan.alertIds,[alert]);assert.equal(plan.actorId,owner);checks+=2;
  assert.deepEqual(plan.writeTargets.map(t=>t.identity),[{stock_alert_id:alert,user_id:owner}]);checks++;
  assert.equal(plan.readRows.length,2);
  assert.ok(plan.resources.some(r=>r.relation==='public.profiles'&&r.identity.id===otherActor));checks+=2;
  assert.equal(plan.resources.find(r=>r.relation==='public.stock_alerts').row.status,'resolved');checks++;
  passed.push('read-mark-resolved-single / read-mark-other-actor complete composite and profile resources');
  for(const field of ['locksHeld','firstBusinessWriteQualified','earlyGateQualified','writerClosed','allowedInvokerClosure',
    'completeWriterLedger','absencePredicatesFenced','heldContextAuthority','executionAuthority']){
    assert.equal(plan[field],false);checks++;
  }
  assert.equal(await json(`BEGIN;${claims}${setup}SELECT to_jsonb(phase5_private.assert_read_mark_resources_v1(
    ${scope},(SELECT plan FROM qa_read_mark)));ROLLBACK;`),true);checks++;
  assert.equal(await fingerprint(),baseline);checks++;
  const multi=await json(`BEGIN;${claims}UPDATE public.stock_alerts SET status='resolved';
    UPDATE public.stock_alerts SET status='active' WHERE id=${q(alert)};
    UPDATE public.stock_alerts SET product_id='92400000-0000-0000-0000-000000000102',status='active' WHERE id=${q(otherAlert)};
    CREATE TEMP TABLE qa_bulk_resources AS SELECT phase5_private.discover_read_mark_resources_v1('ALL_ACTIVE',NULL) plan;
    SELECT jsonb_build_object('alerts',plan->'alertIds','gates',plan->'inventoryGates',
      'valid',phase5_private.assert_read_mark_resources_v1('ALL_ACTIVE',NULL,plan),
      'targets',jsonb_array_length(plan->'writeTargets')) FROM qa_bulk_resources;ROLLBACK;`);
  assert.deepEqual(multi.alerts,[alert,otherAlert]);assert.deepEqual(multi.gates,[`inventory-product:${product}`,
    'inventory-product:92400000-0000-0000-0000-000000000102']);
  assert.equal(multi.valid,true);assert.equal(multi.targets,2);assert.equal(await fingerprint(),baseline);checks+=5;
  for(const args of ['NULL,NULL',"'SINGLE',NULL",`'ALL_ACTIVE',${q(alert)}`,"'single',NULL",`'SINGLE',${q(randomUUID())}`])
    await fails(`${claims}SELECT phase5_private.discover_read_mark_resources_v1(${args});`,/22023.*SCOPE_INVALID|23503.*ALERT_MISSING/u);
  for(const f of ['NULL::jsonb',"'null'::jsonb","plan-'actorId'","jsonb_set(plan,'{executionAuthority}','true')",
    "jsonb_set(plan,'{readRows,1}',plan->'readRows'->0)","jsonb_set(plan,'{resources}','[]')",
    `jsonb_set(plan,'{actorId}',to_jsonb(${q(otherActor)}::text))`])
    await fails(`${claims}${setup}SELECT phase5_private.assert_read_mark_resources_v1(${scope},${f}) FROM qa_read_mark;`,
      /40001.*PHASE5_READ_MARK_RESOURCES_CHANGED_RETRY/u);
  const faults=[
    `UPDATE public.stock_alerts SET available_quantity=available_quantity+1 WHERE id=${q(alert)};`,
    `UPDATE public.stock_alert_reads SET read_at=read_at-interval '1 hour' WHERE stock_alert_id=${q(alert)} AND user_id=${q(otherActor)};`,
    `UPDATE public.profiles SET full_name=full_name||' drift' WHERE id=${q(otherActor)};`,
    `UPDATE public.warehouses SET name_ar=name_ar||' drift' WHERE id=${q(warehouse)};`,
    `UPDATE public.products SET cost_price_in_minor_units=cost_price_in_minor_units+1 WHERE id=${q(product)};`,
    `DELETE FROM public.stock_alert_reads WHERE stock_alert_id=${q(alert)} AND user_id=${q(otherActor)};`,
    // read-mark-same-count-substitution: same number, same product/warehouse, wrong selected source.
    `UPDATE public.stock_alert_reads SET stock_alert_id=${q(otherAlert)} WHERE stock_alert_id=${q(alert)} AND user_id=${q(otherActor)};`,
    `SELECT set_config('request.jwt.claims','{"sub":"${otherActor}","role":"authenticated","aal":"aal2"}',true);`,
  ];
  for(const f of faults){
    await fails(`${claims}${setup}${f}${assertion}`,/40001.*PHASE5_READ_MARK_RESOURCES_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),baseline);checks++;
  }
  const bulkSetup=`CREATE TEMP TABLE qa_read_mark AS SELECT phase5_private.discover_read_mark_resources_v1('ALL_ACTIVE',NULL) plan;`;
  const bulkAssert=`SELECT phase5_private.assert_read_mark_resources_v1('ALL_ACTIVE',NULL,(SELECT plan FROM qa_read_mark));`;
  const empty=await json(`BEGIN;${claims}UPDATE public.stock_alerts SET status='resolved';
    SELECT phase5_private.discover_read_mark_resources_v1('ALL_ACTIVE',NULL);ROLLBACK;`);
  assert.deepEqual(empty.alertIds,[]);assert.deepEqual(empty.inventoryGates,[]);assert.deepEqual(empty.writeTargets,[]);checks+=3;
  passed.push('read-mark-empty-active discovery accepts no inventory-product kernel requirement');
  await fails(`${claims}UPDATE public.stock_alerts SET status='resolved';${bulkSetup}
    UPDATE public.stock_alerts SET status='active' WHERE id=${q(alert)};${bulkAssert}`,
    /40001.*PHASE5_READ_MARK_RESOURCES_CHANGED_RETRY/u);
  await fails(`${claims}UPDATE public.stock_alerts SET status='resolved';
    UPDATE public.stock_alerts SET status='active' WHERE id=${q(alert)};${bulkSetup}
    UPDATE public.stock_alerts SET status='resolved' WHERE id=${q(alert)};
    UPDATE public.stock_alerts SET status='active' WHERE id=${q(otherAlert)};${bulkAssert}`,
    /40001.*PHASE5_READ_MARK_RESOURCES_CHANGED_RETRY/u);
  // A real second session commits content drift between capture and revalidation.
  await sql(`UPDATE public.stock_alert_reads SET read_at=read_at-interval '2 hours' WHERE stock_alert_id=${q(alert)};`);
  const changed=await fingerprint();assert.notEqual(changed,baseline);checks++;
  await fails(`${claims}SELECT phase5_private.assert_read_mark_resources_v1(${scope},${j(plan)});`,
    /40001.*PHASE5_READ_MARK_RESOURCES_CHANGED_RETRY/u);
  assert.equal(await fingerprint(),changed);checks++;
  passed.push('read-mark-independent-session-drift rejects stale exact resource plan without business writes');
  const compatibility=await json(`BEGIN;${claims}UPDATE public.stock_alerts SET status='resolved';
    SET LOCAL ROLE authenticated;
    SELECT public.mark_stock_alert_read(${q(alert)});
    SELECT public.mark_all_stock_alerts_read();ROLLBACK;`);
  assert.deepEqual(compatibility,{success:true,updatedCount:0});checks++;
  for(const role of ['anon','authenticated','service_role'])for(const c of [call,
    `phase5_private.assert_read_mark_resources_v1(${scope},NULL)`])
    await fails(`${claims}GRANT USAGE ON SCHEMA phase5_private TO ${role};SET LOCAL ROLE ${role};SELECT ${c};`,
      /42501.*permission denied for function/u);
  await fails(`SELECT set_config('request.jwt.claims','{}',true);SELECT ${call};`,/P0001.*يجب تسجيل الدخول/u);
  await fails(`${claims}UPDATE public.profiles SET is_active=false WHERE id=${q(owner)};SELECT ${call};`,/P0001.*صلاحية/u);
  await fails(`${claims}ALTER FUNCTION public.assert_erp_role(text[],text) SECURITY INVOKER;SELECT ${call};`,
    /55000.*PHASE5_READ_MARK_ACTOR_CONTRACT_INVALID/u);
  await fails(`${claims}GRANT EXECUTE ON FUNCTION public.mark_stock_alert_read(uuid) TO anon;SELECT ${call};`,
    /55000.*PHASE5_PARENT_EXECUTE_CONTRACT_INVALID/u,'supabase_admin');
  const installed=await json(`SELECT jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(proowner),
    'sd',prosecdef,'volatility',provolatile,'config',proconfig) ORDER BY oid) FROM pg_proc WHERE oid IN
    ('phase5_private.discover_read_mark_resources_v1(text,uuid)'::regprocedure,
     'phase5_private.assert_read_mark_resources_v1(text,uuid,jsonb)'::regprocedure);`);
  assert.equal(installed.length,2);for(const f of installed){
    assert.deepEqual(f,{owner:'postgres',sd:false,volatility:'v',config:['search_path=pg_catalog']});checks++;
  }
  assert.equal(await fingerprint(),changed);checks++;
  await sql(`DELETE FROM public.stock_alert_reads WHERE stock_alert_id IN (${q(alert)},${q(otherAlert)});
    DELETE FROM public.automation_events WHERE entity_id IN (${q(alert)},${q(otherAlert)});
    DELETE FROM public.stock_alerts WHERE id IN (${q(alert)},${q(otherAlert)});`);
  // Existing fixtures are untouched; injected source and generated outbox rows are removed.
  if(await fingerprint()!==before)throw new Error('READ_MARK_FAULT_NOT_INJECTED_OR_CLEANUP_INCOMPLETE');
  checks++;passed.push('private read-mark exact content/membership/scope/actor drift, real public resolved/empty controls, actual role denials and complete owned fixture cleanup');
};

const parentSourceRuntime = async () => {
  const before=await fingerprint();
  const plan=await json('SELECT phase5_private.plan_inventory_parent_sources_v1();');
  assert.equal(plan.publicSignatures.length,371);assert.equal(plan.sources.length,95);
  assert.equal(new Set(plan.sources.map(s=>s.signature)).size,95);
  const prepare='CREATE TEMP TABLE qa_parent_source AS SELECT phase5_private.plan_inventory_parent_sources_v1() plan;';
  const assertion='SELECT phase5_private.assert_inventory_parent_sources_v1((SELECT plan FROM qa_parent_source));';
  const clean=await json(`BEGIN;${prepare}SELECT to_jsonb(phase5_private.assert_inventory_parent_sources_v1((SELECT plan FROM qa_parent_source)));ROLLBACK;`);
  assert.equal(clean,true);assert.equal(await fingerprint(),before);checks++;
  for(const flag of ['completeWriterLedger','earlyGateQualified','defaultsQualified','writerClosed',
    'absencePredicatesFenced','locksHeld','heldContextAuthority','executionAuthority']) assert.equal(plan[flag],false);
  for(const fault of ['NULL::jsonb',"'null'::jsonb",'plan-\'sources\'',"jsonb_set(plan,'{sources}','[]')",
    "jsonb_set(plan,'{sources,1}',plan->'sources'->0)","jsonb_set(plan,'{publicSignatures,1}',plan->'publicSignatures'->0)",
    "jsonb_set(plan,'{sources,0,earlyGateQualified}','true')","jsonb_set(plan,'{writerClosed}','true')",
    "jsonb_set(plan,'{executionAuthority}','true')"]) {
    await fails(`${prepare}SELECT phase5_private.assert_inventory_parent_sources_v1(${fault}) FROM qa_parent_source;`,
      /40001.*PHASE5_PARENT_SOURCE_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),before);
  }
  // Every pinned body is faulted independently, including retained wrappers,
  // transitive producers and both delegated product-gate helpers.
  for(const source of plan.sources) {
    const definition=await json(`SELECT to_jsonb(pg_get_functiondef(${q(source.signature)}::regprocedure));`);
    const changed=definition.replace(/AS (\$[^$]*\$)/u,'AS $1\n-- PARENT_SOURCE_FAULT_INJECTED\n');
    assert.notEqual(changed,definition);
    await fails(`${changed};SELECT phase5_private.plan_inventory_parent_sources_v1();`,
      /55000.*PHASE5_PARENT_SOURCE_CONTRACT_INVALID/u,'supabase_admin');
    assert.equal(await fingerprint(),before);
    assert.deepEqual(await json('SELECT phase5_private.plan_inventory_parent_sources_v1();'),plan);
  }
  console.log('Parent source95 independent body faults rejected; checking identity/authority drift.');
  for(const fault of [
    `CREATE FUNCTION public.qa_parent_wrapper() RETURNS void LANGUAGE plpgsql SECURITY DEFINER
      AS $$ BEGIN PERFORM public.mark_all_stock_alerts_read();END;$$;`,
    `CREATE FUNCTION public.mark_stock_alert_read(uuid,text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb;$$;`,
    `CREATE PROCEDURE public.qa_parent_procedure() LANGUAGE plpgsql AS $$ BEGIN NULL;END;$$;`,
    `DROP FUNCTION public.mark_stock_alert_read(uuid);CREATE FUNCTION public.qa_parent_substitute(uuid)
      RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb;$$;`,
  ]) {
    await fails(`${fault}SELECT phase5_private.plan_inventory_parent_sources_v1();`,/55000.*PHASE5_PARENT_CALLABLE_SET_INVALID/u);
    assert.equal(await fingerprint(),before);
    assert.deepEqual(await json('SELECT phase5_private.plan_inventory_parent_sources_v1();'),plan);
  }
  for(const fault of [
    'ALTER FUNCTION public.phase2_lock_inventory_products_internal(uuid[]) SECURITY INVOKER;',
    'ALTER FUNCTION public.phase3_lock_inventory_products_internal(uuid[]) SET search_path=public;',
    'ALTER FUNCTION public.adjust_inventory_stock(uuid,uuid,integer,text,text) OWNER TO supabase_admin;',
  ]) {
    await fails(`${fault}SELECT phase5_private.plan_inventory_parent_sources_v1();`,/55000.*PHASE5_PARENT_SOURCE_CONTRACT_INVALID/u,'supabase_admin');
    assert.equal(await fingerprint(),before);
    assert.deepEqual(await json('SELECT phase5_private.plan_inventory_parent_sources_v1();'),plan);
  }
  // Existing unrelated signatures are NOT source-qualified by their presence.
  // Changing a body in that set is frozen catalog drift, not a new permit.
  const unrelated=await json(`SELECT to_jsonb(pg_get_functiondef('public.assert_erp_role(text[],text)'::regprocedure));`);
  const changed=unrelated.replace(/AS (\$[^$]*\$)/u,'AS $1\n-- UNREVIEWED_BODY_DRIFT\n');
  assert.notEqual(changed,unrelated);
  for(const fault of [changed+';',
    'ALTER FUNCTION public.mark_all_stock_alerts_read() COST 191;',
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT UPDATE ON TABLES TO anon WITH GRANT OPTION;',
    'GRANT UPDATE(status) ON public.stock_alerts TO authenticated WITH GRANT OPTION;',
  ]) {
    await fails(`${prepare}${fault}${assertion}`,/40001.*PHASE5_PARENT_SOURCE_CHANGED_RETRY/u,'supabase_admin');
    assert.equal(await fingerprint(),before);
    assert.deepEqual(await json('SELECT phase5_private.plan_inventory_parent_sources_v1();'),plan);
  }
  const self=await json(`BEGIN;GRANT UPDATE(status) ON public.stock_alerts TO authenticated WITH GRANT OPTION;
    SELECT phase5_private.plan_inventory_parent_sources_v1();ROLLBACK;`);
  assert.notDeepEqual(self.authorityCatalog,plan.authorityCatalog);
  assert.equal(self.writerClosed,false);assert.equal(self.executionAuthority,false);
  assert.equal(await fingerprint(),before);checks++;
  for(const role of ['anon','authenticated','service_role'])for(const call of [
    'phase5_private.plan_inventory_parent_sources_v1()',
    'phase5_private.assert_inventory_parent_sources_v1(NULL)',
  ]) {
    await fails(`SET LOCAL ROLE ${role};SELECT ${call};`,/42501.*permission denied/u);
    assert.equal(await fingerprint(),before);
  }
  passed.push('source-independent95 parent/wrapper/transitive body anchors, exact371 public callable identities, all-body fault matrix, extra/wrong-overload/procedure/same-count substitution, catalog/default/owner drift, six role denials and durable rollback; early branch/default/writer/execution qualification remains false');
};

const parentExecuteRuntime = async () => {
  const before=await fingerprint();
  const plan=await json('SELECT phase5_private.plan_inventory_parent_execute_v1();');
  assert.equal(plan.contracts.length,95);assert.equal(plan.directAclQualified,true);assert.equal(plan.effectiveAppExecuteQualified,true);
  for(const flag of ['allowedInvokerClosure','firstBusinessWriteQualified','earlyGateQualified','completeWriterLedger','writerClosed',
    'absencePredicatesFenced','locksHeld','heldContextAuthority','executionAuthority'])assert.equal(plan[flag],false,flag);
  assert.deepEqual(plan.contracts.filter(r=>r.grantees.includes('public')).map(r=>[r.signature,r.triggerOnly]),
    [['public.sync_product_flavor_commercial_settings()',true]]);
  const setup='CREATE TEMP TABLE qa_parent_execute AS SELECT phase5_private.plan_inventory_parent_execute_v1() plan;';
  const assertion='SELECT phase5_private.assert_inventory_parent_execute_v1((SELECT plan FROM qa_parent_execute));';
  const restored=async()=>{assert.equal(await fingerprint(),before);assert.deepEqual(await json('SELECT phase5_private.plan_inventory_parent_execute_v1();'),plan);};
  assert.equal(await json(`BEGIN;${setup}SELECT to_jsonb(phase5_private.assert_inventory_parent_execute_v1((SELECT plan FROM qa_parent_execute)));ROLLBACK;`),true);
  await restored();checks++;
  for(const r of plan.contracts){
    const fault=r.grantees.includes('public')?`REVOKE EXECUTE ON FUNCTION ${r.signature} FROM PUBLIC;`
      :r.grantees.includes('authenticated')?`REVOKE EXECUTE ON FUNCTION ${r.signature} FROM authenticated;`
      :`GRANT EXECUTE ON FUNCTION ${r.signature} TO authenticated;`;
    await fails(fault+'SELECT phase5_private.plan_inventory_parent_execute_v1();',/55000.*PHASE5_PARENT_EXECUTE_CONTRACT_INVALID/u,'supabase_admin');
    await restored();
  }
  console.log('Parent95 independent direct EXECUTE faults rejected; checking inherited authority and forged qualification.');
  for(const fault of [
    'GRANT EXECUTE ON FUNCTION public.mark_stock_alert_read(uuid) TO authenticated WITH GRANT OPTION;',
    'REVOKE EXECUTE ON FUNCTION public.mark_stock_alert_read(uuid) FROM authenticated;GRANT EXECUTE ON FUNCTION public.mark_stock_alert_read(uuid) TO anon;',
    'CREATE ROLE qa_parent_execute_extra;GRANT EXECUTE ON FUNCTION public.mark_stock_alert_read(uuid) TO qa_parent_execute_extra;',
  ]){await fails(fault+'SELECT phase5_private.plan_inventory_parent_execute_v1();',/55000.*PHASE5_PARENT_EXECUTE_CONTRACT_INVALID/u,'supabase_admin');await restored();}
  await fails(`GRANT authenticated TO anon WITH INHERIT TRUE;
    DO $$ BEGIN IF NOT has_function_privilege('anon','public.mark_stock_alert_read(uuid)','EXECUTE')
      THEN RAISE EXCEPTION 'EFFECTIVE_EXECUTE_FAULT_NOT_INJECTED'; END IF; END $$;
    SELECT phase5_private.plan_inventory_parent_execute_v1();`,/55000.*PHASE5_PARENT_EFFECTIVE_EXECUTE_INVALID/u,'supabase_admin');
  await restored();
  for(const fault of ['NULL::jsonb',"'null'::jsonb",'plan-\'contracts\'',"jsonb_set(plan,'{contracts}','[]')",
    "jsonb_set(plan,'{contracts,1}',plan->'contracts'->0)","jsonb_set(plan,'{contracts,0,grantees}','[\"postgres\",\"anon\"]')",
    "jsonb_set(plan,'{contracts,0,branchOrderQualified}','true')","jsonb_set(plan,'{firstBusinessWriteQualified}','true')",
    "jsonb_set(plan,'{allowedInvokerClosure}','true')","jsonb_set(plan,'{earlyGateQualified}','true')",
    "jsonb_set(plan,'{writerClosed}','true')","jsonb_set(plan,'{executionAuthority}','true')"]){
    await fails(`${setup}SELECT phase5_private.assert_inventory_parent_execute_v1(${fault}) FROM qa_parent_execute;`,
      /40001.*PHASE5_PARENT_EXECUTE_CHANGED_RETRY/u);await restored();
  }
  await fails(`${setup}ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon WITH GRANT OPTION;
    ${assertion}`,/40001.*PHASE5_PARENT_EXECUTE_CHANGED_RETRY/u,'supabase_admin');await restored();
  const self=await json(`BEGIN;ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon WITH GRANT OPTION;
    SELECT phase5_private.plan_inventory_parent_execute_v1();ROLLBACK;`);
  assert.notDeepEqual(self,plan);assert.equal(self.allowedInvokerClosure,false);assert.equal(self.executionAuthority,false);await restored();checks++;
  for(const role of ['anon','authenticated','service_role'])for(const call of [
    'phase5_private.plan_inventory_parent_execute_v1()','phase5_private.assert_inventory_parent_execute_v1(NULL)',
  ]){await fails(`GRANT USAGE ON SCHEMA phase5_private TO ${role};SET LOCAL ROLE ${role};SELECT ${call};`,/42501.*permission denied for function/u);await restored();}
  await fails('SET LOCAL ROLE anon;SELECT public.sync_product_flavor_commercial_settings();',/0A000.*trigger functions can only be called as triggers/u);
  await restored();
  passed.push('95 independent historical direct ACLs, effective inherited app EXECUTE rejection, grant-option/extra/same-count grantee rejection, PUBLIC trigger-only preservation, forged snapshots/early-write authority rejection, defaults remain unqualified, six private role denials and full durable/catalog rollback');
};

try {
  const migrationPath = path.join(root,'supabase/migrations/128_phase5_inactive_collection_preparation.sql');
  const migrationBytes = await readFile(migrationPath);
  const migrationHash = createHash('sha256').update(migrationBytes.toString('utf8').replace(/\r\n?/gu,'\n')).digest('hex').toUpperCase();
  const boot = await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{
    cwd:root,windowsHide:true,timeout:360000,maxBuffer:8*1024*1024,
    env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:projectId,NAWASRAH_MAX_MIGRATION: '128',
      NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
      NAWASRAH_SUPABASE_EXCLUDE:'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'},
  });
  const bootstrap = JSON.parse(boot.stdout);
  workdir = bootstrap.isolatedProjectRoot;
  assert.deepEqual(await readFile(path.join(workdir,'supabase/migrations/128_phase5_inactive_collection_preparation.sql')),migrationBytes,
    'isolated rebuild must use the exact current candidate bytes');
  assert.equal(bootstrap.ok,true); assert.equal(bootstrap.authBaselineEmpty,true);
  assert.ok(!bootstrap.reusedDatabaseVolume || !bootstrap.resetSkipped);
  assert.deepEqual(await json(`SELECT jsonb_build_object('count',count(*),'maximum',max(version))
    FROM supabase_migrations.schema_migrations;`),{count:128,maximum:'128'});
  passed.push('fresh isolated full-schema rebuild 001-128');
  console.log('Slice5 preparation rebuild verified; starting inactive-contract matrix.');
  assert.deepEqual(await json(`SELECT to_jsonb(t) FROM phase5_private.authority_generation t;`),{
    singleton:true,generation:0,authority_state:'PRIVATE_INACTIVE',
    manifest_sha256:'9A74EB14788EA668BDE88DAC95561AD8DA2F734EC47EAA87491AB0F181E06099',
  });
  assert.equal(await json(`SELECT to_jsonb(count(*)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('record_customer_order_payment_v2',
      'reverse_customer_order_payment_v2','reverse_cash_shift_with_operations_v2',
      'get_customer_payment_attempt_v1','get_order_financial_position_v1');`),0);
  await fails(`UPDATE phase5_private.authority_generation SET generation=1,authority_state='ACTIVE';`,/PHASE5_PREPARATION_ONLY/u);
  await fails(`DELETE FROM phase5_private.authority_generation;`,/PHASE5_PREPARATION_ONLY/u);
  await fails(`INSERT INTO phase5_private.activation_receipts VALUES(1,'129',repeat('A',64),repeat('B',64),clock_timestamp(),txid_current());`,/PHASE5_PREPARATION_ONLY/u);
  passed.push('generation0, no public new RPC, activation/write barrier rejects even privileged ordinary calls');

  const fixture = await readFile(path.join(root,'scripts/testing/phase3-configurable-parcel-contracts-runtime.sql'),'utf8');
  const start = fixture.indexOf('DO $$'); const end = fixture.indexOf('DO $$',start+5);
  assert.ok(start>0 && end>start); await sql(fixture.slice(0,end));
  const customer = randomUUID();
  await sql(`INSERT INTO public.customers(id,full_name,phone,credit_limit_in_minor_units)
    VALUES(${q(customer)},'Slice5 isolated','0791234567',100000);`);
  const claims = `SELECT set_config('request.jwt.claims','{"sub":"${owner}","role":"authenticated","aal":"aal2"}',false);`;
  if(receiptV2TriggerEffectsFocused) {
    if(sourceTypedValuesFocused)await sourceTypedValuesRuntime(claims);
    else {
      if(!receiptV2ResourceUnionFocused)await receiptV2TriggerEffectsRuntime(claims);
      await receiptV2MultiSourceRuntime(claims);
    }
  } else if(receiptV2PrewriteFocused) {
    await receiptV2PrewriteRuntime(claims);
  } else if(receiptV2AllocationFocused) {
    await receiptV2AllocationRuntime(claims);
  } else if(productAncillaryIdentitiesFocused) {
    await productAncillaryIdentitiesRuntime(claims);
  } else if(receivingFutureIdentitiesFocused) {
    await receivingFutureIdentitiesRuntime(claims);
  } else if(productCreationPrewriteFocused) {
    await productCreationPrewriteRuntime(claims);
  } else if(receivingPrewriteFocused) {
    await receivingPrewriteRuntime(claims);
  } else if(writerAdmissionFocused) {
    await writerAdmissionRuntime(claims);
  } else if(readMarkResourcesOnlyFocused) {
    await readMarkResourcesRuntime(claims);
  } else if(parentSourceFocused) {
    await parentSourceRuntime();
    await stockWriterSourceRuntime(claims);
    if(parentExecuteFocused)await parentExecuteRuntime();
    if(readMarkResourcesFocused)await readMarkResourcesRuntime(claims);
  } else if(stockWriterSourceFocused) {
    await stockWriterSourceRuntime(claims);
  } else if(transportSourceFocused) {
    await transportSourceRuntime();
  } else if(completionIdentityFocused || completionRowsFocused || completionTriggerRowsFocused) {
    await completionSideEffectAdaptersRuntime(claims);
  } else if(inventoryAuthorityFocused) {
    await inventoryAuthorityRuntime(claims);
  } else if(inventorySideEffectPlanFocused || inventoryIdentityFocused) {
    await inventorySideEffectPlanRuntime(claims);
    await completionSideEffectAdaptersRuntime(claims);
    await shiftTriggerIdentityReviewRuntime(claims);
  } else if(shiftTriggerIdentityFocused) {
    await shiftTriggerIdentityReviewRuntime(claims);
  } else {
  const sale = await json(`${claims} SELECT public.create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customer)},
    'Slice5 preparation control','debt',${j([{commercial_line_kind:'base_unit',product_id:product,
    base_quantity:1,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,1000,${q(randomUUID())});`);
  const payment = await json(`${claims} SELECT public.record_customer_order_payment(${q(sale.orderId)},300,'cliq','S5-EXISTING','Current authority control');`);
  assert.equal(payment.success,true);
  assert.equal(await json(`SELECT to_jsonb(amount_paid_in_minor_units) FROM public.orders WHERE id=${q(sale.orderId)};`),300);
  assert.equal(await json(`SELECT to_jsonb(count(*)) FROM phase5_private.collection_attempt_envelopes;`),0);
  passed.push('actual unchanged POS V2 + old public payment remains authoritative, no prepared operational adoption');

  let legacyModernOrder;
  if(!legacyFocused && !shiftPaymentFocused) {
  const before = await fingerprint();
  for (const value of ['0','1','9223372036854775807']) {
    assert.equal((await sql(money(value))).stdout.trim(),value); checks += 1;
  }
  for (const value of [undefined,null,0,1,{},[],true,'','00','01','-1','+1','1.0',' 1','1 ','1e3',
    '9223372036854775808','99999999999999999999']) await fails(money(value));
  passed.push('canonical string money: SQL/JSON NULL, numeric JSON, fractions, signs, whitespace, overflow rejected');

  const key = randomUUID();
  const request = await json(`SELECT phase5_private.normalize_collection_request_v2(${q(owner)},
    ${q(sale.orderId)},300,' CliQ ',' S5-REF ',' notes ',${q(key)});`);
  assert.deepEqual(request,{requestVersion:'phase5-customer-collection-v2',actorId:owner,orderId:sale.orderId,
    action:'customer_collection',idempotencyKey:key,amountInMinorUnits:'300',
    tenderMethod:'cliq',tenderReference:'S5-REF',notes:'notes'});
  for (const notes of ['notes','عربي "سطر"\nثانٍ','😀\t\\',null]) {
    const captured = captureCustomerCollectionRequest({actorId:owner,orderId:sale.orderId,
      idempotencyKey:key,amount:'0.300',method:'cliq',reference:'S5-REF',notes});
    const database = await json(`SELECT jsonb_build_object('text',${j(captured)}::text,
      'fingerprint',upper(public.phase3_request_fingerprint_internal(${j(captured)})));`);
    assert.equal(database.text,customerCollectionPostgresText(captured));
    assert.equal(database.fingerprint,await fingerprintCustomerCollectionRequest(captured));
  }
  passed.push('actual PostgreSQL jsonb text and browser fingerprint parity for ASCII, Arabic, control escapes and emoji');
  const result = {...request,contractVersion:'phase5-customer-collection-result-v2',kind:'COMMITTED_COLLECTION',
    success:true,request,requestFingerprint:await json(`SELECT to_jsonb(upper(public.phase3_request_fingerprint_internal(${j(request)})));`),
    operationId:randomUUID(),originalPaymentId:randomUUID(),collectionId:randomUUID(),paymentNumber:'CRV-S5-TEST',
    outstandingBeforeInMinorUnits:'1000',outstandingAfterInMinorUnits:'700'};
  assert.equal(await json(`SELECT to_jsonb(phase5_private.assert_collection_result_v2(${j(request)},${j(result)}));`),true);
  assertCustomerCollectionResult(request,result.requestFingerprint,result);
  // Pure payload validation is intentionally not proof of durable committed truth.
  const validate = (r,outcome) => `SELECT phase5_private.assert_collection_result_v2(${j(r)},${j(outcome)});`;
  for (const field of Object.keys(request)) {
    const missing = {...request}; delete missing[field]; await fails(validate(missing,result));
    await fails(validate({...request,[field]:null},result));
  }
  for (const r of [{...request,extra:1},{...request,amountInMinorUnits:'0'},
    {...request,amountInMinorUnits:300},{...request,tenderReference:null},
    {...request,tenderMethod:'card'},{...request,notes:''},{...request,idempotencyKey:' '},
    {...request,actorId:'AAAAAAAA-0000-0000-0000-000000000001'},
    {...request,orderId:'00000000-0000-0000-0000-000000000000'}]) {
    await fails(validate(r,result));
  }
  for (const field of Object.keys(result)) {
    const missing = {...result}; delete missing[field]; await fails(validate(request,missing));
    await fails(validate(request,{...result,[field]:null}));
  }
  for (const change of [
    {success:false},{kind:'HISTORICAL_RECEIPT_ONLY'},{kind:'UNSUPPORTED'},
    {actorId:randomUUID()},{orderId:randomUUID()},{idempotencyKey:randomUUID()},
    {action:'replacement'},{amountInMinorUnits:'900'},{amountInMinorUnits:'-1'},
    {outstandingBeforeInMinorUnits:'200',outstandingAfterInMinorUnits:'0'},
    {outstandingAfterInMinorUnits:'701'},{outstandingAfterInMinorUnits:700},
    {requestFingerprint:'A'.repeat(64)},{request:{...request,notes:'different'}},
    {tenderReference:'OTHER'},{paymentNumber:''},{operationId:0},{collectionId:'abc'},{extra:1},
  ]) await fails(validate(request,{...result,...change}));
  const cashRequest = {...request,tenderMethod:'cash',tenderReference:null,notes:null};
  const cashResult = {...result,...cashRequest,request:cashRequest,
    requestFingerprint:await json(`SELECT to_jsonb(upper(public.phase3_request_fingerprint_internal(${j(cashRequest)})));`)};
  assert.equal(await json(`SELECT to_jsonb(phase5_private.assert_collection_result_v2(${j(cashRequest)},${j(cashResult)}));`),true);
  passed.push('exact request/result/key/actor/quantity/tender/arithmetic matrix; legitimate Cash null reference/notes control');
  console.log('Wire/protocol matrix verified; starting source discovery and lock-context proof.');
  assert.equal(await fingerprint(),before);

  // A second legitimate modern sale has NO old unanchored payment. Discovery
  // must use the private source validator, not silently adopt the first sale's
  // old public receipt or public amount_paid projection.
  const plannedSale = await json(`${claims} SELECT public.create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customer)},
    'Slice5 discovery control','debt',${j([{commercial_line_kind:'base_unit',product_id:product,
      base_quantity:1,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,1000,${q(randomUUID())});`);
  const plannedRequest = {...cashRequest,orderId:plannedSale.orderId};
  const otherUnionSale = await json(`${claims} SELECT public.create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customer)},
    'Slice5 union other sale','debt',${j([{commercial_line_kind:'base_unit',product_id:product,
      base_quantity:1,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,1000,${q(randomUUID())});`);
  let discoveryBefore = await fingerprint();
  const plan = await json(`${claims} SELECT phase5_private.discover_collection_write_plan_v2(${j(plannedRequest)});`);
  assert.equal(plan.planState,'DISCOVERED_NOT_LOCKED');
  assert.equal(plan.actorId,owner); assert.equal(plan.orderId,plannedSale.orderId);
  assert.deepEqual(plan.request,plannedRequest);
  assert.equal(plan.position.outstandingTotalInMinorUnits,1000);
  assert.equal(plan.shifts.length,1); assert.equal(plan.shifts[0].mode,'UPDATE');
  assert.equal(plan.shifts[0].row.id,plan.currentShift.id);
  assert.equal(plan.parents.customer.id,customer);
  assert.equal(plan.parents.profiles.some((p) => p.id === owner),true);
  assert.equal(await json(`${claims} SELECT to_jsonb(phase5_private.assert_collection_plan_unchanged_v2(${j(plannedRequest)},${j(plan)}));`),true);
  await fails(`SELECT set_config('request.jwt.claims','{}',false);
    SELECT phase5_private.discover_collection_write_plan_v2(${j(plannedRequest)});`,/PHASE5_COORDINATOR_ACTOR_UNAUTHORIZED/u);
  await fails(`${claims} SELECT phase5_private.discover_collection_write_plan_v2(${j({...plannedRequest,actorId:randomUUID()})});`,/PHASE5_COLLECTION_ACTOR_MISMATCH/u);
  await fails(`${claims} SELECT phase5_private.discover_collection_write_plan_v2(${j({...plannedRequest,amountInMinorUnits:'1001'})});`,/PHASE5_COLLECTION_EXCEEDS_OUTSTANDING/u);
  await fails(`${claims} SELECT phase5_private.discover_collection_write_plan_v2(${j(cashRequest)});`,/PHASE5_/u);
  for (const change of [{...plan,extra:true},{...plan,requestFingerprint:'F'.repeat(64)},
    {...plan,shifts:[]},{...plan,parents:{...plan.parents,profiles:[]}},
    {...plan,order:{...plan.order,customer_id:randomUUID()}},
    {...plan,position:{...plan.position,outstandingTotalInMinorUnits:999}}]) {
    await fails(`${claims} SELECT phase5_private.assert_collection_plan_unchanged_v2(${j(plannedRequest)},${j(change)});`,/40001.*PHASE5_COLLECTION_PLAN_CHANGED_RETRY/u);
  }
  for (const mutation of [
    `UPDATE public.customers SET full_name='Changed parent' WHERE id=${q(customer)};`,
    `UPDATE public.profiles SET full_name='Changed actor' WHERE id=${q(owner)};`,
    `UPDATE public.orders SET internal_notes='Changed order' WHERE id=${q(plannedSale.orderId)};`,
    `UPDATE public.cash_shifts SET opening_cash_in_minor_units=opening_cash_in_minor_units+1 WHERE id=${q(plan.currentShift.id)};`,
  ]) {
    await fails(`${claims} ${mutation} SELECT phase5_private.assert_collection_plan_unchanged_v2(${j(plannedRequest)},${j(plan)});`,/PHASE5_COLLECTION_PLAN_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),discoveryBefore);
  }
  const cliqPlan = await json(`${claims} SELECT phase5_private.discover_collection_write_plan_v2(${j({...plannedRequest,tenderMethod:'cliq',tenderReference:'S5-PLAN-CLIQ'})});`);
  assert.equal(cliqPlan.currentShift,null);
  assert.ok(cliqPlan.shifts.every((s) => s.mode === 'KEY_SHARE'));
  assert.equal(await fingerprint(),discoveryBefore);
  passed.push('authenticated actor derivation, source/entitlement checks, full content-sensitive discovery and fresh relationship-change rejection; discovery does not claim locks or create authority');

  const unionRequests = [plannedRequest,
    {...plannedRequest,idempotencyKey:randomUUID(),amountInMinorUnits:'200'},
    {...plannedRequest,idempotencyKey:randomUUID(),orderId:otherUnionSale.orderId,
      amountInMinorUnits:'250',tenderMethod:'cliq',tenderReference:'S5-UNION-CLIQ'}];
  const unionPlan = await json(`${claims} SELECT phase5_private.discover_collection_union_plan_v1(${j(unionRequests)});`);
  const unionReversed = await json(`${claims} SELECT phase5_private.discover_collection_union_plan_v1(${j([...unionRequests].reverse())});`);
  assert.deepEqual(unionReversed,unionPlan);
  assert.equal(unionPlan.planState,'DISCOVERED_UNION_NOT_LOCKED');
  assert.equal(unionPlan.completeFor,'COLLECTION_CHILD_DISCOVERY_ONLY');
  assert.equal(unionPlan.children.length,3); assert.equal(unionPlan.orders.length,2);
  assert.deepEqual(unionPlan.rootGates,[plannedSale.orderId,otherUnionSale.orderId].sort().map((id) => `phase4-order|${id}`));
  const expectedKeys = unionRequests.flatMap((r) => [owner+':'+r.idempotencyKey,
    `phase5-idempotency|erp_user|${owner}|customer_collection_v1|${r.idempotencyKey}`,
    `phase5-idempotency|erp_user|${owner}|customer_collection_v2|${r.idempotencyKey}`]).sort();
  assert.deepEqual(unionPlan.keyGates,expectedKeys);
  assert.equal(unionPlan.shifts.length,1);
  assert.equal(unionPlan.shifts[0].row.id,plan.currentShift.id);
  assert.equal(unionPlan.shifts[0].mode,'UPDATE');
  assert.deepEqual(unionPlan.capacities,[
    {orderId:plannedSale.orderId,amountInMinorUnits:'500',outstandingBeforeInMinorUnits:'1000',outstandingAfterInMinorUnits:'500'},
    {orderId:otherUnionSale.orderId,amountInMinorUnits:'250',outstandingBeforeInMinorUnits:'1000',outstandingAfterInMinorUnits:'750'},
  ].sort((a,b) => a.orderId.localeCompare(b.orderId)));
  const identity = (n) => n.relation+':'+n.id;
  assert.equal(new Set(unionPlan.resources.map(identity)).size,unionPlan.resources.length);
  assert.equal(new Set(unionPlan.parents.map(identity)).size,unionPlan.parents.length);
  assert.equal(unionPlan.parents.filter((n) => n.relation==='public.customers').length,1);
  const individualPlans = [];
  for (const r of unionRequests) individualPlans.push(await json(`${claims}
    SELECT phase5_private.discover_collection_write_plan_v2(${j(r)});`));
  const independentResources = new Map(individualPlans.flatMap((p) => p.resources).filter((n) => n.kind!=='o')
    .map((n) => [identity(n),{...n,mode:n.kind==='p'?'UPDATE':'SHARE'}]));
  assert.deepEqual(unionPlan.resources,[...independentResources.values()].sort((a,b) =>
    identity(a)<identity(b)?-1:identity(a)>identity(b)?1:0));
  assert.equal(await json(`${claims} SELECT to_jsonb(phase5_private.assert_collection_union_unchanged_v1(${j(unionRequests)},${j(unionPlan)}));`),true);
  checks += 16;
  for (const bad of [null,{},[],[null],[{}],[{...plannedRequest,resources:[]}],
    [{...plannedRequest,actorId:randomUUID()}]]) {
    await fails(`${claims} SELECT phase5_private.discover_collection_union_plan_v1(${j(bad)});`,/PHASE5_/u);
    assert.equal(await fingerprint(),discoveryBefore);
  }
  await fails(`${claims} SELECT phase5_private.discover_collection_union_plan_v1(NULL);`,/UNION_REQUESTS_INVALID/u);
  for (const duplicate of [[plannedRequest,plannedRequest],
    [plannedRequest,{...plannedRequest,orderId:otherUnionSale.orderId,amountInMinorUnits:'200'}]]) {
    await fails(`${claims} SELECT phase5_private.discover_collection_union_plan_v1(${j(duplicate)});`,/23505.*UNION_DUPLICATE_KEY/u);
  }
  // Authorization of all children must precede even an invalid first source lookup.
  await fails(`${claims} SELECT phase5_private.discover_collection_union_plan_v1(${j([
    {...plannedRequest,orderId:randomUUID()}, {...unionRequests[1],actorId:randomUUID()},
  ])});`,/42501.*PHASE5_COLLECTION_ACTOR_MISMATCH/u);
  const boundary = [plannedRequest,{...unionRequests[1],amountInMinorUnits:'700'}];
  assert.equal((await json(`${claims} SELECT phase5_private.discover_collection_union_plan_v1(${j(boundary)});`))
    .capacities[0].outstandingAfterInMinorUnits,'0'); checks += 1;
  await fails(`${claims} SELECT phase5_private.discover_collection_union_plan_v1(${j([
    plannedRequest,{...unionRequests[1],amountInMinorUnits:'701'},
  ])});`,/23514.*UNION_EXCEEDS_OUTSTANDING/u);
  for (const changed of [{...unionPlan,shifts:[]},{...unionPlan,keyGates:[]},
    {...unionPlan,resources:[]},{...unionPlan,parents:[]},{...unionPlan,capacities:[]},
    {...unionPlan,planState:'LOCKED_STANDALONE_COLLECTION'},
    {...unionPlan,children:unionPlan.children.slice(1)}]) {
    await fails(`${claims} SELECT phase5_private.assert_collection_union_unchanged_v1(${j(unionRequests)},${j(changed)});`,/40001.*UNION_CHANGED_RETRY/u);
  }
  for (const mutation of [
    `UPDATE public.customers SET full_name='Union parent drift' WHERE id=${q(customer)};`,
    `UPDATE public.orders SET internal_notes='Union second root drift' WHERE id=${q(otherUnionSale.orderId)};`,
    `UPDATE public.cash_shifts SET opening_cash_in_minor_units=opening_cash_in_minor_units+1 WHERE id=${q(plan.currentShift.id)};`,
  ]) {
    await fails(`${claims} ${mutation} SELECT phase5_private.assert_collection_union_unchanged_v1(${j(unionRequests)},${j(unionPlan)});`,/40001.*UNION_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),discoveryBefore);
  }
  await sql(`BEGIN; ${claims} SELECT phase5_private.discover_collection_union_plan_v1(${j(unionRequests)});
    DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE l.pid=pg_backend_pid() AND l.granted
      AND n.nspname IN ('public','phase5_private') AND l.mode<>'AccessShareLock')
      OR EXISTS (SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory') THEN
      RAISE EXCEPTION 'QA_UNION_DISCOVERY_ACQUIRED_BUSINESS_LOCK'; END IF; END $$; ROLLBACK;`);
  checks += 1; assert.equal(await fingerprint(),discoveryBefore);
  passed.push('collection-child union discovery derives complete child resources from authorized requests: two roots/three intents, sorted identity sets, shared Shift strongest-mode merge, exact cumulative capacity, permutation stability, duplicate/malformed/fabricated plan rejection and fresh source drift; no held-lock certificate/context/business write');

  // Actual supported reservation entrypoint, not manually fabricated modern rows.
  await sql(`UPDATE public.configurable_parcel_feature_settings SET feature_state='ENABLED';
    UPDATE public.storefront_settings SET orders_enabled=true,minimum_order_in_minor_units=0,
      inside_ramtha_delivery_fee_in_minor_units=100,outside_ramtha_delivery_fee_in_minor_units=100;
    INSERT INTO public.inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity)
      SELECT w.id,sku,100,0 FROM public.warehouses w JOIN public.branches b ON b.id=w.branch_id
      CROSS JOIN unnest(ARRAY[${q(product)}::uuid,'92400000-0000-0000-0000-000000000102'::uuid]) sku
      WHERE w.is_active AND b.is_active ON CONFLICT(warehouse_id,product_id) DO UPDATE
        SET on_hand_quantity=public.inventory_balances.on_hand_quantity+100;`);
  const submitted = await json(`SELECT set_config('request.jwt.claim.role','service_role',false);
    SELECT public.submit_guest_customer_order_v2(${q(randomUUID())},repeat('c',64),repeat('d',64),
      'Slice5 pre-completion',${q(`079${String(Math.floor(Math.random()*1e7)).padStart(7,'0')}`)},
      'إربد','الرمثا','الحي الشرقي','شارع الاختبار',NULL,NULL,NULL,NULL,NULL,NULL,
      ${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:2,expected_unit_price_in_minor_units:1000}])},
      NULL,'cash_on_delivery','inside_ramtha',2000,0,100,2100);`);
  await sql(`UPDATE public.orders SET status='ready' WHERE id=${q(submitted.order_id)};
    INSERT INTO public.cash_shifts(id,shift_number,branch_id,opened_by,opening_cash_in_minor_units)
    SELECT ${q(randomUUID())},${q(randomUUID())},o.branch_id,${q(owner)},0 FROM public.orders o
    WHERE o.id=${q(submitted.order_id)} AND NOT EXISTS(SELECT 1 FROM public.cash_shifts s WHERE s.branch_id=o.branch_id AND s.status='open');`);
  const completionKey = randomUUID();
  const completionArgs = `${q(submitted.order_id)},${q(completionKey)},'cash',300,250,NULL,'Parent discovery'`;
  const completionCall = `phase5_private.discover_customer_completion_plan_v1(${completionArgs})`;
  const completionPlan = await json(`${claims} SELECT ${completionCall};`);
  const completionBefore = await fingerprint();
  assert.equal(completionPlan.planState,'DISCOVERED_PARENT_NOT_LOCKED');
  assert.equal(completionPlan.completeFor,'CUSTOMER_COMPLETION_SOURCE_DISCOVERY_ONLY');
  assert.deepEqual(completionPlan.capacity,{merchandiseInMinorUnits:'2000',deliveryInMinorUnits:'250',
    totalInMinorUnits:'2250',collectedInMinorUnits:'300',remainingInMinorUnits:'1950',receiptRequired:true,requiresOpenShift:true});
  assert.equal(completionPlan.expectedSources.length,1);
  assert.equal(completionPlan.expectedSources[0].quantity,2);
  assert.equal(completionPlan.expectedSources[0].productId,product);
  assert.deepEqual(completionPlan.inventoryGates,[`inventory-product:${product}`]);
  const allWarehouseBalances = await json(`SELECT jsonb_agg(to_jsonb(b) ORDER BY product_id,warehouse_id)
    FROM public.inventory_balances b WHERE product_id=${q(product)};`);
  assert.deepEqual(completionPlan.inventory.map((n) => n.row),allWarehouseBalances);
  assert.ok(allWarehouseBalances.length>1,'global SKU domain must cover more than the source warehouse');
  assert.equal(completionPlan.parents.find((n) => n.relation==='public.products' && n.id===product).mode,'NO_KEY_UPDATE');
  assert.equal(await json(`${claims} SELECT to_jsonb(phase5_private.assert_customer_completion_plan_unchanged_v1(${completionArgs},${j(completionPlan)}));`),true);
  const parentChildCall = `phase5_private.discover_customer_completion_union_v1(${completionArgs})`;
  const parentChildPlan = await json(`${claims} SELECT ${parentChildCall};`);
  const parentOwnedIdentity = parentChildPlan.child.identities;
  assert.equal(parentChildPlan.planState,'DISCOVERED_PARENT_CHILD_NOT_LOCKED');
  assert.equal(parentChildPlan.completeFor,'CUSTOMER_COMPLETION_PARENT_CHILD_DISCOVERY_ONLY');
  assert.deepEqual(parentChildPlan.parent,completionPlan);
  assert.equal(parentChildPlan.child.request.amountInMinorUnits,'300');
  assert.equal(parentChildPlan.child.request.notes,'Parent discovery');
  assert.equal(parentChildPlan.child.outstandingBeforeInMinorUnits,'2250');
  assert.equal(parentChildPlan.child.outstandingAfterInMinorUnits,'1950');
  assert.equal(parentChildPlan.child.initialCollectionInMinorUnits,'0');
  assert.equal(parentChildPlan.child.shiftId,completionPlan.shifts[0].row.id);
  assert.equal(parentChildPlan.child.parentCreationOperationId,completionPlan.creation.id);
  assert.equal(parentChildPlan.child.parentRequestFingerprint,completionPlan.requestFingerprint);
  assert.equal(new Set(Object.values(parentOwnedIdentity)).size,4);
  for (const id of Object.values(parentOwnedIdentity)) assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/u);
  assert.equal(parentChildPlan.keyGates.length,4);
  assert.deepEqual(parentChildPlan.keyGates,[...parentChildPlan.keyGates].sort());
  assert.equal(parentChildPlan.expectedAbsent.length,5);
  assert.equal(new Set(parentChildPlan.resources.map((n) => `${n.relation}|${n.id}`)).size,parentChildPlan.resources.length);
  for (const n of [...completionPlan.inventory,...completionPlan.resources,...completionPlan.parents]) {
    const merged = parentChildPlan.resources.find((s) => s.relation===n.relation && s.id===n.id);
    assert.deepEqual(merged.row,n.row); assert.equal(merged.mode,n.mode);
  }
  assert.equal(parentChildPlan.resources.find((n) => n.relation==='public.cash_shifts').mode,'UPDATE');
  const rank5 = parentChildPlan.resources.filter((n) => n.rank===5);
  assert.equal(rank5[0].relation,'public.orders');
  const firstProduct = rank5.findIndex((n) => n.relation==='public.products');
  assert.ok(firstProduct>1);
  assert.ok(rank5.slice(1,firstProduct).every((n) => n.relation==='public.inventory_balances'));
  assert.ok(rank5.slice(firstProduct).every((n) => n.relation==='public.products'));
  assert.deepEqual(rank5.slice(1,firstProduct).map((n) => n.row),allWarehouseBalances);
  checks += 5;
  assert.equal(await json(`${claims} SELECT to_jsonb(phase5_private.assert_customer_completion_union_unchanged_v1(${completionArgs},${j(parentChildPlan)}));`),true);
  assert.equal(await fingerprint(),completionBefore); checks += 24;
  // Same parent attempt keeps the child ownership identity when payload changes;
  // changed request fingerprints do not silently turn recovery into START_NEW.
  const editedParent = await json(`${claims} SELECT phase5_private.discover_customer_completion_union_v1(
    ${q(submitted.order_id)},${q(completionKey)},'cash',301,251,NULL,'Edited parent');`);
  assert.deepEqual(editedParent.child.identities,parentOwnedIdentity);
  assert.equal(editedParent.child.request.idempotencyKey,parentChildPlan.child.request.idempotencyKey);
  assert.notEqual(editedParent.child.requestFingerprint,parentChildPlan.child.requestFingerprint);
  assert.notEqual(editedParent.child.parentRequestFingerprint,parentChildPlan.child.parentRequestFingerprint);
  await fails(`${claims} SELECT phase5_private.assert_customer_completion_union_unchanged_v1(
    ${q(submitted.order_id)},${q(completionKey)},'cash',301,251,NULL,'Edited parent',${j(parentChildPlan)});`,/40001.*COMPLETION_UNION_CHANGED_RETRY/u);
  const newParent = await json(`${claims} SELECT phase5_private.discover_customer_completion_union_v1(
    ${q(submitted.order_id)},${q(randomUUID())},'cash',300,250,NULL,'Parent discovery');`);
  assert.notDeepEqual(newParent.child.identities,parentOwnedIdentity);
  assert.notEqual(newParent.child.request.idempotencyKey,parentChildPlan.child.request.idempotencyKey); checks += 6;
  for (const [method,amount] of [['cash',2250],['debt',0],['cash',0]]) {
    const noChild = await json(`${claims} SELECT phase5_private.discover_customer_completion_union_v1(
      ${q(submitted.order_id)},${q(completionKey)},${q(method)},${amount},250,NULL,NULL);`);
    assert.equal(noChild.child,null); assert.deepEqual(noChild.expectedAbsent,[]);
    assert.equal(noChild.keyGates.length,1); checks += 3;
  }
  const cliqChild = await json(`${claims} SELECT phase5_private.discover_customer_completion_union_v1(
    ${q(submitted.order_id)},${q(completionKey)},'cliq',300,250,'CLIQ-PARENT',NULL);`);
  assert.equal(cliqChild.child.request.tenderMethod,'cliq');
  assert.equal(cliqChild.child.request.tenderReference,'CLIQ-PARENT');
  assert.equal(cliqChild.child.request.notes,'دفعة مستلمة عند تسليم طلب V2');
  assert.deepEqual(cliqChild.child.identities,parentOwnedIdentity); checks += 4;
  for (const parentChildCorruption of [{...parentChildPlan,expectedAbsent:[]},
    {...parentChildPlan,keyGates:completionPlan.keyGates},{...parentChildPlan,resources:[]},
    {...parentChildPlan,child:{...parentChildPlan.child,identities:{...parentOwnedIdentity,paymentId:randomUUID()}}},
    {...parentChildPlan,child:{...parentChildPlan.child,outstandingBeforeInMinorUnits:'300'}},
    {...parentChildPlan,planState:'LOCKED_PARENT_CHILD'}]) {
    await fails(`${claims} SELECT phase5_private.assert_customer_completion_union_unchanged_v1(${completionArgs},${j(parentChildCorruption)});`,/40001.*COMPLETION_UNION_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),completionBefore);
  }
  await fails(`${claims} INSERT INTO public.audit_logs(id,user_id,action,entity_name,entity_id,details)
    VALUES(${q(parentOwnedIdentity.auditId)},${q(owner)},'ISOLATED_IDENTITY_COLLISION','orders',${q(submitted.order_id)},'{}');
    SELECT ${parentChildCall};`,/23505.*CHILD_IDENTITY_OWNED/u);
  assert.equal(await fingerprint(),completionBefore);
  await fails(`${claims} SELECT public.record_customer_order_payment_once(
    ${q(otherUnionSale.orderId)},1,'cash',NULL,'Isolated child-key ownership',${q(parentChildPlan.child.request.idempotencyKey)});
    SELECT ${parentChildCall};`,/23505.*CHILD_IDENTITY_OWNED/u);
  assert.equal(await fingerprint(),completionBefore);
  await fails(`${claims} INSERT INTO phase5_private.financial_operation_events(
    id,operation_type,actor_scope_type,actor_scope_id,idempotency_key,request_fingerprint,
    request_identity_snapshot,result_type,result_snapshot,operation_event_at)
    VALUES(${q(randomUUID())},'customer_collection_v1','erp_user',${q(owner)},${q(randomUUID())},repeat('A',64),
      ${j({orderId:submitted.order_id})},'customer_collection_committed_v1','{}',NOW());
    SELECT ${parentChildCall};`,/23514.*PREEXISTING_FINANCIAL_EVIDENCE/u);
  assert.equal(await fingerprint(),completionBefore);
  for (const mutation of [
    `UPDATE public.customers SET full_name='Merged parent FK drift' WHERE id=${q(submitted.customer_id)};`,
    `UPDATE public.inventory_balances SET on_hand_quantity=on_hand_quantity+1 WHERE product_id=${q(product)};`,
  ]) {
    await fails(`${claims} ${mutation} SELECT phase5_private.assert_customer_completion_union_unchanged_v1(${completionArgs},${j(parentChildPlan)});`,/40001.*COMPLETION_UNION_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),completionBefore);
  }
  await fails(`SELECT set_config('request.jwt.claims','{}',false); SELECT ${parentChildCall};`,/42501.*ACTOR_UNAUTHORIZED/u);
  await sql(`BEGIN; ${claims} SELECT ${parentChildCall}; DO $$ BEGIN IF EXISTS (
    SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE l.pid=pg_backend_pid() AND l.granted AND n.nspname IN ('public','phase5_private') AND l.mode<>'AccessShareLock')
    OR EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory') THEN
      RAISE EXCEPTION 'QA_PARENT_CHILD_DISCOVERY_ACQUIRED_BUSINESS_LOCK'; END IF; END $$; ROLLBACK;`);
  checks += 1; assert.equal(await fingerprint(),completionBefore);
  passed.push('parent-owned deterministic partial child key/identities, exact request and parent binding, pre-completion capacity, merged strongest source/FK/Shift/inventory resources, full/debt/zero no-receipt controls, CliQ discovery only, collision/drift/fabricated plan rejection and AccessShare-only no-write discovery');
  // Generation instrumentation affects ONLY private controls inside rollback.
  // The context barrier remains installed: lock acquisition grants no DML permit.
  const parentInstrument = `${claims}
    ALTER TABLE phase5_private.authority_generation DISABLE TRIGGER phase5_preparation_generation_barrier;
    ALTER TABLE phase5_private.activation_receipts DISABLE TRIGGER phase5_preparation_activation_barrier;
    UPDATE phase5_private.authority_generation SET generation=1,authority_state='ACTIVE';
    INSERT INTO phase5_private.activation_receipts VALUES(1,'128',${q(migrationHash)},
      '9A74EB14788EA668BDE88DAC95561AD8DA2F734EC47EAA87491AB0F181E06099',clock_timestamp(),txid_current());
    ALTER TABLE phase5_private.authority_generation ENABLE TRIGGER phase5_preparation_generation_barrier;
    ALTER TABLE phase5_private.activation_receipts ENABLE TRIGGER phase5_preparation_activation_barrier;`;
  const parentLockCall = `phase5_private.lock_customer_completion_plan_v1(${completionArgs})`;
  await fails(`${claims} SELECT ${parentLockCall};`,/55000.*PHASE5_PREPARATION_ONLY/u);
  await fails(`SELECT set_config('request.jwt.claims','{}',false); SELECT ${parentLockCall};`,/42501.*ACTOR_UNAUTHORIZED/u);
  const authIdentity=completionPlan.parents.find((n) => n.relation==='auth.users' && n.id===owner);
  assert.deepEqual(authIdentity.row,{id:owner}); assert.equal(authIdentity.mode,'KEY_SHARE'); checks+=2;
  const cleanParent = `${parentInstrument} DO $$ DECLARE p jsonb; BEGIN p:=${parentLockCall};
    IF p->>'planState' IS DISTINCT FROM 'LOCKED_PARENT_RESOURCES_ONLY'
      OR p->>'completeFor' IS DISTINCT FROM 'CUSTOMER_COMPLETION_LOCK_ACQUISITION_ONLY'
      OR p->'child' IS DISTINCT FROM ${j(parentChildPlan.child)}
      OR EXISTS(SELECT 1 FROM phase5_private.mutation_contexts WHERE order_id=${q(submitted.order_id)})
      OR EXISTS(SELECT 1 FROM public.customer_payments WHERE order_id=${q(submitted.order_id)}) THEN
      RAISE EXCEPTION 'QA_PARENT_ACQUISITION_AUTHORITY_INVALID'; END IF; END $$;`;
  const parentLockHolder = await holdSQL(cleanParent,'S5-PARENT-LOCK-HOLDER');
  try {
    // A distinct connection proves every row domain is genuinely held.
    for (const resource of parentChildPlan.resources) {
      const predicate=resource.relation==='public.user_roles'
        ? `user_id=${q(resource.row.user_id)} AND role_id=${q(resource.row.role_id)}` : `id=${q(resource.id)}`;
      await fails(`SELECT 1 FROM ${resource.relation} WHERE ${predicate} FOR UPDATE NOWAIT;`,/55P03.*could not obtain lock/u);
    }
    for (const gate of [...parentChildPlan.keyGates,...parentChildPlan.rootGates,
      ...parentChildPlan.sharedGates,...parentChildPlan.inventoryGates]) {
      assert.equal(await json(`BEGIN; SELECT to_jsonb(pg_try_advisory_xact_lock(hashtextextended(${q(gate)},0))); ROLLBACK;`),false);
      checks+=1;
    }
    assert.equal(await json(`SELECT to_jsonb(count(*)) FROM pg_stat_activity
      WHERE application_name='S5-PARENT-LOCK-HOLDER' AND state='idle in transaction';`),1); checks+=1;
  } finally { await parentLockHolder(); }
  assert.equal(await fingerprint(),completionBefore);
  const parentDeadlocksBefore=await json('SELECT to_jsonb(deadlocks) FROM pg_stat_database WHERE datname=current_database();');
  // Opposite schedule: an independent row holder exists BEFORE canonical entry.
  // NOWAIT must yield designed retry, not late upgrade or timeout/deadlock.
  for (const resource of parentChildPlan.resources) {
    const predicate=resource.relation==='public.user_roles'
      ? `user_id=${q(resource.row.user_id)} AND role_id=${q(resource.row.role_id)}` : `id=${q(resource.id)}`;
    const release=await holdSQL(`SELECT 1 FROM ${resource.relation} WHERE ${predicate} FOR UPDATE;`,'S5-PARENT-ROW-FIRST');
    try { await fails(`${parentInstrument} SELECT ${parentLockCall};`,/40001.*COMPLETION_CONTENTION_RETRY/u); }
    finally { await release(); }
    assert.equal(await fingerprint(),completionBefore);
  }
  assert.equal(await json('SELECT to_jsonb(deadlocks) FROM pg_stat_database WHERE datname=current_database();'),parentDeadlocksBefore);
  for (const earlier of [
    `SELECT 1 FROM public.orders WHERE id=${q(submitted.order_id)} FOR KEY SHARE;`,
    `SELECT 1 FROM public.order_items WHERE order_id=${q(submitted.order_id)} FOR UPDATE;`,
    `SELECT id FROM auth.users WHERE id=${q(owner)} FOR KEY SHARE;`,
    'LOCK TABLE phase5_private.mutation_contexts IN ROW EXCLUSIVE MODE;',
    `SELECT pg_advisory_xact_lock(hashtextextended('phase4-order|${submitted.order_id}',0));`,
  ]) {
    await fails(`${parentInstrument} ${earlier} SELECT ${parentLockCall};`,/40001.*COMPLETION_LATE_ENTRY_RETRY/u);
    assert.equal(await fingerprint(),completionBefore);
  }
  for (const [method,amount] of [['cash',2250],['cash',0],['debt',0]]) {
    await sql(`BEGIN; ${parentInstrument} DO $$ DECLARE p jsonb; BEGIN
      p:=phase5_private.lock_customer_completion_plan_v1(${q(submitted.order_id)},${q(completionKey)},${q(method)},${amount},250,NULL,NULL);
      IF p->'child'<>'null'::jsonb OR p->>'planState'<>'LOCKED_PARENT_RESOURCES_ONLY' THEN
        RAISE EXCEPTION 'QA_PARENT_NO_SYNTHETIC_CHILD_INVALID'; END IF; END $$; ROLLBACK;`);
    checks+=1; assert.equal(await fingerprint(),completionBefore);
  }
  passed.push('parent canonical acquisition: authenticated generation0 denial; rollback-only private generation instrument; all exact Shift/Order/global SKU/source/FK/auth row locks and shared advisories observed through independent sessions; row-first contention40001 with sampled deadlockDelta0; late Order/child/auth/context/advisory entry rejected; no context or synthetic full/debt/zero receipt and rollback content equality');
  // Owner-only private function instrumentation is transactional. No public
  // trigger is changed and no context-table DDL lock precedes canonical entry.
  // The deferred parent completion constraint remains enabled and rejects an
  // incomplete parent; this layer does NOT mint operational settlement authority.
  const privateGuardDefinitions = async () => json(`SELECT to_jsonb(md5(
    pg_get_functiondef('phase5_private.reject_preparation_write_v1()'::regprocedure)||
    pg_get_functiondef('phase5_private.guard_collection_control_history_v1()'::regprocedure)||
    pg_get_functiondef('phase5_private.assert_customer_completion_source_tuple_v1(uuid,integer,text,text,jsonb,jsonb)'::regprocedure)||
    pg_get_functiondef('phase5_private.complete_customer_completion_context_v1(uuid)'::regprocedure)));`);
  const privateGuardsBefore=await privateGuardDefinitions();
  const parentContextInstrument = `${parentInstrument}
    CREATE OR REPLACE FUNCTION phase5_private.reject_preparation_write_v1()
    RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $instrument$
    BEGIN IF TG_TABLE_SCHEMA='phase5_private' AND TG_TABLE_NAME='mutation_contexts' AND TG_OP='INSERT' THEN RETURN NEW; END IF;
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_PREPARATION_ONLY'; END $instrument$;`;
  const parentContextMutable = `CREATE OR REPLACE FUNCTION phase5_private.guard_collection_control_history_v1()
    RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $instrument$
    BEGIN IF TG_TABLE_SCHEMA='phase5_private' AND TG_TABLE_NAME='mutation_contexts' AND TG_OP='UPDATE'
      AND OLD.purpose='CUSTOMER_COMPLETION' THEN RETURN NEW; END IF;
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COLLECTION_CONTROL_IMMUTABLE'; END $instrument$;`;
  // Both private UPDATE guards must admit the exact owner fault injection. This
  // only runs AFTER context entry, never enables a public/source mutation path.
  const parentContextFaultBarrier = `CREATE OR REPLACE FUNCTION phase5_private.reject_preparation_write_v1()
    RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $instrument$
    BEGIN IF TG_TABLE_SCHEMA='phase5_private' AND TG_TABLE_NAME='mutation_contexts' AND TG_OP='UPDATE'
      AND OLD.purpose='CUSTOMER_COMPLETION' THEN RETURN NEW; END IF;
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_PREPARATION_ONLY'; END $instrument$;`;
  const parentContextCall=`phase5_private.enter_customer_completion_context_v1(${completionArgs})`;
  const parentContextSetup=`${parentContextInstrument} CREATE TEMP TABLE parent_context_probe AS SELECT ${parentContextCall} id;`;
  const parentContextAssert='phase5_private.assert_customer_completion_context_v1((SELECT id FROM parent_context_probe))';
  await fails(`${claims} SELECT ${parentContextCall};`,/55000.*PREPARATION_ONLY/u);
  await fails(`SELECT set_config('request.jwt.claims','{}',false); SELECT ${parentContextCall};`,/42501.*ACTOR_UNAUTHORIZED/u);
  const frozenParentContext=await json(`BEGIN; ${parentContextSetup} SELECT ${parentContextAssert}; ROLLBACK;`);
  assert.equal(frozenParentContext.purpose,'CUSTOMER_COMPLETION');
  assert.equal(frozenParentContext.locked_plan.planState,'LOCKED_PARENT_PREWRITE_CONTEXT_ONLY');
  assert.deepEqual(frozenParentContext.locked_plan.childReceipt.identities,parentOwnedIdentity);
  assert.deepEqual(frozenParentContext.locked_plan.childReceipt.request,parentChildPlan.child.request);
  assert.equal(frozenParentContext.locked_plan.childReceipt.cashShiftId,parentChildPlan.child.shiftId);
  assert.equal(frozenParentContext.locked_plan.childReceipt.eventAt,frozenParentContext.locked_plan.eventAt);
  assert.deepEqual(frozenParentContext.locked_plan.deltas.financial,{
    collectionCoverageBeforeInMinorUnits:'0',collectionCoverageAfterInMinorUnits:'300',
    outstandingBeforeInMinorUnits:'2250',outstandingAfterInMinorUnits:'1950',receiptRequired:true});
  assert.equal(frozenParentContext.locked_plan.deltas.inventorySteps.length,1);
  const baseStep=frozenParentContext.locked_plan.deltas.inventorySteps[0];
  assert.equal(baseStep.movement.quantity,-2);
  assert.equal(baseStep.balanceAfter.on_hand_quantity,baseStep.balanceBefore.on_hand_quantity-2);
  assert.equal(baseStep.balanceAfter.reserved_quantity,baseStep.balanceBefore.reserved_quantity-2);
  assert.equal(frozenParentContext.locked_plan.deltas.costSteps[0].after.exact_cogs_snapshot_in_minor_units,20.666666);
  assert.equal(frozenParentContext.locked_plan.deltas.costSteps[0].after.cogs_in_minor_units,21);
  checks+=13; assert.equal(await fingerprint(),completionBefore);
  assert.equal(await privateGuardDefinitions(),privateGuardsBefore);
  // Ordinary rediscovery cannot ignore its own/another context. The dedicated
  // assertion ignores precisely its transaction/request-bound metadata row.
  await fails(`${parentContextSetup} SELECT ${parentChildCall};`,/23514.*PREEXISTING_FINANCIAL_EVIDENCE/u);
  await fails(`${parentContextSetup} INSERT INTO phase5_private.mutation_contexts
    SELECT gen_random_uuid(),transaction_id,generation,actor_id,order_id,purpose,operation_id,
      normalized_request,request_fingerprint,locked_plan FROM phase5_private.mutation_contexts;
    SELECT ${parentContextAssert};`,/23514.*PREEXISTING_FINANCIAL_EVIDENCE/u);
  // Parent request has a different authoritative wire type. Standalone permit
  // rejects it at that earliest boundary, before it could adopt its purpose.
  await fails(`${parentContextSetup} SELECT phase5_private.assert_collection_permit_v1((SELECT id FROM parent_context_probe));`,/22023.*PHASE5_WIRE_KEYS_INVALID/u);
  await fails(`${parentContextSetup} UPDATE phase5_private.mutation_contexts SET transaction_id=transaction_id+1;`,/PHASE5_COLLECTION_CONTROL_IMMUTABLE|PHASE5_PREPARATION_ONLY/u);
  await fails(`${parentContextSetup} SET CONSTRAINTS ALL IMMEDIATE;`,/55000.*PARENT_COMPLETION_NOT_PREPARED/u);
  for (const parentContextCorruption of [
    'transaction_id=transaction_id+1',"purpose='CUSTOMER_COLLECTION'",
    'operation_id=gen_random_uuid()',"request_fingerprint=repeat('B',64)",
    "normalized_request=jsonb_set(normalized_request,'{notes}','\"altered\"')",
    "locked_plan=locked_plan-'sourcePlan'",
    "locked_plan=jsonb_set(locked_plan,'{deltas,inventorySteps}','[]')",
    "locked_plan=jsonb_set(locked_plan,'{deltas,costSteps}','[]')",
    "locked_plan=jsonb_set(locked_plan,'{movementIds}','{}')",
    "locked_plan=jsonb_set(locked_plan,'{eventAt}','null')",
    "locked_plan=jsonb_set(locked_plan,'{childReceipt,requestFingerprint}','\"wrong\"')",
    "locked_plan=jsonb_set(locked_plan,'{childReceipt,cashShiftId}','null')",
    "locked_plan=jsonb_set(locked_plan,'{childReceipt,eventAt}','\"2000-01-01T00:00:00.000000Z\"')",
    "locked_plan=jsonb_set(locked_plan,'{parentAuditId}',locked_plan->'operationId')",
  ]) {
    await fails(`${parentContextSetup} ${parentContextMutable} ${parentContextFaultBarrier}
      UPDATE phase5_private.mutation_contexts SET ${parentContextCorruption} WHERE id=(SELECT id FROM parent_context_probe);
      SELECT ${parentContextAssert};`,/PHASE5_PARENT_|PHASE5_COMPLETION_|PHASE5_WIRE_/u);
    assert.equal(await fingerprint(),completionBefore);
    assert.equal(await privateGuardDefinitions(),privateGuardsBefore);
  }
  await fails(`${parentContextSetup} ${parentContextMutable} ${parentContextFaultBarrier}
    UPDATE phase5_private.mutation_contexts SET generation=2;
    SELECT ${parentContextAssert};`,/23514.*mutation_contexts_generation_check/u);
  assert.equal(await fingerprint(),completionBefore);
  for (const mutation of [
    `UPDATE public.customers SET full_name='Context FK drift' WHERE id=${q(submitted.customer_id)};`,
    `UPDATE public.products SET wac_cost_in_minor_units_exact=123.123456 WHERE id=${q(product)};`,
    `UPDATE public.inventory_balances SET on_hand_quantity=on_hand_quantity+1 WHERE product_id=${q(product)};`,
  ]) {
    await fails(`${parentContextSetup} ${mutation} SELECT ${parentContextAssert};`,/40001.*PARENT_CONTEXT_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),completionBefore);
  }
  for (const [method,amount,reference] of [['cash',2250,null],['debt',0,null],['cash',0,null],['cliq',300,'CLIQ-PARENT']]) {
    const control=await json(`BEGIN; ${parentContextInstrument} CREATE TEMP TABLE parent_context_probe AS
      SELECT phase5_private.enter_customer_completion_context_v1(${q(submitted.order_id)},${q(completionKey)},${q(method)},${amount},250,${reference ? q(reference) : 'NULL'},NULL) id;
      SELECT ${parentContextAssert}; ROLLBACK;`);
    if (method==='cliq') {
      assert.equal(control.locked_plan.childReceipt.cashShiftId,null);
      assert.equal(control.locked_plan.childReceipt.request.tenderMethod,'cliq'); checks+=2;
    } else { assert.equal(control.locked_plan.childReceipt,null); checks+=1; }
    assert.equal(await fingerprint(),completionBefore);
  }
  assert.equal(await privateGuardDefinitions(),privateGuardsBefore); checks+=1;
  passed.push('parent prewrite context: server identities/time/partial receipt and frozen source/cost/running deltas; exact self-context-only rediscovery; corruption/drift/standalone-purpose misuse rejected; incomplete deferred parent rejected55000; full/debt/zero no receipt and CliQ no fake Cash Shift; private instrumentation restored with content-identical rollback, no parent source executor authority');
  checks += 10;
  for (const [method,amount,delivery,reference] of [['cash',2250,250,null],['cash',null,null,null],
    ['debt',999,null,null],['cash',0,null,null],['cliq',300,null,'PARENT-CLIQ'],['cash_on_delivery',300,250,null]]) {
    const control = await json(`${claims} SELECT phase5_private.discover_customer_completion_plan_v1(
      ${q(submitted.order_id)},${q(completionKey)},${q(method)},${amount ?? 'NULL'},${delivery ?? 'NULL'},${reference ? q(reference) : 'NULL'},NULL);`);
    assert.equal(control.capacity.receiptRequired,Number(control.capacity.collectedInMinorUnits)>0
      && Number(control.capacity.collectedInMinorUnits)<Number(control.capacity.totalInMinorUnits)); checks += 1;
  }
  for (const args of [`NULL,${q(completionKey)},'cash',300,250,NULL,NULL`,
    `${q(submitted.order_id)},NULL,'cash',300,250,NULL,NULL`,
    `${q(submitted.order_id)},'short','cash',300,250,NULL,NULL`,
    `${q(submitted.order_id)},${q(completionKey)},NULL,300,250,NULL,NULL`,
    `${q(submitted.order_id)},${q(completionKey)},'card',300,250,NULL,NULL`,
    `${q(submitted.order_id)},${q(completionKey)},'cash',-1,250,NULL,NULL`,
    `${q(submitted.order_id)},${q(completionKey)},'cash',300,-1,NULL,NULL`,
    `${q(submitted.order_id)},${q(completionKey)},'cash',2251,250,NULL,NULL`,
    `${q(submitted.order_id)},${q(completionKey)},'cliq',300,250,NULL,NULL`,
    `${q(submitted.order_id)},${q(completionKey)},'cash',300,9223372036854775807,NULL,NULL`,
    `${q(plannedSale.orderId)},${q(completionKey)},'cash',300,250,NULL,NULL`]) {
    await fails(`${claims} SELECT phase5_private.discover_customer_completion_plan_v1(${args});`,/PHASE5_COMPLETION_/u);
    assert.equal(await fingerprint(),completionBefore);
  }
  const completionDrift = [
    `UPDATE public.products SET wac_cost_in_minor_units_exact=wac_cost_in_minor_units_exact+1 WHERE id=${q(product)};`,
    `UPDATE public.orders SET internal_notes='Parent source drift' WHERE id=${q(submitted.order_id)};`,
    `UPDATE public.inventory_balances SET on_hand_quantity=on_hand_quantity+1 WHERE product_id=${q(product)};`,
    `UPDATE public.customers SET full_name='Parent customer drift' WHERE id=${q(submitted.customer_id)};`,
    `UPDATE public.cash_shifts SET opening_cash_in_minor_units=opening_cash_in_minor_units+1 WHERE id=${q(completionPlan.shifts[0].row.id)};`,
    `INSERT INTO public.warehouses(id,branch_id,code,name_ar,is_active)
      VALUES('92400000-0000-0000-0000-000000000999',${q(branch)},'S5-LATE-WH','New discovered resource',true);
      INSERT INTO public.inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity)
      VALUES('92400000-0000-0000-0000-000000000999',${q(product)},10,0);`,
  ];
  for (const mutation of completionDrift) {
    await fails(`${claims} ${mutation} SELECT phase5_private.assert_customer_completion_plan_unchanged_v1(${completionArgs},${j(completionPlan)});`,/40001.*COMPLETION_PLAN_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),completionBefore);
  }
  for (const fabricated of [{...completionPlan,inventory:[]},{...completionPlan,expectedSources:[]},
    {...completionPlan,capacity:{...completionPlan.capacity,totalInMinorUnits:'999'}},
    {...completionPlan,planState:'LOCKED_PARENT'},{...completionPlan,parents:[]}]) {
    await fails(`${claims} SELECT phase5_private.assert_customer_completion_plan_unchanged_v1(${completionArgs},${j(fabricated)});`,/40001.*COMPLETION_PLAN_CHANGED_RETRY/u);
    assert.equal(await fingerprint(),completionBefore);
  }
  // Privileged disposable fault state rolls back; no public guard is disabled.
  await fails(`${claims} UPDATE public.order_inventory_reservations SET reserved_quantity=1 WHERE order_id=${q(submitted.order_id)};
    SELECT ${completionCall};`,/RESERVATION_IDENTITY_IMMUTABLE/u);
  assert.equal(await fingerprint(),completionBefore);
  await fails(`${claims} UPDATE public.order_inventory_reservations SET reservation_state='released',resolved_at=NOW()
    WHERE order_id=${q(submitted.order_id)}; SELECT ${completionCall};`,/RESERVATION_IDENTITY_INVALID/u);
  assert.equal(await fingerprint(),completionBefore);
  await fails(`${claims} UPDATE public.inventory_balances SET reserved_quantity=0 WHERE product_id=${q(product)};
    SELECT ${completionCall};`,/COMPLETION_INVENTORY_INVALID/u);
  assert.equal(await fingerprint(),completionBefore);
  for (const method of ['cash','cliq','cash_on_delivery',' debt ']) {
    await fails(`${claims} UPDATE public.cash_shifts SET status='cancelled',cancelled_at=NOW(),cancelled_by=${q(owner)},
      cancellation_reason='Isolated closed-source probe' WHERE id=${q(completionPlan.shifts[0].row.id)};
      SELECT phase5_private.discover_customer_completion_plan_v1(${q(submitted.order_id)},${q(completionKey)},${q(method)},0,0,NULL,NULL);`,/COMPLETION_OPEN_SHIFT_REQUIRED/u);
    assert.equal(await fingerprint(),completionBefore);
  }
  await sql(`BEGIN; ${claims} UPDATE public.cash_shifts SET status='cancelled',cancelled_at=NOW(),cancelled_by=${q(owner)},
    cancellation_reason='Isolated optional Shift probe' WHERE id=${q(completionPlan.shifts[0].row.id)};
    DO $$ DECLARE p jsonb; BEGIN p:=phase5_private.discover_customer_completion_plan_v1(
      ${q(submitted.order_id)},${q(completionKey)},'debt',0,0,NULL,NULL);
      IF p->'shifts'<>'[]'::jsonb OR p->'capacity'->>'collectedInMinorUnits'<>'0' THEN
        RAISE EXCEPTION 'QA_DEBT_DISCOVERY_INVALID'; END IF; END $$; ROLLBACK;`);
  checks += 1; assert.equal(await fingerprint(),completionBefore);
  await fails(`SELECT set_config('request.jwt.claims','{}',false); SELECT ${completionCall};`,/42501.*ACTOR_UNAUTHORIZED/u);
  await sql(`BEGIN; ${claims} SELECT ${completionCall}; DO $$ BEGIN IF EXISTS (
    SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE l.pid=pg_backend_pid() AND l.granted AND n.nspname IN ('public','phase5_private') AND l.mode<>'AccessShareLock')
    OR EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory') THEN
    RAISE EXCEPTION 'QA_PARENT_DISCOVERY_ACQUIRED_BUSINESS_LOCK'; END IF; END $$; ROLLBACK;`);
  checks += 1; assert.equal(await fingerprint(),completionBefore);
  passed.push('actual Customer V2 pre-completion source discovery: independent immutable sale/quantity anchors, explicit delivery/partial/full/debt capacity, all-warehouse SKU resources, original zero-amount Shift predicate, exact fresh drift and no mutation/held-lock authority');
  const mixedSubmitted = await json(`SELECT set_config('request.jwt.claim.role','service_role',false);
    SELECT public.submit_guest_customer_order_v2(${q(randomUUID())},repeat('c',64),repeat('d',64),
      'Slice5 mixed parent',${q(`079${String(Math.floor(Math.random()*1e7)).padStart(7,'0')}`)},
      'إربد','الرمثا','الحي الشرقي','شارع الاختبار',NULL,NULL,NULL,NULL,NULL,NULL,
      ${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:2,expected_unit_price_in_minor_units:1000},
        {commercial_line_kind:'configurable_parcel',family_product_id:'92400000-0000-0000-0000-000000000100',
          parcel_configuration_id:'92400000-0000-0000-0000-000000000300',configuration_revision:1,
          expected_unit_price_in_minor_units:5000,parcel_instances:[{components:[
            {product_id:product,base_quantity:2},{product_id:'92400000-0000-0000-0000-000000000102',base_quantity:3}]}]}])},
      NULL,'cash_on_delivery','inside_ramtha',7000,0,100,7100);`);
  await sql(`UPDATE public.orders SET status='ready' WHERE id=${q(mixedSubmitted.order_id)};`);
  const mixedArgs = `${q(mixedSubmitted.order_id)},${q(randomUUID())},'cash',300,NULL,NULL,NULL`;
  const mixedPlan = await json(`${claims} SELECT phase5_private.discover_customer_completion_plan_v1(${mixedArgs});`);
  const mixedBefore = await fingerprint();
  assert.equal(mixedPlan.expectedSources.length,3);
  assert.deepEqual(mixedPlan.expectedSources.filter((s) => s.componentId!==null).map((s) =>
    ({product:s.productId,qty:s.quantity})).sort((a,b) => a.product.localeCompare(b.product)),[
    {product,qty:2},{product:'92400000-0000-0000-0000-000000000102',qty:3}]);
  assert.equal(mixedPlan.resources.filter((n) => n.relation==='public.order_parcel_components').length,2);
  assert.equal(mixedPlan.inventoryGates.length,2);
  assert.equal(await json(`${claims} SELECT to_jsonb(phase5_private.assert_customer_completion_plan_unchanged_v1(${mixedArgs},${j(mixedPlan)}));`),true);
  assert.equal(await fingerprint(),mixedBefore); checks += 6;
  const mixedParentContext=await json(`BEGIN; ${parentContextInstrument} CREATE TEMP TABLE parent_context_probe AS
    SELECT phase5_private.enter_customer_completion_context_v1(${mixedArgs}) id;
    SELECT ${parentContextAssert}; ROLLBACK;`);
  const mixedParentDeltas=mixedParentContext.locked_plan.deltas;
  const aSteps=mixedParentDeltas.inventorySteps.filter((n) => n.movement.product_id===product);
  const bSteps=mixedParentDeltas.inventorySteps.filter((n) => n.movement.product_id==='92400000-0000-0000-0000-000000000102');
  assert.equal(aSteps.length,2); assert.equal(bSteps.length,1);
  assert.deepEqual(aSteps[0].balanceAfter,aSteps[1].balanceBefore);
  assert.equal(aSteps[1].balanceAfter.on_hand_quantity,aSteps[0].balanceBefore.on_hand_quantity-4);
  assert.equal(bSteps[0].movement.quantity,-3);
  assert.equal(new Set(mixedParentDeltas.inventorySteps.map((n) => n.reservationId)).size,3);
  const componentCosts=mixedParentDeltas.costSteps.filter((n) => n.relation==='public.order_parcel_components')
    .sort((a,b) => a.after.product_id.localeCompare(b.after.product_id));
  assert.deepEqual(componentCosts.map((n) => n.after.exact_cogs_snapshot_in_minor_units),[20.666666,17.000001]);
  assert.deepEqual(componentCosts.map((n) => n.after.cogs_snapshot_in_minor_units),[21,17]);
  assert.equal(mixedParentDeltas.costSteps.find((n) => n.relation==='public.order_parcel_instances').after.cogs_snapshot_in_minor_units,38);
  const mixedMovementKeys=Object.keys(mixedParentContext.locked_plan.movementIds);
  assert.equal(mixedMovementKeys.length,3);
  assert.equal(new Set(Object.values(mixedParentContext.locked_plan.movementIds)).size,3); checks+=11;
  await fails(`${parentContextInstrument} CREATE TEMP TABLE parent_context_probe AS
    SELECT phase5_private.enter_customer_completion_context_v1(${mixedArgs}) id;
    ${parentContextMutable} ${parentContextFaultBarrier}
    UPDATE phase5_private.mutation_contexts SET locked_plan=jsonb_set(locked_plan,
      ARRAY['movementIds',${q(mixedMovementKeys[1])}],locked_plan->'movementIds'->${q(mixedMovementKeys[0])});
    SELECT ${parentContextAssert};`,/23514.*PARENT_IDENTITY_DUPLICATE/u);
  assert.equal(await fingerprint(),mixedBefore);
  assert.equal(await privateGuardDefinitions(),privateGuardsBefore);
  passed.push('mixed parent frozen delta model: shared-SKU reservations use prior per-identity running balance; closed114 exact per-instance residual cost21/17 total38 and Base cost21; duplicate minted movement UUID rejected without source writes');
  // Privileged rollback-only inventory-stage fixture, NOT a prepared parent
  // source executor. Public cost/lifecycle guards are never disabled/replaced.
  // The immutable prewrite context exists BEFORE all injected source rows.
  const parentInventoryCall='phase5_private.validate_customer_completion_inventory_v1((SELECT id FROM parent_context_probe))';
  const parentInventoryStage=`${parentContextInstrument} CREATE TEMP TABLE parent_context_probe AS
    SELECT phase5_private.enter_customer_completion_context_v1(${mixedArgs}) id;
    SELECT ${parentContextAssert};
    DO $stage$ DECLARE c jsonb; s jsonb; BEGIN
      SELECT to_jsonb(t) INTO STRICT c FROM phase5_private.mutation_contexts t WHERE id=(SELECT id FROM parent_context_probe);
      FOR s IN SELECT value FROM jsonb_array_elements(c->'locked_plan'->'deltas'->'inventorySteps') LOOP
        IF (SELECT to_jsonb(b) FROM public.inventory_balances b WHERE id=(s->>'balanceId')::uuid)
          IS DISTINCT FROM s->'balanceBefore' THEN RAISE EXCEPTION 'QA_INVENTORY_PREFIX_INVALID'; END IF;
        UPDATE public.inventory_balances SET on_hand_quantity=(s->'balanceAfter'->>'on_hand_quantity')::bigint,
          reserved_quantity=(s->'balanceAfter'->>'reserved_quantity')::bigint,
          updated_at=(s->'balanceAfter'->>'updated_at')::timestamptz WHERE id=(s->>'balanceId')::uuid;
        UPDATE public.order_inventory_reservations SET reservation_state='consumed',
          resolved_at=(s->'reservationAfter'->>'resolved_at')::timestamptz WHERE id=(s->>'reservationId')::uuid;
        INSERT INTO public.inventory_movements SELECT (jsonb_populate_record(NULL::public.inventory_movements,
          s->'movement'||jsonb_build_object('id',c->'locked_plan'->'movementIds'->(s->>'reservationId'),
            'mutation_sequence',c->'locked_plan'->'movementSequences'->(s->>'reservationId')))).*;
      END LOOP;
    END $stage$;`;
  await fails(`${parentContextInstrument} CREATE TEMP TABLE parent_context_probe AS
    SELECT phase5_private.enter_customer_completion_context_v1(${mixedArgs}) id;
    SELECT ${parentInventoryCall};`,/23514.*PARENT_INVENTORY_RESERVATION_INVALID/u);
  const inventoryProof=await json(`BEGIN; ${parentInventoryStage} SELECT ${parentInventoryCall}; ROLLBACK;`);
  assert.equal(inventoryProof.proofKind,'DURABLE_INVENTORY_STAGE_ONLY');
  assert.equal(Object.keys(inventoryProof.movementIds).length,3); checks+=2;
  assert.equal(await fingerprint(),mixedBefore); checks+=1;
  // Row-count preserving tuple substitution and ownership variants are distinct
  // from aggregate capacity tests. Every rejection restores the FULL content.
  const firstMovement=`(SELECT value::uuid FROM phase5_private.mutation_contexts c,
    LATERAL jsonb_each_text(c.locked_plan->'movementIds') WHERE c.id=(SELECT id FROM parent_context_probe)
    ORDER BY key LIMIT 1)`;
  const firstReservation=`(SELECT key::uuid FROM phase5_private.mutation_contexts c,
    LATERAL jsonb_each_text(c.locked_plan->'movementIds') WHERE c.id=(SELECT id FROM parent_context_probe)
    ORDER BY key LIMIT 1)`;
  const parentInventoryCorruption=[
    ['missing-expected-movement',`DELETE FROM public.inventory_movements WHERE id=${firstMovement};`,/PARENT_INVENTORY_INCOMPLETE/u],
    ['row-count-preserving-quantity',`UPDATE public.inventory_movements SET quantity=quantity-1 WHERE id=${firstMovement};`,/PARENT_INVENTORY_MOVEMENT_INVALID/u],
    ['row-count-preserving-balance',`UPDATE public.inventory_movements SET balance_before=balance_before+1 WHERE id=${firstMovement};`,/PARENT_INVENTORY_MOVEMENT_INVALID/u],
    ['same-quantity-source-substitution',`UPDATE public.inventory_movements SET reservation_id=NULL WHERE id=${firstMovement};`,/PARENT_INVENTORY_MOVEMENT_INVALID/u],
    ['wrong-operation',`UPDATE public.inventory_movements SET operation_id=${q(sale.operationId)},
      parcel_component_id=NULL,reservation_id=NULL WHERE id=${firstMovement};`,/PARENT_INVENTORY_MOVEMENT_INVALID/u],
    ['wrong-reference',`UPDATE public.inventory_movements SET reference_id=${q(sale.orderId)} WHERE id=${firstMovement};`,/PARENT_INVENTORY_MOVEMENT_INVALID/u],
    ['invalid-reservation-state','',/PARENT_INVENTORY_RESERVATION_INVALID/u],
    ['wrong-resolved-time','',/PARENT_INVENTORY_RESERVATION_INVALID/u],
    ['extra-operation-movement',`INSERT INTO public.inventory_movements SELECT (jsonb_populate_record(NULL::public.inventory_movements,
      to_jsonb(m)||jsonb_build_object('id',gen_random_uuid(),'mutation_sequence',NULL))).* FROM public.inventory_movements m WHERE id=${firstMovement};`,/PARENT_INVENTORY_SET_INVALID/u],
    ['extra-alternate-reference-movement',`INSERT INTO public.inventory_movements SELECT (jsonb_populate_record(NULL::public.inventory_movements,
      to_jsonb(m)||jsonb_build_object('id',gen_random_uuid(),'reference_type','adjustment','reference_id',NULL,
        'reservation_id',NULL,'parcel_component_id',NULL,'mutation_sequence',NULL))).* FROM public.inventory_movements m WHERE id=${firstMovement};`,/PARENT_INVENTORY_SET_INVALID/u],
  ];
  for (const [label,mutation,pattern] of parentInventoryCorruption) {
    // A terminal reservation is immutable under112. Inject bad state/time on
    // the still-active first transition, not by bypassing its retained guard.
    let corruptedStage=parentInventoryStage;
    if (label==='invalid-reservation-state') {
      corruptedStage=corruptedStage.replace("reservation_state='consumed'",
        `reservation_state=CASE WHEN id=${firstReservation} THEN 'released' ELSE 'consumed' END`);
    } else if (label==='wrong-resolved-time') {
      corruptedStage=corruptedStage.replace("resolved_at=(s->'reservationAfter'->>'resolved_at')::timestamptz",
        `resolved_at=(s->'reservationAfter'->>'resolved_at')::timestamptz+
          CASE WHEN id=${firstReservation} THEN interval '1 microsecond' ELSE interval '0' END`);
    }
    await fails(`${corruptedStage} ${mutation} SELECT ${parentInventoryCall};`,pattern);
    assert.equal(await fingerprint(),mixedBefore,label); checks+=1;
    assert.equal(await privateGuardDefinitions(),privateGuardsBefore,label); checks+=1;
  }
  // The primitive does not rebase historic movement/cost on current balances,
  // WAC, open Shift, transaction identity or new-generation eligibility.
  const historicalInventory=await json(`BEGIN; ${parentInventoryStage}
    UPDATE public.inventory_balances SET on_hand_quantity=on_hand_quantity+7 WHERE product_id=${q(product)};
    UPDATE public.products SET wac_cost_in_minor_units_exact=777,cost_price_in_minor_units=777 WHERE id=${q(product)};
    SELECT ${parentInventoryCall}; ROLLBACK;`);
  assert.equal(historicalInventory.proofKind,'DURABLE_INVENTORY_STAGE_ONLY'); checks+=1;
  assert.equal(await fingerprint(),mixedBefore); checks+=1;
  await fails(`${parentInventoryStage} SELECT ${parentInventoryCall}; SET CONSTRAINTS ALL IMMEDIATE;`,
    /55000.*PARENT_COMPLETION_NOT_PREPARED/u);
  assert.equal(await fingerprint(),mixedBefore); checks+=1;
  passed.push('parent durable inventory-stage per-reservation exact tuple/ownership union: missing/extra/alternate-reference and row-count-preserving corruption rejected; historical-balance-and-WAC-drift never rebases evidence; full rollback restores content and private guards; stage proof cannot commit incomplete parent');
  // Separate rollback-only cost stage using the ACTUAL closed116 private guard
  // rows + server selector. No public trigger/body/constraint is disabled. A
  // caller selector alone is deliberately insufficient. This is fixture work,
  // not a new admitted parent executor or an operational completion claim.
  const parentCostCall='phase5_private.validate_customer_completion_cost_v1((SELECT id FROM parent_context_probe))';
  const parentCostApply=`DO $coststage$ DECLARE c jsonb; s jsonb; BEGIN
    SELECT to_jsonb(t) INTO STRICT c FROM phase5_private.mutation_contexts t WHERE id=(SELECT id FROM parent_context_probe);
    PERFORM set_config('nawasrah.customer_cost_finalization_operation_id',c->>'operation_id',true);
    FOR s IN SELECT value FROM jsonb_array_elements(c->'locked_plan'->'deltas'->'costSteps') LOOP
      INSERT INTO public.phase3_customer_cost_finalization_guards(transaction_id,lifecycle_operation_id,order_id,row_kind,row_id)
        VALUES(pg_current_xact_id(),(c->>'operation_id')::uuid,(c->>'order_id')::uuid,
          CASE s->>'relation' WHEN 'public.order_items' THEN 'order_item'
            WHEN 'public.order_parcel_instances' THEN 'parcel_instance' ELSE 'parcel_component' END,(s->>'id')::uuid);
      CASE s->>'relation'
        WHEN 'public.order_parcel_components' THEN
          UPDATE public.order_parcel_components SET
            unit_cost_snapshot_in_minor_units=(s->'after'->>'unit_cost_snapshot_in_minor_units')::numeric,
            cogs_snapshot_in_minor_units=(s->'after'->>'cogs_snapshot_in_minor_units')::bigint,
            exact_cogs_snapshot_in_minor_units=(s->'after'->>'exact_cogs_snapshot_in_minor_units')::numeric,
            cost_finalized_at=(s->'after'->>'cost_finalized_at')::timestamptz WHERE id=(s->>'id')::uuid;
        WHEN 'public.order_parcel_instances' THEN
          UPDATE public.order_parcel_instances SET
            cogs_snapshot_in_minor_units=(s->'after'->>'cogs_snapshot_in_minor_units')::bigint,
            exact_cogs_snapshot_in_minor_units=(s->'after'->>'exact_cogs_snapshot_in_minor_units')::numeric,
            cost_finalized_at=(s->'after'->>'cost_finalized_at')::timestamptz WHERE id=(s->>'id')::uuid;
        WHEN 'public.order_items' THEN
          UPDATE public.order_items SET
            unit_cost_snapshot_in_minor_units_exact=(s->'after'->>'unit_cost_snapshot_in_minor_units_exact')::numeric,
            exact_cogs_snapshot_in_minor_units=(s->'after'->>'exact_cogs_snapshot_in_minor_units')::numeric,
            unit_cost_in_minor_units=(s->'after'->>'unit_cost_in_minor_units')::bigint,
            cogs_in_minor_units=(s->'after'->>'cogs_in_minor_units')::bigint,
            profit_in_minor_units=(s->'after'->>'profit_in_minor_units')::bigint,
            cost_finalized_at=(s->'after'->>'cost_finalized_at')::timestamptz WHERE id=(s->>'id')::uuid;
      END CASE;
    END LOOP;
    DELETE FROM public.phase3_customer_cost_finalization_guards WHERE transaction_id=pg_current_xact_id()
      AND lifecycle_operation_id=(c->>'operation_id')::uuid;
  END $coststage$;`;
  const parentCostStage=parentInventoryStage+parentCostApply;
  await fails(`${parentInventoryStage} SELECT ${parentCostCall};`,/23514.*PARENT_COST_TUPLE_INVALID/u);
  const costProof=await json(`BEGIN; ${parentCostStage} SELECT ${parentCostCall}; ROLLBACK;`);
  assert.equal(costProof.proofKind,'DURABLE_COST_STAGE_ONLY');
  assert.equal(costProof.costIdentities.length,5); checks+=2;
  assert.equal(await fingerprint(),mixedBefore); checks+=1;
  const parentCostCorruption=[
    ['component-exact-cost',"exact_cogs_snapshot_in_minor_units=(s->'after'->>'exact_cogs_snapshot_in_minor_units')::numeric",
      "exact_cogs_snapshot_in_minor_units=(s->'after'->>'exact_cogs_snapshot_in_minor_units')::numeric+0.000001"],
    ['component-rounded-cost',"cogs_snapshot_in_minor_units=(s->'after'->>'cogs_snapshot_in_minor_units')::bigint",
      "cogs_snapshot_in_minor_units=(s->'after'->>'cogs_snapshot_in_minor_units')::bigint+1"],
    ['component-unit-cost',"unit_cost_snapshot_in_minor_units=(s->'after'->>'unit_cost_snapshot_in_minor_units')::numeric",
      "unit_cost_snapshot_in_minor_units=(s->'after'->>'unit_cost_snapshot_in_minor_units')::numeric+1"],
    ['item-unit-cost',"unit_cost_snapshot_in_minor_units_exact=(s->'after'->>'unit_cost_snapshot_in_minor_units_exact')::numeric",
      "unit_cost_snapshot_in_minor_units_exact=(s->'after'->>'unit_cost_snapshot_in_minor_units_exact')::numeric+1"],
    ['item-profit',"profit_in_minor_units=(s->'after'->>'profit_in_minor_units')::bigint",
      "profit_in_minor_units=(s->'after'->>'profit_in_minor_units')::bigint+1"],
    ['cost-time',"cost_finalized_at=(s->'after'->>'cost_finalized_at')::timestamptz",
      "cost_finalized_at=(s->'after'->>'cost_finalized_at')::timestamptz+interval '1 microsecond'"],
    ['missing-cost-finalization',"FOR s IN SELECT value FROM jsonb_array_elements(c->'locked_plan'->'deltas'->'costSteps') LOOP",
      "FOR s IN SELECT value FROM jsonb_array_elements(c->'locked_plan'->'deltas'->'costSteps') OFFSET 1 LOOP"],
  ];
  for (const [label,from,to] of parentCostCorruption) {
    assert.ok(parentCostApply.includes(from),label);
    await fails(`${parentInventoryStage}${parentCostApply.replace(from,to)} SELECT ${parentCostCall};`,/23514.*PARENT_COST_TUPLE_INVALID/u);
    assert.equal(await fingerprint(),mixedBefore,label); checks+=1;
    assert.equal(await privateGuardDefinitions(),privateGuardsBefore,label); checks+=1;
  }
  // Extra actual row is NOT found by following expected IDs. Same root and
  // product do not authorize it; totals are not used as identity proof.
  const costExtraLabel='extra-cost-item';
  await fails(`${parentCostStage} INSERT INTO public.order_items SELECT
    (jsonb_populate_record(NULL::public.order_items,to_jsonb(i)||jsonb_build_object('id',gen_random_uuid()))).*
    FROM public.order_items i WHERE order_id=${q(mixedSubmitted.order_id)} AND commercial_line_kind='base_unit';
    SELECT ${parentCostCall};`,/23514.*PARENT_COST_SET_INVALID/u);
  assert.equal(await fingerprint(),mixedBefore,costExtraLabel); checks+=1;
  // A selector is not authority: unchanged116 requires the txid/row guard.
  const selectorOnly=await json(`BEGIN; ${parentInventoryStage}
    SELECT set_config('nawasrah.customer_cost_finalization_operation_id',
      (SELECT operation_id::text FROM phase5_private.mutation_contexts WHERE id=(SELECT id FROM parent_context_probe)),true);
    DO $guc$ BEGIN IF public.phase3_customer_cost_finalization_allowed_internal(${q(mixedSubmitted.order_id)},'order_item',
      (SELECT id FROM public.order_items WHERE order_id=${q(mixedSubmitted.order_id)} ORDER BY id LIMIT 1))
      THEN RAISE EXCEPTION 'QA_COST_GUC_ONLY_ACCEPTED'; END IF; END $guc$;
    SELECT to_jsonb(true); ROLLBACK;`);
  assert.equal(selectorOnly,true); checks+=1;
  const historicalCost=await json(`BEGIN; ${parentCostStage}
    UPDATE public.products SET wac_cost_in_minor_units_exact=777,cost_price_in_minor_units=777 WHERE id=${q(product)};
    UPDATE public.inventory_balances SET on_hand_quantity=on_hand_quantity+7 WHERE product_id=${q(product)};
    SELECT ${parentCostCall}; ROLLBACK;`);
  assert.equal(historicalCost.proofKind,'DURABLE_COST_STAGE_ONLY'); checks+=1;
  assert.equal(await fingerprint(),mixedBefore); checks+=1;
  await fails(`${parentCostStage} SELECT ${parentCostCall}; SET CONSTRAINTS ALL IMMEDIATE;`,/55000.*PARENT_COMPLETION_NOT_PREPARED/u);
  assert.equal(await fingerprint(),mixedBefore); checks+=1;
  assert.equal(await privateGuardDefinitions(),privateGuardsBefore); checks+=1;
  passed.push('parent durable cost stage: exact frozen commercial per-identity full tuples and root/creation ownership union; missing/extra and rounded/exact/unit/profit/time corruption reject; current WAC/balance drift never rebases cost; actual116 guard rows required, selector alone is insufficient; inventory+cost proof still cannot commit incomplete parent');
  // Initial outcome-stage fixture only. The exact frozen expected tuples exist
  // before the public writes. Reuse actual116 backend guard rows, never disable
  // its public guards. No child context/envelope, nested standalone acquisition,
  // new127 read or parent execution authority is manufactured by this fixture.
  const parentOutcomeCall='phase5_private.validate_customer_completion_outcome_v1((SELECT id FROM parent_context_probe))';
  const parentOutcomeApply=`CREATE TEMP TABLE parent_outcome_probe AS SELECT
    phase5_private.derive_customer_completion_outcome_v1(to_jsonb(c)) expected
    FROM phase5_private.mutation_contexts c WHERE c.id=(SELECT id FROM parent_context_probe);
    DO $outcome$ DECLARE c jsonb; e jsonb; o jsonb; child jsonb; BEGIN
      SELECT to_jsonb(t) INTO STRICT c FROM phase5_private.mutation_contexts t WHERE id=(SELECT id FROM parent_context_probe);
      SELECT expected INTO STRICT e FROM parent_outcome_probe; o:=e->'orderAfter'; child:=e->'childReceipt';
      INSERT INTO public.phase3_customer_cost_finalization_guards(transaction_id,lifecycle_operation_id,order_id,row_kind,row_id)
        VALUES(pg_current_xact_id(),(c->>'operation_id')::uuid,(c->>'order_id')::uuid,'order',(c->>'order_id')::uuid);
      INSERT INTO public.phase3_customer_lifecycle_transition_guards(transaction_id,lifecycle_operation_id,order_id,target_status)
        VALUES(pg_current_xact_id(),(c->>'operation_id')::uuid,(c->>'order_id')::uuid,'completed');
      PERFORM set_config('nawasrah.customer_cost_finalization_operation_id',c->>'operation_id',true);
      PERFORM set_config('nawasrah.customer_lifecycle_operation_id',c->>'operation_id',true);
      UPDATE public.orders SET status='completed',
        delivery_fee_in_minor_units=(o->>'delivery_fee_in_minor_units')::bigint,
        total_in_minor_units=(o->>'total_in_minor_units')::bigint,payment_method=o->>'payment_method',
        amount_paid_in_minor_units=CASE WHEN child='null'::jsonb THEN (o->>'amount_paid_in_minor_units')::bigint ELSE 0 END,
        payment_status=CASE WHEN child='null'::jsonb THEN o->>'payment_status' ELSE 'unpaid' END,
        payment_reference_number=o->>'payment_reference_number',
        payment_confirmed_at=(o->>'payment_confirmed_at')::timestamptz,
        payment_confirmed_by=(o->>'payment_confirmed_by')::uuid,cash_shift_id=(o->>'cash_shift_id')::uuid,
        cost_finalized_at=(o->>'cost_finalized_at')::timestamptz,updated_at=(o->>'updated_at')::timestamptz
        WHERE id=(c->>'order_id')::uuid;
      INSERT INTO public.business_operations SELECT (jsonb_populate_record(NULL::public.business_operations,e->'operation')).*;
      INSERT INTO public.order_status_history SELECT (jsonb_populate_record(NULL::public.order_status_history,e->'history')).*;
      INSERT INTO public.audit_logs SELECT (jsonb_populate_record(NULL::public.audit_logs,e->'audit')).*;
      IF child IS DISTINCT FROM 'null'::jsonb THEN
        INSERT INTO public.customer_payments SELECT (jsonb_populate_record(NULL::public.customer_payments,child->'payment')).*;
        INSERT INTO phase5_private.financial_operation_events SELECT
          (jsonb_populate_record(NULL::phase5_private.financial_operation_events,child->'operation')).*;
        INSERT INTO phase5_private.collection_events SELECT (jsonb_populate_record(NULL::phase5_private.collection_events,child->'collection')).*;
        INSERT INTO public.audit_logs SELECT (jsonb_populate_record(NULL::public.audit_logs,child->'audit')).*;
        UPDATE public.orders SET amount_paid_in_minor_units=(o->>'amount_paid_in_minor_units')::bigint,
          payment_status=o->>'payment_status',updated_at=(o->>'updated_at')::timestamptz WHERE id=(c->>'order_id')::uuid;
      END IF;
      DELETE FROM public.phase3_customer_lifecycle_transition_guards WHERE transaction_id=pg_current_xact_id()
        AND lifecycle_operation_id=(c->>'operation_id')::uuid;
      DELETE FROM public.phase3_customer_cost_finalization_guards WHERE transaction_id=pg_current_xact_id()
        AND lifecycle_operation_id=(c->>'operation_id')::uuid;
    END $outcome$;`;
  const parentOutcomeStage=parentCostStage+parentOutcomeApply;
  await fails(`${parentCostStage} SELECT ${parentOutcomeCall};`,/23514.*PARENT_OUTCOME_ORDER_INVALID/u);
  const outcomeProof=await json(`BEGIN; ${parentOutcomeStage}
    CREATE TEMP TABLE outcome_fingerprint_before AS ${fingerprintQuery}
    SELECT ${parentOutcomeCall}; SELECT ${parentOutcomeCall};
    DO $readonly$ DECLARE after_hash jsonb; BEGIN
      ${fingerprintQuery.replace(/;$/u,'')} INTO after_hash;
      IF after_hash IS DISTINCT FROM (SELECT * FROM outcome_fingerprint_before)
        THEN RAISE EXCEPTION 'QA_OUTCOME_READONLY_MUTATION'; END IF;
    END $readonly$;
    SELECT ${parentOutcomeCall}; ROLLBACK;`);
  assert.equal(outcomeProof.proofKind,'DURABLE_PARENT_OUTCOME_STAGE_ONLY');
  assert.equal(outcomeProof.initialCollectionInMinorUnits,'0');
  assert.equal(outcomeProof.partialCollectionInMinorUnits,'300'); checks+=3;
  assert.equal(await fingerprint(),mixedBefore); checks+=1;
  for (const [label,args,initial] of [
    ['full',mixedArgs.replace("'cash',300", "'cash',NULL"),'7100'],
    ['debt',mixedArgs.replace("'cash',300", "'debt',NULL"),'0'],
    ['zero-collection',mixedArgs.replace("'cash',300", "'cash',0"),'0'],
  ]) {
    assert.notEqual(args,mixedArgs,label);
    const proof=await json(`BEGIN; ${parentOutcomeStage.replace(mixedArgs,args)} SELECT ${parentOutcomeCall}; ROLLBACK;`);
    assert.equal(proof.initialCollectionInMinorUnits,initial,label);
    assert.equal(proof.partialCollectionInMinorUnits,'0',label); checks+=2;
    assert.equal(await fingerprint(),mixedBefore,label); checks+=1;
  }
  // Corrupt immutable evidence on INSERT rather than disabling its guards.
  const parentOutcomeCorruption=[
    ['parent-result-overcollection',"e->'operation'", "jsonb_set(e->'operation','{result_snapshot,amount_paid_in_minor_units}','600'::jsonb)",/PARENT_OUTCOME_OPERATION_INVALID/u],
    ['parent-request-substitution',"e->'operation'", "jsonb_set(e->'operation','{request_identity_snapshot,notes}','\"wrong request\"'::jsonb)",/PARENT_OUTCOME_OPERATION_INVALID/u],
    ['parent-key-substitution',"e->'operation'", "jsonb_set(e->'operation','{idempotency_key}','\"wrong-parent-key\"'::jsonb)",/PARENT_OUTCOME_OPERATION_INVALID/u],
    ['parent-actor-substitution',"e->'operation'", `jsonb_set(e->'operation','{initiated_by}',to_jsonb(${q('92400000-0000-0000-0000-000000000002')}::text))`,/PARENT_OUTCOME_OPERATION_INVALID|foreign key/u],
    ['parent-audit-identity',"e->'audit'", "jsonb_set(e->'audit','{details,operation_id}',to_jsonb(gen_random_uuid()))",/PARENT_OUTCOME_AUDIT_INVALID/u],
    ['parent-audit-extra-field',"e->'audit'", "jsonb_set(e->'audit','{details,extra}','true'::jsonb)",/PARENT_OUTCOME_AUDIT_INVALID/u],
    ['history-identity',"e->'history'", "jsonb_set(e->'history','{id}',to_jsonb(gen_random_uuid()))",/PARENT_OUTCOME_HISTORY_INVALID/u],
    ['history-status',"e->'history'", "jsonb_set(e->'history','{new_status}','\"ready\"'::jsonb)",/PARENT_OUTCOME_HISTORY_INVALID/u],
    ['child-payment-notes',"child->'payment'", "jsonb_set(child->'payment','{notes}','\"wrong notes\"'::jsonb)",/PARENT_OUTCOME_RECEIPT_INVALID/u],
    ['child-payment-time',"child->'payment'", "jsonb_set(child->'payment','{created_at}',to_jsonb((child->'payment'->>'created_at')::timestamptz+interval '1 microsecond'))",/PARENT_OUTCOME_RECEIPT_INVALID/u],
    ['child-operation-key',"child->'operation'", "jsonb_set(child->'operation','{idempotency_key}','\"wrong-child-key\"'::jsonb)",/PARENT_OUTCOME_RECEIPT_INVALID/u],
    ['child-operation-result',"child->'operation'", "jsonb_set(child->'operation','{result_snapshot,amountInMinorUnits}','600'::jsonb)",/PARENT_OUTCOME_RECEIPT_INVALID/u],
    ['child-audit-request',"child->'audit'", "jsonb_set(child->'audit','{details,request,notes}','\"different\"'::jsonb)",/PARENT_OUTCOME_RECEIPT_INVALID/u],
    ['missing-history','INSERT INTO public.order_status_history SELECT', '-- missing history\n-- INSERT INTO public.order_status_history SELECT',/PARENT_OUTCOME_HISTORY_INVALID/u],
    ['missing-child-audit',"INSERT INTO public.audit_logs SELECT (jsonb_populate_record(NULL::public.audit_logs,child->'audit')).*;",'',/PARENT_OUTCOME_INCOMPLETE/u],
  ];
  for (const [label,from,to,pattern] of parentOutcomeCorruption) {
    assert.ok(parentOutcomeApply.includes(from),label);
    await fails(`${parentCostStage}${parentOutcomeApply.replace(from,to)} SELECT ${parentOutcomeCall};`,pattern);
    assert.equal(await fingerprint(),mixedBefore,label); checks+=1;
    assert.equal(await privateGuardDefinitions(),privateGuardsBefore,label); checks+=1;
  }
  for (const [label,mutation,pattern] of [
    ['extra-history',`INSERT INTO public.order_status_history SELECT (jsonb_populate_record(NULL::public.order_status_history,
      to_jsonb(h)||jsonb_build_object('id',gen_random_uuid()))).* FROM public.order_status_history h
      WHERE order_id=${q(mixedSubmitted.order_id)} ORDER BY created_at LIMIT 1;`,/PARENT_OUTCOME_HISTORY_INVALID/u],
    ['extra-parent-audit',`INSERT INTO public.audit_logs SELECT (jsonb_populate_record(NULL::public.audit_logs,
      to_jsonb(a)||jsonb_build_object('id',gen_random_uuid()))).* FROM public.audit_logs a
      WHERE id=(SELECT (expected->'audit'->>'id')::uuid FROM parent_outcome_probe);`,/PARENT_OUTCOME_AUDIT_INVALID/u],
    ['extra-child-payment',`INSERT INTO public.customer_payments SELECT (jsonb_populate_record(NULL::public.customer_payments,
      to_jsonb(p)||jsonb_build_object('id',gen_random_uuid(),'payment_number',payment_number||'-EXTRA','idempotency_key','extra-child'))).*
      FROM public.customer_payments p WHERE order_id=${q(mixedSubmitted.order_id)};`,/PARENT_OUTCOME_RECEIPT_SET_INVALID/u],
  ]) {
    await fails(`${parentOutcomeStage} ${mutation} SELECT ${parentOutcomeCall};`,pattern);
    assert.equal(await fingerprint(),mixedBefore,label); checks+=1;
  }
  const noChildExtraPayment=`${parentOutcomeStage.replace(mixedArgs,mixedArgs.replace("'cash',300","'cash',NULL"))}
    INSERT INTO public.customer_payments(payment_number,customer_id,order_id,amount_in_minor_units,payment_method,created_by,cash_shift_id)
    SELECT 'QA-NO-CHILD',customer_id,id,1,'cash',${q(owner)},
      (SELECT (locked_plan->'sourcePlan'->'parent'->'shifts'->0->'row'->>'id')::uuid FROM phase5_private.mutation_contexts
        WHERE id=(SELECT id FROM parent_context_probe)) FROM public.orders WHERE id=${q(mixedSubmitted.order_id)};
    SELECT ${parentOutcomeCall};`;
  await fails(noChildExtraPayment,/PARENT_OUTCOME_RECEIPT_SET_INVALID/u);
  assert.equal(await fingerprint(),mixedBefore,'no-child-extra-payment'); checks+=1;
  await fails(`${parentOutcomeStage} SELECT ${parentOutcomeCall}; SET CONSTRAINTS ALL IMMEDIATE;`,/55000.*PARENT_COMPLETION_NOT_PREPARED/u);
  assert.equal(await fingerprint(),mixedBefore); checks+=1;
  assert.equal(await privateGuardDefinitions(),privateGuardsBefore); checks+=1;
  passed.push('initial parent outcome stage: frozen exact result/request/key/actor/order/history/audit/partial receipt tuples; full/debt/zero controls; partial300 has initial0 and sole child300; immutable INSERT corruption and extra/missing evidence reject; repeated proof zero-write; real116 guards retained; no envelope/child context/admitted executor, deferred parent still55000');
  // The child owns a DISTINCT context matching the existing composite FK.
  // Enter it before source writes, using only the already held parent plan.
  // This link stage is NOT an admitted child executor or committed replay.
  const parentChildEntry=`CREATE TEMP TABLE parent_child_context_probe AS SELECT
    phase5_private.enter_customer_completion_child_context_v1((SELECT id FROM parent_context_probe)) id;`;
  const parentChildInventoryStage=parentInventoryStage.replace(`SELECT ${parentContextAssert};`,
    `SELECT ${parentContextAssert}; ${parentChildEntry}`);
  assert.notEqual(parentChildInventoryStage,parentInventoryStage,'child-context-before-parent-source');
  const childEnvelopeInstrument=`CREATE OR REPLACE FUNCTION phase5_private.reject_preparation_write_v1()
    RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $instrument$
    BEGIN IF TG_TABLE_SCHEMA='phase5_private' AND TG_TABLE_NAME IN ('mutation_contexts','collection_attempt_envelopes')
      AND TG_OP='INSERT' THEN RETURN NEW; END IF;
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_PREPARATION_ONLY'; END $instrument$;`;
  const parentChildEnvelopeApply=`${childEnvelopeInstrument}
    INSERT INTO phase5_private.collection_attempt_envelopes SELECT (jsonb_populate_record(
      NULL::phase5_private.collection_attempt_envelopes,
      phase5_private.derive_customer_completion_child_link_v1(to_jsonb(c))->'envelope')).*
      FROM phase5_private.mutation_contexts c WHERE id=(SELECT id FROM parent_context_probe);`;
  const parentChildLinkStage=parentChildInventoryStage+parentCostApply+parentOutcomeApply+parentChildEnvelopeApply;
  const parentChildLinkCall='phase5_private.validate_customer_completion_child_link_v1((SELECT id FROM parent_context_probe))';
  const childBeforeSource=await json(`BEGIN; ${parentContextInstrument}
    CREATE TEMP TABLE parent_context_probe AS SELECT phase5_private.enter_customer_completion_context_v1(${mixedArgs}) id;
    ${parentChildEntry}
    SELECT jsonb_build_object('child',to_jsonb(t),'expected',phase5_private.derive_customer_completion_child_link_v1(to_jsonb(p))->'context',
      'parentOperation',p.operation_id,'orderStatus',o.status,'paymentCount',
      (SELECT count(*) FROM public.customer_payments WHERE order_id=p.order_id),'parentInventoryCount',
      (SELECT count(*) FROM public.inventory_movements WHERE id IN
        (SELECT value::uuid FROM jsonb_each_text(p.locked_plan->'movementIds'))))
      FROM phase5_private.mutation_contexts t,phase5_private.mutation_contexts p,public.orders o
      WHERE t.id=(SELECT id FROM parent_child_context_probe) AND p.id=(SELECT id FROM parent_context_probe) AND o.id=p.order_id;
    ROLLBACK;`);
  assert.deepEqual(childBeforeSource.child,childBeforeSource.expected);
  assert.notEqual(childBeforeSource.child.operation_id,childBeforeSource.parentOperation);
  assert.equal(childBeforeSource.orderStatus,'ready');
  assert.equal(childBeforeSource.paymentCount,0); assert.equal(childBeforeSource.parentInventoryCount,0); checks+=5;
  const linkedProof=await json(`BEGIN; ${parentChildLinkStage}
    CREATE TEMP TABLE child_link_fingerprint_before AS ${fingerprintQuery}
    SELECT ${parentChildLinkCall}; SELECT ${parentChildLinkCall};
    DO $readonly$ DECLARE after_hash jsonb; BEGIN
      ${fingerprintQuery.replace(/;$/u,'')} INTO after_hash;
      IF after_hash IS DISTINCT FROM (SELECT * FROM child_link_fingerprint_before)
        THEN RAISE EXCEPTION 'QA_PARENT_CHILD_LINK_READONLY_MUTATION'; END IF;
    END $readonly$;
    SELECT ${parentChildLinkCall}; ROLLBACK;`);
  assert.equal(linkedProof.proofKind,'DURABLE_PARENT_CHILD_LINK_STAGE_ONLY');
  assert.notEqual(linkedProof.parentContextId,linkedProof.childContextId);
  assert.notEqual(linkedProof.parentOperationId,linkedProof.childOperationId); checks+=3;
  assert.equal(await fingerprint(),mixedBefore); checks+=1;
  for (const args of [mixedArgs.replace("'cash',300","'cash',NULL"),
    mixedArgs.replace("'cash',300","'debt',NULL"),mixedArgs.replace("'cash',300","'cash',0")]) {
    const proof=await json(`BEGIN; ${parentOutcomeStage.replace(mixedArgs,args)} SELECT ${parentChildLinkCall}; ROLLBACK;`);
    assert.equal(proof.childContextId,null); assert.equal(proof.childOperationId,null); checks+=2;
    await fails(`${parentContextInstrument} CREATE TEMP TABLE parent_context_probe AS SELECT
      phase5_private.enter_customer_completion_context_v1(${args}) id; ${parentChildEntry}`,
    /23514.*PARENT_CHILD_NOT_REQUIRED/u);
    assert.equal(await fingerprint(),mixedBefore); checks+=1;
  }
  await fails(`${parentOutcomeStage} SELECT ${parentChildLinkCall};`,/23514.*PARENT_CHILD_LINK_INCOMPLETE/u);
  await fails(`${parentChildInventoryStage}${parentCostApply}${parentOutcomeApply} SELECT ${parentChildLinkCall};`,
    /23514.*PARENT_CHILD_LINK_INCOMPLETE/u);
  await fails(`${parentContextInstrument} CREATE TEMP TABLE parent_context_probe AS SELECT
    phase5_private.enter_customer_completion_context_v1(${mixedArgs}) id; ${parentChildEntry}
    SELECT phase5_private.enter_customer_completion_child_context_v1((SELECT id FROM parent_context_probe));`,
  /23514.*PREEXISTING_FINANCIAL_EVIDENCE/u);
  await fails(`${parentOutcomeStage} ${parentChildEntry}`,/23505.*COMPLETION_EXISTING_ATTEMPT_REQUIRES_REPLAY/u);
  // Corrupt first INSERT only. No public/immutable guard is disabled.
  const parentChildLinkCorruption=[
    ['child-transaction',"jsonb_set(link->'context','{transaction_id}',to_jsonb((link->'context'->>'transaction_id')::bigint+1))"],
    ['child-request',"jsonb_set(link->'context','{normalized_request,notes}','\"changed\"'::jsonb)"],
    ['child-fingerprint',"jsonb_set(link->'context','{request_fingerprint}',to_jsonb(repeat('0',64)))"],
    ['child-parent-context',"jsonb_set(link->'context','{locked_plan,parentContextId}',to_jsonb(gen_random_uuid()))"],
    ['child-parent-operation',"jsonb_set(link->'context','{locked_plan,parentOperationId}',to_jsonb(gen_random_uuid()))"],
    ['child-parent-key',"jsonb_set(link->'context','{locked_plan,parentKey}','\"wrong\"'::jsonb)"],
    ['child-plan-state',"jsonb_set(link->'context','{locked_plan,planState}','\"LOCKED_STANDALONE_COLLECTION\"'::jsonb)"],
    ['child-receipt',"jsonb_set(link->'context','{locked_plan,receipt,paymentNumber}','\"WRONG\"'::jsonb)"],
    ['child-extra-key',"jsonb_set(link->'context','{locked_plan,extra}','true'::jsonb)"],
  ];
  for (const [label,tuple] of parentChildLinkCorruption) {
    const injected=`DO $inject$ DECLARE link jsonb; BEGIN
      SELECT phase5_private.derive_customer_completion_child_link_v1(to_jsonb(c)) INTO STRICT link
        FROM phase5_private.mutation_contexts c WHERE id=(SELECT id FROM parent_context_probe);
      INSERT INTO phase5_private.mutation_contexts SELECT
        (jsonb_populate_record(NULL::phase5_private.mutation_contexts,${tuple})).*;
    END $inject$;`;
    await fails(`${parentChildLinkStage.replace(parentChildEntry,injected)} SELECT ${parentChildLinkCall};`,
      /23514.*PARENT_CHILD_CONTEXT_INVALID/u);
    assert.equal(await fingerprint(),mixedBefore,label);
    assert.equal(await privateGuardDefinitions(),privateGuardsBefore,label); checks+=2;
  }
  for (const [label,from,to,pattern] of [
    ['envelope-parent-context',"->'envelope'",`->'envelope'||jsonb_build_object('context_id',(SELECT id FROM parent_context_probe))`,/23503.*foreign key/u],
    ['envelope-result-before',"->'envelope'",`->'envelope'||jsonb_build_object('result_snapshot',
      jsonb_set(jsonb_set(phase5_private.derive_customer_completion_child_link_v1(to_jsonb(c))->'envelope'->'result_snapshot',
        '{outstandingBeforeInMinorUnits}','"7101"'::jsonb),'{outstandingAfterInMinorUnits}','"6801"'::jsonb))`,
    /23514.*PARENT_CHILD_ENVELOPE_INVALID/u],
  ]) {
    await fails(`${parentChildInventoryStage}${parentCostApply}${parentOutcomeApply}${parentChildEnvelopeApply.replace(from,to)}
      SELECT ${parentChildLinkCall};`,pattern);
    assert.equal(await fingerprint(),mixedBefore,label); checks+=1;
  }
  await fails(`${parentChildLinkStage} INSERT INTO phase5_private.mutation_contexts SELECT
    (jsonb_populate_record(NULL::phase5_private.mutation_contexts,to_jsonb(t)||
      jsonb_build_object('id',gen_random_uuid(),'operation_id',gen_random_uuid()))).*
    FROM phase5_private.mutation_contexts t WHERE id=(SELECT id FROM parent_child_context_probe);
    SELECT ${parentChildLinkCall};`,/23514.*PARENT_CHILD_LINK_SET_INVALID/u);
  assert.equal(await json(`BEGIN; ${parentChildLinkStage} SELECT ${parentChildLinkCall};
    SET CONSTRAINTS ALL IMMEDIATE; SELECT to_jsonb(true); ROLLBACK;`),true); checks+=1;
  await fails(`${parentChildLinkStage} SELECT phase5_private.resolve_collection_attempt_v2(
    (SELECT locked_plan->'childReceipt'->'request' FROM phase5_private.mutation_contexts WHERE id=(SELECT id FROM parent_context_probe)));`,
  /23514.*COLLECTION_ATTEMPT_BINDING_INVALID/u);
  passed.push('parent-child-context-plan-is-not-standalone: exact typed child context BEFORE parent source writes; separate child operation composite FK; exact frozen envelope/result; full/debt/zero no-child controls; missing/extra/tuple corruption rejects with rollback content equality; read-only repeated link proof; complete initial link passes deferred proof, incomplete parent55000 and standalone adoption rejection retained');
  assert.equal(await fingerprint(),mixedBefore); assert.equal(await privateGuardDefinitions(),privateGuardsBefore); checks+=2;
  // Privileged rollback-only source-permission fixture, NOT a production
  // executor. The TEMP cursor is test instrumentation only; the real permit
  // proves the complete live prefix independently of that claimed ordinal.
  const parentPermissionSetup=`CREATE TEMP TABLE parent_write_probe AS SELECT
    phase5_private.derive_customer_completion_writes_v1(to_jsonb(c))->'writes' writes,1 next_ordinal
    FROM phase5_private.mutation_contexts c WHERE id=(SELECT id FROM parent_context_probe);
    CREATE FUNCTION pg_temp.qa_parent_permission(relation_name text) RETURNS void LANGUAGE plpgsql AS $permit$
    DECLARE w jsonb; n integer; BEGIN SELECT writes,next_ordinal INTO STRICT w,n FROM parent_write_probe;
      IF w->(n-1)->>'relation' IS DISTINCT FROM relation_name THEN RAISE EXCEPTION 'QA_PARENT_PERMISSION_ORDER'; END IF;
      PERFORM phase5_private.assert_customer_completion_source_tuple_v1((SELECT id FROM parent_context_probe),n,
        relation_name,w->(n-1)->>'action',w->(n-1)->'before',w->(n-1)->'after');
      UPDATE parent_write_probe SET next_ordinal=n+1; END $permit$;`;
  const permissionEntry=`${parentContextInstrument} CREATE TEMP TABLE parent_context_probe AS
    SELECT phase5_private.enter_customer_completion_context_v1(${mixedArgs}) id;
    SELECT ${parentContextAssert}; ${parentChildEntry} ${parentPermissionSetup}`;
  const inventoryBody=parentInventoryStage.slice(parentInventoryStage.indexOf('DO $stage$'))
    .replace('UPDATE public.inventory_balances SET',"PERFORM pg_temp.qa_parent_permission('public.inventory_balances'); UPDATE public.inventory_balances SET")
    .replace('UPDATE public.order_inventory_reservations SET',"PERFORM pg_temp.qa_parent_permission('public.order_inventory_reservations'); UPDATE public.order_inventory_reservations SET")
    .replace('INSERT INTO public.inventory_movements SELECT',"PERFORM pg_temp.qa_parent_permission('public.inventory_movements'); INSERT INTO public.inventory_movements SELECT");
  const permissionCost=parentCostApply.replace("CASE s->>'relation'\n", "PERFORM pg_temp.qa_parent_permission(s->>'relation'); CASE s->>'relation'\n");
  assert.notEqual(permissionCost,parentCostApply,'cost-permission-before-each-source');
  const finalProjection=`UPDATE public.orders SET amount_paid_in_minor_units=(o->>'amount_paid_in_minor_units')::bigint,
          payment_status=o->>'payment_status',updated_at=(o->>'updated_at')::timestamptz WHERE id=(c->>'order_id')::uuid;`;
  const permissionOutcome=parentOutcomeApply
    .replace('UPDATE public.orders SET status=',"PERFORM pg_temp.qa_parent_permission('public.orders'); UPDATE public.orders SET status=")
    .replace('INSERT INTO public.business_operations SELECT',"PERFORM pg_temp.qa_parent_permission('public.business_operations'); INSERT INTO public.business_operations SELECT")
    .replace('INSERT INTO public.order_status_history SELECT',"PERFORM pg_temp.qa_parent_permission('public.order_status_history'); INSERT INTO public.order_status_history SELECT")
    .replaceAll('INSERT INTO public.audit_logs SELECT',"PERFORM pg_temp.qa_parent_permission('public.audit_logs'); INSERT INTO public.audit_logs SELECT")
    .replace('INSERT INTO public.customer_payments SELECT',"PERFORM pg_temp.qa_parent_permission('public.customer_payments'); INSERT INTO public.customer_payments SELECT")
    .replace('INSERT INTO phase5_private.financial_operation_events SELECT',"PERFORM pg_temp.qa_parent_permission('phase5_private.financial_operation_events'); INSERT INTO phase5_private.financial_operation_events SELECT")
    .replace('INSERT INTO phase5_private.collection_events SELECT',"PERFORM pg_temp.qa_parent_permission('phase5_private.collection_events'); INSERT INTO phase5_private.collection_events SELECT")
    .replace(finalProjection,'');
  assert.equal(permissionOutcome.includes(finalProjection),false,'projection-after-exact-envelope');
  const permissionEnvelope=`${childEnvelopeInstrument} DO $envelope$ BEGIN
    PERFORM pg_temp.qa_parent_permission('phase5_private.collection_attempt_envelopes');
    INSERT INTO phase5_private.collection_attempt_envelopes SELECT (jsonb_populate_record(
      NULL::phase5_private.collection_attempt_envelopes,phase5_private.derive_customer_completion_child_link_v1(to_jsonb(c))->'envelope')).*
      FROM phase5_private.mutation_contexts c WHERE id=(SELECT id FROM parent_context_probe);
    PERFORM pg_temp.qa_parent_permission('public.orders');
    UPDATE public.orders SET amount_paid_in_minor_units=(e.expected->'orderAfter'->>'amount_paid_in_minor_units')::bigint,
      payment_status=e.expected->'orderAfter'->>'payment_status',updated_at=(e.expected->'orderAfter'->>'updated_at')::timestamptz
      FROM parent_outcome_probe e WHERE id=(SELECT order_id FROM phase5_private.mutation_contexts WHERE id=(SELECT id FROM parent_context_probe));
    END $envelope$;`;
  const parentPermissionStage=permissionEntry+inventoryBody+permissionCost+permissionOutcome+permissionEnvelope;
  const permissionProof=await json(`BEGIN; ${parentPermissionStage} SELECT ${parentChildLinkCall};
    SELECT jsonb_build_object('expected',jsonb_array_length(writes),'applied',next_ordinal-1) FROM parent_write_probe; ROLLBACK;`);
  assert.equal(permissionProof.expected,24); assert.equal(permissionProof.applied,24); checks+=2;
  assert.equal(await fingerprint(),mixedBefore); assert.equal(await privateGuardDefinitions(),privateGuardsBefore); checks+=2;
  for (const args of [mixedArgs.replace("'cash',300","'cash',NULL"),mixedArgs.replace("'cash',300","'debt',NULL"),mixedArgs.replace("'cash',300","'cash',0")]) {
    const noChildPermission=permissionEntry.replace(mixedArgs,args).replace(parentChildEntry,'')
      +inventoryBody+permissionCost+permissionOutcome;
    const proof=await json(`BEGIN; ${noChildPermission} SELECT ${parentChildLinkCall};
      SELECT jsonb_build_object('expected',jsonb_array_length(writes),'applied',next_ordinal-1) FROM parent_write_probe; ROLLBACK;`);
    assert.equal(proof.expected,18); assert.equal(proof.applied,18); checks+=2;
    assert.equal(await fingerprint(),mixedBefore); checks+=1;
  }
  const permissionFirst=`SELECT phase5_private.assert_customer_completion_source_tuple_v1((SELECT id FROM parent_context_probe),
    1,writes->0->>'relation',writes->0->>'action',writes->0->'before',writes->0->'after') FROM parent_write_probe;`;
  const permissionReadonly=await json(`BEGIN; ${permissionEntry} CREATE TEMP TABLE permission_fingerprint_before AS ${fingerprintQuery}
    ${permissionFirst} ${permissionFirst}
    DO $readonly$ DECLARE after_hash jsonb; BEGIN ${fingerprintQuery.replace(/;$/u,'')} INTO after_hash;
      IF after_hash IS DISTINCT FROM (SELECT * FROM permission_fingerprint_before)
      THEN RAISE EXCEPTION 'QA_PARENT_PERMISSION_READONLY_MUTATION'; END IF; END $readonly$;
    SELECT to_jsonb(true); ROLLBACK;`);
  assert.equal(permissionReadonly,true); assert.equal(await fingerprint(),mixedBefore); checks+=2;
  const parentPermissionFaults=[
    ['wrong-new-quantity',permissionFirst.replace("writes->0->'after'", "jsonb_set(writes->0->'after','{on_hand_quantity}','999')"),/PARENT_SOURCE_TUPLE_INVALID/u],
    ['wrong-old-quantity',permissionFirst.replace("writes->0->'before'", "jsonb_set(writes->0->'before','{on_hand_quantity}','999')"),/PARENT_SOURCE_TUPLE_INVALID/u],
    ['extra-field',permissionFirst.replace("writes->0->'after'", "(writes->0->'after')||'{\"unplanned\":true}'::jsonb"),/PARENT_SOURCE_TUPLE_INVALID/u],
    ['wrong-relation',permissionFirst.replace("writes->0->>'relation'","'public.orders'"),/PARENT_SOURCE_TUPLE_INVALID/u],
    ['wrong-action',permissionFirst.replace("writes->0->>'action'","'DELETE'"),/PARENT_SOURCE_TUPLE_INVALID/u],
    ['null-new',permissionFirst.replace("writes->0->'after'",'NULL'),/PARENT_SOURCE_TUPLE_INVALID/u],
    ['invalid-ordinal',permissionFirst.replace('    1,','    NULL,'),/PARENT_SOURCE_STEP_INVALID/u],
    ['skip-parent-write',permissionFirst.replaceAll('writes->0','writes->1').replace('    1,','    2,'),/PARENT_SOURCE_PREFIX_INVALID/u],
  ];
  for (const [label,call,pattern] of parentPermissionFaults) {
    await fails(`${permissionEntry} ${call}`,pattern);
    assert.equal(await fingerprint(),mixedBefore,label); assert.equal(await privateGuardDefinitions(),privateGuardsBefore,label); checks+=2;
  }
  // Correct tuples cannot conceal an out-of-order future row or a duplicate
  // earlier write, even when the caller supplies the expected ordinal/OLD.
  await fails(`${permissionEntry} INSERT INTO public.audit_logs SELECT
    (jsonb_populate_record(NULL::public.audit_logs,writes->17->'after')).* FROM parent_write_probe;
    ${permissionFirst}`,/PARENT_SOURCE_PREFIX_INVALID/u);
  assert.equal(await fingerprint(),mixedBefore,'parent-permission-future-insert'); checks+=1;
  await fails(`${permissionEntry} DO $repeat$ DECLARE s jsonb; BEGIN
    SELECT writes->0 INTO s FROM parent_write_probe; PERFORM pg_temp.qa_parent_permission('public.inventory_balances');
    UPDATE public.inventory_balances SET on_hand_quantity=(s->'after'->>'on_hand_quantity')::bigint,
      reserved_quantity=(s->'after'->>'reserved_quantity')::bigint,updated_at=(s->'after'->>'updated_at')::timestamptz
      WHERE id=(s->>'id')::uuid; END $repeat$; ${permissionFirst}`,/PARENT_SOURCE_PREFIX_INVALID/u);
  assert.equal(await fingerprint(),mixedBefore,'repeat-parent-write'); checks+=1;
  await fails(`${permissionEntry} INSERT INTO phase5_private.mutation_contexts SELECT
    (jsonb_populate_record(NULL::phase5_private.mutation_contexts,to_jsonb(c)||jsonb_build_object(
      'id',gen_random_uuid(),'operation_id',gen_random_uuid()))).* FROM phase5_private.mutation_contexts c
    WHERE id=(SELECT id FROM parent_context_probe); ${permissionFirst}`,/PARENT_SOURCE_CONTEXT_SET_INVALID/u);
  assert.equal(await fingerprint(),mixedBefore,'parent-permission-extra-context'); checks+=1;
  for (const mutation of [
    'transaction_id=transaction_id+1',"request_fingerprint=repeat('A',64)",
    "locked_plan=jsonb_set(locked_plan,'{planState}','\"FORGED\"'::jsonb)",
  ]) {
    await fails(`${permissionEntry} ${parentContextMutable} ${parentContextFaultBarrier}
      UPDATE phase5_private.mutation_contexts SET ${mutation} WHERE id=(SELECT id FROM parent_context_probe);
      ${permissionFirst}`,/42501.*PARENT_SOURCE_PERMIT_INVALID/u);
    assert.equal(await fingerprint(),mixedBefore); assert.equal(await privateGuardDefinitions(),privateGuardsBefore); checks+=2;
  }
  assert.equal(await json(`BEGIN; ${parentPermissionStage} SET CONSTRAINTS ALL IMMEDIATE;
    SELECT to_jsonb(true); ROLLBACK;`),true); checks+=1;
  assert.equal(await fingerprint(),mixedBefore); assert.equal(await privateGuardDefinitions(),privateGuardsBefore); checks+=2;
  passed.push('parent source permission: pure ordered24-transition partial and18-transition full/debt/zero plans; complete full-row prefix including future INSERT absence and repeated shared-SKU/Order rows; altered OLD/NEW/action/relation/ordinal, skipped/repeated/future rows, extra contexts and tx/request drift reject; all24 actual fixture writes checked with real116 guards; complete initial prefix passes deferred proof, no historical replay adoption');
  // Actual PRIVATE prelocked executor: no copied source-DML implementation.
  // All activation/private barrier instrumentation and fault injection remain
  // inside an outer rollback. Public116 guards/triggers are never disabled.
  const parentExecutorEntry=`${parentContextInstrument} CREATE TEMP TABLE parent_context_probe AS
    SELECT phase5_private.enter_customer_completion_context_v1(${mixedArgs}) id; ${childEnvelopeInstrument}`;
  const parentExecutorCall='phase5_private.execute_customer_completion_prelocked_v1((SELECT id FROM parent_context_probe))';
  const parentCompleteCall='phase5_private.complete_customer_completion_context_v1((SELECT id FROM parent_context_probe))';
  const parentExecutorStage=`${parentExecutorEntry} SELECT ${parentExecutorCall};`;
  const parentExecutorClean=await json(`BEGIN; ${parentExecutorStage} SET CONSTRAINTS ALL IMMEDIATE;
    SELECT jsonb_build_object('result',${parentCompleteCall},'expected',
      phase5_private.derive_customer_completion_outcome_v1(to_jsonb(c))->'parentResult',
      'payments',(SELECT count(*) FROM public.customer_payments WHERE order_id=c.order_id),
      'consumed',(SELECT count(*) FROM public.order_inventory_reservations WHERE order_id=c.order_id AND reservation_state='consumed'),
      'movements',(SELECT count(*) FROM public.inventory_movements WHERE id IN
        (SELECT value::uuid FROM jsonb_each_text(c.locked_plan->'movementIds'))),
      'guards',(SELECT count(*) FROM public.phase3_customer_cost_finalization_guards WHERE transaction_id=pg_current_xact_id())+
        (SELECT count(*) FROM public.phase3_customer_lifecycle_transition_guards WHERE transaction_id=pg_current_xact_id()))
    FROM phase5_private.mutation_contexts c WHERE id=(SELECT id FROM parent_context_probe); ROLLBACK;`);
  assert.deepEqual(parentExecutorClean.result,parentExecutorClean.expected);
  assert.equal(parentExecutorClean.payments,1); assert.equal(parentExecutorClean.consumed,3);
  assert.equal(parentExecutorClean.movements,3); assert.equal(parentExecutorClean.guards,0); checks+=5;
  assert.equal(await fingerprint(),mixedBefore); assert.equal(await privateGuardDefinitions(),privateGuardsBefore); checks+=2;
  for (const [label,args,paid,payments] of [
    ['full',mixedArgs.replace("'cash',300","'cash',NULL"),7100,0],
    ['debt',mixedArgs.replace("'cash',300","'debt',NULL"),0,0],
    ['zero',mixedArgs.replace("'cash',300","'cash',0"),0,0],
  ]) {
    const proof=await json(`BEGIN; ${parentExecutorStage.replace(mixedArgs,args)} SET CONSTRAINTS ALL IMMEDIATE;
      SELECT jsonb_build_object('paid',o.amount_paid_in_minor_units,'payments',
        (SELECT count(*) FROM public.customer_payments WHERE order_id=o.id),'result',${parentCompleteCall})
      FROM public.orders o WHERE id=${q(mixedSubmitted.order_id)}; ROLLBACK;`);
    assert.equal(proof.paid,paid,label); assert.equal(proof.payments,payments,label);
    assert.equal(proof.result.success,true,label); checks+=3;
    assert.equal(await fingerprint(),mixedBefore,label); checks+=1;
  }
  const selectorProof=await json(`BEGIN; ${parentExecutorEntry}
    SELECT set_config('nawasrah.customer_cost_finalization_operation_id','prior-cost-selector',true);
    SELECT set_config('nawasrah.customer_lifecycle_operation_id','prior-lifecycle-selector',true);
    SELECT ${parentExecutorCall}; SET CONSTRAINTS ALL IMMEDIATE;
    SELECT jsonb_build_object('cost',current_setting('nawasrah.customer_cost_finalization_operation_id'),
      'lifecycle',current_setting('nawasrah.customer_lifecycle_operation_id')); ROLLBACK;`);
  assert.deepEqual(selectorProof,{cost:'prior-cost-selector',lifecycle:'prior-lifecycle-selector'},
    'parent-executor-selector-restoration'); checks+=1;
  // Completion is an INITIAL same-transaction zero-write proof, NOT a replay
  // resolver after future business actions. Deliberate live tuple mutation fails.
  assert.equal(await json(`BEGIN; ${parentExecutorStage} SET CONSTRAINTS ALL IMMEDIATE;
    CREATE TEMP TABLE executor_fingerprint_before AS ${fingerprintQuery}
    SELECT ${parentCompleteCall}; SELECT ${parentCompleteCall};
    DO $readonly$ DECLARE after_hash jsonb; BEGIN ${fingerprintQuery.replace(/;$/u,'')} INTO after_hash;
      IF after_hash IS DISTINCT FROM (SELECT * FROM executor_fingerprint_before)
        THEN RAISE EXCEPTION 'QA_PARENT_EXECUTOR_COMPLETION_MUTATION'; END IF; END $readonly$;
    SELECT to_jsonb(true); ROLLBACK;`),true); checks+=1;
  await fails(`${parentExecutorStage} DO $mutation$ DECLARE before_notes text; after_notes text; BEGIN
    SELECT customer_notes INTO STRICT before_notes FROM public.orders WHERE id=${q(mixedSubmitted.order_id)};
    UPDATE public.orders SET customer_notes=COALESCE(customer_notes,'')||' changed-after-initial-completion'
      WHERE id=${q(mixedSubmitted.order_id)} RETURNING customer_notes INTO STRICT after_notes;
    IF after_notes IS NOT DISTINCT FROM before_notes THEN RAISE EXCEPTION 'QA_PARENT_CONTENT_MUTATION_MISSING'; END IF;
    END $mutation$; SELECT ${parentCompleteCall};`,/42501.*PARENT_SOURCE_PREFIX_INVALID/u);
  passed.push('parent-executor-initial-not-historical-replay: same-transaction repeated completion zero-write; changed live Order rejects, no historical replay authority claimed');
  await fails(`${parentExecutorStage} SELECT ${parentExecutorCall};`,/COMPLETION_EXISTING_ATTEMPT_REQUIRES_REPLAY|PREEXISTING_FINANCIAL_EVIDENCE/u);
  const parentExecutionFaults=Array.from({length:24},(_,i)=>i+1);
  for (const ordinal of parentExecutionFaults) {
    const inject=`DO $inject$ DECLARE definition text; BEGIN
      definition:=pg_get_functiondef('phase5_private.assert_customer_completion_source_tuple_v1(uuid,integer,text,text,jsonb,jsonb)'::regprocedure);
      IF position('BEGIN' in definition)=0 THEN RAISE EXCEPTION 'QA_PARENT_FAULT_INSERTION_MISSING'; END IF;
      EXECUTE replace(definition,'BEGIN','BEGIN IF write_ordinal=${ordinal} THEN RAISE EXCEPTION USING ERRCODE=''40001'',MESSAGE=''QA_PARENT_WRITE_${ordinal}''; END IF;');
      END $inject$;`;
    await fails(`${parentExecutorEntry} ${inject} SELECT ${parentExecutorCall};`,
      new RegExp(`40001.*QA_PARENT_WRITE_${ordinal}(?:\\s|$)`,'u'));
    assert.equal(await fingerprint(),mixedBefore,`parent-executor-fault-${ordinal}`);
    assert.equal(await privateGuardDefinitions(),privateGuardsBefore,`parent-executor-fault-${ordinal}`); checks+=2;
  }
  const afterLastWrite=`DO $inject$ DECLARE definition text; BEGIN
    definition:=pg_get_functiondef('phase5_private.complete_customer_completion_context_v1(uuid)'::regprocedure);
    IF position('BEGIN' in definition)=0 THEN RAISE EXCEPTION 'QA_PARENT_FAULT_INSERTION_MISSING'; END IF;
    EXECUTE replace(definition,'BEGIN','BEGIN RAISE EXCEPTION USING ERRCODE=''40001'',MESSAGE=''QA_PARENT_AFTER_LAST_WRITE'';');
    END $inject$;`;
  await fails(`${parentExecutorEntry} ${afterLastWrite} SELECT ${parentExecutorCall};`,/40001.*QA_PARENT_AFTER_LAST_WRITE/u);
  assert.equal(await fingerprint(),mixedBefore); assert.equal(await privateGuardDefinitions(),privateGuardsBefore); checks+=2;
  // Prove statement/subtransaction atomicity even if a surrounding caller
  // catches the known injected failure instead of aborting its whole session.
  assert.equal(await json(`BEGIN; ${parentExecutorEntry} ${afterLastWrite}
    SELECT set_config('nawasrah.customer_cost_finalization_operation_id','prior-cost-selector',true);
    SELECT set_config('nawasrah.customer_lifecycle_operation_id','prior-lifecycle-selector',true);
    CREATE TEMP TABLE parent_executor_before_failure AS ${fingerprintQuery}
    DO $subtransaction$ DECLARE after_hash jsonb; BEGIN
      BEGIN PERFORM ${parentExecutorCall}; RAISE EXCEPTION 'QA_PARENT_EXPECTED_FAILURE_MISSING';
      EXCEPTION WHEN SQLSTATE '40001' THEN
        IF SQLERRM IS DISTINCT FROM 'QA_PARENT_AFTER_LAST_WRITE' THEN RAISE; END IF;
      END;
      ${fingerprintQuery.replace(/;$/u,'')} INTO after_hash;
      IF after_hash IS DISTINCT FROM (SELECT * FROM parent_executor_before_failure)
        OR current_setting('nawasrah.customer_cost_finalization_operation_id') IS DISTINCT FROM 'prior-cost-selector'
        OR current_setting('nawasrah.customer_lifecycle_operation_id') IS DISTINCT FROM 'prior-lifecycle-selector'
      THEN RAISE EXCEPTION 'QA_PARENT_CAUGHT_FAILURE_PARTIAL_WRITE'; END IF;
    END $subtransaction$; SELECT to_jsonb(true); ROLLBACK;`),true); checks+=1;
  assert.equal(await fingerprint(),mixedBefore); assert.equal(await privateGuardDefinitions(),privateGuardsBefore); checks+=2;
  // Leaked116 capability is not completion evidence. Retained public guards
  // still demand backend rows, never a caller's selector alone.
  await fails(`${parentExecutorStage} INSERT INTO public.phase3_customer_lifecycle_transition_guards
    SELECT pg_current_xact_id(),operation_id,order_id,'completed' FROM phase5_private.mutation_contexts
    WHERE id=(SELECT id FROM parent_context_probe); SELECT ${parentCompleteCall};`,/23514.*PARENT_COMPLETION_GUARD_LEAK/u);
  assert.equal(await fingerprint(),mixedBefore); assert.equal(await privateGuardDefinitions(),privateGuardsBefore); checks+=2;
  passed.push('actual private prelocked parent executor:24 partial/18 full-debt-zero writes through real116 guards; complete initial parent+child deferred proof passes, selectors restored and guard rows removed; every prewrite ordinal and after-last-write fault rolls back content and instrumented definitions; repeat executor denied, generation0 public authority unchanged');
  const historicalParentReplay=`phase5_private.resolve_customer_completion_v1(${mixedArgs})`;
  for(const args of [mixedArgs,mixedArgs.replace("'cash',300","'cash',NULL"),
    mixedArgs.replace("'cash',300","'debt',NULL"),mixedArgs.replace("'cash',300","'cash',0")]) {
    const replay=`phase5_private.resolve_customer_completion_v1(${args})`;
    assert.equal(await json(`BEGIN; ${parentExecutorStage.replace(mixedArgs,args)} SET CONSTRAINTS ALL IMMEDIATE;
      CREATE TEMP TABLE historical_replay_before AS ${fingerprintQuery}
      DO $replay$ DECLARE first_result jsonb; after_hash jsonb; BEGIN
        first_result:=${replay};
        IF first_result IS DISTINCT FROM ${parentCompleteCall} OR first_result IS DISTINCT FROM ${replay}
          THEN RAISE EXCEPTION 'QA_HISTORICAL_REPLAY_RESULT_DRIFT'; END IF;
        ${fingerprintQuery.replace(/;$/u,'')} INTO after_hash;
        IF after_hash IS DISTINCT FROM (SELECT * FROM historical_replay_before)
          THEN RAISE EXCEPTION 'QA_HISTORICAL_REPLAY_MUTATION'; END IF;
      END $replay$; SELECT to_jsonb(true); ROLLBACK;`),true); checks+=1;
  }
  await fails(`${parentExecutorStage} SELECT ${historicalParentReplay.replace("'cash',300","'cash',301")};`,
    /23505.*COMPLETION_IDEMPOTENCY_CONFLICT/u);
  await fails(`${parentExecutorStage} SELECT phase5_private.validate_customer_completion_child_link_v1(
    (SELECT id FROM parent_context_probe),NULL);`,/22023.*PARENT_PROOF_MODE_INVALID/u);
  await fails(`${parentExecutorEntry} SELECT ${historicalParentReplay};`,/23514.*PARENT_INVENTORY_RESERVATION_INVALID/u);
  // Privileged private-control fault injection ONLY, rollback contained. No
  // public immutable/116/source trigger is disabled to create these corruptions.
  for(const [label,mutation] of [
    ['wrong-movement-identity',`UPDATE phase5_private.mutation_contexts SET locked_plan=jsonb_set(locked_plan,
      ARRAY['movementIds',(SELECT value->>'reservationId' FROM jsonb_array_elements(locked_plan->'deltas'->'inventorySteps') LIMIT 1)],
      to_jsonb(gen_random_uuid())) WHERE id=(SELECT id FROM parent_context_probe);`],
    ['wrong-parent-history-identity',`UPDATE phase5_private.mutation_contexts SET locked_plan=jsonb_set(locked_plan,
      '{historyId}',to_jsonb(gen_random_uuid())) WHERE id=(SELECT id FROM parent_context_probe);`],
    ['wrong-stored-request',`UPDATE phase5_private.mutation_contexts SET normalized_request=jsonb_set(normalized_request,
      '{amount_collected_in_minor_units}','301') WHERE id=(SELECT id FROM parent_context_probe);`],
  ]) {
    await fails(`${parentExecutorStage} SET CONSTRAINTS ALL IMMEDIATE; ${parentContextFaultBarrier} ${parentContextMutable}
      ${mutation} SELECT ${historicalParentReplay};`,/23514.*PARENT_|23505.*IDEMPOTENCY_CONFLICT/u);
    assert.equal(await fingerprint(),mixedBefore,label); assert.equal(await privateGuardDefinitions(),privateGuardsBefore,label); checks+=2;
  }
  passed.push('historical parent durable proof: partial/full/debt/zero clean zero-write, changed payload/NULL mode/incomplete parent and alternate stored source/history/request identities reject; initial strict completion unchanged');
  console.log('Parent executor and initial deferred completion verified; continuing unchanged compatibility and standalone controls.');
  await fails(`${claims} UPDATE public.order_inventory_reservations SET reservation_state='released',resolved_at=NOW()
    WHERE id=(SELECT id FROM public.order_inventory_reservations WHERE order_id=${q(mixedSubmitted.order_id)}
      AND parcel_instance_id IS NOT NULL ORDER BY id LIMIT 1);
    SELECT phase5_private.discover_customer_completion_plan_v1(${mixedArgs});`,/RESERVATION_IDENTITY_INVALID/u);
  assert.equal(await fingerprint(),mixedBefore);
  // Original API completion remains authoritative and must still work. This is
  // a compatibility control, not activation of the prepared parent executor.
  const oldCompletion = await json(`${claims} SELECT public.complete_website_order_with_settlement_v2(
    ${q(mixedSubmitted.order_id)},${q(randomUUID())},'cash',300,NULL,NULL,'Existing completion control');`);
  assert.equal(oldCompletion.success,true);
  assert.equal(oldCompletion.amount_paid_in_minor_units,300);
  assert.equal(await json(`SELECT to_jsonb(count(*)) FROM public.customer_payments WHERE order_id=${q(mixedSubmitted.order_id)};`),1);
  assert.equal(await json(`SELECT to_jsonb(count(*)) FROM phase5_private.collection_attempt_envelopes;`),0); checks += 4;
  await fails(`${claims} SELECT phase5_private.discover_customer_completion_plan_v1(${mixedArgs});`,/COMPLETION_SOURCE_INVALID/u);
  passed.push('mixed Base Unit/Parcel Customer V2 exact physical demand and global two-SKU discovery; consumed lifecycle rejection and unchanged old partial-completion compatibility, no prepared executor activation');
  // Explicitly include the newly committed legitimate parent fixture in the
  // baseline for the retained rollback-only collection matrix below.
  discoveryBefore = await fingerprint();
  await fails(`${claims} SELECT phase5_private.lock_collection_generation_v2(${j(plannedRequest)});`,/55000.*PHASE5_PREPARATION_ONLY/u);
  await fails(`${claims} SELECT set_config('phase5.authority_generation','1',false);
    SELECT phase5_private.lock_collection_generation_v2(${j(plannedRequest)});`,/PHASE5_PREPARATION_ONLY/u);
  const releaseGeneration = await holdGeneration();
  try {
    await fails(`SELECT set_config('request.jwt.claims','{}',false);
      SELECT phase5_private.lock_collection_generation_v2(${j(plannedRequest)});`,/42501.*PHASE5_COORDINATOR_ACTOR_UNAUTHORIZED/u);
    await fails(`${claims} SELECT phase5_private.lock_collection_generation_v2(${j({...plannedRequest,actorId:randomUUID()})});`,/42501.*PHASE5_COLLECTION_ACTOR_MISMATCH/u);
    await fails(`${claims} SELECT phase5_private.lock_collection_generation_v2(${j(plannedRequest)});`,/40001.*PHASE5_COLLECTION_GENERATION_BUSY_RETRY/u);
    assert.equal(await json(`SELECT to_jsonb(count(*)) FROM pg_stat_activity
      WHERE application_name='S5-GENERATION-HOLDER' AND state='idle in transaction';`),1);
  } finally { await releaseGeneration(); }
  assert.equal(await fingerprint(),discoveryBefore);
  passed.push('real independent generation-row contention: unauthorized/mismatched actor rejects before locks, owner NOWAIT returns safe retry; generation0 and caller GUC cannot activate authority');

  const operation = randomUUID();
  const details = {request:plannedRequest,operationId:operation};
  const enter = `phase5_private.enter_authority_context_v1(${q(owner)},'CUSTOMER_COLLECTION',${q(plannedSale.orderId)},${j(details)})`;
  await fails(`${claims} SELECT ${enter};`,/PHASE5_PREPARATION_ONLY/u);
  for (const purpose of ['CUSTOMER_COMPLETION','SHIFT_REVERSAL','LEGACY_WEBSITE_COMPLETION']) {
    await fails(`${claims} SELECT phase5_private.enter_authority_context_v1(${q(owner)},${q(purpose)},${q(plannedSale.orderId)},${j(details)});`,/PHASE5_CONTEXT_PURPOSE_OR_ACTOR_UNSUPPORTED/u);
  }
  await fails(`${claims} SELECT phase5_private.enter_authority_context_v1(${q(owner)},'CUSTOMER_COLLECTION',${q(sale.orderId)},${j(details)});`,/PHASE5_CONTEXT_ORDER_MISMATCH/u);

  // Privileged instrumentation ONLY inside disposable transactions. No public
  // body/trigger/ACL changes and no COMMIT: this is NOT activation rehearsal.
  const instrument = `${claims}
    ALTER TABLE phase5_private.authority_generation DISABLE TRIGGER phase5_preparation_generation_barrier;
    ALTER TABLE phase5_private.activation_receipts DISABLE TRIGGER phase5_preparation_activation_barrier;
    ALTER TABLE phase5_private.mutation_contexts DISABLE TRIGGER phase5_preparation_context_barrier;
    UPDATE phase5_private.authority_generation SET generation=1,authority_state='ACTIVE';
    INSERT INTO phase5_private.activation_receipts VALUES(1,'128',${q(migrationHash)},
      '9A74EB14788EA668BDE88DAC95561AD8DA2F734EC47EAA87491AB0F181E06099',clock_timestamp(),txid_current());`;
  const cleanContext = `${instrument} DO $$ DECLARE context_id UUID; c JSONB; BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND granted
      AND relation='phase5_private.mutation_contexts'::regclass AND mode='ShareRowExclusiveLock')
      OR EXISTS (SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND granted
      AND relation='phase5_private.mutation_contexts'::regclass AND mode='RowExclusiveLock') THEN
      RAISE EXCEPTION 'QA_PREPARATION_DDL_LOCK_MODE_INVALID'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_locks l JOIN pg_index i ON i.indexrelid=l.relation
      WHERE l.pid=pg_backend_pid() AND l.granted AND l.mode='RowExclusiveLock'
      AND i.indrelid='phase5_private.authority_generation'::regclass) THEN
      RAISE EXCEPTION 'QA_PREPARATION_CONTROL_INDEX_LOCK_MISSING'; END IF;
    context_id := ${enter}; c := phase5_private.assert_collection_context_v2(context_id,${j(plannedRequest)});
    IF c->>'transaction_id' IS DISTINCT FROM txid_current()::text
      OR c->>'operation_id' IS DISTINCT FROM ${q(operation)}
      OR c->'locked_plan'->>'planState' IS DISTINCT FROM 'LOCKED_STANDALONE_COLLECTION'
      OR (SELECT count(*) FROM phase5_private.mutation_contexts) <> 1 THEN
      RAISE EXCEPTION 'QA_CONTEXT_BINDING_INVALID'; END IF;
    END $$;`;
  const releaseContext = await holdSQL(cleanContext,'S5-CONTEXT-HOLDER');
  try {
    for (const table of [
      `public.orders WHERE id=${q(plannedSale.orderId)}`,
      `public.cash_shifts WHERE id=${q(plan.currentShift.id)}`,
      `public.profiles WHERE id=${q(owner)}`,
      `public.customers WHERE id=${q(customer)}`,
      `public.business_operations WHERE id=${q(plan.order.operation_id)}`,
    ]) await fails(`SELECT 1 FROM ${table} FOR UPDATE NOWAIT;`,/55P03.*could not obtain lock/u);
    for (const gate of [owner+':'+plannedRequest.idempotencyKey,
      `phase5-idempotency|erp_user|${owner}|customer_collection_v1|${plannedRequest.idempotencyKey}`,
      `phase5-idempotency|erp_user|${owner}|customer_collection_v2|${plannedRequest.idempotencyKey}`,
      `phase4-order|${plannedSale.orderId}`,`pos-sale-reversal:${plannedSale.orderId}`,
      `cash-shift-full-reversal:${plan.currentShift.id}`]) {
      assert.equal(await json(`BEGIN; SELECT to_jsonb(pg_try_advisory_xact_lock(hashtextextended(${q(gate)},0))); ROLLBACK;`),false);
      checks += 1;
    }
    assert.equal(await json(`SELECT to_jsonb(count(*)) FROM pg_stat_activity WHERE application_name='S5-CONTEXT-HOLDER' AND state='idle in transaction';`),1);
  } finally { await releaseContext(); }
  assert.equal(await fingerprint(),discoveryBefore);

  for (const earlier of [
    `SELECT 1 FROM public.orders WHERE id=${q(plannedSale.orderId)} FOR KEY SHARE;`,
    `SELECT 1 FROM public.order_items WHERE order_id=${q(plannedSale.orderId)} FOR UPDATE;`,
    'LOCK TABLE phase5_private.mutation_contexts IN ROW EXCLUSIVE MODE;',
    `SELECT pg_advisory_xact_lock(hashtextextended('phase4-order|${plannedSale.orderId}',0));`,
  ]) await fails(`${instrument} ${earlier} SELECT ${enter};`,/40001.*PHASE5_COLLECTION_LATE_ENTRY_RETRY/u);
  for (const corruption of [
    'transaction_id=txid_current()+1',`normalized_request=${j({...plannedRequest,notes:'changed'})}`,
    "request_fingerprint=repeat('A',64)","locked_plan=jsonb_set(locked_plan,'{planState}','\"DISCOVERED_NOT_LOCKED\"')",
    `operation_id=${q(randomUUID())}`,`order_id=${q(sale.orderId)}`,'operation_id=NULL',
  ]) {
    await fails(`${instrument}
      ALTER TABLE phase5_private.mutation_contexts DISABLE TRIGGER phase5_context_immutable;
      DO $$ DECLARE c UUID; BEGIN c := ${enter};
      UPDATE phase5_private.mutation_contexts SET ${corruption} WHERE id=c;
      PERFORM phase5_private.assert_collection_context_v2(c,${j(plannedRequest)}); END $$;`,/42501.*PHASE5_COLLECTION_CONTEXT_INVALID/u);
    assert.equal(await fingerprint(),discoveryBefore);
  }
  await fails(`${instrument} DO $$ DECLARE c UUID; BEGIN c := ${enter};
    UPDATE public.profiles SET full_name='Changed after context' WHERE id=${q(owner)};
    PERFORM phase5_private.assert_collection_context_v2(c,${j(plannedRequest)}); END $$;`,
  /40001.*PHASE5_COLLECTION_PLAN_CHANGED_RETRY/u);
  assert.equal(await fingerprint(),discoveryBefore);
  assert.equal(await json(`SELECT to_jsonb(count(*)) FROM pg_trigger
    WHERE tgname IN ('phase5_preparation_generation_barrier','phase5_preparation_activation_barrier',
      'phase5_preparation_context_barrier','phase5_preparation_attempt_barrier') AND tgenabled='O';`),4);
  passed.push('rollback-only standalone complete resource acquisition and server-minted txid/request/operation context; real second-session row/advisory contention; late-entry and context-tuple corruption rejection; all barriers/state restored');
  console.log('Discovery/prelock/context matrix verified; starting prepared writer/completion/replay proof.');

  const sourceFields = ['id','payment_number','customer_id','order_id','amount_in_minor_units','payment_method',
    'reference_number','notes','created_by','created_at','cash_shift_id','idempotency_key','is_reversed',
    'reversed_at','reversed_by','reversal_reason'];
  const sourceChanges = {id:randomUUID(),payment_number:'CRV-wrong',customer_id:randomUUID(),order_id:randomUUID(),
    amount_in_minor_units:301,payment_method:'cliq',reference_number:'wrong',notes:'wrong',created_by:randomUUID(),
    created_at:'2000-01-01T00:00:00+00:00',cash_shift_id:randomUUID(),idempotency_key:randomUUID(),is_reversed:true,
    reversed_at:'2000-01-01T00:00:00+00:00',reversed_by:randomUUID(),reversal_reason:'wrong'};
  const sourceChallenge = (expression) => `
    BEGIN PERFORM phase5_private.assert_collection_source_tuple_v1(c,'customer_payments','INSERT',NULL,${expression});
      RAISE EXCEPTION 'QA_SOURCE_TUPLE_CORRUPTION_ACCEPTED';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    EXECUTE ${q(fingerprintQuery)} INTO after_hash;
    IF before_hash IS DISTINCT FROM after_hash THEN RAISE EXCEPTION 'QA_SOURCE_GUARD_WROTE_CONTENT'; END IF;`;
  await sql(`BEGIN; ${instrument} DO $$ DECLARE c UUID; locked JSONB; tuple JSONB; before_hash JSONB; after_hash JSONB;
    BEGIN c := ${enter}; SELECT to_jsonb(t) INTO locked FROM phase5_private.mutation_contexts t WHERE id=c;
    tuple := jsonb_build_object('id',(locked->'locked_plan'->>'paymentId')::uuid,
      'payment_number',locked->'locked_plan'->>'paymentNumber','customer_id',${q(customer)}::uuid,
      'order_id',${q(plannedSale.orderId)}::uuid,'amount_in_minor_units',300,'payment_method','cash',
      'reference_number',NULL,'notes',NULL,'created_by',${q(owner)}::uuid,
      'created_at',(locked->'locked_plan'->>'paymentEventAt')::timestamptz,
      'cash_shift_id',${q(plan.currentShift.id)}::uuid,'idempotency_key',${q(plannedRequest.idempotencyKey)},
      'is_reversed',false,'reversed_at',NULL,'reversed_by',NULL,'reversal_reason',NULL);
    IF NOT phase5_private.assert_collection_source_tuple_v1(c,'customer_payments','INSERT',NULL,tuple) THEN
      RAISE EXCEPTION 'QA_SOURCE_TUPLE_VALID_CONTROL_FAILED'; END IF;
    EXECUTE ${q(fingerprintQuery)} INTO before_hash;
    ${sourceFields.map((field) => sourceChallenge(`tuple - ${q(field)}`)).join('\n')}
    ${Object.entries(sourceChanges).map(([field,value]) => sourceChallenge(`jsonb_set(tuple,ARRAY[${q(field)}],${j(value)})`)).join('\n')}
    ${sourceChallenge("tuple || '{\"extra\":true}'::jsonb")}
    ${sourceChallenge('NULL')}
    ${sourceChallenge("'null'::jsonb")}
    END $$; ROLLBACK;`);
  checks += 1+sourceFields.length+Object.keys(sourceChanges).length+3;
  assert.equal(await fingerprint(),discoveryBefore);
  for (const [relation,event] of [['customer_payments','UPDATE'],['customer_payments','DELETE'],
    ['orders','INSERT'],['cash_shifts','UPDATE'],['orders',null]]) {
    await fails(`${instrument} DO $$ DECLARE c UUID; BEGIN c := ${enter};
      PERFORM phase5_private.assert_collection_source_tuple_v1(c,${relation===null?'NULL':q(relation)},
        ${event===null?'NULL':q(event)},NULL,'{}'); END $$;`,/PHASE5_COLLECTION_SOURCE_ACTION_UNSUPPORTED/u);
  }
  passed.push('exact prewrite16-field source tuple: every missing/mismatched field, extra key, SQL/JSON NULL and unsupported action rejects with unchanged content; no GUC or non-null Shift exemption');

  // Exercise private prepared primitives, NOT a public activation rehearsal.
  // No COMMIT: deferred constraints are explicitly forced in rollback state.
  // Sequence gaps are expected; durable business content must fully roll back.
  const issuedSetup = `c := ${enter};
    SELECT to_jsonb(t) INTO locked FROM phase5_private.mutation_contexts t WHERE id=c;
    payment_id := (locked->'locked_plan'->>'paymentId')::uuid;
    ALTER TABLE phase5_private.collection_attempt_envelopes DISABLE TRIGGER phase5_preparation_attempt_barrier;
    result := phase5_private.create_customer_payment_prelocked_v1(c,payment_id,${q(operation)},${j(plannedRequest)});`;
  const issuedDeclarations = 'c UUID; locked JSONB; payment_id UUID; result JSONB; replay JSONB; before_hash JSONB; after_hash JSONB;';
  await sql(`BEGIN; ${instrument} DO $$ DECLARE ${issuedDeclarations} BEGIN ${issuedSetup}
    IF result->>'kind' IS DISTINCT FROM 'COMMITTED_COLLECTION'
      OR result->>'outstandingBeforeInMinorUnits' IS DISTINCT FROM '1000'
      OR result->>'outstandingAfterInMinorUnits' IS DISTINCT FROM '700'
      OR (SELECT amount_paid_in_minor_units FROM public.orders WHERE id=${q(plannedSale.orderId)})<>300
      OR (SELECT count(*) FROM public.customer_payments WHERE id=payment_id)<>1
      OR (SELECT count(*) FROM phase5_private.collection_attempt_envelopes WHERE financial_operation_id=${q(operation)})<>1 THEN
      RAISE EXCEPTION 'QA_PREPARED_PAYMENT_OUTCOME_INVALID'; END IF;
    SET CONSTRAINTS phase5_private.phase5_context_completion,phase5_private.phase5_attempt_completion IMMEDIATE;
    EXECUTE ${q(fingerprintQuery)} INTO before_hash;
    replay := phase5_private.resolve_collection_attempt_v2(${j(plannedRequest)});
    EXECUTE ${q(fingerprintQuery)} INTO after_hash;
    IF replay IS DISTINCT FROM result OR before_hash IS DISTINCT FROM after_hash THEN
      RAISE EXCEPTION 'QA_PREPARED_REPLAY_CHANGED_DURABLE_CONTENT'; END IF;
    -- Replay does not consult new mutation eligibility or generation authority.
    UPDATE phase5_private.authority_generation SET generation=0,authority_state='PRIVATE_INACTIVE';
    EXECUTE ${q(fingerprintQuery)} INTO before_hash;
    replay := phase5_private.resolve_collection_attempt_v2(${j(plannedRequest)});
    EXECUTE ${q(fingerprintQuery)} INTO after_hash;
    IF replay IS DISTINCT FROM result OR before_hash IS DISTINCT FROM after_hash THEN
      RAISE EXCEPTION 'QA_PREPARED_REPLAY_NEW_GENERATION_GATE'; END IF;
    END $$; ROLLBACK;`);
  checks += 3;
  assert.equal(await fingerprint(),discoveryBefore);
  passed.push('real private prelocked Cash primitive + original124 anchors + audit/envelope/projection; forced deferred completion; exact stored replay content-zero-write even without current generation. Rollback-only proof, not committed public operational activation');

  const projectionChanges = {amount_paid_in_minor_units:301,payment_status:'paid',customer_id:randomUUID(),
    total_in_minor_units:1001,source:'website',operation_id:randomUUID(),status:'cancelled',internal_notes:'changed',
    updated_at:'2000-01-01T00:00:00+00:00'};
  // Exercise the exact migration writer prefix at the genuine preprojection
  // boundary. Rewinding a completed Order cannot recreate OLD: its unchanged
  // updated-at trigger stamps the rewind. Never disable that public trigger.
  const writerSql = migrationBytes.toString('utf8').replace(/\r\n?/gu,'\n').match(/CREATE FUNCTION phase5_private\.create_customer_payment_prelocked_v1\([\s\S]*?AS \$\$\s*DECLARE ([\s\S]*?)\nBEGIN\n([\s\S]*?)\n {2}PERFORM phase5_private\.assert_collection_source_tuple_v1\(context_identity,'orders','UPDATE',/u);
  assert.ok(writerSql,'Exact source-grounded writer preprojection boundary must exist');
  await sql(`BEGIN; ${instrument}
    DO $$ DECLARE ${writerSql[1]}
      context_identity UUID; payment_identity UUID; operation_identity UUID := ${q(operation)};
      r JSONB := ${j(plannedRequest)}; old_order JSONB; projected JSONB; before_hash JSONB; after_hash JSONB;
    BEGIN context_identity := ${enter};
    SELECT (locked_plan->>'paymentId')::uuid INTO payment_identity
      FROM phase5_private.mutation_contexts WHERE id=context_identity;
    ALTER TABLE phase5_private.collection_attempt_envelopes DISABLE TRIGGER phase5_preparation_attempt_barrier;
    ${writerSql[2]}
    old_order := c->'locked_plan'->'order';
    projected := old_order || jsonb_build_object('amount_paid_in_minor_units',300,'payment_status','partially_paid',
      'updated_at',(c->'locked_plan'->>'paymentEventAt')::timestamptz);
    IF NOT phase5_private.assert_collection_source_tuple_v1(context_identity,'orders','UPDATE',old_order,projected) THEN
      RAISE EXCEPTION 'QA_VALID_PROJECTION_TUPLE_REJECTED'; END IF;
    EXECUTE ${q(fingerprintQuery)} INTO before_hash;
    ${Object.entries(projectionChanges).map(([field,value]) => `
      BEGIN PERFORM phase5_private.assert_collection_source_tuple_v1(context_identity,'orders','UPDATE',old_order,
        jsonb_set(projected,ARRAY[${q(field)}],${j(value)})); RAISE EXCEPTION 'QA_PROJECTION_CORRUPTION_ACCEPTED';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;`).join('\n')}
    BEGIN PERFORM phase5_private.assert_collection_source_tuple_v1(context_identity,'orders','UPDATE',projected,projected);
      RAISE EXCEPTION 'QA_FORGED_OLD_PROJECTION_ACCEPTED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      UPDATE public.orders SET internal_notes='Changed actual before projection' WHERE id=${q(plannedSale.orderId)};
      BEGIN PERFORM phase5_private.assert_collection_source_tuple_v1(context_identity,'orders','UPDATE',old_order,projected);
        RAISE EXCEPTION 'QA_ACTUAL_SOURCE_DRIFT_ACCEPTED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      RAISE EXCEPTION USING ERRCODE='P9998',MESSAGE='QA_ROLLBACK_SOURCE_DRIFT';
    EXCEPTION WHEN SQLSTATE 'P9998' THEN NULL; END;
    EXECUTE ${q(fingerprintQuery)} INTO after_hash;
    IF before_hash IS DISTINCT FROM after_hash THEN RAISE EXCEPTION 'QA_PROJECTION_GUARD_WROTE_CONTENT'; END IF;
    END $$; ROLLBACK;`);
  checks += 1+Object.keys(projectionChanges).length+2;
  assert.equal(await fingerprint(),discoveryBefore);
  passed.push('prepared primitive invokes source/projection guards before DML; live-old versus frozen-old identity, projection-only exact changed fields and durable-before-projection evidence reject unrelated mutation; rollback restores state');

  await fails(`${instrument} DO $$ DECLARE c UUID; BEGIN c := ${enter};
    SET CONSTRAINTS phase5_private.phase5_context_completion IMMEDIATE; END $$;`,/PHASE5_COLLECTION_ATTEMPT_INCOMPLETE/u);
  await fails(`${instrument} DO $$ DECLARE c UUID; BEGIN c := ${enter};
    PERFORM phase5_private.create_customer_payment_prelocked_v1(c,gen_random_uuid(),${q(operation)},${j(plannedRequest)});
    END $$;`,/PHASE5_COLLECTION_PREALLOCATED_IDENTITY_INVALID/u);
  await fails(`${instrument} DO $$ DECLARE c UUID; BEGIN c := ${enter};
    UPDATE phase5_private.mutation_contexts SET transaction_id=transaction_id+1 WHERE id=c; END $$;`,/PHASE5_COLLECTION_CONTROL_IMMUTABLE/u);
  await fails(`${instrument} DO $$ DECLARE ${issuedDeclarations} BEGIN ${issuedSetup}
    UPDATE phase5_private.collection_attempt_envelopes SET result_snapshot='{}' WHERE financial_operation_id=${q(operation)};
    END $$;`,/PHASE5_COLLECTION_CONTROL_IMMUTABLE/u);
  await fails(`${instrument} DO $$ DECLARE ${issuedDeclarations} BEGIN ${issuedSetup}
    PERFORM phase5_private.resolve_collection_attempt_v2(${j({...plannedRequest,notes:'different payload'})}); END $$;`,
  /23505.*PHASE5_COLLECTION_IDEMPOTENCY_CONFLICT/u);

  for (const corruption of [
    `UPDATE public.audit_logs SET details=jsonb_set(details,'{paymentNumber}','"wrong"') WHERE id=(locked->'locked_plan'->>'auditId')::uuid;`,
    `UPDATE public.audit_logs SET entity_id=gen_random_uuid() WHERE id=(locked->'locked_plan'->>'auditId')::uuid;`,
    `INSERT INTO public.audit_logs(id,user_id,action,entity_name,entity_id,details,created_at)
      SELECT gen_random_uuid(),user_id,action,entity_name,entity_id,details,created_at FROM public.audit_logs
      WHERE id=(locked->'locked_plan'->>'auditId')::uuid;`,
    `DELETE FROM public.audit_logs WHERE id=(locked->'locked_plan'->>'auditId')::uuid;`,
    `UPDATE public.customer_payments SET notes='different notes' WHERE id=payment_id;`,
    `UPDATE public.customer_payments SET amount_in_minor_units=301 WHERE id=payment_id;`,
    `UPDATE phase5_private.collection_attempt_envelopes SET result_snapshot=jsonb_set(result_snapshot,'{paymentNumber}','"wrong"') WHERE financial_operation_id=${q(operation)};`,
    `UPDATE phase5_private.mutation_contexts SET locked_plan=jsonb_set(locked_plan,'{paymentId}',to_jsonb(gen_random_uuid()::text)) WHERE id=c;`,
    `UPDATE phase5_private.mutation_contexts SET locked_plan=jsonb_set(locked_plan,'{request,notes}','"changed"') WHERE id=c;`,
    `UPDATE phase5_private.mutation_contexts SET locked_plan=jsonb_set(locked_plan,'{requestFingerprint}',to_jsonb(repeat('F',64))) WHERE id=c;`,
    `UPDATE phase5_private.mutation_contexts SET locked_plan=jsonb_set(locked_plan,'{paymentNumber}','"CRV-wrong"') WHERE id=c;`,
    `UPDATE phase5_private.mutation_contexts SET locked_plan=jsonb_set(locked_plan,'{paymentEventAt}','"2000-01-01T00:00:00.000000Z"') WHERE id=c;`,
  ]) {
    // Audit DELETE is independently rejected by the durable FK; do not disable
    // it or pretend that this is a central-validator rejection.
    if (corruption.startsWith('DELETE')) {
      await fails(`${instrument} DO $$ DECLARE ${issuedDeclarations} BEGIN ${issuedSetup} ${corruption} END $$;`,/23503/u);
    } else {
      const mutableSetup = issuedSetup.replace('DISABLE TRIGGER phase5_preparation_attempt_barrier;',
        'DISABLE TRIGGER phase5_preparation_attempt_barrier; ALTER TABLE phase5_private.collection_attempt_envelopes DISABLE TRIGGER phase5_attempt_immutable;');
      await sql(`BEGIN; ${instrument}
        ALTER TABLE phase5_private.mutation_contexts DISABLE TRIGGER phase5_context_immutable;
        DO $$ DECLARE ${issuedDeclarations} BEGIN ${mutableSetup}
        ${corruption}
        EXECUTE ${q(fingerprintQuery)} INTO before_hash;
        BEGIN PERFORM phase5_private.resolve_collection_attempt_v2(${j(plannedRequest)});
          RAISE EXCEPTION 'QA_CORRUPTED_REPLAY_ACCEPTED';
        EXCEPTION WHEN check_violation THEN NULL; END;
        BEGIN PERFORM phase5_private.complete_collection_attempt_v1(${q(operation)});
          RAISE EXCEPTION 'QA_CORRUPTED_COMPLETION_ACCEPTED';
        EXCEPTION WHEN check_violation THEN NULL; END;
        EXECUTE ${q(fingerprintQuery)} INTO after_hash;
        IF before_hash IS DISTINCT FROM after_hash THEN RAISE EXCEPTION 'QA_REJECTION_MUTATED_DURABLE_STATE'; END IF;
        END $$; ROLLBACK;`);
      checks += 3;
    }
    assert.equal(await fingerprint(),discoveryBefore);
  }
  passed.push('durable source/audit/context/result corruption rejects in same central completion and replay paths; immutable guards and audit FK intact; content-sensitive no-new-write and outer rollback equality');

  const cliqRequest = {...plannedRequest,tenderMethod:'cliq',tenderReference:'PREPARED-CLIQ'};
  await fails(`${instrument} DO $$ DECLARE ${issuedDeclarations} BEGIN
    c := phase5_private.enter_authority_context_v1(${q(owner)},'CUSTOMER_COLLECTION',${q(plannedSale.orderId)},
      ${j({request:cliqRequest,operationId:operation})});
    SELECT to_jsonb(t) INTO locked FROM phase5_private.mutation_contexts t WHERE id=c;
    payment_id := (locked->'locked_plan'->>'paymentId')::uuid;
    ALTER TABLE phase5_private.collection_attempt_envelopes DISABLE TRIGGER phase5_preparation_attempt_barrier;
    PERFORM phase5_private.create_customer_payment_prelocked_v1(c,payment_id,${q(operation)},${j(cliqRequest)});
    END $$;`,/PHASE4_SHIFT_LOCK_CONTEXT_REQUIRED/u);
  assert.equal(await fingerprint(),discoveryBefore);
  assert.equal(await json(`${claims} SELECT to_jsonb(phase5_private.resolve_collection_attempt_v2(${j(plannedRequest)}) IS NULL);`),true);
  const oldPaymentId = await json(`SELECT to_jsonb(id) FROM public.customer_payments
    WHERE order_id=${q(sale.orderId)} AND reference_number='S5-EXISTING';`);
  const foundationRequest = {...plannedRequest,orderId:sale.orderId,tenderMethod:'cliq',tenderReference:'S5-EXISTING',notes:null};
  await sql(`BEGIN; ${claims} DO $$ DECLARE outcome JSONB; BEGIN
    outcome := phase5_private.commit_customer_collection_v1(${q(owner)},${q(sale.orderId)},${q(oldPaymentId)},
      300,'cliq','S5-EXISTING',${q(foundationRequest.idempotencyKey)});
    IF phase5_private.resolve_collection_attempt_v2(${j(foundationRequest)}) IS NOT NULL THEN
      RAISE EXCEPTION 'QA_FOUNDATION_ADOPTED_AS_PREPARED_SUCCESS'; END IF;
    BEGIN PERFORM phase5_private.validate_collection_attempt_v1((outcome->>'operationId')::uuid);
      RAISE EXCEPTION 'QA_FOUNDATION_WITHOUT_CONTEXT_ACCEPTED';
    EXCEPTION WHEN check_violation THEN NULL; END;
    END $$; ROLLBACK;`);
  checks += 2;
  assert.equal(await fingerprint(),discoveryBefore);
  passed.push('unchanged120 CliQ Shift trigger remains fail-closed with zero partial writes, no fake Cash Shift/GUC/public-trigger bypass; old foundation-only payment is not adopted as prepared success');
  console.log('Prepared writer/rejection matrix verified; starting application-role boundaries and DB lint.');

  await fails(`INSERT INTO phase5_private.mutation_contexts(id,transaction_id,generation,actor_id,order_id,
    purpose,operation_id,normalized_request,request_fingerprint,locked_plan)
    VALUES(gen_random_uuid(),txid_current(),1,${q(owner)},${q(sale.orderId)},'CUSTOMER_COLLECTION',
      gen_random_uuid(),${j(request)},repeat('A',64),'{}');`,/PHASE5_PREPARATION_ONLY/u);
  await fails(`INSERT INTO phase5_private.collection_attempt_envelopes(financial_operation_id,collection_id,
    original_payment_id,payment_audit_id,context_id,actor_id,order_id,idempotency_key,request_snapshot,request_fingerprint,result_snapshot)
    VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),${q(owner)},${q(sale.orderId)},
      ${q(key)},${j(request)},repeat('A',64),${j(result)});`,/PHASE5_PREPARATION_ONLY/u);
  for (const role of ['anon','authenticated','service_role']) {
    await fails(`SET ROLE ${role}; SELECT phase5_private.assert_collection_request_v2(${j(request)});`,/permission denied/u);
    for (const call of [
      `authorize_collection_request_v2(${j(plannedRequest)})`,
      `discover_collection_write_plan_v2(${j(plannedRequest)})`,
      `lock_collection_generation_v2(${j(plannedRequest)})`,
      `assert_collection_plan_unchanged_v2(${j(plannedRequest)},${j(plan)})`,
      `collection_plan_resources_v2(${q(plannedSale.orderId)},${j(plan.facts)})`,
      `lock_collection_write_plan_v2(${j(plannedRequest)})`,
      `enter_authority_context_v1(${q(owner)},'CUSTOMER_COLLECTION',${q(plannedSale.orderId)},${j(details)})`,
      `assert_collection_context_v2(${q(randomUUID())},${j(plannedRequest)})`,
      `validate_collection_before_snapshot_v1('{}'::jsonb)`,
      `validate_collection_attempt_v1(${q(randomUUID())})`,
      `complete_collection_attempt_v1(${q(randomUUID())})`,
      `create_customer_payment_prelocked_v1(${q(randomUUID())},${q(randomUUID())},${q(randomUUID())},${j(plannedRequest)})`,
      `resolve_collection_attempt_v2(${j(plannedRequest)})`,
      'guard_collection_control_history_v1()',
      'assert_source_completion_v1()',
      `assert_collection_permit_v1(${q(randomUUID())})`,
      `assert_collection_source_tuple_v1(${q(randomUUID())},'customer_payments','INSERT',NULL,'{}')`,
      'guard_source_generation_v1()',
      `discover_collection_union_plan_v1(${j(unionRequests)})`,
      `assert_collection_union_unchanged_v1(${j(unionRequests)},${j(unionPlan)})`,
      `discover_customer_completion_plan_v1(${completionArgs})`,
      `assert_customer_completion_plan_unchanged_v1(${completionArgs},${j(completionPlan)})`,
      `discover_customer_completion_union_v1(${completionArgs})`,
      `assert_customer_completion_union_unchanged_v1(${completionArgs},${j(parentChildPlan)})`,
      'lock_customer_completion_generation_v1()',
      `lock_customer_completion_plan_v1(${completionArgs})`,
      `discover_customer_completion_union_core_v1(${completionArgs},NULL)`,
      `derive_customer_completion_deltas_v1(${j({...parentChildPlan,planState:'LOCKED_PARENT_RESOURCES_ONLY',completeFor:'CUSTOMER_COMPLETION_LOCK_ACQUISITION_ONLY'})},NOW())`,
      `enter_customer_completion_context_v1(${completionArgs})`,
      `assert_customer_completion_context_v1(${q(randomUUID())})`,
      `validate_customer_completion_inventory_v1(${q(randomUUID())})`,
      `validate_customer_completion_cost_v1(${q(randomUUID())})`,
      `derive_customer_completion_outcome_v1('{}'::jsonb)`,
      `validate_customer_completion_outcome_v1(${q(randomUUID())})`,
      `derive_customer_completion_child_link_v1('{}'::jsonb)`,
      `enter_customer_completion_child_context_v1(${q(randomUUID())})`,
      `validate_customer_completion_child_link_v1(${q(randomUUID())})`,
      `derive_customer_completion_writes_v1('{}'::jsonb)`,
      `assert_customer_completion_permit_v1(${q(randomUUID())})`,
      `read_customer_completion_source_row_v1('public.orders',${q(randomUUID())})`,
      `assert_customer_completion_prefix_v1(${q(randomUUID())},1)`,
      `assert_customer_completion_source_tuple_v1(${q(randomUUID())},1,'public.orders','UPDATE','{}','{}')`,
      `complete_customer_completion_context_v1(${q(randomUUID())})`,
      `execute_customer_completion_prelocked_v1(${q(randomUUID())})`,
      `resolve_customer_completion_v1(${mixedArgs})`,
    ]) await fails(`SET ROLE ${role}; SELECT phase5_private.${call};`,/permission denied/u);
    for (const relation of ['authority_generation','activation_receipts','mutation_contexts','collection_attempt_envelopes']) {
      for (const action of [`SELECT * FROM phase5_private.${relation};`,
        `DELETE FROM phase5_private.${relation};`,`TRUNCATE phase5_private.${relation};`]) {
        await fails(`SET ROLE ${role}; ${action}`,/permission denied/u);
      }
    }
  }
  const catalog = await json(`SELECT jsonb_agg(jsonb_build_object('table',c.relname,'owner',pg_get_userbyid(c.relowner),
    'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'policies',(SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid),
    'appPrivileges',(SELECT count(*) FROM unnest(ARRAY['anon','authenticated','service_role']) r
      WHERE has_table_privilege(r,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))
    ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='phase5_private' AND c.relname IN ('authority_generation','activation_receipts','mutation_contexts','collection_attempt_envelopes');`);
  assert.equal(catalog.length,4);
  for (const table of catalog) {
    assert.equal(table.owner,'postgres'); assert.equal(table.rls,true); assert.equal(table.forceRls,true);
    assert.equal(table.policies,0); assert.equal(table.appPrivileges,0);
  }
  assert.equal(await json(`SELECT to_jsonb(count(*)) FROM pg_trigger WHERE NOT tgisinternal
    AND tgrelid IN ('phase5_private.authority_generation'::regclass,'phase5_private.activation_receipts'::regclass,
      'phase5_private.mutation_contexts'::regclass,'phase5_private.collection_attempt_envelopes'::regclass)
    AND tgenabled='O';`),8);
  assert.equal(await json(`SELECT to_jsonb(count(*)) FROM pg_trigger
    WHERE tgfoid='phase5_private.guard_source_generation_v1()'::regprocedure;`),0);
  assert.equal(await fingerprint(),discoveryBefore);
  passed.push('app roles denied prepared tables/helpers; postgres preparation barrier; all rejected probes content-sensitive zero-write');
  // A genuine committed private completion fixture on the disposable stack.
  // Force INITIAL deferred proof first, then restore generation0 and all private
  // barriers BEFORE COMMIT. No public function/grant/trigger is switched. The
  // fixture is removed with this entire owned isolated stack, never Production.
  const replayFixture=await json(`SELECT set_config('request.jwt.claim.role','service_role',false);
    SELECT public.submit_guest_customer_order_v2(${q(randomUUID())},repeat('c',64),repeat('d',64),
      'Slice5 historical replay',${q(`079${String(Math.floor(Math.random()*1e7)).padStart(7,'0')}`)},
      'إربد','الرمثا','الحي الشرقي','شارع الاختبار',NULL,NULL,NULL,NULL,NULL,NULL,
      ${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:2,expected_unit_price_in_minor_units:1000},
        {commercial_line_kind:'configurable_parcel',family_product_id:'92400000-0000-0000-0000-000000000100',
          parcel_configuration_id:'92400000-0000-0000-0000-000000000300',configuration_revision:1,
          expected_unit_price_in_minor_units:5000,parcel_instances:[{components:[
            {product_id:product,base_quantity:2},{product_id:'92400000-0000-0000-0000-000000000102',base_quantity:3}]}]}])},
      NULL,'cash_on_delivery','inside_ramtha',7000,0,100,7100);`);
  await sql(`UPDATE public.orders SET status='ready' WHERE id=${q(replayFixture.order_id)};`);
  const committedArgs=`${q(replayFixture.order_id)},${q(randomUUID())},'cash',300,NULL,NULL,NULL`;
  const originalBarrier=await json(`SELECT to_jsonb(pg_get_functiondef('phase5_private.reject_preparation_write_v1()'::regprocedure));`);
  const committedParentReplay=`phase5_private.resolve_customer_completion_v1(${committedArgs})`;
  const committedResult=await json(`BEGIN; ${parentExecutorStage.replace(mixedArgs,committedArgs)}
    SET CONSTRAINTS ALL IMMEDIATE;
    ALTER TABLE phase5_private.authority_generation DISABLE TRIGGER phase5_preparation_generation_barrier;
    ALTER TABLE phase5_private.activation_receipts DISABLE TRIGGER phase5_preparation_activation_barrier;
    UPDATE phase5_private.authority_generation SET generation=0,authority_state='PRIVATE_INACTIVE';
    DELETE FROM phase5_private.activation_receipts;
    ALTER TABLE phase5_private.authority_generation ENABLE TRIGGER phase5_preparation_generation_barrier;
    ALTER TABLE phase5_private.activation_receipts ENABLE TRIGGER phase5_preparation_activation_barrier;
    ${originalBarrier}; SELECT ${committedParentReplay}; COMMIT;`);
  assert.equal(committedResult.success,true); assert.equal(committedResult.amount_paid_in_minor_units,300); checks+=2;
  assert.equal(await privateGuardDefinitions(),privateGuardsBefore); checks+=1;
  const committedBefore=await fingerprint();
  assert.deepEqual(await json(`${claims} SELECT ${committedParentReplay};`),committedResult);
  assert.equal(await fingerprint(),committedBefore,'historical-parent-replay-zero-write'); checks+=2;
  // A real later canonical collection changes paid/debt and adds independently
  // owned financial evidence, but must not invalidate original completion.
  await sql(`${claims} SELECT public.record_customer_order_payment(${q(replayFixture.order_id)},200,'cash',NULL,'Later independent collection');`);
  const evolvedBefore=await fingerprint();
  assert.equal(await json(`SELECT to_jsonb(amount_paid_in_minor_units) FROM public.orders WHERE id=${q(replayFixture.order_id)};`),500);
  assert.deepEqual(await json(`${claims} SELECT ${committedParentReplay};`),committedResult);
  assert.equal(await fingerprint(),evolvedBefore,'historical-replay-changed-state'); checks+=3;
  assert.equal(await json(`BEGIN; ${claims}
    UPDATE public.orders SET customer_notes='Later independent notes' WHERE id=${q(replayFixture.order_id)};
    UPDATE public.products SET wac_cost_in_minor_units_exact=98765,cost_price_in_minor_units=98765 WHERE id=${q(product)};
    UPDATE public.inventory_balances SET on_hand_quantity=on_hand_quantity+17 WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)};
    CREATE TEMP TABLE evolved_replay_before AS ${fingerprintQuery}
    DO $proof$ DECLARE h jsonb; BEGIN
      IF ${committedParentReplay} IS DISTINCT FROM ${j(committedResult)} THEN RAISE EXCEPTION 'QA_HISTORICAL_CHANGED_RESULT'; END IF;
      ${fingerprintQuery.replace(/;$/u,'')} INTO h;
      IF h IS DISTINCT FROM (SELECT * FROM evolved_replay_before) THEN RAISE EXCEPTION 'QA_HISTORICAL_REPLAY_MUTATION'; END IF;
      IF EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory')
        THEN RAISE EXCEPTION 'QA_HISTORICAL_REPLAY_BUSINESS_LOCK'; END IF;
    END $proof$; SELECT to_jsonb(true); ROLLBACK;`),true); checks+=1;
  await fails(`${claims} SELECT ${committedParentReplay.replace("'cash',300","'cash',301")};`,/23505.*IDEMPOTENCY_CONFLICT/u);
  await fails(`SELECT set_config('request.jwt.claims','{}',false); SELECT ${committedParentReplay};`,/42501.*ACTOR_UNAUTHORIZED/u);
  assert.equal(await fingerprint(),evolvedBefore); checks+=1;
  assert.equal(await json(`SELECT to_jsonb(generation) FROM phase5_private.authority_generation;`),0); checks+=1;
  passed.push('committed historical Customer multi-item replay on separate connection: exact stored result and zero writes after actual later collection/paid-state evolution, notes/current WAC/balance changes; actor-first changed-key identity safety, generation0/private barriers restored and no public activation');
  // Historical completion remains the original outcome after REAL aftercare,
  // rather than rediscovering eligibility or adopting later financial facts.
  const proveAftercareReplay=async (label) => {
    const before=await fingerprint();
    assert.deepEqual(await json(`${claims} SELECT ${committedParentReplay};`),committedResult,label);
    assert.equal(await fingerprint(),before,`${label}-zero-write-including-aftercare`); checks+=2;
  };
  const replaySources=await json(`SELECT jsonb_build_object(
    'baseItemId',(SELECT id FROM public.order_items WHERE order_id=${q(replayFixture.order_id)} AND commercial_line_kind='base_unit'),
    'componentId',(SELECT c.id FROM public.order_parcel_components c JOIN public.order_parcel_instances p
      ON p.id=c.parcel_instance_id WHERE p.order_id=${q(replayFixture.order_id)} AND c.product_id=${q(product)}));`);
  const laterReturn=await json(`${claims} SELECT public.settle_sales_return_v1(
    ${q(replayFixture.order_id)},${q(randomUUID())},${j([{return_scope:'base_unit',order_item_id:replaySources.baseItemId,
      quantity:1,stock_disposition:'restock'}])},'Slice5 historical completion after Return',NULL,NULL,NULL);`);
  assert.equal(laterReturn.success,true);
  assert.equal(laterReturn.merchandiseEntitlementInMinorUnits,1000);
  assert.equal(laterReturn.debtReductionInMinorUnits,1000);
  assert.equal(laterReturn.moneyRefundInMinorUnits,0);
  assert.equal(laterReturn.refundMethod,null); checks+=5;
  await proveAftercareReplay('historical-completion-after-real-return');
  const laterReplacement=await json(`${claims} SELECT public.settle_sales_replacement_v1(
    ${q(replayFixture.order_id)},${q(randomUUID())},${j([{sourceKind:'parcel_component',sourceId:replaySources.componentId,quantity:1}])},
    'Slice5 historical completion after Replacement',NULL);`);
  assert.equal(laterReplacement.success,true); checks+=1;
  await proveAftercareReplay('historical-completion-after-real-replacement');
  const laterContext=await json(`${claims} SELECT public.get_admin_sales_aftercare_context_v1(${q(replayFixture.order_id)});`);
  const laterParcel=laterContext.parcelInstances[0];
  assert.ok(laterParcel.components.some((c)=>c.physicalRepresentatives.some((s)=>s.sourceKind==='replacement_item'))); checks+=1;
  const parcelItems=[{return_scope:'parcel_instance',order_item_id:laterParcel.orderItemId,
    parcel_instance_id:laterParcel.parcelInstanceId,components:laterParcel.components.map((c)=>({
      parcel_component_id:c.parcelComponentId,accepted_quantity:c.physicalRepresentatives.reduce((n,s)=>n+s.remainingQuantity,0),
      rejected_quantity:0,accepted_condition:'sellable',accepted_stock_disposition:'restock',
      rejection_reason:null,rejected_stock_disposition:null}))}];
  const physicalSources=laterParcel.components.flatMap((c)=>c.physicalRepresentatives.map((s)=>({
    root_source_kind:'parcel_component',root_source_id:c.parcelComponentId,source_kind:s.sourceKind,source_id:s.sourceId,
    product_id:s.productId,quantity:s.remainingQuantity,sellable_restock_quantity:s.remainingQuantity,
    defect_non_sellable_quantity:0,customer_damage_quantity:0})));
  const laterWholeReturn=await json(`${claims} SELECT public.settle_admin_sales_return_v1(
    ${q(replayFixture.order_id)},${q(randomUUID())},${j(parcelItems)},${j(physicalSources)},
    'Slice5 historical completion after Replacement then whole Parcel Return',NULL,NULL,NULL);`);
  assert.equal(laterWholeReturn.success,true);
  assert.equal(laterWholeReturn.merchandiseEntitlementInMinorUnits,5000);
  assert.equal(laterWholeReturn.debtReductionInMinorUnits,5000);
  assert.equal(laterWholeReturn.moneyRefundInMinorUnits,0);
  assert.equal(laterWholeReturn.refundMethod,null); checks+=5;
  await proveAftercareReplay('historical-completion-after-replacement-whole-parcel-return');
  // Same textual key under another admitted actor must not disclose the
  // original actor's result. This probes scope, not a public helper grant.
  const otherClaims=`SELECT set_config('request.jwt.claims','{"sub":"92400000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',false);`;
  const crossActorBefore=await fingerprint();
  assert.equal(await json(`${otherClaims} SELECT to_jsonb(${committedParentReplay} IS NULL);`),true);
  assert.equal(await json(`${otherClaims} SELECT to_jsonb(${committedParentReplay.replace("'cash',300","'cash',301")} IS NULL);`),true);
  assert.equal(await fingerprint(),crossActorBefore); checks+=3;
  await fails(`${claims} UPDATE public.profiles SET is_active=false WHERE id=${q(owner)};
    SELECT ${committedParentReplay};`,/42501.*ACTOR_UNAUTHORIZED/u);
  assert.equal(await fingerprint(),crossActorBefore); checks+=1;
  // Close through the historical public RPC, preserving its actual immutable
  // closing report. No artificial status update and no newly opened Shift.
  const openShifts=await json(`SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb)
    FROM public.cash_shifts WHERE branch_id=${q(branch)} AND status='open';`);
  assert.ok(openShifts.length>0); checks+=1;
  for(const shiftId of openShifts) {
    const summary=await json(`${claims} SELECT public.get_cash_shift_summary(${q(shiftId)});`);
    const closed=await json(`${claims} SELECT public.close_cash_shift(${q(shiftId)},${summary.expectedCashInMinorUnits},NULL);`);
    assert.equal(closed.success,true); checks+=1;
  }
  assert.equal(await json(`SELECT to_jsonb(count(*)) FROM public.cash_shifts
    WHERE branch_id=${q(branch)} AND status='open';`),0); checks+=1;
  await proveAftercareReplay('historical-completion-after-public-shift-closure');
  assert.equal(await json(`BEGIN; ${claims} SELECT ${committedParentReplay};
    SELECT to_jsonb(count(*)) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory'; ROLLBACK;`),0); checks+=1;
  assert.equal(await privateGuardDefinitions(),privateGuardsBefore); checks+=1;
  passed.push('historical completion intersections: real Base Return, operational Replacement then whole Parcel Return, actor-scoped no-leakage and inactive actor denial, actual public Shift closure/no open Shift, exact immutable replay with full aftercare content fingerprint and no advisory business lock');
  legacyModernOrder=replayFixture.order_id;
  }
  if(!shiftPaymentFocused) {
  const legacyOtherClaims=`SELECT set_config('request.jwt.claims','{"sub":"92400000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',false);`;
  // Real historical entrypoints, not manually relabeled modern rows. This new
  // stage is admission/commercial discovery only; old public writers remain
  // authoritative until a separately authorized activation.
  //004 resolves historical guest checkout to the earliest active branch and
  //warehouse, not the POS fixture. Capture these independent catalog anchors.
  const legacySource=await json(`SELECT jsonb_build_object(
    'branchId',(SELECT id FROM public.branches WHERE is_active ORDER BY created_at LIMIT 1),
    'warehouseId',(SELECT id FROM public.warehouses WHERE is_active ORDER BY created_at LIMIT 1));`);
  if(legacyFocused) {
    // The broad Customer matrix normally stocks004's catalog-selected Legacy
    // warehouse. A focused invocation must supply its OWN explicit fixture;
    // do not make eligibility depend on a skipped earlier test group's effects.
    await sql(`INSERT INTO public.inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity)
      VALUES(${q(legacySource.warehouseId)},${q(product)},1000,0)
      ON CONFLICT(warehouse_id,product_id) DO NOTHING;`);
  }
  const legacyOpen=await json(`SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb)
    FROM public.cash_shifts WHERE branch_id=${q(legacySource.branchId)} AND status='open';`);
  for(const id of legacyOpen) {
    const summary=await json(`${claims} SELECT public.get_cash_shift_summary(${q(id)});`);
    assert.equal((await json(`${claims} SELECT public.close_cash_shift(${q(id)},${summary.expectedCashInMinorUnits},NULL);`)).success,true); checks+=1;
  }
  assert.equal(await json(`SELECT to_jsonb(count(*)) FROM public.cash_shifts
    WHERE branch_id=${q(legacySource.branchId)} AND status='open';`),0); checks+=1;
  const createLegacyReady=async (lines=[{product_id:product,quantity:1}]) => {
    // Fixture family price/package inherited by103;023 converts one Legacy
    // sale package to five stock units. Expectations precede the evidence.
    assert.deepEqual(await json(`SELECT jsonb_build_object('units',units_per_sale_unit,
      'price',default_sale_price_in_minor_units) FROM public.products WHERE id=${q(product)};`),
    {units:5,price:5000}); checks+=1;
    await sql(`UPDATE public.storefront_settings SET orders_enabled=true,minimum_order_in_minor_units=0,
      inside_ramtha_delivery_fee_in_minor_units=0;`);
    const created=await json(`SELECT set_config('request.jwt.claim.role','service_role',false);
      SELECT public.submit_guest_customer_order(${q(randomUUID())},'Slice5 real Legacy Website',
      ${q(`078${String(Math.floor(Math.random()*1e7)).padStart(7,'0')}`)},'إربد','الرمثا','الحي الشرقي','شارع الاختبار',
      NULL,NULL,NULL,NULL,NULL,NULL,${j(lines)},NULL,'cash_on_delivery','inside_ramtha');`);
    await json(`${claims} SELECT public.accept_order_for_preparation(${q(created.order_id)},'Slice5 Legacy acceptance');`);
    await json(`${claims} SELECT public.update_order_status(${q(created.order_id)},'ready','Slice5 Legacy ready');`);
    assert.deepEqual(await json(`SELECT jsonb_build_object('branchId',branch_id,'warehouseId',warehouse_id)
      FROM public.orders WHERE id=${q(created.order_id)};`),legacySource); checks+=1;
    return created.order_id;
  };
  const legacyOrder=await createLegacyReady();
  const legacyArgs=`${q(legacyOrder)},'debt',0,NULL,NULL,NULL`;
  const legacyDiscovery=`phase5_private.discover_legacy_completion_plan_v1(${legacyArgs})`;
  const legacyBefore=await fingerprint();
  const legacyDebt=await json(`${claims} SELECT ${legacyDiscovery};`);
  assert.equal(legacyDebt.planState,'LEGACY_COMMERCIAL_DISCOVERY_ONLY');
  assert.equal(legacyDebt.executionAuthority,false); assert.equal(legacyDebt.locksHeld,false);
  assert.equal(legacyDebt.sourceOrder.operation_id,null); assert.equal(legacyDebt.sourceItems[0].commercial_line_kind,null);
  assert.deepEqual(legacyDebt.sourceDemand,[{itemId:legacyDebt.sourceItems[0].id,productId:product,quantity:5}]);
  assert.deepEqual(legacyDebt.settlement,{totalInMinorUnits:5000,collectedInMinorUnits:0,remainingInMinorUnits:5000,
    collectionMethod:'debt',receiptRequired:false});
  assert.equal(legacyDebt.selectedShift,null); assert.equal(legacyDebt.originalMethodRequiresShift,false); checks+=9;
  assert.equal(await json(`${claims} SELECT to_jsonb(phase5_private.assert_legacy_completion_plan_unchanged_v1(
    ${legacyArgs},${j(legacyDebt)}));`),true); checks+=1;
  for(const method of ['cash','cliq','cash_on_delivery',' debt ']) {
    await fails(`${claims} SELECT phase5_private.discover_legacy_completion_plan_v1(
      ${q(legacyOrder)},${q(method)},0,NULL,NULL,NULL);`,/23514.*PHASE4_OPEN_SHIFT_REQUIRED/u);
  }
  const debtUpper=await json(`${claims} SELECT phase5_private.discover_legacy_completion_plan_v1(
    ${q(legacyOrder)},'DEBT',0,NULL,NULL,NULL);`);
  assert.equal(debtUpper.originalMethodRequiresShift,false); checks+=1;
  //060 explicit debt ignores the supplied collection amount, not a new policy.
  assert.equal((await json(`${claims} SELECT phase5_private.discover_legacy_completion_plan_v1(
    ${q(legacyOrder)},'debt',-1,NULL,NULL,NULL);`)).settlement.collectedInMinorUnits,0); checks+=1;
  for(const args of [`${q(legacyOrder)},NULL,0,NULL,NULL,NULL`,`${q(legacyOrder)},'card',0,NULL,NULL,NULL`,
    `${q(legacyOrder)},'debt',0,-1,NULL,NULL`,`${q(legacyOrder)},'debt',0,NULL,repeat('r',121),NULL`]) {
    await fails(`${claims} SELECT phase5_private.discover_legacy_completion_plan_v1(${args});`,/22023.*LEGACY_REQUEST_INVALID/u);
  }
  await fails(`${claims} SELECT phase5_private.discover_legacy_completion_plan_v1(
    ${q(sale.orderId)},'debt',0,NULL,NULL,NULL);`,/23514.*LEGACY_SOURCE_INVALID/u);
  if(legacyModernOrder) await fails(`${claims} SELECT phase5_private.discover_legacy_completion_plan_v1(
    ${q(legacyModernOrder)},'debt',0,NULL,NULL,NULL);`,/23514.*LEGACY_SOURCE_INVALID/u);
  await fails(`SELECT set_config('request.jwt.claims','{}',false); SELECT ${legacyDiscovery};`,/42501.*LEGACY_ACTOR_UNAUTHORIZED/u);
  await fails(`${claims} UPDATE public.order_items SET unit_cost_snapshot_in_minor_units_exact=1
    WHERE order_id=${q(legacyOrder)}; SELECT ${legacyDiscovery};`,/23514.*LEGACY_MODERN_EVIDENCE_CONTRADICTION/u);
  await fails(`${claims} UPDATE public.orders SET customer_notes='Concurrent Legacy change' WHERE id=${q(legacyOrder)};
    SELECT phase5_private.assert_legacy_completion_plan_unchanged_v1(${legacyArgs},${j(legacyDebt)});`,/40001.*LEGACY_DISCOVERY_CHANGED_RETRY/u);
  await fails(`${claims} SELECT phase5_private.assert_legacy_completion_plan_unchanged_v1(
    ${legacyArgs},${j({...legacyDebt,executionAuthority:true})});`,/40001.*LEGACY_DISCOVERY_CHANGED_RETRY/u);
  for(const role of ['accountant','warehouse','delivery']) {
    await fails(`${claims} INSERT INTO public.roles(code,name_ar) VALUES(${q(role)},'Slice5 forbidden Legacy role') ON CONFLICT(code) DO NOTHING;
      DELETE FROM public.user_roles WHERE user_id=${q(owner)};
      INSERT INTO public.user_roles(user_id,role_id) SELECT ${q(owner)},id FROM public.roles WHERE code=${q(role)};
      SELECT ${legacyDiscovery};`,/42501.*LEGACY_ACTOR_UNAUTHORIZED/u);
  }
  assert.equal(await fingerprint(),legacyBefore,'legacy-admission-rejections-zero-write'); checks+=1;
  assert.equal(await json(`BEGIN; ${claims} SELECT ${legacyDiscovery};
    SELECT to_jsonb(count(*)) FROM pg_locks WHERE pid=pg_backend_pid() AND
    (locktype IN ('advisory','tuple') OR locktype='relation' AND mode<>'AccessShareLock'); ROLLBACK;`),0); checks+=1;
  assert.equal((await json(`${legacyOtherClaims} SELECT ${legacyDiscovery};`)).actorId,'92400000-0000-0000-0000-000000000002'); checks+=1;
  for(const role of ['anon','authenticated','service_role']) {
    await fails(`${claims} SET LOCAL ROLE ${role}; SELECT ${legacyDiscovery};`,/permission denied/u);
    await fails(`${claims} SET LOCAL ROLE ${role}; SELECT phase5_private.assert_legacy_completion_plan_unchanged_v1(
      ${legacyArgs},${j(legacyDebt)});`,/permission denied/u);
  }
  const legacyOpened=await json(`${claims} SELECT public.open_cash_shift(${q(legacySource.branchId)},0);`);
  assert.equal(legacyOpened.success,true); checks+=1;
  await legacyAcquisition(claims,legacyArgs,migrationHash);
  await legacyContext(claims,`${q(legacyOrder)},'cash',300,NULL,NULL,NULL`,migrationHash);
  // Guest087 explicitly forbids duplicate products. The actual authenticated
  // historical023 staff entrypoint retains separate repeated-SKU lines. Equal
  // quantities avoid023's product-wide unequal-line snapshot ambiguity; do not
  // invent a guest capability or repair historical pricing here.
  const createLegacyRepeatedReady=async () => {
    const repeatedSkuResult=await json(`BEGIN; ${claims} SET LOCAL ROLE authenticated;
    SELECT public.create_customer_order(p_customer_full_name=>'Slice5 repeated historical items',
      p_customer_phone=>${q(`078${String(Math.floor(Math.random()*1e7)).padStart(7,'0')}`)},
      p_governorate=>'إربد',p_city=>'الرمثا',p_area=>'الحي الشرقي',p_street=>'شارع الاختبار',
      p_branch_id=>${q(legacySource.branchId)},p_warehouse_id=>${q(legacySource.warehouseId)},
      p_items=>${j([{product_id:product,quantity:1},{product_id:product,quantity:1}])},p_source=>'website'); COMMIT;`);
    assert.equal(repeatedSkuResult.success,true); checks+=1;
    const repeatedSkuOrder=repeatedSkuResult.order_id;
    await json(`${claims} SELECT public.accept_order_for_preparation(${q(repeatedSkuOrder)},'Slice5 repeated items');`);
    await json(`${claims} SELECT public.update_order_status(${q(repeatedSkuOrder)},'ready','Slice5 repeated ready');`);
    return repeatedSkuOrder;
  };
  const repeatedSkuOrder=await createLegacyRepeatedReady();
  await legacyExecutor(claims,`${q(repeatedSkuOrder)},'cash',300,NULL,NULL,NULL`,
    legacyInstrumentation(claims,migrationHash),[5,5]); // legacy-executor-repeated-SKU
  for(const method of ['cash','cliq','cash_on_delivery',' debt ']) {
    const planWithShift=await json(`${claims} SELECT phase5_private.discover_legacy_completion_plan_v1(
      ${q(legacyOrder)},${q(method)},0,NULL,NULL,NULL);`);
    assert.equal(planWithShift.originalMethodRequiresShift,true);
    assert.equal(planWithShift.settlement.collectionMethod,'debt'); assert.equal(planWithShift.settlement.receiptRequired,false);
    assert.ok(planWithShift.selectedShift.id); checks+=4;
  }
  for(const [method,amount,reference] of [['cash',300,null],['cliq',300,'S5-LEGACY-CLIQ'],['cash',null,null],['debt',0,null]]) {
    const id=await createLegacyReady();
    const args=`${q(id)},${q(method)},${amount??'NULL'},NULL,${reference?q(reference):'NULL'},NULL`;
    const before=await fingerprint();
    const discovered=await json(`${claims} SELECT phase5_private.discover_legacy_completion_plan_v1(${args});`);
    assert.equal(await fingerprint(),before,'legacy-commercial-discovery-zero-write'); checks+=1;
    const complete=await json(`${claims} SELECT public.complete_website_order_with_settlement(${args});`);
    assert.equal(complete.success,true); assert.equal(complete.amount_paid_in_minor_units,discovered.settlement.collectedInMinorUnits);
    assert.equal(complete.remaining_in_minor_units,discovered.settlement.remainingInMinorUnits);
    assert.equal(complete.total_in_minor_units,5000); checks+=4;
    const legacyEffects=await json(`SELECT jsonb_build_object('paid',o.amount_paid_in_minor_units,
      'receipts',(SELECT count(*) FROM public.customer_payments WHERE order_id=o.id),
      'deductions',(SELECT count(*) FROM public.inventory_movements WHERE reference_type='order' AND reference_id=o.id AND movement_type='sales_deduction'),
      'deductionTuples',(SELECT jsonb_agg(jsonb_build_object('productId',product_id,'warehouseId',warehouse_id,
        'quantity',quantity) ORDER BY id) FROM public.inventory_movements
        WHERE reference_type='order' AND reference_id=o.id AND movement_type='sales_deduction'),
      'completedHistory',(SELECT count(*) FROM public.order_status_history WHERE order_id=o.id AND new_status='completed'),
      'modernCollections',(SELECT count(*) FROM phase5_private.collection_events WHERE order_id=o.id),
      'operationId',o.operation_id,'costFinalizedAt',o.cost_finalized_at)
      FROM public.orders o WHERE o.id=${q(id)};`);
    assert.deepEqual(legacyEffects,{paid:discovered.settlement.collectedInMinorUnits,
      receipts:discovered.settlement.receiptRequired?1:0,deductions:1,completedHistory:1,
      deductionTuples:[{productId:product,warehouseId:legacySource.warehouseId,quantity:-5}],
      modernCollections:0,operationId:null,costFinalizedAt:null}); checks+=1;
    const completedBefore=await fingerprint();
    await fails(`${claims} SELECT phase5_private.discover_legacy_completion_plan_v1(${args});`,/23514.*LEGACY_SOURCE_INVALID/u);
    assert.equal(await fingerprint(),completedBefore); checks+=1;
  }
  passed.push('Legacy admission/commercial discovery ONLY: actual Website V1 submission/acceptance/ready; NULL historical item identity, actor-first narrow060 role policy, original120 zero/debt Shift predicate, no modern helper/permit/locks, full-row drift rejection and app-role denial; real unchanged partial Cash/CliQ/full/debt public compatibility controls with exact receipt/inventory/history counts and no modern adoption');
  await legacyCommittedRuntime(claims,migrationHash,createLegacyReady,createLegacyRepeatedReady,legacySource.branchId);
  }
  await shiftInstructionRuntime(claims);
  await inventorySideEffectPlanRuntime(claims);
  await completionSideEffectAdaptersRuntime(claims);
  await inventoryAuthorityRuntime(claims);
  }
  const lint = await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',workdir],
    {cwd:root,windowsHide:true,maxBuffer:4*1024*1024});
  try { assertPhase5DbLint(lint.stdout); }
  catch (error) { throw new Error(`Strict preparation DB lint failed: ${lint.stdout}`,{cause:error}); }
  passed.push('strict full-schema DB lint with only approved historical compatibility warning');
  assert.deepEqual(await readFile(migrationPath),migrationBytes,'candidate must remain byte-identical during its runtime proof');
console.log(JSON.stringify({ok:true,checks,passed,mode:productAncillaryIdentitiesFocused?'FOCUSED_PRODUCT_ANCILLARY_IDENTITIES':receivingFutureIdentitiesFocused?'FOCUSED_RECEIVING_FUTURE_IDENTITIES':productCreationPrewriteFocused?'FOCUSED_PRODUCT_CREATION_PREWRITE':receivingPrewriteFocused?'FOCUSED_RECEIVING_PREWRITE':writerAdmissionFocused?'FOCUSED_WRITER_ADMISSION_SOURCE_PATHS':readMarkResourcesOnlyFocused?'FOCUSED_READ_MARK_RESOURCES_ONLY':readMarkResourcesFocused?'FOCUSED_READ_MARK_RESOURCES':parentSourceFocused?'FOCUSED_PARENT_SOURCE':stockWriterSourceFocused?'FOCUSED_STOCK_WRITER_SOURCE':transportSourceFocused?'FOCUSED_TRANSPORT_SOURCE':completionLockUnionFocused?'FOCUSED_COMPLETION_LOCK_UNION':completionProgressFocused?'FOCUSED_COMPLETION_PROGRESS':completionTriggerRowsFocused?'FOCUSED_COMPLETION_TRIGGER_ROWS':completionRowsFocused?'FOCUSED_COMPLETION_BUSINESS_ROW_SAMPLES':completionIdentityFocused?'FOCUSED_COMPLETION_CONTROL_IDENTITIES':inventoryIdentityFocused?'FOCUSED_INVENTORY_IDENTITY_MANIFEST':inventoryAuthorityFocused?'FOCUSED_INVENTORY_AUTHORITY':inventorySideEffectPlanFocused?'FOCUSED_INVENTORY_SIDE_EFFECT_PLAN':shiftTriggerIdentityFocused?'FOCUSED_SHIFT_TRIGGER_IDENTITY_SOURCE_REVIEW':shiftPaymentFocused?'FOCUSED_SHIFT_PAYMENT_DISCOVERY_ONLY':legacyFocused?'FOCUSED_LEGACY_ONLY':'FULL_PREPARATION',
    ...(receiptV2AllocationFocused?{mode:'FOCUSED_RECEIPT_V2_ALLOCATION'}:{}),
    ...(receiptV2TriggerEffectsFocused?{mode:sourceTypedValuesFocused?'FOCUSED_SOURCE_TYPED_VALUES':receiptV2ResourceUnionFocused?'FOCUSED_RECEIPT_V2_COMPLETE_RESOURCE_UNION':'FOCUSED_RECEIPT_V2_TRANSITIVE_TRIGGER_EFFECTS'}:{}),
    ...(receiptV2PrewriteFocused?{mode:'FOCUSED_RECEIPT_V2_PREWRITE_DISCOVERY'}:{}),
    ...(receiptV2InstalledValuesFocused?{mode:'FOCUSED_RECEIPT_V2_INSTALLED_VALUE_REQUIREMENTS'}:{}),
    ...(receiptV2LiteralValuesFocused?{mode:'FOCUSED_RECEIPT_V2_LITERAL_POSTGRES_EQUIVALENCE'}:{}),
    ...(receiptV2RowRequirementsFocused?{mode:'FOCUSED_RECEIPT_V2_COMPLETE_ROW_REQUIREMENTS'}:{}),
    ...(receiptV2ItemBindingsFocused?{mode:'FOCUSED_RECEIPT_V2_ITEM_PROJECTION_BINDINGS'}:{}),
    ...(receiptV2PrimaryBindingsFocused?{mode:'FOCUSED_RECEIPT_V2_PRIMARY_PROJECTION_BINDINGS'}:{}),
    ...(receiptV2EventsUpdatesFocused?{mode:'FOCUSED_RECEIPT_V2_EVENTS_UPDATE_BINDINGS'}:{}),
    readMarkResourcesFocused,
    parentExecuteFocused,
    parentSourceFocused,
    transportSourceFocused,
    stockWriterSourceFocused,
    remaining:sourceTypedValuesFocused
      ? 'Known source scalar/registered-row type and generated-input arithmetic proof ONLY. Missing/default/event/number/sequence/trigger/FK/product-root tuple requirements remain explicit. No defaults executed, durable claims, all-writer convergence, held context, DML consumer or execution/public activation authority. A1 not rerun; whole A2 and A3-A5 remain OPEN.'
      :receiptV2EventsUpdatesFocused
      ? 'Primary INSERT/UPDATE source bindings and observed actual public event semantics only. No materialized future event tuple, default/trigger/transitive identity ownership, number/UUID claims, invoker/absence convergence, held locks/context or execution authority. Package A/B-E OPEN; generation0/four barriers preserved.'
      :receiptV2InstalledValuesFocused
      ? 'Installed primary columns/default/generated requirements classified per pinned INSERT occurrence ONLY. No actual value allocation, full tuple/trigger/default ownership, UUID or number claims, invoker/absence convergence, locks, held context or execution proof. Existing wider receipt matrix remains separately required; generation0/four barriers and Package A/B-E OPEN.'
      :receiptV2TriggerEffectsFocused
      ? 'Observed retained public Receipt V2 stock/payment/default effects and source-derived branch identities only. Source-owner omissions are not inferred Production ownership. New default UUIDs/number/key/read/outbox ownership, complete typed tuples, all-writer/invoker/absence convergence, held context and execution remain OPEN. Package A/B-E OPEN; no public activation.'
      :receiptV2PrewriteFocused
      ? 'Receipt V2 source-qualified discovery, exact primary identity requirements and UUID candidate allocation/validation ONLY. Current row/default/sequence/stock catalog captured, not full generated/default/stock/payment ownership or invoker/absence qualification. No number allocation, locks, durable claims, trusted context, replay adoption or execution; generation0/four barriers unchanged. Package A/B-E OPEN.'
      :receiptV2AllocationFocused
      ? 'Shared source-qualified modern113 commercial allocation discovery/revalidation ONLY. Header/key/PO capacity/feature/tender eligibility, generated/default/sequence/stock/payment resource domains, locks/claims/invoker/absence convergence, held contexts and execution remain OPEN. No public business path changed; generation0/four barriers preserved.'
      :productAncillaryIdentitiesFocused
      ? 'Exact per-product source-bound balance/image/audit identity and explicit column projections ONLY; actual server allocation, zero DML. No full-row/default/stock-effect closure, claims, held context/locks, execution or activation. Receipt V2 and all participating writer/invoker convergence remain OPEN; generation0/four barriers unchanged.'
      :receivingFutureIdentitiesFocused
      ? 'Ordered104 legacy receipt source identity projections and actual server allocation ONLY. No durable UUID/number claims, number namespace or absent balance fencing, held context, full write/default/stock-effect ownership, execution or activation. Modern receipt V2 and the other participating writers remain separately required. Ordinary writers are not financial Order contexts. Generation0/four barriers unchanged; Package A/B-E OPEN.'
      :productCreationPrewriteFocused
      ? 'Whole-family product IDs/key/resource union are server allocated and transiently acquired ONLY. No durable claim, complete default/image/balance/audit executor, absence fence, all-writer invoker closure, held context or execution authority. Current public writers remain unchanged generation0. Remaining Package A and B-E OPEN; no complete concurrency/activation/closure proof.'
      :receivingPrewriteFocused
      ? 'Private receiving source discovery/exact revalidation and transient inventory-first row acquisition only. Defaults/number/future identity claims and all-writer absence fencing remain unqualified; no executor/held context authority or public change. Future whole-family product identities, other participating writers and Packages B-E remain OPEN. No operational activation/closure claim.'
      :writerAdmissionFocused
      ? 'Actual unchanged historical authenticated family/receiving first-write and per-source held-gate observations ONLY. Family default UUIDs still have no early product gate; receiving original PO SKU gates exist before header. All runtime business/schema instrumentation rolls back. No future Phase5 first-write/held-context/absence-fence/invoker/admission authority or complete writer closure is inferred. Complete future identity/resource/invoker convergence and actual consumer remain OPEN.'
      :readMarkResourcesOnlyFocused || readMarkResourcesFocused
      ? 'Private read-mark exact resource discovery/revalidation ONLY. SINGLE resolved and ALL_ACTIVE empty semantics retained. No held locks, absence fence, source-write permit or execution authority. Full fixed95 first-write/early-gate/invoker/default/generated-product/receiving/SD writer convergence and context/progress/consumer/activation remain OPEN. The full parent/source regression mode remains separately available; no whole-Slice closure.'
      :parentExecuteFocused
      ? 'Fixed95 historical direct ACL and effective app EXECUTE qualification ONLY. Actor guard candidates do not prove complete branch admission. Full first-business-write/early-gate/allowed-invoker/default/dynamic/SD writer convergence, absence fences, held context, claims/progress/consumer and activation remain OPEN. Current public authority unchanged; generation0/four barriers retained.'
      :parentSourceFocused
      ? 'Source-qualified95 parent/callable records and exact371 public identities ONLY. Complete branch-order/early-gate/default/dynamic/SD writer qualification, absence fences, held context, claims/progress/consumer and activation remain OPEN. Historical/public authority unchanged; generation0/four barriers retained.'
      :stockWriterSourceFocused
      ? 'Fixed seven-routine/three-trigger source envelope ONLY; observed ACL/default catalog is not a qualified writer target. Full parent writer/SECURITY DEFINER/default convergence, early gates, absence fences, trusted held context, claims/progress/consumer and activation remain OPEN. No public body/grant/trigger change; generation0/four barriers remain.'
      :transportSourceFocused
      ? 'Private transport/source snapshot and fixed reviewed RPC-body validation only. Delivery lease/retry/ack contents are not financial/inventory evidence. Complete writer/SD/held-context/absence fencing and execution authority remain OPEN; generation0/four barriers unchanged.'
      :completionLockUnionFocused
      ? 'Generation0 transient source-qualified resource acquisition ONLY. Complete held-context/execution authority, absence-predicate fencing, durable claims and all-writer/SD/transport convergence remain OPEN. No business mutation, activation or whole-Slice5 closure is claimed.'
      :completionTriggerRowsFocused
      ? 'Full stock-trigger/completion ROW SAMPLES and indivisible execution-group/full-prefix preparation only. Exact per-identity states include context INSERT absence and composite read deletion; source binding is freshly rederived. Actual identity consumption, durable claims, progress, held execution and transport/SD/writer convergence remain OPEN. No activation authority; generation0/four barriers preserved.'
      :completionRowsFocused
      ? 'Hypothetical business-row samples and sequence catalog ONLY; no authoritative clock/sequence allocation, stored context, held locks, durable claims or execution authority. Complete stock-trigger semantics, transport/SD/writer convergence and activation remain OPEN. Generation0/four barriers preserved.'
      :completionIdentityFocused
      ? 'Source-bound control identity and direct FK projections only. Symbolic post-lock transaction/event/payment-number/outcome/sequence slots are not complete writable rows or success evidence. Legacy never gains a modern operation or envelope. Full semantic consumption, writer/trigger/transport/SD closure, actual claim/held context/consumer/progress/concurrency and public activation remain OPEN. Generation0/four barriers preserved.'
      :inventoryIdentityFocused
      ? 'Exact per-source UUID/key/read identity manifest preparation only. Generic manifests stay unbound; source adapters independently rederive POS/Customer/Legacy. No durable ownership claim, held lock/context, consumer/progress, activation or whole-writer closure. Remaining parent future identities, participating writer/transport authority and concurrency proof are mandatory before operational admission. Generation0/four barriers and current public paths remain unchanged.'
      :inventoryAuthorityFocused
      ? 'Private catalog snapshot/direct-authority qualification and rollback-only target simulation only. Public authority is unchanged; known residual rights still block activation. Complete SD/writer/early-gate/default-creation/context/consumer/activation atomicity/concurrency closure remains OPEN. No generation/context/execution permit or operational closure is claimed.'
      :inventorySideEffectPlanFocused
      ? 'Private ordered model and fresh source-bound POS/Customer/Legacy adapters only. Identities are server allocated, NOT durable claims or actual INSERT consumption. Generic kernel is hypothetical/unbound; complete other source adapters, full source closure and consumer/progress/held authority remain pending. Legacy source operation is explicitly absent, never fabricated; Customer source operation is its immutable creation, not a new completion grant. Public triggers/defaults/ACL and generation0/barriers are unchanged. Actual consumption and writer/transport authority convergence require separately approved activation rehearsal. No operational settlement, all-writer concurrency or closure PASS claimed.'
      :shiftTriggerIdentityFocused
      ? 'Source review only. Existing trigger-generated future UUID ownership is not closed by a readonly plan. The reviewed unchanged-source/exact-preallocation contract needs a bounded technical decision before any new acquisition/execution or trigger/body change. No financial policy, historical migration, private generation, public behavior or Production change is authorized by this evidence.'
      :shiftPaymentFocused
      ? 'This focused run proves private Shift source/capacity union, batch/child/key identity, per-item POS/planned-insert FK coverage and explicit rootless typed-context schema/planning with real composite parent FK enforcement. The approved inventory-alert overlay proves active/absent domains, composite read identities, existing outbox conflicts, exact catalog/function/trigger/FK/index/sequence assertions and fresh content rederivation, including unchanged public full-Shift trigger behavior. It does NOT allocate/claim future alert/outbox identities or keys, acquire composite resources, prove full transitive source-update/trigger/FK closure, actual transaction-owned/held-plan authority, eligibility, prelocked reversal/deferred completion/replay or batch concurrency. TYPED_CONTEXT_IDENTITIES_AND_DIRECT_FKS_ONLY / PLANNED_CONTEXT_NOT_LOCKED remain preparation only. Symbolic post-lock event/transaction slots are not timestamps/txids or writable rows. Generation0/barriers remain; finish source-write and future-ownership closure before locking, then actual held-plan/context permission and execution/recovery/all-writer/final gates. Privileged context/catalog shape fixtures roll back and confer no execution authority; sequence gaps are not business partial writes.'
      : 'Private Customer/Legacy preparation evidence is mode-scoped. Shift sources/batch identities and planned-insert FK/per-item POS inventory identities are verified, not transitive source-write/trigger/context completeness, durable claims, held-lock or execution authority. Generation0/barriers remain; remaining caller/full-Shift/CliQ/recovery domains, all-writer races, whole-candidate gates and public activation remain unproved.'},null,2));
} finally {
  if (workdir) {
    await exec(process.execPath,[cli,'stop', '--no-backup','--workdir',workdir],
      {cwd:root,windowsHide:true,timeout:120000,maxBuffer:4*1024*1024});
    const inventory = await exec('docker',['ps','--format','{{.Names}}'],{windowsHide:true});
    assert.equal(inventory.stdout.split(/\r?\n/u).some((name) => name.includes(projectId)),false);
  }
}
