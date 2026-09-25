-- =========================================================================
-- Nawasrah ERP - exact WAC valuation and commercial quantity reporting
--
-- Read-side correction only. Transaction coordinators, WAC writes, revenue,
-- COGS, profit, payments, reservations, reversals, and legacy write contracts
-- remain unchanged.
-- =========================================================================

BEGIN;

-- Historical commercial quantities must be derived from immutable sale rows.
-- Explicit Base Unit rows never count as Parcels. Untyped legacy rows use the
-- old package snapshots whenever they prove a valid commercial package, even
-- when that historical package contains exactly one Base Unit.
CREATE FUNCTION public.phase35_report_base_unit_count_internal(
  p_order_item_id UUID,
  p_commercial_line_kind TEXT,
  p_legacy_quantity INTEGER
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_commercial_line_kind = 'configurable_parcel' THEN COALESCE((
      SELECT SUM(component.base_quantity)::BIGINT
      FROM public.order_parcel_instances instance
      JOIN public.order_parcel_components component
        ON component.parcel_instance_id = instance.id
      WHERE instance.order_item_id = p_order_item_id
    ), 0::BIGINT)
    ELSE COALESCE(p_legacy_quantity, 0)::BIGINT
  END;
$$;

CREATE FUNCTION public.phase35_report_package_count_internal(
  p_order_item_id UUID,
  p_commercial_line_kind TEXT,
  p_sale_package_quantity INTEGER,
  p_units_per_sale_package INTEGER
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_commercial_line_kind = 'base_unit' THEN 0::BIGINT
    WHEN p_commercial_line_kind = 'configurable_parcel' THEN (
      SELECT COUNT(*)::BIGINT
      FROM public.order_parcel_instances instance
      WHERE instance.order_item_id = p_order_item_id
    )
    WHEN p_commercial_line_kind = 'legacy_single_sku_parcel' THEN
      COALESCE(p_sale_package_quantity, 0)::BIGINT
    WHEN p_commercial_line_kind IS NULL
      AND p_sale_package_quantity IS NOT NULL
      AND p_units_per_sale_package IS NOT NULL
      AND p_units_per_sale_package > 0
    THEN p_sale_package_quantity::BIGINT
    ELSE 0::BIGINT
  END;
$$;

REVOKE ALL ON FUNCTION public.phase35_report_base_unit_count_internal(
  UUID, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase35_report_package_count_internal(
  UUID, TEXT, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.phase35_report_base_unit_count_internal(
  UUID, TEXT, INTEGER
) IS 'Internal immutable-snapshot Base Unit reporting projection.';
COMMENT ON FUNCTION public.phase35_report_package_count_internal(
  UUID, TEXT, INTEGER, INTEGER
) IS 'Internal immutable-snapshot commercial Parcel reporting projection.';

-- Correct the original operational report layer. The final report wrappers
-- keep their existing accounting and reversal behavior while consuming these
-- corrected quantity and valuation fields.
DO $$
DECLARE
  v_definition TEXT;
  v_patched TEXT;
  v_package_original TEXT :=
    'COALESCE(oi.sale_package_quantity, oi.quantity)';
  v_package_replacement TEXT :=
    'public.phase35_report_package_count_internal(oi.id, oi.commercial_line_kind, oi.sale_package_quantity, oi.units_per_sale_package)';
  v_base_original TEXT :=
    'COALESCE(SUM(oi.quantity), 0)::BIGINT AS base_unit_count';
  v_base_replacement TEXT :=
    'COALESCE(SUM(public.phase35_report_base_unit_count_internal(oi.id, oi.commercial_line_kind, oi.quantity)), 0)::BIGINT AS base_unit_count';
  v_value_original TEXT :=
    'ib.on_hand_quantity * p.cost_price_in_minor_units';
  v_value_replacement TEXT :=
    'ib.on_hand_quantity::NUMERIC * COALESCE(p.wac_cost_in_minor_units_exact, p.cost_price_in_minor_units::NUMERIC)';
BEGIN
  SELECT REPLACE(REPLACE(
    pg_get_functiondef(
      'public._get_operational_business_report_v1(uuid,date,date)'::REGPROCEDURE
    ), E'\r\n', E'\n'), E'\r', E'\n')
  INTO v_definition;

  IF v_definition IS NULL
    OR POSITION(v_package_original IN v_definition) = 0
    OR POSITION(v_base_original IN v_definition) = 0
    OR POSITION(v_value_original IN v_definition) = 0
  THEN
    RAISE EXCEPTION
      'Migration 119 cannot safely patch the operational report contract.';
  END IF;

  v_patched := REPLACE(v_definition, v_package_original, v_package_replacement);
  v_patched := REPLACE(v_patched, v_base_original, v_base_replacement);
  v_patched := REPLACE(v_patched, v_value_original, v_value_replacement);
  EXECUTE v_patched;
END;
$$;

-- The discount-aware wrapper recalculates Top Products. Keep its revenue,
-- discount, COGS, and profit logic intact and correct only commercial count.
DO $$
DECLARE
  v_definition TEXT;
  v_patched TEXT;
  v_original TEXT :=
    'COALESCE(oi.sale_package_quantity, oi.quantity)::BIGINT AS package_quantity';
  v_replacement TEXT :=
    'public.phase35_report_package_count_internal(oi.id, oi.commercial_line_kind, oi.sale_package_quantity, oi.units_per_sale_package)::BIGINT AS package_quantity';
BEGIN
  SELECT REPLACE(REPLACE(
    pg_get_functiondef(
      'public.get_operational_business_report(uuid,date,date)'::REGPROCEDURE
    ), E'\r\n', E'\n'), E'\r', E'\n')
  INTO v_definition;

  IF v_definition IS NULL OR POSITION(v_original IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Migration 119 cannot safely patch the Top Products report contract.';
  END IF;

  v_patched := REPLACE(v_definition, v_original, v_replacement);
  EXECUTE v_patched;
END;
$$;

-- Closed shifts keep their immutable historical snapshot. The internal live
-- report used by open shifts and by future close snapshots gets corrected.
DO $$
DECLARE
  v_definition TEXT;
  v_patched TEXT;
  v_original TEXT := 'SUM(oi.quantity)';
  v_replacement TEXT := E'SUM(public.phase35_report_package_count_internal(\n         oi.id, oi.commercial_line_kind, oi.sale_package_quantity,\n         oi.units_per_sale_package\n       ))';
BEGIN
  SELECT REPLACE(REPLACE(
    pg_get_functiondef(
      'public._get_cash_shift_closing_report_v1(uuid)'::REGPROCEDURE
    ), E'\r\n', E'\n'), E'\r', E'\n')
  INTO v_definition;

  IF v_definition IS NULL OR POSITION(v_original IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Migration 119 cannot safely patch the live shift report contract.';
  END IF;

  v_patched := REPLACE(v_definition, v_original, v_replacement);
  EXECUTE v_patched;
END;
$$;

-- Every inventory valuation sums full-precision authoritative WAC first and
-- rounds once at the financial/display boundary. Exact zero is authoritative;
-- the integer legacy cost is used only when exact WAC is NULL.
DO $$
DECLARE
  v_definition TEXT;
  v_patched TEXT;
  v_original TEXT := E'SELECT COALESCE(SUM(\n    ib.on_hand_quantity::BIGINT * p.cost_price_in_minor_units\n  ), 0)\n  INTO v_inventory_value';
  v_replacement TEXT := E'SELECT ROUND(COALESCE(SUM(\n    ib.on_hand_quantity::NUMERIC\n      * COALESCE(p.wac_cost_in_minor_units_exact, p.cost_price_in_minor_units::NUMERIC)\n  ), 0), 0)::BIGINT\n  INTO v_inventory_value';
BEGIN
  SELECT REPLACE(REPLACE(
    pg_get_functiondef('public.get_home_dashboard()'::REGPROCEDURE),
    E'\r\n', E'\n'), E'\r', E'\n')
  INTO v_definition;

  IF v_definition IS NULL OR POSITION(v_original IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Migration 119 cannot safely patch the Home Dashboard valuation.';
  END IF;

  v_patched := REPLACE(v_definition, v_original, v_replacement);
  EXECUTE v_patched;
END;
$$;

-- Product-page metrics aggregate Flavor families from stocked child SKUs.
-- The Flavor Master cost is never used as a family inventory valuation proxy.
DO $$
DECLARE
  v_definition TEXT;
  v_patched TEXT;
  v_family_original TEXT := E'        COALESCE(SUM(stock.available_quantity), 0)::INTEGER AS available_quantity\n      FROM public.products child';
  v_family_replacement TEXT := E'        COALESCE(SUM(stock.available_quantity), 0)::INTEGER AS available_quantity,\n        COALESCE(SUM(\n          COALESCE(stock.on_hand_quantity, 0)::NUMERIC\n            * COALESCE(\n                child.wac_cost_in_minor_units_exact,\n                child.cost_price_in_minor_units::NUMERIC\n              )\n        ), 0)::NUMERIC AS inventory_value_in_minor_units_exact\n      FROM public.products child';
  v_root_original TEXT := E'        CASE WHEN product.is_flavor_master\n          THEN COALESCE(family.available_quantity, 0)\n          ELSE COALESCE(stock.available_quantity, 0)\n        END::INTEGER AS effective_available_quantity\n      FROM public.products product';
  v_root_replacement TEXT := E'        CASE WHEN product.is_flavor_master\n          THEN COALESCE(family.available_quantity, 0)\n          ELSE COALESCE(stock.available_quantity, 0)\n        END::INTEGER AS effective_available_quantity,\n        CASE WHEN product.is_flavor_master\n          THEN COALESCE(family.inventory_value_in_minor_units_exact, 0)\n          ELSE COALESCE(stock.on_hand_quantity, 0)::NUMERIC\n            * COALESCE(\n                product.wac_cost_in_minor_units_exact,\n                product.cost_price_in_minor_units::NUMERIC\n              )\n        END::NUMERIC AS effective_inventory_value_in_minor_units_exact\n      FROM public.products product';
  v_metric_original TEXT := E'        COALESCE(SUM(root.cost_price_in_minor_units * root.effective_on_hand_quantity), 0)::BIGINT\n          AS inventory_cost_in_minor_units';
  v_metric_replacement TEXT := E'        ROUND(COALESCE(SUM(\n          root.effective_inventory_value_in_minor_units_exact\n        ), 0), 0)::BIGINT AS inventory_cost_in_minor_units';
BEGIN
  SELECT REPLACE(REPLACE(
    pg_get_functiondef(
      'public.get_admin_product_page(integer,integer,text,uuid,text,text)'::REGPROCEDURE
    ), E'\r\n', E'\n'), E'\r', E'\n')
  INTO v_definition;

  IF v_definition IS NULL
    OR POSITION(v_family_original IN v_definition) = 0
    OR POSITION(v_root_original IN v_definition) = 0
    OR POSITION(v_metric_original IN v_definition) = 0
  THEN
    RAISE EXCEPTION
      'Migration 119 cannot safely patch Admin product valuation.';
  END IF;

  v_patched := REPLACE(v_definition, v_family_original, v_family_replacement);
  v_patched := REPLACE(v_patched, v_root_original, v_root_replacement);
  v_patched := REPLACE(v_patched, v_metric_original, v_metric_replacement);
  EXECUTE v_patched;
END;
$$;

DO $$
DECLARE
  v_definition TEXT;
  v_patched TEXT;
  v_original TEXT := E'        COALESCE(SUM(product.cost_price_in_minor_units * product.on_hand_quantity), 0)::BIGINT\n          AS total_cost_in_minor_units';
  v_replacement TEXT := E'        ROUND(COALESCE(SUM(\n          product.on_hand_quantity::NUMERIC\n            * COALESCE(\n                product.wac_cost_in_minor_units_exact,\n                product.cost_price_in_minor_units::NUMERIC\n              )\n        ), 0), 0)::BIGINT AS total_cost_in_minor_units';
BEGIN
  SELECT REPLACE(REPLACE(
    pg_get_functiondef(
      'public.get_admin_inventory_product_page(integer,integer,text,uuid,uuid,uuid,text)'::REGPROCEDURE
    ), E'\r\n', E'\n'), E'\r', E'\n')
  INTO v_definition;

  IF v_definition IS NULL OR POSITION(v_original IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Migration 119 cannot safely patch Admin inventory valuation.';
  END IF;

  v_patched := REPLACE(v_definition, v_original, v_replacement);
  EXECUTE v_patched;
END;
$$;

COMMIT;
