BEGIN;

-- Flavor masters are grouping records only. Every inventory-changing path
-- ultimately writes one of these two tables, so enforcing the invariant here
-- protects current and future RPCs even when a client bypasses UI filtering.
CREATE OR REPLACE FUNCTION public.reject_flavor_master_inventory_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = NEW.product_id
      AND p.is_flavor_master = true
  ) THEN
    RAISE EXCEPTION
      'المنتج الأساسي للنكهات مخصص للتجميع فقط؛ اختر نكهة محددة لتغيير المخزون.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_flavor_master_inventory_mutation()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_inventory_balances_reject_flavor_master
  ON public.inventory_balances;
CREATE TRIGGER trg_inventory_balances_reject_flavor_master
BEFORE INSERT OR UPDATE ON public.inventory_balances
FOR EACH ROW
EXECUTE FUNCTION public.reject_flavor_master_inventory_mutation();

DROP TRIGGER IF EXISTS trg_inventory_movements_reject_flavor_master
  ON public.inventory_movements;
CREATE TRIGGER trg_inventory_movements_reject_flavor_master
BEFORE INSERT OR UPDATE ON public.inventory_movements
FOR EACH ROW
EXECUTE FUNCTION public.reject_flavor_master_inventory_mutation();

-- A product with stock history cannot be converted into a grouping-only
-- master. Existing flavor creation already checks the current balance; this
-- trigger closes the historical-movement gap for every caller.
CREATE OR REPLACE FUNCTION public.reject_stocked_product_flavor_master_promotion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_flavor_master = true
     AND COALESCE(OLD.is_flavor_master, false) = false
     AND (
       EXISTS (
         SELECT 1
         FROM public.inventory_balances ib
         WHERE ib.product_id = NEW.id
           AND (ib.on_hand_quantity <> 0 OR ib.reserved_quantity <> 0)
       )
       OR EXISTS (
         SELECT 1
         FROM public.inventory_movements im
         WHERE im.product_id = NEW.id
       )
     )
  THEN
    RAISE EXCEPTION
      'لا يمكن تحويل صنف لديه رصيد أو تاريخ مخزني إلى منتج أساسي للنكهات.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_stocked_product_flavor_master_promotion()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_products_reject_stocked_master_promotion
  ON public.products;
CREATE TRIGGER trg_products_reject_stocked_master_promotion
BEFORE UPDATE OF is_flavor_master ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.reject_stocked_product_flavor_master_promotion();

-- Commercial package/sale settings remain inherited. Cost is copied only
-- when the child SKU is first created; later WAC updates belong to that child.
CREATE OR REPLACE FUNCTION public.enforce_product_flavor_inheritance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_master public.products%ROWTYPE;
BEGIN
  IF NEW.flavor_master_product_id IS NULL THEN
    IF NEW.is_flavor_master AND NEW.flavor_name_ar IS NOT NULL THEN
      RAISE EXCEPTION 'المنتج الأساسي لا يحمل اسم نكهة.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.flavor_master_product_id = NEW.id THEN
    RAISE EXCEPTION 'لا يمكن ربط المنتج بنفسه كمنتج أساسي.';
  END IF;

  SELECT * INTO v_master
  FROM public.products
  WHERE id = NEW.flavor_master_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المنتج الأساسي للنكهة غير موجود.';
  END IF;
  IF v_master.flavor_master_product_id IS NOT NULL THEN
    RAISE EXCEPTION 'لا يمكن إنشاء نكهة داخل نكهة أخرى.';
  END IF;

  NEW.flavor_name_ar := BTRIM(NEW.flavor_name_ar);
  NEW.is_flavor_master := false;
  NEW.category_id := v_master.category_id;
  NEW.brand_id := v_master.brand_id;
  NEW.unit_id := v_master.unit_id;
  NEW.purchase_unit_id := v_master.purchase_unit_id;
  NEW.units_per_purchase_unit := v_master.units_per_purchase_unit;
  NEW.default_purchase_price_in_minor_units :=
    v_master.default_purchase_price_in_minor_units;
  NEW.sale_unit_id := v_master.sale_unit_id;
  NEW.units_per_sale_unit := v_master.units_per_sale_unit;
  NEW.default_sale_price_in_minor_units :=
    v_master.default_sale_price_in_minor_units;
  IF TG_OP = 'INSERT' THEN
    NEW.cost_price_in_minor_units := v_master.cost_price_in_minor_units;
  END IF;
  NEW.sale_price_in_minor_units := v_master.sale_price_in_minor_units;
  NEW.wholesale_price_in_minor_units :=
    v_master.wholesale_price_in_minor_units;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_product_flavor_commercial_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.flavor_master_product_id IS NULL AND NEW.is_flavor_master THEN
    UPDATE public.products
    SET
      category_id = NEW.category_id,
      brand_id = NEW.brand_id,
      unit_id = NEW.unit_id,
      purchase_unit_id = NEW.purchase_unit_id,
      units_per_purchase_unit = NEW.units_per_purchase_unit,
      default_purchase_price_in_minor_units =
        NEW.default_purchase_price_in_minor_units,
      sale_unit_id = NEW.sale_unit_id,
      units_per_sale_unit = NEW.units_per_sale_unit,
      default_sale_price_in_minor_units =
        NEW.default_sale_price_in_minor_units,
      sale_price_in_minor_units = NEW.sale_price_in_minor_units,
      wholesale_price_in_minor_units = NEW.wholesale_price_in_minor_units,
      is_active = NEW.is_active,
      updated_at = NOW()
    WHERE flavor_master_product_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

