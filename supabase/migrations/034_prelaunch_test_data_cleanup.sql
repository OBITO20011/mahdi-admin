-- =========================================================================
-- Nawasrah ERP - Pre-launch test data cleanup
-- Removes the development transactions as one consistent data set while
-- preserving authentication, ERP roles, reference data, locations and the
-- real iPhone Web Push subscription.
-- =========================================================================

BEGIN;

DO $$
DECLARE
  v_cleanup_summary JSONB;
BEGIN
  v_cleanup_summary := jsonb_build_object(
    'orders', (SELECT count(*) FROM public.orders),
    'customers', (SELECT count(*) FROM public.customers),
    'products', (SELECT count(*) FROM public.products),
    'suppliers', (SELECT count(*) FROM public.suppliers),
    'supplier_receipts', (SELECT count(*) FROM public.supplier_receipts),
    'purchase_orders', (SELECT count(*) FROM public.purchase_orders),
    'purchase_receipts', (SELECT count(*) FROM public.purchase_receipts),
    'inventory_movements', (SELECT count(*) FROM public.inventory_movements),
    'push_dispatches', (SELECT count(*) FROM public.push_dispatches),
    'previous_audit_logs', (SELECT count(*) FROM public.audit_logs),
    'preserved_push_subscriptions', (
      SELECT count(*) FROM public.push_subscriptions WHERE is_active = true
    )
  );

  TRUNCATE TABLE
    public.promotion_redemptions,
    public.promotion_codes,
    public.customer_payments,
    public.order_items,
    public.order_status_history,
    public.orders,
    public.customer_addresses,
    public.customers,
    public.product_images,
    public.supplier_payments,
    public.supplier_receipt_items,
    public.supplier_receipts,
    public.purchase_receipt_items,
    public.purchase_receipts,
    public.purchase_order_items,
    public.purchase_orders,
    public.inventory_movements,
    public.inventory_balances,
    public.stock_alert_reads,
    public.stock_alerts,
    public.products,
    public.suppliers,
    public.push_dispatches,
    public.audit_logs
  RESTART IDENTITY;

  PERFORM setval('public.customer_payment_number_seq'::regclass, 1001, false);
  PERFORM setval('public.pos_sale_number_seq'::regclass, 1, false);
  PERFORM setval('public.supplier_receipt_seq'::regclass, 1001, false);

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  )
  VALUES (
    NULL,
    'PRELAUNCH_TEST_DATA_CLEANUP',
    'system',
    NULL,
    v_cleanup_summary || jsonb_build_object('cleaned_at', now())
  );
END;
$$;

COMMIT;
