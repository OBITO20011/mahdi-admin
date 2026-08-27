-- =========================================================================
-- Nawasrah ERP - Admin product listing read model
-- Keeps the authenticated administration catalog to one protected read while
-- preserving inventory as the database source of truth.
-- =========================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_inventory_balances_product_warehouse_lookup
  ON public.inventory_balances (product_id, warehouse_id)
  INCLUDE (on_hand_quantity, reserved_quantity, available_quantity);

CREATE INDEX IF NOT EXISTS idx_product_images_primary_listing
  ON public.product_images (product_id, display_order, created_at)
  INCLUDE (image_url)
  WHERE is_primary = true;

CREATE OR REPLACE FUNCTION public.get_admin_product_listing()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY[
      'owner', 'admin', 'manager', 'accountant', 'cashier', 'sales',
      'warehouse_keeper', 'orders', 'delivery_driver', 'view_only'
    ],
    'عرض قائمة المنتجات الإدارية'
  );

  RETURN (
    WITH listing AS (
      SELECT
        p.id,
        p.sku,
        p.barcode,
        p.name_ar,
        p.description,
        p.category_id,
        p.brand_id,
        p.unit_id,
        p.purchase_unit_id,
        p.units_per_purchase_unit,
        p.default_purchase_price_in_minor_units,
        p.sale_unit_id,
        p.units_per_sale_unit,
        p.default_sale_price_in_minor_units,
        p.cost_price_in_minor_units,
        p.sale_price_in_minor_units,
        p.wholesale_price_in_minor_units,
        p.min_stock_level,
        p.max_stock_level,
        p.is_active,
        p.flavor_master_product_id,
        p.flavor_name_ar,
        p.is_flavor_master,
        p.flavor_sort_order,
        p.created_at,
        p.updated_at,
        jsonb_build_object(
          'id', base_unit.id,
          'name_ar', base_unit.name_ar,
          'code', base_unit.code
        ) AS base_unit,
        jsonb_build_object(
          'id', purchase_unit.id,
          'name_ar', purchase_unit.name_ar,
          'code', purchase_unit.code
        ) AS purchase_unit,
        jsonb_build_object(
          'id', sale_unit.id,
          'name_ar', sale_unit.name_ar,
          'code', sale_unit.code
        ) AS sale_unit,
        COALESCE(stock.on_hand_quantity, 0)::INTEGER AS on_hand_quantity,
        COALESCE(stock.reserved_quantity, 0)::INTEGER AS reserved_quantity,
        COALESCE(stock.available_quantity, 0)::INTEGER AS available_quantity,
        stock.warehouse_id,
        COALESCE(stock.warehouse_balances, '[]'::JSONB) AS warehouse_balances,
        image.image_url
      FROM public.products p
      LEFT JOIN public.units base_unit ON base_unit.id = p.unit_id
      LEFT JOIN public.units purchase_unit ON purchase_unit.id = p.purchase_unit_id
      LEFT JOIN public.units sale_unit ON sale_unit.id = p.sale_unit_id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(ib.on_hand_quantity), 0)::INTEGER AS on_hand_quantity,
          COALESCE(SUM(ib.reserved_quantity), 0)::INTEGER AS reserved_quantity,
          COALESCE(SUM(ib.available_quantity), 0)::INTEGER AS available_quantity,
          CASE
            WHEN COUNT(ib.warehouse_id) = 1
              THEN MIN(ib.warehouse_id::TEXT)::UUID
            ELSE NULL
          END AS warehouse_id,
          COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'warehouse_id', ib.warehouse_id,
                'on_hand_quantity', ib.on_hand_quantity,
                'reserved_quantity', ib.reserved_quantity,
                'available_quantity', ib.available_quantity
              )
              ORDER BY ib.warehouse_id
            ) FILTER (WHERE ib.product_id IS NOT NULL),
            '[]'::JSONB
          ) AS warehouse_balances
        FROM public.inventory_balances ib
        WHERE ib.product_id = p.id
      ) stock ON true
      LEFT JOIN LATERAL (
        SELECT pi.image_url
        FROM public.product_images pi
        WHERE pi.product_id = p.id
          AND pi.is_primary = true
        ORDER BY pi.display_order, pi.created_at
        LIMIT 1
      ) image ON true
    )
    SELECT COALESCE(
      jsonb_agg(to_jsonb(listing) ORDER BY listing.created_at DESC, listing.id DESC),
      '[]'::JSONB
    )
    FROM listing
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_product_listing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_product_listing() TO authenticated;

COMMIT;
