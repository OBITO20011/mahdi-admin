-- Owner-approved 2026-10-09. Read extensions only; no writer, role, ACL or policy change.
-- Same public signatures and existing grants. CREATE OR REPLACE preserves ACLs.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_pos_customer_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_search TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_page INTEGER := COALESCE(p_page, 1);
  v_page_size INTEGER := COALESCE(p_page_size, 25);
  v_search TEXT := NULLIF(BTRIM(p_search), '');
  v_offset INTEGER;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY[
      'owner', 'admin', 'manager', 'cashier', 'sales', 'view_only'
    ],
    'البحث في عملاء نقطة البيع'
  );
  IF v_page < 1 OR v_page > 100000 THEN RAISE EXCEPTION 'رقم صفحة العملاء غير صالح.'; END IF;
  IF v_page_size < 1 OR v_page_size > 100 THEN RAISE EXCEPTION 'حجم صفحة العملاء يجب أن يكون بين 1 و100.'; END IF;
  IF v_search IS NOT NULL AND CHAR_LENGTH(v_search) > 100 THEN RAISE EXCEPTION 'عبارة بحث العميل طويلة جدًا.'; END IF;
  v_offset := (v_page - 1) * v_page_size;

  RETURN (
    WITH filtered_customers AS (
      SELECT c.id, c.full_name, c.phone, c.credit_limit_in_minor_units
      FROM public.customers c
      WHERE c.is_active = true
        AND c.is_blocked = false
        AND c.is_deleted = false
        AND (
          v_search IS NULL
          OR LOWER(c.full_name) LIKE LOWER(v_search) || '%'
          OR COALESCE(c.phone, '') LIKE v_search || '%'
          OR c.id::TEXT = LOWER(v_search)
        )
    ),
    paged_customers AS (
      SELECT *
      FROM filtered_customers
      ORDER BY LOWER(full_name), id
      OFFSET v_offset
      LIMIT v_page_size
    )
    SELECT jsonb_build_object(
      'customers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', pc.id,
          'full_name', pc.full_name,
          'phone', pc.phone,
          'current_balance_in_minor_units', public.phase42_customer_receivable_total_internal(pc.id),
          'credit_limit_in_minor_units', pc.credit_limit_in_minor_units
        ) ORDER BY LOWER(pc.full_name), pc.id)
        FROM paged_customers pc
      ), '[]'::JSONB),
      'page', v_page,
      'page_size', v_page_size,
      'total_count', (SELECT COUNT(*)::INTEGER FROM filtered_customers),
      'has_more', (v_offset + v_page_size) < (SELECT COUNT(*) FROM filtered_customers)
    )
  );
END;
$$;

