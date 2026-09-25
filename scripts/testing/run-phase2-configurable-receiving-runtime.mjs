import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const bootstrapPath = path.join(scriptDirectory, 'bootstrap-isolated-supabase.mjs');
const runtimeSqlPath = path.join(scriptDirectory, 'phase2-configurable-receiving-runtime.sql');
const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const projectId = process.env.NAWASRAH_PHASE2_RECEIVING_PROJECT_ID ||
  'nawasrah-phase2-receiving-test';
const databaseContainer = `supabase_db_${projectId}`;
const OWNER = '92300000-0000-0000-0000-000000000001';
const WAREHOUSE_KEEPER = '92300000-0000-0000-0000-000000000002';
const BRANCH = '92300000-0000-0000-0000-000000000200';
const WAREHOUSE_A = '92300000-0000-0000-0000-000000000201';
const WAREHOUSE_B = '92300000-0000-0000-0000-000000000202';
const SUPPLIER_A = '92300000-0000-0000-0000-000000000301';
const SUPPLIER_B = '92300000-0000-0000-0000-000000000302';
const FAMILY = '92300000-0000-0000-0000-000000000100';
const SKU_A = '92300000-0000-0000-0000-000000000101';
const SKU_B = '92300000-0000-0000-0000-000000000102';
const SKU_C = '92300000-0000-0000-0000-000000000103';
const OTHER = '92300000-0000-0000-0000-000000000104';
const CONFIG = '92300000-0000-0000-0000-000000000401';
let isolatedProjectRoot = '';

assert.match(databaseContainer, /^supabase_db_nawasrah-[a-z0-9-]+-test$/u);

const runSql = (sql) => new Promise((resolve, reject) => {
  const child = spawn(
    'docker',
    [
      'exec', '-i', databaseContainer,
      'psql', '-U', 'postgres', '-d', 'postgres',
      '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
      '-v', 'VERBOSITY=verbose',
    ],
    { cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  let completed = false;
  const timeout = setTimeout(() => {
    if (completed) return;
    completed = true;
    child.kill('SIGKILL');
    reject(new Error('Phase 2 receiving SQL process exceeded 60 seconds.'));
  }, 60_000);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', (error) => {
    if (completed) return;
    completed = true;
    clearTimeout(timeout);
    reject(error);
  });
  child.on('close', (code) => {
    if (completed) return;
    completed = true;
    clearTimeout(timeout);
    if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    else reject(new Error(`Phase 2 receiving SQL failed: ${stderr}\n${stdout}`));
  });
  child.stdin.end(`SET statement_timeout = '45s'; SET lock_timeout = '35s';\n${sql}`);
});

const readJson = async (sql) => {
  const { stdout } = await runSql(sql);
  const value = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1);
  assert.ok(value, 'Expected JSON SQL output.');
  return JSON.parse(value);
};

const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
const jsonSql = (value) => `${sqlLiteral(JSON.stringify(value))}::JSONB`;
let coordinatedPairCount = 0;
const waitForDatabaseWait = async (label, blockerLabel) => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const state = await readJson(`SELECT jsonb_build_object('waiting', EXISTS (
      SELECT 1 FROM pg_stat_activity waiter
      JOIN pg_stat_activity blocker ON blocker.pid = ANY(pg_blocking_pids(waiter.pid))
      WHERE waiter.application_name = ${sqlLiteral(label)}
        AND blocker.application_name = ${sqlLiteral(blockerLabel)}
        AND waiter.wait_event_type = 'Lock'
    ));`);
    if (state.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`No observed database lock wait: ${label} blocked by ${blockerLabel}`);
};

// The first real workflow finishes but holds its transaction at a gate. The
// second workflow must demonstrably wait on that transaction, not merely start
// at roughly the same time. Both then commit on independent connections.
const runCoordinatedPair = async (firstSql, secondSql, { settled = false } = {}) => {
  const sequence = ++coordinatedPairCount;
  const gateLabel = `phase2-gate-${sequence}`;
  const firstLabel = `phase2-first-${sequence}`;
  const secondLabel = `phase2-second-${sequence}`;
  const gateKey = 923_113_000 + sequence;
  const gate = spawn('docker', ['exec', '-i', databaseContainer,
    'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A',
    '-v', 'ON_ERROR_STOP=1'],
  { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let gateOutput = '';
  gate.stdout.on('data', (chunk) => { gateOutput += chunk; });
  const gateClosed = new Promise((resolve, reject) => {
    gate.on('error', reject);
    gate.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Gate exited ${code}`)));
  });
  gate.stdin.write(`SET application_name = '${gateLabel}'; BEGIN;
    SELECT pg_advisory_xact_lock(${gateKey}); SELECT 'GATE_READY';\n`);
  const deadline = Date.now() + 20_000;
  while (!gateOutput.includes('GATE_READY') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(gateOutput.includes('GATE_READY'), 'Gate connection did not become ready');
  let first;
  let second;
  let firstError;
  let secondError;
  try {
    assert.match(firstSql, /COMMIT;\s*$/u);
    first = readJson(`SET application_name = '${firstLabel}'; ${firstSql.replace(
      /COMMIT;\s*$/u,
      () => `RESET ROLE; DO $$ BEGIN PERFORM pg_advisory_xact_lock(${gateKey}); END $$; COMMIT;`,
    )}`);
    first.catch((error) => { firstError = error; });
    try {
      await waitForDatabaseWait(firstLabel, gateLabel);
    } catch (error) {
      throw firstError ?? error;
    }
    second = readJson(`SET application_name = '${secondLabel}'; ${secondSql}`);
    second.catch((error) => { secondError = error; });
    try {
      await waitForDatabaseWait(secondLabel, firstLabel);
    } catch (error) {
      throw secondError ?? error;
    }
  } finally {
    gate.stdin.end('COMMIT;\n\\q\n');
    await gateClosed;
  }
  const results = settled
    ? await Promise.allSettled([first, second])
    : await Promise.all([first, second]);
  await verifyInventoryHistory();
  return results;
};

const targetedState = (key, productIds) => readJson(`
  SELECT jsonb_build_object(
    'operations', (SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.id), '[]') FROM public.business_operations o WHERE o.idempotency_key = ${sqlLiteral(key)}),
    'receipts', (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]') FROM public.supplier_receipts r
      WHERE r.operation_id IN (SELECT id FROM public.business_operations WHERE idempotency_key = ${sqlLiteral(key)})
        OR r.idempotency_key::TEXT = ${sqlLiteral(key)}),
    'purchaseOrders', (SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.id), '[]') FROM public.purchase_orders p WHERE p.id IN (SELECT purchase_order_id FROM public.purchase_order_items WHERE product_id = ANY(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(${jsonSql(productIds)}))))),
    'purchaseReceipts', (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]') FROM public.purchase_receipts r WHERE r.purchase_order_id IN (SELECT purchase_order_id FROM public.purchase_order_items WHERE product_id = ANY(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(${jsonSql(productIds)}))))),
    'purchaseReceiptItems', (SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.id), '[]') FROM public.purchase_receipt_items i WHERE i.product_id = ANY(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(${jsonSql(productIds)})))),
    'purchaseOrderItems', (SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.id), '[]') FROM public.purchase_order_items i WHERE i.product_id = ANY(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(${jsonSql(productIds)})))),
    'payments', (SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.id), '[]') FROM public.supplier_payments p
      WHERE p.supplier_receipt_id IN (
        SELECT r.id FROM public.supplier_receipts r
        LEFT JOIN public.business_operations o ON o.id = r.operation_id
        WHERE o.idempotency_key = ${sqlLiteral(key)} OR r.idempotency_key::TEXT = ${sqlLiteral(key)}
      )),
    'movements', (SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.id), '[]') FROM public.inventory_movements m WHERE m.product_id IN (SELECT value::uuid FROM jsonb_array_elements_text(${jsonSql(productIds)}))),
    'products', (SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.id), '[]') FROM public.products p WHERE p.id IN (SELECT value::uuid FROM jsonb_array_elements_text(${jsonSql(productIds)}))),
    'balances', (SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.product_id,b.warehouse_id), '[]') FROM public.inventory_balances b WHERE b.product_id IN (SELECT value::uuid FROM jsonb_array_elements_text(${jsonSql(productIds)}))),
    'commercialLines', (SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.id), '[]') FROM public.supplier_receipt_commercial_lines l WHERE l.operation_id IN (SELECT id FROM public.business_operations WHERE idempotency_key = ${sqlLiteral(key)})),
    'components', (SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.id), '[]')
      FROM public.supplier_receipt_items i
      WHERE i.supplier_receipt_id IN (
        SELECT r.id FROM public.supplier_receipts r
        LEFT JOIN public.business_operations o ON o.id = r.operation_id
        WHERE o.idempotency_key = ${sqlLiteral(key)} OR r.idempotency_key::TEXT = ${sqlLiteral(key)}
      )),
    'wacSnapshots', (SELECT COALESCE(jsonb_agg(to_jsonb(w) ORDER BY w.product_id), '[]') FROM public.phase2_receipt_wac_snapshots w WHERE w.operation_id IN (SELECT id FROM public.business_operations WHERE idempotency_key = ${sqlLiteral(key)})),
    'invoiceIdentities', (SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.id), '[]') FROM public.supplier_financial_invoice_identities i WHERE i.operation_id IN (SELECT id FROM public.business_operations WHERE idempotency_key = ${sqlLiteral(key)})),
    'auditLogs', (SELECT COALESCE(jsonb_agg(to_jsonb(log) ORDER BY log.id), '[]')
      FROM public.audit_logs log
      WHERE log.entity_id IN (
        SELECT receipt.id FROM public.supplier_receipts receipt
        LEFT JOIN public.business_operations operation ON operation.id = receipt.operation_id
        WHERE operation.idempotency_key = ${sqlLiteral(key)}
          OR receipt.idempotency_key::TEXT = ${sqlLiteral(key)}
        UNION
        SELECT payment.id FROM public.supplier_payments payment
        WHERE payment.supplier_receipt_id IN (
          SELECT receipt.id FROM public.supplier_receipts receipt
          LEFT JOIN public.business_operations operation ON operation.id = receipt.operation_id
          WHERE operation.idempotency_key = ${sqlLiteral(key)}
            OR receipt.idempotency_key::TEXT = ${sqlLiteral(key)}
        )
      )),
    'shifts', (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.id), '[]') FROM public.cash_shifts s WHERE s.id = '92300000-0000-0000-0000-000000000500'),
    'suppliers', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.suppliers s WHERE s.id IN ('${SUPPLIER_A}', '${SUPPLIER_B}'))
  );
`);

const receiptSequenceState = () => readJson(`
  SELECT jsonb_build_object('lastValue', last_value, 'isCalled', is_called)
  FROM public.supplier_receipt_seq;
`);

const verifyInventoryHistory = async () => {
  const result = await readJson(`WITH chain AS (
    SELECT m.*, lag(balance_after, 1, 0) OVER (
      PARTITION BY product_id, warehouse_id ORDER BY mutation_sequence
    ) AS preceding_balance FROM public.inventory_movements m
    WHERE product_id::text LIKE '92300000-%'
  ) SELECT jsonb_build_object(
    'balanceMismatches', (SELECT COUNT(*) FROM public.inventory_balances b
      WHERE b.product_id::text LIKE '92300000-%' AND b.on_hand_quantity IS DISTINCT FROM
      (SELECT COALESCE(SUM(m.quantity),0) FROM public.inventory_movements m
        WHERE m.product_id=b.product_id AND m.warehouse_id=b.warehouse_id)),
    'movementSnapshotMismatches', (SELECT COUNT(*) FROM chain
      WHERE balance_before IS DISTINCT FROM preceding_balance OR balance_after <> balance_before + quantity),
    'wacFormulaMismatches', (SELECT COUNT(*) FROM public.phase2_receipt_wac_snapshots s
      WHERE resulting_exact_wac_in_minor_units <> ROUND(
        (opening_global_quantity::numeric * prior_exact_wac_in_minor_units + allocated_acquisition_cost_in_minor_units)
          / (opening_global_quantity::numeric + received_base_quantity), 6)
        OR resulting_legacy_wac_in_minor_units <> ROUND(resulting_exact_wac_in_minor_units)::bigint),
    'unfinishedOperations', (SELECT COUNT(*) FROM public.business_operations o
      WHERE o.initiated_by='${OWNER}' AND o.operation_type LIKE '%v2'
        AND (o.completed_at IS NULL OR o.result_snapshot IS NULL))
  );`);
  assert.deepEqual(result, { balanceMismatches: 0, movementSnapshotMismatches: 0,
    wacFormulaMismatches: 0, unfinishedOperations: 0 });
};
const userTransaction = (userId, sql) => `
  BEGIN;
  SELECT set_config(
    'request.jwt.claims',
    ${sqlLiteral(JSON.stringify({ sub: userId, role: 'authenticated', aal: 'aal1' }))},
    true
  );
  SET LOCAL ROLE authenticated;
  ${sql}
  COMMIT;
`;
const readUserJson = (userId, selectSql) => readJson(userTransaction(userId, selectSql));

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const assertSqlFailureIdentity = (
  message,
  { sqlState, constraint = null, applicationIdentity = null, exactMessage = null },
) => {
  assert.match(message, new RegExp(`ERROR:\\s+${escapeRegExp(sqlState)}:`, 'u'));
  if (constraint) {
    assert.match(
      message,
      new RegExp(`CONSTRAINT NAME:\\s+${escapeRegExp(constraint)}(?:\\r?\\n|$)`, 'u'),
    );
  }
  if (applicationIdentity) {
    assert.match(
      message,
      new RegExp(
        `ERROR:\\s+${escapeRegExp(sqlState)}:\\s+${escapeRegExp(applicationIdentity)}:`,
        'u',
      ),
    );
  }
  if (exactMessage) {
    assert.match(message, new RegExp(
      `ERROR:\\s+${escapeRegExp(sqlState)}:\\s+${escapeRegExp(exactMessage)}(?:\\r?\\n|$)`, 'u',
    ));
  }
  assert.ok(constraint || applicationIdentity || exactMessage, 'Strict error identity is required.');
};

const expectSqlFailure = async (sql, identity) => {
  try {
    await runSql(sql);
    assert.fail('Expected SQL transaction to fail.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assertSqlFailureIdentity(message, identity);
    return message;
  }
};

const baseLine = ({
  clientLineId,
  productId = OTHER,
  quantity = 3,
  gross = 301,
  discount = 0,
  explicitCost = null,
  purchaseOrderItemId = null,
}) => ({
  client_line_id: clientLineId,
  purchase_order_item_id: purchaseOrderItemId,
  line_kind: 'base_unit',
  family_product_id: null,
  parcel_configuration_id: null,
  configuration_revision: null,
  commercial_quantity: quantity,
  units_per_parcel: null,
  base_unit_name: 'باكيت',
  parcel_unit_name: null,
  gross_amount_in_minor_units: gross,
  line_discount_in_minor_units: discount,
  components: [{
    product_id: productId,
    base_quantity: quantity,
    explicit_merchandise_cost_in_minor_units: explicitCost,
  }],
});

const parcelLine = ({
  clientLineId,
  parcels = 2,
  quantities = [4, 3, 3],
  gross = 1000,
  discount = 100,
  explicitCosts = [null, null, null],
  purchaseOrderItemId = null,
}) => ({
  client_line_id: clientLineId,
  purchase_order_item_id: purchaseOrderItemId,
  line_kind: 'configurable_parcel',
  family_product_id: FAMILY,
  parcel_configuration_id: CONFIG,
  configuration_revision: 1,
  commercial_quantity: parcels,
  units_per_parcel: 5,
  base_unit_name: 'باكيت',
  parcel_unit_name: 'طرد',
  gross_amount_in_minor_units: gross,
  line_discount_in_minor_units: discount,
  components: [SKU_A, SKU_B, SKU_C].map((productId, index) => ({
    product_id: productId,
    base_quantity: quantities[index],
    explicit_merchandise_cost_in_minor_units: explicitCosts[index],
  })),
});

const directReceiptSql = ({
  userId = OWNER,
  supplierId = SUPPLIER_A,
  warehouseId = WAREHOUSE_A,
  invoice = null,
  headerDiscount = 0,
  freight = 0,
  tax = 0,
  paid = 0,
  paymentMethod = 'deferred',
  paymentReference = null,
  key,
  lines,
}) => userTransaction(userId, `
  SELECT public.create_direct_supplier_receipt_v2(
    p_supplier_id := '${supplierId}',
    p_warehouse_id := '${warehouseId}',
    p_branch_id := '${BRANCH}',
    p_supplier_invoice_number := ${invoice === null ? 'NULL' : sqlLiteral(invoice)},
    p_header_discount_in_minor_units := ${headerDiscount},
    p_supplier_freight_in_minor_units := ${freight},
    p_legacy_tax_in_minor_units := ${tax},
    p_amount_paid_at_receipt_in_minor_units := ${paid},
    p_payment_method := ${sqlLiteral(paymentMethod)},
    p_payment_reference := ${paymentReference === null ? 'NULL' : sqlLiteral(paymentReference)},
    p_idempotency_key := ${sqlLiteral(key)},
    p_lines := ${jsonSql(lines)}
  );
