-- =========================================================================
-- Nawasrah ERP - bounded Admin catalog and inventory read models
-- Keeps mutations and the legacy listing contract unchanged while moving
-- growing Admin screens to server-side pagination/search.
-- =========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_admin_product_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 24,
  p_search TEXT DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT 'all',
  p_sort TEXT DEFAULT 'name'
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
  v_sort TEXT := COALESCE(NULLIF(BTRIM(p_sort), ''), 'name');
  v_offset INTEGER;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY[
      'owner', 'admin', 'manager', 'accountant', 'cashier', 'sales',
      'warehouse_keeper', 'orders', 'delivery_driver', 'view_only'
    ],
    'عرض صفحة المنتجات الإدارية'
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
  IF v_status NOT IN ('all', 'healthy', 'low_stock', 'out_of_stock', 'hidden') THEN
    RAISE EXCEPTION 'فلتر حالة المنتج غير صالح.';
  END IF;
  IF v_sort NOT IN ('name', 'stock_asc', 'stock_desc', 'profit_desc') THEN
    RAISE EXCEPTION 'ترتيب المنتجات غير صالح.';
  END IF;

  v_offset := (v_page - 1) * v_page_size;

  RETURN (
    WITH stock_by_product AS MATERIALIZED (
      SELECT
        ib.product_id,
        SUM(ib.on_hand_quantity)::INTEGER AS on_hand_quantity,
        SUM(ib.reserved_quantity)::INTEGER AS reserved_quantity,
        SUM(ib.available_quantity)::INTEGER AS available_quantity,
        CASE WHEN COUNT(*) = 1 THEN MIN(ib.warehouse_id::TEXT)::UUID END AS warehouse_id,
        jsonb_agg(
          jsonb_build_object(
            'warehouse_id', ib.warehouse_id,
            'on_hand_quantity', ib.on_hand_quantity,
            'reserved_quantity', ib.reserved_quantity,
            'available_quantity', ib.available_quantity
          ) ORDER BY ib.warehouse_id
        ) AS warehouse_balances
      FROM public.inventory_balances ib
      GROUP BY ib.product_id
    ),
    family_stock AS MATERIALIZED (
      SELECT
        child.flavor_master_product_id AS product_id,
        COALESCE(SUM(stock.on_hand_quantity), 0)::INTEGER AS on_hand_quantity,
        COALESCE(SUM(stock.reserved_quantity), 0)::INTEGER AS reserved_quantity,
        COALESCE(SUM(stock.available_quantity), 0)::INTEGER AS available_quantity
      FROM public.products child
      LEFT JOIN stock_by_product stock ON stock.product_id = child.id
      WHERE child.flavor_master_product_id IS NOT NULL
      GROUP BY child.flavor_master_product_id
    ),
    root_catalog AS MATERIALIZED (
      SELECT
        product.*,
        CASE WHEN product.is_flavor_master
          THEN COALESCE(family.on_hand_quantity, 0)
          ELSE COALESCE(stock.on_hand_quantity, 0)
        END::INTEGER AS effective_on_hand_quantity,
        CASE WHEN product.is_flavor_master
          THEN COALESCE(family.reserved_quantity, 0)
          ELSE COALESCE(stock.reserved_quantity, 0)
        END::INTEGER AS effective_reserved_quantity,
        CASE WHEN product.is_flavor_master
          THEN COALESCE(family.available_quantity, 0)
          ELSE COALESCE(stock.available_quantity, 0)
        END::INTEGER AS effective_available_quantity
      FROM public.products product
      LEFT JOIN stock_by_product stock ON stock.product_id = product.id
      LEFT JOIN family_stock family ON family.product_id = product.id
      WHERE product.flavor_master_product_id IS NULL
    ),
    filtered_roots AS MATERIALIZED (
      SELECT root.*
      FROM root_catalog root
      WHERE (p_category_id IS NULL OR root.category_id = p_category_id)
        AND (
          v_search IS NULL
          OR root.name_ar ILIKE '%' || v_search || '%'
          OR COALESCE(root.description, '') ILIKE '%' || v_search || '%'
          OR root.sku ILIKE '%' || v_search || '%'
          OR COALESCE(root.barcode, '') ILIKE '%' || v_search || '%'
          OR EXISTS (
            SELECT 1
            FROM public.products flavor
            WHERE flavor.flavor_master_product_id = root.id
              AND (
                flavor.name_ar ILIKE '%' || v_search || '%'
                OR COALESCE(flavor.flavor_name_ar, '') ILIKE '%' || v_search || '%'
                OR flavor.sku ILIKE '%' || v_search || '%'
                OR COALESCE(flavor.barcode, '') ILIKE '%' || v_search || '%'
              )
          )
        )
        AND (
          v_status = 'all'
          OR (v_status = 'hidden' AND root.is_active = false)
          OR (
            root.is_active = true
            AND (
              (v_status = 'healthy' AND root.effective_available_quantity > root.min_stock_level)
              OR (v_status = 'low_stock' AND root.effective_available_quantity > 0
                  AND root.effective_available_quantity <= root.min_stock_level)
              OR (v_status = 'out_of_stock' AND root.effective_available_quantity = 0)
            )
          )
        )
    ),
    paged_roots AS MATERIALIZED (
      SELECT
        root.*,
        ROW_NUMBER() OVER (
          ORDER BY
            CASE WHEN v_sort = 'stock_asc' THEN root.effective_available_quantity END ASC,
            CASE WHEN v_sort = 'stock_desc' THEN root.effective_available_quantity END DESC,
            CASE WHEN v_sort = 'profit_desc' THEN
              COALESCE(root.default_sale_price_in_minor_units, 0)
              - root.cost_price_in_minor_units * GREATEST(COALESCE(root.units_per_sale_unit, 1), 1)
            END DESC,
            CASE WHEN v_sort = 'name' THEN root.name_ar END ASC,
            root.name_ar ASC,
            root.id ASC
        ) AS page_rank
      FROM filtered_roots root
      ORDER BY
        CASE WHEN v_sort = 'stock_asc' THEN root.effective_available_quantity END ASC,
        CASE WHEN v_sort = 'stock_desc' THEN root.effective_available_quantity END DESC,
        CASE WHEN v_sort = 'profit_desc' THEN
          COALESCE(root.default_sale_price_in_minor_units, 0)
          - root.cost_price_in_minor_units * GREATEST(COALESCE(root.units_per_sale_unit, 1), 1)
        END DESC,
        CASE WHEN v_sort = 'name' THEN root.name_ar END ASC,
        root.name_ar ASC,
        root.id ASC
      OFFSET v_offset
      LIMIT v_page_size
    ),
    page_products AS MATERIALIZED (
      SELECT product.*, root.id AS page_root_id, root.page_rank, 0 AS page_child_order
      FROM paged_roots root
      JOIN public.products product ON product.id = root.id
      UNION ALL
      SELECT child.*, root.id AS page_root_id, root.page_rank, 1 AS page_child_order
      FROM paged_roots root
      JOIN public.products child ON child.flavor_master_product_id = root.id
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
        CASE WHEN product.is_flavor_master
          THEN COALESCE(family.on_hand_quantity, 0)
          ELSE COALESCE(stock.on_hand_quantity, 0)
        END::INTEGER AS on_hand_quantity,
        CASE WHEN product.is_flavor_master
          THEN COALESCE(family.reserved_quantity, 0)
          ELSE COALESCE(stock.reserved_quantity, 0)
        END::INTEGER AS reserved_quantity,
        CASE WHEN product.is_flavor_master
          THEN COALESCE(family.available_quantity, 0)
          ELSE COALESCE(stock.available_quantity, 0)
        END::INTEGER AS available_quantity,
        CASE WHEN product.is_flavor_master THEN NULL ELSE stock.warehouse_id END AS warehouse_id,
        CASE WHEN product.is_flavor_master THEN '[]'::JSONB
          ELSE COALESCE(stock.warehouse_balances, '[]'::JSONB)
        END AS warehouse_balances,
        image.image_url,
        product.page_root_id,
        product.page_rank,
        product.page_child_order
      FROM page_products product
      LEFT JOIN stock_by_product stock ON stock.product_id = product.id
      LEFT JOIN family_stock family ON family.product_id = product.id
      LEFT JOIN public.units base_unit ON base_unit.id = product.unit_id
      LEFT JOIN public.units purchase_unit ON purchase_unit.id = product.purchase_unit_id
      LEFT JOIN public.units sale_unit ON sale_unit.id = product.sale_unit_id
      LEFT JOIN LATERAL (
        SELECT pi.image_url
        FROM public.product_images pi
        WHERE pi.product_id = product.id AND pi.is_primary = true
        ORDER BY pi.display_order, pi.created_at
        LIMIT 1
      ) image ON true
    ),
    catalog_metrics AS (
      SELECT
        COUNT(*) FILTER (
          WHERE root.is_active = true AND root.effective_available_quantity > 0
            AND root.effective_available_quantity <= root.min_stock_level
        )::INTEGER AS low_stock,
        COUNT(*) FILTER (
          WHERE root.is_active = true AND root.effective_available_quantity = 0
        )::INTEGER AS out_of_stock,
        COALESCE(SUM(root.cost_price_in_minor_units * root.effective_on_hand_quantity), 0)::BIGINT
          AS inventory_cost_in_minor_units,
        COALESCE(SUM(
          CASE WHEN root.sale_unit_id IS NULL THEN 0 ELSE GREATEST(
            COALESCE(root.default_sale_price_in_minor_units, 0)::NUMERIC
              / GREATEST(COALESCE(root.units_per_sale_unit, 1), 1)
              - root.cost_price_in_minor_units,
            0
          ) * root.effective_available_quantity END
        ), 0) AS potential_profit_in_minor_units
      FROM root_catalog root
    )
    SELECT jsonb_build_object(
      'products', COALESCE((
        SELECT jsonb_agg(to_jsonb(item) - 'page_root_id' - 'page_rank' - 'page_child_order'
          ORDER BY item.page_rank, item.page_child_order,
                   item.flavor_sort_order, item.name_ar, item.id)
        FROM detailed_page item
      ), '[]'::JSONB),
      'total_count', (SELECT COUNT(*)::INTEGER FROM filtered_roots),
      'metrics', COALESCE((SELECT to_jsonb(metric) FROM catalog_metrics metric), '{}'::JSONB)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_product_page(
  INTEGER, INTEGER, TEXT, UUID, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_product_page(
  INTEGER, INTEGER, TEXT, UUID, TEXT, TEXT
) TO authenticated;

CREATE OR REPLACE FUNCTION public.search_admin_products(
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 24,
  p_category_id UUID DEFAULT NULL,
  p_purpose TEXT DEFAULT 'stockable',
  p_product_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_search TEXT := NULLIF(BTRIM(p_search), '');
  v_limit INTEGER := COALESCE(p_limit, 24);
  v_purpose TEXT := COALESCE(NULLIF(BTRIM(p_purpose), ''), 'stockable');
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY[
      'owner', 'admin', 'manager', 'accountant', 'cashier', 'sales',
      'warehouse_keeper', 'orders', 'delivery_driver', 'view_only'
    ],
    'البحث في المنتجات الإدارية'
  );

  IF v_limit < 1 OR v_limit > 50 THEN
    RAISE EXCEPTION 'حد نتائج البحث يجب أن يكون بين 1 و50.';
  END IF;
  IF v_search IS NOT NULL AND CHAR_LENGTH(v_search) > 100 THEN
    RAISE EXCEPTION 'عبارة البحث طويلة جدًا.';
  END IF;
  IF v_purpose NOT IN ('any', 'stockable', 'receiving', 'sellable') THEN
    RAISE EXCEPTION 'غرض البحث عن المنتج غير صالح.';
  END IF;

  RETURN (
    WITH matched AS MATERIALIZED (
      SELECT product.*
      FROM public.products product
      LEFT JOIN public.units sale_unit ON sale_unit.id = product.sale_unit_id
      WHERE (p_product_id IS NULL OR product.id = p_product_id)
        AND (p_category_id IS NULL OR product.category_id = p_category_id)
        AND (
          v_search IS NULL
          OR product.name_ar ILIKE '%' || v_search || '%'
          OR COALESCE(product.flavor_name_ar, '') ILIKE '%' || v_search || '%'
          OR product.sku ILIKE '%' || v_search || '%'
          OR COALESCE(product.barcode, '') ILIKE '%' || v_search || '%'
          OR product.id::TEXT = v_search
        )
        AND (
          v_purpose = 'any'
          OR (
            product.is_active = true
            AND product.is_flavor_master = false
            AND (
              v_purpose <> 'sellable'
              OR (
                product.sale_unit_id IS NOT NULL
                AND COALESCE(product.units_per_sale_unit, 0) > 0
                AND COALESCE(product.default_sale_price_in_minor_units, 0) > 0
                AND COALESCE(sale_unit.code, '') <> 'PCS'
              )
            )
          )
        )
      ORDER BY
        CASE WHEN v_search IS NOT NULL AND LOWER(BTRIM(product.barcode)) = LOWER(v_search) THEN 0
             WHEN v_search IS NOT NULL AND LOWER(BTRIM(product.sku)) = LOWER(v_search) THEN 1
             ELSE 2 END,
        product.name_ar,
        product.id
      LIMIT v_limit
    ),
    stock_by_product AS MATERIALIZED (
      SELECT
        ib.product_id,
        SUM(ib.on_hand_quantity)::INTEGER AS on_hand_quantity,
        SUM(ib.reserved_quantity)::INTEGER AS reserved_quantity,
        SUM(ib.available_quantity)::INTEGER AS available_quantity,
        CASE WHEN COUNT(*) = 1 THEN MIN(ib.warehouse_id::TEXT)::UUID END AS warehouse_id,
        jsonb_agg(jsonb_build_object(
          'warehouse_id', ib.warehouse_id,
          'on_hand_quantity', ib.on_hand_quantity,
          'reserved_quantity', ib.reserved_quantity,
          'available_quantity', ib.available_quantity
        ) ORDER BY ib.warehouse_id) AS warehouse_balances
      FROM public.inventory_balances ib
      JOIN matched product ON product.id = ib.product_id
      GROUP BY ib.product_id
    ),
    detailed AS (
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
        COALESCE(stock.on_hand_quantity, 0)::INTEGER AS on_hand_quantity,
        COALESCE(stock.reserved_quantity, 0)::INTEGER AS reserved_quantity,
        COALESCE(stock.available_quantity, 0)::INTEGER AS available_quantity,
        stock.warehouse_id,
        COALESCE(stock.warehouse_balances, '[]'::JSONB) AS warehouse_balances,
        image.image_url
      FROM matched product
      LEFT JOIN stock_by_product stock ON stock.product_id = product.id
      LEFT JOIN public.units base_unit ON base_unit.id = product.unit_id
      LEFT JOIN public.units purchase_unit ON purchase_unit.id = product.purchase_unit_id
      LEFT JOIN public.units sale_unit ON sale_unit.id = product.sale_unit_id
      LEFT JOIN LATERAL (
        SELECT pi.image_url
        FROM public.product_images pi
        WHERE pi.product_id = product.id AND pi.is_primary = true
        ORDER BY pi.display_order, pi.created_at
        LIMIT 1
      ) image ON true
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.name_ar, item.id), '[]'::JSONB)
    FROM detailed item
  );
END;
$$;

REVOKE ALL ON FUNCTION public.search_admin_products(
  TEXT, INTEGER, UUID, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_admin_products(
  TEXT, INTEGER, UUID, TEXT, UUID
) TO authenticated;

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
  IF v_status NOT IN ('all', 'low_stock', 'out_of_stock', 'near_expiry', 'damaged', 'stagnant') THEN
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
        COALESCE(SUM(product.cost_price_in_minor_units * product.on_hand_quantity), 0)::BIGINT
          AS total_cost_in_minor_units,
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

REVOKE ALL ON FUNCTION public.get_admin_inventory_product_page(
  INTEGER, INTEGER, TEXT, UUID, UUID, UUID, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_inventory_product_page(
  INTEGER, INTEGER, TEXT, UUID, UUID, UUID, TEXT
) TO authenticated;

-- Preserve the historical movement-page signature while removing the two
-- unbounded whole-history aggregates. Product-card movement metadata now
-- comes from get_admin_inventory_product_page for only the visible rows.
CREATE OR REPLACE FUNCTION public.get_inventory_movement_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_search TEXT DEFAULT NULL,
  p_branch_id UUID DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_product_id UUID DEFAULT NULL
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
      'owner', 'admin', 'manager', 'accountant', 'cashier', 'sales',
      'warehouse_keeper', 'orders', 'delivery_driver', 'view_only'
    ],
    'عرض سجل حركات المخزون'
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

  v_offset := (v_page - 1) * v_page_size;

  RETURN (
    WITH filtered_movements AS NOT MATERIALIZED (
      SELECT
        movement.id,
        movement.warehouse_id,
        movement.product_id,
        movement.movement_type,
        movement.quantity,
        movement.balance_before,
        movement.balance_after,
        movement.reference_type,
        movement.reference_id,
        movement.notes,
        movement.created_by,
        movement.created_at,
        COALESCE(product.name_ar, product.sku, 'منتج') AS product_name,
        warehouse.branch_id
      FROM public.inventory_movements movement
      JOIN public.products product ON product.id = movement.product_id
      JOIN public.warehouses warehouse ON warehouse.id = movement.warehouse_id
      WHERE (p_branch_id IS NULL OR warehouse.branch_id = p_branch_id)
        AND (p_warehouse_id IS NULL OR movement.warehouse_id = p_warehouse_id)
        AND (p_product_id IS NULL OR movement.product_id = p_product_id)
        AND (
          v_search IS NULL
          OR product.name_ar ILIKE '%' || v_search || '%'
          OR COALESCE(movement.notes, '') ILIKE '%' || v_search || '%'
          OR COALESCE(movement.reference_type, '') ILIKE '%' || v_search || '%'
          OR movement.movement_type ILIKE '%' || v_search || '%'
        )
    ),
    paged_movements AS (
      SELECT *
      FROM filtered_movements
      ORDER BY created_at DESC, id DESC
      OFFSET v_offset
      LIMIT v_page_size
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((
        SELECT jsonb_agg(to_jsonb(item) ORDER BY item.created_at DESC, item.id DESC)
        FROM paged_movements item
      ), '[]'::JSONB),
      'total_count', (SELECT COUNT(*)::INTEGER FROM filtered_movements),
      'product_movement_counts', '{}'::JSONB,
      'sales_product_ids', '[]'::JSONB
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_inventory_movement_page(
  INTEGER, INTEGER, TEXT, UUID, UUID, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_movement_page(
  INTEGER, INTEGER, TEXT, UUID, UUID, UUID
) TO authenticated;

COMMENT ON FUNCTION public.get_admin_product_page(INTEGER, INTEGER, TEXT, UUID, TEXT, TEXT) IS
  'Bounded root-product page with server-side search/filter/sort and page-local flavor children.';
COMMENT ON FUNCTION public.search_admin_products(TEXT, INTEGER, UUID, TEXT, UUID) IS
  'Bounded authenticated product search for POS and operational product pickers.';
COMMENT ON FUNCTION public.get_admin_inventory_product_page(INTEGER, INTEGER, TEXT, UUID, UUID, UUID, TEXT) IS
  'Bounded inventory product page with scope-wide metrics and page-local movement metadata.';

COMMIT;