ALTER FUNCTION public.get_pos_customer_page(INTEGER, INTEGER, TEXT) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.get_admin_inventory_product_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 24,
  p_search TEXT DEFAULT NULL,
  p_branch_id UUID DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT 'all'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_page INTEGER := COALESCE(p_page, 1);
  v_page_size INTEGER := COALESCE(p_page_size, 24);
  v_search TEXT := NULLIF(BTRIM(p_search), '');
  v_status TEXT := COALESCE(NULLIF(BTRIM(p_status), ''), 'all');
  v_offset INTEGER;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY[
      'owner', 'admin', 'manager', 'accountant', 'cashier', 'sales',
      'warehouse_keeper', 'orders', 'delivery_driver', 'view_only'
    ],
    'عرض صفحة المخزون الإداري'
  );

  IF v_page < 1 OR v_page > 100000 THEN
    RAISE EXCEPTION 'رقم الصفحة غير صالح.';
  END IF;
  IF v_page_size < 1 OR v_page_size > 100 THEN
    RAISE EXCEPTION 'حجم الصفحة يجب أن يكون بين 1 و100.';
  END IF;
  IF v_search IS NOT NULL AND CHAR_LENGTH(v_search) > 100 THEN
    RAISE EXCEPTION 'عبارة البحث طويلة جدًا.';
  END IF;
  IF v_status NOT IN ('all', 'available', 'low_stock', 'out_of_stock', 'near_expiry', 'damaged', 'stagnant') THEN
    RAISE EXCEPTION 'فلتر حالة المخزون غير صالح.';
  END IF;

  v_offset := (v_page - 1) * v_page_size;

  RETURN (
    WITH stock_by_product AS MATERIALIZED (
      SELECT
        product.id AS product_id,
        COALESCE(SUM(ib.on_hand_quantity) FILTER (
          WHERE (p_warehouse_id IS NULL OR ib.warehouse_id = p_warehouse_id)
            AND (p_branch_id IS NULL OR warehouse.branch_id = p_branch_id)
        ), 0)::INTEGER AS on_hand_quantity,
        COALESCE(SUM(ib.reserved_quantity) FILTER (
          WHERE (p_warehouse_id IS NULL OR ib.warehouse_id = p_warehouse_id)
            AND (p_branch_id IS NULL OR warehouse.branch_id = p_branch_id)
        ), 0)::INTEGER AS reserved_quantity,
        COALESCE(SUM(ib.available_quantity) FILTER (
          WHERE (p_warehouse_id IS NULL OR ib.warehouse_id = p_warehouse_id)
            AND (p_branch_id IS NULL OR warehouse.branch_id = p_branch_id)
        ), 0)::INTEGER AS available_quantity,
        CASE WHEN p_warehouse_id IS NOT NULL THEN p_warehouse_id
          WHEN COUNT(ib.warehouse_id) FILTER (
            WHERE p_branch_id IS NULL OR warehouse.branch_id = p_branch_id
          ) = 1 THEN MIN(ib.warehouse_id::TEXT) FILTER (
            WHERE p_branch_id IS NULL OR warehouse.branch_id = p_branch_id
          )::UUID
        END AS warehouse_id
      FROM public.products product
      LEFT JOIN public.inventory_balances ib ON ib.product_id = product.id
      LEFT JOIN public.warehouses warehouse ON warehouse.id = ib.warehouse_id
      WHERE product.is_flavor_master = false
      GROUP BY product.id
    ),
    inventory_catalog AS MATERIALIZED (
      SELECT
        product.*,
        stock.on_hand_quantity,
        stock.reserved_quantity,
        stock.available_quantity,
        stock.warehouse_id,
        EXISTS (
          SELECT 1
          FROM public.inventory_movements movement
          JOIN public.warehouses movement_warehouse ON movement_warehouse.id = movement.warehouse_id
          WHERE movement.product_id = product.id
            AND movement.movement_type = 'sales_deduction'
            AND (p_warehouse_id IS NULL OR movement.warehouse_id = p_warehouse_id)
            AND (p_branch_id IS NULL OR movement_warehouse.branch_id = p_branch_id)
        ) AS has_sales
      FROM public.products product
      JOIN stock_by_product stock ON stock.product_id = product.id
      WHERE product.is_flavor_master = false
    ),
    filtered_catalog AS NOT MATERIALIZED (
      SELECT product.*
      FROM inventory_catalog product
      WHERE (p_category_id IS NULL OR product.category_id = p_category_id)
        AND (
          v_search IS NULL
          OR product.name_ar ILIKE '%' || v_search || '%'
          OR product.sku ILIKE '%' || v_search || '%'
          OR COALESCE(product.barcode, '') ILIKE '%' || v_search || '%'
        )
        AND (
          v_status = 'all'
          OR (v_status = 'available' AND product.available_quantity > 0)
          OR (v_status = 'low_stock' AND product.available_quantity > 0
              AND product.available_quantity <= product.min_stock_level)
          OR (v_status = 'out_of_stock' AND product.available_quantity <= 0)
          OR (v_status = 'stagnant' AND product.has_sales = false
              AND product.on_hand_quantity > 0)
          -- Product-level expiry/damage state is not stored in the canonical
          -- products table, so these legacy UI filters intentionally match no rows.
          OR (v_status IN ('near_expiry', 'damaged') AND false)
        )
    ),
    paged_catalog AS MATERIALIZED (
      SELECT product.*
      FROM filtered_catalog product
      ORDER BY product.name_ar, product.id
      OFFSET v_offset
      LIMIT v_page_size
    ),
    detailed_page AS (
      SELECT
        product.id,
        product.sku,
        product.barcode,
        product.name_ar,
        product.description,
        product.category_id,
        product.brand_id,
        product.unit_id,
        product.purchase_unit_id,
        product.units_per_purchase_unit,
        product.default_purchase_price_in_minor_units,
        product.sale_unit_id,
        product.units_per_sale_unit,
        product.default_sale_price_in_minor_units,
        product.cost_price_in_minor_units,
        product.sale_price_in_minor_units,
        product.wholesale_price_in_minor_units,
        product.min_stock_level,
        product.max_stock_level,
        product.is_active,
        product.flavor_master_product_id,
        product.flavor_name_ar,
        product.is_flavor_master,
        product.flavor_sort_order,
        product.created_at,
        product.updated_at,
        jsonb_build_object('id', base_unit.id, 'name_ar', base_unit.name_ar, 'code', base_unit.code) AS base_unit,
        jsonb_build_object('id', purchase_unit.id, 'name_ar', purchase_unit.name_ar, 'code', purchase_unit.code) AS purchase_unit,
        jsonb_build_object('id', sale_unit.id, 'name_ar', sale_unit.name_ar, 'code', sale_unit.code) AS sale_unit,
        product.on_hand_quantity,
        product.reserved_quantity,
        product.available_quantity,
        product.warehouse_id,
        COALESCE(page_stock.warehouse_balances, '[]'::JSONB) AS warehouse_balances,
        product.has_sales,
        COALESCE(movement_count.value, 0)::INTEGER AS movement_count,
        image.image_url
      FROM paged_catalog product
      LEFT JOIN public.units base_unit ON base_unit.id = product.unit_id
      LEFT JOIN public.units purchase_unit ON purchase_unit.id = product.purchase_unit_id
      LEFT JOIN public.units sale_unit ON sale_unit.id = product.sale_unit_id
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'warehouse_id', balance.warehouse_id,
          'on_hand_quantity', balance.on_hand_quantity,
          'reserved_quantity', balance.reserved_quantity,
          'available_quantity', balance.available_quantity
        ) ORDER BY balance.warehouse_id) AS warehouse_balances
        FROM public.inventory_balances balance
        JOIN public.warehouses balance_warehouse
          ON balance_warehouse.id = balance.warehouse_id
        WHERE balance.product_id = product.id
          AND (p_warehouse_id IS NULL OR balance.warehouse_id = p_warehouse_id)
          AND (p_branch_id IS NULL OR balance_warehouse.branch_id = p_branch_id)
      ) page_stock ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::INTEGER AS value
        FROM public.inventory_movements movement
        JOIN public.warehouses movement_warehouse ON movement_warehouse.id = movement.warehouse_id
        WHERE movement.product_id = product.id
          AND (p_warehouse_id IS NULL OR movement.warehouse_id = p_warehouse_id)
          AND (p_branch_id IS NULL OR movement_warehouse.branch_id = p_branch_id)
      ) movement_count ON true
      LEFT JOIN LATERAL (
        SELECT pi.image_url
        FROM public.product_images pi
        WHERE pi.product_id = product.id AND pi.is_primary = true
        ORDER BY pi.display_order, pi.created_at
        LIMIT 1
      ) image ON true
    ),
    inventory_metrics AS (
      SELECT
        COUNT(*)::INTEGER AS total_items,
        COUNT(*) FILTER (WHERE product.is_active = true)::INTEGER AS active_items,
        COUNT(*) FILTER (WHERE product.available_quantity > 0)::INTEGER AS available_stock,
        ROUND(COALESCE(SUM(
          product.on_hand_quantity::NUMERIC
            * COALESCE(
                product.wac_cost_in_minor_units_exact,
                product.cost_price_in_minor_units::NUMERIC
              )
        ), 0), 0)::BIGINT AS total_cost_in_minor_units,
        COALESCE(SUM(product.sale_price_in_minor_units * product.on_hand_quantity), 0)::BIGINT
          AS total_retail_in_minor_units,
        COUNT(*) FILTER (
          WHERE product.available_quantity > 0
            AND product.available_quantity <= product.min_stock_level
        )::INTEGER AS low_stock,
        COUNT(*) FILTER (WHERE product.available_quantity <= 0)::INTEGER AS out_of_stock,
        COUNT(*) FILTER (
          WHERE product.has_sales = false AND product.on_hand_quantity > 0
        )::INTEGER AS stagnant
      FROM inventory_catalog product
    )
    SELECT jsonb_build_object(
      'products', COALESCE((
        SELECT jsonb_agg(to_jsonb(item) ORDER BY item.name_ar, item.id)
        FROM detailed_page item
      ), '[]'::JSONB),
      'total_count', (SELECT COUNT(*)::INTEGER FROM filtered_catalog),
      'metrics', COALESCE((SELECT to_jsonb(metric) FROM inventory_metrics metric), '{}'::JSONB)
    )
  );
END;
$$;

ALTER FUNCTION public.get_admin_inventory_product_page(INTEGER, INTEGER, TEXT, UUID, UUID, UUID, TEXT) OWNER TO postgres;

COMMIT;
