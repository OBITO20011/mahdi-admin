import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/104_remove_unused_receive_purchase_order_product_id.sql',
  'utf8',
);

test('receiving lint cleanup preserves the private RPC contract and security boundary', () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\._receive_purchase_order_impl\(\s*p_purchase_order_id UUID,\s*p_warehouse_id UUID DEFAULT NULL,\s*p_supplier_delivery_note TEXT DEFAULT NULL,\s*p_notes TEXT DEFAULT NULL,\s*p_items JSONB DEFAULT '\[\]'::jsonb\s*\)/,
  );
  assert.match(migration, /RETURNS JSONB\s*LANGUAGE plpgsql\s*SECURITY DEFINER/);
  assert.match(migration, /SET search_path = public, pg_temp/);
});

test('dead local is removed while malformed payload UUID validation remains explicit', () => {
  assert.doesNotMatch(migration, /v_product_id\s+UUID/);
  assert.doesNotMatch(migration, /v_product_id\s*:=/);
  assert.match(migration, /PERFORM \(v_item->>'product_id'\)::UUID/);
});

test('locked purchase-order item remains the only authoritative product source', () => {
  assert.match(migration, /WHERE id = v_po_item_id AND purchase_order_id = p_purchase_order_id\s*FOR UPDATE/);
  for (const requiredUse of [
    /v_receipt_id,\s*v_po_item_id,\s*v_po_item\.product_id/,
    /WHERE warehouse_id = v_target_warehouse_id AND product_id = v_po_item\.product_id/,
    /WHERE product_id = v_po_item\.product_id/,
  ]) {
    assert.match(migration, requiredUse);
  }
});

test('warehouse transfer compatibility contract is outside this migration', () => {
  assert.doesNotMatch(migration, /transfer_inventory_between_warehouses/);
  assert.doesNotMatch(migration, /p_transfer_date/);
});
