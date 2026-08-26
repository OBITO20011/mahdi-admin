-- =========================================================================
-- Nawasrah ERP - Migration 073
-- Keep the operational admin home responsive as order history grows.
-- =========================================================================

-- get_home_dashboard repeatedly resolves the first completed transition for
-- an order. The original schema had no index beginning with order_id.
CREATE INDEX IF NOT EXISTS idx_order_status_history_order_status_created
  ON public.order_status_history (order_id, new_status, created_at);

-- The home and product catalog aggregate stock by product across warehouses.
-- The original warehouse-first index cannot efficiently serve this lookup.
CREATE INDEX IF NOT EXISTS idx_inventory_balances_product
  ON public.inventory_balances (product_id);

-- Operational status cards and recent completed-order totals filter by status
-- and then use the business timestamp. Keep both operations index-friendly.
CREATE INDEX IF NOT EXISTS idx_orders_status_created
  ON public.orders (status, created_at DESC);

