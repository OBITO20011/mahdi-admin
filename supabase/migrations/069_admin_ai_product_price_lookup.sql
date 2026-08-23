-- =========================================================================
-- Nawasrah ERP - Admin AI product price lookup
-- Extends the guarded assistant snapshot with the configured wholesale price
-- of one complete sale package. Cost and supplier information remain excluded.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.get_admin_ai_inventory_snapshot()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_items JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'قراءة مخزون وأسعار مساعد الإدارة الذكي'
  );

  WITH product_stock AS (
    SELECT
      p.name_ar,
      p.sku,
      COALESCE(u.name_ar, 'طرد') AS sale_unit_name,
      GREATEST(p.units_per_sale_unit, 1)::INTEGER AS units_per_sale_unit,
      GREATEST(COALESCE(p.default_sale_price_in_minor_units, 0), 0)::BIGINT
        AS sale_price_in_minor_units,
      COALESCE(SUM(ib.available_quantity), 0)::INTEGER AS available_base_units
    FROM public.products p
    LEFT JOIN public.inventory_balances ib
      ON ib.product_id = p.id
    LEFT JOIN public.units u
      ON u.id = p.sale_unit_id
    WHERE p.is_active = true
    GROUP BY
      p.id,
      p.name_ar,
      p.sku,
      u.name_ar,
      p.units_per_sale_unit,
      p.default_sale_price_in_minor_units
  )
  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'productName', name_ar,
        'sku', sku,
        'saleUnitName', sale_unit_name,
        'unitsPerSaleUnit', units_per_sale_unit,
        'salePriceInMinorUnits', sale_price_in_minor_units,
        'availableBaseUnits', available_base_units,
        'availableSalePackages', FLOOR(
          available_base_units::NUMERIC / units_per_sale_unit
        )::INTEGER
      )
      ORDER BY name_ar ASC, sku ASC
    ),
    '[]'::JSONB
  )
  INTO v_items
  FROM product_stock;

  RETURN JSONB_BUILD_OBJECT(
    'generatedAt', NOW(),
    'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_ai_inventory_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_ai_inventory_snapshot() TO authenticated;
