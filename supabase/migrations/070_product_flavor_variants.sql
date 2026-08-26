BEGIN;

-- A flavor family keeps commercial settings on one master product while each
-- flavor remains a real product/inventory unit. This preserves the existing
-- order, reservation, receiving and stock-count accounting paths.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS flavor_master_product_id UUID,
  ADD COLUMN IF NOT EXISTS flavor_name_ar TEXT,
  ADD COLUMN IF NOT EXISTS is_flavor_master BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flavor_sort_order INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_flavor_master_product_fk'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_flavor_master_product_fk
      FOREIGN KEY (flavor_master_product_id)
      REFERENCES public.products(id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_flavor_shape_check'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_flavor_shape_check CHECK (
        (
          flavor_master_product_id IS NULL
          AND flavor_name_ar IS NULL
        )
        OR (
          flavor_master_product_id IS NOT NULL
          AND NULLIF(BTRIM(flavor_name_ar), '') IS NOT NULL
          AND is_flavor_master = false
        )
      );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_products_flavor_master
  ON public.products(flavor_master_product_id, flavor_sort_order, name_ar)
  WHERE flavor_master_product_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_flavor_name_per_master
  ON public.products(
    flavor_master_product_id,
    LOWER(BTRIM(flavor_name_ar))
  )
  WHERE flavor_master_product_id IS NOT NULL;

COMMENT ON COLUMN public.products.flavor_master_product_id IS
  'Root product whose commercial price/package settings are inherited by this flavor.';
COMMENT ON COLUMN public.products.flavor_name_ar IS
  'Customer-visible flavor label. Stock remains independent on this product row.';
COMMENT ON COLUMN public.products.is_flavor_master IS
  'True when this root product is a non-sellable storefront family with sellable flavor children.';

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
  NEW.cost_price_in_minor_units := v_master.cost_price_in_minor_units;
  NEW.sale_price_in_minor_units := v_master.sale_price_in_minor_units;
  NEW.wholesale_price_in_minor_units :=
    v_master.wholesale_price_in_minor_units;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_flavor_inheritance ON public.products;
CREATE TRIGGER trg_products_flavor_inheritance
BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.enforce_product_flavor_inheritance();

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
      cost_price_in_minor_units = NEW.cost_price_in_minor_units,
      sale_price_in_minor_units = NEW.sale_price_in_minor_units,
      wholesale_price_in_minor_units = NEW.wholesale_price_in_minor_units,
      is_active = NEW.is_active,
      updated_at = NOW()
    WHERE flavor_master_product_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

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
  wholesale_price_in_minor_units
  ,is_active
ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.sync_product_flavor_commercial_settings();

