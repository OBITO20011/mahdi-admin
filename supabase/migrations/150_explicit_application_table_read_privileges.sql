-- Owner-approved 2026-10-15: the named proposal in TABLE_ACCESS_INVENTORY.md.
-- 25 authenticated table reads + one service_role read; no browser writes.
-- Independent of reserved migrations140-149; safe after138 or139, and replayable.
BEGIN;

GRANT SELECT ON TABLE public.branches TO authenticated;
GRANT SELECT ON TABLE public.brands TO authenticated;
GRANT SELECT ON TABLE public.categories TO authenticated;
GRANT SELECT ON TABLE public.customer_addresses TO authenticated;
GRANT SELECT ON TABLE public.customers TO authenticated;
GRANT SELECT ON TABLE public.inventory_balances TO authenticated;
GRANT SELECT ON TABLE public.inventory_movements TO authenticated;
GRANT SELECT ON TABLE public.order_items TO authenticated;
GRANT SELECT ON TABLE public.order_status_history TO authenticated;
GRANT SELECT ON TABLE public.orders TO authenticated;
GRANT SELECT ON TABLE public.product_images TO authenticated;
GRANT SELECT ON TABLE public.products TO authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT SELECT ON TABLE public.purchase_order_items TO authenticated;
GRANT SELECT ON TABLE public.purchase_orders TO authenticated;
GRANT SELECT ON TABLE public.purchase_receipt_items TO authenticated;
GRANT SELECT ON TABLE public.purchase_receipts TO authenticated;
GRANT SELECT ON TABLE public.roles TO authenticated;
GRANT SELECT ON TABLE public.supplier_payments TO authenticated;
GRANT SELECT ON TABLE public.supplier_receipt_items TO authenticated;
GRANT SELECT ON TABLE public.supplier_receipts TO authenticated;
GRANT SELECT ON TABLE public.suppliers TO authenticated;
GRANT SELECT ON TABLE public.units TO authenticated;
GRANT SELECT ON TABLE public.user_roles TO authenticated;
GRANT SELECT ON TABLE public.warehouses TO authenticated;
GRANT SELECT ON TABLE public.orders TO service_role;

-- Exactly25tables x2roles x4unneeded privileges =200 approved revocations.
-- No ALL/CASCADE, EXECUTE, sequence, column or existing parcel/return changes.
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.branches,
  public.brands,
  public.categories,
  public.customer_addresses,
  public.customers,
  public.inventory_balances,
  public.inventory_movements,
  public.order_items,
  public.order_status_history,
  public.orders,
  public.product_images,
  public.products,
  public.profiles,
  public.purchase_order_items,
  public.purchase_orders,
  public.purchase_receipt_items,
  public.purchase_receipts,
  public.roles,
  public.supplier_payments,
  public.supplier_receipt_items,
  public.supplier_receipts,
  public.suppliers,
  public.units,
  public.user_roles,
  public.warehouses
FROM anon, authenticated;

-- Only TABLE defaults for objects subsequently created by postgres in public.
-- Never auto-grant a client role any privilege on a future business table.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;

COMMIT;
