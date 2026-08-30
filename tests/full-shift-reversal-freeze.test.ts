import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const primitives = readFileSync(
  new URL('../supabase/migrations/083_shift_reversal_primitives.sql', import.meta.url),
  'utf8'
);
const orchestrator = readFileSync(
  new URL('../supabase/migrations/084_full_cash_shift_reversal.sql', import.meta.url),
  'utf8'
);
const shiftsView = readFileSync(
  new URL('../src/features/shifts/ShiftsView.tsx', import.meta.url),
  'utf8'
);

test('full shift reversal V1 is frozen to the four proven operation types', () => {
  assert.match(
    orchestrator,
    /operation_type IN \('pos_sale', 'customer_payment', 'supplier_payment', 'operational_expense'\)/
  );
  assert.doesNotMatch(
    orchestrator,
    /reverse_(?:supplier_receipt|sales_return|inventory|warehouse_transfer)/
  );
  assert.match(orchestrator, /unsupported_sales_return[\s\S]*'BLOCKED'/);
  assert.match(orchestrator, /لا تُنسب حركات المخزون أو الاستلام غير المرتبطة/);
});

test('preview freezes every known unsafe or previously reversed dependency', () => {
  assert.match(orchestrator, /o\.source IS DISTINCT FROM 'pos' THEN 'BLOCKED'/);
  assert.match(orchestrator, /EXISTS \(SELECT 1 FROM public\.sales_returns sr WHERE sr\.order_id = o\.id\) THEN 'BLOCKED'/);
  assert.match(orchestrator, /im\.created_at >= o\.created_at[\s\S]*THEN 'BLOCKED'/);
  assert.match(orchestrator, /ib\.reserved_quantity <> 0[\s\S]*THEN 'BLOCKED'/);
  assert.match(orchestrator, /psr\.id IS NOT NULL THEN 'BLOCKED'/);
  assert.match(orchestrator, /cp\.is_reversed THEN 'BLOCKED'/);
  assert.match(orchestrator, /sp\.is_reversed THEN 'BLOCKED'/);
  assert.match(orchestrator, /oe\.is_reversed THEN 'BLOCKED'/);
});

test('standalone primitives and orchestrator share one canonical advisory lock order', () => {
  for (const operationLock of ['pos-sale-reversal:', 'supplier-payment-reversal:']) {
    const operationIndex = primitives.indexOf(operationLock);
    const shiftIndex = primitives.lastIndexOf('cash-shift-full-reversal:', operationIndex);
    assert.ok(shiftIndex >= 0, `missing shift advisory lock before ${operationLock}`);
    assert.ok(shiftIndex < operationIndex, `operation advisory precedes shift advisory for ${operationLock}`);
  }
  assert.ok(
    orchestrator.indexOf('cash-shift-full-reversal:') < orchestrator.indexOf('FROM public.cash_shifts WHERE id=p_shift_id FOR UPDATE')
  );
});

test('migration 083 normalizes line endings without weakening its report contract guard', () => {
  assert.match(primitives, /REPLACE\(\s*REPLACE\(v_definition, E'\\r\\n', E'\\n'\),\s*E'\\r',\s*E'\\n'\s*\)/);
  assert.match(primitives, /POSITION\(v_core_original IN v_normalized_definition\) = 0/);
  assert.match(primitives, /POSITION\(v_discount_original IN v_normalized_definition\) = 0/);
  assert.match(primitives, /EXECUTE REPLACE\(v_normalized_definition, v_core_original, v_core_replacement\)/);
  assert.match(primitives, /EXECUTE REPLACE\(v_normalized_definition, v_discount_original, v_discount_replacement\)/);
});

test('orchestrator validates the complete preview before writing a reversal header', () => {
  const previewIndex = orchestrator.indexOf('v_preview := public._preview_cash_shift_full_reversal');
  const blockerIndex = orchestrator.indexOf("v_preview->>'canExecute'", previewIndex);
  const insertIndex = orchestrator.indexOf('INSERT INTO public.cash_shift_reversals', previewIndex);
  assert.ok(previewIndex >= 0 && blockerIndex > previewIndex && insertIndex > blockerIndex);
  assert.doesNotMatch(orchestrator, /DELETE FROM public\.(?:orders|customer_payments|supplier_payments|operational_expenses|cash_shifts)/i);
  assert.match(orchestrator, /'REVERSE_CASH_SHIFT_WITH_OPERATIONS'/);
});

test('owner UI shows the complete preview and cannot confirm a blocked shift', () => {
  for (const effectKey of [
    'cash_in_minor_units',
    'cliq_in_minor_units',
    'customer_balance_in_minor_units',
    'supplier_balance_in_minor_units',
    'inventory_base_units_delta',
    'sales_in_minor_units',
    'discount_in_minor_units',
    'cogs_in_minor_units',
    'profit_in_minor_units',
  ]) {
    assert.match(shiftsView, new RegExp(effectKey));
  }
  assert.match(shiftsView, /!fullReversalPreview\?\.canExecute/);
  assert.match(shiftsView, /fullReversalPreview\.canExecute \?/);
  assert.match(shiftsView, /المرجع: \{operation\.originalRecordId\}/);
});
