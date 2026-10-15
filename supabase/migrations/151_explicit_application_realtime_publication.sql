-- Owner-approved2026-10-15: only the thirteen tables subscribed by the app.
-- Publication membership is not a grant and does not bypass existing RLS.
BEGIN;

DO $publication_members$
DECLARE
  v_table TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE EXCEPTION 'APPLICATION_REALTIME_PUBLICATION_MISSING';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime' AND puballtables) THEN
    RAISE EXCEPTION 'APPLICATION_REALTIME_EXPLICIT_TABLES_REQUIRED';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'customer_addresses', 'customers', 'inventory_balances', 'inventory_movements',
    'orders', 'products', 'purchase_order_items', 'purchase_orders', 'purchase_receipts',
    'supplier_payments', 'supplier_receipt_items', 'supplier_receipts', 'suppliers'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END;
$publication_members$;

COMMIT;
