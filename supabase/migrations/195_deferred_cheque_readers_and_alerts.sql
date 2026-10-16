BEGIN;

CREATE FUNCTION public.preview_customer_cheque_v1(p_customer_id UUID,p_amount_in_minor_units BIGINT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_plan JSONB;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','accountant','cashier','sales'],'معاينة استلام شيك عميل');
  IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id AND NOT is_deleted) THEN RAISE EXCEPTION 'العميل غير موجود.';END IF;
  IF COALESCE(p_amount_in_minor_units,0)<=0 OR p_amount_in_minor_units>999999999999 THEN RAISE EXCEPTION 'المبلغ غير صالح.';END IF;
  v_plan:=public.go_live_plan_customer_collection_internal(p_customer_id,p_amount_in_minor_units);
  RETURN v_plan||jsonb_build_object('exceedsBalance',p_amount_in_minor_units>(v_plan->>'totalOutstandingInMinorUnits')::BIGINT);
END;
$$;
ALTER FUNCTION public.preview_customer_cheque_v1(UUID,BIGINT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preview_customer_cheque_v1(UUID,BIGINT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.preview_customer_cheque_v1(UUID,BIGINT) TO authenticated;

CREATE FUNCTION public.preview_supplier_cheque_v1(p_supplier_id UUID,p_amount_in_minor_units BIGINT,p_claim_id UUID DEFAULT NULL,p_purchase_order_id UUID DEFAULT NULL,p_opening_only BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner','manager'],'معاينة إصدار شيك مورد');
  RETURN public.cheque_supplier_plan_internal(p_supplier_id,p_amount_in_minor_units,p_claim_id,p_purchase_order_id,p_opening_only);
END;
$$;
ALTER FUNCTION public.preview_supplier_cheque_v1(UUID,BIGINT,UUID,UUID,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preview_supplier_cheque_v1(UUID,BIGINT,UUID,UUID,BOOLEAN) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.preview_supplier_cheque_v1(UUID,BIGINT,UUID,UUID,BOOLEAN) TO authenticated;

CREATE FUNCTION public.get_deferred_cheques_page(p_page INTEGER DEFAULT 1,p_page_size INTEGER DEFAULT 25,
  p_status TEXT DEFAULT 'all',p_direction TEXT DEFAULT 'all',p_branch_id UUID DEFAULT NULL,p_search TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_page INTEGER:=GREATEST(COALESCE(p_page,1),1);v_size INTEGER:=LEAST(GREATEST(COALESCE(p_page_size,25),1),100);
  v_today DATE:=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE;v_search TEXT:=NULLIF(btrim(p_search),'');v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner','manager'],'عرض الشيكات');
  IF p_status IS NULL OR p_status NOT IN ('all','pending','endorsed','cleared','returned','cancelled','due7','overdue')
    OR p_direction IS NULL OR p_direction NOT IN ('all','incoming','outgoing') THEN RAISE EXCEPTION 'فلتر الشيكات غير صالح.';END IF;
  WITH source AS MATERIALIZED (
    SELECT q.*,c.full_name customer_name,s.company_name supplier_name,e.company_name endorsed_supplier_name
    FROM public.deferred_cheques q LEFT JOIN public.customers c ON c.id=q.customer_id
    LEFT JOIN public.suppliers s ON s.id=q.supplier_id LEFT JOIN public.suppliers e ON e.id=q.endorsed_supplier_id
    WHERE(p_branch_id IS NULL OR q.branch_id=p_branch_id)
      AND(p_direction='all' OR q.direction=p_direction)
      AND(v_search IS NULL OR q.cheque_number ILIKE '%'||v_search||'%' OR q.tracking_number ILIKE '%'||v_search||'%'
        OR q.bank_name ILIKE '%'||v_search||'%' OR c.full_name ILIKE '%'||v_search||'%'
        OR s.company_name ILIKE '%'||v_search||'%' OR e.company_name ILIKE '%'||v_search||'%')
  ),filtered AS MATERIALIZED (
    SELECT * FROM source q WHERE p_status='all' OR p_status=q.status
      OR(p_status='due7' AND q.status IN ('pending','endorsed') AND q.due_date BETWEEN v_today AND v_today+7)
      OR(p_status='overdue' AND q.status IN ('pending','endorsed') AND q.due_date<v_today)
  ),page_rows AS (
    SELECT * FROM filtered ORDER BY due_date,id OFFSET (v_page::BIGINT-1)*v_size LIMIT v_size
  ),weeks AS (
    SELECT date_trunc('week',due_date::TIMESTAMP)::DATE week_start,direction,
      SUM(amount_in_minor_units)::BIGINT amount,COUNT(*) count FROM source WHERE status IN ('pending','endorsed')
    GROUP BY 1,2 ORDER BY 1,2
  ) SELECT jsonb_build_object('page',v_page,'pageSize',v_size,'today',v_today,
    'totalCount',(SELECT COUNT(*) FROM filtered),'hasMore',(SELECT COUNT(*) FROM filtered)>v_page::BIGINT*v_size,
    'items',COALESCE((SELECT jsonb_agg(to_jsonb(p)-'registration_txid'-'bank_key' ORDER BY due_date,id) FROM page_rows p),'[]'::JSONB),
    'counts',jsonb_build_object('all',COUNT(*),'pending',COUNT(*) FILTER(WHERE status='pending'),
      'endorsed',COUNT(*) FILTER(WHERE status='endorsed'),'cleared',COUNT(*) FILTER(WHERE status='cleared'),
      'returned',COUNT(*) FILTER(WHERE status='returned'),'cancelled',COUNT(*) FILTER(WHERE status='cancelled'),
      'due7',COUNT(*) FILTER(WHERE status IN ('pending','endorsed') AND due_date BETWEEN v_today AND v_today+7),
      'overdue',COUNT(*) FILTER(WHERE status IN ('pending','endorsed') AND due_date<v_today)),
    'summary',jsonb_build_object('incomingInMinorUnits',COALESCE(SUM(amount_in_minor_units) FILTER(WHERE direction='incoming' AND status IN ('pending','endorsed')),0),
      'outgoingInMinorUnits',COALESCE(SUM(amount_in_minor_units) FILTER(WHERE direction='outgoing' AND status='pending'),0),
      'endorsedInMinorUnits',COALESCE(SUM(amount_in_minor_units) FILTER(WHERE status='endorsed'),0)),
    'weeks',COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY week_start,direction) FROM weeks w),'[]'::JSONB)) INTO v_result FROM source;
  RETURN v_result;
END;
$$;
ALTER FUNCTION public.get_deferred_cheques_page(INTEGER,INTEGER,TEXT,TEXT,UUID,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_deferred_cheques_page(INTEGER,INTEGER,TEXT,TEXT,UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_deferred_cheques_page(INTEGER,INTEGER,TEXT,TEXT,UUID,TEXT) TO authenticated;

CREATE FUNCTION public.get_deferred_cheque_detail(p_cheque_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result JSONB;v_supplier UUID;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner','manager'],'تفاصيل الشيك');
  v_result:=public.cheque_result_internal(p_cheque_id);
  IF v_result IS NULL THEN RAISE EXCEPTION 'الشيك غير موجود.';END IF;
  SELECT COALESCE(endorsed_supplier_id,supplier_id) INTO v_supplier FROM public.deferred_cheques WHERE id=p_cheque_id;
  RETURN v_result||jsonb_build_object('allocations',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY party_kind,original_debt_at NULLS FIRST,id)
      FROM public.deferred_cheque_allocations a WHERE cheque_id=p_cheque_id),'[]'::JSONB),
    'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'version',e.version,'kind',e.kind,'at',e.occurred_at,'reason',e.reason,
      'actor',p.full_name) ORDER BY e.version) FROM public.deferred_cheque_events e LEFT JOIN public.profiles p ON p.id=e.actor_id
      WHERE e.cheque_id=p_cheque_id),'[]'::JSONB),
    'supplierClaims',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.occurred_at NULLS FIRST,c.id)
      FROM public.cheque_supplier_claim_positions_internal(v_supplier)c WHERE c.id IN(SELECT id FROM public.cheque_compensation_claims WHERE cheque_id=p_cheque_id)),'[]'::JSONB),
    'supplierClaimPayments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'amount_in_minor_units',p.amount_in_minor_units,
      'payment_method',p.payment_method,'paid_at',p.payment_date,'is_reversed',p.is_reversed,'reversal_reason',p.reversal_reason,
      'can_reverse',NOT p.is_reversed AND p.payment_method IN('cash','cliq','bank_transfer')
        AND p.purchase_order_id IS NULL AND p.supplier_receipt_id IS NULL
        AND NOT EXISTS(SELECT 1 FROM public.deferred_cheques q WHERE q.supplier_payment_id=p.id)
        AND((p.payment_method IN('cash','cliq') AND EXISTS(SELECT 1 FROM public.cash_shifts s WHERE s.id=p.cash_shift_id AND s.status='open'))
          OR(p.payment_method='bank_transfer' AND p.cash_shift_id IS NULL))) ORDER BY p.payment_date,p.id)
      FROM public.supplier_payments p WHERE EXISTS(SELECT 1 FROM public.supplier_cheque_claim_payments l
        JOIN public.cheque_compensation_claims c ON c.id=l.claim_id WHERE l.supplier_payment_id=p.id AND c.cheque_id=p_cheque_id)),'[]'::JSONB));
