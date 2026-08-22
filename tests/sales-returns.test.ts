import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/043_sales_returns_and_refunds.sql',
    import.meta.url
  ),
  'utf8'
);
const orderService = readFileSync(
  new URL('../src/services/supabase/orders.service.ts', import.meta.url),
  'utf8'
);
const orderDetail = readFileSync(
  new URL('../src/features/orders/OrderDetailModal.tsx', import.meta.url),
  'utf8'
);
const shiftView = readFileSync(
  new URL('../src/features/shifts/ShiftsView.tsx', import.meta.url),
  'utf8'
);
const tracking = readFileSync(
  new URL(
    '../customer-web/src/components/OrderTrackingModal.tsx',
    import.meta.url
  ),
  'utf8'
);

test('sales returns are immutable full-order records written only by RPC', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.sales_returns/);
  assert.match(migration, /order_id UUID UNIQUE NOT NULL/);
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.sales_returns[\s\S]*FROM PUBLIC, anon, authenticated/
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.return_completed_website_order/
  );
  assert.match(migration, /ARRAY\['owner', 'admin', 'manager'\]/);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.return_completed_website_order[\s\S]*TO authenticated/
  );
});

test('return requires a completed paid website order and an open shift', () => {
  assert.match(migration, /v_order\.source = 'pos'/);
  assert.match(migration, /v_order\.status <> 'completed'/);
  assert.match(migration, /v_order\.payment_status <> 'paid'/);
  assert.match(migration, /status = 'open'[\s\S]*FOR SHARE/);
  assert.match(
    migration,
    /p_refund_method = 'cliq'[\s\S]*p_reference_number/
  );
});

test('saleable goods restock atomically while damaged goods do not', () => {
  assert.match(
    migration,
    /IF p_stock_disposition = 'restock' THEN[\s\S]*UPDATE public\.inventory_balances/
  );
  assert.match(migration, /'return_in'/);
  assert.match(migration, /reference_type[\s\S]*'sales_return'/);
  assert.match(migration, /stock_disposition IN \('restock', 'damaged'\)/);
});

test('cash refunds reduce drawer expectation and are snapshotted on close', () => {
  assert.match(
    migration,
    /v_expected_cash :=[\s\S]*- v_cash_refunds/
  );
  assert.match(
    migration,
    /cash_refunds_in_minor_units = \(v_summary->>'cashRefundsInMinorUnits'\)::BIGINT/
  );
  assert.match(shiftView, /مبالغ مرتجعات كاش/);
  assert.match(shiftView, /currentShift\.cliqRefunds/);
});

test('admin return UI uses the guarded RPC and exposes stock disposition', () => {
  assert.match(orderService, /\.rpc\(\s*'return_completed_website_order'/);
  assert.match(orderDetail, /تسجيل مرتجع كامل ورد المبلغ/);
  assert.match(orderDetail, /سليمة — تعود للمخزون/);
  assert.match(orderDetail, /تالفة — لا تعود للمخزون/);
  assert.match(orderDetail, /اعتماد المرتجع ورد المبلغ/);
});

test('customer tracking explains a returned order', () => {
  assert.match(tracking, /returned: 'تم إرجاع الطلب ورد المبلغ'/);
});