`);

const legacyDirectReceiptSql = ({
  userId = OWNER,
  supplierId = SUPPLIER_A,
  warehouseId = WAREHOUSE_A,
  branchId = BRANCH,
  invoice = null,
  invoiceDate = null,
  receivedAt = 'omitted',
  deliveryFee = 0,
  discount = 0,
  tax = 0,
  paid = 0,
  paymentMethod = 'deferred',
  paymentReference = null,
  notes = null,
  internalNotes = null,
  key,
  items,
}) => userTransaction(userId, `SELECT public.create_direct_supplier_receipt(
  p_supplier_id := '${supplierId}',
  p_warehouse_id := '${warehouseId}',
  p_branch_id := '${branchId}',
  p_supplier_invoice_number := ${invoice === null ? 'NULL' : sqlLiteral(invoice)},
  p_supplier_invoice_date := ${invoiceDate === null ? 'NULL' : `${sqlLiteral(invoiceDate)}::DATE`},
  ${receivedAt === 'omitted' ? '' : `p_received_at := ${receivedAt === null ? 'NULL' : `${sqlLiteral(receivedAt)}::TIMESTAMPTZ`},`}
  p_delivery_fee_in_minor_units := ${deliveryFee},
  p_discount_in_minor_units := ${discount},
  p_tax_in_minor_units := ${tax},
  p_amount_paid_in_minor_units := ${paid},
  p_payment_method := ${paymentMethod === null ? 'NULL' : sqlLiteral(paymentMethod)},
  p_payment_reference := ${paymentReference === null ? 'NULL' : sqlLiteral(paymentReference)},
  p_notes := ${notes === null ? 'NULL' : sqlLiteral(notes)},
  p_internal_notes := ${internalNotes === null ? 'NULL' : sqlLiteral(internalNotes)},
  p_idempotency_key := '${key}',
  p_items := ${jsonSql(items)}
);`);

const createPurchaseOrderSql = ({ key, lines }) => userTransaction(OWNER, `
  SELECT public.create_purchase_order_v2(
    p_supplier_id := '${SUPPLIER_A}',
    p_branch_id := '${BRANCH}',
    p_warehouse_id := '${WAREHOUSE_A}',
    p_idempotency_key := ${sqlLiteral(key)},
    p_lines := ${jsonSql(lines)}
  );
`);

const receivePurchaseOrderSql = ({
  purchaseOrderId,
  invoice,
  key,
  lines,
  paid = 0,
  method = 'deferred',
  reference = null,
  warehouseId = WAREHOUSE_A,
}) => userTransaction(OWNER, `
  SELECT public.receive_purchase_order_v2(
    p_purchase_order_id := '${purchaseOrderId}',
    p_warehouse_id := '${warehouseId}',
    p_supplier_invoice_number := ${invoice === null ? 'NULL' : sqlLiteral(invoice)},
    p_amount_paid_at_receipt_in_minor_units := ${paid},
    p_payment_method := ${sqlLiteral(method)},
    p_payment_reference := ${reference === null ? 'NULL' : sqlLiteral(reference)},
    p_idempotency_key := ${sqlLiteral(key)},
    p_lines := ${jsonSql(lines)}
  );
`);

const countBusinessState = (key) => readJson(`
  SELECT jsonb_build_object(
    'operations', (SELECT COUNT(*) FROM public.business_operations WHERE idempotency_key = ${sqlLiteral(key)}),
    'directReceipts', (SELECT COUNT(*) FROM public.supplier_receipts WHERE operation_id IN (
      SELECT id FROM public.business_operations WHERE idempotency_key = ${sqlLiteral(key)}
    )),
    'purchaseReceipts', (SELECT COUNT(*) FROM public.purchase_receipts WHERE operation_id IN (
      SELECT id FROM public.business_operations WHERE idempotency_key = ${sqlLiteral(key)}
    )),
    'movements', (SELECT COUNT(*) FROM public.inventory_movements WHERE operation_id IN (
      SELECT id FROM public.business_operations WHERE idempotency_key = ${sqlLiteral(key)}
    )),
    'payments', (SELECT COUNT(*) FROM public.supplier_payments WHERE operation_id IN (
      SELECT id FROM public.business_operations WHERE idempotency_key = ${sqlLiteral(key)}
    ))
  );
`);

// Independent decimal oracle: integer millionths with PostgreSQL's positive
// half-away-from-zero rounding at EACH acquisition boundary, never float math.
const expectedSequentialWac = (priorMillionths, openingQuantity, quantity, cost) => {
  const denominator = BigInt(openingQuantity + quantity);
  const numerator = priorMillionths * BigInt(openingQuantity) + BigInt(cost) * 1_000_000n;
  return (numerator * 2n + denominator) / (denominator * 2n);
};
const decimalWac = (millionths) =>
  `${millionths / 1_000_000n}.${String(millionths % 1_000_000n).padStart(6, '0')}`;

const createAuditSku = async (id, suffix) => runSql(`
  INSERT INTO public.products (id,sku,name_ar,category_id,unit_id,
    purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,
    cost_price_in_minor_units,sale_price_in_minor_units,wholesale_price_in_minor_units,
    default_sale_price_in_minor_units,min_stock_level,is_active,is_flavor_master)
  SELECT '${id}', 'PHASE2-CORRECTIVE-${suffix}', 'Corrective runtime ${suffix}',
    category_id,unit_id,purchase_unit_id,sale_unit_id,1,1,100,150,150,150,0,true,false
  FROM public.products WHERE id='${OTHER}';
`);

const createLegacyCostPo = async (productId, suffix, quantity = 3) => {
  const po = await readJson(createPurchaseOrderSql({ key: `phase2-cost-po-${suffix}`,
    lines: [baseLine({ clientLineId: productId, productId, quantity, gross: 0 })],
  }));
  const item = await readJson(`UPDATE public.purchase_orders SET status='approved',
    approved_by='${OWNER}',approved_at=NOW() WHERE id='${po.purchase_order_id}';
    SELECT jsonb_build_object('id',id) FROM public.purchase_order_items
    WHERE purchase_order_id='${po.purchase_order_id}';`);
  return { poId: po.purchase_order_id, itemId: item.id };
};
const legacyPoCostSql = (productId, po, costShape, warehouseId = WAREHOUSE_B) =>
  userTransaction(OWNER, `SELECT public.receive_purchase_order(
    p_purchase_order_id := '${po.poId}',p_warehouse_id := '${warehouseId}',
    p_items := ${jsonSql([{ purchase_order_item_id: po.itemId, product_id: productId,
      received_quantity: 3, ...costShape }])});`);

const createGateConnection = async (label, lockSql) => {
  const child = spawn('docker', ['exec','-i',databaseContainer,'psql','-U','postgres',
    '-d','postgres','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],
  { windowsHide: true, stdio: ['pipe','pipe','pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const closed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr)));
  });
  closed.catch(() => {});
  child.stdin.write(`SET application_name='${label}'; BEGIN; SET LOCAL statement_timeout='30s';
    ${lockSql} SELECT 'INTERNAL_GATE_READY';\n`);
  const deadline = Date.now() + 10_000;
  while (!stdout.includes('INTERNAL_GATE_READY') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!stdout.includes('INTERNAL_GATE_READY')) {
    child.stdin.end('ROLLBACK;\n');
    await closed;
    assert.fail(`Internal gate ${label} never became ready`);
  }
  return { release: async () => {
    if (!child.stdin.destroyed) child.stdin.end('ROLLBACK;\n');
    await closed;
  } };
};

const supplierPaymentSql = ({
  purchaseOrderId,
  key,
  amount = 50,
  paymentMethod = 'cliq',
  omitPaymentMethod = false,
  reference = 'PHASE2-SUPPLIER-PAYMENT',
}) => userTransaction(OWNER, `SELECT public.record_supplier_payment(
  p_supplier_id := '${SUPPLIER_A}',
  p_purchase_order_id := '${purchaseOrderId}',
  p_amount_in_minor_units := ${amount},
  ${omitPaymentMethod ? '' : `p_payment_method := ${paymentMethod === null ? 'NULL' : sqlLiteral(paymentMethod)},`}
  p_reference_number := ${sqlLiteral(reference)},
  p_idempotency_key := ${sqlLiteral(key)}
);`);

const createSupplierPaymentPo = async (suffix, total = 1000) => {
  const created = await readJson(createPurchaseOrderSql({
    key: `phase2-supplier-payment-po-${suffix}`,
    lines: [baseLine({
      clientLineId: `92300000-0000-0000-0001-${String(9000 + Number(suffix)).padStart(12, '0')}`,
      quantity: 10,
      gross: total,
    })],
  }));
  await runSql(`UPDATE public.purchase_orders SET status='approved',
    approved_by='${OWNER}', approved_at=NOW() WHERE id='${created.purchase_order_id}';`);
  return created.purchase_order_id;
};

const supplierPaymentPoState = (purchaseOrderId) => readJson(`
  SELECT jsonb_build_object(
    'purchaseOrder', to_jsonb(po),
    'payments', (SELECT COALESCE(jsonb_agg(to_jsonb(payment) ORDER BY payment.id), '[]')
      FROM public.supplier_payments payment WHERE payment.purchase_order_id = po.id),
    'reversals', (SELECT COALESCE(jsonb_agg(to_jsonb(reversal) ORDER BY reversal.id), '[]')
      FROM public.supplier_payment_reversals reversal
      WHERE reversal.supplier_payment_id IN (
        SELECT id FROM public.supplier_payments WHERE purchase_order_id = po.id
      )),
    'supplier', (SELECT to_jsonb(supplier) FROM public.suppliers supplier
      WHERE supplier.id = po.supplier_id),
    'shift', (SELECT to_jsonb(shift) FROM public.cash_shifts shift
      WHERE shift.id = '92300000-0000-0000-0000-000000000500'),
    'audit', (SELECT COALESCE(jsonb_agg(to_jsonb(log) ORDER BY log.id), '[]')
      FROM public.audit_logs log
      WHERE log.entity_name IN ('supplier_payments', 'supplier_payment_reversals')
        AND (log.entity_id IN (
          SELECT id FROM public.supplier_payments WHERE purchase_order_id = po.id
        ) OR log.entity_id IN (
          SELECT reversal.id FROM public.supplier_payment_reversals reversal
          WHERE reversal.supplier_payment_id IN (
            SELECT id FROM public.supplier_payments WHERE purchase_order_id = po.id
          )
        )))
  ) FROM public.purchase_orders po WHERE po.id = '${purchaseOrderId}';