CREATE OR REPLACE FUNCTION public.create_product_flavor_v1(
  p_master_product_id UUID,
  p_flavor_name_ar TEXT,
  p_opening_sale_packages INTEGER DEFAULT 0,
  p_warehouse_id UUID DEFAULT NULL,
  p_image_url TEXT DEFAULT NULL,
  p_barcode TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_master public.products%ROWTYPE;
  v_warehouse_id UUID;
  v_result JSONB;
  v_flavor_id UUID;
  v_flavor_name TEXT;
  v_sku TEXT;
  v_master_stock BIGINT;
  v_sort_order INTEGER;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إضافة نكهة للمنتج'
  );

  v_flavor_name := NULLIF(BTRIM(p_flavor_name_ar), '');
  IF v_flavor_name IS NULL THEN
    RAISE EXCEPTION 'اكتب اسم النكهة.';
  END IF;
  IF COALESCE(p_opening_sale_packages, 0) < 0 THEN
    RAISE EXCEPTION 'كمية الافتتاح لا يمكن أن تكون سالبة.';
  END IF;

  SELECT * INTO v_master
  FROM public.products
  WHERE id = p_master_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المنتج الأساسي غير موجود.';
  END IF;
  IF v_master.flavor_master_product_id IS NOT NULL THEN
    RAISE EXCEPTION 'اختر المنتج الأساسي وليس إحدى نكهاته.';
  END IF;
  IF NOT v_master.is_active THEN
    RAISE EXCEPTION 'فعّل المنتج الأساسي قبل إضافة النكهات.';
  END IF;
  IF v_master.sale_unit_id IS NULL
     OR COALESCE(v_master.units_per_sale_unit, 0) < 1
     OR COALESCE(v_master.default_sale_price_in_minor_units, 0) <= 0 THEN
    RAISE EXCEPTION 'أكمل طرد البيع وسعره في المنتج الأساسي أولًا.';
  END IF;

  IF NOT v_master.is_flavor_master THEN
    SELECT COALESCE(SUM(ib.on_hand_quantity + ib.reserved_quantity), 0)
      INTO v_master_stock
    FROM public.inventory_balances ib
    WHERE ib.product_id = v_master.id;

    IF v_master_stock <> 0 THEN
      RAISE EXCEPTION 'قبل تفعيل النكهات يجب أن يكون رصيد المنتج الأساسي صفرًا؛ بعدها أضف الرصيد لكل نكهة.';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.flavor_master_product_id = v_master.id
      AND LOWER(BTRIM(p.flavor_name_ar)) = LOWER(v_flavor_name)
  ) THEN
    RAISE EXCEPTION 'هذه النكهة موجودة مسبقًا.';
  END IF;

  v_warehouse_id := p_warehouse_id;
  IF v_warehouse_id IS NULL THEN
    SELECT w.id INTO v_warehouse_id
    FROM public.warehouses w
    WHERE w.is_active = true
    ORDER BY w.created_at, w.id
    LIMIT 1;
  END IF;
  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'لا يوجد مستودع نشط لإضافة رصيد النكهة.';
  END IF;

  SELECT COALESCE(MAX(p.flavor_sort_order), 0) + 10
    INTO v_sort_order
  FROM public.products p
  WHERE p.flavor_master_product_id = v_master.id;

  v_sku := LEFT(v_master.sku, 42) || '-F-' ||
    UPPER(SUBSTRING(MD5(v_flavor_name || CLOCK_TIMESTAMP()::TEXT), 1, 8));

  v_result := public.create_product_with_opening_stock_v4(
    v_sku,
    NULLIF(BTRIM(p_barcode), ''),
    v_master.name_ar || ' - ' || v_flavor_name,
    v_master.description,
    v_master.category_id,
    v_master.brand_id,
    v_master.unit_id,
    v_master.purchase_unit_id,
    v_master.units_per_purchase_unit,
    v_master.default_purchase_price_in_minor_units,
    v_master.sale_unit_id,
    v_master.units_per_sale_unit,
    v_master.default_sale_price_in_minor_units,
    v_master.cost_price_in_minor_units,
    v_master.min_stock_level,
    v_master.max_stock_level,
    v_warehouse_id,
    COALESCE(p_opening_sale_packages, 0) * v_master.units_per_sale_unit,
    'رصيد افتتاحي لنكهة ' || v_flavor_name,
    COALESCE(NULLIF(BTRIM(p_image_url), ''), (
      SELECT pi.image_url
      FROM public.product_images pi
      WHERE pi.product_id = v_master.id
      ORDER BY pi.is_primary DESC, pi.display_order, pi.created_at
      LIMIT 1
    ))
  );

  v_flavor_id := NULLIF(v_result->>'product_id', '')::UUID;
  IF v_flavor_id IS NULL THEN
    RAISE EXCEPTION 'تعذر إنشاء سجل النكهة.';
  END IF;

  UPDATE public.products
  SET
    flavor_master_product_id = v_master.id,
    flavor_name_ar = v_flavor_name,
    flavor_sort_order = v_sort_order,
    updated_at = NOW()
  WHERE id = v_flavor_id;

  UPDATE public.products
  SET is_flavor_master = true, updated_at = NOW()
  WHERE id = v_master.id;

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    auth.uid(),
    'CREATE_PRODUCT_FLAVOR',
    'products',
    v_flavor_id,
    jsonb_build_object(
      'master_product_id', v_master.id,
      'flavor_name_ar', v_flavor_name,
      'opening_sale_packages', COALESCE(p_opening_sale_packages, 0),
      'inherited_sale_price_in_minor_units',
        v_master.default_sale_price_in_minor_units
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'productId', v_flavor_id,
    'masterProductId', v_master.id,
    'flavorNameAr', v_flavor_name,
    'message', 'تمت إضافة النكهة بمخزون مستقل وسعر المنتج الأساسي.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_product_flavor_v1(
  UUID, TEXT, INTEGER, UUID, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_product_flavor_v1(
  UUID, TEXT, INTEGER, UUID, TEXT, TEXT
) TO authenticated;

-- Enrich the existing public wrapper with flavor metadata. No cost or supplier
-- fields are exposed. The customer client groups these rows into one card.
CREATE OR REPLACE FUNCTION public.get_public_storefront_catalog(
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0,
  p_category_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT public.get_public_product_catalog(
      p_limit, p_offset, p_category_id, p_search
    ) AS payload
  ),
  enriched_items AS (
    SELECT
      item.ordinality,
      item.value || jsonb_build_object(
        'createdAt', p.created_at,
        'soldPackagesLast90Days', COALESCE(sales.sold_packages, 0),
        'flavorMasterProductId', p.flavor_master_product_id,
        'flavorNameAr', p.flavor_name_ar,
        'isFlavorMaster', p.is_flavor_master,
        'flavorSortOrder', p.flavor_sort_order
      ) AS value
    FROM base
    CROSS JOIN LATERAL jsonb_array_elements(base.payload->'items')
      WITH ORDINALITY AS item(value, ordinality)
    JOIN public.products p ON p.id = (item.value->>'id')::UUID
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(COALESCE(oi.sale_package_quantity, 0)), 0)::BIGINT
        AS sold_packages
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.product_id = p.id
        AND o.status = 'completed'
        AND o.created_at >= NOW() - INTERVAL '90 days'
    ) sales ON true
  ),
  enriched_categories AS (
    SELECT
      category.ordinality,
      category.value || jsonb_build_object('imageUrl', c.image_url) AS value
    FROM base
    CROSS JOIN LATERAL jsonb_array_elements(base.payload->'categories')
      WITH ORDINALITY AS category(value, ordinality)
    LEFT JOIN public.categories c
      ON c.id = (category.value->>'id')::UUID
  )
  SELECT jsonb_set(
    jsonb_set(
      base.payload,
      '{items}',
      COALESCE(
        (SELECT jsonb_agg(value ORDER BY ordinality) FROM enriched_items),
        '[]'::jsonb
      )
    ),
    '{categories}',
    COALESCE(
      (SELECT jsonb_agg(value ORDER BY ordinality) FROM enriched_categories),
      '[]'::jsonb
    )
  )
  FROM base;
$$;

REVOKE ALL ON FUNCTION public.get_public_storefront_catalog(
  INTEGER, INTEGER, UUID, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_storefront_catalog(
  INTEGER, INTEGER, UUID, TEXT
) TO anon, authenticated;

COMMIT;
