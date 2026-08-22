-- =========================================================================
-- Nawasrah ERP - Storefront experience, guest payment and safe tracking
-- =========================================================================

-- Keep the already-audited guest checkout implementation as the private core.
DO $$
BEGIN
  IF to_regprocedure(
    'public.submit_guest_customer_order(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.submit_guest_customer_order_core(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text)'
  ) IS NULL
  THEN
    ALTER FUNCTION public.submit_guest_customer_order(
      TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
      DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT
    ) RENAME TO submit_guest_customer_order_core;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_guest_customer_order_core(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_guest_customer_order(
  p_idempotency_key TEXT,
  p_customer_full_name TEXT,
  p_customer_phone TEXT,
  p_governorate TEXT,
  p_city TEXT,
  p_area TEXT,
  p_street TEXT,
  p_building TEXT DEFAULT NULL,
  p_address_notes TEXT DEFAULT NULL,
  p_google_maps_url TEXT DEFAULT NULL,
  p_latitude DOUBLE PRECISION DEFAULT NULL,
  p_longitude DOUBLE PRECISION DEFAULT NULL,
  p_customer_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::jsonb,
  p_promotion_code TEXT DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'cash_on_delivery'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment_method TEXT := LOWER(NULLIF(TRIM(p_payment_method), ''));
  v_result JSONB;
  v_order_id UUID;
  v_existing_payment_method TEXT;
BEGIN
  IF v_payment_method NOT IN ('cash_on_delivery', 'cliq') THEN
    RAISE EXCEPTION 'طريقة الدفع غير مدعومة. اختر كاش عند الاستلام أو CliQ.';
  END IF;

  v_result := public.submit_guest_customer_order_core(
    p_idempotency_key,
    p_customer_full_name,
    p_customer_phone,
    p_governorate,
    p_city,
    p_area,
    p_street,
    p_building,
    p_address_notes,
    p_google_maps_url,
    p_latitude,
    p_longitude,
    p_customer_notes,
    p_items,
    p_promotion_code
  );

  IF NOT COALESCE((v_result->>'success')::BOOLEAN, false) THEN
    RETURN v_result;
  END IF;

  v_order_id := (v_result->>'order_id')::UUID;
  SELECT payment_method
  INTO v_existing_payment_method
  FROM public.orders
  WHERE id = v_order_id
  FOR UPDATE;

  IF COALESCE((v_result->>'idempotent_replay')::BOOLEAN, false)
    AND v_existing_payment_method IS DISTINCT FROM v_payment_method
  THEN
    RAISE EXCEPTION 'تغيرت طريقة الدفع لطلب محفوظ مسبقاً. أعد إرسال الطلب.';
  END IF;

  UPDATE public.orders
  SET payment_method = v_payment_method,
      payment_status = 'unpaid',
      updated_at = NOW()
  WHERE id = v_order_id;

  RETURN v_result || jsonb_build_object(
    'payment_method', v_payment_method,
    'payment_status', 'unpaid'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT, TEXT
) TO anon, authenticated;

COMMENT ON FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT, TEXT
) IS
  'Public guest checkout wrapper. Reuses the canonical guarded checkout core and stores only cash-on-delivery or CliQ.';

-- Enrich the existing safe catalog without exposing purchase costs or suppliers.
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
      p_limit,
      p_offset,
      p_category_id,
      p_search
    ) AS payload
  ),
  enriched_items AS (
    SELECT
      item.ordinality,
      item.value || jsonb_build_object(
        'createdAt', p.created_at,
        'soldPackagesLast90Days', COALESCE(sales.sold_packages, 0)
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
  )
  SELECT jsonb_set(
    base.payload,
    '{items}',
    COALESCE(
      (SELECT jsonb_agg(value ORDER BY ordinality) FROM enriched_items),
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

COMMENT ON FUNCTION public.get_public_storefront_catalog(
  INTEGER, INTEGER, UUID, TEXT
) IS
  'Storefront-safe extension of the canonical public catalog with creation time and real completed-sales package counts.';

-- Exact order number plus normalized phone are both required. No address,
-- customer identity, product names or internal notes are exposed.
CREATE OR REPLACE FUNCTION public.track_guest_order(
  p_order_number TEXT,
  p_customer_phone TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone TEXT := public.normalize_customer_phone(p_customer_phone);
  v_order public.orders%ROWTYPE;
  v_timeline JSONB;
  v_item_count INTEGER;
BEGIN
  IF NULLIF(TRIM(p_order_number), '') IS NULL
    OR CHAR_LENGTH(TRIM(p_order_number)) > 40
    OR v_phone !~ '^07[789][0-9]{7}$'
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'رقم الطلب أو الهاتف غير صحيح.'
    );
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE UPPER(o.order_number) = UPPER(TRIM(p_order_number))
    AND public.normalize_customer_phone(c.phone) = v_phone
    AND o.source = 'website'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'لم نعثر على طلب مطابق لرقم الطلب والهاتف.'
    );
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_item_count
  FROM public.order_items
  WHERE order_id = v_order.id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'status', history.status,
        'created_at', history.created_at
      )
      ORDER BY history.created_at
    ),
    '[]'::jsonb
  )
  INTO v_timeline
  FROM (
    SELECT 'new'::TEXT AS status, v_order.created_at AS created_at
    UNION ALL
    SELECT osh.new_status, osh.created_at
    FROM public.order_status_history osh
    WHERE osh.order_id = v_order.id
  ) history;

  RETURN jsonb_build_object(
    'success', true,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'payment_method', v_order.payment_method,
    'payment_status', v_order.payment_status,
    'total', v_order.total_in_minor_units,
    'item_count', v_item_count,
    'created_at', v_order.created_at,
    'updated_at', v_order.updated_at,
    'timeline', v_timeline
  );
END;
$$;

REVOKE ALL ON FUNCTION public.track_guest_order(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_guest_order(TEXT, TEXT)
  TO anon, authenticated;

COMMENT ON FUNCTION public.track_guest_order(TEXT, TEXT) IS
  'Privacy-preserving website order tracking requiring an exact order number and normalized customer phone.';