-- Keep the trigger coverage for master cost edits so the same update can sync
-- any other commercial fields, while deliberately never copying master cost.
DROP TRIGGER IF EXISTS trg_products_sync_flavor_settings ON public.products;
CREATE TRIGGER trg_products_sync_flavor_settings
AFTER UPDATE OF
  category_id,
  brand_id,
  unit_id,
  purchase_unit_id,
  units_per_purchase_unit,
  default_purchase_price_in_minor_units,
  sale_unit_id,
  units_per_sale_unit,
  default_sale_price_in_minor_units,
  cost_price_in_minor_units,
  sale_price_in_minor_units,
  wholesale_price_in_minor_units,
  is_active
ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.sync_product_flavor_commercial_settings();

-- Keep the public signature for deployed clients, but stop product definition
-- from creating inventory. Stock must enter through receiving or the dedicated
-- opening-inventory workflow, never as a side effect of creating a product.
CREATE OR REPLACE FUNCTION public.create_product_with_opening_stock_v4(
  p_sku TEXT,
  p_barcode TEXT DEFAULT NULL,
  p_name_ar TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_brand_id UUID DEFAULT NULL,
  p_unit_id UUID DEFAULT NULL,
  p_purchase_unit_id UUID DEFAULT NULL,
  p_units_per_purchase_unit INTEGER DEFAULT 1,
  p_default_purchase_price_in_minor_units BIGINT DEFAULT 0,
  p_sale_unit_id UUID DEFAULT NULL,
  p_units_per_sale_unit INTEGER DEFAULT 1,
  p_default_sale_price_in_minor_units BIGINT DEFAULT 0,
  p_cost_price_in_minor_units BIGINT DEFAULT 0,
  p_min_stock_level INTEGER DEFAULT 0,
  p_max_stock_level INTEGER DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_opening_quantity INTEGER DEFAULT 0,
  p_notes TEXT DEFAULT 'رصيد افتتاحي عند إضافة المنتج',
  p_image_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
  v_product_id UUID;
  v_unit_sale_price BIGINT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إضافة منتج جملة'
  );

  IF COALESCE(p_opening_quantity, 0) <> 0 THEN
    RAISE EXCEPTION
      'لا يُضاف مخزون أثناء إنشاء المنتج؛ استخدم الاستلام أو تهيئة المخزون الموثقة.';
  END IF;
  IF COALESCE(p_units_per_sale_unit, 0) < 1 THEN
    RAISE EXCEPTION 'عدد الحبات داخل طرد البيع يجب أن يكون أكبر من صفر.';
  END IF;
  IF COALESCE(p_default_sale_price_in_minor_units, 0) <= 0 THEN
    RAISE EXCEPTION 'سعر بيع طرد الجملة يجب أن يكون أكبر من صفر.';
  END IF;
  IF p_sale_unit_id IS NULL OR EXISTS (
    SELECT 1 FROM public.units
    WHERE id = p_sale_unit_id AND code = 'PCS'
  ) THEN
    RAISE EXCEPTION 'طرد البيع يجب أن يكون عبوة جملة وليس حبة أو قطعة.';
  END IF;

  v_unit_sale_price := ROUND(
    p_default_sale_price_in_minor_units::NUMERIC / p_units_per_sale_unit
  )::BIGINT;

  v_result := public.create_product_with_opening_stock_v3(
    p_sku, p_barcode, p_name_ar, p_description, p_category_id, p_brand_id,
    p_unit_id, p_purchase_unit_id, p_units_per_purchase_unit,
    p_default_purchase_price_in_minor_units, p_cost_price_in_minor_units,
    v_unit_sale_price, v_unit_sale_price, p_min_stock_level,
    p_max_stock_level, p_warehouse_id, 0, p_notes, p_image_url
  );

  v_product_id := NULLIF(v_result->>'product_id', '')::UUID;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'لم يتم إرجاع معرف المنتج بعد إنشائه.';
  END IF;

  UPDATE public.products
  SET
    sale_unit_id = COALESCE(p_sale_unit_id, p_purchase_unit_id, p_unit_id),
    units_per_sale_unit = p_units_per_sale_unit,
    default_sale_price_in_minor_units = p_default_sale_price_in_minor_units,
    updated_at = NOW()
  WHERE id = v_product_id;

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    auth.uid(), 'SET_PRODUCT_WHOLESALE_PACKAGE', 'products', v_product_id,
    jsonb_build_object(
      'sale_unit_id', COALESCE(p_sale_unit_id, p_purchase_unit_id, p_unit_id),
      'units_per_sale_unit', p_units_per_sale_unit,
      'default_sale_price_in_minor_units',
        p_default_sale_price_in_minor_units,
      'opening_stock_created', false
    )
  );

  RETURN v_result || jsonb_build_object(
    'saleUnitId', COALESCE(p_sale_unit_id, p_purchase_unit_id, p_unit_id),
    'unitsPerSaleUnit', p_units_per_sale_unit,
    'defaultSalePriceInMinorUnits', p_default_sale_price_in_minor_units,
    'openingStockCreated', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_product_with_opening_stock_v4(
  TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER, BIGINT,
  UUID, INTEGER, BIGINT, BIGINT, INTEGER, INTEGER, UUID, INTEGER,
  TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_product_with_opening_stock_v4(
  TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER, BIGINT,
  UUID, INTEGER, BIGINT, BIGINT, INTEGER, INTEGER, UUID, INTEGER,
  TEXT, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.create_product_with_opening_stock_v4(
  TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER, BIGINT,
  UUID, INTEGER, BIGINT, BIGINT, INTEGER, INTEGER, UUID, INTEGER,
  TEXT, TEXT
) IS
  'Creates a wholesale product definition with zero stock. The opening-quantity argument remains only for signature compatibility and rejects non-zero input.';

-- Preserve the established RPC-only opening-inventory read model while
-- removing grouping-only masters from its product choices.
ALTER FUNCTION public.get_inventory_opening_setup(UUID)
  RENAME TO _get_inventory_opening_setup_including_flavor_masters_v1;

REVOKE ALL ON FUNCTION
  public._get_inventory_opening_setup_including_flavor_masters_v1(UUID)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_inventory_opening_setup(
  p_warehouse_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payload JSONB;
  v_products JSONB;
BEGIN
  v_payload :=
    public._get_inventory_opening_setup_including_flavor_masters_v1(
      p_warehouse_id
    );

  SELECT COALESCE(jsonb_agg(item.value ORDER BY item.ordinality), '[]'::JSONB)
  INTO v_products
  FROM jsonb_array_elements(COALESCE(v_payload->'products', '[]'::JSONB))
    WITH ORDINALITY AS item(value, ordinality)
  JOIN public.products p ON p.id = (item.value->>'productId')::UUID
  WHERE p.is_flavor_master = false;

  RETURN jsonb_set(v_payload, '{products}', v_products, true);
END;
$$;

REVOKE ALL ON FUNCTION public.get_inventory_opening_setup(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_opening_setup(UUID)
  TO authenticated;

COMMENT ON FUNCTION public.get_inventory_opening_setup(UUID) IS
  'Returns RPC-only opening inventory setup for stockable product/SKU rows; flavor masters are excluded.';

COMMIT;
