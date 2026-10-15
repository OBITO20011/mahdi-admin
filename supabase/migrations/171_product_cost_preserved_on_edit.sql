-- Owner decision 2026-10-15: saving a product never rewrites its cost once the
-- product has stock history. Before this, the product form sent a cost derived
-- from the default purchase price and update_product_master (014) wrote it into
-- cost_price_in_minor_units, while receiving keeps wac_cost_in_minor_units_exact.
-- POS COGS and the order item cost snapshot read cost_price, so any save (even a
-- rename) silently changed later sale costs and profit and blocked receipt
-- reversal (its WAC snapshot no longer matched).
--
-- * update_product_master_v4 keeps cost_price and the exact WAC unchanged when
--   the product (or, for a flavor family, any of its flavors) has an inventory
--   movement or an exact WAC. default_purchase_price stays editable. A new
--   product without any movement keeps today's behaviour.
-- * correct_product_cost_v1: owner-only manual correction with a mandatory
--   reason; sets both columns consistently (cost_price = ROUND(exact), as
--   receiving does), audited and idempotent; no quantity or past sale changes.
-- * get_product_cost_state_v1: what the editor shows (read only).

CREATE FUNCTION public.product_has_cost_history_internal(p_product_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.products product
    WHERE (product.id = p_product_id OR product.flavor_master_product_id = p_product_id)
      AND (
        product.wac_cost_in_minor_units_exact IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM public.inventory_movements movement
          WHERE movement.product_id = product.id
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.product_has_cost_history_internal(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.product_has_cost_history_internal(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.product_has_cost_history_internal(UUID) FROM authenticated;

-- Explicit full redefinition of the 170 entry point (same signature, grants kept).
CREATE OR REPLACE FUNCTION public.update_product_master_v4(
  p_product_id UUID,
  p_expected_updated_at TIMESTAMPTZ,
  p_sku TEXT,
  p_barcode TEXT,
  p_name_ar TEXT,
  p_description TEXT,
  p_category_id UUID,
  p_brand_id UUID,
  p_unit_id UUID,
  p_purchase_unit_id UUID,
  p_units_per_purchase_unit INTEGER,
  p_default_purchase_price_in_minor_units BIGINT,
  p_sale_unit_id UUID,
  p_units_per_sale_unit INTEGER,
  p_default_sale_price_in_minor_units BIGINT,
  p_cost_price_in_minor_units BIGINT,
  p_min_stock_level INTEGER,
  p_max_stock_level INTEGER,
  p_is_active BOOLEAN,
  p_image_url TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
  v_has_history BOOLEAN;
  v_cost BIGINT;
  v_exact NUMERIC(24, 6);
  v_after_cost BIGINT;
  v_after_exact NUMERIC(24, 6);
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'تعديل منتج جملة'
  );
  -- Locks the row: receiving cannot move the cost between this read and the save.
  PERFORM public.product_edit_assert_version_internal(p_product_id, p_expected_updated_at);

  SELECT product.cost_price_in_minor_units, product.wac_cost_in_minor_units_exact
  INTO v_cost, v_exact
  FROM public.products product
  WHERE product.id = p_product_id;
  v_has_history := public.product_has_cost_history_internal(p_product_id);

  v_result := public.update_product_master_v3(
    p_product_id,
    p_sku,
    p_barcode,
    p_name_ar,
    p_description,
    p_category_id,
    p_brand_id,
    p_unit_id,
    p_purchase_unit_id,
    p_units_per_purchase_unit,
    p_default_purchase_price_in_minor_units,
    p_sale_unit_id,
    p_units_per_sale_unit,
    p_default_sale_price_in_minor_units,
    CASE WHEN v_has_history THEN v_cost ELSE p_cost_price_in_minor_units END,
    p_min_stock_level,
    p_max_stock_level,
    p_is_active,
    p_image_url
  );

  IF v_has_history THEN
    SELECT product.cost_price_in_minor_units, product.wac_cost_in_minor_units_exact
    INTO v_after_cost, v_after_exact
    FROM public.products product
    WHERE product.id = p_product_id;
    IF v_after_cost IS DISTINCT FROM v_cost OR v_after_exact IS DISTINCT FROM v_exact THEN
      RAISE EXCEPTION 'PRODUCT_COST_CHANGED_BY_EDIT: حفظ المنتج لا يغيّر متوسط التكلفة.';
    END IF;
  END IF;

  RETURN v_result || jsonb_build_object(
    'updatedAt',
    (SELECT product.updated_at FROM public.products product WHERE product.id = p_product_id),
    'costPreserved',
    v_has_history
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_product_master_v4(
  UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER,
  BIGINT, UUID, INTEGER, BIGINT, BIGINT, INTEGER, INTEGER, BOOLEAN, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_product_master_v4(
  UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER,
  BIGINT, UUID, INTEGER, BIGINT, BIGINT, INTEGER, INTEGER, BOOLEAN, TEXT
) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_product_master_v4(
  UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER,
  BIGINT, UUID, INTEGER, BIGINT, BIGINT, INTEGER, INTEGER, BOOLEAN, TEXT
) TO authenticated;

CREATE FUNCTION public.get_product_cost_state_v1(p_product_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product public.products%ROWTYPE;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'عرض تكلفة المنتج'
  );
  SELECT * INTO v_product FROM public.products product WHERE product.id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المنتج المحدد غير موجود.';
  END IF;
  RETURN jsonb_build_object(
    'productId', v_product.id,
    'updatedAt', v_product.updated_at,
    'isFlavorMaster', v_product.is_flavor_master,
    'hasCostHistory', public.product_has_cost_history_internal(v_product.id),
    'costPriceInMinorUnits', v_product.cost_price_in_minor_units,
    -- Text keeps all six decimals of the exact WAC.
    'wacCostExactInMinorUnits', v_product.wac_cost_in_minor_units_exact::TEXT,
    'defaultPurchasePriceInMinorUnits', v_product.default_purchase_price_in_minor_units
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_product_cost_state_v1(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_product_cost_state_v1(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_product_cost_state_v1(UUID) TO authenticated;

-- Append-only record of owner cost corrections (RPC-only table).
CREATE TABLE public.product_cost_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE
    CHECK (char_length(idempotency_key) BETWEEN 16 AND 200),
  request_fingerprint TEXT NOT NULL,
  prior_exact_in_minor_units NUMERIC(24, 6),
  prior_cost_price_in_minor_units BIGINT NOT NULL,
  new_exact_in_minor_units NUMERIC(24, 6) NOT NULL CHECK (new_exact_in_minor_units >= 0),
  new_cost_price_in_minor_units BIGINT NOT NULL CHECK (new_cost_price_in_minor_units >= 0),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 500),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_product_cost_corrections_product ON public.product_cost_corrections(product_id, created_at DESC);

ALTER TABLE public.product_cost_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.product_cost_corrections FROM PUBLIC;
REVOKE ALL ON TABLE public.product_cost_corrections FROM anon;
REVOKE ALL ON TABLE public.product_cost_corrections FROM authenticated;

CREATE FUNCTION public.product_cost_corrections_reject_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'PRODUCT_COST_CORRECTION_IMMUTABLE: سجل تصحيح التكلفة لا يُعدّل ولا يُحذف.';
END;
$$;

REVOKE ALL ON FUNCTION public.product_cost_corrections_reject_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.product_cost_corrections_reject_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.product_cost_corrections_reject_mutation() FROM authenticated;

CREATE TRIGGER trg_product_cost_corrections_immutable
BEFORE UPDATE OR DELETE ON public.product_cost_corrections
FOR EACH ROW EXECUTE FUNCTION public.product_cost_corrections_reject_mutation();
CREATE TRIGGER trg_product_cost_corrections_no_truncate
BEFORE TRUNCATE ON public.product_cost_corrections
FOR EACH STATEMENT EXECUTE FUNCTION public.product_cost_corrections_reject_mutation();

CREATE FUNCTION public.correct_product_cost_v1(
  p_product_id UUID,
  p_unit_cost_in_minor_units NUMERIC,
  p_reason TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reason TEXT := BTRIM(COALESCE(p_reason, ''));
  v_key TEXT := BTRIM(COALESCE(p_idempotency_key, ''));
  v_exact NUMERIC(24, 6);
  v_legacy BIGINT;
  v_fingerprint TEXT;
  v_existing public.product_cost_corrections%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_correction_id UUID;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'], 'تصحيح تكلفة المنتج');

  IF char_length(v_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION 'PRODUCT_COST_CORRECTION_KEY_INVALID: مفتاح العملية غير صالح.';
  END IF;
  IF char_length(v_reason) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'PRODUCT_COST_CORRECTION_REASON_REQUIRED: اكتب سبب التصحيح (5 إلى 500 حرف).';
  END IF;
  IF p_unit_cost_in_minor_units IS NULL OR p_unit_cost_in_minor_units < 0
    OR p_unit_cost_in_minor_units > 1000000000000 THEN
    RAISE EXCEPTION 'PRODUCT_COST_CORRECTION_VALUE_INVALID: تكلفة الحبة يجب أن تكون صفراً أو أكثر.';
  END IF;

  v_exact := ROUND(p_unit_cost_in_minor_units, 6);
  v_legacy := ROUND(v_exact)::BIGINT;
  v_fingerprint := md5(p_product_id::TEXT || '|' || v_exact::TEXT || '|' || v_reason);

  SELECT * INTO v_existing
  FROM public.product_cost_corrections correction
  WHERE correction.idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'PRODUCT_COST_CORRECTION_KEY_CONFLICT: استُخدم مفتاح العملية لتصحيح مختلف.';
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'idempotentReplay', true,
      'correctionId', v_existing.id,
      'productId', v_existing.product_id,
      'priorExactInMinorUnits', v_existing.prior_exact_in_minor_units::TEXT,
      'priorCostPriceInMinorUnits', v_existing.prior_cost_price_in_minor_units,
      'newExactInMinorUnits', v_existing.new_exact_in_minor_units::TEXT,
      'newCostPriceInMinorUnits', v_existing.new_cost_price_in_minor_units,
      'updatedAt', (SELECT product.updated_at FROM public.products product WHERE product.id = v_existing.product_id)
    );
  END IF;

  SELECT * INTO v_product
  FROM public.products product
  WHERE product.id = p_product_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المنتج المحدد غير موجود.';
  END IF;
  IF v_product.is_flavor_master THEN
    RAISE EXCEPTION 'PRODUCT_COST_CORRECTION_FLAVOR_MASTER: المنتج الأساسي للنكهات بلا مخزون؛ صحّح تكلفة النكهة نفسها.';
  END IF;

  UPDATE public.products
  SET
    wac_cost_in_minor_units_exact = v_exact,
    cost_price_in_minor_units = v_legacy,
    updated_at = NOW()
  WHERE id = p_product_id;

  INSERT INTO public.product_cost_corrections (
    product_id, idempotency_key, request_fingerprint,
    prior_exact_in_minor_units, prior_cost_price_in_minor_units,
    new_exact_in_minor_units, new_cost_price_in_minor_units,
    reason, created_by
  ) VALUES (
    p_product_id, v_key, v_fingerprint,
    v_product.wac_cost_in_minor_units_exact, v_product.cost_price_in_minor_units,
    v_exact, v_legacy,
    v_reason, auth.uid()
  ) RETURNING id INTO v_correction_id;

  INSERT INTO public.audit_logs (user_id, action, entity_name, entity_id, details)
  VALUES (
    auth.uid(),
    'CORRECT_PRODUCT_COST',
    'products',
    p_product_id,
    jsonb_build_object(
      'correction_id', v_correction_id,
      'reason', v_reason,
      'prior_exact_in_minor_units', v_product.wac_cost_in_minor_units_exact,
      'prior_cost_price_in_minor_units', v_product.cost_price_in_minor_units,
      'new_exact_in_minor_units', v_exact,
      'new_cost_price_in_minor_units', v_legacy
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotentReplay', false,
    'correctionId', v_correction_id,
    'productId', p_product_id,
    'priorExactInMinorUnits', v_product.wac_cost_in_minor_units_exact::TEXT,
    'priorCostPriceInMinorUnits', v_product.cost_price_in_minor_units,
    'newExactInMinorUnits', v_exact::TEXT,
    'newCostPriceInMinorUnits', v_legacy,
    'updatedAt', (SELECT product.updated_at FROM public.products product WHERE product.id = p_product_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.correct_product_cost_v1(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.correct_product_cost_v1(UUID, NUMERIC, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.correct_product_cost_v1(UUID, NUMERIC, TEXT, TEXT) TO authenticated;
