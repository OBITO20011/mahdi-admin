-- =========================================================================
-- Nawasrah ERP - Migration 048
-- Publish selected promotion codes as safe storefront offers.
--
-- Promotion math remains owned by _calculate_guest_promotion. The public RPC
-- only exposes offers explicitly marked for publication and never exposes
-- redemption/customer/audit data.
-- =========================================================================

ALTER TABLE public.promotion_codes
  ADD COLUMN IF NOT EXISTS is_public_offer BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_promotion_codes_public_offer_window
  ON public.promotion_codes(is_public_offer, is_active, starts_at, expires_at)
  WHERE is_public_offer = true AND is_active = true;

CREATE OR REPLACE FUNCTION public.get_promotion_codes()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_codes JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'عرض رموز الخصم'
  );

  SELECT COALESCE(jsonb_agg(to_jsonb(row_data)), '[]'::jsonb)
  INTO v_codes
  FROM (
    SELECT
      pc.id,
      pc.code,
      pc.description_ar,
      pc.discount_type,
      pc.discount_value,
      pc.minimum_subtotal_in_minor_units,
      pc.maximum_discount_in_minor_units,
      pc.starts_at,
      pc.expires_at,
      pc.maximum_total_redemptions,
      pc.maximum_redemptions_per_phone,
      pc.is_active,
      pc.is_public_offer,
      pc.created_at,
      pc.updated_at,
      COUNT(pr.id)::INTEGER AS redemption_count,
      COALESCE(SUM(pr.discount_in_minor_units), 0)::BIGINT
        AS redeemed_discount_in_minor_units
    FROM public.promotion_codes AS pc
    LEFT JOIN public.promotion_redemptions AS pr
      ON pr.promotion_code_id = pc.id
    GROUP BY pc.id
    ORDER BY pc.created_at DESC
  ) AS row_data;

  RETURN jsonb_build_object('success', true, 'codes', v_codes);
END;
$$;

DROP FUNCTION IF EXISTS public.upsert_promotion_code(
  TEXT, TEXT, BIGINT, UUID, TEXT, BIGINT, BIGINT, TIMESTAMPTZ,
  TIMESTAMPTZ, INTEGER, INTEGER, BOOLEAN
);

