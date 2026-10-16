-- Owner withdrawal readers (docs/design/OWNER_WITHDRAWALS_DESIGN_AR.md):
-- * events by Amman day: a withdrawal counts out when created, a return counts
--   in when booked, and a return voided by a full shift reversal counts out
--   again when voided; closed periods are never rewritten.
-- * the profit report and the home dashboard add, for the owner only, the
--   withdrawals and "remaining after withdrawals" next to the unchanged net
--   profit (not drawer, bank or available cash).
-- * the closing report shows withdrawal/return lines; new snapshots carry them
--   in an "ownerWithdrawals" section with its own sectionVersion (the snapshot
--   column version stays 1, as its integrity check requires).

BEGIN;

CREATE FUNCTION public.owner_withdrawal_events_internal(
  p_branch_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ
)
RETURNS TABLE (
  event_kind TEXT,
  event_at TIMESTAMPTZ,
  direction TEXT,
  amount_in_minor_units BIGINT,
  withdrawal_id UUID,
  withdrawal_number TEXT,
  branch_id UUID,
  shift_id UUID,
  actor_id UUID,
  reason TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 'withdrawal', w.created_at, 'out', w.amount_in_minor_units, w.id, w.withdrawal_number,
    w.branch_id, w.cash_shift_id, w.created_by, w.reason
  FROM public.owner_cash_withdrawals w
  WHERE (p_branch_id IS NULL OR w.branch_id = p_branch_id)
    AND w.created_at >= p_from AND w.created_at < p_to
  UNION ALL
  SELECT 'return', r.reversed_at, 'in', r.amount_in_minor_units, w.id, w.withdrawal_number,
    shift.branch_id, r.effective_shift_id, r.reversed_by, r.reason
  FROM public.owner_cash_withdrawal_reversals r
  JOIN public.owner_cash_withdrawals w ON w.id = r.withdrawal_id
  JOIN public.cash_shifts shift ON shift.id = r.effective_shift_id
  WHERE (p_branch_id IS NULL OR shift.branch_id = p_branch_id)
    AND r.reversed_at >= p_from AND r.reversed_at < p_to
  UNION ALL
  SELECT 'return_voided', r.voided_at, 'out', r.amount_in_minor_units, w.id, w.withdrawal_number,
    shift.branch_id, r.effective_shift_id, r.voided_by, NULL
  FROM public.owner_cash_withdrawal_reversals r
  JOIN public.owner_cash_withdrawals w ON w.id = r.withdrawal_id
  JOIN public.cash_shifts shift ON shift.id = r.effective_shift_id
  WHERE r.voided_at IS NOT NULL
    AND (p_branch_id IS NULL OR shift.branch_id = p_branch_id)
    AND r.voided_at >= p_from AND r.voided_at < p_to;
$$;
REVOKE ALL ON FUNCTION public.owner_withdrawal_events_internal(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.owner_withdrawal_period_totals_internal(
  p_branch_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'withdrawnInMinorUnits', COALESCE(SUM(amount_in_minor_units) FILTER (WHERE direction = 'out'), 0),
    'returnedInMinorUnits', COALESCE(SUM(amount_in_minor_units) FILTER (WHERE direction = 'in'), 0),
    'netInMinorUnits', COALESCE(SUM(CASE WHEN direction = 'out' THEN amount_in_minor_units ELSE -amount_in_minor_units END), 0)
  )
  FROM public.owner_withdrawal_events_internal(p_branch_id, p_from, p_to);
$$;
REVOKE ALL ON FUNCTION public.owner_withdrawal_period_totals_internal(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_owner_withdrawals_report(
  p_branch_id UUID,
  p_date_from DATE,
  p_date_to DATE,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from TIMESTAMPTZ;
  v_to TIMESTAMPTZ;
  v_page INTEGER := GREATEST(COALESCE(p_page, 1), 1);
  v_size INTEGER := LEAST(GREATEST(COALESCE(p_page_size, 25), 1), 100);
  v_total INTEGER;
  v_rows JSONB;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'], 'عرض سحوبات المالك');
  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to < p_date_from THEN
    RAISE EXCEPTION 'OWNER_WITHDRAWAL_PERIOD_INVALID: حدد فترة صحيحة.';
  END IF;
  IF p_date_to - p_date_from > 366 THEN
    RAISE EXCEPTION 'OWNER_WITHDRAWAL_PERIOD_INVALID: الفترة لا تتجاوز سنة.';
  END IF;
  v_from := p_date_from::TIMESTAMP AT TIME ZONE 'Asia/Amman';
  v_to := (p_date_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Amman';

  SELECT COUNT(*)::INTEGER INTO v_total FROM public.owner_withdrawal_events_internal(p_branch_id, v_from, v_to);
  SELECT COALESCE(jsonb_agg(row_json ORDER BY sort_at DESC, sort_number DESC, sort_kind), '[]'::JSONB) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'kind', event.event_kind,
      'at', event.event_at,
      'direction', event.direction,
      'amountInMinorUnits', event.amount_in_minor_units,
      'withdrawalId', event.withdrawal_id,
      'withdrawalNumber', event.withdrawal_number,
      'branchId', event.branch_id,
      'branchName', branch.name_ar,
      'shiftId', event.shift_id,
      'shiftNumber', shift.shift_number,
      'actorName', profile.full_name,
      'reason', event.reason,
      'isReversed', EXISTS (SELECT 1 FROM public.owner_cash_withdrawal_reversals active
        WHERE active.withdrawal_id = event.withdrawal_id AND active.voided_at IS NULL)
    ) AS row_json, event.event_at AS sort_at, event.withdrawal_number AS sort_number, event.event_kind AS sort_kind
    FROM public.owner_withdrawal_events_internal(p_branch_id, v_from, v_to) event
    LEFT JOIN public.branches branch ON branch.id = event.branch_id
    LEFT JOIN public.cash_shifts shift ON shift.id = event.shift_id
    LEFT JOIN public.profiles profile ON profile.id = event.actor_id
    ORDER BY event.event_at DESC, event.withdrawal_number DESC, event.event_kind
    LIMIT v_size OFFSET (v_page - 1) * v_size
  ) page_rows;

  RETURN jsonb_build_object(
    'totals', public.owner_withdrawal_period_totals_internal(p_branch_id, v_from, v_to),
    'rows', v_rows,
    'totalCount', v_total,
    'page', v_page,
    'pageSize', v_size
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_owner_withdrawals_report(UUID, DATE, DATE, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_owner_withdrawals_report(UUID, DATE, DATE, INTEGER, INTEGER) TO authenticated;

-- Withdrawals of one shift and returns booked in it, with their state (owner).
CREATE FUNCTION public.get_shift_owner_withdrawals_v1(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'], 'عرض سحوبات المالك');
  RETURN jsonb_build_object(
    'withdrawals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'withdrawalId', w.id, 'withdrawalNumber', w.withdrawal_number, 'amountInMinorUnits', w.amount_in_minor_units,
        'reason', w.reason, 'createdAt', w.created_at, 'createdByName', creator.full_name,
        'reversal', (SELECT jsonb_build_object('reversalId', r.id, 'effectiveShiftId', r.effective_shift_id,
            'reversedAt', r.reversed_at, 'reason', r.reason, 'viaShiftReversal', r.via_shift_reversal_id IS NOT NULL)
          FROM public.owner_cash_withdrawal_reversals r WHERE r.withdrawal_id = w.id AND r.voided_at IS NULL)
      ) ORDER BY w.created_at DESC)
      FROM public.owner_cash_withdrawals w
      LEFT JOIN public.profiles creator ON creator.id = w.created_by
      WHERE w.cash_shift_id = p_shift_id), '[]'::JSONB),
    'returnsFromOtherShifts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'reversalId', r.id, 'withdrawalId', w.id, 'withdrawalNumber', w.withdrawal_number,
        'amountInMinorUnits', r.amount_in_minor_units, 'reversedAt', r.reversed_at, 'reason', r.reason,
        'originalShiftId', w.cash_shift_id, 'voided', r.voided_at IS NOT NULL) ORDER BY r.reversed_at DESC)
      FROM public.owner_cash_withdrawal_reversals r
      JOIN public.owner_cash_withdrawals w ON w.id = r.withdrawal_id
      WHERE r.effective_shift_id = p_shift_id AND w.cash_shift_id <> p_shift_id), '[]'::JSONB)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_shift_owner_withdrawals_v1(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shift_owner_withdrawals_v1(UUID) TO authenticated;

-- Shift-level lines for the closing report (amounts and numbers, no reasons).
CREATE FUNCTION public.owner_withdrawal_closing_section_internal(p_shift_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'sectionVersion', 1,
    'withdrawnInMinorUnits', effect.withdrawn_in_minor_units,
    'returnedInMinorUnits', effect.returned_in_minor_units,
    'netInMinorUnits', effect.withdrawn_in_minor_units - effect.returned_in_minor_units,
    'items', COALESCE((
      SELECT jsonb_agg(item ORDER BY item->>'at', item->>'withdrawalNumber') FROM (
        SELECT jsonb_build_object('kind', 'withdrawal', 'withdrawalNumber', w.withdrawal_number,
          'amountInMinorUnits', w.amount_in_minor_units, 'at', w.created_at) AS item
        FROM public.owner_cash_withdrawals w WHERE w.cash_shift_id = p_shift_id
        UNION ALL
        SELECT jsonb_build_object('kind', 'return', 'withdrawalNumber', w.withdrawal_number,
          'amountInMinorUnits', r.amount_in_minor_units, 'at', r.reversed_at,
          'originalShiftNumber', original.shift_number)
        FROM public.owner_cash_withdrawal_reversals r
        JOIN public.owner_cash_withdrawals w ON w.id = r.withdrawal_id
        JOIN public.cash_shifts original ON original.id = w.cash_shift_id
        WHERE r.effective_shift_id = p_shift_id AND r.voided_at IS NULL
      ) items), '[]'::JSONB)
  )
  FROM public.owner_withdrawal_shift_effect_internal(p_shift_id) effect;
$$;
REVOKE ALL ON FUNCTION public.owner_withdrawal_closing_section_internal(UUID) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Closing: complete explicit 094 body; snapshot gains the section when the
-- shift had any withdrawal activity.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_cash_shift(
  p_shift_id UUID,
  p_actual_cash_in_minor_units BIGINT,
  p_discrepancy_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
  v_snapshot JSONB;
  v_section JSONB;
BEGIN
  v_result := public._close_cash_shift_before_closing_report_snapshot(
    p_shift_id,
    p_actual_cash_in_minor_units,
    p_discrepancy_reason
  );
  -- The internal close function has already frozen the canonical monetary
  -- columns. Capture the same report consumers see, inside this transaction.
  v_snapshot := public._get_cash_shift_closing_report_before_snapshot(p_shift_id)
    || jsonb_build_object(
      'snapshotStatus', 'immutable',
      'snapshotVersion', 1
    );
  IF COALESCE(v_snapshot->>'success', 'false') <> 'true' THEN
    RAISE EXCEPTION 'تعذر إنشاء لقطة تقرير الإغلاق؛ تم إلغاء إغلاق الوردية بأمان.';
  END IF;
  v_section := public.owner_withdrawal_closing_section_internal(p_shift_id);
  IF jsonb_array_length(v_section->'items') > 0 THEN
    v_section := v_section || jsonb_build_object('netMovementAfterWithdrawalsInMinorUnits',
      (v_snapshot #>> '{reconciliation,netMovementInMinorUnits}')::BIGINT
        - (v_section->>'netInMinorUnits')::BIGINT);
    v_snapshot := v_snapshot || jsonb_build_object('ownerWithdrawals', v_section);
  END IF;
  UPDATE public.cash_shifts
  SET closing_report_snapshot = v_snapshot,
      closing_report_snapshotted_at = NOW(),
      closing_report_snapshot_version = 1,
      updated_at = NOW()
  WHERE id = p_shift_id
    AND status = 'closed'
    AND closing_report_snapshot IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'تعذر تثبيت لقطة تقرير الإغلاق؛ تم إلغاء العملية بأمان.';
  END IF;
  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    auth.uid(),
    'CAPTURE_CASH_SHIFT_CLOSING_REPORT_SNAPSHOT',
    'cash_shifts',
    p_shift_id,
    jsonb_build_object(
      'snapshot_version', 1,
      'snapshot_bytes', octet_length(v_snapshot::TEXT),
      'captured_at', NOW()
    )
  );
  RETURN v_result || jsonb_build_object(
    'closingReportSnapshotCaptured', true
  );
END;
$$;
ALTER FUNCTION public.close_cash_shift(UUID, BIGINT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.close_cash_shift(UUID, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_cash_shift(UUID, BIGINT, TEXT) TO authenticated;

-- Complete explicit body: closed snapshots are returned unchanged; live and
-- legacy reports gain the section when there is withdrawal activity.
CREATE OR REPLACE FUNCTION public.get_cash_shift_closing_report(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift public.cash_shifts%ROWTYPE;
  v_report JSONB;
  v_section JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'عرض تقرير إغلاق الوردية'
  );
  SELECT * INTO v_shift
  FROM public.cash_shifts
  WHERE id = p_shift_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الوردية المحددة غير موجودة.';
  END IF;
  IF v_shift.status = 'closed'
    AND v_shift.closing_report_snapshot IS NOT NULL
  THEN
    RETURN v_shift.closing_report_snapshot;
  END IF;
  v_report := public._get_cash_shift_closing_report_before_snapshot(p_shift_id);
  v_section := public.owner_withdrawal_closing_section_internal(p_shift_id);
  IF jsonb_array_length(v_section->'items') > 0 THEN
    v_section := v_section || jsonb_build_object('netMovementAfterWithdrawalsInMinorUnits',
      (v_report #>> '{reconciliation,netMovementInMinorUnits}')::BIGINT
        - (v_section->>'netInMinorUnits')::BIGINT);
    v_report := v_report || jsonb_build_object('ownerWithdrawals', v_section);
  END IF;
  RETURN v_report || jsonb_build_object(
    'snapshotStatus',
    CASE
      WHEN v_shift.status = 'open' THEN 'live'
      WHEN v_shift.status = 'closed' THEN 'legacy_recalculated'
      ELSE 'not_applicable'
    END
  );
END;
$$;
ALTER FUNCTION public.get_cash_shift_closing_report(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_cash_shift_closing_report(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_shift_closing_report(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Profit report and home dashboard: complete explicit bodies (133) plus the
-- owner-only withdrawal lines. Net profit itself is unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_operational_business_report(
  p_branch_id UUID,
  p_date_from DATE,
  p_date_to DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
  v_totals JSONB;
  v_profit BIGINT;
BEGIN
  v_result := public._get_operational_business_report_before133(p_branch_id, p_date_from, p_date_to);
  v_result := jsonb_set(v_result, '{balances}', (v_result->'balances') || public.phase133_supplier_balances_internal());
  IF public.has_erp_role(ARRAY['owner']) THEN
    v_totals := public.owner_withdrawal_period_totals_internal(
      p_branch_id,
      p_date_from::TIMESTAMP AT TIME ZONE 'Asia/Amman',
      (p_date_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Amman');
    v_profit := COALESCE((v_result #>> '{sales,netProfitInMinorUnits}')::BIGINT, 0);
    v_result := v_result || jsonb_build_object('ownerWithdrawals', v_totals || jsonb_build_object(
      'netProfitInMinorUnits', v_profit,
      'remainingAfterWithdrawalsInMinorUnits', v_profit - (v_totals->>'netInMinorUnits')::BIGINT));
  END IF;
  RETURN v_result;
END;
$$;
ALTER FUNCTION public.get_operational_business_report(UUID, DATE, DATE) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_operational_business_report(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operational_business_report(UUID, DATE, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_home_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
  v_balances JSONB;
  v_today DATE := (now() AT TIME ZONE 'Asia/Amman')::DATE;
  v_totals JSONB;
  v_profit BIGINT;
BEGIN
  v_result := public._get_home_dashboard_before133();
  v_balances := public.phase133_supplier_balances_internal();
  v_result := jsonb_set(v_result, '{summary}', (v_result->'summary') || jsonb_build_object(
    'supplierPayablesInMinorUnits', v_balances->'supplierDueInMinorUnits',
    'supplierAdvancesInMinorUnits', v_balances->'supplierAdvancesInMinorUnits'));
  IF public.has_erp_role(ARRAY['owner']) THEN
    -- Same scope as the month profit above: all branches, Amman month to date.
    v_totals := public.owner_withdrawal_period_totals_internal(
      NULL,
      date_trunc('month', v_today)::DATE::TIMESTAMP AT TIME ZONE 'Asia/Amman',
      (v_today + 1)::TIMESTAMP AT TIME ZONE 'Asia/Amman');
    -- Unavailable profit stays unavailable: never treated as zero.
    v_profit := CASE WHEN v_result->>'financialFactsStatus' = 'available'
      THEN (v_result #>> '{summary,monthProfitInMinorUnits}')::BIGINT ELSE NULL END;
    v_result := jsonb_set(v_result, '{summary}', (v_result->'summary') || jsonb_build_object(
      'monthOwnerWithdrawalsInMinorUnits', (v_totals->>'netInMinorUnits')::BIGINT,
      'monthRemainingAfterWithdrawalsInMinorUnits', v_profit - (v_totals->>'netInMinorUnits')::BIGINT));
  END IF;
  RETURN v_result;
END;
$$;
ALTER FUNCTION public.get_home_dashboard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_home_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_home_dashboard() TO authenticated;

COMMIT;
