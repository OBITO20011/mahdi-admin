-- =========================================================================
-- Nawasrah ERP - Supplier payment idempotency
-- Prevent transport retries and double submits from recording a supplier
-- payment twice. Both public payment entrypoints require a caller-supplied
-- idempotency key and preserve the original guarded business implementations.
-- =========================================================================

BEGIN;

ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_scope TEXT;

ALTER TABLE public.supplier_payments
  DROP CONSTRAINT IF EXISTS supplier_payments_idempotency_scope_check;

ALTER TABLE public.supplier_payments
  ADD CONSTRAINT supplier_payments_idempotency_scope_check
  CHECK (
    idempotency_scope IS NULL
    OR idempotency_scope IN ('purchase_order_payment', 'supplier_receipt_payment')
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_payments_created_by_idempotency
  ON public.supplier_payments(created_by, idempotency_scope, idempotency_key)
  WHERE idempotency_scope IS NOT NULL
    AND idempotency_key IS NOT NULL;

-- Keep old public signatures private so no authenticated caller can bypass
-- the new idempotency boundary by omitting the key.
DO $$
BEGIN
  IF to_regprocedure(
    'public._record_supplier_payment_idempotency_legacy(uuid,uuid,bigint,text,text,timestamp with time zone,text)'
  ) IS NULL
  AND to_regprocedure(
    'public.record_supplier_payment(uuid,uuid,bigint,text,text,timestamp with time zone,text)'
  ) IS NOT NULL THEN
    ALTER FUNCTION public.record_supplier_payment(
      UUID, UUID, BIGINT, TEXT, TEXT, TIMESTAMPTZ, TEXT
    ) RENAME TO _record_supplier_payment_idempotency_legacy;
  END IF;

  IF to_regprocedure(
    'public._record_supplier_receipt_payment_idempotency_legacy(uuid,bigint,text,text,text)'
  ) IS NULL
  AND to_regprocedure(
    'public.record_supplier_receipt_payment(uuid,bigint,text,text,text)'
  ) IS NOT NULL THEN
    ALTER FUNCTION public.record_supplier_receipt_payment(
      UUID, BIGINT, TEXT, TEXT, TEXT
    ) RENAME TO _record_supplier_receipt_payment_idempotency_legacy;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._record_supplier_payment_idempotency_legacy(
  UUID, UUID, BIGINT, TEXT, TEXT, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public._record_supplier_receipt_payment_idempotency_legacy(
  UUID, BIGINT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_supplier_payment(
  p_supplier_id UUID,
  p_purchase_order_id UUID DEFAULT NULL,
  p_amount_in_minor_units BIGINT DEFAULT 0,
  p_payment_method TEXT DEFAULT 'cash',
  p_reference_number TEXT DEFAULT NULL,
  p_payment_date TIMESTAMPTZ DEFAULT NOW(),
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_key TEXT := NULLIF(TRIM(p_idempotency_key), '');
  v_existing public.supplier_payments%ROWTYPE;
  v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'تسجيل دفعات الموردين'
  );

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لتسجيل دفعة مورد.';
  END IF;
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION 'مفتاح منع تكرار دفعة المورد غير صالح.';
  END IF;

  -- Serialize equal retries before the underlying implementation mutates the
  -- purchase order, supplier balance, cash shift, and audit history.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_user_id::TEXT || ':purchase_order_payment:' || v_key,
      0
    )
  );

  SELECT * INTO v_existing
  FROM public.supplier_payments
  WHERE created_by = v_user_id
    AND idempotency_scope = 'purchase_order_payment'
    AND idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'payment_id', v_existing.id,
      'supplier_id', v_existing.supplier_id,
      'purchase_order_id', v_existing.purchase_order_id,
      'amount_in_minor_units', v_existing.amount_in_minor_units,
      'message', 'تمت معالجة طلب الدفعة سابقًا.'
    );
  END IF;

  v_result := public._record_supplier_payment_impl(
    p_supplier_id,
    p_purchase_order_id,
    p_amount_in_minor_units,
    p_payment_method,
    p_reference_number,
    p_payment_date,
    p_notes
  );

  UPDATE public.supplier_payments
  SET
    idempotency_scope = 'purchase_order_payment',
    idempotency_key = v_key
  WHERE id = (v_result->>'payment_id')::UUID
    AND created_by = v_user_id
    AND idempotency_scope IS NULL
    AND idempotency_key IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'تعذر تثبيت مفتاح منع تكرار دفعة المورد.';
  END IF;

  RETURN v_result || jsonb_build_object('idempotent', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_supplier_receipt_payment(
  p_receipt_id UUID,
  p_amount_in_minor_units BIGINT,
  p_payment_method TEXT DEFAULT 'cash',
  p_reference_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_key TEXT := NULLIF(TRIM(p_idempotency_key), '');
  v_existing public.supplier_payments%ROWTYPE;
  v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'تسجيل دفعات الموردين'
  );

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لتسجيل دفعة مورد.';
  END IF;
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION 'مفتاح منع تكرار دفعة المورد غير صالح.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_user_id::TEXT || ':supplier_receipt_payment:' || v_key,
      0
    )
  );

  SELECT * INTO v_existing
  FROM public.supplier_payments
  WHERE created_by = v_user_id
    AND idempotency_scope = 'supplier_receipt_payment'
    AND idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'payment_id', v_existing.id,
      'supplier_id', v_existing.supplier_id,
      'receipt_id', v_existing.supplier_receipt_id,
      'amount_in_minor_units', v_existing.amount_in_minor_units,
      'message', 'تمت معالجة طلب الدفعة سابقًا.'
    );
  END IF;

  v_result := public._record_supplier_receipt_payment_impl(
    p_receipt_id,
    p_amount_in_minor_units,
    p_payment_method,
    p_reference_number,
    p_notes
  );

  UPDATE public.supplier_payments
  SET
    idempotency_scope = 'supplier_receipt_payment',
    idempotency_key = v_key
  WHERE id = (v_result->>'payment_id')::UUID
    AND created_by = v_user_id
    AND idempotency_scope IS NULL
    AND idempotency_key IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'تعذر تثبيت مفتاح منع تكرار دفعة المورد.';
  END IF;

  RETURN v_result || jsonb_build_object('idempotent', false);
END;
$$;

REVOKE ALL ON FUNCTION public.record_supplier_payment(
  UUID, UUID, BIGINT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment(
  UUID, UUID, BIGINT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT
) TO authenticated;

REVOKE ALL ON FUNCTION public.record_supplier_receipt_payment(
  UUID, BIGINT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_supplier_receipt_payment(
  UUID, BIGINT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

COMMIT;