END;
$$;
ALTER FUNCTION public.get_deferred_cheque_detail(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_deferred_cheque_detail(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_deferred_cheque_detail(UUID) TO authenticated;

CREATE FUNCTION public.get_deferred_cheque_home_alerts(p_branch_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_today DATE:=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE;v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner','manager'],'تنبيه الشيكات');
  SELECT jsonb_build_object('dueWithinTwoDays',COUNT(*) FILTER(WHERE due_date BETWEEN v_today AND v_today+2),
    'overdue',COUNT(*) FILTER(WHERE due_date<v_today),
    'outgoingDueInMinorUnits',COALESCE(SUM(amount_in_minor_units) FILTER(WHERE direction='outgoing' AND due_date<=v_today+2),0))
  INTO v_result FROM public.deferred_cheques WHERE status='pending' AND(p_branch_id IS NULL OR branch_id=p_branch_id);
  RETURN v_result;
END;
$$;
ALTER FUNCTION public.get_deferred_cheque_home_alerts(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_deferred_cheque_home_alerts(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_deferred_cheque_home_alerts(UUID) TO authenticated;

ALTER TABLE public.automation_events DROP CONSTRAINT automation_events_event_type_check;
ALTER TABLE public.automation_events ADD CONSTRAINT automation_events_event_type_check CHECK(event_type IN (
  'new_order','low_stock','out_of_stock','shift_closed','order_unprocessed','order_near_expiry','order_expired',
  'shift_close_reminder','shift_close_overdue','purchase_order_overdue','expense_daily_threshold','business_alert_recovery',
  'business_daily_summary','business_weekly_summary','business_integrity_warning','cheque_due','cheque_returned'));

CREATE OR REPLACE FUNCTION public.enqueue_automation_event(p_event_key TEXT,p_event_type TEXT,p_entity_id UUID,p_payload JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_event_id UUID;v_event_key TEXT:=NULLIF(TRIM(p_event_key),'');v_payload JSONB:=COALESCE(p_payload,'{}'::JSONB);
BEGIN
  IF v_event_key IS NULL OR length(v_event_key)>300 THEN RAISE EXCEPTION 'Invalid automation event key.';END IF;
  IF p_event_type NOT IN('new_order','low_stock','out_of_stock','shift_closed','order_unprocessed','order_near_expiry','order_expired',
    'shift_close_reminder','shift_close_overdue','purchase_order_overdue','expense_daily_threshold','business_alert_recovery',
    'business_daily_summary','business_weekly_summary','business_integrity_warning','cheque_due','cheque_returned') THEN
    RAISE EXCEPTION 'Invalid automation event type.';
  END IF;
  IF p_entity_id IS NULL THEN RAISE EXCEPTION 'Automation event entity is required.';END IF;
  IF jsonb_typeof(v_payload)<>'object' OR octet_length(v_payload::TEXT)>32768 THEN RAISE EXCEPTION 'Invalid automation event payload.';END IF;
  INSERT INTO public.automation_events(event_key,event_type,entity_id,payload) VALUES(v_event_key,p_event_type,p_entity_id,v_payload)
  ON CONFLICT(event_key) DO NOTHING RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN SELECT id INTO v_event_id FROM public.automation_events WHERE event_key=v_event_key;END IF;
  RETURN v_event_id;
END;
$$;
ALTER FUNCTION public.enqueue_automation_event(TEXT,TEXT,UUID,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_automation_event(TEXT,TEXT,UUID,JSONB) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.cheque_enqueue_return_internal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_c public.deferred_cheques%ROWTYPE;
BEGIN
  IF NEW.kind='returned' THEN
    SELECT * INTO STRICT v_c FROM public.deferred_cheques WHERE id=NEW.cheque_id;
    PERFORM public.enqueue_automation_event('cheque-returned:'||v_c.id::TEXT,'cheque_returned',v_c.id,
      jsonb_build_object('trackingNumber',v_c.tracking_number,'direction',v_c.direction,'endorsed',v_c.endorsed_supplier_id IS NOT NULL,
        'amountInMinorUnits',v_c.amount_in_minor_units,'audience','owner','screen','cheques'));
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.cheque_enqueue_return_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_enqueue_return_internal() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_cheque_return_outbox AFTER INSERT ON public.deferred_cheque_events
FOR EACH ROW EXECUTE FUNCTION public.cheque_enqueue_return_internal();

CREATE FUNCTION public.scan_deferred_cheque_alerts_internal(p_observed_at TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_day DATE:=(p_observed_at AT TIME ZONE 'Asia/Amman')::DATE;v_c public.deferred_cheques%ROWTYPE;
BEGIN
  -- The existing five-minute core scan calls this; no new cron, HTTP or secret.
  -- Incoming endorsed cheques are held by the supplier, not for our deposit.
  FOR v_c IN SELECT * FROM public.deferred_cheques WHERE status='pending' AND due_date=v_day+2 ORDER BY id LOOP
    PERFORM public.enqueue_automation_event('cheque-due:'||v_c.id::TEXT||':'||v_c.due_date::TEXT,'cheque_due',v_c.id,
      jsonb_build_object('trackingNumber',v_c.tracking_number,'direction',v_c.direction,'dueDate',v_c.due_date,
        'amountInMinorUnits',v_c.amount_in_minor_units,'audience','owner','screen','cheques',
        'instruction',CASE WHEN v_c.direction='outgoing' THEN 'تأكد من كفاية الرصيد' ELSE 'تذكير بإيداع الشيك' END));
  END LOOP;
END;
$$;
ALTER FUNCTION public.scan_deferred_cheque_alerts_internal(TIMESTAMPTZ) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.scan_deferred_cheque_alerts_internal(TIMESTAMPTZ) FROM PUBLIC,anon,authenticated,service_role;

-- Complete explicit existing105 core scanner is appended below at authoring;
-- its existing transaction, thresholds, roles and cron contract are preserved.

CREATE OR REPLACE FUNCTION public.scan_core_business_alerts(
  p_observed_at TIMESTAMPTZ DEFAULT NOW(),
  p_batch_size INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings public.business_alert_settings%ROWTYPE;
  v_row RECORD;
  v_transition TEXT;
  v_opened INTEGER := 0;
  v_resolved INTEGER := 0;
  v_max_close_at TIMESTAMPTZ;
  v_active BOOLEAN;
BEGIN
  IF p_observed_at IS NULL OR p_batch_size IS NULL
    OR p_batch_size NOT BETWEEN 1 AND 200
  THEN
    RAISE EXCEPTION 'Invalid Business alert scan request.';
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '25s', true);

  SELECT * INTO STRICT v_settings
  FROM public.business_alert_settings
  WHERE id = true;

  -- Delayed order: two hours old and still in an actual open workflow state.
  FOR v_row IN
    SELECT o.id, o.order_number, o.status, o.created_at
    FROM public.orders o
    WHERE o.status IN ('new', 'confirmed', 'preparing', 'ready', 'out_for_delivery')
      AND o.created_at <= p_observed_at
        - make_interval(mins => v_settings.order_unprocessed_after_minutes)
    ORDER BY o.created_at, o.id
    LIMIT p_batch_size
  LOOP
    v_transition := public._transition_business_alert_incident(
      'order_unprocessed:' || v_row.id::TEXT,
      'order_unprocessed', v_row.id, true, p_observed_at,
      jsonb_build_object(
        'orderNumber', v_row.order_number,
        'createdAt', v_row.created_at,
        'status', v_row.status,
        'thresholdMinutes', v_settings.order_unprocessed_after_minutes
      )
    );
    v_opened := v_opened + (v_transition = 'opened')::INTEGER;
  END LOOP;

  -- Preserve the separately approved website reservation-expiry warning.
  IF v_settings.order_near_expiry_minutes IS NOT NULL THEN
    FOR v_row IN
      SELECT o.id, o.order_number, o.reservation_expires_at
      FROM public.orders o
      WHERE o.source = 'website' AND o.status = 'new'
        AND o.reservation_expires_at > p_observed_at
        AND o.reservation_expires_at <= p_observed_at
          + make_interval(mins => v_settings.order_near_expiry_minutes)
      ORDER BY o.reservation_expires_at, o.id
      LIMIT p_batch_size
    LOOP
      v_transition := public._transition_business_alert_incident(
        'order_near_expiry:' || v_row.id::TEXT,
        'order_near_expiry', v_row.id, true, p_observed_at,
        jsonb_build_object(
          'orderNumber', v_row.order_number,
          'expiresAt', v_row.reservation_expires_at
        )
      );
      v_opened := v_opened + (v_transition = 'opened')::INTEGER;
    END LOOP;
  END IF;

  IF v_settings.purchase_order_overdue_enabled THEN
    FOR v_row IN
      SELECT po.id, po.purchase_order_number, po.status,
             po.expected_delivery_date, s.company_name AS supplier_name
      FROM public.purchase_orders po
      JOIN public.suppliers s ON s.id = po.supplier_id
      WHERE po.status IN ('sent', 'approved', 'partially_received')
        AND po.expected_delivery_date IS NOT NULL
        AND po.expected_delivery_date < p_observed_at
      ORDER BY po.expected_delivery_date, po.id
      LIMIT p_batch_size
    LOOP
      v_transition := public._transition_business_alert_incident(
        'purchase_order_overdue:' || v_row.id::TEXT,
        'purchase_order_overdue', v_row.id, true, p_observed_at,
        jsonb_build_object(
          'purchaseOrderNumber', v_row.purchase_order_number,
          'supplierName', v_row.supplier_name,
          'expectedDeliveryAt', v_row.expected_delivery_date,
          'status', v_row.status
        )
      );
      v_opened := v_opened + (v_transition = 'opened')::INTEGER;
    END LOOP;
  END IF;

  -- An open shift cannot exceed either 15 elapsed hours or its opening local
  -- calendar day. The earlier absolute instant is authoritative.
  FOR v_row IN
    SELECT cs.id, cs.shift_number, cs.opened_at
    FROM public.cash_shifts cs
    WHERE cs.status = 'open'
    ORDER BY cs.opened_at, cs.id
    LIMIT p_batch_size
  LOOP
    v_max_close_at := LEAST(
      v_row.opened_at + INTERVAL '15 hours',
      (
        (v_row.opened_at AT TIME ZONE v_settings.business_timezone)::DATE + 1
      )::TIMESTAMP AT TIME ZONE v_settings.business_timezone
    );
    v_transition := public._transition_business_alert_incident(
      'shift_close_overdue:' || v_row.id::TEXT,
      'shift_close_overdue', v_row.id,
      p_observed_at >= v_max_close_at, p_observed_at,
      jsonb_build_object(
        'shiftNumber', v_row.shift_number,
        'openedAt', v_row.opened_at,
        'expectedCloseAt', v_max_close_at,
        'maxDurationHours', 15,
        'timezone', v_settings.business_timezone
      )
    );
    v_opened := v_opened + (v_transition = 'opened')::INTEGER;
    v_resolved := v_resolved + (v_transition = 'resolved')::INTEGER;
  END LOOP;

  -- Resolve only incident types owned by this scanner. Legacy shift-reminder
  -- and expense-threshold incidents are closed because those rules are off.
  FOR v_row IN
    SELECT bi.*
    FROM public.business_alert_incidents bi
    WHERE bi.state = 'open'
      AND bi.alert_type IN (
        'order_unprocessed', 'order_near_expiry',
        'shift_close_reminder', 'shift_close_overdue',
        'purchase_order_overdue', 'expense_daily_threshold'
      )
    ORDER BY bi.last_seen_at, bi.incident_key
    LIMIT p_batch_size
  LOOP
    v_active := CASE v_row.alert_type
      WHEN 'order_unprocessed' THEN EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = v_row.entity_id
          AND o.status IN ('new', 'confirmed', 'preparing', 'ready', 'out_for_delivery')
          AND o.created_at <= p_observed_at
            - make_interval(mins => v_settings.order_unprocessed_after_minutes)
      )
      WHEN 'order_near_expiry' THEN
        v_settings.order_near_expiry_minutes IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.orders o
          WHERE o.id = v_row.entity_id AND o.source = 'website' AND o.status = 'new'
            AND o.reservation_expires_at > p_observed_at
            AND o.reservation_expires_at <= p_observed_at
              + make_interval(mins => v_settings.order_near_expiry_minutes)
        )
      WHEN 'purchase_order_overdue' THEN
        v_settings.purchase_order_overdue_enabled AND EXISTS (
          SELECT 1 FROM public.purchase_orders po
          WHERE po.id = v_row.entity_id
            AND po.status IN ('sent', 'approved', 'partially_received')
            AND po.expected_delivery_date IS NOT NULL
            AND po.expected_delivery_date < p_observed_at
        )
      WHEN 'shift_close_overdue' THEN EXISTS (
        SELECT 1
        FROM public.cash_shifts cs
        WHERE cs.id = v_row.entity_id
          AND cs.status = 'open'
          AND p_observed_at >= LEAST(
            cs.opened_at + INTERVAL '15 hours',
            (
              (cs.opened_at AT TIME ZONE v_settings.business_timezone)::DATE + 1
            )::TIMESTAMP AT TIME ZONE v_settings.business_timezone
          )
      )
      WHEN 'shift_close_reminder' THEN false
      WHEN 'expense_daily_threshold' THEN false
      ELSE false
    END;

    IF NOT v_active THEN
      v_transition := public._transition_business_alert_incident(
        v_row.incident_key, v_row.alert_type, v_row.entity_id,
        false, p_observed_at,
        jsonb_build_object('reference', v_row.incident_key)
      );
      v_resolved := v_resolved + (v_transition = 'resolved')::INTEGER;
    END IF;
  END LOOP;

  PERFORM public.scan_deferred_cheque_alerts_internal(p_observed_at);
  RETURN jsonb_build_object(
    'success', true,
    'opened', v_opened,
    'resolved', v_resolved,
    'rules', jsonb_build_object(
      'delayedOrderMinutes', v_settings.order_unprocessed_after_minutes,
      'cashDifference', 'non_zero',
      'dailyExpenseWindow', 'calendar_day',
      'shiftMaxDurationHours', 15,
      'timezone', v_settings.business_timezone
    )
  );
END;
$$;
ALTER FUNCTION public.scan_core_business_alerts(TIMESTAMPTZ,INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.scan_core_business_alerts(TIMESTAMPTZ,INTEGER) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.phase6_financial_facts_internal(
  p_branch_id UUID,
  p_period_start TIMESTAMPTZ,
  p_period_end TIMESTAMPTZ,
  p_timezone TEXT,
  p_verify_evidence BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_facts JSONB;
BEGIN
  IF p_period_start IS NULL OR p_period_end IS NULL
    OR p_period_end <= p_period_start OR NULLIF(BTRIM(p_timezone), '') IS NULL
  THEN
    RAISE EXCEPTION 'Invalid Phase 6 financial facts period.';
  END IF;

  -- Fail closed on corrupt evidence for the rows this period reports.
  IF p_verify_evidence THEN
    PERFORM public.phase42_assert_operational_return_evidence_internal(e.operation_id, true)
    FROM public.sales_return_events e
    JOIN public.orders o ON o.id = e.order_id
    JOIN public.business_operations creation ON creation.id = o.operation_id
    WHERE e.contract_version = 401 AND e.settlement_status = 'settled'
      AND creation.operation_type IN ('phase3_pos_sale_v1', 'phase3_customer_reservation_v1')
      AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
      AND e.settled_at >= p_period_start AND e.settled_at < p_period_end;

    PERFORM public.phase43_assert_operational_replacement_evidence_internal(e.operation_id, true)
    FROM public.sales_replacement_events e
    JOIN public.orders o ON o.id = e.root_order_id
    WHERE e.issuance_status = 'issued'
      AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
      AND e.issued_at >= p_period_start AND e.issued_at < p_period_end;
  END IF;

  WITH first_completion AS MATERIALIZED (
    SELECT h.order_id, MIN(h.created_at) AS at
    FROM public.order_status_history h
    WHERE h.new_status = 'completed'
    GROUP BY h.order_id
  ), completion_ops AS MATERIALIZED (
    SELECT DISTINCT ON (b.result_snapshot->>'order_id')
      b.result_snapshot->>'order_id' AS order_key,
      b.result_snapshot, b.completed_at, b.request_identity_snapshot
    FROM public.business_operations b
    WHERE b.operation_type = 'phase3_customer_completion_v1'
      AND b.result_snapshot->>'order_id' = b.request_identity_snapshot->>'order_id'
    ORDER BY b.result_snapshot->>'order_id', b.completed_at, b.id
  ), order_scope AS MATERIALIZED (
    SELECT o.*, fc.at AS completion_at, creation.operation_type,
      creation.result_snapshot AS creation_result, creation.completed_at AS creation_recorded_at,
      completion.result_snapshot AS completion_result,
      completion.completed_at AS completion_recorded_at,
      completion.request_identity_snapshot AS completion_request
    FROM public.orders o
    JOIN first_completion fc ON fc.order_id = o.id
    LEFT JOIN public.business_operations creation ON creation.id = o.operation_id
    LEFT JOIN completion_ops completion ON completion.order_key = o.id::TEXT
    WHERE p_branch_id IS NULL OR o.branch_id = p_branch_id
  ), modern_returns AS MATERIALIZED (
    SELECT e.*
    FROM public.sales_return_events e JOIN order_scope o ON o.id = e.order_id
    WHERE e.contract_version = 401 AND e.settlement_status = 'settled'
      AND o.operation_type IN ('phase3_pos_sale_v1', 'phase3_customer_reservation_v1')
  ), issued AS MATERIALIZED (
    SELECT e.*
    FROM public.sales_replacement_events e JOIN order_scope o ON o.id = e.root_order_id
    WHERE e.issuance_status = 'issued'
  ), return_rows AS (
    SELECT e.id, e.order_id, e.settled_at AS at,
      e.debt_reduction_amount_in_minor_units AS debt,
      e.money_refund_amount_in_minor_units AS refund, e.refund_method,
      e.debt_reduction_amount_in_minor_units + e.money_refund_amount_in_minor_units AS entitlement,
      COALESCE((SELECT SUM(f.historical_restock_value_in_minor_units_exact)
        FROM public.phase42_return_inventory_effects f WHERE f.return_event_id = e.id), 0) AS recovery
    FROM modern_returns e
    UNION ALL
    SELECT e.id, e.order_id, e.created_at, 0, e.refund_amount_in_minor_units, e.refund_method,
      e.refund_amount_in_minor_units,
      CASE WHEN e.stock_disposition = 'restock' THEN COALESCE((SELECT SUM(i.cogs_in_minor_units)
        FROM public.order_items i WHERE i.order_id = e.order_id), 0) ELSE 0 END
    FROM public.sales_returns e JOIN order_scope o ON o.id = e.order_id
    WHERE o.operation_type IS NULL OR o.operation_type NOT IN
      ('phase3_pos_sale_v1', 'phase3_customer_reservation_v1')
  ), initial_collections AS (
    SELECT o.id AS order_id,
      CASE WHEN o.operation_type = 'phase3_pos_sale_v1' THEN o.creation_recorded_at
        ELSE COALESCE(o.completion_recorded_at, o.completion_at) END AS at,
      CASE WHEN o.operation_type = 'phase3_pos_sale_v1' THEN o.creation_result->>'paymentMethod'
        WHEN o.operation_type = 'phase3_customer_reservation_v1' THEN o.completion_request->>'payment_method'
        WHEN o.payment_method = 'cash_on_delivery' THEN 'cash' ELSE o.payment_method END AS method,
      CASE WHEN o.operation_type = 'phase3_pos_sale_v1' THEN (o.creation_result->>'amountPaidInMinorUnits')::BIGINT
        WHEN o.operation_type = 'phase3_customer_reservation_v1' THEN
          CASE WHEN NULLIF(o.completion_result->>'customer_payment_number', '') IS NOT NULL THEN 0
            ELSE (o.completion_result->>'amount_paid_in_minor_units')::BIGINT END
        WHEN o.payment_method = 'debt' THEN 0 ELSE o.total_in_minor_units END AS amount
    FROM order_scope o
  ), money_events AS (
    SELECT order_id, at, method, amount AS collection, 0::BIGINT AS reversal, 0::BIGINT AS refund
    FROM initial_collections WHERE amount > 0
    UNION ALL
    SELECT p.order_id, p.created_at, p.payment_method, p.amount_in_minor_units, 0, 0
    FROM public.customer_payments p JOIN order_scope o ON o.id = p.order_id
    UNION ALL
    SELECT p.order_id, p.reversed_at, p.payment_method, 0, p.amount_in_minor_units, 0
    FROM public.customer_payments p JOIN order_scope o ON o.id = p.order_id WHERE p.is_reversed
    UNION ALL
    SELECT r.order_id, r.created_at, m.method, 0, m.amount, 0
    FROM public.pos_sale_reversals r JOIN order_scope o ON o.id = r.order_id
    CROSS JOIN LATERAL (VALUES
      ('cash', (r.actual_effect->>'cash_in_minor_units')::BIGINT),
      ('cliq', (r.actual_effect->>'cliq_in_minor_units')::BIGINT)) m(method, amount)
    WHERE m.amount > 0
    UNION ALL
    SELECT order_id, at, refund_method, 0, 0, refund FROM return_rows WHERE refund > 0
    UNION ALL
    SELECT NULL::UUID,c.created_at,c.payment_method,a.amount_in_minor_units,0,0
    FROM public.customer_collection_operations c JOIN public.customer_collection_cheque_allocations a ON a.operation_id=c.id
    JOIN public.cheque_compensation_claims k ON k.id=a.claim_id JOIN public.deferred_cheques q ON q.id=k.cheque_id
    WHERE p_branch_id IS NULL OR COALESCE(c.branch_id,q.branch_id)=p_branch_id
    UNION ALL
    SELECT NULL::UUID,c.reversed_at,c.payment_method,0,a.amount_in_minor_units,0
    FROM public.customer_collection_operations c JOIN public.customer_collection_cheque_allocations a ON a.operation_id=c.id
    JOIN public.cheque_compensation_claims k ON k.id=a.claim_id JOIN public.deferred_cheques q ON q.id=k.cheque_id
    WHERE c.is_reversed AND(p_branch_id IS NULL OR COALESCE(c.branch_id,q.branch_id)=p_branch_id)
  ), coverage_by_order AS (
    SELECT order_id, SUM(collection - reversal)::BIGINT AS coverage
    FROM money_events GROUP BY order_id
  ), debt_by_order AS (
    SELECT order_id, SUM(debt)::BIGINT AS debt_reduction
    FROM return_rows GROUP BY order_id
  ), positions AS (
    SELECT o.id, o.customer_id, o.status, o.total_in_minor_units,
      COALESCE(c.coverage, 0)::BIGINT AS coverage,
      COALESCE(d.debt_reduction, 0)::BIGINT AS debt_reduction,
      GREATEST(o.total_in_minor_units - COALESCE(c.coverage, 0) - COALESCE(d.debt_reduction, 0), 0)::BIGINT AS due
    FROM order_scope o
    LEFT JOIN coverage_by_order c ON c.order_id = o.id
    LEFT JOIN debt_by_order d ON d.order_id = o.id
  ), period_sales AS (
    SELECT * FROM order_scope WHERE status IN ('completed', 'returned')
      AND completion_at >= p_period_start AND completion_at < p_period_end
  ), sales_totals AS (
    SELECT COALESCE(SUM(total_in_minor_units), 0)::BIGINT AS gross,
      COALESCE(SUM(delivery_fee_in_minor_units), 0)::BIGINT AS delivery,
      COUNT(*) AS count FROM period_sales
  ), period_returns AS (
    SELECT COALESCE(SUM(entitlement), 0)::BIGINT AS entitlement,
      COALESCE(SUM(refund), 0)::BIGINT AS refund, COALESCE(SUM(debt), 0)::BIGINT AS debt,
      ROUND(COALESCE(SUM(recovery), 0))::BIGINT AS recovery, COUNT(*) AS count
    FROM return_rows WHERE at >= p_period_start AND at < p_period_end
  ), costs AS (
    SELECT COALESCE(SUM(i.cogs_in_minor_units), 0)::BIGINT AS cogs
    FROM public.order_items i JOIN period_sales o ON o.id = i.order_id
  ), replacement_costs AS (
    SELECT COALESCE(SUM(f.replacement_cogs_snapshot_in_minor_units), 0)::BIGINT AS cost
    FROM issued e JOIN public.phase43_replacement_inventory_effects f ON f.operation_id = e.operation_id
    WHERE e.issued_at >= p_period_start AND e.issued_at < p_period_end
  ), flows AS (
    SELECT COALESCE(SUM(collection - reversal) FILTER (WHERE method = 'cash'), 0)::BIGINT AS cash_received,
      COALESCE(SUM(collection - reversal) FILTER (WHERE method = 'cliq'), 0)::BIGINT AS cliq_received,
      COALESCE(SUM(refund) FILTER (WHERE method = 'cash'), 0)::BIGINT AS cash_refunded,
      COALESCE(SUM(refund) FILTER (WHERE method = 'cliq'), 0)::BIGINT AS cliq_refunded
    FROM money_events WHERE at >= p_period_start AND at < p_period_end
  ), opening_due AS (
    -- 164 (owner decision 4): outstanding go-live opening debt, attributed to
    -- the main branch; the all-branches report always includes it.
    SELECT opening.customer_id, opening.outstanding AS due
    FROM public.go_live_customer_opening_positions_internal(NULL) opening
    WHERE opening.outstanding > 0
      AND (p_branch_id IS NULL OR p_branch_id = public.go_live_main_branch_internal())
  ), balances AS (
    SELECT COALESCE(SUM(due), 0)::BIGINT AS due,
      COUNT(*) FILTER (WHERE due > 0 AND is_order) AS orders,
      COUNT(DISTINCT customer_id) FILTER (WHERE due > 0) AS customers
    FROM (
      SELECT true AS is_order, customer_id, due FROM positions WHERE status IN ('completed', 'returned')
      UNION ALL
      SELECT false, customer_id, due FROM opening_due
      UNION ALL
      SELECT false,c.customer_id,c.outstanding FROM public.cheque_customer_claim_positions_internal() c
      JOIN public.cheque_compensation_claims k ON k.id=c.id JOIN public.deferred_cheques q ON q.id=k.cheque_id
      WHERE c.outstanding>0 AND(p_branch_id IS NULL OR q.branch_id=p_branch_id)
    ) receivables
  ), cohort AS (
    SELECT COALESCE(SUM(p.coverage), 0)::BIGINT AS coverage,
      COALESCE(SUM(p.due), 0)::BIGINT AS due
    FROM positions p JOIN period_sales o ON o.id = p.id
  ), expenses AS (
    SELECT COALESCE(SUM(amount_in_minor_units), 0)::BIGINT AS amount,
      COALESCE(SUM(amount_in_minor_units) FILTER (WHERE payment_method = 'cash'), 0)::BIGINT AS cash,
      COALESCE(SUM(amount_in_minor_units) FILTER (WHERE payment_method = 'cliq'), 0)::BIGINT AS cliq,
      COUNT(*) AS count
    FROM public.operational_expenses
    WHERE (p_branch_id IS NULL OR branch_id = p_branch_id)
      AND NOT COALESCE(is_reversed, false)
      AND created_at >= p_period_start AND created_at < p_period_end
  ), days AS (
    SELECT day::DATE AS day FROM generate_series((p_period_start AT TIME ZONE p_timezone)::DATE,
      (p_period_end AT TIME ZONE p_timezone)::DATE - 1, INTERVAL '1 day') day
  ), daily AS (
    SELECT d.day,
      COALESCE((SELECT SUM(o.total_in_minor_units) FROM period_sales o
        WHERE (o.completion_at AT TIME ZONE p_timezone)::DATE = d.day), 0)::BIGINT AS gross,
      (SELECT COUNT(*) FROM period_sales o
        WHERE (o.completion_at AT TIME ZONE p_timezone)::DATE = d.day)::BIGINT AS count,
      COALESCE((SELECT SUM(r.entitlement) FROM return_rows r
        WHERE r.at >= p_period_start AND r.at < p_period_end
          AND (r.at AT TIME ZONE p_timezone)::DATE = d.day), 0)::BIGINT AS returned
    FROM days d
  ) SELECT jsonb_build_object(
    'sales', jsonb_build_object('grossSalesInMinorUnits', s.gross, 'deliveryFeesInMinorUnits', s.delivery,
      'returnEntitlementInMinorUnits', r.entitlement, 'refundsInMinorUnits', r.refund,
      'debtReductionInMinorUnits', r.debt, 'netSalesInMinorUnits', s.gross - r.entitlement,
      'cogsInMinorUnits', c.cogs, 'replacementCostInMinorUnits', rc.cost,
      'restockRecoveryInMinorUnits', r.recovery, 'grossProfitInMinorUnits', s.gross - s.delivery - c.cogs,
      'aftercareAdjustedMarginInMinorUnits', s.gross - r.entitlement - c.cogs - rc.cost + r.recovery,
      'netProfitInMinorUnits', s.gross - r.entitlement - c.cogs - rc.cost + r.recovery - x.amount,
      'collectedInMinorUnits', co.coverage, 'outstandingInMinorUnits', co.due, 'returnCount', r.count,
      'orderCount', s.count, 'completedOrderCount', s.count),
    'cashFlow', jsonb_build_object('cashCollectedInMinorUnits', f.cash_received,
      'cliqCollectedInMinorUnits', f.cliq_received, 'cashRefundedInMinorUnits', f.cash_refunded,
      'cliqRefundedInMinorUnits', f.cliq_refunded, 'cashNetFlowInMinorUnits', f.cash_received - f.cash_refunded,
      'cliqNetFlowInMinorUnits', f.cliq_received - f.cliq_refunded),
    'balances', jsonb_build_object('customerDueInMinorUnits', b.due, 'customerOrderCount', b.orders,
      'customerCount', b.customers),
    'expenses', jsonb_build_object('totalInMinorUnits', x.amount, 'cashInMinorUnits', x.cash,
      'cliqInMinorUnits', x.cliq, 'count', x.count),
    'dailyBreakdown', (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', day,
      'completedOrderCount', count, 'grossSalesInMinorUnits', gross,
      'returnEntitlementInMinorUnits', returned, 'netSalesInMinorUnits', gross - returned)
      ORDER BY day), '[]'::JSONB) FROM daily)
  ) INTO v_facts
  FROM sales_totals s CROSS JOIN period_returns r CROSS JOIN costs c
    CROSS JOIN replacement_costs rc CROSS JOIN flows f CROSS JOIN balances b
    CROSS JOIN cohort co CROSS JOIN expenses x;

  RETURN v_facts;
END;
$$;
ALTER FUNCTION public.phase6_financial_facts_internal(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.phase6_financial_facts_internal(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;

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
  IF public.has_erp_role(ARRAY['owner','manager']) THEN
    v_result:=v_result||jsonb_build_object('chequeAlerts',public.get_deferred_cheque_home_alerts(NULL));
  END IF;
  RETURN v_result;
END;
$$;
ALTER FUNCTION public.get_home_dashboard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_home_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_home_dashboard() TO authenticated;

-- Owner2026-10-16: deleting a zero-balance party must not orphan a future
-- cheque compensation. Triggers also guard privileged direct DELETE/soft delete;
-- no table privileges or historical FK retention rules are weakened.
CREATE FUNCTION public.cheque_guard_customer_deletion_internal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_balance BIGINT;v_number TEXT;v_status TEXT;
BEGIN
  IF TG_OP='UPDATE' AND (NOT NEW.is_deleted OR OLD.is_deleted) THEN RETURN NEW;END IF;
  v_balance:=public.phase42_customer_receivable_total_internal(OLD.id);
  IF v_balance>0 THEN
    RAISE EXCEPTION 'لا يمكن حذف العميل: عليه دين % د.أ.',to_char(v_balance::NUMERIC/1000,'FM999999999999990.000');
  END IF;
  SELECT cheque_number,status INTO v_number,v_status FROM public.deferred_cheques
  WHERE customer_id=OLD.id AND direction='incoming' AND status IN ('pending','endorsed')
  ORDER BY created_at,id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'لا يمكن حذف العميل: الشيك رقم % % ولم تنتهِ متابعته.',v_number,
      CASE WHEN v_status='endorsed' THEN 'مُجيّر لمورد' ELSE 'قيد الانتظار' END;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END;
$$;
ALTER FUNCTION public.cheque_guard_customer_deletion_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_guard_customer_deletion_internal() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_cheque_guard_customer_deletion BEFORE DELETE OR UPDATE OF is_deleted ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.cheque_guard_customer_deletion_internal();

CREATE FUNCTION public.cheque_guard_supplier_deletion_internal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_balance BIGINT;v_number TEXT;v_status TEXT;
BEGIN
  SELECT balance INTO STRICT v_balance FROM public.phase133_supplier_balance_evidence_internal() WHERE supplier_id=OLD.id;
  IF v_balance<>0 THEN
    RAISE EXCEPTION 'لا يمكن حذف المورد: رصيده غير صفري (% د.أ.).',to_char(v_balance::NUMERIC/1000,'FM999999999999990.000');
  END IF;
  SELECT cheque_number,status INTO v_number,v_status FROM public.deferred_cheques
  WHERE (direction='outgoing' AND supplier_id=OLD.id AND status='pending')
     OR (endorsed_supplier_id=OLD.id AND status='endorsed')
  ORDER BY created_at,id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'لا يمكن حذف المورد: الشيك رقم % % ولم تنتهِ متابعته.',v_number,
      CASE WHEN v_status='endorsed' THEN 'مُجيّر له' ELSE 'قيد الانتظار' END;
  END IF;
  RETURN OLD;
END;
$$;
ALTER FUNCTION public.cheque_guard_supplier_deletion_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_guard_supplier_deletion_internal() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_cheque_guard_supplier_deletion BEFORE DELETE ON public.suppliers
FOR EACH ROW EXECUTE FUNCTION public.cheque_guard_supplier_deletion_internal();

-- Full explicit existing RPC. Role/action/audit/result contracts unchanged.
-- Acquire the same customer gate as collection/compensation BEFORE its row lock.
-- The trigger uses phase42 instead of the obsolete completed-order-only sum.
CREATE OR REPLACE FUNCTION public.set_customer_status(p_customer_id UUID,p_action TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_user_id UUID:=auth.uid();v_customer_name TEXT;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','sales'],'تعديل حالة العميل');
  IF p_action NOT IN ('block','unblock','delete') THEN RAISE EXCEPTION 'إجراء حالة العميل غير معتمد.';END IF;
  IF p_action='delete' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('go-live-collection-customer:'||p_customer_id::TEXT,0));
  END IF;
  SELECT full_name INTO v_customer_name FROM public.customers WHERE id=p_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'العميل غير موجود.';END IF;
  UPDATE public.customers SET
    is_blocked=CASE WHEN p_action='block' THEN true WHEN p_action='unblock' THEN false ELSE is_blocked END,
    is_active=CASE WHEN p_action='block' THEN false WHEN p_action='unblock' THEN true WHEN p_action='delete' THEN false ELSE is_active END,
    is_deleted=CASE WHEN p_action='delete' THEN true ELSE is_deleted END,updated_at=NOW()
  WHERE id=p_customer_id;
  INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details)
  VALUES(v_user_id,CASE p_action WHEN 'block' THEN 'BLOCK_CUSTOMER' WHEN 'unblock' THEN 'UNBLOCK_CUSTOMER' ELSE 'SOFT_DELETE_CUSTOMER' END,
    'customers',p_customer_id,jsonb_build_object('customer_name',v_customer_name,'action',p_action));
  RETURN jsonb_build_object('success',true,'customer_id',p_customer_id,'action',p_action);
END;
$$;
ALTER FUNCTION public.set_customer_status(UUID,TEXT) OWNER TO postgres;
-- Existing EXECUTE ACL is preserved by CREATE OR REPLACE; no new grants.

COMMIT;