`);

const expectFailureBeforeGateRelease = async (gate, promise, identity) => {
  let timedOut = false;
  const outcome = await Promise.race([
    promise.then(
      (value) => ({ status: 'fulfilled', value }),
      (error) => ({ status: 'rejected', error }),
    ),
    new Promise((resolve) => setTimeout(() => {
      timedOut = true;
      resolve({ status: 'timeout' });
    }, 2_500)),
  ]);
  await gate.release();
  if (timedOut) {
    await promise.catch(() => {});
    assert.fail('Expected invalid supplier payment to reject while the unrelated lock remained held.');
  }
  assert.equal(outcome.status, 'rejected');
  const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
  assertSqlFailureIdentity(message, identity);
};

const originalSaleState = (orderId) => readJson(`SELECT jsonb_build_object(
  'order',to_jsonb(o),
  'items',(SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]') FROM public.order_items i WHERE i.order_id=o.id),
  'payments',(SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.customer_payments p WHERE p.order_id=o.id),
  'reversals',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.pos_sale_reversals r WHERE r.order_id=o.id),
  'movements',(SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]') FROM public.inventory_movements m WHERE m.reference_id=o.id)
) FROM public.orders o WHERE o.id='${orderId}';`);

try {
  const { stdout: bootstrapOutput } = await execFileAsync(
    process.execPath,
    [bootstrapPath],
    {
      cwd: projectRoot,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      timeout: 360_000,
      env: { ...process.env, NAWASRAH_ISOLATED_PROJECT_ID: projectId },
    },
  );
  const bootstrap = JSON.parse(bootstrapOutput);
  isolatedProjectRoot = bootstrap.isolatedProjectRoot;

  const setupSql = await readFile(runtimeSqlPath, 'utf8');
  const setup = await readJson(setupSql);
  assert.deepEqual(setup, {
    fixtures: true,
    featureState: 'OFF',
    migration113: true,
    rlsTables: 4,
    directClientWrites: false,
  });

  const baseKey = 'phase2-base-off-0001';
  const baseResult = await readJson(directReceiptSql({
    key: baseKey,
    lines: [baseLine({ clientLineId: '92300000-0000-0000-0000-000000001001' })],
  }));
  assert.equal(baseResult.inventory_acquisition_cost_in_minor_units, 301);
  assert.equal(baseResult.supplier_invoice_payable_total_in_minor_units, 301);
  const baseWac = await readJson(`
    SELECT jsonb_build_object(
      'quantity', balance.on_hand_quantity,
      'exactWac', product.wac_cost_in_minor_units_exact,
      'legacyWac', product.cost_price_in_minor_units
    )
    FROM public.inventory_balances balance
    JOIN public.products product ON product.id = balance.product_id
    WHERE balance.product_id = '${OTHER}' AND balance.warehouse_id = '${WAREHOUSE_A}';
  `);
  assert.deepEqual(baseWac, { quantity: 3, exactWac: 100.333333, legacyWac: 100 });

  const offKey = 'phase2-feature-off-0001';
  await expectSqlFailure(directReceiptSql({
    key: offKey,
    lines: [parcelLine({ clientLineId: '92300000-0000-0000-0000-000000001002' })],
  }), { sqlState: 'P0001', applicationIdentity: 'CONFIGURABLE_PARCEL_DISABLED' });
  assert.deepEqual(await countBusinessState(offKey), {
    operations: 0, directReceipts: 0, purchaseReceipts: 0, movements: 0, payments: 0,
  });

  const pilot = await readUserJson(OWNER, `
    SELECT public.set_configurable_parcel_feature_state_v1('OWNER_PILOT');
  `);
  assert.equal(pilot.feature_state, 'OWNER_PILOT');
  const pilotKey = ['phase2', 'owner', 'pilot', '0001'].join('-');
  await expectSqlFailure(directReceiptSql({
    userId: WAREHOUSE_KEEPER,
    key: pilotKey,
    lines: [parcelLine({ clientLineId: '92300000-0000-0000-0000-000000001003' })],
  }), { sqlState: 'P0001', applicationIdentity: 'CONFIGURABLE_PARCEL_DISABLED' });
  assert.deepEqual(await countBusinessState(pilotKey), {
    operations: 0, directReceipts: 0, purchaseReceipts: 0, movements: 0, payments: 0,
  });
  const enabled = await readUserJson(OWNER, `
    SELECT public.set_configurable_parcel_feature_state_v1('ENABLED');
  `);
  assert.equal(enabled.feature_state, 'ENABLED');

  const parcelKey = ['phase2', 'direct', 'parcel', '0001'].join('-');
  const parcelLines = [parcelLine({
    clientLineId: '92300000-0000-0000-0000-000000001004',
  })];
  const parcelResult = await readJson(directReceiptSql({
    key: parcelKey,
    invoice: 'P2-DIRECT-001',
    headerDiscount: 100,
    freight: 50,
    tax: 16,
    paid: 500,
    paymentMethod: 'cliq',
    paymentReference: 'P2-CLIQ-001',
    lines: parcelLines,
  }));
  assert.deepEqual({
    acquisition: parcelResult.inventory_acquisition_cost_in_minor_units,
    payable: parcelResult.supplier_invoice_payable_total_in_minor_units,
    outstanding: parcelResult.supplier_outstanding_balance_effect_in_minor_units,
  }, { acquisition: 850, payable: 866, outstanding: 366 });

  const parcelStateBeforeReplay = await readJson(`
    SELECT jsonb_build_object(
      'receiptId', receipt.id,
      'receiptUpdatedAt', receipt.updated_at,
      'operationCompletedAt', operation.completed_at,
      'movementCount', (SELECT COUNT(*) FROM public.inventory_movements WHERE operation_id = operation.id),
      'paymentCount', (SELECT COUNT(*) FROM public.supplier_payments WHERE operation_id = operation.id),
      'lineAllocation', (SELECT SUM(final_acquisition_amount_in_minor_units) FROM public.supplier_receipt_commercial_lines WHERE operation_id = operation.id),
      'componentAllocation', (SELECT SUM(allocated_cost_in_minor_units) FROM public.supplier_receipt_items WHERE operation_id = operation.id)
    )
    FROM public.supplier_receipts receipt
    JOIN public.business_operations operation ON operation.id = receipt.operation_id
    WHERE operation.idempotency_key = ${sqlLiteral(parcelKey)};
  `);
  assert.equal(parcelStateBeforeReplay.lineAllocation, 850);
  assert.equal(parcelStateBeforeReplay.componentAllocation, 850);
  assert.equal(parcelStateBeforeReplay.movementCount, 3);
  assert.equal(parcelStateBeforeReplay.paymentCount, 1);

  const replayLines = [{
    ...parcelLines[0],
    components: [...parcelLines[0].components].reverse(),
  }];
  await readUserJson(OWNER, `SELECT public.set_configurable_parcel_feature_state_v1('OFF');`);
  const offReplayBefore = await targetedState(parcelKey, [SKU_A, SKU_B, SKU_C]);
  const replayResult = await readJson(directReceiptSql({
    key: parcelKey,
    invoice: ' P2-DIRECT-001 ',
    headerDiscount: 100,
    freight: 50,
    tax: 16,
    paid: 500,
    paymentMethod: 'CLIQ',
    paymentReference: 'P2-CLIQ-001',
    lines: replayLines,
  }));
  assert.deepEqual(replayResult, parcelResult);
  assert.deepEqual(await targetedState(parcelKey, [SKU_A, SKU_B, SKU_C]), offReplayBefore);
  await readUserJson(OWNER, `SELECT public.set_configurable_parcel_feature_state_v1('ENABLED');`);
  const parcelStateAfterReplay = await readJson(`
    SELECT jsonb_build_object(
      'receiptId', receipt.id,
      'receiptUpdatedAt', receipt.updated_at,
      'operationCompletedAt', operation.completed_at,
      'movementCount', (SELECT COUNT(*) FROM public.inventory_movements WHERE operation_id = operation.id),
      'paymentCount', (SELECT COUNT(*) FROM public.supplier_payments WHERE operation_id = operation.id),
      'lineAllocation', (SELECT SUM(final_acquisition_amount_in_minor_units) FROM public.supplier_receipt_commercial_lines WHERE operation_id = operation.id),
      'componentAllocation', (SELECT SUM(allocated_cost_in_minor_units) FROM public.supplier_receipt_items WHERE operation_id = operation.id)
    )
    FROM public.supplier_receipts receipt
    JOIN public.business_operations operation ON operation.id = receipt.operation_id
    WHERE operation.idempotency_key = ${sqlLiteral(parcelKey)};
  `);
  assert.deepEqual(parcelStateAfterReplay, parcelStateBeforeReplay);

  await expectSqlFailure(directReceiptSql({
    key: parcelKey,
    invoice: 'P2-DIRECT-001',
    headerDiscount: 100,
    freight: 50,
    tax: 16,
    paid: 500,
    paymentMethod: 'cliq',
    paymentReference: 'P2-CLIQ-001',
    lines: [parcelLine({
      clientLineId: '92300000-0000-0000-0000-000000001004',
      gross: 1001,
    })],
  }), { sqlState: 'P0001', applicationIdentity: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(await countBusinessState(parcelKey), {
    operations: 1, directReceipts: 1, purchaseReceipts: 0, movements: 3, payments: 1,
  });

  const directCancel = await readUserJson(OWNER, `
    SELECT public.cancel_supplier_receipt('${parcelResult.receipt_id}', 'Phase 2 runtime cancellation');
  `);
  assert.equal(directCancel.success, true);
  const directCancelState = await readJson(`
    SELECT jsonb_build_object(
      'status', receipt.status,
      'paymentReversed', payment.is_reversed,
      'supplierBalance', supplier.current_balance_in_minor_units,
      'reversalMovements', (SELECT COUNT(*) FROM public.inventory_movements WHERE reversed_movement_id IN (
        SELECT id FROM public.inventory_movements WHERE operation_id = receipt.operation_id
      ))
    )
    FROM public.supplier_receipts receipt
    JOIN public.suppliers supplier ON supplier.id = receipt.supplier_id
    LEFT JOIN public.supplier_payments payment ON payment.supplier_receipt_id = receipt.id
    WHERE receipt.id = '${parcelResult.receipt_id}';
  `);
  assert.equal(directCancelState.status, 'cancelled');
  assert.equal(directCancelState.paymentReversed, true);
  assert.equal(directCancelState.reversalMovements, 3);

  const overpayKey = 'phase2-overpayment-0001';
  await expectSqlFailure(directReceiptSql({
    key: overpayKey,
    paid: 302,
    paymentMethod: 'cash',
    lines: [baseLine({ clientLineId: '92300000-0000-0000-0000-000000001005' })],
  }), { sqlState: '23514', constraint: 'phase2_payment_upper_bound_check' });
  assert.deepEqual(await countBusinessState(overpayKey), {
    operations: 0, directReceipts: 0, purchaseReceipts: 0, movements: 0, payments: 0,
  });

  const underfillKey = 'phase2-underfill-0001';
  await expectSqlFailure(directReceiptSql({
    key: underfillKey,
    lines: [parcelLine({
      clientLineId: '92300000-0000-0000-0000-000000001006',
      quantities: [4, 3, 2],
    })],
  }), { sqlState: '23514', constraint: 'phase2_receipt_parcel_capacity_check' });
  assert.deepEqual(await countBusinessState(underfillKey), {
    operations: 0, directReceipts: 0, purchaseReceipts: 0, movements: 0, payments: 0,
  });

  const partialExplicitKey = ['phase2', 'explicit', 'partial', '0001'].join('-');
  await expectSqlFailure(directReceiptSql({
    key: partialExplicitKey,
    lines: [parcelLine({
      clientLineId: '92300000-0000-0000-0000-000000001007',
      explicitCosts: [360, null, null],
    })],
  }), { sqlState: '23514', constraint: 'phase2_component_cost_completeness_check' });
  assert.deepEqual(await countBusinessState(partialExplicitKey), {
    operations: 0, directReceipts: 0, purchaseReceipts: 0, movements: 0, payments: 0,
  });

  const explicitKey = 'phase2-explicit-complete-0001';
  const explicitResult = await readJson(directReceiptSql({
    key: explicitKey,
    supplierId: SUPPLIER_B,
    warehouseId: WAREHOUSE_B,
    lines: [parcelLine({
      clientLineId: '92300000-0000-0000-0000-000000001008',
      explicitCosts: [360, 270, 270],
    })],
  }));
  assert.equal(explicitResult.inventory_acquisition_cost_in_minor_units, 900);

  const zeroCostKey = 'phase2-zero-cost-0001';
  const zeroCostResult = await readJson(directReceiptSql({
    key: zeroCostKey,
    supplierId: SUPPLIER_B,
    warehouseId: WAREHOUSE_B,
    lines: [baseLine({
      clientLineId: '92300000-0000-0000-0000-000000001009',
      productId: OTHER,
      quantity: 1,
      gross: 0,
    })],
  }));
  assert.equal(zeroCostResult.inventory_acquisition_cost_in_minor_units, 0);
  const zeroBasisKey = 'phase2-zero-basis-0001';
  await expectSqlFailure(directReceiptSql({
    key: zeroBasisKey,
    supplierId: SUPPLIER_B,
    warehouseId: WAREHOUSE_B,
    freight: 1,
    lines: [baseLine({
      clientLineId: '92300000-0000-0000-0000-000000001010',
      productId: OTHER,
      quantity: 1,
      gross: 0,
    })],
  }), { sqlState: '23514', constraint: 'phase2_zero_allocation_basis_check' });
  assert.deepEqual(await countBusinessState(zeroBasisKey), {
    operations: 0, directReceipts: 0, purchaseReceipts: 0, movements: 0, payments: 0,
  });

  const repeatedSkuKey = 'phase2-repeated-sku-lines-0001';
  const repeatedSkuResult = await readJson(directReceiptSql({
    key: repeatedSkuKey,
    supplierId: SUPPLIER_B,
    warehouseId: WAREHOUSE_B,
    lines: [
      baseLine({
        clientLineId: '92300000-0000-0000-0000-000000001011',
        productId: OTHER,
        quantity: 1,
        gross: 101,
      }),
      baseLine({
        clientLineId: '92300000-0000-0000-0000-000000001012',
        productId: OTHER,
        quantity: 2,
        gross: 202,
      }),
    ],
  }));
  assert.equal(repeatedSkuResult.inventory_acquisition_cost_in_minor_units, 303);
  assert.deepEqual(await countBusinessState(repeatedSkuKey), {
    operations: 1, directReceipts: 1, purchaseReceipts: 0, movements: 2, payments: 0,
  });

  const poCreateLine = parcelLine({
    clientLineId: '92300000-0000-0000-0000-000000001100',
    parcels: 10,
    quantities: [20, 15, 15],
    gross: 10000,
    discount: 0,
  });
  const poResult = await readJson(createPurchaseOrderSql({
    key: 'phase2-po-create-0001',
    lines: [poCreateLine],
  }));
  assert.ok(poResult.purchase_order_id);
  const poItem = await readJson(`
    UPDATE public.purchase_orders
    SET status = 'approved', approved_at = NOW(), approved_by = '${OWNER}'
    WHERE id = '${poResult.purchase_order_id}';
    SELECT jsonb_build_object(
      'id', id,
      'ordered', ordered_quantity,
      'parcels', parcel_quantity,
      'received', received_quantity,
      'receivedParcels', received_parcel_quantity
    )
    FROM public.purchase_order_items
    WHERE purchase_order_id = '${poResult.purchase_order_id}';
  `);
  assert.deepEqual(
    { ordered: poItem.ordered, parcels: poItem.parcels, received: poItem.received, receivedParcels: poItem.receivedParcels },
    { ordered: 50, parcels: 10, received: 0, receivedParcels: 0 },
  );

  const poFirstLine = parcelLine({
    clientLineId: '92300000-0000-0000-0000-000000001101',
    purchaseOrderItemId: poItem.id,
    parcels: 4,
    quantities: [8, 6, 6],
    gross: 4000,
    discount: 0,
  });
  const poFirst = await readJson(receivePurchaseOrderSql({
    purchaseOrderId: poResult.purchase_order_id,
    invoice: 'P2-PO-001-A',
    key: ['phase2', 'po', 'receive', '0001'].join('-'),
    lines: [poFirstLine],
  }));
  assert.equal(poFirst.inventory_acquisition_cost_in_minor_units, 4000);
  const poPartialState = await readJson(`
    SELECT jsonb_build_object(
      'status', purchase_order.status,
      'received', item.received_quantity,
      'receivedParcels', item.received_parcel_quantity,
      'stock', (SELECT SUM(on_hand_quantity) FROM public.inventory_balances WHERE warehouse_id = '${WAREHOUSE_A}' AND product_id IN ('${SKU_A}', '${SKU_B}', '${SKU_C}'))
    )
    FROM public.purchase_orders purchase_order
    JOIN public.purchase_order_items item ON item.purchase_order_id = purchase_order.id
    WHERE purchase_order.id = '${poResult.purchase_order_id}';
  `);
  assert.deepEqual(poPartialState, { status: 'partially_received', received: 20, receivedParcels: 4, stock: 20 });

  const duplicateInvoiceKey = ['phase2', 'duplicate', 'invoice', '0001'].join('-');
  await expectSqlFailure(directReceiptSql({
    key: duplicateInvoiceKey,
    invoice: 'p2-po-001-a',
    lines: [baseLine({
      clientLineId: '92300000-0000-0000-0000-000000001103',
      quantity: 1,
      gross: 100,
    })],
  }), { sqlState: '23505', constraint: 'uq_supplier_financial_invoice_active' });
  assert.deepEqual(await countBusinessState(duplicateInvoiceKey), {
    operations: 0, directReceipts: 0, purchaseReceipts: 0, movements: 0, payments: 0,
  });
  const differentSupplierInvoice = await readJson(directReceiptSql({
    key: 'phase2-different-supplier-invoice-0001',
    supplierId: SUPPLIER_B,
    warehouseId: WAREHOUSE_B,
    invoice: 'P2-PO-001-A',
    lines: [baseLine({
      clientLineId: '92300000-0000-0000-0000-000000001104',
      quantity: 1,
      gross: 100,
    })],
  }));
  assert.equal(differentSupplierInvoice.success, true);

  const poSecondLine = parcelLine({
    clientLineId: '92300000-0000-0000-0000-000000001102',
    purchaseOrderItemId: poItem.id,
    parcels: 6,
    quantities: [12, 9, 9],
    gross: 6001,
    discount: 0,
  });
  const poSecond = await readJson(receivePurchaseOrderSql({
    purchaseOrderId: poResult.purchase_order_id,
    invoice: 'P2-PO-001-B',
    key: 'phase2-po-receive-0002',
    lines: [poSecondLine],
  }));
  assert.equal(poSecond.inventory_acquisition_cost_in_minor_units, 6001);
  const poCompleteState = await readJson(`
    SELECT jsonb_build_object(
      'status', purchase_order.status,
      'received', item.received_quantity,
      'receivedParcels', item.received_parcel_quantity,
      'lineAllocation', (SELECT SUM(final_acquisition_amount_in_minor_units) FROM public.purchase_receipt_commercial_lines WHERE purchase_receipt_id = '${poSecond.receipt_id}'),
      'componentAllocation', (SELECT SUM(allocated_cost_in_minor_units) FROM public.purchase_receipt_items WHERE purchase_receipt_id = '${poSecond.receipt_id}')
    )
    FROM public.purchase_orders purchase_order
    JOIN public.purchase_order_items item ON item.purchase_order_id = purchase_order.id
    WHERE purchase_order.id = '${poResult.purchase_order_id}';
  `);
  assert.deepEqual(poCompleteState, {
    status: 'received', received: 50, receivedParcels: 10,
    lineAllocation: 6001, componentAllocation: 6001,
  });

  await readUserJson(OWNER, `SELECT public.set_configurable_parcel_feature_state_v1('OFF');`);
  const poReplayRead = () => readJson(`SELECT jsonb_build_object(
    'po', to_jsonb(p), 'item', to_jsonb(i), 'receipt', to_jsonb(r),
    'movements', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.inventory_movements m WHERE m.operation_id = r.operation_id),
    'snapshots', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.product_id) FROM public.phase2_receipt_wac_snapshots s WHERE s.operation_id = r.operation_id)
    ) FROM public.purchase_orders p JOIN public.purchase_order_items i ON i.purchase_order_id = p.id
    JOIN public.purchase_receipts r ON r.id = '${poSecond.receipt_id}' WHERE p.id = '${poResult.purchase_order_id}';`);
  const poBeforeOffReplay = await poReplayRead();
  assert.deepEqual(await readJson(receivePurchaseOrderSql({
    purchaseOrderId: poResult.purchase_order_id, invoice: 'P2-PO-001-B',
    key: 'phase2-po-receive-0002', lines: [poSecondLine],
  })), poSecond);
  await expectSqlFailure(receivePurchaseOrderSql({
    purchaseOrderId: poResult.purchase_order_id, invoice: 'P2-PO-001-B',
    key: 'phase2-po-receive-0002', lines: [{ ...poSecondLine, gross_amount_in_minor_units: 6002 }],
  }), { sqlState: 'P0001', applicationIdentity: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(await poReplayRead(), poBeforeOffReplay);
  await readUserJson(OWNER, `SELECT public.set_configurable_parcel_feature_state_v1('ENABLED');`);

  const poCancel = await readUserJson(OWNER, `
    SELECT public.cancel_purchase_receipt_v2('${poSecond.receipt_id}', 'Phase 2 runtime cancellation');
  `);
  assert.equal(poCancel.success, true);
  const poCancelState = await readJson(`
    SELECT jsonb_build_object(
      'status', purchase_order.status,
      'received', item.received_quantity,
      'receivedParcels', item.received_parcel_quantity,
      'receiptStatus', receipt.status,
      'reversalMovements', (SELECT COUNT(*) FROM public.inventory_movements WHERE reversed_movement_id IN (
        SELECT id FROM public.inventory_movements WHERE operation_id = receipt.operation_id
      ))
    )
    FROM public.purchase_orders purchase_order
    JOIN public.purchase_order_items item ON item.purchase_order_id = purchase_order.id
    JOIN public.purchase_receipts receipt ON receipt.id = '${poSecond.receipt_id}'
    WHERE purchase_order.id = '${poResult.purchase_order_id}';
  `);
  assert.deepEqual(poCancelState, {
    status: 'partially_received', received: 20, receivedParcels: 4,
    receiptStatus: 'cancelled', reversalMovements: 3,
  });

  const prepaidPo = await readJson(createPurchaseOrderSql({
    key: 'phase2-prepaid-po-create-0001',
    lines: [baseLine({
      clientLineId: '92300000-0000-0000-0000-000000001105',
      quantity: 2,
      gross: 200,
    })],
  }));
  const prepaidPoItem = await readJson(`
    UPDATE public.purchase_orders
    SET status = 'approved', approved_at = NOW(), approved_by = '${OWNER}',
        amount_paid_in_minor_units = 1
    WHERE id = '${prepaidPo.purchase_order_id}';
    SELECT jsonb_build_object('id', id)
    FROM public.purchase_order_items
    WHERE purchase_order_id = '${prepaidPo.purchase_order_id}';
  `);
  const prepaidReceiveKey = ['phase2', 'prepaid', 'po', 'receive', '0001'].join('-');
  await expectSqlFailure(receivePurchaseOrderSql({
    purchaseOrderId: prepaidPo.purchase_order_id,
    invoice: null,
    key: prepaidReceiveKey,
    lines: [baseLine({
      clientLineId: '92300000-0000-0000-0000-000000001106',
      purchaseOrderItemId: prepaidPoItem.id,
      quantity: 2,
      gross: 200,
    })],
  }), { sqlState: 'P0001', applicationIdentity: 'AMBIGUOUS_PREPAID_PO' });
  assert.deepEqual(await countBusinessState(prepaidReceiveKey), {
    operations: 0, directReceipts: 0, purchaseReceipts: 0, movements: 0, payments: 0,
  });

  const crossPathPo = await readJson(createPurchaseOrderSql({
    key: 'phase2-cross-path-po-create-0001',
    lines: [baseLine({
      clientLineId: '92300000-0000-0000-0000-000000001107',
      quantity: 5,
      gross: 505,
    })],
  }));
  const crossPathPoItem = await readJson(`
    UPDATE public.purchase_orders
    SET status = 'approved', approved_at = NOW(), approved_by = '${OWNER}'
    WHERE id = '${crossPathPo.purchase_order_id}';
    SELECT jsonb_build_object('id', id)
    FROM public.purchase_order_items
    WHERE purchase_order_id = '${crossPathPo.purchase_order_id}';
  `);
  const crossPathPoKey = 'phase2-cross-path-po-receive-0001';
  const crossPathDirectKey = 'phase2-cross-path-direct-0001';
  const crossPathMixedResults = await runCoordinatedPair(
    receivePurchaseOrderSql({
      purchaseOrderId: crossPathPo.purchase_order_id,
      invoice: null,
      key: crossPathPoKey,
      lines: [baseLine({
        clientLineId: '92300000-0000-0000-0000-000000001108',
        purchaseOrderItemId: crossPathPoItem.id,
        quantity: 5,
        gross: 505,
      })],
    }),
    directReceiptSql({
      key: crossPathDirectKey,
      supplierId: SUPPLIER_B,
      warehouseId: WAREHOUSE_B,
      lines: [baseLine({
        clientLineId: '92300000-0000-0000-0000-000000001109',
        productId: OTHER,
        quantity: 4,
        gross: 404,
      })],
    }),
  );
  assert.equal(crossPathMixedResults.every((result) => result.success), true);
  assert.deepEqual(await countBusinessState(crossPathPoKey), {
    operations: 1, directReceipts: 0, purchaseReceipts: 1, movements: 1, payments: 0,
  });
  assert.deepEqual(await countBusinessState(crossPathDirectKey), {
    operations: 1, directReceipts: 1, purchaseReceipts: 0, movements: 1, payments: 0,
  });

  const concurrentSameKey = 'phase2-concurrent-replay-0001';
  const concurrentSameSql = directReceiptSql({
    key: concurrentSameKey,
    supplierId: SUPPLIER_B,
    warehouseId: WAREHOUSE_B,
    lines: [baseLine({
      clientLineId: '92300000-0000-0000-0000-000000001200',
      productId: OTHER,
      quantity: 2,
      gross: 201,
    })],
  });
  const samePayloadResults = await runCoordinatedPair(concurrentSameSql, concurrentSameSql);
  assert.deepEqual(samePayloadResults[0], samePayloadResults[1]);
  assert.deepEqual(await countBusinessState(concurrentSameKey), {
    operations: 1, directReceipts: 1, purchaseReceipts: 0, movements: 1, payments: 0,
  });

  const concurrentConflictKey = 'phase2-concurrent-conflict-0001';
  const conflictResults = await runCoordinatedPair(
    directReceiptSql({
      key: concurrentConflictKey,
      supplierId: SUPPLIER_B,
      warehouseId: WAREHOUSE_B,
      lines: [baseLine({
        clientLineId: '92300000-0000-0000-0000-000000001201',
        productId: OTHER,
        quantity: 2,
        gross: 202,
      })],
    }),
    directReceiptSql({
      key: concurrentConflictKey,
      supplierId: SUPPLIER_B,
      warehouseId: WAREHOUSE_B,
      lines: [baseLine({
        clientLineId: '92300000-0000-0000-0000-000000001201',
        productId: OTHER,
        quantity: 2,
        gross: 203,
      })],
    }),
    { settled: true },
  );
  assert.equal(conflictResults.filter((result) => result.status === 'fulfilled').length, 1);
  const rejectedConflict = conflictResults.find((result) => result.status === 'rejected');
  assert.ok(rejectedConflict && rejectedConflict.status === 'rejected');
  assertSqlFailureIdentity(
    rejectedConflict.reason instanceof Error
      ? rejectedConflict.reason.message
      : String(rejectedConflict.reason),
    { sqlState: 'P0001', applicationIdentity: 'IDEMPOTENCY_CONFLICT' },
  );
  assert.deepEqual(await countBusinessState(concurrentConflictKey), {
    operations: 1, directReceipts: 1, purchaseReceipts: 0, movements: 1, payments: 0,
  });

  const crossPathResults = await runCoordinatedPair(
    directReceiptSql({
      key: 'phase2-lock-direct-0001',
      supplierId: SUPPLIER_B,
      warehouseId: WAREHOUSE_B,
      lines: [baseLine({
        clientLineId: '92300000-0000-0000-0000-000000001202',
        productId: SKU_A,
        quantity: 7,
        gross: 701,
      })],
    }),
    directReceiptSql({
      key: 'phase2-lock-direct-0002',
      supplierId: SUPPLIER_B,
      warehouseId: WAREHOUSE_B,
      lines: [baseLine({
        clientLineId: '92300000-0000-0000-0000-000000001203',
        productId: SKU_A,
        quantity: 11,
        gross: 1103,
      })],
    }),
  );
  assert.equal(crossPathResults.every((result) => result.success), true);
  const reconciliation = await readJson(`
    SELECT jsonb_build_object(
      'quantity', balance.on_hand_quantity,
      'exactWac', product.wac_cost_in_minor_units_exact,
      'legacyWac', product.cost_price_in_minor_units,
      'globalQuantity', (
        SELECT SUM(on_hand_quantity) FROM public.inventory_balances
        WHERE product_id = '${SKU_A}'
      ),
      'movementBalance', (
        SELECT SUM(quantity) FROM public.inventory_movements
        WHERE product_id = '${SKU_A}' AND warehouse_id = '${WAREHOUSE_B}'
      ),
      'receivedCost', (
        SELECT SUM(allocated_acquisition_cost_in_minor_units)
        FROM public.phase2_receipt_wac_snapshots snapshot
        LEFT JOIN public.supplier_receipts direct_receipt
          ON direct_receipt.id = snapshot.supplier_receipt_id
        LEFT JOIN public.purchase_receipts po_receipt
          ON po_receipt.id = snapshot.purchase_receipt_id
        WHERE snapshot.product_id = '${SKU_A}'
          AND COALESCE(direct_receipt.status, po_receipt.status) = 'completed'
      ),
      'receivedUnits', (
        SELECT SUM(received_base_quantity)
        FROM public.phase2_receipt_wac_snapshots snapshot
        LEFT JOIN public.supplier_receipts direct_receipt
          ON direct_receipt.id = snapshot.supplier_receipt_id
        LEFT JOIN public.purchase_receipts po_receipt
          ON po_receipt.id = snapshot.purchase_receipt_id
        WHERE snapshot.product_id = '${SKU_A}'
          AND COALESCE(direct_receipt.status, po_receipt.status) = 'completed'
      ),
      'latestSnapshotWac', (
        SELECT snapshot.resulting_exact_wac_in_minor_units
        FROM public.phase2_receipt_wac_snapshots snapshot
        LEFT JOIN public.supplier_receipts direct_receipt
          ON direct_receipt.id = snapshot.supplier_receipt_id
        LEFT JOIN public.purchase_receipts po_receipt
          ON po_receipt.id = snapshot.purchase_receipt_id
        WHERE snapshot.product_id = '${SKU_A}'
          AND COALESCE(direct_receipt.status, po_receipt.status) = 'completed'
        ORDER BY snapshot.receipt_movement_sequence_max DESC
        LIMIT 1
      )
    )
    FROM public.inventory_balances balance
    JOIN public.products product ON product.id = balance.product_id
    WHERE balance.product_id = '${SKU_A}' AND balance.warehouse_id = '${WAREHOUSE_B}';
  `);
  assert.equal(reconciliation.quantity, reconciliation.movementBalance);
  assert.equal(reconciliation.receivedUnits, reconciliation.globalQuantity);
  assert.equal(Number(reconciliation.exactWac), Number(reconciliation.latestSnapshotWac));
  assert.ok(
    Math.abs(
      Number(reconciliation.exactWac)
      - (reconciliation.receivedCost / reconciliation.receivedUnits)
    ) <= 0.000001,
    'Sequential NUMERIC(24,6) WAC exceeded its declared six-decimal precision bound.',
  );

  const immutableReceipt = await readJson(`
    SELECT jsonb_build_object('id', id, 'updatedAt', updated_at)
    FROM public.supplier_receipts
    WHERE operation_id = (
      SELECT id FROM public.business_operations WHERE idempotency_key = ${sqlLiteral(explicitKey)}
    ) FOR UPDATE;
  `);
  await expectSqlFailure(`
    UPDATE public.supplier_receipts
    SET inventory_acquisition_cost_snapshot_in_minor_units =
      inventory_acquisition_cost_snapshot_in_minor_units + 1
    WHERE id = '${immutableReceipt.id}';
  `, { sqlState: 'P0001', applicationIdentity: 'PHASE2_FINANCIAL_SNAPSHOT_IMMUTABLE' });
  const immutableAfter = await readJson(`
    SELECT jsonb_build_object(
      'acquisition', inventory_acquisition_cost_snapshot_in_minor_units,
      'updatedAt', updated_at
    ) FROM public.supplier_receipts WHERE id = '${immutableReceipt.id}';
  `);
  assert.equal(immutableAfter.acquisition, 900);
  assert.equal(immutableAfter.updatedAt, immutableReceipt.updatedAt);

  const bridgeProduct = '92300000-0000-0000-0000-000000000105';
  await runSql(`INSERT INTO public.products (
    id, sku, name_ar, category_id, unit_id, purchase_unit_id, sale_unit_id,
    units_per_purchase_unit, units_per_sale_unit, cost_price_in_minor_units,
    sale_price_in_minor_units, min_stock_level, is_active, is_flavor_master
  ) SELECT '${bridgeProduct}', 'PHASE2-WAC-BRIDGE', 'WAC bridge fixture',
    category_id, unit_id, purchase_unit_id, sale_unit_id, 1, 1, 100, 150, 0, true, false
    FROM public.products WHERE id = '${OTHER}';`);
  await readJson(directReceiptSql({ key: 'phase2-wac-bridge-v2-a', lines: [baseLine({
    clientLineId: '92300000-0000-0000-0000-000000001301', productId: bridgeProduct,
  })] }));
  const legacyKey = '92300000-0000-0000-0000-000000001302';
  const legacyItems = [{
    product_id: bridgeProduct, package_quantity: 3, units_per_package: 1,
    package_price_in_minor_units: 200, discount_in_minor_units: 0,
  }];
  const legacySql = legacyDirectReceiptSql({
    warehouseId: WAREHOUSE_B,
    key: legacyKey,
    items: legacyItems,
  });
  const legacyCreated = await readJson(legacySql);
  const expectedLegacyReplay = { ...legacyCreated, is_duplicate: true };
  const legacyIdentityBaseline = await targetedState(legacyKey, [bridgeProduct]);
  const legacyExpectedItemIds = await readJson(`SELECT COALESCE(
    jsonb_agg(item.id ORDER BY item.id), '[]'::JSONB
  ) FROM public.supplier_receipt_items item
  WHERE item.supplier_receipt_id = '${legacyCreated.receipt_id}';`);
  assert.equal(legacyIdentityBaseline.receipts.length, 1);
  assert.equal(legacyIdentityBaseline.receipts[0].id, legacyCreated.receipt_id);
  assert.equal(legacyIdentityBaseline.components.length, 1);
  assert.deepEqual(legacyIdentityBaseline.components.map((item) => item.id), legacyExpectedItemIds);
  assert.equal(legacyIdentityBaseline.components[0].supplier_receipt_id, legacyCreated.receipt_id);
  assert.equal(legacyIdentityBaseline.components[0].product_id, bridgeProduct);
  const legacyReplay = await readJson(legacySql);
  assert.deepEqual(legacyReplay, expectedLegacyReplay);
  assert.deepEqual(await targetedState(legacyKey, [bridgeProduct]), legacyIdentityBaseline);
  for (const changedSql of [
    legacyDirectReceiptSql({ warehouseId: WAREHOUSE_B, key: legacyKey,
      items: [{ ...legacyItems[0], package_quantity: 4 }] }),
    legacyDirectReceiptSql({ warehouseId: WAREHOUSE_B, key: legacyKey,
      items: [{ ...legacyItems[0], package_price_in_minor_units: 201 }] }),
    legacyDirectReceiptSql({ supplierId: SUPPLIER_B, warehouseId: WAREHOUSE_B,
      key: legacyKey, items: legacyItems }),
    legacyDirectReceiptSql({ warehouseId: WAREHOUSE_A, key: legacyKey, items: legacyItems }),
    legacyDirectReceiptSql({ warehouseId: WAREHOUSE_B, invoice: 'CHANGED-LEGACY-INVOICE',
      key: legacyKey, items: legacyItems }),
  ]) {
    await expectSqlFailure(changedSql, {
      sqlState: 'P0001', applicationIdentity: 'IDEMPOTENCY_CONFLICT',
    });
    assert.deepEqual(await targetedState(legacyKey, [bridgeProduct]), legacyIdentityBaseline);
  }
  const legacyActorError = await expectSqlFailure(legacyDirectReceiptSql({
    userId: WAREHOUSE_KEEPER,
    warehouseId: WAREHOUSE_B,
    key: legacyKey,
    items: legacyItems,
  }), { sqlState: 'P0001', applicationIdentity: 'IDEMPOTENCY_CONFLICT' });
  assert.doesNotMatch(legacyActorError, new RegExp(legacyCreated.receipt_id, 'u'));
  assert.deepEqual(await targetedState(legacyKey, [bridgeProduct]), legacyIdentityBaseline);

  await readUserJson(OWNER, `SELECT public.record_supplier_receipt_payment(
    p_receipt_id := '${legacyCreated.receipt_id}', p_amount_in_minor_units := 10,
    p_payment_method := 'cliq', p_reference_number := 'P2-LEGACY-LATER',
    p_idempotency_key := 'phase2-legacy-later-payment');`);
  const legacyAfterPayment = await targetedState(legacyKey, [bridgeProduct]);
  const legacyReplayAfterPayment = await readJson(legacySql);
  assert.deepEqual(legacyReplayAfterPayment, expectedLegacyReplay);
  assert.deepEqual(await targetedState(legacyKey, [bridgeProduct]), legacyAfterPayment);
  const bridgeRead = () => readJson(`SELECT jsonb_build_object(
    'exact', wac_cost_in_minor_units_exact, 'legacy', cost_price_in_minor_units,
    'quantity', (SELECT SUM(on_hand_quantity) FROM public.inventory_balances WHERE product_id = '${bridgeProduct}')
    ) FROM public.products WHERE id = '${bridgeProduct}';`);
  assert.deepEqual(await bridgeRead(), { exact: 150.166667, legacy: 150, quantity: 6 });
  await readJson(directReceiptSql({ key: 'phase2-wac-bridge-v2-b', lines: [baseLine({
    clientLineId: '92300000-0000-0000-0000-000000001303', productId: bridgeProduct,
    quantity: 1, gross: 200,
  })] }));
  assert.deepEqual(await bridgeRead(), { exact: 157.285715, legacy: 157, quantity: 7 });

  const legacyFirstProduct = '92300000-0000-0000-0000-000000000107';
  await runSql(`INSERT INTO public.products (id,sku,name_ar,category_id,unit_id,
    purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,
    cost_price_in_minor_units,sale_price_in_minor_units,min_stock_level,is_active,is_flavor_master)
    SELECT '${legacyFirstProduct}', 'PHASE2-LEGACY-FIRST', 'Legacy first WAC', category_id,
    unit_id,purchase_unit_id,sale_unit_id,1,1,100,150,0,true,false FROM public.products WHERE id = '${OTHER}';`);
  await readJson(legacySql.replaceAll(bridgeProduct, legacyFirstProduct).replaceAll(
    legacyKey, '92300000-0000-0000-0000-000000001351',
  ));
  await readJson(directReceiptSql({ key: 'phase2-legacy-first-v2', lines: [baseLine({
    clientLineId: '92300000-0000-0000-0000-000000001352', productId: legacyFirstProduct,
  })] }));
  const legacyPo = await readJson(createPurchaseOrderSql({ key: 'phase2-legacy-po-wac-create',
    lines: [baseLine({ clientLineId: '92300000-0000-0000-0000-000000001353',
      productId: legacyFirstProduct, quantity: 1, gross: 200 })],
  }));
  const legacyPoItem = await readJson(`UPDATE public.purchase_orders SET status = 'approved',
    approved_by = '${OWNER}', approved_at = NOW() WHERE id = '${legacyPo.purchase_order_id}';
    SELECT jsonb_build_object('id',id) FROM public.purchase_order_items WHERE purchase_order_id = '${legacyPo.purchase_order_id}';`);
  await readUserJson(OWNER, `SELECT public.receive_purchase_order(
    p_purchase_order_id := '${legacyPo.purchase_order_id}', p_warehouse_id := '${WAREHOUSE_A}',
    p_items := ${jsonSql([{ purchase_order_item_id: legacyPoItem.id,
      product_id: legacyFirstProduct, received_quantity: 1, unit_cost_in_minor_units: 200 }])});`);
  assert.deepEqual(await readJson(`SELECT jsonb_build_object('exact',wac_cost_in_minor_units_exact,
    'legacy',cost_price_in_minor_units,'quantity',(SELECT SUM(on_hand_quantity)
    FROM public.inventory_balances WHERE product_id = p.id)) FROM public.products p
    WHERE id = '${legacyFirstProduct}';`), { exact: 157.285715, legacy: 157, quantity: 7 });

  const legacyIdentityRow = await readJson(`SELECT jsonb_build_object(
    'receiptOperation', receipt.operation_id,
    'operationId', operation.id,
    'operationType', operation.operation_type,
    'identityVersion', operation.request_identity_version,
    'hasFingerprint', operation.request_fingerprint IS NOT NULL,
    'receivedAtMode', operation.request_identity_snapshot #>> '{canonical_request,received_at_mode}',
    'hasResolvedReceivedAt',
      NULLIF(operation.request_identity_snapshot #>> '{resolved_defaults,received_at}', '') IS NOT NULL
  ) FROM public.supplier_receipts receipt
  JOIN public.business_operations operation ON operation.id = receipt.operation_id
  WHERE receipt.id = '${legacyCreated.receipt_id}';`);
  assert.deepEqual(legacyIdentityRow, {
    receiptOperation: legacyIdentityRow.operationId,
    operationId: legacyIdentityRow.operationId,
    operationType: 'supplier_receipt_legacy_v113',
    identityVersion: 1,
    hasFingerprint: true,
    receivedAtMode: 'default',
    hasResolvedReceivedAt: true,
  });

  const lineOrderKey = '92300000-0000-0000-0000-000000001354';
  const lineOrderItems = [
    { product_id: bridgeProduct, package_quantity: 3, units_per_package: 1,
      package_price_in_minor_units: 101, discount_in_minor_units: 0 },
    { product_id: bridgeProduct, package_quantity: 1, units_per_package: 1,
      package_price_in_minor_units: 200, discount_in_minor_units: 0 },
  ];
  const lineOrderSql = legacyDirectReceiptSql({
    warehouseId: WAREHOUSE_B, key: lineOrderKey, items: lineOrderItems,
  });
  await readJson(lineOrderSql);
  const lineOrderBaseline = await targetedState(lineOrderKey, [bridgeProduct]);
  await expectSqlFailure(legacyDirectReceiptSql({
    warehouseId: WAREHOUSE_B, key: lineOrderKey, items: [...lineOrderItems].reverse(),
  }), { sqlState: 'P0001', applicationIdentity: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(await targetedState(lineOrderKey, [bridgeProduct]), lineOrderBaseline);

  const explicitDateKey = '92300000-0000-0000-0000-000000001355';
  const explicitDateSql = legacyDirectReceiptSql({
    warehouseId: WAREHOUSE_B,
    key: explicitDateKey,
    receivedAt: '2026-09-19T00:00:00.000Z',
    items: [{ ...legacyItems[0], package_quantity: 1 }],
  });
  const explicitDateResult = await readJson(explicitDateSql);
  const explicitDateBaseline = await targetedState(explicitDateKey, [bridgeProduct]);
  assert.deepEqual(await readJson(explicitDateSql), { ...explicitDateResult, is_duplicate: true });
  assert.deepEqual(await targetedState(explicitDateKey, [bridgeProduct]), explicitDateBaseline);
  await expectSqlFailure(legacyDirectReceiptSql({
    warehouseId: WAREHOUSE_B,
    key: explicitDateKey,
    receivedAt: '2026-09-20T00:00:00.000Z',
    items: [{ ...legacyItems[0], package_quantity: 1 }],
  }), { sqlState: 'P0001', applicationIdentity: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(await targetedState(explicitDateKey, [bridgeProduct]), explicitDateBaseline);

  const concurrentLegacySameKey = '92300000-0000-0000-0000-000000001356';
  const concurrentLegacySameSql = legacyDirectReceiptSql({
    warehouseId: WAREHOUSE_B,
    key: concurrentLegacySameKey,
    items: [{ ...legacyItems[0], package_quantity: 1, package_price_in_minor_units: 177 }],
  });
  const concurrentLegacySame = await Promise.all([
    readJson(concurrentLegacySameSql), readJson(concurrentLegacySameSql),
  ]);
  assert.equal(concurrentLegacySame.filter((entry) => entry.is_duplicate === true).length, 1);
  assert.deepEqual(await readJson(`SELECT jsonb_build_object(
    'operations', (SELECT COUNT(*) FROM public.business_operations
      WHERE operation_type='supplier_receipt_legacy_v113'
        AND idempotency_key='${concurrentLegacySameKey}'),
    'receipts', (SELECT COUNT(*) FROM public.supplier_receipts
      WHERE idempotency_key='${concurrentLegacySameKey}'::UUID),
    'movements', (SELECT COUNT(*) FROM public.inventory_movements movement
      JOIN public.supplier_receipts receipt
        ON movement.reference_type='supplier_receipt' AND receipt.id=movement.reference_id
      WHERE receipt.idempotency_key='${concurrentLegacySameKey}'::UUID)
  );`), { operations: 1, receipts: 1, movements: 1 });

  const concurrentLegacyDifferentKey = '92300000-0000-0000-0000-000000001357';
  const concurrentLegacyDifferent = await Promise.allSettled([
    readJson(legacyDirectReceiptSql({ warehouseId: WAREHOUSE_B,
      key: concurrentLegacyDifferentKey,
      items: [{ ...legacyItems[0], package_quantity: 1, package_price_in_minor_units: 181 }] })),
    readJson(legacyDirectReceiptSql({ warehouseId: WAREHOUSE_B,
      key: concurrentLegacyDifferentKey,
      items: [{ ...legacyItems[0], package_quantity: 2, package_price_in_minor_units: 181 }] })),
  ]);
  assert.equal(concurrentLegacyDifferent.filter((entry) => entry.status === 'fulfilled').length, 1);
  const differentRejected = concurrentLegacyDifferent.find((entry) => entry.status === 'rejected');
  assert.ok(differentRejected);
  assertSqlFailureIdentity(differentRejected.reason.message, {
    sqlState: 'P0001', applicationIdentity: 'IDEMPOTENCY_CONFLICT',
  });
  assert.deepEqual(await readJson(`SELECT jsonb_build_object(
    'operations', (SELECT COUNT(*) FROM public.business_operations
      WHERE operation_type='supplier_receipt_legacy_v113'
        AND idempotency_key='${concurrentLegacyDifferentKey}'),
    'receipts', (SELECT COUNT(*) FROM public.supplier_receipts
      WHERE idempotency_key='${concurrentLegacyDifferentKey}'::UUID)
  );`), { operations: 1, receipts: 1 });

  const pre113Key = '92300000-0000-0000-0000-000000001358';
  const pre113ReceivedAt = '2026-09-19T00:00:00.000Z';
  const pre113Created = await readJson(`BEGIN;
    SELECT set_config('request.jwt.claims',
      ${sqlLiteral(JSON.stringify({ sub: OWNER, role: 'authenticated', aal: 'aal1' }))}, true);
    SELECT public._create_direct_supplier_receipt_impl(
      '${SUPPLIER_A}', '${WAREHOUSE_B}', '${BRANCH}', NULL, NULL,
      '${pre113ReceivedAt}'::TIMESTAMPTZ,
      0, 0, 0, 0, 'deferred', NULL, NULL, NULL, '${pre113Key}',
      ${jsonSql([{ ...legacyItems[0], package_quantity: 1 }])}
    ); COMMIT;`);
  const pre113Baseline = await targetedState(pre113Key, [bridgeProduct]);
  const pre113SequenceBaseline = await receiptSequenceState();
  const pre113ExpectedItemIds = await readJson(`SELECT COALESCE(
    jsonb_agg(item.id ORDER BY item.id), '[]'::JSONB
  ) FROM public.supplier_receipt_items item
  WHERE item.supplier_receipt_id = '${pre113Created.receipt_id}';`);
  assert.equal(pre113Baseline.receipts.length, 1);
  assert.equal(pre113Baseline.receipts[0].id, pre113Created.receipt_id);
  assert.equal(pre113Baseline.receipts[0].operation_id, null);
  assert.equal(pre113Baseline.components.length, 1);
  assert.deepEqual(pre113Baseline.components.map((item) => item.id), pre113ExpectedItemIds);
  assert.equal(pre113Baseline.components[0].supplier_receipt_id, pre113Created.receipt_id);
  assert.equal(pre113Baseline.components[0].product_id, bridgeProduct);
  await expectSqlFailure(legacyDirectReceiptSql({
    warehouseId: WAREHOUSE_B,
    key: pre113Key,
    receivedAt: pre113ReceivedAt,
    items: [{ ...legacyItems[0], package_quantity: 1 }],
  }), {
    sqlState: 'P0001', applicationIdentity: 'LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN',
  });
  assert.deepEqual(await targetedState(pre113Key, [bridgeProduct]), pre113Baseline);

  await expectSqlFailure(legacyDirectReceiptSql({
    warehouseId: WAREHOUSE_B,
    key: pre113Key,
    receivedAt: pre113ReceivedAt,
    items: [{ ...legacyItems[0], package_quantity: 99 }],
  }), {
    sqlState: 'P0001', applicationIdentity: 'LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN',
  });
  assert.deepEqual(await targetedState(pre113Key, [bridgeProduct]), pre113Baseline);

  await expectSqlFailure(legacyDirectReceiptSql({
    warehouseId: WAREHOUSE_B,
    key: pre113Key,
    receivedAt: pre113ReceivedAt,
    items: [{ ...legacyItems[0], product_id: 'not-a-uuid', package_quantity: 1 }],
  }), {
    sqlState: 'P0001', applicationIdentity: 'LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN',
  });
  assert.deepEqual(await targetedState(pre113Key, [bridgeProduct]), pre113Baseline);

  const pre113CrossActorError = await expectSqlFailure(legacyDirectReceiptSql({
    userId: WAREHOUSE_KEEPER,
    warehouseId: WAREHOUSE_B,
    key: pre113Key,
    receivedAt: pre113ReceivedAt,
    items: [{ ...legacyItems[0], package_quantity: 1 }],
  }), { sqlState: 'P0001', applicationIdentity: 'IDEMPOTENCY_CONFLICT' });
  assert.doesNotMatch(pre113CrossActorError, new RegExp(pre113Created.receipt_id, 'u'));
  assert.doesNotMatch(pre113CrossActorError, new RegExp(pre113Created.receipt_number, 'u'));
  assert.doesNotMatch(pre113CrossActorError, new RegExp(SUPPLIER_A, 'u'));
  assert.deepEqual(await targetedState(pre113Key, [bridgeProduct]), pre113Baseline);

  const pre113OwnerResolution = await readUserJson(OWNER,
    `SELECT public.resolve_legacy_supplier_receipt_replay_v1('${pre113Key}');`);
  assert.deepEqual(Object.keys(pre113OwnerResolution).sort(), [
    'found', 'receipt_id', 'receipt_number', 'received_at', 'status',
    'total_in_minor_units',
  ]);
  assert.equal(pre113OwnerResolution.found, true);
  assert.equal(pre113OwnerResolution.receipt_id, pre113Created.receipt_id);
  assert.equal(pre113OwnerResolution.receipt_number, pre113Created.receipt_number);
  assert.deepEqual(await readUserJson(WAREHOUSE_KEEPER,
    `SELECT public.resolve_legacy_supplier_receipt_replay_v1('${pre113Key}');`),
  { found: false });
  assert.deepEqual(await targetedState(pre113Key, [bridgeProduct]), pre113Baseline);
  assert.deepEqual(await receiptSequenceState(), pre113SequenceBaseline);

  const collisionBefore = await targetedState(legacyKey, [bridgeProduct]);
  await expectSqlFailure(directReceiptSql({ key: legacyKey.toUpperCase(), lines: [baseLine({
    clientLineId: '92300000-0000-0000-0000-000000001304', productId: bridgeProduct,
  })] }), { sqlState: 'P0001', applicationIdentity: 'LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN' });
  assert.deepEqual(await targetedState(legacyKey, [bridgeProduct]), collisionBefore);
  const v2UuidKey = '92300000-0000-0000-0000-000000001305';
  await readJson(directReceiptSql({ key: v2UuidKey, lines: [baseLine({
    clientLineId: '92300000-0000-0000-0000-000000001306', productId: bridgeProduct,
  })] }));
  const reverseCollisionBefore = await targetedState(v2UuidKey, [bridgeProduct]);
  await expectSqlFailure(legacySql.replaceAll(legacyKey, v2UuidKey), {
    sqlState: 'P0001', applicationIdentity: 'IDEMPOTENCY_CONFLICT',
  });
  assert.deepEqual(await targetedState(v2UuidKey, [bridgeProduct]), reverseCollisionBefore);

  const actorCollisionBefore = await targetedState(v2UuidKey, [bridgeProduct]);
  await expectSqlFailure(directReceiptSql({ userId: WAREHOUSE_KEEPER,
    key: v2UuidKey, lines: [baseLine({
      clientLineId: '92300000-0000-0000-0000-000000001306', productId: bridgeProduct,
    })],
  }), { sqlState: 'P0001', applicationIdentity: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(await targetedState(v2UuidKey, [bridgeProduct]), actorCollisionBefore);

  const traceKey = 'phase2-stable-movement-trace';
  const traceLines = [baseLine({
    clientLineId: '92300000-0000-0000-0000-000000001308', productId: bridgeProduct,
    quantity: 1, gross: 101,
  }), baseLine({
    clientLineId: '92300000-0000-0000-0000-000000001309', productId: bridgeProduct,
    quantity: 2, gross: 202,
  })];
  const traceBaseline = await targetedState(traceKey, [bridgeProduct]);
  let expectedTrace;
  for (const lines of [traceLines, [...traceLines].reverse(), traceLines]) {
    const traceSql = directReceiptSql({ key: traceKey, lines }).replace(/COMMIT;\s*$/u, `
      RESET ROLE;
      SELECT jsonb_agg(jsonb_build_object('line', l.client_line_id, 'product', m.product_id,
        'quantity', m.quantity, 'before', m.balance_before, 'after', m.balance_after)
        ORDER BY m.mutation_sequence)
      FROM public.inventory_movements m
      JOIN public.supplier_receipt_items i ON i.id = m.supplier_receipt_item_id
      JOIN public.supplier_receipt_commercial_lines l ON l.id = i.commercial_line_id
      JOIN public.business_operations o ON o.id = m.operation_id
      WHERE o.idempotency_key = '${traceKey}'; ROLLBACK;`);
    const trace = await readJson(traceSql);
    assert.deepEqual(trace.map((entry) => entry.line), traceLines.map((entry) => entry.client_line_id));
    if (expectedTrace) assert.deepEqual(trace, expectedTrace);
    else expectedTrace = trace;
    assert.deepEqual(await targetedState(traceKey, [bridgeProduct]), traceBaseline);
  }

  const laterPaymentKey = 'phase2-later-payment-receipt';
  const laterPaymentReceipt = await readJson(directReceiptSql({ key: laterPaymentKey,
    lines: [baseLine({ clientLineId: '92300000-0000-0000-0000-000000001307',
      productId: bridgeProduct })],
  }));
  const paymentBaseline = await targetedState(laterPaymentKey, [bridgeProduct]);
  for (const [index, amount] of [100, 201].entries()) {
    await readUserJson(OWNER, `SELECT public.record_supplier_receipt_payment(
      p_receipt_id := '${laterPaymentReceipt.receipt_id}',
      p_amount_in_minor_units := ${amount}, p_payment_method := 'cliq',
      p_reference_number := 'P2-LATER-${index}',
      p_idempotency_key := 'phase2-later-payment-${index}');`);
    const paymentState = await readJson(`SELECT jsonb_build_object(
      'paid', amount_paid_in_minor_units, 'originalPaid', amount_paid_at_receipt_snapshot_in_minor_units,
      'due', amount_due_in_minor_units
      ) FROM public.supplier_receipts WHERE id = '${laterPaymentReceipt.receipt_id}';`);
    assert.deepEqual(paymentState, { paid: index === 0 ? 100 : 301, originalPaid: 0, due: index === 0 ? 201 : 0 });
  }
  const laterPaidState = await targetedState(laterPaymentKey, [bridgeProduct]);
  assert.deepEqual(laterPaidState.products, paymentBaseline.products);
  assert.deepEqual(laterPaidState.balances, paymentBaseline.balances);
  assert.deepEqual(laterPaidState.movements, paymentBaseline.movements);
  assert.equal(laterPaidState.suppliers[0].current_balance_in_minor_units,
    paymentBaseline.suppliers[0].current_balance_in_minor_units - 301);
  await expectSqlFailure(userTransaction(OWNER, `SELECT public.cancel_supplier_receipt(
    '${laterPaymentReceipt.receipt_id}', 'Must fail closed after later payment');`), {
    sqlState: 'P0001', applicationIdentity: 'PHASE2_LATER_PAYMENT_CANCELLATION_UNSUPPORTED',
  });
  assert.deepEqual(await targetedState(laterPaymentKey, [bridgeProduct]), laterPaidState);

  const posSql = (suffix) => userTransaction(OWNER, `SELECT public.create_pos_sale(
    '${WAREHOUSE_A}', '${BRANCH}', NULL, NULL, 'cliq',
    ${jsonSql([{ product_id: OTHER, quantity: 1 }])}, 0, 150,
    'phase2-receipt-pos-${suffix}');`);
  const transferSql = (reverse = false) => userTransaction(OWNER, `SELECT public.transfer_inventory_between_warehouses(
    '${OTHER}', '${reverse ? WAREHOUSE_B : WAREHOUSE_A}', '${reverse ? WAREHOUSE_A : WAREHOUSE_B}', 1, 'Phase2 concurrency fixture');`);
  const concurrentReceiptSql = (suffix) => directReceiptSql({ key: `phase2-cross-inventory-${suffix}`,
    lines: [baseLine({ clientLineId: `92300000-0000-0000-0000-00000000131${suffix}`,
      quantity: 2, gross: 202 })],
  });
  await runCoordinatedPair(concurrentReceiptSql('0'), posSql('0'));
  await runCoordinatedPair(posSql('1'), concurrentReceiptSql('1'));
  await runCoordinatedPair(concurrentReceiptSql('2'), transferSql());
  await runCoordinatedPair(transferSql(true), concurrentReceiptSql('3'));

  const poRaceIds = [];
  for (const index of [0, 1]) {
    const created = await readJson(createPurchaseOrderSql({ key: `phase2-po-race-create-${index}`,
      lines: [baseLine({ clientLineId: `92300000-0000-0000-0000-00000000132${index}`,
        productId: bridgeProduct, quantity: 2, gross: 201 })],
    }));
    const item = await readJson(`UPDATE public.purchase_orders SET status = 'approved',
      approved_at = NOW(), approved_by = '${OWNER}' WHERE id = '${created.purchase_order_id}';
      SELECT jsonb_build_object('id',id) FROM public.purchase_order_items WHERE purchase_order_id = '${created.purchase_order_id}';`);
    poRaceIds.push({ order: created.purchase_order_id, item: item.id });
  }
  await runCoordinatedPair(...poRaceIds.map((identity, index) => receivePurchaseOrderSql({
    purchaseOrderId: identity.order, invoice: null, key: `phase2-po-race-receive-${index}`,
    warehouseId: index === 0 ? WAREHOUSE_A : WAREHOUSE_B,
    lines: [baseLine({ clientLineId: `92300000-0000-0000-0000-00000000133${index}`,
      productId: bridgeProduct, purchaseOrderItemId: identity.item, quantity: 2, gross: 201 })],
  })));

  const firstBalanceProduct = '92300000-0000-0000-0000-000000000106';
  await runSql(`INSERT INTO public.products (id,sku,name_ar,category_id,unit_id,
    purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,
    cost_price_in_minor_units,sale_price_in_minor_units,min_stock_level,is_active,is_flavor_master)
    SELECT '${firstBalanceProduct}', 'PHASE2-FIRST-BALANCE', 'First balance race', category_id,
    unit_id,purchase_unit_id,sale_unit_id,1,1,100,150,0,true,false FROM public.products WHERE id = '${OTHER}';`);
  assert.deepEqual(await readJson(`SELECT jsonb_build_object('rows', COUNT(*))
    FROM public.inventory_balances WHERE product_id = '${firstBalanceProduct}';`), { rows: 0 });
  await runCoordinatedPair(...[0, 1].map((index) => directReceiptSql({
    key: `phase2-first-balance-receive-${index}`,
    warehouseId: index === 0 ? WAREHOUSE_A : WAREHOUSE_B,
    lines: [baseLine({ clientLineId: `92300000-0000-0000-0000-00000000134${index}`,
      productId: firstBalanceProduct, quantity: 3, gross: index === 0 ? 301 : 600 })],
  })));
  assert.deepEqual(await readJson(`SELECT jsonb_build_object(
    'quantity', (SELECT SUM(on_hand_quantity) FROM public.inventory_balances WHERE product_id = p.id),
    'exact', wac_cost_in_minor_units_exact, 'legacy', cost_price_in_minor_units,
    'movements', (SELECT COUNT(*) FROM public.inventory_movements WHERE product_id = p.id)
    ) FROM public.products p WHERE id = '${firstBalanceProduct}';`),
  { quantity: 6, exact: 150.166667, legacy: 150, movements: 2 });
  const deadlockState = await readJson(`SELECT jsonb_build_object('deadlocks', deadlocks)
    FROM pg_stat_database WHERE datname = current_database();`);
  assert.equal(deadlockState.deadlocks, 0);

  const zeroCostResults = [];
  for (const [index, openingCost, nullExact] of [
    [0, 300, false], [1, null, false], [2, 300, true], [3, 301, false],
  ]) {
    const productId = `92300000-0000-0000-0000-00000000011${index}`;
    await createAuditSku(productId, `ZERO-${index}`);
    let openingQuantity = 0;
    let expected = 100_000_000n;
    if (openingCost !== null) {
      await readJson(directReceiptSql({ key: `phase2-zero-opening-${index}`,
        lines: [baseLine({ clientLineId: productId, productId, quantity: 3, gross: openingCost })],
      }));
      openingQuantity = 3;
      expected = expectedSequentialWac(expected, 0, 3, openingCost);
    }
    if (nullExact) {
      await runSql(`UPDATE public.products SET wac_cost_in_minor_units_exact=NULL
        WHERE id='${productId}';`);
      expected = 100_000_000n; // Explicit legacy BIGINT fallback fixture.
    }
    const po = await createLegacyCostPo(productId, `zero-${index}`);
    for (const [shape, identity] of [
      [{}, 'PHASE2_LEGACY_COST_REQUIRED'],
      [{ unit_cost_in_minor_units: null }, 'PHASE2_LEGACY_COST_REQUIRED'],
      [{ unit_cost_in_minor_units: -1 }, 'PHASE2_LEGACY_COST_INVALID'],
      [{ unit_cost_in_minor_units: 'invalid' }, 'PHASE2_LEGACY_COST_INVALID'],
    ]) {
      const baseline = await targetedState(`phase2-zero-po-negative-${index}`, [productId]);
      await expectSqlFailure(legacyPoCostSql(productId, po, shape), {
        sqlState: '22023', applicationIdentity: identity,
      });
      assert.deepEqual(await targetedState(`phase2-zero-po-negative-${index}`, [productId]), baseline);
    }
    await readJson(legacyPoCostSql(productId, po, { unit_cost_in_minor_units: 0 }));
    expected = expectedSequentialWac(expected, openingQuantity, 3, 0);
    const afterZero = await readJson(`SELECT jsonb_build_object('quantity',
      (SELECT SUM(on_hand_quantity) FROM public.inventory_balances WHERE product_id=p.id),
      'exact',wac_cost_in_minor_units_exact::TEXT,'receiptCost',
      (SELECT SUM(received_quantity * unit_cost_in_minor_units) FROM public.purchase_receipt_items
        WHERE product_id=p.id)) FROM public.products p WHERE id='${productId}';`);
    assert.deepEqual(afterZero, { quantity: openingQuantity + 3, exact: decimalWac(expected), receiptCost: 0 });
    await readJson(directReceiptSql({ key: `phase2-zero-after-v2-${index}`,
      lines: [baseLine({ clientLineId: productId, productId, quantity: 2, gross: 200 })],
    }));
    expected = expectedSequentialWac(expected, openingQuantity + 3, 2, 200);
    const final = await readJson(`SELECT jsonb_build_object('quantity',
      (SELECT SUM(on_hand_quantity) FROM public.inventory_balances WHERE product_id=p.id),
      'exact',wac_cost_in_minor_units_exact::TEXT) FROM public.products p WHERE id='${productId}';`);
    assert.deepEqual(final, { quantity: openingQuantity + 5, exact: decimalWac(expected) });
    zeroCostResults.push({ nullExact, openingCost, afterZero, final });
    await verifyInventoryHistory();
  }

  // Preserve the exact legacy input contract while proving lock selection uses
  // the same NULL/omitted -> cash interpretation as the historical writer.
  for (const [invalidKey, paymentMethod] of [
    ['92300000-0000-0000-0000-000000001413', "'CASH'"],
    ['92300000-0000-0000-0000-000000001414', "' cash '"],
    ['92300000-0000-0000-0000-000000001415', "''"],
  ]) {
    const invalidBaseline = await targetedState(invalidKey, [OTHER]);
    await expectSqlFailure(userTransaction(OWNER, `SELECT public.create_direct_supplier_receipt(
      p_supplier_id := '${SUPPLIER_A}',p_warehouse_id := '${WAREHOUSE_A}',
      p_branch_id := '${BRANCH}',p_payment_method := ${paymentMethod},
      p_amount_paid_in_minor_units := 50,p_idempotency_key := '${invalidKey}',
      p_items := ${jsonSql([{ product_id: OTHER, package_quantity: 1, units_per_package: 1,
        package_price_in_minor_units: 150, discount_in_minor_units: 0 }])});`), {
      sqlState: 'P0001', exactMessage: 'طريقة الدفع غير مدعومة.',
    });
    assert.deepEqual(await targetedState(invalidKey, [OTHER]), invalidBaseline);
  }
  const omittedPaymentKey = '92300000-0000-0000-0000-000000001416';
  const omittedPaymentReceipt = await readJson(userTransaction(OWNER,
    `SELECT public.create_direct_supplier_receipt(
      p_supplier_id := '${SUPPLIER_A}',p_warehouse_id := '${WAREHOUSE_A}',
      p_branch_id := '${BRANCH}',p_amount_paid_in_minor_units := 50,
      p_idempotency_key := '${omittedPaymentKey}',
      p_items := ${jsonSql([{ product_id: OTHER, package_quantity: 1, units_per_package: 1,
        package_price_in_minor_units: 150, discount_in_minor_units: 0 }])});`));
  assert.deepEqual(await readJson(`SELECT jsonb_build_object(
    'paymentMethod', payment_method,
    'attachedShift', cash_shift_id
  ) FROM public.supplier_payments
  WHERE supplier_receipt_id='${omittedPaymentReceipt.receipt_id}';`), {
    paymentMethod: 'cash', attachedShift: '92300000-0000-0000-0000-000000000500',
  });

  const supplierPaymentContractResults = [];
  for (const [index, label, paymentMethod, omitPaymentMethod, expectedShift] of [
    [0, 'omitted', 'cash', true, true],
    [1, 'cash', 'cash', false, true],
    [2, 'cliq', 'cliq', false, true],
    [3, 'blank', '', false, false],
    [4, 'whitespace', ' cash ', false, false],
    [5, 'uppercase', 'CASH', false, false],
    [6, 'arbitrary', 'bank_transfer', false, false],
  ]) {
    const poId = await createSupplierPaymentPo(index);
    const result = await readJson(supplierPaymentSql({
      purchaseOrderId: poId,
      key: `phase2-supplier-payment-contract-${label}`,
      amount: 25,
      paymentMethod,
      omitPaymentMethod,
      reference: `P2-CONTRACT-${label}`,
    }));
    const persisted = await readJson(`SELECT jsonb_build_object(
      'paymentMethod', payment_method,
      'attachedShift', cash_shift_id,
      'amount', amount_in_minor_units,
      'poPaid', (SELECT amount_paid_in_minor_units FROM public.purchase_orders WHERE id='${poId}')
    ) FROM public.supplier_payments WHERE id='${result.payment_id}';`);
    assert.deepEqual(persisted, {
      paymentMethod: omitPaymentMethod ? 'cash' : paymentMethod,
      attachedShift: expectedShift ? '92300000-0000-0000-0000-000000000500' : null,
      amount: 25,
      poPaid: 25,
    });
    supplierPaymentContractResults.push({ label, ...persisted });
  }

  const nullLockPo = await createSupplierPaymentPo(7);
  const nullLockBaseline = await supplierPaymentPoState(nullLockPo);
  const poGate = await createGateConnection('phase2-null-payment-po-gate',
    `SELECT id FROM public.purchase_orders WHERE id='${nullLockPo}' FOR UPDATE;`);
  await expectFailureBeforeGateRelease(poGate, readJson(
    `SET application_name='phase2-null-payment-po-attempt'; ${supplierPaymentSql({
      purchaseOrderId: nullLockPo,
      key: 'phase2-null-payment-po-lock',
      paymentMethod: null,
    })}`,
  ), { sqlState: '22004', applicationIdentity: 'SUPPLIER_PAYMENT_METHOD_REQUIRED' });
  assert.deepEqual(await supplierPaymentPoState(nullLockPo), nullLockBaseline);

  const shiftGate = await createGateConnection('phase2-null-payment-shift-gate',
    `SELECT id FROM public.cash_shifts
      WHERE id='92300000-0000-0000-0000-000000000500' FOR UPDATE;`);
  await expectFailureBeforeGateRelease(shiftGate, readJson(
    `SET application_name='phase2-null-payment-shift-attempt'; ${supplierPaymentSql({
      purchaseOrderId: nullLockPo,
      key: 'phase2-null-payment-shift-lock',
      paymentMethod: null,
    })}`,
  ), { sqlState: '22004', applicationIdentity: 'SUPPLIER_PAYMENT_METHOD_REQUIRED' });
  assert.deepEqual(await supplierPaymentPoState(nullLockPo), nullLockBaseline);

  const supplierPaymentDeadlocksBefore = await readJson(`SELECT jsonb_build_object(
    'deadlocks', deadlocks) FROM pg_stat_database WHERE datname=current_database();`);
  const supplierPaymentReversalResults = [];
  for (const [index, reversalFirst] of [[0, true], [1, false]]) {
    const poId = await createSupplierPaymentPo(20 + index);
    const initial = await readJson(supplierPaymentSql({
      purchaseOrderId: poId,
      key: `phase2-supplier-initial-payment-${index}`,
      amount: 100,
      paymentMethod: 'cliq',
      reference: `P2-INITIAL-${index}`,
    }));
    const secondPaymentSql = supplierPaymentSql({
      purchaseOrderId: poId,
      key: `phase2-supplier-concurrent-payment-${index}`,
      amount: 50,
      paymentMethod: 'cliq',
      reference: `P2-CONCURRENT-${index}`,
    });
    const reversalSql = userTransaction(OWNER, `SELECT public.reverse_supplier_payment(
      '${initial.payment_id}', 'Phase2 supplier payment lock order',
      'phase2-supplier-payment-reversal-${index}');`)
      .replace('"aal":"aal1"', '"aal":"aal2"');
    const gateLabel = `phase2-supplier-payment-gate-${index}`;
    const paymentLabel = `phase2-supplier-payment-new-${index}`;
    const reversalLabel = `phase2-supplier-payment-reversal-${index}`;
    const gate = await createGateConnection(gateLabel,
      `SELECT id FROM public.purchase_orders WHERE id='${poId}' FOR UPDATE;`);
    const capture = (promise) => promise.then(
      (value) => ({ success: true, value }),
      (error) => ({ success: false, error: error.message }),
    );
    let paymentPromise;
    let reversalPromise;
    try {
      if (reversalFirst) {
        reversalPromise = capture(readJson(`SET application_name='${reversalLabel}'; ${reversalSql}`));
        await waitForDatabaseWait(reversalLabel, gateLabel);
        paymentPromise = capture(readJson(`SET application_name='${paymentLabel}'; ${secondPaymentSql}`));
        await waitForDatabaseWait(paymentLabel, reversalLabel);
      } else {
        paymentPromise = capture(readJson(`SET application_name='${paymentLabel}'; ${secondPaymentSql}`));
        await waitForDatabaseWait(paymentLabel, gateLabel);
        reversalPromise = capture(readJson(`SET application_name='${reversalLabel}'; ${reversalSql}`));
        await waitForDatabaseWait(reversalLabel, paymentLabel);
      }
    } finally {
      await gate.release();
      await Promise.all([paymentPromise, reversalPromise].filter(Boolean));
    }
    const payment = await paymentPromise;
    let reversal = await reversalPromise;
    let safeRetryObserved = false;
    let failedAttemptZeroWrites = false;
    assert.equal(payment.success, true, payment.error);
    if (!reversal.success) {
      assert.match(
        reversal.error,
        /40001:[\s\S]*PHASE4_LOCK_PLAN_CHANGED_RETRY/u,
        'a changed frozen Supplier lock set must fail with the retryable Phase-4 identity',
      );
      const beforeRetry = await readJson(`SELECT jsonb_build_object(
        'targetReversed', payment.is_reversed,
        'reversalCount', (SELECT COUNT(*) FROM public.supplier_payment_reversals reversal
          WHERE reversal.supplier_payment_id=payment.id),
        'poPaid', po.amount_paid_in_minor_units,
        'paymentCount', (SELECT COUNT(*) FROM public.supplier_payments related
          WHERE related.purchase_order_id=po.id)
      ) FROM public.supplier_payments payment
      JOIN public.purchase_orders po ON po.id=payment.purchase_order_id
      WHERE payment.id='${initial.payment_id}';`);
      assert.deepEqual(beforeRetry, {
        targetReversed: false,
        reversalCount: 0,
        poPaid: 150,
        paymentCount: 2,
      });
      failedAttemptZeroWrites = true;
      safeRetryObserved = true;
      reversal = await capture(readJson(
        `SET application_name='${reversalLabel}-safe-retry'; ${reversalSql}`,
      ));
    }
    assert.equal(reversal.success, true, reversal.error);
    const final = await readJson(`SELECT jsonb_build_object(
      'poPaid', po.amount_paid_in_minor_units,
      'paymentCount', (SELECT COUNT(*) FROM public.supplier_payments payment
        WHERE payment.purchase_order_id=po.id),
      'activePaymentCount', (SELECT COUNT(*) FROM public.supplier_payments payment
        WHERE payment.purchase_order_id=po.id AND NOT payment.is_reversed),
      'reversedPaymentCount', (SELECT COUNT(*) FROM public.supplier_payments payment
        WHERE payment.purchase_order_id=po.id AND payment.is_reversed),
      'reversalCount', (SELECT COUNT(*) FROM public.supplier_payment_reversals reversal
        WHERE reversal.supplier_payment_id IN (
          SELECT id FROM public.supplier_payments WHERE purchase_order_id=po.id
        )),
      'allAttachedToOpenShift', (SELECT bool_and(payment.cash_shift_id =
        '92300000-0000-0000-0000-000000000500') FROM public.supplier_payments payment
        WHERE payment.purchase_order_id=po.id),
      'shiftStatus', (SELECT status FROM public.cash_shifts
        WHERE id='92300000-0000-0000-0000-000000000500')
    ) FROM public.purchase_orders po WHERE po.id='${poId}';`);
    assert.deepEqual(final, {
      poPaid: 50,
      paymentCount: 2,
      activePaymentCount: 1,
      reversedPaymentCount: 1,
      reversalCount: 1,
      allAttachedToOpenShift: true,
      shiftStatus: 'open',
    });
    supplierPaymentReversalResults.push({
      reversalFirst,
      internalWaitObserved: true,
      safeRetryObserved,
      failedAttemptZeroWrites,
      final,
    });
  }
  assert.ok(supplierPaymentReversalResults.some((entry) => entry.safeRetryObserved));
  assert.ok(supplierPaymentReversalResults.every(
    (entry) => !entry.safeRetryObserved || entry.failedAttemptZeroWrites,
  ));
  const supplierPaymentDeadlocksAfter = await readJson(`SELECT jsonb_build_object(
    'deadlocks', deadlocks) FROM pg_stat_database WHERE datname=current_database();`);
  const supplierPaymentDeadlockDelta =
    supplierPaymentDeadlocksAfter.deadlocks - supplierPaymentDeadlocksBefore.deadlocks;
  assert.equal(supplierPaymentDeadlockDelta, 0);

  const paidDeadlocksBefore = await readJson(`SELECT jsonb_build_object('deadlocks', deadlocks)
    FROM pg_stat_database WHERE datname = current_database();`);
  const paidReversalResults = [];
  for (const [index, receiptKind, reversalFirst] of [
    [0, 'direct', true], [1, 'direct', false], [2, 'po', true], [3, 'legacy', true],
    [4, 'po', false], [5, 'legacy', false], [6, 'legacy-null', true],
    [7, 'legacy-null', false],
  ]) {
    const productId = `92300000-0000-0000-0000-00000000012${index}`;
    await createAuditSku(productId, `PAID-REVERSAL-${index}`);
    await readJson(directReceiptSql({ key: `phase2-paid-reversal-opening-${index}`,
      lines: [baseLine({ clientLineId: productId, productId, quantity: 3, gross: 300 })],
    }));
    const sale = await readUserJson(OWNER, `SELECT public.create_pos_sale(
      '${WAREHOUSE_A}','${BRANCH}',NULL,NULL,'cliq',
      ${jsonSql([{ product_id: productId, quantity: 1 }])},0,150,'phase2-paid-sale-${index}');`);
    assert.ok(sale.orderId);
    const receiptKey = receiptKind.startsWith('legacy')
      ? productId
      : `phase2-paid-receipt-${index}`;
    let receiptSql;
    if (receiptKind === 'po') {
      const po = await createLegacyCostPo(productId, `paid-${index}`, 2);
      receiptSql = receivePurchaseOrderSql({ purchaseOrderId: po.poId, key: receiptKey,
        paid: 100, method: 'cliq', reference: 'P2-PAID-PO', invoice: null,
        lines: [baseLine({ clientLineId: productId, productId, quantity: 2, gross: 400,
          purchaseOrderItemId: po.itemId })],
      });
    } else if (receiptKind.startsWith('legacy')) {
      const legacyPaymentMethod = receiptKind === 'legacy-null' ? 'NULL' : "'cliq'";
      receiptSql = userTransaction(OWNER, `SELECT public.create_direct_supplier_receipt(
        p_supplier_id := '${SUPPLIER_A}',p_warehouse_id := '${WAREHOUSE_A}',
        p_branch_id := '${BRANCH}',p_payment_method := ${legacyPaymentMethod},
        p_payment_reference := 'P2-LEGACY',
        p_amount_paid_in_minor_units := 100,p_idempotency_key := '${receiptKey}',
        p_items := ${jsonSql([{ product_id: productId, package_quantity: 2, units_per_package: 1,
          package_price_in_minor_units: 200, discount_in_minor_units: 0 }])});`);
    } else {
      receiptSql = directReceiptSql({ key: receiptKey, paid: 100,
        paymentMethod: 'cliq', paymentReference: 'P2-PAID-DIRECT',
        lines: [baseLine({ clientLineId: productId, productId, quantity: 2, gross: 400 })],
      });
    }
    const reversalSql = userTransaction(OWNER, `SELECT public.reverse_pos_sale(
      '${sale.orderId}','Phase2 internal lock regression','phase2-paid-reversal-${index}');`)
      .replace('"aal":"aal1"', '"aal":"aal2"');
    const baseline = await targetedState(receiptKey, [productId]);
    const orderBefore = await originalSaleState(sale.orderId);
    const gateLabel = `phase2-internal-gate-${index}`;
    const receiptLabel = `phase2-internal-receipt-${index}`;
    const reversalLabel = `phase2-internal-reversal-${index}`;
    // Order lock pauses the ACTUAL reversal after its shift lock and before
    // inventory. Supplier lock pauses ACTUAL receiving inside its RPC instead.
    const gate = await createGateConnection(gateLabel, reversalFirst
      ? `SELECT id FROM public.orders WHERE id='${sale.orderId}' FOR UPDATE;`
      : `SELECT id FROM public.suppliers WHERE id='${SUPPLIER_A}' FOR UPDATE;`);
    const capture = (promise) => promise.then(
      (value) => ({ success: true, value }), (error) => ({ success: false, error: error.message }),
    );
    let receiptPromise; let reversalPromise;
    try {
      if (reversalFirst) {
        reversalPromise = capture(readJson(`SET application_name='${reversalLabel}'; ${reversalSql}`));
        await waitForDatabaseWait(reversalLabel, gateLabel);
        receiptPromise = capture(readJson(`SET application_name='${receiptLabel}'; ${receiptSql}`));
        await waitForDatabaseWait(receiptLabel, reversalLabel);
      } else {
        receiptPromise = capture(readJson(`SET application_name='${receiptLabel}'; ${receiptSql}`));
        await waitForDatabaseWait(receiptLabel, gateLabel);
        reversalPromise = capture(readJson(`SET application_name='${reversalLabel}'; ${reversalSql}`));
        await waitForDatabaseWait(reversalLabel, receiptLabel);
      }
    } finally {
      await gate.release();
      await Promise.all([receiptPromise, reversalPromise].filter(Boolean));
    }
    const receipt = await receiptPromise;
    const reversal = await reversalPromise;
    assert.equal(receipt.success, true, receipt.error);
    if (reversalFirst) assert.equal(reversal.success, true, reversal.error);
    else {
      assert.equal(reversal.success, false);
      assertSqlFailureIdentity(reversal.error, { sqlState: 'P0001',
        applicationIdentity: 'PHASE3_POS_REVERSAL_LATER_MOVEMENT' });
      assert.deepEqual(await originalSaleState(sale.orderId), orderBefore);
    }
    const receiptId = receipt.value.receipt_id;
    const final = await readJson(`SELECT jsonb_build_object(
      'quantity',(SELECT SUM(on_hand_quantity) FROM public.inventory_balances WHERE product_id=p.id),
      'exact',p.wac_cost_in_minor_units_exact::TEXT,'legacy',p.cost_price_in_minor_units,
      'paymentTotal',(SELECT SUM(amount_in_minor_units) FROM public.supplier_payments
        WHERE supplier_receipt_id='${receiptId}' OR purchase_receipt_id='${receiptId}'),
      'paymentCount',(SELECT COUNT(*) FROM public.supplier_payments
        WHERE supplier_receipt_id='${receiptId}' OR purchase_receipt_id='${receiptId}'),
      'attachedShift',(SELECT bool_and(cash_shift_id='92300000-0000-0000-0000-000000000500'
        AND NOT is_reversed) FROM public.supplier_payments
        WHERE supplier_receipt_id='${receiptId}' OR purchase_receipt_id='${receiptId}'),
      'paymentMethod',(SELECT payment_method FROM public.supplier_payments
        WHERE supplier_receipt_id='${receiptId}' OR purchase_receipt_id='${receiptId}'
        ORDER BY id LIMIT 1),
      'reversalCount',(SELECT COUNT(*) FROM public.pos_sale_reversals WHERE order_id='${sale.orderId}'),
      'supplierBalance',(SELECT current_balance_in_minor_units FROM public.suppliers WHERE id='${SUPPLIER_A}'),
      'shiftStatus',(SELECT status FROM public.cash_shifts WHERE id='92300000-0000-0000-0000-000000000500'),
      'orderStatus',(SELECT status FROM public.orders WHERE id='${sale.orderId}')
    ) FROM public.products p WHERE p.id='${productId}';`);
    const expected = expectedSequentialWac(100_000_000n, reversalFirst ? 3 : 2, 2, 400);
    assert.deepEqual(final, { quantity: reversalFirst ? 5 : 4, exact: decimalWac(expected),
      legacy: reversalFirst ? 140 : 150, paymentTotal: 100, paymentCount: 1, attachedShift: true,
      paymentMethod: receiptKind === 'legacy-null' ? 'cash' : 'cliq',
      reversalCount: reversalFirst ? 1 : 0,
      supplierBalance: baseline.suppliers[0].current_balance_in_minor_units + 300,
      shiftStatus: 'open', orderStatus: reversalFirst ? 'cancelled' : 'completed' });
    const stateAfter = await targetedState(receiptKey, [productId]);
    assert.deepEqual(stateAfter.shifts, baseline.shifts);
    await verifyInventoryHistory();
    paidReversalResults.push({ receiptKind, reversalFirst, internalWaitObserved: true, final });
  }
  const paidDeadlocksAfter = await readJson(`SELECT jsonb_build_object('deadlocks', deadlocks)
    FROM pg_stat_database WHERE datname = current_database();`);
  const paidDeadlockDelta = paidDeadlocksAfter.deadlocks - paidDeadlocksBefore.deadlocks;
  assert.equal(paidDeadlockDelta, 0);

  // Close through the official isolated workflow, then replay paid Direct/PO
  // requests without any open shift or feature-creation permission remaining.
  const closedReplayLines = [baseLine({ clientLineId: '92300000-0000-0000-0000-000000001410',
    quantity: 1, gross: 150 })];
  const paidClosedDirectKey = ['phase2', 'paid', 'closed', 'direct'].join('-');
  const paidClosedDirectSql = directReceiptSql({ key: paidClosedDirectKey,
    paid: 50, paymentMethod: 'cliq', paymentReference: 'P2-CLOSED-DIRECT', lines: closedReplayLines });
  const closedDirectResult = await readJson(paidClosedDirectSql);
  const closedPo = await createLegacyCostPo(OTHER, 'closed-replay', 1);
  const paidClosedPoSql = receivePurchaseOrderSql({ purchaseOrderId: closedPo.poId,
    key: 'phase2-paid-closed-po', paid: 50, method: 'cliq', reference: 'P2-CLOSED-PO', invoice: null,
    lines: [baseLine({ clientLineId: '92300000-0000-0000-0000-000000001411', quantity: 1,
      gross: 150, purchaseOrderItemId: closedPo.itemId })] });
  const closedPoResult = await readJson(paidClosedPoSql);
  const paidClosedLegacyKey = '92300000-0000-0000-0000-000000001412';
  const paidClosedLegacySql = userTransaction(OWNER, `SELECT public.create_direct_supplier_receipt(
    p_supplier_id := '${SUPPLIER_A}',p_warehouse_id := '${WAREHOUSE_A}',
    p_branch_id := '${BRANCH}',p_payment_method := NULL,
    p_payment_reference := 'P2-CLOSED-LEGACY-NULL',
    p_amount_paid_in_minor_units := 50,p_idempotency_key := '${paidClosedLegacyKey}',
    p_items := ${jsonSql([{ product_id: OTHER, package_quantity: 1, units_per_package: 1,
      package_price_in_minor_units: 150, discount_in_minor_units: 0 }])});`);
  const closedLegacyResult = await readJson(paidClosedLegacySql);
  const closedLegacyReceipt = await readJson(`SELECT jsonb_build_object(
    'paymentMethod', payment.payment_method,
    'attachedShift', payment.cash_shift_id,
    'isReversed', payment.is_reversed
  ) FROM public.supplier_receipts receipt
  JOIN public.supplier_payments payment ON payment.supplier_receipt_id = receipt.id
  WHERE receipt.id = '${closedLegacyResult.receipt_id}';`);
  assert.deepEqual(closedLegacyReceipt, {
    paymentMethod: 'cash', attachedShift: '92300000-0000-0000-0000-000000000500',
    isReversed: false,
  });
  await readUserJson(OWNER, `SELECT public.close_cash_shift(
    '92300000-0000-0000-0000-000000000500', GREATEST(0,
      (public.get_cash_shift_summary('92300000-0000-0000-0000-000000000500')
        ->>'expectedCashInMinorUnits')::BIGINT), 'Isolated runtime close');`);
  await readUserJson(OWNER, `SELECT public.set_configurable_parcel_feature_state_v1('OFF');`);
  const closedBaseline = await targetedState('phase2-paid-closed-direct', [OTHER]);
  const closedLegacyBaseline = await targetedState(paidClosedLegacyKey, [OTHER]);
  assert.equal(closedBaseline.shifts[0].status, 'closed');
  assert.deepEqual(await readJson(paidClosedDirectSql), closedDirectResult);
  assert.deepEqual(await readJson(paidClosedPoSql), closedPoResult);
  const closedLegacyReplay = await readJson(paidClosedLegacySql);
  assert.equal(closedLegacyReplay.is_duplicate, true);
  const closedLegacyReplayIdentity = { ...closedLegacyReplay };
  delete closedLegacyReplayIdentity.is_duplicate;
  assert.deepEqual(closedLegacyReplayIdentity, closedLegacyResult);
  await expectSqlFailure(paidClosedDirectSql.replace('P2-CLOSED-DIRECT', 'P2-CHANGED'), {
    sqlState: 'P0001', applicationIdentity: 'IDEMPOTENCY_CONFLICT',
  });
  await expectSqlFailure(paidClosedPoSql.replace('P2-CLOSED-PO', 'P2-CHANGED'), {
    sqlState: 'P0001', applicationIdentity: 'IDEMPOTENCY_CONFLICT',
  });
  await expectSqlFailure(paidClosedDirectSql.replace('phase2-paid-closed-direct', 'phase2-paid-no-shift-new'), {
    sqlState: 'P0001', applicationIdentity: 'PHASE2_OPEN_SHIFT_REQUIRED',
  });
  assert.deepEqual(await countBusinessState('phase2-paid-no-shift-new'), {
    operations: 0, directReceipts: 0, purchaseReceipts: 0, movements: 0, payments: 0,
  });
  assert.deepEqual(await targetedState('phase2-paid-closed-direct', [OTHER]), closedBaseline);
  assert.deepEqual(await targetedState(paidClosedLegacyKey, [OTHER]), closedLegacyBaseline);

  const { stdout: lintOutput, stderr: lintError } = await execFileAsync(
    process.execPath,
    [cliPath, 'db', 'lint', '--local', '--workdir', isolatedProjectRoot],
    {
      cwd: projectRoot,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      timeout: 120_000,
    },
  );
  const rawDbLint = (lintOutput || lintError).trim();
  const dbLint = !rawDbLint || /no schema errors found/iu.test(rawDbLint)
    ? 'PASS'
    : rawDbLint;
  if (dbLint !== 'PASS') {
    let parsedLint;
    try {
      parsedLint = JSON.parse(dbLint);
    } catch {
      assert.fail(`Unexpected DB lint output: ${dbLint}`);
    }
    const lintFindings = Array.isArray(parsedLint) ? parsedLint : [parsedLint];
    assert.ok(Array.isArray(lintFindings), 'DB lint must return structured findings');
    assert.ok(lintFindings.length > 0, `Unexpected empty DB lint payload: ${dbLint}`);
    for (const finding of lintFindings) {
      const serializedFinding = JSON.stringify(finding);
      assert.match(serializedFinding, /transfer_inventory_between_warehouses/u);
      assert.match(serializedFinding, /unused parameter.*p_transfer_date/u);
      assert.doesNotMatch(serializedFinding, /"level":"error"/iu);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    migrationRebuild: '001-113',
    schema: setup,
    directReceiving: {
      baseUnitWhileFeatureOff: true,
      parcelDecomposition: true,
      twoStageAllocation: true,
      exactWacPrecision: true,
      legacyV2MixedWacCoherent: true,
      legacyZeroCostShapesVerified: true,
      legacyPaymentInputShapesVerified: true,
      supplierPaymentContractVerified: true,
      supplierPaymentContractResults,
      supplierPaymentNullLockSafetyVerified: true,
      zeroCostResults,
      laterPartialAndFullPaymentCommitted: true,
      laterPaymentCancellationFailedClosed: true,
      overpaymentZeroWrites: true,
      explicitCostsAllOrNothing: true,
      zeroCostAndZeroBasis: true,
      repeatedSkuLinesAggregated: true,
    },
    purchaseOrderReceiving: {
      commercialAndBaseQuantities: true,
      partialThenComplete: true,
      cancellationRestoredPartialState: true,
      prepaidLegacyBalanceFailedClosed: true,
      supplierInvoiceIdentityScoped: true,
    },
    idempotency: {
      canonicalReplayZeroWrites: true,
      changedPayloadConflict: true,
      historicalReplayWhileFeatureOff: true,
      paidReplayAfterShiftClosedZeroWrites: true,
      legacyNullReplayAfterShiftClosedZeroWrites: true,
      legacyV2NamespaceCollisionZeroWrites: true,
      legacyNewOperationIdentityAtomic: true,
      legacyExactReplayZeroWrites: true,
      legacyChangedQuantityConflict: true,
      legacyChangedMoneyConflict: true,
      legacyChangedIdentityConflict: true,
      legacyLineOrderConflict: true,
      legacyExplicitBusinessDateConflict: true,
      legacyConcurrentSamePayloadSingleEffect: true,
      legacyConcurrentDifferentPayloadConflict: true,
      legacyReplayAfterLaterPaymentZeroWrites: true,
      legacyCrossActorCollisionGeneric: true,
      legacyReplayReturnsOriginalResultSnapshot: true,
      pre113FailClosedExact: true,
      pre113FailClosedChanged: true,
      pre113MalformedPayloadSameIdentity: true,
      pre113CrossActorCollisionGeneric: true,
      pre113SafeResolverVerified: true,
      pre113ZeroWritesVerified: true,
      legacyReceiptItemsSnapshotVerified: true,
      post113LegacyReceiptItemCount: legacyIdentityBaseline.components.length,
      pre113LegacyReceiptItemCount: pre113Baseline.components.length,
      concurrentSamePayloadSingleEffect: true,
      concurrentDifferentPayloadConflict: true,
    },
    concurrency: {
      sameSkuReceiptsSerialized: true,
      directAndPoCrossPathSerialized: true,
      coordinatedPairCount,
      deadlocksObserved: 0,
      receiptAndPosSerialized: true,
      receiptAndTransferSerialized: true,
      differentPoWarehousesSerialized: true,
      concurrentFirstBalancesSerialized: true,
      inventoryMovementReconciled: true,
      paidReceiptAndPosReversalInternalSerialization: true,
      paidDeadlockDelta,
      paidReversalResults,
      supplierPaymentAndReversalInternalSerialization: true,
      supplierPaymentDeadlocksBefore: supplierPaymentDeadlocksBefore.deadlocks,
      supplierPaymentDeadlocksAfter: supplierPaymentDeadlocksAfter.deadlocks,
      supplierPaymentDeadlockDelta,
      supplierPaymentReversalResults,
    },
    immutability: {
      finalizedFinancialSnapshotRejected: true,
      failedMutationPreservedTimestamp: true,
    },
    phase2Closure: {
      independentNewOperationFixesLocallyVerified: true,
      ownerPolicyImplemented: true,
      phase2Closed: true,
      finalVerdict: 'PHASE 2 = READY TO CLOSE',
    },
    dbLint,
  }, null, 2));
} finally {
  if (isolatedProjectRoot) {
    await execFileAsync(
      process.execPath,
      [cliPath, 'stop', '--no-backup', '--workdir', isolatedProjectRoot],
      {
        cwd: projectRoot,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        timeout: 120_000,
      },
    );
  }
}
