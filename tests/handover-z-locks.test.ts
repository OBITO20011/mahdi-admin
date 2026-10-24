import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

test('Z5 changes only lock discovery/order/revalidation; reversal financial body is byte identical to213', () => {
  const sql = readFileSync('supabase/migrations/214_handover_z_corrections.sql', 'utf8').replaceAll('\r\n', '\n');
  const current = sql.match(/CREATE OR REPLACE FUNCTION public\.reverse_customer_collection_v1\([\s\S]+?AS \$function\$[\s\S]+?\$function\$/)?.[0];
  assert.ok(current);
  const before = JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_213.json', 'utf8')).catalog.functions
    .find((f: {schema: string; identity: string}) => f.schema === 'public' && f.identity.startsWith('reverse_customer_collection_v1(')).definition;
  const restored = current.replace('  v_customer_id UUID;\n  v_id UUID;\n  v_plan JSONB;\n  v_locked_plan JSONB;\n', '')
    .replace(/  -- Same hierarchy as collect_customer_balance_v1:[\s\S]+?(?=  IF v_operation.cash_shift_id IS NOT NULL)/, '')
    .replace('WHERE id = p_operation_id;', 'WHERE id = p_operation_id FOR UPDATE;');
  assert.equal(restored.trim(), before.replaceAll('\r\n', '\n').trim());
  assert.match(current, /ORDER BY shift_id/);
  assert.match(current, /ORDER BY o\.id FOR UPDATE/);
  assert.match(current, /v_locked_plan IS DISTINCT FROM v_plan/);
});