CREATE OR REPLACE FUNCTION public.upsert_promotion_code(
  p_code TEXT,
  p_discount_type TEXT,
  p_discount_value BIGINT,
  p_promotion_code_id UUID DEFAULT NULL,
  p_description_ar TEXT DEFAULT NULL,
  p_minimum_subtotal_in_minor_units BIGINT DEFAULT 0,
  p_maximum_discount_in_minor_units BIGINT DEFAULT NULL,
  p_starts_at TIMESTAMPTZ DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_maximum_total_redemptions INTEGER DEFAULT NULL,
  p_maximum_redemptions_per_phone INTEGER DEFAULT 1,
  p_is_active BOOLEAN DEFAULT true,
  p_is_public_offer BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code TEXT := UPPER(NULLIF(TRIM(p_code), ''));
  v_id UUID;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'إدارة رموز الخصم'
  );

  IF v_code IS NULL OR v_code !~ '^[A-Z0-9_-]{3,32}$' THEN
    RAISE EXCEPTION 'رمز الخصم يجب أن يحتوي 3 إلى 32 حرفاً أو رقماً.';
  END IF;

  IF p_discount_type NOT IN ('fixed', 'percentage') THEN
    RAISE EXCEPTION 'نوع الخصم غير صحيح.';
  END IF;

  IF p_discount_type = 'fixed' AND COALESCE(p_discount_value, 0) <= 0 THEN
    RAISE EXCEPTION 'قيمة الخصم الثابت يجب أن تكون أكبر من صفر.';
  END IF;

  IF p_discount_type = 'percentage'
    AND COALESCE(p_discount_value, 0) NOT BETWEEN 1 AND 10000
  THEN
    RAISE EXCEPTION 'نسبة الخصم يجب أن تكون أكبر من صفر ولا تتجاوز 100%%.';
  END IF;

  IF COALESCE(p_minimum_subtotal_in_minor_units, -1) < 0
    OR (
      p_maximum_discount_in_minor_units IS NOT NULL
      AND p_maximum_discount_in_minor_units <= 0
    )
    OR (
      p_maximum_total_redemptions IS NOT NULL
      AND p_maximum_total_redemptions <= 0
    )
    OR COALESCE(p_maximum_redemptions_per_phone, 0) <= 0
  THEN
    RAISE EXCEPTION 'حدود استخدام رمز الخصم غير صحيحة.';
  END IF;

  IF p_starts_at IS NOT NULL
    AND p_expires_at IS NOT NULL
    AND p_starts_at >= p_expires_at
  THEN
    RAISE EXCEPTION 'تاريخ انتهاء الخصم يجب أن يكون بعد تاريخ بدايته.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.promotion_codes AS pc
    WHERE pc.code = v_code
      AND pc.id IS DISTINCT FROM p_promotion_code_id
  ) THEN
    RAISE EXCEPTION 'رمز الخصم مستخدم مسبقاً.';
  END IF;

  IF p_promotion_code_id IS NULL THEN
    INSERT INTO public.promotion_codes (
      code,
      description_ar,
      discount_type,
      discount_value,
      minimum_subtotal_in_minor_units,
      maximum_discount_in_minor_units,
      starts_at,
      expires_at,
      maximum_total_redemptions,
      maximum_redemptions_per_phone,
      is_active,
      is_public_offer,
      created_by
    ) VALUES (
      v_code,
      NULLIF(TRIM(p_description_ar), ''),
      p_discount_type,
      p_discount_value,
      p_minimum_subtotal_in_minor_units,
      p_maximum_discount_in_minor_units,
      p_starts_at,
      p_expires_at,
      p_maximum_total_redemptions,
      p_maximum_redemptions_per_phone,
      COALESCE(p_is_active, true),
      COALESCE(p_is_public_offer, true),
      auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.promotion_codes
    SET
      code = v_code,
      description_ar = NULLIF(TRIM(p_description_ar), ''),
      discount_type = p_discount_type,
      discount_value = p_discount_value,
      minimum_subtotal_in_minor_units =
        p_minimum_subtotal_in_minor_units,
      maximum_discount_in_minor_units =
        p_maximum_discount_in_minor_units,
      starts_at = p_starts_at,
      expires_at = p_expires_at,
      maximum_total_redemptions = p_maximum_total_redemptions,
      maximum_redemptions_per_phone =
        p_maximum_redemptions_per_phone,
      is_active = COALESCE(p_is_active, true),
      is_public_offer = COALESCE(p_is_public_offer, true),
      updated_at = NOW()
    WHERE id = p_promotion_code_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'رمز الخصم المطلوب غير موجود.';
    END IF;
  END IF;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    CASE
      WHEN p_promotion_code_id IS NULL
      THEN 'CREATE_PROMOTION_CODE'
      ELSE 'UPDATE_PROMOTION_CODE'
    END,
    'promotion_codes',
    v_id,
    jsonb_build_object(
      'code', v_code,
      'discount_type', p_discount_type,
      'discount_value', p_discount_value,
      'is_active', COALESCE(p_is_active, true),
      'is_public_offer', COALESCE(p_is_public_offer, true)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'promotion_code_id', v_id,
    'code', v_code,
    'is_public_offer', COALESCE(p_is_public_offer, true),
    'message', CASE
      WHEN p_promotion_code_id IS NULL
      THEN 'تم إنشاء رمز الخصم.'
      ELSE 'تم تحديث رمز الخصم.'
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_storefront_offers()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'success', true,
    'offers', COALESCE(jsonb_agg(to_jsonb(offer_data)), '[]'::jsonb)
  )
  FROM (
    SELECT
      pc.id,
      pc.code,
      pc.description_ar,
      pc.discount_type,
      pc.discount_value,
      pc.minimum_subtotal_in_minor_units,
      pc.maximum_discount_in_minor_units,
      pc.starts_at,
      pc.expires_at
    FROM public.promotion_codes AS pc
    WHERE pc.is_public_offer = true
      AND pc.is_active = true
      AND (pc.starts_at IS NULL OR pc.starts_at <= NOW())
      AND (pc.expires_at IS NULL OR pc.expires_at > NOW())
      AND (
        pc.maximum_total_redemptions IS NULL
        OR (
          SELECT COUNT(*)
          FROM public.promotion_redemptions AS pr
          WHERE pr.promotion_code_id = pc.id
        ) < pc.maximum_total_redemptions
      )
    ORDER BY pc.created_at DESC
    LIMIT 12
  ) AS offer_data;
$$;

REVOKE ALL ON FUNCTION public.get_promotion_codes()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_promotion_code(
  TEXT, TEXT, BIGINT, UUID, TEXT, BIGINT, BIGINT, TIMESTAMPTZ,
  TIMESTAMPTZ, INTEGER, INTEGER, BOOLEAN, BOOLEAN
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_public_storefront_offers()
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_promotion_codes()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_promotion_code(
  TEXT, TEXT, BIGINT, UUID, TEXT, BIGINT, BIGINT, TIMESTAMPTZ,
  TIMESTAMPTZ, INTEGER, INTEGER, BOOLEAN, BOOLEAN
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_storefront_offers()
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_storefront_offers() IS
  'Returns only active promotion codes explicitly published to the storefront. Final discount remains server-authoritative.';
