import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/047_inventory_opening_setup.sql',
    import.meta.url
  ),
  'utf8'
);
const service = readFileSync(
  new URL(
    '../src/services/supabase/inventory-opening.service.ts',
    import.meta.url
  ),
  'utf8'
);
const modal = readFileSync(
  new URL(
    '../src/features/inventory/InventoryOpeningSetupModal.tsx',
    import.meta.url
  ),
  'utf8'
);
const inventoryView = readFileSync(
  new URL('../src/features/inventory/InventoryView.tsx', import.meta.url),
  'utf8'
);
const allModals = readFileSync(
  new URL('../src/components/modals/AllModals.tsx', import.meta.url),
  'utf8'
);

test('opening setup persists immutable sessions and items behind RPC-only access', () => {
  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS public\.inventory_opening_sessions/
  );
  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS public\.inventory_opening_items/
  );
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/g);
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.inventory_opening_sessions[\s\S]*authenticated/
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.apply_inventory_opening_setup/
  );
});

test('opening setup is role guarded, idempotent and all-or-nothing', () => {
  assert.match(
    migration,
    /ARRAY\['owner', 'admin', 'manager', 'warehouse_keeper'\]/
  );
  assert.match(migration, /idempotency_key TEXT UNIQUE NOT NULL/);
  assert.match(
    migration,
    /WHERE idempotency_key = TRIM\(p_idempotency_key\)/
  );
  assert.match(migration, /'idempotentReplay', true/);
  assert.doesNotMatch(migration, /EXCEPTION[\s\S]*COMMIT|COMMIT[\s\S]*EXCEPTION/);
});

test('package and loose-unit counts are converted to one base-unit target', () => {
  assert.match(
    migration,
    /v_package_count::BIGINT \* v_units_per_package \+ v_loose_units/
  );
  assert.match(migration, /v_loose_units >= v_units_per_package/);
  assert.match(modal, /packages \* product\.unitsPerPackage \+ loose/);
  assert.match(modal, /الحبات المتبقية/);
});

test('opening setup cannot bypass live operations, reservations or product cost', () => {
  for (const movementType of [
    'purchase_receipt',
    'sales_deduction',
    'transfer_in',
    'transfer_out',
    'return_in',
    'return_out',
  ]) {
    assert.match(migration, new RegExp(`'${movementType}'`));
  }
  assert.match(migration, /v_reserved_quantity > 0/);
  assert.match(migration, /cost_price_in_minor_units <= 0/);
  assert.match(migration, /استخدم الجرد الموثق بدلاً من الرصيد الافتتاحي/);
});

test('opening stock creates audited movements without supplier accounting', () => {
  assert.match(migration, /'opening_balance'/);
  assert.match(migration, /'inventory_opening_session'/);
  assert.match(migration, /'APPLY_INVENTORY_OPENING_SETUP'/);
  const applyFunction =
    migration.match(
      /CREATE OR REPLACE FUNCTION public\.apply_inventory_opening_setup[\s\S]*?END;\n\$\$;/
    )?.[0] || '';
  assert.doesNotMatch(
    applyFunction,
    /supplier_receipts|supplier_payments|purchase_orders/
  );
});

test('frontend imports an Excel-compatible template and writes only through RPC', () => {
  assert.match(service, /\.rpc\(\s*'get_inventory_opening_setup'/);
  assert.match(service, /\.rpc\(\s*'apply_inventory_opening_setup'/);
  assert.doesNotMatch(service, /\.from\(/);
  assert.match(modal, /تنزيل قالب Excel/);
  assert.match(modal, /accept="\.csv,\.tsv,text\/csv/);
  assert.match(modal, /مراجعة واعتماد المخزون الافتتاحي/);
  assert.match(inventoryView, /openModal\('inventory_opening_setup'\)/);
  assert.match(allModals, /InventoryOpeningSetupModal/);
});
