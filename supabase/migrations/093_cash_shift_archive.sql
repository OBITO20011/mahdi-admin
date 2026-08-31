-- =========================================================================
-- Nawasrah ERP - protected, paginated archive for historical cash shifts.
-- This is a read model only: it never changes shift or accounting data.
-- =========================================================================

CREATE INDEX IF NOT EXISTS idx_cash_shifts_archive_branch_status_opened
  ON public.cash_shifts(branch_id, status, opened_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_cash_shifts_archive_cashier_opened
  ON public.cash_shifts(opened_by, opened_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.get_cash_shift_archive_page(
  p_branch_id UUID DEFAULT NULL,
  p_cashier_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_shift_number TEXT DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_limit INTEGER DEFAULT 25,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit INTEGER := COALESCE(p_limit, 25);
  v_offset INTEGER := COALESCE(p_offset, 0);
  v_status TEXT := NULLIF(TRIM(p_status), '');
  v_number_query TEXT := NULLIF(TRIM(p_shift_number), '');
  v_total_count INTEGER := 0;
  v_items JSONB := '[]'::JSONB;
  v_cashiers JSONB := '[]'::JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'عرض أرشيف الورديات'
  );

  IF v_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'حجم صفحة أرشيف الورديات غير صحيح.';
  END IF;
  IF v_offset < 0 THEN
    RAISE EXCEPTION 'بداية صفحة أرشيف الورديات غير صحيحة.';
  END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('open', 'closed', 'cancelled', 'reversed') THEN
    RAISE EXCEPTION 'حالة الوردية غير صحيحة.';
  END IF;
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'تاريخ البداية يجب أن يسبق تاريخ النهاية.';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_total_count
  FROM public.cash_shifts cs
  WHERE (p_branch_id IS NULL OR cs.branch_id = p_branch_id)
    AND (p_cashier_id IS NULL OR cs.opened_by = p_cashier_id)
    AND (v_status IS NULL OR cs.status = v_status)
    AND (v_number_query IS NULL OR cs.shift_number ILIKE '%' || v_number_query || '%')
    AND (p_date_from IS NULL OR cs.opened_at >= p_date_from::TIMESTAMPTZ)
    AND (p_date_to IS NULL OR cs.opened_at < (p_date_to + 1)::TIMESTAMPTZ);

  SELECT COALESCE(jsonb_agg(public.get_cash_shift_display_summary(page.id) ORDER BY page.opened_at DESC, page.id DESC), '[]'::JSONB)
  INTO v_items
  FROM (
    SELECT cs.id, cs.opened_at
    FROM public.cash_shifts cs
    WHERE (p_branch_id IS NULL OR cs.branch_id = p_branch_id)
      AND (p_cashier_id IS NULL OR cs.opened_by = p_cashier_id)
      AND (v_status IS NULL OR cs.status = v_status)
      AND (v_number_query IS NULL OR cs.shift_number ILIKE '%' || v_number_query || '%')
      AND (p_date_from IS NULL OR cs.opened_at >= p_date_from::TIMESTAMPTZ)
      AND (p_date_to IS NULL OR cs.opened_at < (p_date_to + 1)::TIMESTAMPTZ)
    ORDER BY cs.opened_at DESC, cs.id DESC
    OFFSET v_offset
    LIMIT v_limit
  ) page;

  -- Filter choices are bounded and exposed only through this protected read model.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', source.id, 'name', source.name) ORDER BY source.name), '[]'::JSONB)
  INTO v_cashiers
  FROM (
    SELECT DISTINCT cs.opened_by AS id, COALESCE(profile.full_name, 'مستخدم النظام') AS name
    FROM public.cash_shifts cs
    LEFT JOIN public.profiles profile ON profile.id = cs.opened_by
    WHERE p_branch_id IS NULL OR cs.branch_id = p_branch_id
    ORDER BY name
    LIMIT 100
  ) source;

  RETURN jsonb_build_object(
    'success', true,
    'items', v_items,
    'totalCount', v_total_count,
    'limit', v_limit,
    'offset', v_offset,
    'hasMore', v_offset + jsonb_array_length(v_items) < v_total_count,
    'cashiers', v_cashiers
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_cash_shift_archive_page(UUID, UUID, TEXT, TEXT, DATE, DATE, INTEGER, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_shift_archive_page(UUID, UUID, TEXT, TEXT, DATE, DATE, INTEGER, INTEGER)
  TO authenticated;

COMMENT ON FUNCTION public.get_cash_shift_archive_page(UUID, UUID, TEXT, TEXT, DATE, DATE, INTEGER, INTEGER)
  IS 'Protected server-side pagination and filtering for cash-shift archive; read-only and compatible with current shift report permissions.';
