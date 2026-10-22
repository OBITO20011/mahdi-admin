BEGIN;

-- Existing products keep their current methods. Historical documents are never
-- reclassified; this flag governs admission of NEW commercial sales only.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS parcel_only BOOLEAN NOT NULL DEFAULT false;
DO $constraint$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.products'::regclass
    AND conname='products_parcel_only_sale_size_check') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_parcel_only_sale_size_check
      CHECK (NOT parcel_only OR units_per_sale_unit > 1);
  END IF;
END $constraint$;
COMMENT ON COLUMN public.products.parcel_only IS
  'New sales require a proven commercial parcel. Flavor children inherit the master; historical documents/replays are unchanged.';

-- Discover the complete family before any inventory lock. Every participant
-- takes the same sorted advisory/balance/product hierarchy, then rechecks it.
CREATE OR REPLACE FUNCTION public.parcel209_inventory_family_set_internal(p_ids UUID[])
RETURNS UUID[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH roots AS (
    SELECT DISTINCT COALESCE(p.flavor_master_product_id,p.id) id
    FROM public.products p WHERE p.id=ANY(p_ids)
  )
  SELECT COALESCE(array_agg(DISTINCT id ORDER BY id),'{}'::UUID[]) FROM (
    SELECT unnest(p_ids) id
    UNION SELECT id FROM roots
    UNION SELECT p.id FROM public.products p JOIN roots r ON p.flavor_master_product_id=r.id
  ) members WHERE id IS NOT NULL;
$$;
ALTER FUNCTION public.parcel209_inventory_family_set_internal(UUID[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.parcel209_inventory_family_set_internal(UUID[])
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.phase2_lock_inventory_products_internal(p_product_ids UUID[])
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_ids UUID[];v_id UUID;v_requested INTEGER;v_found INTEGER;
BEGIN
  SELECT count(DISTINCT id) INTO v_requested FROM unnest(p_product_ids) id WHERE id IS NOT NULL;
  IF v_requested=0 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE2_PRODUCT_LOCK_SET_EMPTY: مجموعة منتجات الاستلام فارغة.';
  END IF;
  v_ids:=public.parcel209_inventory_family_set_internal(p_product_ids);
  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('inventory-product:'||v_id::TEXT,0));
  END LOOP;
  -- A newly created/moved flavor cannot be added late to an already locked set.
  IF v_ids IS DISTINCT FROM public.parcel209_inventory_family_set_internal(p_product_ids) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PARCEL209_FAMILY_CHANGED_RETRY: تغيّرت النكهات؛ حدّث البيانات ثم أعد المحاولة.';
  END IF;
  PERFORM b.id FROM public.inventory_balances b WHERE b.product_id=ANY(v_ids)
    ORDER BY b.product_id,b.warehouse_id FOR UPDATE;
  PERFORM p.id FROM public.products p WHERE p.id=ANY(v_ids) ORDER BY p.id FOR NO KEY UPDATE;
  SELECT count(*) INTO v_found FROM public.products p WHERE p.id=ANY(p_product_ids);
  IF v_found<>v_requested THEN
    RAISE EXCEPTION USING ERRCODE='23503',CONSTRAINT='phase2_receipt_product_lock_set_check',
      MESSAGE='PHASE2_PRODUCT_NOT_FOUND: أحد منتجات الاستلام غير موجود.';
  END IF;
  IF v_ids IS DISTINCT FROM public.parcel209_inventory_family_set_internal(p_product_ids) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PARCEL209_FAMILY_CHANGED_RETRY: تغيّرت النكهات؛ حدّث البيانات ثم أعد المحاولة.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.parcel209_effective_only_internal(p_product_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT COALESCE(master.parcel_only,p.parcel_only,false)
  FROM public.products p LEFT JOIN public.products master ON master.id=p.flavor_master_product_id
  WHERE p.id=p_product_id;
$$;
ALTER FUNCTION public.parcel209_effective_only_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.parcel209_effective_only_internal(UUID)
  FROM PUBLIC,anon,authenticated,service_role;

-- Input here is the existing canonical Phase-3 request, after its replay
-- decision and customer/shift locks, before configuration/family row locks.
CREATE OR REPLACE FUNCTION public.parcel209_guard_modern_lines_internal(p_lines JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_ids UUID[];v_line JSONB;
BEGIN
  SELECT array_agg(DISTINCT id ORDER BY id) INTO v_ids FROM (
    SELECT (line->>'product_id')::UUID id FROM jsonb_array_elements(p_lines) line
      WHERE line->>'commercial_line_kind' IN ('base_unit','legacy_single_sku_parcel')
    UNION SELECT (line->>'family_product_id')::UUID FROM jsonb_array_elements(p_lines) line
      WHERE line->>'commercial_line_kind'='configurable_parcel'
    UNION SELECT (component->>'product_id')::UUID FROM jsonb_array_elements(p_lines) line
      CROSS JOIN LATERAL jsonb_array_elements(line->'parcel_instances') instance
      CROSS JOIN LATERAL jsonb_array_elements(instance->'components') component
      WHERE line->>'commercial_line_kind'='configurable_parcel'
  ) requested WHERE id IS NOT NULL;
  PERFORM public.phase2_lock_inventory_products_internal(v_ids);
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF v_line->>'commercial_line_kind'='base_unit'
      AND public.parcel209_effective_only_internal((v_line->>'product_id')::UUID) THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='PARCEL209_UNIT_SALE_FORBIDDEN: هذا الصنف بيتباع بالطرد بس؛ اختر طرداً.';
    END IF;
  END LOOP;
END;
$$;
ALTER FUNCTION public.parcel209_guard_modern_lines_internal(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.parcel209_guard_modern_lines_internal(JSONB)
  FROM PUBLIC,anon,authenticated,service_role;

-- Legacy writers have no immutable modern commercial-line evidence. Do not
-- guess a parcel from a quantity divisible by the current parcel size.
CREATE OR REPLACE FUNCTION public.parcel209_guard_legacy_items_internal(p_items JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_ids UUID[];
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN RETURN;END IF;
  SELECT array_agg(DISTINCT (item->>'product_id')::UUID ORDER BY (item->>'product_id')::UUID)
    INTO v_ids FROM jsonb_array_elements(p_items) item WHERE item->>'product_id' IS NOT NULL;
  IF cardinality(v_ids)>0 THEN
    PERFORM public.phase2_lock_inventory_products_internal(v_ids);
    IF EXISTS(SELECT 1 FROM unnest(v_ids) id WHERE public.parcel209_effective_only_internal(id)) THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='PARCEL209_LEGACY_PARCEL_EVIDENCE_REQUIRED: هذا الصنف بيتباع بالطرد بس؛ استخدم البيع الحديث بالطرد.';
    END IF;
  END IF;
END;
$$;
ALTER FUNCTION public.parcel209_guard_legacy_items_internal(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.parcel209_guard_legacy_items_internal(JSONB)
  FROM PUBLIC,anon,authenticated,service_role;

-- The existing issuer has already resolved every immutable physical source.
-- Whole commercial evidence comes from those database roots, never a label
-- supplied by the caller or divisibility of an arbitrary unit-sale quantity.
CREATE OR REPLACE FUNCTION public.parcel209_guard_replacement_internal(p_prepared JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_root RECORD;v_item public.order_items%ROWTYPE;v_quantity BIGINT;
BEGIN
  FOR v_root IN
    SELECT DISTINCT (r->>'root_order_item_id')::UUID order_item_id,
      (r->>'root_parcel_instance_id')::UUID instance_id
    FROM jsonb_array_elements(p_prepared) r
    WHERE public.parcel209_effective_only_internal((r->>'product_id')::UUID)
  LOOP
    SELECT * INTO STRICT v_item FROM public.order_items WHERE id=v_root.order_item_id;
    IF v_root.instance_id IS NULL THEN
      SELECT sum((r->>'quantity')::BIGINT) INTO v_quantity
      FROM jsonb_array_elements(p_prepared) r
      WHERE (r->>'root_order_item_id')::UUID=v_root.order_item_id;
      IF v_item.commercial_line_kind IS DISTINCT FROM 'legacy_single_sku_parcel'
        OR COALESCE(v_item.units_per_sale_package,0)<=1
        OR v_quantity IS NULL OR v_quantity<=0
        OR v_quantity%v_item.units_per_sale_package<>0 THEN
        RAISE EXCEPTION USING ERRCODE='23514',
          MESSAGE='PARCEL209_REPLACEMENT_WHOLE_PARCEL_REQUIRED: الصنف بيتباع بالطرد بس؛ الاستبدال يحتاج طرداً تجارياً كاملاً مثبتاً في الفاتورة.';
      END IF;
    ELSE
      IF v_item.commercial_line_kind IS DISTINCT FROM 'configurable_parcel'
        OR NOT EXISTS(SELECT 1 FROM public.order_parcel_instances i
          WHERE i.id=v_root.instance_id AND i.order_item_id=v_root.order_item_id)
        OR EXISTS(
          SELECT 1 FROM public.order_parcel_components c WHERE c.parcel_instance_id=v_root.instance_id
          AND c.base_quantity IS DISTINCT FROM (
            SELECT COALESCE(sum((r->>'quantity')::BIGINT),0) FROM jsonb_array_elements(p_prepared) r
            WHERE (r->>'root_parcel_instance_id')::UUID=v_root.instance_id
              AND (r->>'root_parcel_component_id')::UUID=c.id
          )
        ) THEN
        RAISE EXCEPTION USING ERRCODE='23514',
          MESSAGE='PARCEL209_REPLACEMENT_WHOLE_PARCEL_REQUIRED: استبدل الطرد المشكّل كاملاً بكل نكهاته؛ الكمية الناقصة لا تكفي.';
      END IF;
    END IF;
  END LOOP;
END;
$$;
ALTER FUNCTION public.parcel209_guard_replacement_internal(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.parcel209_guard_replacement_internal(JSONB)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.parcel209_set_flag_internal(p_product_id UUID,p_value BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_old BOOLEAN;v_size INTEGER;v_parent UUID;
BEGIN
  IF p_value IS NULL THEN RAISE EXCEPTION 'PARCEL209_METHOD_INVALID: اختر طريقة بيع صحيحة.';END IF;
  PERFORM public.phase2_lock_inventory_products_internal(ARRAY[p_product_id]);
  SELECT parcel_only,units_per_sale_unit,flavor_master_product_id INTO STRICT v_old,v_size,v_parent
    FROM public.products WHERE id=p_product_id;
  IF v_parent IS NOT NULL THEN RAISE EXCEPTION 'PARCEL209_INHERITED_METHOD: طريقة بيع النكهة تتبع المنتج الأساسي.';END IF;
  IF p_value AND COALESCE(v_size,0)<=1 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PARCEL209_PARCEL_SIZE_REQUIRED: الطرد فقط يحتاج أكثر من وحدة في طرد البيع.';
  END IF;
  IF v_old IS DISTINCT FROM p_value THEN
    UPDATE public.products SET parcel_only=p_value,updated_at=now() WHERE id=p_product_id;
    INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details)
      VALUES(auth.uid(),'SET_PRODUCT_SALE_METHODS','products',p_product_id,
        jsonb_build_object('previous_parcel_only',v_old,'parcel_only',p_value,'units_per_sale_unit',v_size));
  END IF;
END;
$$;
ALTER FUNCTION public.parcel209_set_flag_internal(UUID,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.parcel209_set_flag_internal(UUID,BOOLEAN)
  FROM PUBLIC,anon,authenticated,service_role;

-- Explicit reviewed extensions of the delivered208 definitions follow.

CREATE OR REPLACE FUNCTION public.enforce_product_flavor_inheritance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  NEW.parcel_only := v_master.parcel_only;
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
$function$;

CREATE OR REPLACE FUNCTION public.sync_product_flavor_commercial_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      parcel_only = NEW.parcel_only,
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
$function$;

DROP TRIGGER trg_products_sync_flavor_settings ON public.products;
CREATE TRIGGER trg_products_sync_flavor_settings AFTER UPDATE OF
category_id,brand_id,unit_id,purchase_unit_id,units_per_purchase_unit,
default_purchase_price_in_minor_units,sale_unit_id,units_per_sale_unit,
default_sale_price_in_minor_units,sale_price_in_minor_units,wholesale_price_in_minor_units,
is_active,parcel_only ON public.products FOR EACH ROW
EXECUTE FUNCTION public.sync_product_flavor_commercial_settings();

CREATE OR REPLACE FUNCTION public.product_edit_assert_version_internal(p_product_id uuid, p_expected_updated_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_current TIMESTAMPTZ;
BEGIN
  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_EDIT_VERSION_REQUIRED: أعد فتح المنتج ثم احفظ التعديل.';
  END IF;

  PERFORM public.phase2_lock_inventory_products_internal(ARRAY[p_product_id]);

  SELECT product.updated_at
  INTO v_current
  FROM public.products product
  WHERE product.id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المنتج المحدد غير موجود.';
  END IF;

  IF v_current IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION USING
      MESSAGE = 'PRODUCT_EDIT_CONFLICT: عدّل مستخدم آخر هذا المنتج قبل قليل.',
      DETAIL = public.product_edit_snapshot_internal(p_product_id)::TEXT,
      HINT = 'اعرض القيم الحالية ثم أعد تطبيق تعديلاتك.';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.product_edit_snapshot_internal(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'productId', product.id,
    'parcelOnly', product.parcel_only,
    'updatedAt', product.updated_at,
    'nameAr', product.name_ar,
    'sku', product.sku,
    'barcode', product.barcode,
    'description', product.description,
    'categoryId', product.category_id,
    'brandId', product.brand_id,
    'unitName', base_unit.name_ar,
    'purchasePackage', purchase_unit.name_ar,
    'unitsPerPackage', product.units_per_purchase_unit,
    'defaultPurchasePriceInMinorUnits', product.default_purchase_price_in_minor_units,
    'salePackage', sale_unit.name_ar,
    'unitsPerSalePackage', product.units_per_sale_unit,
    'salePackagePriceInMinorUnits', product.default_sale_price_in_minor_units,
    'costPriceInMinorUnits', product.cost_price_in_minor_units,
    'minStockLevel', product.min_stock_level,
    'maxStockLevel', product.max_stock_level,
    'isActive', product.is_active,
    'flavorNameAr', product.flavor_name_ar,
    'imageUrl', (
      SELECT image.image_url
      FROM public.product_images image
      WHERE image.product_id = product.id AND image.is_primary = true
      ORDER BY image.display_order, image.created_at
      LIMIT 1
    )
  )
  FROM public.products product
  LEFT JOIN public.units base_unit ON base_unit.id = product.unit_id
  LEFT JOIN public.units purchase_unit ON purchase_unit.id = product.purchase_unit_id
  LEFT JOIN public.units sale_unit ON sale_unit.id = product.sale_unit_id
  WHERE product.id = p_product_id;
$function$;

CREATE OR REPLACE FUNCTION public.create_product_flavor_v1(p_master_product_id uuid, p_flavor_name_ar text, p_opening_sale_packages integer DEFAULT 0, p_warehouse_id uuid DEFAULT NULL::uuid, p_image_url text DEFAULT NULL::text, p_barcode text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  PERFORM public.phase2_lock_inventory_products_internal(ARRAY[p_master_product_id]);
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
$function$;

CREATE OR REPLACE FUNCTION public.save_product_parcel_configuration_v1(p_family_product_id uuid, p_composition_mode text, p_is_active boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_units INTEGER; v_ids UUID[]; v_configuration public.product_parcel_configurations%ROWTYPE;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'],'إعداد الطرود');
  PERFORM public.phase2_lock_inventory_products_internal(ARRAY[p_family_product_id]);
  PERFORM pg_advisory_xact_lock(hashtextextended('parcel-configuration|' || p_family_product_id::TEXT,0));
  SELECT * INTO v_configuration FROM public.product_parcel_configurations
  WHERE family_product_id=p_family_product_id FOR UPDATE;
  SELECT units_per_sale_unit INTO v_units FROM public.products WHERE id=p_family_product_id;
  IF v_configuration.id IS NOT NULL AND v_configuration.composition_mode=p_composition_mode THEN
    SELECT array_agg(allowed.product_id ORDER BY allowed.product_id) INTO v_ids
    FROM public.product_parcel_allowed_components allowed
    JOIN public.products component ON component.id=allowed.product_id AND component.is_active
    WHERE allowed.configuration_id=v_configuration.id;
  ELSE
    SELECT array_agg(product.id ORDER BY product.id) INTO v_ids FROM public.products product
    WHERE product.is_active AND CASE WHEN p_composition_mode='single_sku'
      THEN product.id=p_family_product_id
      ELSE product.flavor_master_product_id=p_family_product_id AND NOT product.is_flavor_master END;
  END IF;
  RETURN public.save_product_parcel_configuration_v1(
    p_family_product_id,p_composition_mode,p_is_active,v_units,COALESCE(v_ids,'{}'::UUID[]));
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_product_parcel_configuration_v1(p_family_product_id uuid, p_composition_mode text, p_is_active boolean, p_units_per_parcel integer, p_allowed_product_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_configuration public.product_parcel_configurations%ROWTYPE;
  v_family public.products%ROWTYPE; v_previous_ids UUID[]; v_ids UUID[];
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'], 'إعداد الطرود');
  IF p_composition_mode IS NULL OR p_composition_mode NOT IN ('single_sku','configurable_mix')
    OR p_is_active IS NULL OR p_units_per_parcel IS NULL OR p_units_per_parcel <= 0
    OR p_allowed_product_ids IS NULL OR array_position(p_allowed_product_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='PARCEL_CONFIGURATION_INVALID: راجع إعداد الطرد.';
  END IF;
  -- Configuration before family/product matches the sales validator order.
  -- Serialize creation of a previously absent configuration as well.
  PERFORM public.phase2_lock_inventory_products_internal(ARRAY[p_family_product_id]);
  PERFORM pg_advisory_xact_lock(hashtextextended('parcel-configuration|' || p_family_product_id::TEXT,0));
  SELECT * INTO v_configuration FROM public.product_parcel_configurations
  WHERE family_product_id=p_family_product_id FOR UPDATE;
  SELECT * INTO v_family FROM public.products WHERE id=p_family_product_id FOR UPDATE;
  IF NOT FOUND OR NOT v_family.is_active OR v_family.flavor_master_product_id IS NOT NULL
    OR v_family.sale_unit_id IS NULL
    OR (p_composition_mode='configurable_mix' AND NOT v_family.is_flavor_master) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='PARCEL_CONFIGURATION_INVALID: العائلة غير صالحة لهذا الطرد.';
  END IF;
  SELECT COALESCE(array_agg(id ORDER BY id),'{}'::UUID[]) INTO v_ids
  FROM (SELECT DISTINCT unnest(p_allowed_product_ids) id) ids;
  IF (p_is_active AND cardinality(v_ids)=0)
    OR (p_composition_mode='single_sku' AND v_ids IS DISTINCT FROM ARRAY[p_family_product_id])
    OR EXISTS(SELECT 1 FROM unnest(v_ids) requested(id)
      LEFT JOIN public.products component ON component.id=requested.id
      WHERE component.id IS NULL OR NOT component.is_active
        OR (p_composition_mode='configurable_mix' AND
          (component.flavor_master_product_id IS DISTINCT FROM p_family_product_id
            OR component.is_flavor_master))) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='PARCEL_COMPONENT_FAMILY_MISMATCH: النكهات المسموحة يجب أن تنتمي للعائلة نفسها.';
  END IF;
  SELECT COALESCE(array_agg(product_id ORDER BY product_id),'{}'::UUID[])
  INTO v_previous_ids FROM public.product_parcel_allowed_components
  WHERE configuration_id=v_configuration.id;
  IF v_family.units_per_sale_unit IS DISTINCT FROM p_units_per_parcel THEN
    UPDATE public.products SET units_per_sale_unit=p_units_per_parcel
    WHERE id=p_family_product_id;
  END IF;
  IF v_configuration.id IS NULL THEN
    INSERT INTO public.product_parcel_configurations(family_product_id,composition_mode,is_active,created_by,updated_by)
    VALUES(p_family_product_id,p_composition_mode,p_is_active,auth.uid(),auth.uid())
    RETURNING * INTO v_configuration;
  ELSE
    UPDATE public.product_parcel_configurations SET composition_mode=p_composition_mode,
      is_active=p_is_active,updated_by=auth.uid(),updated_at=now(),
      configuration_revision=configuration_revision+CASE WHEN
        v_configuration.composition_mode IS DISTINCT FROM p_composition_mode
        OR v_configuration.is_active IS DISTINCT FROM p_is_active
        OR v_family.units_per_sale_unit IS DISTINCT FROM p_units_per_parcel
        OR v_previous_ids IS DISTINCT FROM v_ids THEN 1 ELSE 0 END
    WHERE id=v_configuration.id RETURNING * INTO v_configuration;
  END IF;
  DELETE FROM public.product_parcel_allowed_components WHERE configuration_id=v_configuration.id;
  INSERT INTO public.product_parcel_allowed_components(configuration_id,product_id)
  SELECT v_configuration.id,unnest(v_ids);
  RETURN jsonb_build_object('success',true,'configuration',to_jsonb(v_configuration),
    'unitsPerParcel',p_units_per_parcel,'allowedProductIds',to_jsonb(v_ids));
END;
$function$;

CREATE OR REPLACE FUNCTION public.phase3_validate_configurable_parcel_internal(p_actor_scope_type text, p_actor_user_id uuid, p_family_product_id uuid, p_parcel_configuration_id uuid, p_configuration_revision integer, p_components jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result JSONB;
BEGIN
  -- Every caller, including receiving/quotes, takes inventory/family locks
  -- before the historical configuration/family snapshot locks.
  PERFORM public.phase2_lock_inventory_products_internal(ARRAY[p_family_product_id]||ARRAY(
    SELECT (c->>'product_id')::UUID FROM jsonb_array_elements(p_components) c));
  v_result:=public.package_d_validate_configurable_parcel_before_policy_internal(
    p_actor_scope_type,p_actor_user_id,p_family_product_id,p_parcel_configuration_id,
    p_configuration_revision,p_components);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_result->'components') component
    WHERE NOT EXISTS(SELECT 1 FROM public.product_parcel_allowed_components allowed
      WHERE allowed.configuration_id=p_parcel_configuration_id
        AND allowed.product_id=(component->>'product_id')::UUID)) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',
      MESSAGE='PARCEL_COMPONENT_NOT_ALLOWED: إحدى النكهات غير مسموحة لهذا الطرد.';
  END IF;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.parcel209_pos_sale_internal(p_warehouse_id uuid, p_branch_id uuid, p_customer_id uuid, p_customer_name text, p_payment_method text, p_lines jsonb, p_discount_in_minor_units bigint DEFAULT 0, p_amount_received_in_minor_units bigint DEFAULT 0, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_key TEXT := NULLIF(BTRIM(p_idempotency_key), '');
  v_payment_method TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_payment_method), ''), 'cash'));
  v_customer_name TEXT := COALESCE(NULLIF(BTRIM(p_customer_name), ''), 'زبون نقدي');
  v_customer_identity_hash TEXT;
  v_actor_hash TEXT;
  v_request JSONB;
  v_canonical_request JSONB;
  v_fingerprint TEXT;
  v_replay JSONB;
  v_line JSONB;
  v_instance JSONB;
  v_validated JSONB;
  v_cogs_allocation JSONB;
  v_plan_lines JSONB := '[]'::JSONB;
  v_final_lines JSONB := '[]'::JSONB;
  v_plan_instances JSONB;
  v_final_instances JSONB;
  v_plan_components JSONB;
  v_line_weighted_keys JSONB;
  v_instance_weighted_keys JSONB;
  v_product_ids UUID[];
  v_configuration_ids UUID[];
  v_family_ids UUID[];
  v_line_sequence INTEGER := 0;
  v_line_kind TEXT;
  v_product public.products%ROWTYPE;
  v_order_id UUID := gen_random_uuid();
  v_operation_id UUID := gen_random_uuid();
  v_order_item_id UUID;
  v_parcel_instance_id UUID;
  v_order_number TEXT;
  v_shift_id UUID;
  v_base_unit_name TEXT;
  v_parcel_unit_name TEXT;
  v_commercial_quantity INTEGER;
  v_base_quantity BIGINT;
  v_units_per_parcel INTEGER;
  v_unit_price BIGINT;
  v_line_gross BIGINT;
  v_line_cogs BIGINT;
  v_line_discount BIGINT;
  v_line_net BIGINT;
  v_line_profit BIGINT;
  v_instance_discount BIGINT;
  v_subtotal BIGINT := 0;
  v_total BIGINT;
  v_paid BIGINT;
  v_change BIGINT;
  v_demand RECORD;
  v_on_hand INTEGER;
  v_reserved INTEGER;
  v_balance_after INTEGER;
  v_result_items JSONB;
  v_result JSONB;
  v_component JSONB;
  v_movement_quantity INTEGER;
  v_constraint_name TEXT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'تنفيذ بيع نقطة البيع بالإصدار المحمي'
  );

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_ACTOR_NOT_AUTHORIZED: المستخدم الحالي غير مصادق عليه.';
  END IF;
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_IDEMPOTENCY_INPUT_INVALID: مفتاح إعادة المحاولة غير صالح.';
  END IF;
  IF p_warehouse_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_LOCATION_REQUIRED: المستودع والفرع مطلوبان.';
  END IF;
  IF COALESCE(p_discount_in_minor_units, -1) < 0
    OR COALESCE(p_amount_received_in_minor_units, -1) < 0
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_MONEY_INVALID: قيم الخصم أو المبلغ المستلم غير صالحة.';
  END IF;
  IF v_payment_method NOT IN (
    'cash', 'cliq', 'card', 'bank_transfer', 'debt', 'mixed'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_PAYMENT_METHOD_INVALID: طريقة الدفع غير معتمدة.';
  END IF;

  -- Cross-version order is deliberate: V1 and V2 first serialize on the exact
  -- same raw-key lock.  Only then may V2 enter its versioned operation lock.
  PERFORM pg_advisory_xact_lock(hashtext(v_key));

  v_actor_hash := public.phase3_actor_scope_hash_internal(
    'erp_user', v_user_id, NULL, NULL
  );
  IF p_customer_id IS NULL THEN
    v_customer_identity_hash := ENCODE(extensions.digest(
      'phase3:walk-in-customer:v1|' || LOWER(v_customer_name),
      'sha256'::TEXT
    ), 'hex');
  END IF;

  v_request := JSONB_BUILD_OBJECT(
    'contract_version', 'phase3-sale-v1',
    'actor_scope_type', 'erp_user',
    'actor_scope_hash', v_actor_hash,
    'operation_source', 'admin_pos',
    'warehouse_id', p_warehouse_id,
    'branch_id', p_branch_id,
    'customer_id', p_customer_id,
    'customer_identity_hash', v_customer_identity_hash,
    'payment_method', v_payment_method,
    'order_discount_in_minor_units', COALESCE(p_discount_in_minor_units, 0),
    'amount_received_in_minor_units', COALESCE(p_amount_received_in_minor_units, 0),
    'lines', p_lines
  );
  v_canonical_request := public.phase3_canonicalize_sale_request_internal(v_request);
  v_fingerprint := public.phase3_request_fingerprint_internal(v_canonical_request);
  v_replay := public.phase3_resolve_operation_replay_internal(
    'phase3_pos_sale_v1', v_key, 'erp_user', v_actor_hash, v_fingerprint
  );
  IF v_replay->>'decision' = 'REPLAY' THEN
    RETURN v_replay->'result_snapshot';
  END IF;

  -- A key already consumed by V1 can never be reconstructed as a proven V2
  -- request.  Reject generically without exposing the historical order.
  IF EXISTS (
    SELECT 1 FROM public.orders existing_order
    WHERE existing_order.idempotency_key = v_key
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_IDEMPOTENCY_CONFLICT: Operation identity is unavailable.';
  END IF;

  PERFORM 1
  FROM public.warehouses warehouse
  WHERE warehouse.id = p_warehouse_id
    AND warehouse.branch_id = p_branch_id
    AND warehouse.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_LOCATION_INVALID: المستودع لا يتبع الفرع المحدد أو غير نشط.';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT customer.full_name INTO v_customer_name
    FROM public.customers customer
    WHERE customer.id = p_customer_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_POS_CUSTOMER_INVALID: العميل المحدد غير موجود.';
    END IF;
  ELSIF v_payment_method = 'debt' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_DEBT_CUSTOMER_REQUIRED: البيع الآجل يحتاج عميلاً مسجلاً.';
  END IF;

  -- Shift precedes configuration/product/inventory locks throughout the paid
  -- operational paths and their reversal orchestrator.
  SELECT shift.id INTO v_shift_id
  FROM public.cash_shifts shift
  WHERE shift.branch_id = p_branch_id AND shift.status = 'open'
  ORDER BY shift.id
  LIMIT 1
  FOR SHARE;
  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_OPEN_SHIFT_REQUIRED: افتح وردية الصندوق قبل إتمام البيع.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
    WHERE candidate->>'commercial_line_kind' = 'configurable_parcel'
  ) THEN
    PERFORM public.phase3_assert_configurable_parcel_creation_allowed_internal(
      'erp_user', v_user_id
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
    WHERE COALESCE((candidate->>'line_discount_in_minor_units')::BIGINT, 0) <> 0
      OR candidate->>'price_authority' <> 'server_catalog'
      OR candidate->'commercial_unit_price_override_in_minor_units' <> 'null'::JSONB
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_PRICE_AUTHORITY_INVALID: هذا المسار يعتمد سعر الخادم وخصم الطلب الحالي فقط.';
  END IF;

  PERFORM public.parcel209_guard_modern_lines_internal(v_canonical_request->'lines');

  SELECT
    ARRAY_AGG(DISTINCT (candidate->>'parcel_configuration_id')::UUID
      ORDER BY (candidate->>'parcel_configuration_id')::UUID),
    ARRAY_AGG(DISTINCT (candidate->>'family_product_id')::UUID
      ORDER BY (candidate->>'family_product_id')::UUID)
  INTO v_configuration_ids, v_family_ids
  FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
  WHERE candidate->>'commercial_line_kind' = 'configurable_parcel';

  IF COALESCE(CARDINALITY(v_configuration_ids), 0) > 0 THEN
    PERFORM configuration.id
    FROM public.product_parcel_configurations configuration
    WHERE configuration.id = ANY(v_configuration_ids)
    ORDER BY configuration.id
    FOR SHARE;

    PERFORM family.id
    FROM public.products family
    WHERE family.id = ANY(v_family_ids)
    ORDER BY family.id
    FOR SHARE;
  END IF;

  SELECT ARRAY_AGG(DISTINCT identity.product_id ORDER BY identity.product_id)
  INTO v_product_ids
  FROM (
    SELECT (candidate->>'product_id')::UUID AS product_id
    FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
    WHERE candidate->>'commercial_line_kind' IN ('base_unit', 'legacy_single_sku_parcel')
    UNION ALL
    SELECT (component->>'product_id')::UUID
    FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(candidate->'parcel_instances') parcel
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(parcel->'components') component
    WHERE candidate->>'commercial_line_kind' = 'configurable_parcel'
  ) identity;

  -- Family is commercial identity, never stock identity. Keep its shared
  -- snapshot lock ahead of the global stock-product hierarchy, but never pass
  -- it to the inventory helper (which would attempt a row-lock upgrade).
  PERFORM public.phase3_lock_inventory_products_internal(v_product_ids);

  -- Build a complete immutable plan before any business row is inserted.
  FOR v_line IN
    SELECT value FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines')
    ORDER BY value::TEXT
  LOOP
    v_line_sequence := v_line_sequence + 1;
    v_order_item_id := gen_random_uuid();
    v_line_kind := v_line->>'commercial_line_kind';
    v_plan_instances := '[]'::JSONB;

    IF v_line_kind = 'base_unit' THEN
      SELECT * INTO v_product FROM public.products
      WHERE id = (v_line->>'product_id')::UUID AND is_active;
      IF NOT FOUND OR v_product.is_flavor_master THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_POS_PRODUCT_INVALID: منتج الوحدة الأساسية غير صالح للبيع.';
      END IF;
      v_commercial_quantity := (v_line->>'base_quantity')::INTEGER;
      v_base_quantity := v_commercial_quantity;
      v_units_per_parcel := 1;
      v_unit_price := v_product.sale_price_in_minor_units;
      v_line_cogs := v_base_quantity * v_product.cost_price_in_minor_units;
      SELECT COALESCE(unit.name_ar, 'وحدة') INTO v_base_unit_name
      FROM public.units unit WHERE unit.id = v_product.unit_id;
      v_base_unit_name := COALESCE(v_base_unit_name, 'وحدة');
      v_parcel_unit_name := v_base_unit_name;
    ELSIF v_line_kind = 'legacy_single_sku_parcel' THEN
      SELECT * INTO v_product FROM public.products
      WHERE id = (v_line->>'product_id')::UUID AND is_active;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_POS_PRODUCT_INVALID: منتج الطرد التجاري غير صالح للبيع.';
      END IF;
      IF v_product.units_per_sale_unit IS DISTINCT FROM
          (v_line->>'units_per_parcel')::INTEGER
        OR COALESCE(v_product.default_sale_price_in_minor_units, 0) <= 0
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_POS_PRICE_OR_PACKAGE_STALE: إعداد الطرد أو سعره تغير.';
      END IF;
      v_commercial_quantity := (v_line->>'parcel_quantity')::INTEGER;
      v_units_per_parcel := v_product.units_per_sale_unit;
      v_base_quantity := v_commercial_quantity::BIGINT * v_units_per_parcel::BIGINT;
      IF v_base_quantity > 2147483647 THEN
        RAISE EXCEPTION USING ERRCODE = '22003',
          MESSAGE = 'PHASE3_POS_QUANTITY_OVERFLOW: كمية الوحدات الأساسية تتجاوز الحد الآمن.';
      END IF;
      v_unit_price := v_product.default_sale_price_in_minor_units;
      v_line_cogs := v_base_quantity * v_product.cost_price_in_minor_units;
      SELECT COALESCE(base_unit.name_ar, 'وحدة'), COALESCE(parcel_unit.name_ar, 'طرد')
      INTO v_base_unit_name, v_parcel_unit_name
      FROM public.products product
      LEFT JOIN public.units base_unit ON base_unit.id = product.unit_id
      LEFT JOIN public.units parcel_unit ON parcel_unit.id = product.sale_unit_id
      WHERE product.id = v_product.id;
    ELSE
      SELECT * INTO v_product FROM public.products
      WHERE id = (v_line->>'family_product_id')::UUID AND is_active;
      IF NOT FOUND OR NOT v_product.is_flavor_master
        OR COALESCE(v_product.default_sale_price_in_minor_units, 0) <= 0
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_POS_PRICE_OR_PACKAGE_STALE: عائلة الطرد أو سعرها غير صالح.';
      END IF;
      v_commercial_quantity := (v_line->>'parcel_quantity')::INTEGER;
      v_units_per_parcel := v_product.units_per_sale_unit;
      v_base_quantity := v_commercial_quantity::BIGINT * v_units_per_parcel::BIGINT;
      v_unit_price := v_product.default_sale_price_in_minor_units;
      v_line_cogs := 0;
      SELECT COALESCE(base_unit.name_ar, 'وحدة'), COALESCE(parcel_unit.name_ar, 'طرد')
      INTO v_base_unit_name, v_parcel_unit_name
      FROM public.products product
      LEFT JOIN public.units base_unit ON base_unit.id = product.unit_id
      LEFT JOIN public.units parcel_unit ON parcel_unit.id = product.sale_unit_id
      WHERE product.id = v_product.id;

      FOR v_instance IN
        SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        v_validated := public.phase3_validate_configurable_parcel_internal(
          'erp_user', v_user_id, (v_line->>'family_product_id')::UUID,
          (v_line->>'parcel_configuration_id')::UUID,
          (v_line->>'configuration_revision')::INTEGER,
          v_instance->'components'
        );
        v_cogs_allocation := public.phase3_allocate_parcel_cogs_internal(
          v_validated->'components'
        );
        v_parcel_instance_id := gen_random_uuid();
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'component_id', gen_random_uuid(),
          'product_id', validated_component->>'product_id',
          'base_quantity', (validated_component->>'base_quantity')::INTEGER,
          'product_name_snapshot', validated_component->>'product_name_snapshot',
          'sku_snapshot', validated_component->>'sku_snapshot',
          'base_unit_name_snapshot', COALESCE(
            NULLIF(validated_component->>'base_unit_name_snapshot', ''),
            v_base_unit_name
          ),
          'unit_cost_in_minor_units_exact',
            (validated_component->>'unit_cost_in_minor_units_exact')::NUMERIC(24,6),
          'exact_cogs_in_minor_units',
            (allocated_component->>'exact_cogs_in_minor_units')::NUMERIC,
          'allocated_cogs_in_minor_units',
            (allocated_component->>'allocated_cogs_in_minor_units')::BIGINT
        ) ORDER BY (validated_component->>'product_id')::UUID)
        INTO v_plan_components
        FROM JSONB_ARRAY_ELEMENTS(v_validated->'components') validated_component
        JOIN JSONB_ARRAY_ELEMENTS(v_cogs_allocation->'components') allocated_component
          ON allocated_component->>'product_id' = validated_component->>'product_id';

        v_line_cogs := v_line_cogs
          + (v_cogs_allocation->>'total_cogs_in_minor_units')::BIGINT;
        v_plan_instances := v_plan_instances || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
          'instance_id', v_parcel_instance_id,
          'instance_sequence', (v_instance->>'instance_sequence')::INTEGER,
          'configuration_revision', (v_line->>'configuration_revision')::INTEGER,
          'units_per_parcel', (v_validated->>'units_per_parcel')::INTEGER,
          'composition_fingerprint', v_validated->>'composition_fingerprint',
          'gross_amount_in_minor_units', v_unit_price,
          'allocated_discount_in_minor_units', 0,
          'net_refundable_amount_in_minor_units', v_unit_price,
          'cogs_in_minor_units',
            (v_cogs_allocation->>'total_cogs_in_minor_units')::BIGINT,
          'components', v_plan_components
        ));
      END LOOP;
    END IF;

    v_line_gross := v_commercial_quantity::BIGINT * v_unit_price;
    IF v_line_gross < 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22003',
        MESSAGE = 'PHASE3_POS_MONEY_OVERFLOW: إجمالي السطر تجاوز الحد الآمن.';
    END IF;
    v_subtotal := v_subtotal + v_line_gross;
    v_plan_lines := v_plan_lines || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'line_sequence', v_line_sequence,
      'order_item_id', v_order_item_id,
      'commercial_line_kind', v_line_kind,
      'product_id', v_product.id,
      'product_name_snapshot', v_product.name_ar,
      'sku_snapshot', v_product.sku,
      'family_product_id', CASE WHEN v_line_kind = 'configurable_parcel'
        THEN v_line->>'family_product_id' ELSE NULL END,
      'parcel_configuration_id', CASE WHEN v_line_kind = 'configurable_parcel'
        THEN v_line->>'parcel_configuration_id' ELSE NULL END,
      'configuration_revision', CASE WHEN v_line_kind = 'configurable_parcel'
        THEN (v_line->>'configuration_revision')::INTEGER ELSE NULL END,
      'commercial_quantity', v_commercial_quantity,
      'base_quantity', v_base_quantity,
      'units_per_parcel', v_units_per_parcel,
      'base_unit_name_snapshot', v_base_unit_name,
      'parcel_unit_name_snapshot', v_parcel_unit_name,
      'unit_price_in_minor_units', v_unit_price,
      'gross_amount_in_minor_units', v_line_gross,
      'cogs_in_minor_units', v_line_cogs,
      'unit_cost_in_minor_units', CASE WHEN v_base_quantity = 0 THEN 0
        ELSE ROUND(v_line_cogs::NUMERIC / v_base_quantity)::BIGINT END,
      'parcel_instances', v_plan_instances
    ));
  END LOOP;

  IF COALESCE(p_discount_in_minor_units, 0) > v_subtotal THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_DISCOUNT_EXCEEDS_SUBTOTAL: الخصم يتجاوز مجموع البيع.';
  END IF;
  v_total := v_subtotal - COALESCE(p_discount_in_minor_units, 0);
  IF v_payment_method = 'cash'
    AND COALESCE(p_amount_received_in_minor_units, 0) > 0
    AND p_amount_received_in_minor_units < v_total
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_TENDER_INSUFFICIENT: المبلغ النقدي المستلم أقل من الإجمالي.';
  END IF;

  SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
    'key', line->>'line_sequence',
    'weight', (line->>'gross_amount_in_minor_units')::BIGINT
  ) ORDER BY (line->>'line_sequence')::INTEGER)
  INTO v_line_weighted_keys
  FROM JSONB_ARRAY_ELEMENTS(v_plan_lines) line;

  FOR v_line IN
    SELECT value FROM JSONB_ARRAY_ELEMENTS(v_plan_lines)
    ORDER BY (value->>'line_sequence')::INTEGER
  LOOP
    SELECT allocated_amount INTO v_line_discount
    FROM public.phase2_allocate_largest_remainder_internal(
      COALESCE(p_discount_in_minor_units, 0), v_line_weighted_keys
    ) allocation
    WHERE allocation.allocation_key = v_line->>'line_sequence';
    v_line_discount := COALESCE(v_line_discount, 0);
    v_line_gross := (v_line->>'gross_amount_in_minor_units')::BIGINT;
    v_line_cogs := (v_line->>'cogs_in_minor_units')::BIGINT;
    v_line_net := v_line_gross - v_line_discount;
    v_line_profit := v_line_net - v_line_cogs;
    v_final_instances := v_line->'parcel_instances';

    IF v_line->>'commercial_line_kind' = 'configurable_parcel' THEN
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'key', instance->>'instance_sequence',
        'weight', (instance->>'gross_amount_in_minor_units')::BIGINT
      ) ORDER BY (instance->>'instance_sequence')::INTEGER)
      INTO v_instance_weighted_keys
      FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances') instance;

      v_final_instances := '[]'::JSONB;
      FOR v_instance IN
        SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        SELECT allocated_amount INTO v_instance_discount
        FROM public.phase2_allocate_largest_remainder_internal(
          v_line_discount, v_instance_weighted_keys
        ) allocation
        WHERE allocation.allocation_key = v_instance->>'instance_sequence';
        v_instance_discount := COALESCE(v_instance_discount, 0);
        v_final_instances := v_final_instances || JSONB_BUILD_ARRAY(
          v_instance || JSONB_BUILD_OBJECT(
            'allocated_discount_in_minor_units', v_instance_discount,
            'net_refundable_amount_in_minor_units',
              (v_instance->>'gross_amount_in_minor_units')::BIGINT
                - v_instance_discount
          )
        );
      END LOOP;
    END IF;

    v_final_lines := v_final_lines || JSONB_BUILD_ARRAY(
      v_line || JSONB_BUILD_OBJECT(
        'allocated_discount_in_minor_units', v_line_discount,
        'net_refundable_amount_in_minor_units', v_line_net,
        'profit_in_minor_units', v_line_profit,
        'parcel_instances', v_final_instances
      )
    );
  END LOOP;

  IF (SELECT COALESCE(SUM((line->>'allocated_discount_in_minor_units')::BIGINT), 0)
      FROM JSONB_ARRAY_ELEMENTS(v_final_lines) line)
      IS DISTINCT FROM COALESCE(p_discount_in_minor_units, 0)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_DISCOUNT_RECONCILIATION_FAILED: تعذر توزيع الخصم بدقة.';
  END IF;

  -- Authoritative stock is rechecked only after every relevant balance is
  -- locked by the shared Phase-2/3 product protocol.
  FOR v_demand IN
    WITH demand AS (
      SELECT (line->>'product_id')::UUID AS product_id,
        (line->>'base_quantity')::INTEGER AS quantity
      FROM JSONB_ARRAY_ELEMENTS(v_final_lines) line
      WHERE line->>'commercial_line_kind' <> 'configurable_parcel'
      UNION ALL
      SELECT (component->>'product_id')::UUID,
        (component->>'base_quantity')::INTEGER
      FROM JSONB_ARRAY_ELEMENTS(v_final_lines) line
      CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(line->'parcel_instances') instance
      CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(instance->'components') component
      WHERE line->>'commercial_line_kind' = 'configurable_parcel'
    )
    SELECT product_id, SUM(quantity)::INTEGER AS quantity
    FROM demand GROUP BY product_id ORDER BY product_id
  LOOP
    SELECT balance.on_hand_quantity, balance.reserved_quantity
    INTO v_on_hand, v_reserved
    FROM public.inventory_balances balance
    WHERE balance.warehouse_id = p_warehouse_id
      AND balance.product_id = v_demand.product_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PARCEL_COMPONENT_NOT_STOCKED: أحد مكونات البيع لا يملك رصيدًا في المستودع.';
    END IF;
    IF v_on_hand - v_reserved < v_demand.quantity THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_POS_INSUFFICIENT_INVENTORY: مخزون أحد مكونات البيع غير كافٍ.';
    END IF;
  END LOOP;

  v_paid := CASE WHEN v_payment_method = 'debt' THEN 0 ELSE v_total END;
  v_change := CASE WHEN v_payment_method = 'cash' THEN GREATEST(
    COALESCE(p_amount_received_in_minor_units, v_total) - v_total, 0
  ) ELSE 0 END;
  v_order_number := 'POS-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-'
    || LPAD(NEXTVAL('public.pos_sale_number_seq')::TEXT, 6, '0');

  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
    'id', line->>'order_item_id',
    'productId', line->>'product_id',
    'productName', line->>'product_name_snapshot',
    'sku', line->>'sku_snapshot',
    'commercialLineKind', line->>'commercial_line_kind',
    'quantity', (line->>'commercial_quantity')::INTEGER,
    'baseQuantity', (line->>'base_quantity')::BIGINT,
    'unitsPerSalePackage', (line->>'units_per_parcel')::INTEGER,
    'salePackage', line->>'parcel_unit_name_snapshot',
    'unitPriceInMinorUnits', (line->>'unit_price_in_minor_units')::BIGINT,
    'lineTotalInMinorUnits', (line->>'gross_amount_in_minor_units')::BIGINT,
    'allocatedDiscountInMinorUnits',
      (line->>'allocated_discount_in_minor_units')::BIGINT,
    'netRefundableAmountInMinorUnits',
      (line->>'net_refundable_amount_in_minor_units')::BIGINT,
    'cogsInMinorUnits', (line->>'cogs_in_minor_units')::BIGINT,
    'profitInMinorUnits', (line->>'profit_in_minor_units')::BIGINT,
    'parcelInstances', line->'parcel_instances'
  ) ORDER BY (line->>'line_sequence')::INTEGER), '[]'::JSONB)
  INTO v_result_items
  FROM JSONB_ARRAY_ELEMENTS(v_final_lines) line;

  v_result := JSONB_BUILD_OBJECT(
    'success', true,
    'idempotentReplay', false,
    'operationId', v_operation_id,
    'orderId', v_order_id,
    'orderNumber', v_order_number,
    'customerName', v_customer_name,
    'warehouseId', p_warehouse_id,
    'branchId', p_branch_id,
    'cashShiftId', v_shift_id,
    'subtotalInMinorUnits', v_subtotal,
    'discountInMinorUnits', COALESCE(p_discount_in_minor_units, 0),
    'totalInMinorUnits', v_total,
    'amountPaidInMinorUnits', v_paid,
    'changeDueInMinorUnits', v_change,
    'paymentMethod', v_payment_method,
    'paymentStatus', CASE WHEN v_payment_method = 'debt' THEN 'unpaid' ELSE 'paid' END,
    'items', v_result_items,
    'message', 'تم حفظ بيع نقطة البيع بالإصدار المحمي وخصم الوحدات الأساسية بدقة.'
  );

  INSERT INTO public.business_operations (
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES (
    v_operation_id, 'phase3_pos_sale_v1', v_key, v_fingerprint, v_user_id,
    v_result, NOW(), 301, v_canonical_request, 'erp_user', v_actor_hash
  );

  BEGIN
    INSERT INTO public.orders (
      id, order_number, customer_id, customer_name_snapshot, branch_id,
      warehouse_id, status, payment_method, payment_status,
      subtotal_in_minor_units, delivery_fee_in_minor_units,
      discount_in_minor_units, total_in_minor_units,
      amount_paid_in_minor_units, change_due_in_minor_units,
      internal_notes, source, idempotency_key, operation_id
    ) VALUES (
      v_order_id, v_order_number, p_customer_id, v_customer_name, p_branch_id,
      p_warehouse_id, 'completed', v_payment_method,
      CASE WHEN v_payment_method = 'debt' THEN 'unpaid' ELSE 'paid' END,
      v_subtotal, 0, COALESCE(p_discount_in_minor_units, 0), v_total,
      v_paid, v_change, 'بيع POS V2 محمي', 'pos', v_key, v_operation_id
    );
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
    IF v_constraint_name = 'idx_orders_idempotency_key' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_IDEMPOTENCY_CONFLICT: Operation identity is unavailable.';
    END IF;
    RAISE;
  END;

  FOR v_line IN
    SELECT value FROM JSONB_ARRAY_ELEMENTS(v_final_lines)
    ORDER BY (value->>'line_sequence')::INTEGER
  LOOP
    INSERT INTO public.order_items (
      id, order_id, product_id, product_name_snapshot, sku_snapshot,
      quantity, unit_price_in_minor_units, line_total_in_minor_units,
      unit_cost_in_minor_units, cogs_in_minor_units, profit_in_minor_units,
      sale_package_quantity, units_per_sale_package,
      sale_package_name_snapshot, sale_package_price_in_minor_units,
      commercial_line_kind, family_product_id, parcel_configuration_id,
      parcel_configuration_revision, base_unit_name_snapshot,
      allocated_discount_snapshot_in_minor_units,
      net_refundable_amount_snapshot_in_minor_units
    ) VALUES (
      (v_line->>'order_item_id')::UUID, v_order_id,
      (v_line->>'product_id')::UUID, v_line->>'product_name_snapshot',
      v_line->>'sku_snapshot',
      CASE WHEN v_line->>'commercial_line_kind' = 'configurable_parcel'
        THEN (v_line->>'commercial_quantity')::INTEGER
        ELSE (v_line->>'base_quantity')::INTEGER END,
      (v_line->>'unit_price_in_minor_units')::BIGINT,
      (v_line->>'gross_amount_in_minor_units')::BIGINT,
      (v_line->>'unit_cost_in_minor_units')::BIGINT,
      (v_line->>'cogs_in_minor_units')::BIGINT,
      (v_line->>'profit_in_minor_units')::BIGINT,
      (v_line->>'commercial_quantity')::INTEGER,
      (v_line->>'units_per_parcel')::INTEGER,
      v_line->>'parcel_unit_name_snapshot',
      (v_line->>'unit_price_in_minor_units')::BIGINT,
      v_line->>'commercial_line_kind',
      NULLIF(v_line->>'family_product_id', '')::UUID,
      NULLIF(v_line->>'parcel_configuration_id', '')::UUID,
      NULLIF(v_line->>'configuration_revision', '')::INTEGER,
      v_line->>'base_unit_name_snapshot',
      (v_line->>'allocated_discount_in_minor_units')::BIGINT,
      (v_line->>'net_refundable_amount_in_minor_units')::BIGINT
    );

    -- The legacy insert trigger snapshots product cost.  Replace that draft
    -- value before any Parcel child exists, using the already planned COGS.
    UPDATE public.order_items
    SET unit_cost_in_minor_units = (v_line->>'unit_cost_in_minor_units')::BIGINT,
      cogs_in_minor_units = (v_line->>'cogs_in_minor_units')::BIGINT,
      profit_in_minor_units = (v_line->>'profit_in_minor_units')::BIGINT
    WHERE id = (v_line->>'order_item_id')::UUID;

    IF v_line->>'commercial_line_kind' = 'configurable_parcel' THEN
      FOR v_instance IN
        SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        INSERT INTO public.order_parcel_instances (
          id, order_item_id, order_id, operation_id, parcel_configuration_id,
          family_product_id, instance_sequence, configuration_revision,
          units_per_parcel_snapshot, parcel_unit_name_snapshot,
          gross_amount_snapshot_in_minor_units,
          allocated_discount_snapshot_in_minor_units,
          net_refundable_amount_snapshot_in_minor_units,
          cogs_snapshot_in_minor_units, composition_fingerprint
        ) VALUES (
          (v_instance->>'instance_id')::UUID,
          (v_line->>'order_item_id')::UUID, v_order_id, v_operation_id,
          (v_line->>'parcel_configuration_id')::UUID,
          (v_line->>'family_product_id')::UUID,
          (v_instance->>'instance_sequence')::INTEGER,
          (v_instance->>'configuration_revision')::INTEGER,
          (v_instance->>'units_per_parcel')::INTEGER,
          v_line->>'parcel_unit_name_snapshot',
          (v_instance->>'gross_amount_in_minor_units')::BIGINT,
          (v_instance->>'allocated_discount_in_minor_units')::BIGINT,
          (v_instance->>'net_refundable_amount_in_minor_units')::BIGINT,
          (v_instance->>'cogs_in_minor_units')::BIGINT,
          v_instance->>'composition_fingerprint'
        );

        FOR v_component IN
          SELECT value FROM JSONB_ARRAY_ELEMENTS(v_instance->'components')
          ORDER BY (value->>'product_id')::UUID
        LOOP
          INSERT INTO public.order_parcel_components (
            id, parcel_instance_id, operation_id, product_id, base_quantity,
            product_name_snapshot, sku_snapshot, base_unit_name_snapshot,
            unit_cost_snapshot_in_minor_units, cogs_snapshot_in_minor_units
          ) VALUES (
            (v_component->>'component_id')::UUID,
            (v_instance->>'instance_id')::UUID, v_operation_id,
            (v_component->>'product_id')::UUID,
            (v_component->>'base_quantity')::INTEGER,
            v_component->>'product_name_snapshot', v_component->>'sku_snapshot',
            v_component->>'base_unit_name_snapshot',
            (v_component->>'unit_cost_in_minor_units_exact')::NUMERIC(24,6),
            (v_component->>'allocated_cogs_in_minor_units')::BIGINT
          );
        END LOOP;
        PERFORM public.finalize_order_parcel_instance_internal(
          (v_instance->>'instance_id')::UUID
        );
      END LOOP;
    END IF;
  END LOOP;

  -- Apply the planned stock effects in deterministic commercial/component
  -- order.  Every balance was already checked and locked above.
  FOR v_line IN
    SELECT value FROM JSONB_ARRAY_ELEMENTS(v_final_lines)
    ORDER BY (value->>'line_sequence')::INTEGER
  LOOP
    IF v_line->>'commercial_line_kind' <> 'configurable_parcel' THEN
      v_movement_quantity := (v_line->>'base_quantity')::INTEGER;
      SELECT on_hand_quantity INTO v_on_hand
      FROM public.inventory_balances
      WHERE warehouse_id = p_warehouse_id
        AND product_id = (v_line->>'product_id')::UUID
      FOR UPDATE;
      v_balance_after := v_on_hand - v_movement_quantity;
      UPDATE public.inventory_balances
      SET on_hand_quantity = v_balance_after, updated_at = NOW()
      WHERE warehouse_id = p_warehouse_id
        AND product_id = (v_line->>'product_id')::UUID;
      INSERT INTO public.inventory_movements (
        warehouse_id, product_id, movement_type, quantity,
        balance_before, balance_after, reference_type, reference_id,
        notes, created_by, operation_id
      ) VALUES (
        p_warehouse_id, (v_line->>'product_id')::UUID,
        'sales_deduction', -v_movement_quantity, v_on_hand, v_balance_after,
        'pos_sale', v_order_id, 'بيع POS V2 رقم ' || v_order_number,
        v_user_id, v_operation_id
      );
    ELSE
      FOR v_instance IN
        SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        FOR v_component IN
          SELECT value FROM JSONB_ARRAY_ELEMENTS(v_instance->'components')
          ORDER BY (value->>'product_id')::UUID
        LOOP
          v_movement_quantity := (v_component->>'base_quantity')::INTEGER;
          SELECT on_hand_quantity INTO v_on_hand
          FROM public.inventory_balances
          WHERE warehouse_id = p_warehouse_id
            AND product_id = (v_component->>'product_id')::UUID
          FOR UPDATE;
          v_balance_after := v_on_hand - v_movement_quantity;
          UPDATE public.inventory_balances
          SET on_hand_quantity = v_balance_after, updated_at = NOW()
          WHERE warehouse_id = p_warehouse_id
            AND product_id = (v_component->>'product_id')::UUID;
          INSERT INTO public.inventory_movements (
            warehouse_id, product_id, movement_type, quantity,
            balance_before, balance_after, reference_type, reference_id,
            notes, created_by, operation_id, parcel_component_id
          ) VALUES (
            p_warehouse_id, (v_component->>'product_id')::UUID,
            'sales_deduction', -v_movement_quantity, v_on_hand, v_balance_after,
            'pos_sale', v_order_id, 'مكوّن طرد POS V2 رقم ' || v_order_number,
            v_user_id, v_operation_id, (v_component->>'component_id')::UUID
          );
        END LOOP;
      END LOOP;
    END IF;
  END LOOP;

  INSERT INTO public.order_status_history (
    order_id, old_status, new_status, changed_by, notes
  ) VALUES (
    v_order_id, NULL, 'completed', v_user_id,
    'بيع POS V2 مكتمل وخصم ذري للوحدات الأساسية'
  );

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    v_user_id, 'CREATE_POS_SALE_V2', 'orders', v_order_id,
    JSONB_BUILD_OBJECT(
      'operation_id', v_operation_id,
      'order_number', v_order_number,
      'cash_shift_id', v_shift_id,
      'subtotal_in_minor_units', v_subtotal,
      'discount_in_minor_units', COALESCE(p_discount_in_minor_units, 0),
      'total_in_minor_units', v_total,
      'commercial_lines', JSONB_ARRAY_LENGTH(v_final_lines)
    )
  );

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.parcel209_pos_sale_internal(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.parcel209_pos_sale_internal(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.parcel209_pos_customer_internal(p_warehouse_id uuid, p_branch_id uuid, p_customer_id uuid, p_customer_name text, p_payment_method text, p_lines jsonb, p_discount_in_minor_units bigint DEFAULT 0, p_amount_received_in_minor_units bigint DEFAULT 0, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Apply the exact centralized POS authorization/MFA policy before any
  -- Customer-specific lookup or lock.  The private implementation keeps the
  -- same guard as defense in depth after this serialization boundary.
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'تنفيذ بيع نقطة البيع بالإصدار المحمي'
  );

  IF p_customer_id IS NOT NULL THEN
    PERFORM 1
    FROM public.customers customer
    WHERE customer.id = p_customer_id
    FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_POS_CUSTOMER_INVALID: العميل المحدد غير موجود.';
    END IF;
  END IF;

  RETURN public.parcel209_pos_sale_internal(
    p_warehouse_id,
    p_branch_id,
    p_customer_id,
    p_customer_name,
    p_payment_method,
    p_lines,
    p_discount_in_minor_units,
    p_amount_received_in_minor_units,
    p_idempotency_key
  );
END;
$function$;

ALTER FUNCTION public.parcel209_pos_customer_internal(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.parcel209_pos_customer_internal(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.create_pos_sale_v2(p_warehouse_id uuid, p_branch_id uuid, p_customer_id uuid, p_customer_name text, p_payment_method text, p_lines jsonb, p_discount_in_minor_units bigint DEFAULT 0, p_amount_received_in_minor_units bigint DEFAULT 0, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_key TEXT:=nullif(btrim(p_idempotency_key),'');
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','sales'],'تنفيذ بيع الكاشير');
  IF v_key IS NULL OR length(v_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION 'PHASE3_IDEMPOTENCY_INPUT_INVALID: Invalid POS key';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_key));
  IF EXISTS(SELECT 1 FROM public.pos_uncommitted_attempt_cancellations
    WHERE actor_id=auth.uid() AND idempotency_key=v_key) THEN
    RAISE EXCEPTION 'PACKAGE_D_POS_ATTEMPT_CANCELLED: هذه المحاولة ألغيت بعد إثبات عدم تسجيلها؛ ابدأ بيعاً جديداً';
  END IF;
  -- Historical committed replay still uses its exact original payment fact.
  IF NOT EXISTS(SELECT 1 FROM public.business_operations WHERE idempotency_key=v_key)
    AND (p_payment_method IS NULL OR lower(btrim(p_payment_method)) NOT IN ('cash','cliq','debt')) THEN
    RAISE EXCEPTION 'PHASE3_POS_PAYMENT_METHOD_INVALID: الكاشير يدعم كاش وCliQ ودين فقط';
  END IF;
  RETURN public.parcel209_pos_customer_internal(
    p_warehouse_id,p_branch_id,p_customer_id,p_customer_name,p_payment_method,p_lines,
    p_discount_in_minor_units,p_amount_received_in_minor_units,p_idempotency_key);
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_guest_customer_order_v2(p_idempotency_key text, p_guest_phone_hash text, p_guest_session_hash text, p_customer_full_name text, p_customer_phone text, p_governorate text, p_city text, p_area text, p_street text, p_building text, p_address_notes text, p_google_maps_url text, p_latitude double precision, p_longitude double precision, p_customer_notes text, p_lines jsonb, p_promotion_code text, p_payment_method text, p_delivery_zone text, p_expected_subtotal_in_minor_units bigint, p_expected_discount_in_minor_units bigint, p_expected_delivery_fee_in_minor_units bigint, p_expected_total_in_minor_units bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key TEXT := LOWER(NULLIF(BTRIM(p_idempotency_key), ''));
  v_phone TEXT := public.normalize_customer_phone(p_customer_phone);
  v_payment_method TEXT := LOWER(NULLIF(BTRIM(p_payment_method), ''));
  v_delivery_zone TEXT := LOWER(NULLIF(BTRIM(p_delivery_zone), ''));
  v_actor_hash TEXT;
  v_delivery_hash TEXT;
  v_request JSONB;
  v_canonical_request JSONB;
  v_quote_lines JSONB;
  v_fingerprint TEXT;
  v_replay JSONB;
  v_line JSONB;
  v_instance JSONB;
  v_component JSONB;
  v_validated JSONB;
  v_plan_lines JSONB := '[]'::JSONB;
  v_final_lines JSONB := '[]'::JSONB;
  v_plan_instances JSONB;
  v_plan_components JSONB;
  v_line_weights JSONB;
  v_instance_weights JSONB;
  v_product_ids UUID[];
  v_configuration_ids UUID[];
  v_family_ids UUID[];
  v_line_sequence INTEGER := 0;
  v_line_kind TEXT;
  v_line_identity TEXT;
  v_expected_price BIGINT;
  v_product public.products%ROWTYPE;
  v_settings public.storefront_settings%ROWTYPE;
  v_order_id UUID := gen_random_uuid();
  v_operation_id UUID := gen_random_uuid();
  v_order_item_id UUID;
  v_instance_id UUID;
  v_customer_id UUID;
  v_address_id UUID := gen_random_uuid();
  v_customer_reused BOOLEAN := false;
  v_customer_is_blocked BOOLEAN;
  v_customer_is_active BOOLEAN;
  v_branch_id UUID;
  v_warehouse_id UUID;
  v_order_number TEXT;
  v_tracking_token UUID := gen_random_uuid();
  v_base_unit_name TEXT;
  v_parcel_unit_name TEXT;
  v_commercial_quantity INTEGER;
  v_base_quantity BIGINT;
  v_units_per_parcel INTEGER;
  v_unit_price BIGINT;
  v_line_gross BIGINT;
  v_line_discount BIGINT;
  v_line_net BIGINT;
  v_instance_discount BIGINT;
  v_subtotal BIGINT := 0;
  v_discount BIGINT := 0;
  v_delivery_fee BIGINT;
  v_total BIGINT;
  v_promotion public.promotion_codes%ROWTYPE;
  v_promotion_id UUID;
  v_promotion_code TEXT;
  v_recent_orders INTEGER;
  v_demand RECORD;
  v_on_hand INTEGER;
  v_reserved INTEGER;
  v_result_items JSONB;
  v_result JSONB;
  v_formatted_address TEXT;
  v_google_maps_url TEXT;
  v_location_source TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_ACTOR_NOT_AUTHORIZED: Customer V2 requires the protected gateway.';
  END IF;
  IF v_key IS NULL
    OR v_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR COALESCE(p_guest_phone_hash, '') !~ '^[0-9a-f]{64}$'
    OR COALESCE(p_guest_session_hash, '') !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_IDEMPOTENCY_INPUT_INVALID: Customer operation identity is invalid.';
  END IF;
  IF NULLIF(BTRIM(p_customer_full_name), '') IS NULL
    OR CHAR_LENGTH(BTRIM(p_customer_full_name)) NOT BETWEEN 2 AND 120
    OR v_phone !~ '^07[789][0-9]{7}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_INPUT_INVALID: Customer identity is invalid.';
  END IF;
  IF NULLIF(BTRIM(p_governorate), '') IS NULL
    OR NULLIF(BTRIM(p_city), '') IS NULL
    OR NULLIF(BTRIM(p_area), '') IS NULL
    OR NULLIF(BTRIM(p_street), '') IS NULL
    OR CHAR_LENGTH(BTRIM(p_governorate)) > 80
    OR CHAR_LENGTH(BTRIM(p_city)) > 80
    OR CHAR_LENGTH(BTRIM(p_area)) > 120
    OR CHAR_LENGTH(BTRIM(p_street)) > 300
    OR CHAR_LENGTH(COALESCE(BTRIM(p_building), '')) > 120
    OR CHAR_LENGTH(COALESCE(BTRIM(p_address_notes), '')) > 500
    OR CHAR_LENGTH(COALESCE(BTRIM(p_customer_notes), '')) > 1000
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_INPUT_INVALID: Address fields are invalid.';
  END IF;
  IF (p_latitude IS NULL) <> (p_longitude IS NULL)
    OR (p_latitude IS NOT NULL AND (
      p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180
    ))
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_INPUT_INVALID: Delivery coordinates are invalid.';
  END IF;
  IF v_payment_method NOT IN ('cash_on_delivery', 'cliq')
    OR v_delivery_zone NOT IN ('inside_ramtha', 'outside_ramtha')
    OR COALESCE(p_expected_subtotal_in_minor_units, -1) < 0
    OR COALESCE(p_expected_discount_in_minor_units, -1) < 0
    OR COALESCE(p_expected_delivery_fee_in_minor_units, -1) < 0
    OR COALESCE(p_expected_total_in_minor_units, -1) < 0
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_QUOTE_INVALID: Customer quote is invalid.';
  END IF;

  IF JSONB_TYPEOF(p_lines) IS DISTINCT FROM 'array'
    OR JSONB_ARRAY_LENGTH(p_lines) NOT BETWEEN 1 AND 50
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Customer lines are invalid.';
  END IF;

  SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
    'line_identity', public.phase3_customer_line_identity_internal(value),
    'expected_unit_price_in_minor_units',
      public.phase3_require_nonnegative_bigint_internal(
        value->>'expected_unit_price_in_minor_units',
        'expected_unit_price_in_minor_units'
      )
  ) ORDER BY public.phase3_customer_line_identity_internal(value))
  INTO v_quote_lines
  FROM JSONB_ARRAY_ELEMENTS(p_lines);

  IF EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(p_lines) candidate
    GROUP BY public.phase3_customer_line_identity_internal(candidate)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Customer commercial identities must be unique.';
  END IF;

  v_actor_hash := public.phase3_actor_scope_hash_internal(
    'guest_gateway', NULL, LOWER(p_guest_phone_hash), LOWER(p_guest_session_hash)
  );
  v_delivery_hash := ENCODE(extensions.digest(
    JSONB_BUILD_OBJECT(
      'governorate', BTRIM(p_governorate), 'city', BTRIM(p_city),
      'area', BTRIM(p_area), 'street', BTRIM(p_street),
      'building', NULLIF(BTRIM(p_building), ''),
      'latitude', p_latitude, 'longitude', p_longitude
    )::TEXT, 'sha256'::TEXT
  ), 'hex');

  v_request := JSONB_BUILD_OBJECT(
    'contract_version', 'phase3-sale-v1',
    'actor_scope_type', 'guest_gateway',
    'actor_scope_hash', v_actor_hash,
    'operation_source', 'customer_reservation',
    'warehouse_id', '00000000-0000-0000-0000-000000000001',
    'customer_identity_hash', LOWER(p_guest_phone_hash),
    'delivery_identity_hash', v_delivery_hash,
    'payment_method', v_payment_method,
    'delivery_zone', v_delivery_zone,
    'promotion_code', NULLIF(BTRIM(p_promotion_code), ''),
    'order_discount_in_minor_units', 0,
    'lines', p_lines
  );
  v_canonical_request := public.phase3_canonicalize_sale_request_internal(v_request)
    || JSONB_BUILD_OBJECT('customer_quote', JSONB_BUILD_OBJECT(
      'lines', v_quote_lines,
      'subtotal_in_minor_units', p_expected_subtotal_in_minor_units,
      'discount_in_minor_units', p_expected_discount_in_minor_units,
      'delivery_fee_in_minor_units', p_expected_delivery_fee_in_minor_units,
      'total_in_minor_units', p_expected_total_in_minor_units
    ));
  v_fingerprint := public.phase3_request_fingerprint_internal(v_canonical_request);

  -- Same raw-key lock as V1. Replay is decided before current feature, price,
  -- configuration, inventory or storefront state is consulted.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));
  v_replay := public.phase3_resolve_operation_replay_internal(
    'phase3_customer_reservation_v1', v_key, 'guest_gateway',
    v_actor_hash, v_fingerprint
  );
  IF v_replay->>'decision' = 'REPLAY' THEN
    RETURN v_replay->'result_snapshot';
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE idempotency_key = v_key) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_IDEMPOTENCY_CONFLICT: Operation identity is unavailable.';
  END IF;

  SELECT * INTO v_settings FROM public.storefront_settings
  WHERE id = '00000000-0000-0000-0000-000000000001'::UUID FOR SHARE;
  IF NOT FOUND OR NOT COALESCE(v_settings.orders_enabled, false) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_ORDERS_DISABLED: Customer orders are unavailable.';
  END IF;
  IF v_delivery_zone = 'inside_ramtha'
    AND CONCAT_WS(' ', p_governorate, p_city, p_area) NOT ILIKE '%الرمثا%'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_DELIVERY_ZONE_MISMATCH: Delivery zone does not match address.';
  END IF;

  SELECT warehouse.branch_id, warehouse.id
  INTO v_branch_id, v_warehouse_id
  FROM public.warehouses warehouse
  JOIN public.branches branch ON branch.id = warehouse.branch_id
  WHERE warehouse.is_active AND branch.is_active
  ORDER BY warehouse.created_at, warehouse.id
  LIMIT 1;
  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_LOCATION_UNAVAILABLE: No active storefront warehouse.';
  END IF;

  -- Customer V1 already serializes normalized customer identity before taking
  -- inventory locks.  V2 follows the same relative order so mixed-version
  -- requests cannot form Customer -> Inventory / Inventory -> Customer cycles.
  PERFORM pg_advisory_xact_lock(hashtext(v_phone)::BIGINT);
  SELECT id, is_blocked, is_active INTO
    v_customer_id, v_customer_is_blocked, v_customer_is_active
  FROM public.customers
  WHERE public.normalize_customer_phone(phone) = v_phone AND is_deleted = false
  LIMIT 1 FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
    WHERE candidate->>'commercial_line_kind' = 'configurable_parcel'
  ) THEN
    PERFORM public.phase3_assert_configurable_parcel_creation_allowed_internal(
      'guest_gateway', NULL
    );
  END IF;

  PERFORM public.parcel209_guard_modern_lines_internal(v_canonical_request->'lines');

  SELECT ARRAY_AGG(DISTINCT (candidate->>'parcel_configuration_id')::UUID
      ORDER BY (candidate->>'parcel_configuration_id')::UUID),
    ARRAY_AGG(DISTINCT (candidate->>'family_product_id')::UUID
      ORDER BY (candidate->>'family_product_id')::UUID)
  INTO v_configuration_ids, v_family_ids
  FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
  WHERE candidate->>'commercial_line_kind' = 'configurable_parcel';
  IF COALESCE(CARDINALITY(v_configuration_ids), 0) > 0 THEN
    PERFORM configuration.id FROM public.product_parcel_configurations configuration
    WHERE configuration.id = ANY(v_configuration_ids)
    ORDER BY configuration.id FOR SHARE;
    PERFORM family.id FROM public.products family
    WHERE family.id = ANY(v_family_ids)
    ORDER BY family.id FOR SHARE;
  END IF;

  SELECT ARRAY_AGG(DISTINCT identity.product_id ORDER BY identity.product_id)
  INTO v_product_ids
  FROM (
    SELECT (candidate->>'product_id')::UUID AS product_id
    FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
    WHERE candidate->>'commercial_line_kind' IN ('base_unit', 'legacy_single_sku_parcel')
    UNION ALL
    SELECT (component->>'product_id')::UUID
    FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(candidate->'parcel_instances') parcel
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(parcel->'components') component
    WHERE candidate->>'commercial_line_kind' = 'configurable_parcel'
  ) identity;
  PERFORM public.phase3_lock_inventory_products_internal(v_product_ids);

  FOR v_line IN
    SELECT value FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines')
    ORDER BY value::TEXT
  LOOP
    v_line_sequence := v_line_sequence + 1;
    v_order_item_id := gen_random_uuid();
    v_line_kind := v_line->>'commercial_line_kind';
    v_line_identity := public.phase3_customer_line_identity_internal(v_line);
    SELECT public.phase3_require_nonnegative_bigint_internal(
      raw_line->>'expected_unit_price_in_minor_units',
      'expected_unit_price_in_minor_units'
    ) INTO v_expected_price
    FROM JSONB_ARRAY_ELEMENTS(p_lines) raw_line
    WHERE public.phase3_customer_line_identity_internal(raw_line) = v_line_identity;
    v_plan_instances := '[]'::JSONB;

    IF v_line_kind = 'base_unit' THEN
      SELECT * INTO v_product FROM public.products
      WHERE id = (v_line->>'product_id')::UUID AND is_active;
      IF NOT FOUND OR v_product.is_flavor_master THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_CUSTOMER_PRODUCT_INVALID: Base Unit is unavailable.';
      END IF;
      v_commercial_quantity := (v_line->>'base_quantity')::INTEGER;
      v_base_quantity := v_commercial_quantity;
      v_units_per_parcel := 1;
      v_unit_price := v_product.sale_price_in_minor_units;
      SELECT COALESCE(unit.name_ar, 'وحدة') INTO v_base_unit_name
      FROM public.units unit WHERE unit.id = v_product.unit_id;
      v_base_unit_name := COALESCE(v_base_unit_name, 'وحدة');
      v_parcel_unit_name := v_base_unit_name;
    ELSIF v_line_kind = 'legacy_single_sku_parcel' THEN
      SELECT * INTO v_product FROM public.products
      WHERE id = (v_line->>'product_id')::UUID AND is_active;
      IF NOT FOUND OR v_product.units_per_sale_unit IS DISTINCT FROM
          (v_line->>'units_per_parcel')::INTEGER
        OR COALESCE(v_product.default_sale_price_in_minor_units, 0) <= 0
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_CUSTOMER_PRICE_OR_PACKAGE_STALE: Legacy Parcel changed.';
      END IF;
      v_commercial_quantity := (v_line->>'parcel_quantity')::INTEGER;
      v_units_per_parcel := v_product.units_per_sale_unit;
      v_base_quantity := v_commercial_quantity::BIGINT * v_units_per_parcel;
      v_unit_price := v_product.default_sale_price_in_minor_units;
      SELECT COALESCE(base_unit.name_ar, 'وحدة'), COALESCE(parcel_unit.name_ar, 'طرد')
      INTO v_base_unit_name, v_parcel_unit_name
      FROM public.products product
      LEFT JOIN public.units base_unit ON base_unit.id = product.unit_id
      LEFT JOIN public.units parcel_unit ON parcel_unit.id = product.sale_unit_id
      WHERE product.id = v_product.id;
    ELSE
      SELECT * INTO v_product FROM public.products
      WHERE id = (v_line->>'family_product_id')::UUID AND is_active;
      IF NOT FOUND OR NOT v_product.is_flavor_master
        OR COALESCE(v_product.default_sale_price_in_minor_units, 0) <= 0
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_CUSTOMER_PRICE_OR_PACKAGE_STALE: Configurable Parcel changed.';
      END IF;
      v_commercial_quantity := (v_line->>'parcel_quantity')::INTEGER;
      v_units_per_parcel := v_product.units_per_sale_unit;
      v_base_quantity := v_commercial_quantity::BIGINT * v_units_per_parcel;
      v_unit_price := v_product.default_sale_price_in_minor_units;
      SELECT COALESCE(base_unit.name_ar, 'وحدة'), COALESCE(parcel_unit.name_ar, 'طرد')
      INTO v_base_unit_name, v_parcel_unit_name
      FROM public.products product
      LEFT JOIN public.units base_unit ON base_unit.id = product.unit_id
      LEFT JOIN public.units parcel_unit ON parcel_unit.id = product.sale_unit_id
      WHERE product.id = v_product.id;

      FOR v_instance IN
        SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        v_validated := public.phase3_validate_configurable_parcel_internal(
          'guest_gateway', NULL, (v_line->>'family_product_id')::UUID,
          (v_line->>'parcel_configuration_id')::UUID,
          (v_line->>'configuration_revision')::INTEGER,
          v_instance->'components'
        );
        v_instance_id := gen_random_uuid();
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'component_id', gen_random_uuid(),
          'reservation_id', gen_random_uuid(),
          'product_id', component->>'product_id',
          'base_quantity', (component->>'base_quantity')::INTEGER,
          'product_name_snapshot', component->>'product_name_snapshot',
          'sku_snapshot', component->>'sku_snapshot',
          'base_unit_name_snapshot', COALESCE(
            NULLIF(component->>'base_unit_name_snapshot', ''), v_base_unit_name
          )
        ) ORDER BY (component->>'product_id')::UUID)
        INTO v_plan_components
        FROM JSONB_ARRAY_ELEMENTS(v_validated->'components') component;
        v_plan_instances := v_plan_instances || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
          'instance_id', v_instance_id,
          'instance_sequence', (v_instance->>'instance_sequence')::INTEGER,
          'configuration_revision', (v_line->>'configuration_revision')::INTEGER,
          'units_per_parcel', (v_validated->>'units_per_parcel')::INTEGER,
          'composition_fingerprint', v_validated->>'composition_fingerprint',
          'gross_amount_in_minor_units', v_unit_price,
          'components', v_plan_components
        ));
      END LOOP;
    END IF;

    IF v_base_quantity > 2147483647 THEN
      RAISE EXCEPTION USING ERRCODE = '22003',
        MESSAGE = 'PHASE3_CUSTOMER_QUANTITY_OVERFLOW: Base quantity exceeds safe capacity.';
    END IF;
    IF v_unit_price IS DISTINCT FROM v_expected_price THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_QUOTE_STALE: Commercial price changed.';
    END IF;
    v_line_gross := v_commercial_quantity::BIGINT * v_unit_price;
    v_subtotal := v_subtotal + v_line_gross;
    v_plan_lines := v_plan_lines || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'line_sequence', v_line_sequence,
      'order_item_id', v_order_item_id,
      'reservation_id', CASE WHEN v_line_kind = 'configurable_parcel'
        THEN NULL ELSE gen_random_uuid() END,
      'commercial_line_kind', v_line_kind,
      'product_id', v_product.id,
      'product_name_snapshot', v_product.name_ar,
      'sku_snapshot', v_product.sku,
      'family_product_id', CASE WHEN v_line_kind = 'configurable_parcel'
        THEN v_line->>'family_product_id' ELSE NULL END,
      'parcel_configuration_id', CASE WHEN v_line_kind = 'configurable_parcel'
        THEN v_line->>'parcel_configuration_id' ELSE NULL END,
      'configuration_revision', CASE WHEN v_line_kind = 'configurable_parcel'
        THEN (v_line->>'configuration_revision')::INTEGER ELSE NULL END,
      'commercial_quantity', v_commercial_quantity,
      'base_quantity', v_base_quantity,
      'units_per_parcel', v_units_per_parcel,
      'base_unit_name_snapshot', v_base_unit_name,
      'parcel_unit_name_snapshot', v_parcel_unit_name,
      'unit_price_in_minor_units', v_unit_price,
      'gross_amount_in_minor_units', v_line_gross,
      'parcel_instances', v_plan_instances
    ));
  END LOOP;

  IF v_subtotal IS DISTINCT FROM p_expected_subtotal_in_minor_units THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_QUOTE_STALE: Subtotal changed.';
  END IF;
  IF v_subtotal < v_settings.minimum_order_in_minor_units THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_MINIMUM_ORDER: Order is below the current minimum.';
  END IF;

  IF NULLIF(BTRIM(p_promotion_code), '') IS NOT NULL THEN
    SELECT * INTO v_promotion FROM public.promotion_codes
    WHERE code = UPPER(BTRIM(p_promotion_code)) FOR UPDATE;
    IF NOT FOUND OR NOT v_promotion.is_active
      OR (v_promotion.starts_at IS NOT NULL AND NOW() < v_promotion.starts_at)
      OR (v_promotion.expires_at IS NOT NULL AND NOW() >= v_promotion.expires_at)
      OR v_subtotal < v_promotion.minimum_subtotal_in_minor_units
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_PROMOTION_INVALID: Promotion is unavailable.';
    END IF;
    IF v_promotion.maximum_total_redemptions IS NOT NULL AND (
      SELECT COUNT(*) FROM public.promotion_redemptions redemption
      WHERE redemption.promotion_code_id = v_promotion.id
    ) >= v_promotion.maximum_total_redemptions THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_PROMOTION_INVALID: Promotion is exhausted.';
    END IF;
    IF (SELECT COUNT(*) FROM public.promotion_redemptions redemption
      WHERE redemption.promotion_code_id = v_promotion.id
        AND redemption.customer_phone = v_phone
    ) >= v_promotion.maximum_redemptions_per_phone THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_PROMOTION_INVALID: Promotion is unavailable for this customer.';
    END IF;
    v_promotion_id := v_promotion.id;
    v_promotion_code := v_promotion.code;
    IF v_promotion.discount_type = 'fixed' THEN
      v_discount := LEAST(v_promotion.discount_value, v_subtotal);
    ELSE
      v_discount := FLOOR(v_subtotal::NUMERIC * v_promotion.discount_value / 10000)::BIGINT;
      IF v_promotion.maximum_discount_in_minor_units IS NOT NULL THEN
        v_discount := LEAST(v_discount, v_promotion.maximum_discount_in_minor_units);
      END IF;
    END IF;
    v_discount := LEAST(GREATEST(v_discount, 0), v_subtotal);
  END IF;

  v_delivery_fee := CASE v_delivery_zone
    WHEN 'inside_ramtha' THEN v_settings.inside_ramtha_delivery_fee_in_minor_units
    ELSE v_settings.outside_ramtha_delivery_fee_in_minor_units END;
  v_total := v_subtotal - v_discount + v_delivery_fee;
  IF v_discount IS DISTINCT FROM p_expected_discount_in_minor_units
    OR v_delivery_fee IS DISTINCT FROM p_expected_delivery_fee_in_minor_units
    OR v_total IS DISTINCT FROM p_expected_total_in_minor_units
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_QUOTE_STALE: Accepted totals changed.';
  END IF;

  SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
    'key', line->>'line_sequence',
    'weight', (line->>'gross_amount_in_minor_units')::BIGINT
  ) ORDER BY (line->>'line_sequence')::INTEGER)
  INTO v_line_weights FROM JSONB_ARRAY_ELEMENTS(v_plan_lines) line;
  FOR v_line IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_plan_lines)
    ORDER BY (value->>'line_sequence')::INTEGER
  LOOP
    SELECT allocated_amount INTO v_line_discount
    FROM public.phase2_allocate_largest_remainder_internal(v_discount, v_line_weights)
    WHERE allocation_key = v_line->>'line_sequence';
    v_line_discount := COALESCE(v_line_discount, 0);
    v_line_gross := (v_line->>'gross_amount_in_minor_units')::BIGINT;
    v_line_net := v_line_gross - v_line_discount;
    v_plan_instances := v_line->'parcel_instances';
    IF v_line->>'commercial_line_kind' = 'configurable_parcel' THEN
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'key', instance->>'instance_sequence',
        'weight', (instance->>'gross_amount_in_minor_units')::BIGINT
      ) ORDER BY (instance->>'instance_sequence')::INTEGER)
      INTO v_instance_weights FROM JSONB_ARRAY_ELEMENTS(v_plan_instances) instance;
      v_plan_instances := '[]'::JSONB;
      FOR v_instance IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        SELECT allocated_amount INTO v_instance_discount
        FROM public.phase2_allocate_largest_remainder_internal(v_line_discount, v_instance_weights)
        WHERE allocation_key = v_instance->>'instance_sequence';
        v_plan_instances := v_plan_instances || JSONB_BUILD_ARRAY(
          v_instance || JSONB_BUILD_OBJECT(
            'allocated_discount_in_minor_units', COALESCE(v_instance_discount, 0),
            'net_refundable_amount_in_minor_units',
              (v_instance->>'gross_amount_in_minor_units')::BIGINT
                - COALESCE(v_instance_discount, 0)
          )
        );
      END LOOP;
    END IF;
    v_final_lines := v_final_lines || JSONB_BUILD_ARRAY(
      v_line || JSONB_BUILD_OBJECT(
        'allocated_discount_in_minor_units', v_line_discount,
        'net_refundable_amount_in_minor_units', v_line_net,
        'parcel_instances', v_plan_instances
      )
    );
  END LOOP;

  FOR v_demand IN
    WITH demand AS (
      SELECT (line->>'product_id')::UUID product_id,
        (line->>'base_quantity')::INTEGER quantity
      FROM JSONB_ARRAY_ELEMENTS(v_final_lines) line
      WHERE line->>'commercial_line_kind' <> 'configurable_parcel'
      UNION ALL
      SELECT (component->>'product_id')::UUID,
        (component->>'base_quantity')::INTEGER
      FROM JSONB_ARRAY_ELEMENTS(v_final_lines) line
      CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(line->'parcel_instances') instance
      CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(instance->'components') component
      WHERE line->>'commercial_line_kind' = 'configurable_parcel'
    ) SELECT product_id, SUM(quantity)::INTEGER quantity
      FROM demand GROUP BY product_id ORDER BY product_id
  LOOP
    SELECT balance.on_hand_quantity, balance.reserved_quantity
    INTO v_on_hand, v_reserved
    FROM public.inventory_balances balance
    WHERE balance.warehouse_id = v_warehouse_id
      AND balance.product_id = v_demand.product_id
    FOR UPDATE;
    IF NOT FOUND OR v_on_hand - v_reserved < v_demand.quantity THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_INSUFFICIENT_INVENTORY: Component inventory is unavailable.';
    END IF;
  END LOOP;

  SELECT COUNT(*)::INTEGER INTO v_recent_orders
  FROM public.orders customer_order
  JOIN public.customers customer ON customer.id = customer_order.customer_id
  WHERE customer_order.source = 'website'
    AND public.normalize_customer_phone(customer.phone) = v_phone
    AND customer_order.created_at >= NOW() - INTERVAL '10 minutes';
  IF v_recent_orders >= 3 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_RATE_LIMITED: Too many recent orders.';
  END IF;

  IF v_customer_id IS NOT NULL THEN
    IF v_customer_is_blocked OR NOT v_customer_is_active THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_UNAVAILABLE: Customer account is unavailable.';
    END IF;
    v_customer_reused := true;
    UPDATE public.customers SET full_name = BTRIM(p_customer_full_name),
      phone = v_phone, governorate = BTRIM(p_governorate), updated_at = NOW()
    WHERE id = v_customer_id;
  ELSE
    v_customer_id := gen_random_uuid();
    INSERT INTO public.customers(
      id, full_name, phone, governorate, customer_type,
      is_active, is_blocked, is_deleted
    ) VALUES (
      v_customer_id, BTRIM(p_customer_full_name), v_phone,
      BTRIM(p_governorate), 'wholesale', true, false, false
    );
  END IF;

  UPDATE public.customer_addresses SET is_default = false
  WHERE customer_id = v_customer_id AND is_default;
  v_formatted_address := CONCAT_WS(' - ', BTRIM(p_governorate), BTRIM(p_city),
    BTRIM(p_area), BTRIM(p_street), NULLIF(BTRIM(p_building), ''));
  v_google_maps_url := COALESCE(NULLIF(BTRIM(p_google_maps_url), ''), CASE
    WHEN p_latitude IS NOT NULL THEN 'https://www.google.com/maps?q='
      || p_latitude::TEXT || ',' || p_longitude::TEXT ELSE NULL END);
  IF v_google_maps_url IS NOT NULL AND (
    CHAR_LENGTH(v_google_maps_url) > 1000 OR v_google_maps_url !~* '^https://'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_INPUT_INVALID: Map URL is invalid.';
  END IF;
  v_location_source := CASE WHEN p_latitude IS NOT NULL THEN 'gps'
    WHEN v_google_maps_url IS NOT NULL THEN 'map_pin' ELSE 'manual' END;
  INSERT INTO public.customer_addresses(
    id, customer_id, governorate, city, area, street, building, notes,
    latitude, longitude, formatted_address, google_maps_url,
    location_source, location_confirmed, is_default
  ) VALUES (
    v_address_id, v_customer_id, BTRIM(p_governorate), BTRIM(p_city),
    BTRIM(p_area), BTRIM(p_street), NULLIF(BTRIM(p_building), ''),
    NULLIF(BTRIM(p_address_notes), ''), p_latitude, p_longitude,
    v_formatted_address, v_google_maps_url, v_location_source,
    p_latitude IS NOT NULL, true
  );

  LOOP
    v_order_number := 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-'
      || LPAD((FLOOR(RANDOM() * 89999 + 10000))::TEXT, 5, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.orders WHERE order_number = v_order_number);
  END LOOP;

  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
    'id', line->>'order_item_id', 'productId', line->>'product_id',
    'productName', line->>'product_name_snapshot', 'sku', line->>'sku_snapshot',
    'commercialLineKind', line->>'commercial_line_kind',
    'quantity', (line->>'commercial_quantity')::INTEGER,
    'baseQuantity', (line->>'base_quantity')::BIGINT,
    'unitPriceInMinorUnits', (line->>'unit_price_in_minor_units')::BIGINT,
    'lineTotalInMinorUnits', (line->>'gross_amount_in_minor_units')::BIGINT,
    'allocatedDiscountInMinorUnits', (line->>'allocated_discount_in_minor_units')::BIGINT,
    'netRefundableAmountInMinorUnits', (line->>'net_refundable_amount_in_minor_units')::BIGINT,
    'costFinalized', false, 'parcelInstances', line->'parcel_instances'
  ) ORDER BY (line->>'line_sequence')::INTEGER), '[]'::JSONB)
  INTO v_result_items FROM JSONB_ARRAY_ELEMENTS(v_final_lines) line;
  v_result := JSONB_BUILD_OBJECT(
    'success', true, 'idempotent_replay', false,
    'contract_version', 'phase3-customer-reservation-v2',
    'operation_id', v_operation_id, 'order_id', v_order_id,
    'order_number', v_order_number, 'customer_id', v_customer_id,
    'customer_address_id', v_address_id, 'customer_reused', v_customer_reused,
    'status', 'new', 'subtotal', v_subtotal, 'discount', v_discount,
    'delivery_fee', v_delivery_fee, 'total', v_total,
    'promotion_code', v_promotion_code, 'payment_method', v_payment_method,
    'payment_status', 'unpaid', 'tracking_token', v_tracking_token,
    'tracking_path', '/#track=' || v_tracking_token::TEXT,
    'items', v_result_items,
    'message', 'تم إنشاء طلب V2 وحجز مكوناته بدقة.'
  );

  INSERT INTO public.business_operations(
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES (
    v_operation_id, 'phase3_customer_reservation_v1', v_key, v_fingerprint,
    NULL, v_result, NOW(), 301, v_canonical_request,
    'guest_gateway', v_actor_hash
  );
  INSERT INTO public.orders(
    id, order_number, customer_id, customer_address_id, customer_name_snapshot,
    branch_id, warehouse_id, status, payment_method, payment_status,
    subtotal_in_minor_units, delivery_fee_in_minor_units,
    discount_in_minor_units, total_in_minor_units, amount_paid_in_minor_units,
    customer_notes, internal_notes, whatsapp_message, source,
    idempotency_key, promotion_code_id, promotion_code_snapshot,
    delivery_zone, tracking_token, operation_id
  ) VALUES (
    v_order_id, v_order_number, v_customer_id, v_address_id,
    BTRIM(p_customer_full_name), v_branch_id, v_warehouse_id, 'new',
    v_payment_method, 'unpaid', v_subtotal, v_delivery_fee, v_discount,
    v_total, 0, NULLIF(BTRIM(p_customer_notes), ''),
    'طلب عميل V2 محجوز بالمكونات',
    'تم استلام طلبك رقم ' || v_order_number, 'website', v_key,
    v_promotion_id, v_promotion_code, v_delivery_zone, v_tracking_token,
    v_operation_id
  );

  FOR v_line IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_final_lines)
    ORDER BY (value->>'line_sequence')::INTEGER
  LOOP
    INSERT INTO public.order_items(
      id, order_id, product_id, product_name_snapshot, sku_snapshot,
      quantity, unit_price_in_minor_units, line_total_in_minor_units,
      sale_package_quantity, units_per_sale_package,
      sale_package_name_snapshot, sale_package_price_in_minor_units,
      commercial_line_kind, family_product_id, parcel_configuration_id,
      parcel_configuration_revision, base_unit_name_snapshot,
      allocated_discount_snapshot_in_minor_units,
      net_refundable_amount_snapshot_in_minor_units
    ) VALUES (
      (v_line->>'order_item_id')::UUID, v_order_id,
      (v_line->>'product_id')::UUID, v_line->>'product_name_snapshot',
      v_line->>'sku_snapshot', CASE
        WHEN v_line->>'commercial_line_kind' = 'configurable_parcel'
        THEN (v_line->>'commercial_quantity')::INTEGER
        ELSE (v_line->>'base_quantity')::INTEGER END,
      (v_line->>'unit_price_in_minor_units')::BIGINT,
      (v_line->>'gross_amount_in_minor_units')::BIGINT,
      (v_line->>'commercial_quantity')::INTEGER,
      (v_line->>'units_per_parcel')::INTEGER,
      v_line->>'parcel_unit_name_snapshot',
      (v_line->>'unit_price_in_minor_units')::BIGINT,
      v_line->>'commercial_line_kind',
      NULLIF(v_line->>'family_product_id', '')::UUID,
      NULLIF(v_line->>'parcel_configuration_id', '')::UUID,
      NULLIF(v_line->>'configuration_revision', '')::INTEGER,
      v_line->>'base_unit_name_snapshot',
      (v_line->>'allocated_discount_in_minor_units')::BIGINT,
      (v_line->>'net_refundable_amount_in_minor_units')::BIGINT
    );

    IF v_line->>'commercial_line_kind' = 'configurable_parcel' THEN
      FOR v_instance IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        INSERT INTO public.order_parcel_instances(
          id, order_item_id, order_id, operation_id, parcel_configuration_id,
          family_product_id, instance_sequence, configuration_revision,
          units_per_parcel_snapshot, parcel_unit_name_snapshot,
          gross_amount_snapshot_in_minor_units,
          allocated_discount_snapshot_in_minor_units,
          net_refundable_amount_snapshot_in_minor_units,
          cogs_snapshot_in_minor_units, composition_fingerprint
        ) VALUES (
          (v_instance->>'instance_id')::UUID,
          (v_line->>'order_item_id')::UUID, v_order_id, v_operation_id,
          (v_line->>'parcel_configuration_id')::UUID,
          (v_line->>'family_product_id')::UUID,
          (v_instance->>'instance_sequence')::INTEGER,
          (v_instance->>'configuration_revision')::INTEGER,
          (v_instance->>'units_per_parcel')::INTEGER,
          v_line->>'parcel_unit_name_snapshot',
          (v_instance->>'gross_amount_in_minor_units')::BIGINT,
          (v_instance->>'allocated_discount_in_minor_units')::BIGINT,
          (v_instance->>'net_refundable_amount_in_minor_units')::BIGINT,
          0, v_instance->>'composition_fingerprint'
        );
        FOR v_component IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_instance->'components')
          ORDER BY (value->>'product_id')::UUID
        LOOP
          INSERT INTO public.order_parcel_components(
            id, parcel_instance_id, operation_id, product_id, base_quantity,
            product_name_snapshot, sku_snapshot, base_unit_name_snapshot,
            unit_cost_snapshot_in_minor_units, cogs_snapshot_in_minor_units
          ) VALUES (
            (v_component->>'component_id')::UUID,
            (v_instance->>'instance_id')::UUID, v_operation_id,
            (v_component->>'product_id')::UUID,
            (v_component->>'base_quantity')::INTEGER,
            v_component->>'product_name_snapshot', v_component->>'sku_snapshot',
            v_component->>'base_unit_name_snapshot', 0, 0
          );
        END LOOP;
        PERFORM public.finalize_order_parcel_instance_internal(
          (v_instance->>'instance_id')::UUID
        );
      END LOOP;
    END IF;
  END LOOP;

  FOR v_line IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_final_lines)
    ORDER BY (value->>'line_sequence')::INTEGER
  LOOP
    IF v_line->>'commercial_line_kind' <> 'configurable_parcel' THEN
      INSERT INTO public.order_inventory_reservations(
        id, operation_id, order_id, order_item_id, parcel_instance_id,
        warehouse_id, product_id, reserved_quantity
      ) VALUES (
        (v_line->>'reservation_id')::UUID, v_operation_id, v_order_id,
        (v_line->>'order_item_id')::UUID, NULL, v_warehouse_id,
        (v_line->>'product_id')::UUID, (v_line->>'base_quantity')::INTEGER
      );
    ELSE
      FOR v_instance IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        FOR v_component IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_instance->'components')
          ORDER BY (value->>'product_id')::UUID
        LOOP
          INSERT INTO public.order_inventory_reservations(
            id, operation_id, order_id, order_item_id, parcel_instance_id,
            warehouse_id, product_id, reserved_quantity
          ) VALUES (
            (v_component->>'reservation_id')::UUID, v_operation_id, v_order_id,
            (v_line->>'order_item_id')::UUID,
            (v_instance->>'instance_id')::UUID, v_warehouse_id,
            (v_component->>'product_id')::UUID,
            (v_component->>'base_quantity')::INTEGER
          );
        END LOOP;
      END LOOP;
    END IF;
  END LOOP;

  FOR v_demand IN
    SELECT reservation.product_id, SUM(reservation.reserved_quantity)::INTEGER quantity
    FROM public.order_inventory_reservations reservation
    WHERE reservation.order_id = v_order_id
      AND reservation.reservation_state = 'active'
    GROUP BY reservation.product_id ORDER BY reservation.product_id
  LOOP
    UPDATE public.inventory_balances
    SET reserved_quantity = reserved_quantity + v_demand.quantity,
      updated_at = NOW()
    WHERE warehouse_id = v_warehouse_id AND product_id = v_demand.product_id;
  END LOOP;

  IF v_promotion_id IS NOT NULL THEN
    INSERT INTO public.promotion_redemptions(
      promotion_code_id, order_id, customer_id, customer_phone,
      code_snapshot, discount_in_minor_units
    ) VALUES (
      v_promotion_id, v_order_id, v_customer_id, v_phone,
      v_promotion_code, v_discount
    );
  END IF;
  INSERT INTO public.order_status_history(order_id, old_status, new_status, changed_by, notes)
  VALUES (v_order_id, NULL, 'new', NULL, 'إنشاء طلب عميل V2 وحجز المكونات ذريًا');
  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (NULL, 'CREATE_CUSTOMER_ORDER_V2', 'orders', v_order_id,
    JSONB_BUILD_OBJECT('operation_id', v_operation_id, 'commercial_lines',
      JSONB_ARRAY_LENGTH(v_final_lines), 'reserved_components', (
        SELECT COUNT(*) FROM public.order_inventory_reservations
        WHERE order_id = v_order_id
      )));
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_customer_order(p_customer_full_name text, p_customer_phone text, p_customer_email text DEFAULT NULL::text, p_governorate text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_area text DEFAULT NULL::text, p_street text DEFAULT NULL::text, p_building text DEFAULT NULL::text, p_floor text DEFAULT NULL::text, p_apartment text DEFAULT NULL::text, p_address_notes text DEFAULT NULL::text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_formatted_address text DEFAULT NULL::text, p_google_maps_url text DEFAULT NULL::text, p_location_source text DEFAULT 'manual'::text, p_branch_id uuid DEFAULT NULL::uuid, p_warehouse_id uuid DEFAULT NULL::uuid, p_items jsonb DEFAULT '[]'::jsonb, p_delivery_fee_in_minor_units bigint DEFAULT 0, p_discount_in_minor_units bigint DEFAULT 0, p_customer_notes text DEFAULT NULL::text, p_internal_notes text DEFAULT NULL::text, p_source text DEFAULT 'website'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF LOWER(BTRIM(p_source)) = 'pos' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PACKAGE_D_POS_V2_REQUIRED: بيع الكاشير يتطلب create_pos_sale_v2.';
  END IF;
  -- Match the existing guest/customer -> inventory hierarchy across versions.
  PERFORM pg_advisory_xact_lock(hashtext(public.normalize_customer_phone(p_customer_phone))::BIGINT);
  PERFORM c.id FROM public.customers c
    WHERE public.normalize_customer_phone(c.phone)=public.normalize_customer_phone(p_customer_phone)
      AND c.is_deleted=false ORDER BY c.id FOR UPDATE;
  PERFORM public.parcel209_guard_legacy_items_internal(p_items);
  RETURN public.package_d_create_customer_order_before_source_guard_internal(
    p_customer_full_name, p_customer_phone, p_customer_email, p_governorate,
    p_city, p_area, p_street, p_building, p_floor, p_apartment, p_address_notes,
    p_latitude, p_longitude, p_formatted_address, p_google_maps_url, p_location_source,
    p_branch_id, p_warehouse_id, p_items, p_delivery_fee_in_minor_units,
    p_discount_in_minor_units, p_customer_notes, p_internal_notes, p_source
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.parcel209_replacement_issuer_internal(p_order_id uuid, p_idempotency_key text, p_items jsonb, p_reason text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_actor_hash TEXT;
  v_key TEXT;
  v_canonical JSONB;
  v_fingerprint TEXT;
  v_replay JSONB;
  v_order public.orders%ROWTYPE;
  v_creation_type TEXT;
  v_completion_at TIMESTAMPTZ;
  v_operation_id UUID := gen_random_uuid();
  v_event_id UUID := gen_random_uuid();
  v_now TIMESTAMPTZ;
  v_item JSONB;
  v_prepared JSONB := '[]'::JSONB;
  v_product_ids UUID[];
  v_source_kind TEXT;
  v_source_id UUID;
  v_quantity INTEGER;
  v_product_id UUID;
  v_root_order_item_id UUID;
  v_root_parcel_instance_id UUID;
  v_root_parcel_component_id UUID;
  v_original_sale_operation_id UUID;
  v_parent_replacement_item_id UUID;
  v_capacity INTEGER;
  v_consumed INTEGER;
  v_wac NUMERIC(24, 6);
  v_cogs BIGINT;
  v_replacement_item_id UUID;
  v_before INTEGER;
  v_available INTEGER;
  v_after INTEGER;
  v_movement_id UUID;
  v_result JSONB;
  v_total_quantity INTEGER := 0;
  v_total_cogs BIGINT := 0;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner', 'admin'], 'إصدار استبدال مبيعات Phase 4.3');
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'PHASE43_ACTOR_REQUIRED: Authenticated ERP actor is required.';
  END IF;
  v_key := public.phase4_canonicalize_idempotency_key_internal(p_idempotency_key);
  v_canonical := public.phase43_canonicalize_replacement_request_internal(
    p_order_id, p_items, p_reason, p_notes
  );
  v_actor_hash := public.phase3_actor_scope_hash_internal('erp_user', v_user_id, NULL, NULL);
  v_fingerprint := public.phase3_request_fingerprint_internal(v_canonical);
  v_replay := public.phase43_resolve_replacement_replay_internal(
    v_key, v_actor_hash, v_fingerprint
  );
  IF v_replay->>'decision' = 'REPLAY' THEN
    RETURN v_replay->'result_snapshot';
  END IF;

  PERFORM public.phase4_lock_customer_order_context_internal(p_order_id, false, false);
  SELECT * INTO v_order FROM public.orders customer_order
  WHERE customer_order.id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status IS DISTINCT FROM 'completed'
    OR v_order.branch_id IS NULL OR v_order.warehouse_id IS NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE43_ORIGINAL_SALE_INVALID: Replacement requires a completed sale with branch and warehouse evidence.';
  END IF;
  SELECT operation.operation_type INTO v_creation_type
  FROM public.business_operations operation WHERE operation.id = v_order.operation_id FOR SHARE;
  IF v_creation_type IS NULL OR v_creation_type NOT IN ('phase3_pos_sale_v1', 'phase3_customer_reservation_v1') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE43_SALE_CONTRACT_UNSUPPORTED: Only proven Phase-3 POS V2 and Customer V2 sales are supported.';
  END IF;

  FOR v_item IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_canonical->'items')
    ORDER BY value->>'source_kind', value->>'source_id'
  LOOP
    v_source_kind := v_item->>'source_kind';
    v_source_id := (v_item->>'source_id')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;
    v_root_order_item_id := NULL;
    v_root_parcel_instance_id := NULL;
    v_root_parcel_component_id := NULL;
    v_original_sale_operation_id := NULL;
    v_parent_replacement_item_id := NULL;

    IF v_source_kind = 'base_order_item' THEN
      SELECT item.id, item.product_id, item.quantity
      INTO v_root_order_item_id, v_product_id, v_capacity
      FROM public.order_items item
      WHERE item.id = v_source_id AND item.order_id = p_order_id
        AND item.commercial_line_kind IN ('base_unit','legacy_single_sku_parcel');
    ELSIF v_source_kind = 'parcel_component' THEN
      SELECT order_item.id, instance.id, component.id, component.operation_id,
        component.product_id, component.base_quantity
      INTO v_root_order_item_id, v_root_parcel_instance_id,
        v_root_parcel_component_id, v_original_sale_operation_id,
        v_product_id, v_capacity
      FROM public.order_parcel_components component
      JOIN public.order_parcel_instances instance ON instance.id = component.parcel_instance_id
      JOIN public.order_items order_item ON order_item.id = instance.order_item_id
      WHERE component.id = v_source_id AND instance.order_id = p_order_id;
    ELSE
      SELECT item.root_order_item_id, item.root_parcel_instance_id,
        item.root_parcel_component_id, item.original_sale_operation_id,
        item.product_id, item.quantity, item.id
      INTO v_root_order_item_id, v_root_parcel_instance_id,
        v_root_parcel_component_id, v_original_sale_operation_id,
        v_product_id, v_capacity, v_parent_replacement_item_id
      FROM public.sales_replacement_items item
      JOIN public.sales_replacement_events event ON event.id = item.replacement_event_id
      WHERE item.id = v_source_id AND event.root_order_id = p_order_id
        AND event.replacement_status = 'settled'
        AND event.issuance_status = 'issued'
        AND event.issuance_coordinator_version = 403;
      IF v_parent_replacement_item_id IS NOT NULL THEN
        PERFORM public.phase43_assert_operational_replacement_evidence_internal(
          (SELECT operation_id FROM public.sales_replacement_items WHERE id = v_parent_replacement_item_id), true
        );
      END IF;
    END IF;

    IF v_product_id IS NULL OR v_capacity IS NULL OR v_quantity > v_capacity THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'PHASE43_REPLACEMENT_SOURCE_INVALID: Source is unavailable or quantity exceeds its immutable capacity.';
    END IF;
    PERFORM public.package_d_assert_whole_single_sku_quantity_internal(v_root_order_item_id,v_quantity);
    v_prepared := v_prepared || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'source_kind', v_source_kind, 'source_id', v_source_id,
      'quantity', v_quantity, 'product_id', v_product_id,
      'root_order_item_id', v_root_order_item_id,
      'root_parcel_instance_id', v_root_parcel_instance_id,
      'root_parcel_component_id', v_root_parcel_component_id,
      'original_sale_operation_id', v_original_sale_operation_id,
      'parent_replacement_item_id', v_parent_replacement_item_id
    ));
  END LOOP;

  SELECT ARRAY_AGG(DISTINCT (item->>'product_id')::UUID ORDER BY (item->>'product_id')::UUID)
  INTO v_product_ids FROM JSONB_ARRAY_ELEMENTS(v_prepared) item;
  PERFORM public.phase2_lock_inventory_products_internal(v_product_ids);
  PERFORM public.parcel209_guard_replacement_internal(v_prepared);
  v_completion_at := public.phase4_authoritative_completion_internal(p_order_id);
  IF clock_timestamp() > v_completion_at + INTERVAL '48 hours' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_REPLACEMENT_WINDOW_INVALID: Replacement is outside the original 48-hour window.';
  END IF;

  FOR v_item IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_prepared)
    ORDER BY value->>'source_kind', value->>'source_id'
  LOOP
    v_source_kind := v_item->>'source_kind';
    v_source_id := (v_item->>'source_id')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;
    v_product_id := (v_item->>'product_id')::UUID;
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'phase4-aftercare|' || v_source_kind || '|' || v_source_id::TEXT, 0
    ));
    SELECT COALESCE(SUM(consumption.consumed_quantity), 0)::INTEGER
    INTO v_consumed FROM public.sales_aftercare_consumptions consumption
    WHERE consumption.source_kind = v_source_kind
      AND consumption.source_id = v_source_id
      AND consumption.consumption_state = 'settled';
    IF v_source_kind = 'base_order_item' THEN
      SELECT quantity INTO v_capacity FROM public.order_items
      WHERE id = v_source_id AND product_id = v_product_id FOR UPDATE;
    ELSIF v_source_kind = 'parcel_component' THEN
      SELECT base_quantity INTO v_capacity FROM public.order_parcel_components
      WHERE id = v_source_id AND product_id = v_product_id FOR UPDATE;
    ELSE
      SELECT quantity INTO v_capacity FROM public.sales_replacement_items
      WHERE id = v_source_id AND product_id = v_product_id FOR UPDATE;
    END IF;
    IF v_capacity IS NULL OR v_consumed + v_quantity > v_capacity THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED: Replacement exceeds the remaining physical source.';
    END IF;
    SELECT product.wac_cost_in_minor_units_exact INTO v_wac
    FROM public.products product WHERE product.id = v_product_id FOR NO KEY UPDATE;
    SELECT balance.on_hand_quantity, balance.available_quantity
    INTO v_before, v_available
    FROM public.inventory_balances balance
    WHERE balance.warehouse_id = v_order.warehouse_id
      AND balance.product_id = v_product_id FOR UPDATE;
    IF v_wac IS NULL OR v_before IS NULL OR v_available < v_quantity THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE43_REPLACEMENT_INVENTORY_UNAVAILABLE: Sellable inventory or exact WAC evidence is insufficient.';
    END IF;
  END LOOP;

  v_now := clock_timestamp();
  SELECT COALESCE(SUM((item->>'quantity')::INTEGER), 0)::INTEGER,
    COALESCE(SUM(ROUND(product.wac_cost_in_minor_units_exact
      * (item->>'quantity')::INTEGER)::BIGINT), 0)::BIGINT
  INTO v_total_quantity, v_total_cogs
  FROM JSONB_ARRAY_ELEMENTS(v_prepared) item
  JOIN public.products product ON product.id = (item->>'product_id')::UUID;
  v_result := JSONB_BUILD_OBJECT(
    'success', true, 'idempotentReplay', false,
    'operationId', v_operation_id, 'replacementId', v_event_id,
    'orderId', p_order_id, 'operationalCoordinatorVersion', 403,
    'issuedQuantity', v_total_quantity,
    'replacementCogsInMinorUnits', v_total_cogs,
    'moneyRefundInMinorUnits', 0, 'debtReductionInMinorUnits', 0
  );

  INSERT INTO public.business_operations(
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES (
    v_operation_id, 'phase4_replacement_v1', v_key, v_fingerprint, v_user_id,
    v_result, v_now, 401, v_canonical, 'erp_user', v_actor_hash
  );
  INSERT INTO public.sales_replacement_events(
    id, operation_id, root_order_id, branch_id, warehouse_id,
    contract_version, replacement_status, original_completed_at_snapshot,
    reason, created_by, issuance_coordinator_version
  ) VALUES (
    v_event_id, v_operation_id, p_order_id, v_order.branch_id,
    v_order.warehouse_id, 401, 'draft', v_completion_at,
    v_canonical->>'reason', v_user_id, 403
  );

  FOR v_item IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_prepared)
    ORDER BY value->>'source_kind', value->>'source_id'
  LOOP
    v_source_kind := v_item->>'source_kind';
    v_source_id := (v_item->>'source_id')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;
    v_product_id := (v_item->>'product_id')::UUID;
    SELECT product.wac_cost_in_minor_units_exact INTO STRICT v_wac
    FROM public.products product WHERE product.id = v_product_id;
    v_cogs := ROUND(v_wac * v_quantity)::BIGINT;
    v_replacement_item_id := gen_random_uuid();
    INSERT INTO public.sales_replacement_items(
      id, replacement_event_id, operation_id, root_order_item_id,
      root_parcel_instance_id, root_parcel_component_id,
      original_sale_operation_id, parent_replacement_item_id,
      product_id, quantity, replacement_unit_cost_snapshot_in_minor_units_exact,
      replacement_cogs_snapshot_in_minor_units, condition_code
    ) VALUES (
      v_replacement_item_id, v_event_id, v_operation_id,
      (v_item->>'root_order_item_id')::UUID,
      (v_item->>'root_parcel_instance_id')::UUID,
      (v_item->>'root_parcel_component_id')::UUID,
      (v_item->>'original_sale_operation_id')::UUID,
      (v_item->>'parent_replacement_item_id')::UUID,
      v_product_id, v_quantity, v_wac, v_cogs, 'supplier_defect'
    );
    INSERT INTO public.sales_aftercare_consumptions(
      operation_id, replacement_item_id, source_kind, source_id,
      product_id, consumed_quantity, consumption_kind
    ) VALUES (
      v_operation_id, v_replacement_item_id, v_source_kind, v_source_id,
      v_product_id, v_quantity, 'replacement'
    );
    SELECT balance.on_hand_quantity INTO STRICT v_before
    FROM public.inventory_balances balance
    WHERE balance.warehouse_id = v_order.warehouse_id
      AND balance.product_id = v_product_id FOR UPDATE;
    v_after := v_before - v_quantity;
    UPDATE public.inventory_balances SET on_hand_quantity = v_after,
      updated_at = clock_timestamp()
    WHERE warehouse_id = v_order.warehouse_id AND product_id = v_product_id;
    INSERT INTO public.inventory_movements(
      warehouse_id, product_id, movement_type, quantity,
      balance_before, balance_after, reference_type, reference_id,
      notes, created_by, operation_id
    ) VALUES (
      v_order.warehouse_id, v_product_id, 'sales_deduction', -v_quantity,
      v_before, v_after, 'phase4_replacement_item', v_replacement_item_id,
      'Phase 4.3 operational Replacement issuance', v_user_id, v_operation_id
    ) RETURNING id INTO v_movement_id;
    INSERT INTO public.phase43_replacement_inventory_effects(
      operation_id, replacement_event_id, replacement_item_id,
      warehouse_id, product_id, inventory_movement_id,
      source_kind, source_id, issued_quantity,
      replacement_unit_cost_snapshot_in_minor_units_exact,
      replacement_cogs_snapshot_in_minor_units,
      target_balance_before, target_balance_after
    ) VALUES (
      v_operation_id, v_event_id, v_replacement_item_id,
      v_order.warehouse_id, v_product_id, v_movement_id,
      v_source_kind, v_source_id, v_quantity, v_wac, v_cogs,
      v_before, v_after
    );
  END LOOP;
  INSERT INTO public.phase43_replacement_issuance_guards(
    transaction_id, operation_id, replacement_event_id
  ) VALUES (pg_current_xact_id(), v_operation_id, v_event_id);
  INSERT INTO public.phase43_replacement_settlement_evidence(
    operation_id, replacement_event_id, order_id,
    result_snapshot, inventory_effects_snapshot
  ) VALUES (
    v_operation_id, v_event_id, p_order_id, v_result,
    public.phase43_inventory_effects_snapshot_internal(v_operation_id)
  );
  PERFORM public.phase4_finalize_aftercare_operation_internal(v_operation_id);
  DELETE FROM public.phase43_replacement_issuance_guards
  WHERE transaction_id = pg_current_xact_id() AND operation_id = v_operation_id;
  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'SETTLE_PHASE43_SALES_REPLACEMENT',
    'sales_replacement_events', v_event_id,
    JSONB_BUILD_OBJECT('operation_id', v_operation_id, 'order_id', p_order_id,
      'issued_quantity', v_total_quantity, 'replacement_cogs', v_total_cogs));
  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.parcel209_replacement_issuer_internal(uuid,text,jsonb,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.parcel209_replacement_issuer_internal(uuid,text,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.settle_sales_replacement_v1(p_order_id uuid, p_idempotency_key text, p_items jsonb, p_reason text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner', 'admin'], 'إصدار استبدال مبيعات');
  PERFORM public.package_d_assert_modern_sale_internal(
    p_order_id, 'PHASE43_SALE_CONTRACT_UNSUPPORTED'
  );
  RETURN public.parcel209_replacement_issuer_internal(
    p_order_id, p_idempotency_key, p_items, p_reason, p_notes
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_product_with_opening_stock_v5(p_sku text, p_barcode text DEFAULT NULL::text, p_name_ar text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_category_id uuid DEFAULT NULL::uuid, p_brand_id uuid DEFAULT NULL::uuid, p_unit_id uuid DEFAULT NULL::uuid, p_purchase_unit_id uuid DEFAULT NULL::uuid, p_units_per_purchase_unit integer DEFAULT 1, p_default_purchase_price_in_minor_units bigint DEFAULT 0, p_sale_unit_id uuid DEFAULT NULL::uuid, p_units_per_sale_unit integer DEFAULT 1, p_default_sale_price_in_minor_units bigint DEFAULT 0, p_cost_price_in_minor_units bigint DEFAULT 0, p_min_stock_level integer DEFAULT 0, p_max_stock_level integer DEFAULT NULL::integer, p_warehouse_id uuid DEFAULT NULL::uuid, p_opening_quantity integer DEFAULT 0, p_notes text DEFAULT 'رصيد افتتاحي عند إضافة المنتج'::text, p_image_url text DEFAULT NULL::text, p_parcel_only boolean DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result JSONB;v_id UUID;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','warehouse_keeper'],'تعريف منتج وطرق بيعه');
  IF p_parcel_only IS NULL OR (p_parcel_only AND COALESCE(p_units_per_sale_unit,0)<=1) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PARCEL209_PARCEL_SIZE_REQUIRED: الطرد فقط يحتاج أكثر من وحدة في طرد البيع.';
  END IF;
  v_result:=public.create_product_with_opening_stock_v4(p_sku,p_barcode,p_name_ar,p_description,p_category_id,p_brand_id,p_unit_id,p_purchase_unit_id,p_units_per_purchase_unit,p_default_purchase_price_in_minor_units,p_sale_unit_id,p_units_per_sale_unit,p_default_sale_price_in_minor_units,p_cost_price_in_minor_units,p_min_stock_level,p_max_stock_level,p_warehouse_id,p_opening_quantity,p_notes,p_image_url);
  v_id:=COALESCE(v_result->>'product_id',v_result->>'productId')::UUID;
  PERFORM public.parcel209_set_flag_internal(v_id,p_parcel_only);
  RETURN v_result||jsonb_build_object('parcelOnly',p_parcel_only,'updatedAt',(SELECT updated_at FROM public.products WHERE id=v_id));
END;
$$;

ALTER FUNCTION public.create_product_with_opening_stock_v5(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,integer,text,text,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_product_with_opening_stock_v5(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,integer,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_product_with_opening_stock_v5(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,integer,text,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_product_family_with_flavors_v2(p_sku text, p_barcode text DEFAULT NULL::text, p_name_ar text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_category_id uuid DEFAULT NULL::uuid, p_brand_id uuid DEFAULT NULL::uuid, p_unit_id uuid DEFAULT NULL::uuid, p_purchase_unit_id uuid DEFAULT NULL::uuid, p_units_per_purchase_unit integer DEFAULT 1, p_default_purchase_price_in_minor_units bigint DEFAULT 0, p_sale_unit_id uuid DEFAULT NULL::uuid, p_units_per_sale_unit integer DEFAULT 1, p_default_sale_price_in_minor_units bigint DEFAULT 0, p_cost_price_in_minor_units bigint DEFAULT 0, p_min_stock_level integer DEFAULT 0, p_max_stock_level integer DEFAULT NULL::integer, p_warehouse_id uuid DEFAULT NULL::uuid, p_image_url text DEFAULT NULL::text, p_flavors jsonb DEFAULT '[]'::jsonb, p_parcel_only boolean DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result JSONB;v_id UUID;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','warehouse_keeper'],'تعريف منتج وطرق بيعه');
  IF p_parcel_only IS NULL OR (p_parcel_only AND COALESCE(p_units_per_sale_unit,0)<=1) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PARCEL209_PARCEL_SIZE_REQUIRED: الطرد فقط يحتاج أكثر من وحدة في طرد البيع.';
  END IF;
  v_result:=public.create_product_family_with_flavors_v1(p_sku,p_barcode,p_name_ar,p_description,p_category_id,p_brand_id,p_unit_id,p_purchase_unit_id,p_units_per_purchase_unit,p_default_purchase_price_in_minor_units,p_sale_unit_id,p_units_per_sale_unit,p_default_sale_price_in_minor_units,p_cost_price_in_minor_units,p_min_stock_level,p_max_stock_level,p_warehouse_id,p_image_url,p_flavors);
  v_id:=COALESCE(v_result->>'product_id',v_result->>'productId')::UUID;
  PERFORM public.parcel209_set_flag_internal(v_id,p_parcel_only);
  RETURN v_result||jsonb_build_object('parcelOnly',p_parcel_only,'updatedAt',(SELECT updated_at FROM public.products WHERE id=v_id));
END;
$$;

ALTER FUNCTION public.create_product_family_with_flavors_v2(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,text,jsonb,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_product_family_with_flavors_v2(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,text,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_product_family_with_flavors_v2(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,text,jsonb,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_product_master_v5(p_product_id uuid, p_expected_updated_at timestamp with time zone, p_sku text, p_barcode text, p_name_ar text, p_description text, p_category_id uuid, p_brand_id uuid, p_unit_id uuid, p_purchase_unit_id uuid, p_units_per_purchase_unit integer, p_default_purchase_price_in_minor_units bigint, p_sale_unit_id uuid, p_units_per_sale_unit integer, p_default_sale_price_in_minor_units bigint, p_cost_price_in_minor_units bigint, p_min_stock_level integer, p_max_stock_level integer, p_is_active boolean, p_image_url text, p_parcel_only boolean DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result JSONB;v_current BOOLEAN;v_expected TIMESTAMPTZ:=p_expected_updated_at;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','warehouse_keeper'],'تعديل منتج وطرق بيعه');
  PERFORM public.product_edit_assert_version_internal(p_product_id,p_expected_updated_at);
  SELECT parcel_only INTO STRICT v_current FROM public.products WHERE id=p_product_id;
  IF COALESCE(p_parcel_only,v_current) AND COALESCE(p_units_per_sale_unit,0)<=1 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PARCEL209_PARCEL_SIZE_REQUIRED: الطرد فقط يحتاج أكثر من وحدة في طرد البيع.';
  END IF;
  -- Clear the flag before an explicitly requested N1 transition; the caller's
  -- original CAS was checked under the common family lock above.
  IF p_parcel_only=false AND v_current THEN
    PERFORM public.parcel209_set_flag_internal(p_product_id,false);
    SELECT updated_at INTO v_expected FROM public.products WHERE id=p_product_id;
  END IF;
  v_result:=public.update_product_master_v4(p_product_id,v_expected,p_sku,p_barcode,p_name_ar,p_description,p_category_id,p_brand_id,p_unit_id,p_purchase_unit_id,p_units_per_purchase_unit,p_default_purchase_price_in_minor_units,p_sale_unit_id,p_units_per_sale_unit,p_default_sale_price_in_minor_units,p_cost_price_in_minor_units,p_min_stock_level,p_max_stock_level,p_is_active,p_image_url);
  IF p_parcel_only IS NOT NULL THEN PERFORM public.parcel209_set_flag_internal(p_product_id,p_parcel_only);END IF;
  RETURN v_result||jsonb_build_object('parcelOnly',(SELECT parcel_only FROM public.products WHERE id=p_product_id),
    'updatedAt',(SELECT updated_at FROM public.products WHERE id=p_product_id));
END;
$$;

ALTER FUNCTION public.update_product_master_v5(uuid,timestamp with time zone,text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,boolean,text,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_product_master_v5(uuid,timestamp with time zone,text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,boolean,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.update_product_master_v5(uuid,timestamp with time zone,text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,boolean,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.import_go_live_products_v1(p_idempotency_key text, p_rows jsonb, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_replay JSONB;
  v_row JSONB;
  v_n INTEGER := 0;
  v_errors JSONB := '[]'::JSONB;
  v_error TEXT;
  v_sku TEXT;
  v_barcode TEXT;
  v_name TEXT;
  v_category_id UUID;
  v_unit_id UUID;
  v_purchase_unit_id UUID;
  v_sale_unit_id UUID;
  v_units_per_purchase INTEGER;
  v_units_per_sale INTEGER;
  v_sale_price BIGINT;
  v_purchase_price BIGINT;
  v_cost BIGINT;
  v_min_stock INTEGER;
  v_count INTEGER;
  v_created JSONB := '[]'::JSONB;
  v_product JSONB;
  v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'], 'استيراد منتجات بداية التشغيل');
  PERFORM public.go_live_assert_setup_open_internal();
  IF NOT COALESCE(p_dry_run, false) THEN
    v_replay := public.go_live_begin_batch_internal('products', p_idempotency_key, p_rows);
    IF v_replay IS NOT NULL THEN
      RETURN v_replay;
    END IF;
  ELSIF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array'
    OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'الدفعة يجب أن تحتوي من 1 إلى 500 سطر.';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_n := v_n + 1;
    v_error := NULL;
    v_sku := NULLIF(BTRIM(v_row->>'sku'), '');
    v_barcode := NULLIF(BTRIM(v_row->>'barcode'), '');
    v_name := NULLIF(BTRIM(v_row->>'name_ar'), '');
    v_category_id := NULL; v_unit_id := NULL; v_purchase_unit_id := NULL; v_sale_unit_id := NULL;

    IF jsonb_typeof(v_row) <> 'object' THEN
      v_error := 'بيانات السطر غير صحيحة.';
    ELSIF v_sku IS NULL OR CHAR_LENGTH(v_sku) > 64 THEN
      v_error := 'رمز الصنف SKU مطلوب وبحد أقصى 64 حرفاً.';
    ELSIF v_name IS NULL OR CHAR_LENGTH(v_name) > 200 THEN
      v_error := 'اسم المنتج مطلوب وبحد أقصى 200 حرف.';
    ELSIF v_barcode IS NOT NULL AND CHAR_LENGTH(v_barcode) > 64 THEN
      v_error := 'الباركود أطول من المسموح.';
    ELSIF COALESCE(v_row->>'units_per_purchase_unit', '') !~ '^[1-9][0-9]{0,5}$'
      OR COALESCE(v_row->>'units_per_sale_unit', '') !~ '^[1-9][0-9]{0,5}$' THEN
      v_error := 'عدد الحبات داخل الطرد يجب أن يكون رقماً صحيحاً أكبر من صفر.';
    ELSIF v_row ? 'parcel_only' AND jsonb_typeof(v_row->'parcel_only') IS DISTINCT FROM 'boolean' THEN
      v_error := 'PARCEL209_METHOD_INVALID: حقل بيتباع بالطرد بس يجب أن يكون نعم أو لا.';
    ELSIF COALESCE((v_row->>'parcel_only')::BOOLEAN,false) AND (v_row->>'units_per_sale_unit')::INTEGER<=1 THEN
      v_error := 'PARCEL209_PARCEL_SIZE_REQUIRED: الطرد فقط يحتاج أكثر من وحدة في طرد البيع.';
    ELSIF COALESCE(v_row->>'sale_package_price_in_minor_units', '') !~ '^[1-9][0-9]{0,11}$' THEN
      v_error := 'سعر بيع الطرد يجب أن يكون أكبر من صفر.';
    ELSIF COALESCE(v_row->>'purchase_package_price_in_minor_units', '') !~ '^[0-9]{1,12}$'
      OR COALESCE(v_row->>'cost_per_base_unit_in_minor_units', '') !~ '^[0-9]{1,12}$'
      OR COALESCE(v_row->>'min_stock_level', '0') !~ '^[0-9]{1,9}$' THEN
      v_error := 'الأسعار والحد الأدنى يجب أن تكون أرقاماً موجبة صحيحة.';
    END IF;

    IF v_error IS NULL THEN
      SELECT COUNT(*), MIN(id::TEXT)::UUID INTO v_count, v_category_id FROM public.categories
      WHERE is_active AND name_ar = BTRIM(v_row->>'category_name');
      IF v_count <> 1 THEN
        v_error := CASE WHEN v_count = 0 THEN 'القسم غير موجود؛ أضفه أولاً أو صحّح اسمه.'
          ELSE 'اسم القسم مكرر؛ صحّح الأقسام أولاً.' END;
      END IF;
    END IF;
    IF v_error IS NULL THEN
      v_unit_id := public.go_live_resolve_unit_internal(v_row->>'base_unit_name');
      IF v_unit_id IS NULL THEN
        v_error := 'الوحدة الصغرى غير موجودة أو اسمها مكرر؛ اكتب رمز الوحدة (مثل PKT).';
      END IF;
    END IF;
    IF v_error IS NULL THEN
      v_purchase_unit_id := public.go_live_resolve_unit_internal(v_row->>'purchase_unit_name');
      IF v_purchase_unit_id IS NULL THEN
        v_error := 'وحدة طرد الشراء غير موجودة أو اسمها مكرر؛ اكتب رمز الوحدة (مثل CTN).';
      END IF;
    END IF;
    IF v_error IS NULL THEN
      v_sale_unit_id := public.go_live_resolve_unit_internal(v_row->>'sale_unit_name');
      IF v_sale_unit_id IS NULL THEN
        v_error := 'وحدة طرد البيع غير موجودة أو اسمها مكرر؛ اكتب رمز الوحدة (مثل CTN).';
      END IF;
    END IF;
    IF v_error IS NULL AND EXISTS (SELECT 1 FROM public.products WHERE lower(sku) = lower(v_sku)) THEN
      v_error := 'رمز SKU مستخدم لمنتج موجود.';
    END IF;
    IF v_error IS NULL AND v_barcode IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.products WHERE barcode = v_barcode) THEN
      v_error := 'الباركود مستخدم لمنتج موجود.';
    END IF;
    IF v_error IS NULL AND (
      SELECT COUNT(*) FROM jsonb_array_elements(p_rows) other
      WHERE lower(BTRIM(other->>'sku')) = lower(v_sku)) > 1 THEN
      v_error := 'رمز SKU مكرر داخل الملف.';
    END IF;
    IF v_error IS NULL AND v_barcode IS NOT NULL AND (
      SELECT COUNT(*) FROM jsonb_array_elements(p_rows) other
      WHERE BTRIM(other->>'barcode') = v_barcode) > 1 THEN
      v_error := 'الباركود مكرر داخل الملف.';
    END IF;

    IF v_error IS NOT NULL THEN
      v_errors := v_errors || jsonb_build_object('row', v_n, 'message', v_error);
      CONTINUE;
    END IF;
    IF COALESCE(p_dry_run, false) THEN
      CONTINUE;
    END IF;

    v_units_per_purchase := (v_row->>'units_per_purchase_unit')::INTEGER;
    v_units_per_sale := (v_row->>'units_per_sale_unit')::INTEGER;
    v_sale_price := (v_row->>'sale_package_price_in_minor_units')::BIGINT;
    v_purchase_price := (v_row->>'purchase_package_price_in_minor_units')::BIGINT;
    v_cost := (v_row->>'cost_per_base_unit_in_minor_units')::BIGINT;
    v_min_stock := COALESCE((v_row->>'min_stock_level')::INTEGER, 0);
    BEGIN
      v_product := public.create_product_with_opening_stock_v5(
        v_sku, v_barcode, v_name, NULL, v_category_id, NULL, v_unit_id,
        v_purchase_unit_id, v_units_per_purchase, v_purchase_price,
        v_sale_unit_id, v_units_per_sale, v_sale_price, v_cost, v_min_stock,
        NULL, NULL, 0, 'تعريف منتج من بداية التشغيل', NULL, COALESCE((v_row->>'parcel_only')::BOOLEAN,false));
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'GO_LIVE_ROW_FAILED: السطر ' || v_n || ': ' || SQLERRM;
    END;
    v_created := v_created || jsonb_build_object('row', v_n, 'productId', v_product->>'product_id', 'sku', v_sku);
  END LOOP;

  IF COALESCE(p_dry_run, false) THEN
    RETURN jsonb_build_object('success', true, 'dryRun', true, 'rowCount', v_n,
      'validCount', v_n - jsonb_array_length(v_errors), 'errors', v_errors);
  END IF;
  IF jsonb_array_length(v_errors) > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'GO_LIVE_BATCH_INVALID: الملف يحتوي أسطراً غير صالحة؛ لم يُحفظ أي سطر.',
      DETAIL = v_errors::TEXT;
  END IF;

  v_result := jsonb_build_object('success', true, 'dryRun', false, 'idempotentReplay', false,
    'kind', 'products', 'rowCount', v_n, 'created', v_created);
  INSERT INTO public.go_live_import_batches(batch_kind, idempotency_key, request_hash, row_count, result, created_by)
  VALUES ('products', BTRIM(p_idempotency_key), md5(p_rows::TEXT), v_n, v_result, v_user_id);
  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'GO_LIVE_IMPORT_PRODUCTS', 'go_live_import_batches', NULL,
    jsonb_build_object('idempotency_key', BTRIM(p_idempotency_key), 'row_count', v_n,
      'skus', (SELECT jsonb_agg(c->>'sku') FROM jsonb_array_elements(v_created) c)));
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_product_listing()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
        p.parcel_only,
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
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_product_page(p_page integer DEFAULT 1, p_page_size integer DEFAULT 24, p_search text DEFAULT NULL::text, p_category_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'all'::text, p_sort text DEFAULT 'name'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
        COALESCE(SUM(stock.available_quantity), 0)::INTEGER AS available_quantity,
        COALESCE(SUM(
          COALESCE(stock.on_hand_quantity, 0)::NUMERIC
            * COALESCE(
                child.wac_cost_in_minor_units_exact,
                child.cost_price_in_minor_units::NUMERIC
              )
        ), 0)::NUMERIC AS inventory_value_in_minor_units_exact
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
        END::INTEGER AS effective_available_quantity,
        CASE WHEN product.is_flavor_master
          THEN COALESCE(family.inventory_value_in_minor_units_exact, 0)
          ELSE COALESCE(stock.on_hand_quantity, 0)::NUMERIC
            * COALESCE(
                product.wac_cost_in_minor_units_exact,
                product.cost_price_in_minor_units::NUMERIC
              )
        END::NUMERIC AS effective_inventory_value_in_minor_units_exact
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
        product.parcel_only,
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
        ROUND(COALESCE(SUM(
          root.effective_inventory_value_in_minor_units_exact
        ), 0), 0)::BIGINT AS inventory_cost_in_minor_units,
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
$function$;

CREATE OR REPLACE FUNCTION public.search_admin_products(p_search text DEFAULT NULL::text, p_limit integer DEFAULT 24, p_category_id uuid DEFAULT NULL::uuid, p_purpose text DEFAULT 'stockable'::text, p_product_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
        product.parcel_only,
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
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_inventory_product_page(p_page integer DEFAULT 1, p_page_size integer DEFAULT 24, p_search text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid, p_warehouse_id uuid DEFAULT NULL::uuid, p_category_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
        product.parcel_only,
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
$function$;

CREATE OR REPLACE FUNCTION public.get_public_product_catalog(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_category_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH catalog_source AS (
    SELECT
      p.id,
      p.sku,
      p.barcode,
      p.name_ar,
      p.description,
      p.category_id,
      c.code AS category_code,
      c.name_ar AS category_name_ar,
      p.brand_id,
      b.name_ar AS brand_name_ar,
      p.unit_id,
      base_unit.name_ar AS unit_name_ar,
      p.sale_unit_id,
      sale_unit.name_ar AS sale_unit_name_ar,
      p.units_per_sale_unit,
      p.parcel_only,
      p.default_sale_price_in_minor_units,
      p.sale_price_in_minor_units,
      COALESCE(stock.available_quantity, 0)::INTEGER AS available_quantity,
      image.image_url
    FROM public.products p
    LEFT JOIN public.categories c ON c.id = p.category_id
    LEFT JOIN public.brands b ON b.id = p.brand_id
    LEFT JOIN public.units base_unit ON base_unit.id = p.unit_id
    LEFT JOIN public.units sale_unit ON sale_unit.id = p.sale_unit_id
    LEFT JOIN LATERAL (
      SELECT
        SUM(
          GREATEST(
            ib.on_hand_quantity - ib.reserved_quantity,
            0
          )
        ) AS available_quantity
      FROM public.inventory_balances ib
      WHERE ib.product_id = p.id
    ) stock ON true
    LEFT JOIN LATERAL (
      SELECT pi.image_url
      FROM public.product_images pi
      WHERE pi.product_id = p.id
      ORDER BY pi.is_primary DESC, pi.display_order, pi.created_at
      LIMIT 1
    ) image ON true
    WHERE p.is_active = true
      AND c.is_active = true
      AND p.sale_unit_id IS NOT NULL
      AND sale_unit.code <> 'PCS'
      AND p.units_per_sale_unit > 0
      AND p.default_sale_price_in_minor_units > 0
  ),
  catalog AS (
    SELECT *
    FROM catalog_source
    WHERE (p_category_id IS NULL OR category_id = p_category_id)
      AND (
        NULLIF(TRIM(p_search), '') IS NULL
        OR name_ar ILIKE '%' || TRIM(p_search) || '%'
        OR sku ILIKE '%' || TRIM(p_search) || '%'
        OR COALESCE(barcode, '') ILIKE '%' || TRIM(p_search) || '%'
      )
  ),
  paged AS (
    SELECT *
    FROM catalog
    ORDER BY name_ar, id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ),
  category_summary AS (
    SELECT
      c.id,
      c.code,
      c.name_ar,
      COUNT(cs.id)::INTEGER AS product_count,
      COUNT(cs.id) FILTER (
        WHERE cs.available_quantity >= cs.units_per_sale_unit
      )::INTEGER AS available_product_count,
      CASE c.code
        WHEN 'CAT-BEV' THEN 10
        WHEN 'CAT-WATER' THEN 20
        WHEN 'CAT-ENERGY' THEN 30
        WHEN 'CAT-BISCUIT' THEN 40
        WHEN 'CAT-CAKE' THEN 50
        WHEN 'CAT-CHOCO' THEN 60
        WHEN 'CAT-CANDY' THEN 70
        WHEN 'CAT-GUM' THEN 80
        WHEN 'CAT-CHIPS' THEN 90
        WHEN 'CAT-FOOD' THEN 100
        WHEN 'CAT-GIFTS' THEN 110
        WHEN 'CAT-OFFERS' THEN 120
        ELSE 1000
      END AS sort_order
    FROM public.categories c
    LEFT JOIN catalog_source cs ON cs.category_id = c.id
    WHERE c.is_active = true
    GROUP BY c.id, c.code, c.name_ar
  )
  SELECT jsonb_build_object(
    'items',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', id,
          'sku', sku,
          'barcode', barcode,
          'nameAr', name_ar,
          'description', description,
          'categoryId', category_id,
          'categoryCode', category_code,
          'categoryNameAr', category_name_ar,
          'brandId', brand_id,
          'brandNameAr', brand_name_ar,
          'unitId', unit_id,
          'unitNameAr', unit_name_ar,
          'saleUnitId', sale_unit_id,
          'saleUnitNameAr', sale_unit_name_ar,
          'unitsPerSalePackage', units_per_sale_unit,
          'parcelOnly', parcel_only,
          'salePackagePriceInMinorUnits',
            default_sale_price_in_minor_units,
          'salePriceInMinorUnits', sale_price_in_minor_units,
          'availableQuantity', available_quantity,
          'availableSalePackages',
            FLOOR(available_quantity::NUMERIC / units_per_sale_unit),
          'minimumOrderPackages', 1,
          'imageUrl', image_url,
          'isAvailable', available_quantity >= units_per_sale_unit
        )
        ORDER BY name_ar, id
      )
      FROM paged
    ), '[]'::jsonb),
    'categories',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', id,
          'code', code,
          'nameAr', name_ar,
          'productCount', product_count,
          'availableProductCount', available_product_count
        )
        ORDER BY sort_order, name_ar, id
      )
      FROM category_summary
    ), '[]'::jsonb),
    'total', (SELECT COUNT(*) FROM catalog),
    'limit', LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200),
    'offset', GREATEST(COALESCE(p_offset, 0), 0)
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_public_storefront_catalog_page(p_limit integer DEFAULT 24, p_offset integer DEFAULT 0, p_category_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_availability text DEFAULT 'all'::text, p_sort text DEFAULT 'recommended'::text, p_brand_id uuid DEFAULT NULL::uuid, p_sale_unit_id uuid DEFAULT NULL::uuid, p_product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH stock_by_product AS (
    SELECT
      ib.product_id,
      COALESCE(SUM(GREATEST(ib.on_hand_quantity - ib.reserved_quantity, 0)), 0)::INTEGER
        AS available_quantity
    FROM public.inventory_balances ib
    GROUP BY ib.product_id
  ),
  sales_by_product AS (
    SELECT
      oi.product_id,
      COALESCE(SUM(COALESCE(oi.sale_package_quantity, 0)), 0)::BIGINT
        AS sold_packages
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.status = 'completed'
      AND o.created_at >= NOW() - INTERVAL '90 days'
    GROUP BY oi.product_id
  ),
  catalog_source AS (
    SELECT
      p.id,
      p.sku,
      p.barcode,
      p.name_ar,
      p.description,
      p.category_id,
      c.code AS category_code,
      c.name_ar AS category_name_ar,
      p.brand_id,
      b.name_ar AS brand_name_ar,
      p.unit_id,
      base_unit.name_ar AS unit_name_ar,
      p.sale_unit_id,
      sale_unit.name_ar AS sale_unit_name_ar,
      p.units_per_sale_unit,
      p.parcel_only,
      p.default_sale_price_in_minor_units,
      p.sale_price_in_minor_units,
      COALESCE(stock.available_quantity, 0)::INTEGER AS available_quantity,
      image.image_url,
      p.created_at,
      COALESCE(sales.sold_packages, 0)::BIGINT AS sold_packages_last_90_days,
      p.flavor_master_product_id,
      p.flavor_name_ar,
      p.is_flavor_master,
      p.flavor_sort_order,
      COALESCE(p.flavor_master_product_id, p.id) AS family_id
    FROM public.products p
    JOIN public.categories c ON c.id = p.category_id AND c.is_active = true
    LEFT JOIN public.brands b ON b.id = p.brand_id
    JOIN public.units base_unit ON base_unit.id = p.unit_id
    JOIN public.units sale_unit ON sale_unit.id = p.sale_unit_id
    LEFT JOIN stock_by_product stock ON stock.product_id = p.id
    LEFT JOIN sales_by_product sales ON sales.product_id = p.id
    LEFT JOIN LATERAL (
      SELECT pi.image_url
      FROM public.product_images pi
      WHERE pi.product_id = p.id
      ORDER BY pi.is_primary DESC, pi.display_order, pi.created_at
      LIMIT 1
    ) image ON true
    WHERE p.is_active = true
      AND sale_unit.code <> 'PCS'
      AND p.units_per_sale_unit > 0
      AND p.default_sale_price_in_minor_units > 0
  ),
  family_summary AS (
    SELECT
      family_id,
      MIN(category_id::TEXT)::UUID AS category_id,
      MIN(category_code) AS category_code,
      MIN(brand_id::TEXT)::UUID AS brand_id,
      MIN(sale_unit_id::TEXT)::UUID AS sale_unit_id,
      COALESCE(
        MIN(name_ar) FILTER (WHERE flavor_master_product_id IS NULL),
        MIN(name_ar)
      ) AS family_name_ar,
      MIN(default_sale_price_in_minor_units) AS sale_price_in_minor_units,
      COALESCE(SUM(
        FLOOR(available_quantity::NUMERIC / units_per_sale_unit)
      ) FILTER (WHERE NOT is_flavor_master), 0)::INTEGER AS available_sale_packages,
      BOOL_OR(
        NOT is_flavor_master
        AND available_quantity >= units_per_sale_unit
      ) AS is_available,
      BOOL_OR(
        NOT is_flavor_master
        AND available_quantity >= units_per_sale_unit
        AND FLOOR(available_quantity::NUMERIC / units_per_sale_unit) <= 5
      ) AS is_low_stock,
      MAX(created_at) AS created_at,
      COALESCE(SUM(sold_packages_last_90_days) FILTER (WHERE NOT is_flavor_master), 0)::BIGINT
        AS sold_packages_last_90_days
    FROM catalog_source
    GROUP BY family_id
  ),
  normalized_search AS (
    SELECT LOWER(TRANSLATE(
      REGEXP_REPLACE(COALESCE(NULLIF(BTRIM(p_search), ''), ''), '[ً-ٰٟـ]', '', 'g'),
      'أإآى',
      'اااي'
    )) AS value
  ),
  matching_families AS (
    SELECT fs.*
    FROM family_summary fs
    CROSS JOIN normalized_search normalized
    WHERE (p_category_id IS NULL OR fs.category_id = p_category_id)
      AND (p_brand_id IS NULL OR fs.brand_id = p_brand_id)
      AND (p_sale_unit_id IS NULL OR fs.sale_unit_id = p_sale_unit_id)
      AND (
        p_product_ids IS NULL
        OR fs.family_id = ANY (p_product_ids)
        OR EXISTS (
          SELECT 1
          FROM catalog_source favorite_member
          WHERE favorite_member.family_id = fs.family_id
            AND favorite_member.id = ANY (p_product_ids)
        )
      )
      AND (
        p_availability NOT IN ('available', 'low_stock')
        OR (p_availability = 'available' AND fs.is_available)
        OR (p_availability = 'low_stock' AND fs.is_low_stock)
      )
      AND (p_sort <> 'offers' OR fs.category_code = 'CAT-OFFERS')
      AND (p_sort <> 'low_stock' OR fs.is_low_stock)
      AND (
        normalized.value = ''
        OR EXISTS (
          SELECT 1
          FROM catalog_source searched_member
          WHERE searched_member.family_id = fs.family_id
            AND (
              LOWER(TRANSLATE(REGEXP_REPLACE(searched_member.name_ar, '[ً-ٰٟـ]', '', 'g'), 'أإآى', 'اااي')) LIKE '%' || normalized.value || '%'
              OR LOWER(TRANSLATE(REGEXP_REPLACE(searched_member.sku, '[ً-ٰٟـ]', '', 'g'), 'أإآى', 'اااي')) LIKE '%' || normalized.value || '%'
              OR LOWER(TRANSLATE(REGEXP_REPLACE(COALESCE(searched_member.barcode, ''), '[ً-ٰٟـ]', '', 'g'), 'أإآى', 'اااي')) LIKE '%' || normalized.value || '%'
              OR LOWER(TRANSLATE(REGEXP_REPLACE(COALESCE(searched_member.description, ''), '[ً-ٰٟـ]', '', 'g'), 'أإآى', 'اااي')) LIKE '%' || normalized.value || '%'
              OR LOWER(TRANSLATE(REGEXP_REPLACE(COALESCE(searched_member.brand_name_ar, ''), '[ً-ٰٟـ]', '', 'g'), 'أإآى', 'اااي')) LIKE '%' || normalized.value || '%'
            )
        )
      )
  ),
  paged_families AS (
    SELECT
      mf.*,
      ROW_NUMBER() OVER (
        ORDER BY
          mf.is_available DESC,
          CASE WHEN p_sort = 'name_asc' THEN mf.family_name_ar END ASC,
          CASE WHEN p_sort = 'price_asc' THEN mf.sale_price_in_minor_units END ASC,
          CASE WHEN p_sort = 'price_desc' THEN mf.sale_price_in_minor_units END DESC,
          CASE WHEN p_sort = 'stock_desc' THEN mf.available_sale_packages END DESC,
          CASE WHEN p_sort = 'newest' THEN mf.created_at END DESC,
          CASE WHEN p_sort = 'best_sellers' THEN mf.sold_packages_last_90_days END DESC,
          CASE WHEN p_sort = 'low_stock' THEN mf.available_sale_packages END ASC,
          mf.family_name_ar ASC,
          mf.family_id ASC
      ) AS page_order
    FROM matching_families mf
    ORDER BY
      mf.is_available DESC,
      CASE WHEN p_sort = 'name_asc' THEN mf.family_name_ar END ASC,
      CASE WHEN p_sort = 'price_asc' THEN mf.sale_price_in_minor_units END ASC,
      CASE WHEN p_sort = 'price_desc' THEN mf.sale_price_in_minor_units END DESC,
      CASE WHEN p_sort = 'stock_desc' THEN mf.available_sale_packages END DESC,
      CASE WHEN p_sort = 'newest' THEN mf.created_at END DESC,
      CASE WHEN p_sort = 'best_sellers' THEN mf.sold_packages_last_90_days END DESC,
      CASE WHEN p_sort = 'low_stock' THEN mf.available_sale_packages END ASC,
      mf.family_name_ar ASC,
      mf.family_id ASC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 48)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ),
  page_items AS (
    SELECT
      pf.page_order,
      cs.*
    FROM paged_families pf
    JOIN catalog_source cs ON cs.family_id = pf.family_id
  ),
  category_summary AS (
    SELECT
      c.id,
      c.code,
      c.name_ar,
      c.image_url,
      COUNT(fs.family_id)::INTEGER AS product_count,
      COUNT(fs.family_id) FILTER (WHERE fs.is_available)::INTEGER AS available_product_count,
      CASE c.code
        WHEN 'CAT-BEV' THEN 10 WHEN 'CAT-WATER' THEN 20
        WHEN 'CAT-ENERGY' THEN 30 WHEN 'CAT-BISCUIT' THEN 40
        WHEN 'CAT-CAKE' THEN 50 WHEN 'CAT-CHOCO' THEN 60
        WHEN 'CAT-CANDY' THEN 70 WHEN 'CAT-GUM' THEN 80
        WHEN 'CAT-CHIPS' THEN 90 WHEN 'CAT-FOOD' THEN 100
        WHEN 'CAT-GIFTS' THEN 110 WHEN 'CAT-OFFERS' THEN 120
        ELSE 1000
      END AS sort_order
    FROM public.categories c
    LEFT JOIN family_summary fs ON fs.category_id = c.id
    WHERE c.is_active = true
    GROUP BY c.id, c.code, c.name_ar, c.image_url
  ),
  brand_facets AS (
    SELECT fs.brand_id AS id, MIN(cs.brand_name_ar) AS name_ar
    FROM family_summary fs
    JOIN catalog_source cs ON cs.family_id = fs.family_id
    WHERE fs.brand_id IS NOT NULL
    GROUP BY fs.brand_id
  ),
  sale_unit_facets AS (
    SELECT fs.sale_unit_id AS id, MIN(cs.sale_unit_name_ar) AS name_ar
    FROM family_summary fs
    JOIN catalog_source cs ON cs.family_id = fs.family_id
    WHERE fs.sale_unit_id IS NOT NULL
    GROUP BY fs.sale_unit_id
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', id,
          'sku', sku,
          'barcode', barcode,
          'nameAr', name_ar,
          'description', description,
          'categoryId', category_id,
          'categoryCode', category_code,
          'categoryNameAr', category_name_ar,
          'brandId', brand_id,
          'brandNameAr', brand_name_ar,
          'unitId', unit_id,
          'unitNameAr', unit_name_ar,
          'saleUnitId', sale_unit_id,
          'saleUnitNameAr', sale_unit_name_ar,
          'unitsPerSalePackage', units_per_sale_unit,
          'parcelOnly', parcel_only,
          'salePackagePriceInMinorUnits', default_sale_price_in_minor_units,
          'salePriceInMinorUnits', sale_price_in_minor_units,
          'availableQuantity', available_quantity,
          'availableSalePackages', FLOOR(available_quantity::NUMERIC / units_per_sale_unit),
          'minimumOrderPackages', 1,
          'imageUrl', image_url,
          'isAvailable', available_quantity >= units_per_sale_unit AND NOT is_flavor_master,
          'createdAt', created_at,
          'soldPackagesLast90Days', sold_packages_last_90_days,
          'flavorMasterProductId', flavor_master_product_id,
          'flavorNameAr', flavor_name_ar,
          'isFlavorMaster', is_flavor_master,
          'flavorSortOrder', flavor_sort_order
        )
        ORDER BY page_order,
          CASE WHEN flavor_master_product_id IS NULL THEN 0 ELSE 1 END,
          flavor_sort_order,
          name_ar,
          id
      )
      FROM page_items
    ), '[]'::jsonb),
    'categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'code', code, 'nameAr', name_ar, 'imageUrl', image_url,
        'productCount', product_count, 'availableProductCount', available_product_count
      ) ORDER BY sort_order, name_ar, id)
      FROM category_summary
    ), '[]'::jsonb),
    'brands', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', id, 'nameAr', name_ar) ORDER BY name_ar, id)
      FROM brand_facets
    ), '[]'::jsonb),
    'saleUnits', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', id, 'nameAr', name_ar) ORDER BY name_ar, id)
      FROM sale_unit_facets
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'availableProducts', (SELECT COUNT(*) FROM matching_families WHERE is_available),
      'availableSalePackages', (SELECT COALESCE(SUM(available_sale_packages), 0) FROM matching_families),
      'lowStockProducts', (SELECT COUNT(*) FROM matching_families WHERE is_low_stock)
    ),
    'total', (SELECT COUNT(*) FROM matching_families),
    'limit', LEAST(GREATEST(COALESCE(p_limit, 24), 1), 48),
    'offset', GREATEST(COALESCE(p_offset, 0), 0)
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_sales_aftercare_context_v1(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_creation_type TEXT;
  v_capability TEXT;
  v_completion TIMESTAMPTZ;
  v_financial RECORD;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner', 'admin'], 'قراءة سياق خدمات ما بعد البيع');
  SELECT * INTO v_order FROM public.orders customer_order WHERE customer_order.id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'PHASE43_ORDER_NOT_FOUND: Order does not exist.';
  END IF;
  SELECT operation.operation_type INTO v_creation_type
  FROM public.business_operations operation WHERE operation.id = v_order.operation_id;

  IF v_creation_type IS DISTINCT FROM 'phase3_pos_sale_v1'
    AND v_creation_type IS DISTINCT FROM 'phase3_customer_reservation_v1'
  THEN
    v_capability := CASE
      WHEN v_order.operation_id IS NULL AND v_order.source = 'website'
        THEN 'legacy_website_return_v1'
      WHEN v_order.operation_id IS NULL AND v_order.source = 'pos'
        THEN 'legacy_pos_v1_unsupported'
      ELSE 'unsupported_contract'
    END;

    RETURN JSONB_BUILD_OBJECT(
      'contractVersion', 403,
      'serverTime', clock_timestamp(),
      'supported', false,
      'capability', v_capability,
      'order', JSONB_BUILD_OBJECT(
        'id', v_order.id, 'orderNumber', v_order.order_number,
        'status', v_order.status, 'saleContract', v_creation_type,
        'source', v_order.source,
        'branchId', v_order.branch_id, 'warehouseId', v_order.warehouse_id,
        'completedAt', NULL, 'deadlineAt', NULL, 'withinWindow', false
      ),
      'financial', NULL,
      'baseItems', '[]'::JSONB,
      'parcelInstances', '[]'::JSONB,
      'returns', '[]'::JSONB,
      'replacements', '[]'::JSONB
    );
  END IF;

  v_completion := public.phase4_authoritative_completion_internal(p_order_id);
  SELECT * INTO v_financial FROM public.phase42_order_financial_position_internal(p_order_id);
  RETURN JSONB_BUILD_OBJECT(
    'contractVersion', 403,
    'serverTime', clock_timestamp(),
    'supported', true,
    'capability', 'phase43_modern',
    'order', JSONB_BUILD_OBJECT(
      'id', v_order.id, 'orderNumber', v_order.order_number,
      'status', v_order.status, 'saleContract', v_creation_type,
      'branchId', v_order.branch_id, 'warehouseId', v_order.warehouse_id,
      'completedAt', v_completion, 'deadlineAt', v_completion + INTERVAL '48 hours',
      'withinWindow', clock_timestamp() <= v_completion + INTERVAL '48 hours'
    ),
    'financial', JSONB_BUILD_OBJECT(
      'merchandiseDebtInMinorUnits', v_financial.merchandise_debt_in_minor_units,
      'refundableCollectedInMinorUnits', v_financial.refundable_collected_in_minor_units,
      'deliveryFeeInMinorUnits', v_financial.delivery_fee_in_minor_units
    ),
    'baseItems', COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
      'orderItemId', item.id, 'productId', item.product_id,
      'parcelOnly',public.parcel209_effective_only_internal(item.product_id),
      'quantity', item.quantity,
      'commercialLineKind',item.commercial_line_kind,
      'unitsPerParcel',CASE WHEN item.commercial_line_kind='legacy_single_sku_parcel' THEN item.units_per_sale_package ELSE 1 END,
      'commercialQuantity',CASE WHEN item.commercial_line_kind='legacy_single_sku_parcel' THEN item.sale_package_quantity ELSE item.quantity END,
      'standalonePriceInMinorUnits',item.effective_standalone_unit_sale_price_snapshot_in_minor_units,
      'remainingQuantity', GREATEST(item.quantity - COALESCE(consumed.quantity, 0), 0),
      'physicalRepresentatives', public.phase43_current_physical_representatives_internal(
        'base_order_item', item.id, item.product_id
      )
    ) ORDER BY item.id)
    FROM public.order_items item
    LEFT JOIN LATERAL (
      SELECT SUM(consumption.consumed_quantity)::INTEGER quantity
      FROM public.sales_aftercare_consumptions consumption
      WHERE consumption.source_kind = 'base_order_item'
        AND consumption.source_id = item.id
        AND consumption.consumption_state = 'settled'
    ) consumed ON true
    WHERE item.order_id = p_order_id
      AND item.commercial_line_kind IN ('base_unit','legacy_single_sku_parcel')), '[]'::JSONB),
    'parcelInstances', COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
      'parcelInstanceId', instance.id, 'orderItemId', instance.order_item_id,
      'components', (SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
        'parcelComponentId', component.id, 'productId', component.product_id,
        'parcelOnly',public.parcel209_effective_only_internal(component.product_id),
        'quantity', component.base_quantity,
        'physicalRepresentatives', public.phase43_current_physical_representatives_internal(
          'parcel_component', component.id, component.product_id
        )
      ) ORDER BY component.id), '[]'::JSONB)
      FROM public.order_parcel_components component
      WHERE component.parcel_instance_id = instance.id)
    ) ORDER BY instance.id)
    FROM public.order_parcel_instances instance
    WHERE instance.order_id = p_order_id), '[]'::JSONB),
    'returns', COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
      'returnId', event.id, 'status', event.settlement_status,
      'createdAt', event.created_at, 'settledAt', event.settled_at,
      'merchandiseEntitlementInMinorUnits', event.merchandise_refund_amount_in_minor_units,
      'debtReductionInMinorUnits', event.debt_reduction_amount_in_minor_units,
      'moneyRefundInMinorUnits', event.money_refund_amount_in_minor_units
    ) ORDER BY event.created_at, event.id)
    FROM public.sales_return_events event WHERE event.order_id = p_order_id), '[]'::JSONB),
    'replacements', COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
      'replacementId', event.id, 'foundationStatus', event.replacement_status,
      'operationalStatus', CASE WHEN event.issuance_status = 'issued'
        AND event.issuance_coordinator_version = 403 THEN 'issued' ELSE 'foundation_only' END,
      'createdAt', event.created_at, 'issuedAt', event.issued_at,
      'items', (SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
        'replacementItemId', item.id, 'productId', item.product_id,
        'quantity', item.quantity, 'parentReplacementItemId', item.parent_replacement_item_id,
        'rootOrderItemId', item.root_order_item_id,
        'rootParcelComponentId', item.root_parcel_component_id
      ) ORDER BY item.id), '[]'::JSONB)
      FROM public.sales_replacement_items item WHERE item.replacement_event_id = event.id)
    ) ORDER BY event.created_at, event.id)
    FROM public.sales_replacement_events event WHERE event.root_order_id = p_order_id), '[]'::JSONB)
  );
END;
$function$;

COMMIT;
