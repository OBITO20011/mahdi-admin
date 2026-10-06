BEGIN;

-- Phase 6 package A. Only existing readers change: no tables, new functions,
-- grants, writers, triggers, or historical snapshot updates. The shared SQL
-- below is compiled into the existing live readers, not a new authority layer.
DO $migration$
DECLARE
  v_query TEXT := $query$
  WITH order_scope AS MATERIALIZED (
    SELECT o.*, first_completion.at AS completion_at, creation.operation_type,
      creation.result_snapshot AS creation_result, creation.completed_at AS creation_recorded_at,
      completion.result_snapshot AS completion_result,
      completion.completed_at AS completion_recorded_at,
      completion.request_identity_snapshot AS completion_request
    FROM public.orders o
    LEFT JOIN public.business_operations creation ON creation.id=o.operation_id
    LEFT JOIN LATERAL (
      SELECT MIN(h.created_at) AS at FROM public.order_status_history h
      WHERE h.order_id=o.id AND h.new_status='completed'
    ) first_completion ON true
    LEFT JOIN LATERAL (
      SELECT b.result_snapshot,b.completed_at,b.request_identity_snapshot
      FROM public.business_operations b
      WHERE b.operation_type='phase3_customer_completion_v1'
        AND b.result_snapshot->>'order_id'=o.id::TEXT
        AND b.request_identity_snapshot->>'order_id'=o.id::TEXT
      ORDER BY b.completed_at,b.id LIMIT 1
    ) completion ON true
    WHERE ($BRANCH$ IS NULL OR o.branch_id=$BRANCH$)
      AND first_completion.at IS NOT NULL
  ), modern_returns AS MATERIALIZED (
    SELECT e.*, public.phase42_assert_operational_return_evidence_internal(e.operation_id,true) AS proof
    FROM public.sales_return_events e JOIN order_scope o ON o.id=e.order_id
    WHERE e.contract_version=401 AND e.settlement_status='settled'
  ), issued AS MATERIALIZED (
    SELECT e.*, public.phase43_assert_operational_replacement_evidence_internal(e.operation_id,true) AS proof
    FROM public.sales_replacement_events e JOIN order_scope o ON o.id=e.root_order_id
    WHERE e.issuance_status='issued'
  ), return_rows AS (
    SELECT e.id,e.order_id,e.settled_at AS at,
      e.debt_reduction_amount_in_minor_units AS debt,
      e.money_refund_amount_in_minor_units AS refund,e.refund_method,
      e.debt_reduction_amount_in_minor_units+e.money_refund_amount_in_minor_units AS entitlement,
      COALESCE((SELECT SUM(f.historical_restock_value_in_minor_units_exact)
        FROM public.phase42_return_inventory_effects f WHERE f.return_event_id=e.id),0) AS recovery
    FROM modern_returns e
    UNION ALL
    SELECT e.id,e.order_id,e.created_at,0,e.refund_amount_in_minor_units,e.refund_method,
      e.refund_amount_in_minor_units,
      CASE WHEN e.stock_disposition='restock' THEN COALESCE((SELECT SUM(i.cogs_in_minor_units)
        FROM public.order_items i WHERE i.order_id=e.order_id),0) ELSE 0 END
    FROM public.sales_returns e JOIN order_scope o ON o.id=e.order_id
    WHERE o.operation_type IS NULL OR o.operation_type NOT IN
      ('phase3_pos_sale_v1','phase3_customer_reservation_v1')
  ), initial_collections AS (
    SELECT o.id AS order_id,
      CASE WHEN o.operation_type='phase3_pos_sale_v1' THEN o.creation_recorded_at
        ELSE COALESCE(o.completion_recorded_at,o.completion_at) END AS at,
      CASE WHEN o.operation_type='phase3_pos_sale_v1' THEN o.creation_result->>'paymentMethod'
        WHEN o.operation_type='phase3_customer_reservation_v1' THEN o.completion_request->>'payment_method'
        WHEN o.payment_method='cash_on_delivery' THEN 'cash' ELSE o.payment_method END AS method,
      CASE WHEN o.operation_type='phase3_pos_sale_v1' THEN (o.creation_result->>'amountPaidInMinorUnits')::BIGINT
        WHEN o.operation_type='phase3_customer_reservation_v1' THEN
          CASE WHEN NULLIF(o.completion_result->>'customer_payment_number','') IS NOT NULL THEN 0
            ELSE (o.completion_result->>'amount_paid_in_minor_units')::BIGINT END
        WHEN o.payment_method='debt' THEN 0 ELSE o.total_in_minor_units END AS amount
    FROM order_scope o
  ), money_events AS (
    SELECT order_id,at,method,amount AS collection,0::BIGINT AS reversal,0::BIGINT AS refund
    FROM initial_collections WHERE amount>0
    UNION ALL
    SELECT p.order_id,p.created_at,p.payment_method,p.amount_in_minor_units,0,0
    FROM public.customer_payments p JOIN order_scope o ON o.id=p.order_id
    UNION ALL
    SELECT p.order_id,p.reversed_at,p.payment_method,0,p.amount_in_minor_units,0
    FROM public.customer_payments p JOIN order_scope o ON o.id=p.order_id WHERE p.is_reversed
    UNION ALL
    SELECT r.order_id,r.created_at,m.method,0,m.amount,0
    FROM public.pos_sale_reversals r JOIN order_scope o ON o.id=r.order_id
    CROSS JOIN LATERAL (VALUES
      ('cash',(r.actual_effect->>'cash_in_minor_units')::BIGINT),
      ('cliq',(r.actual_effect->>'cliq_in_minor_units')::BIGINT)) m(method,amount)
    WHERE m.amount>0
    UNION ALL
    SELECT order_id,at,refund_method,0,0,refund FROM return_rows WHERE refund>0
  ), positions AS (
    SELECT o.id,o.customer_id,o.status,o.completion_at,o.total_in_minor_units,
      COALESCE((SELECT SUM(m.collection-m.reversal) FROM money_events m WHERE m.order_id=o.id),0)::BIGINT AS coverage,
      COALESCE((SELECT SUM(r.debt) FROM return_rows r WHERE r.order_id=o.id),0)::BIGINT AS debt_reduction
    FROM order_scope o
  ), period_sales AS (
    SELECT * FROM order_scope WHERE status IN ('completed','returned')
      AND completion_at >= $START$ AND completion_at < $END$
  ), sales_totals AS (
    SELECT COALESCE(SUM(total_in_minor_units),0)::BIGINT AS gross,
      COALESCE(SUM(delivery_fee_in_minor_units),0)::BIGINT AS delivery,
      COUNT(*) AS count FROM period_sales
  ), period_returns AS (
    SELECT COALESCE(SUM(entitlement),0)::BIGINT AS entitlement,
      COALESCE(SUM(refund),0)::BIGINT AS refund,COALESCE(SUM(debt),0)::BIGINT AS debt,
      ROUND(COALESCE(SUM(recovery),0))::BIGINT AS recovery,COUNT(*) AS count
    FROM return_rows WHERE at >= $START$ AND at < $END$
  ), costs AS (
    SELECT COALESCE(SUM(i.cogs_in_minor_units),0)::BIGINT AS cogs
    FROM public.order_items i JOIN period_sales o ON o.id=i.order_id
  ), replacement_costs AS (
    SELECT COALESCE(SUM(f.replacement_cogs_snapshot_in_minor_units),0)::BIGINT AS cost
    FROM issued e JOIN public.phase43_replacement_inventory_effects f ON f.operation_id=e.operation_id
    WHERE e.issued_at >= $START$ AND e.issued_at < $END$
  ), flows AS (
    SELECT COALESCE(SUM(collection-reversal) FILTER(WHERE method='cash'),0)::BIGINT AS cash_received,
      COALESCE(SUM(collection-reversal) FILTER(WHERE method='cliq'),0)::BIGINT AS cliq_received,
      COALESCE(SUM(refund) FILTER(WHERE method='cash'),0)::BIGINT AS cash_refunded,
      COALESCE(SUM(refund) FILTER(WHERE method='cliq'),0)::BIGINT AS cliq_refunded
    FROM money_events WHERE at >= $START$ AND at < $END$
  ), balances AS (
    SELECT COALESCE(SUM(total_in_minor_units-coverage-debt_reduction),0)::BIGINT AS due,
      COUNT(*) FILTER(WHERE total_in_minor_units-coverage-debt_reduction>0) AS orders,
      COUNT(DISTINCT customer_id) FILTER(WHERE total_in_minor_units-coverage-debt_reduction>0) AS customers
    FROM positions WHERE status IN ('completed','returned')
  ), cohort AS (
    SELECT COALESCE(SUM(p.coverage),0)::BIGINT AS coverage,
      COALESCE(SUM(p.total_in_minor_units-p.coverage-p.debt_reduction),0)::BIGINT AS due
    FROM positions p JOIN period_sales o ON o.id=p.id
  ), expenses AS (
    SELECT COALESCE(SUM(amount_in_minor_units),0)::BIGINT AS amount,
      COALESCE(SUM(amount_in_minor_units) FILTER(WHERE payment_method='cash'),0)::BIGINT AS cash,
      COALESCE(SUM(amount_in_minor_units) FILTER(WHERE payment_method='cliq'),0)::BIGINT AS cliq,COUNT(*) AS count
    FROM public.operational_expenses WHERE ($BRANCH$ IS NULL OR branch_id=$BRANCH$)
      AND NOT COALESCE(is_reversed,false) AND created_at >= $START$ AND created_at < $END$
  ), days AS (
    SELECT day::DATE AS day FROM generate_series(($START$ AT TIME ZONE $ZONE$)::DATE,
      ($END$ AT TIME ZONE $ZONE$)::DATE-1,INTERVAL '1 day') day
  ), daily AS (
    SELECT d.day,
      COALESCE((SELECT SUM(o.total_in_minor_units) FROM period_sales o
        WHERE (o.completion_at AT TIME ZONE $ZONE$)::DATE=d.day),0)::BIGINT AS gross,
      COALESCE((SELECT SUM(r.entitlement) FROM return_rows r
        WHERE (r.at AT TIME ZONE $ZONE$)::DATE=d.day),0)::BIGINT AS returned
    FROM days d
  ) SELECT jsonb_build_object(
    'sales',jsonb_build_object('grossSalesInMinorUnits',s.gross,'deliveryFeesInMinorUnits',s.delivery,
      'returnEntitlementInMinorUnits',r.entitlement,'refundsInMinorUnits',r.refund,
      'debtReductionInMinorUnits',r.debt,'netSalesInMinorUnits',s.gross-r.entitlement,
      'cogsInMinorUnits',c.cogs,'replacementCostInMinorUnits',rc.cost,
      'restockRecoveryInMinorUnits',r.recovery,'grossProfitInMinorUnits',s.gross-s.delivery-c.cogs,
      'aftercareAdjustedMarginInMinorUnits',s.gross-r.entitlement-c.cogs-rc.cost+r.recovery,
      'netProfitInMinorUnits',s.gross-r.entitlement-c.cogs-rc.cost+r.recovery-x.amount,
      'collectedInMinorUnits',co.coverage,'outstandingInMinorUnits',co.due,'returnCount',r.count,
      'orderCount',s.count,'completedOrderCount',s.count),
    'cashFlow',jsonb_build_object('cashCollectedInMinorUnits',f.cash_received,
      'cliqCollectedInMinorUnits',f.cliq_received,'cashRefundedInMinorUnits',f.cash_refunded,
      'cliqRefundedInMinorUnits',f.cliq_refunded,'cashNetFlowInMinorUnits',f.cash_received-f.cash_refunded,
      'cliqNetFlowInMinorUnits',f.cliq_received-f.cliq_refunded),
    'balances',jsonb_build_object('customerDueInMinorUnits',b.due,'customerOrderCount',b.orders,'customerCount',b.customers),
    'expenses',jsonb_build_object('totalInMinorUnits',x.amount,'cashInMinorUnits',x.cash,'cliqInMinorUnits',x.cliq,'count',x.count),
    'dailyBreakdown',(SELECT COALESCE(jsonb_agg(jsonb_build_object('date',day,
      'grossSalesInMinorUnits',gross,'returnEntitlementInMinorUnits',returned,
      'netSalesInMinorUnits',gross-returned) ORDER BY day),'[]'::JSONB) FROM daily)
  ) INTO v_phase6 FROM sales_totals s CROSS JOIN period_returns r CROSS JOIN costs c
    CROSS JOIN replacement_costs rc CROSS JOIN flows f CROSS JOIN balances b CROSS JOIN cohort co CROSS JOIN expenses x;
  $query$;
  v_definition TEXT;
  v_tail TEXT := E'\nEND;\n$function$';
  v_patch TEXT;
BEGIN
  SELECT REPLACE(REPLACE(pg_get_functiondef('public.get_operational_business_report(uuid,date,date)'::REGPROCEDURE),E'\r\n',E'\n'),E'\r',E'\n') INTO v_definition;
  IF POSITION('RETURN jsonb_set(' IN v_definition)=0 OR POSITION(v_tail IN v_definition)=0 THEN
    RAISE EXCEPTION 'Phase6 report reader source contract changed';
  END IF;
  v_definition := REPLACE(v_definition,E'DECLARE\n',E'DECLARE\n  v_phase6 JSONB;\n');
  v_definition := REPLACE(v_definition,'RETURN jsonb_set(','v_report := jsonb_set(');
  v_patch := REPLACE(REPLACE(REPLACE(REPLACE(v_query,'$ZONE$','''Asia/Amman'''),'$BRANCH$','p_branch_id'),'$START$','v_period_start'),'$END$','v_period_end');
  v_patch := v_patch || E'\n  v_report := jsonb_set(v_report,''{sales}'',(v_report->''sales'') || (v_phase6->''sales''));\n  v_report := jsonb_set(v_report,''{balances}'',(v_report->''balances'') || (v_phase6->''balances''));\n  v_report := jsonb_set(v_report,''{expenses}'',(v_report->''expenses'') || (v_phase6->''expenses''));\n  RETURN v_report || jsonb_build_object(''cashFlow'',v_phase6->''cashFlow'');';
  EXECUTE REPLACE(v_definition,v_tail,v_patch || v_tail);

  SELECT REPLACE(REPLACE(pg_get_functiondef('public.build_business_summary(text,date,date,timestamptz)'::REGPROCEDURE),E'\r\n',E'\n'),E'\r',E'\n') INTO v_definition;
  IF POSITION('  IF jsonb_typeof(v_result)' IN v_definition)=0 THEN RAISE EXCEPTION 'Phase6 summary reader source contract changed'; END IF;
  v_definition := REPLACE(v_definition,E'DECLARE\n',E'DECLARE\n  v_phase6 JSONB;\n');
  v_patch := REPLACE(REPLACE(REPLACE(REPLACE(v_query,'$ZONE$','v_timezone'),'$BRANCH$','NULL::UUID'),'$START$','v_period_start'),'$END$','v_period_end');
  v_patch := v_patch || E'\n  v_result := jsonb_set(v_result,''{sales}'',(v_result->''sales'') || (v_phase6->''sales''));\n  v_result := jsonb_set(v_result,''{balances}'',(v_result->''balances'') || (v_phase6->''balances''));\n  v_result := jsonb_set(v_result,''{expenses}'',(v_result->''expenses'') || (v_phase6->''expenses''));\n  v_result := v_result || jsonb_build_object(''cashFlow'',v_phase6->''cashFlow'',''dailyBreakdown'',v_phase6->''dailyBreakdown'');\n';
  EXECUTE REPLACE(v_definition,'  IF jsonb_typeof(v_result)',v_patch || '  IF jsonb_typeof(v_result)');

  SELECT REPLACE(REPLACE(pg_get_functiondef('public.get_home_dashboard()'::REGPROCEDURE),E'\r\n',E'\n'),E'\r',E'\n') INTO v_definition;
  IF POSITION('  RETURN JSONB_BUILD_OBJECT(' IN v_definition)=0 OR POSITION(v_tail IN v_definition)=0 THEN RAISE EXCEPTION 'Phase6 home reader source contract changed'; END IF;
  v_definition := REPLACE(v_definition,E'DECLARE\n',E'DECLARE\n  v_phase6 JSONB;\n  v_home JSONB;\n');
  v_definition := REPLACE(v_definition,'  RETURN JSONB_BUILD_OBJECT(','  v_home := JSONB_BUILD_OBJECT(');
  v_definition := REPLACE(v_definition,'o.status = ''completed''','o.status IN (''completed'',''returned'')');
  v_patch := REPLACE(REPLACE(REPLACE(REPLACE(v_query,'$ZONE$','''Asia/Amman'''),'$BRANCH$','NULL::UUID'),'$START$','v_month_start'),'$END$','v_tomorrow_start');
  v_patch := v_patch || E'\n  v_home := jsonb_set(v_home,''{summary,monthProfitInMinorUnits}'',CASE WHEN v_can_view_profit THEN v_phase6 #> ''{sales,netProfitInMinorUnits}'' ELSE ''null''::JSONB END);\n  v_home := jsonb_set(v_home,''{summary,monthNetSalesInMinorUnits}'',v_phase6 #> ''{sales,netSalesInMinorUnits}'');\n  v_home := jsonb_set(v_home,''{summary,customerReceivablesInMinorUnits}'',v_phase6 #> ''{balances,customerDueInMinorUnits}'');\n';
  v_patch := v_patch || REPLACE(REPLACE(REPLACE(REPLACE(v_query,'$ZONE$','''Asia/Amman'''),'$BRANCH$','NULL::UUID'),'$START$','v_today_start'),'$END$','v_tomorrow_start');
  v_patch := v_patch || E'\n  v_home := jsonb_set(v_home,''{summary,todayNetSalesInMinorUnits}'',v_phase6 #> ''{sales,netSalesInMinorUnits}'');\n';
  v_patch := v_patch || REPLACE(REPLACE(REPLACE(REPLACE(v_query,'$ZONE$','''Asia/Amman'''),'$BRANCH$','NULL::UUID'),'$START$','(v_today_start-INTERVAL ''6 days'')'),'$END$','v_tomorrow_start');
  v_patch := v_patch || E'\n  RETURN jsonb_set(v_home,''{sevenDaySales}'',(SELECT jsonb_agg(day || jsonb_build_object(''salesInMinorUnits'',day->''grossSalesInMinorUnits'',''dayLabel'',to_char((day->>''date'')::DATE,''Dy'')) ORDER BY day->>''date'') FROM jsonb_array_elements(v_phase6->''dailyBreakdown'') day));';
  EXECUTE REPLACE(v_definition,v_tail,v_patch || v_tail);
END;
$migration$;

-- Enrich only the live closing-report reader. The public snapshot reader still
-- returns the original persisted snapshot unchanged for an already-closed shift.
DO $migration$
DECLARE
  v_definition TEXT;
  v_tail TEXT := E'\nEND;\n$function$';
  v_patch TEXT;
BEGIN
  -- Defined below in this same migration; no mutation/snapshot function is altered.
  SELECT REPLACE(REPLACE(pg_get_functiondef('public._get_cash_shift_closing_report_before_snapshot(uuid)'::REGPROCEDURE),E'\r\n',E'\n'),E'\r',E'\n') INTO v_definition;
  IF POSITION('  RETURN jsonb_set(' IN v_definition)=0 OR POSITION(v_tail IN v_definition)=0 THEN RAISE EXCEPTION 'Phase6 closing reader source contract changed'; END IF;
  v_definition := REPLACE(v_definition,E'DECLARE\n',E'DECLARE\n  v_quantity_breakdown JSONB;\n');
  v_definition := REPLACE(v_definition,'IF v_event_count = 0 OR COALESCE','IF COALESCE');
  v_definition := REPLACE(v_definition,'  RETURN jsonb_set(','  v_report := jsonb_set(');
  v_patch := $patch$
  WITH quantities AS (
    -- Modern allocated returns preserve three independent buckets per physical
    -- leaf. A root inspection's accepted disposition cannot classify all its
    -- accepted quantity: it may contain both sellable and supplier-defect units.
    SELECT e.id AS event_id,(leaf->>'product_id')::UUID AS product_id,
      (leaf->>'sellable_restock_quantity')::INTEGER AS sellable,
      (leaf->>'defect_non_sellable_quantity')::INTEGER AS defect,
      (leaf->>'customer_damage_quantity')::INTEGER AS damage
    FROM public.sales_return_events e JOIN public.business_operations op ON op.id=e.operation_id
    CROSS JOIN LATERAL jsonb_array_elements(op.request_identity_snapshot->'physical_sources') leaf
    WHERE e.cash_shift_id=p_shift_id AND e.settlement_status='settled' AND e.contract_version=401
      AND jsonb_typeof(op.request_identity_snapshot->'physical_sources')='array'
    UNION ALL
    SELECT e.id AS event_id,i.product_id,
      CASE WHEN i.stock_disposition='restock' THEN i.accepted_base_quantity ELSE 0 END AS sellable,
      CASE WHEN i.stock_disposition='damaged' THEN i.accepted_base_quantity ELSE 0 END AS defect,
      i.rejected_base_quantity AS damage
    FROM public.sales_return_events e JOIN public.sales_return_items i ON i.sales_return_event_id=e.id
    JOIN public.business_operations op ON op.id=e.operation_id
    WHERE e.cash_shift_id=p_shift_id AND e.settlement_status='settled' AND e.contract_version=401 AND i.return_scope='base_unit'
      AND NOT (op.request_identity_snapshot ? 'physical_sources')
    UNION ALL
    SELECT e.id,c.product_id,
      CASE WHEN c.accepted_stock_disposition='restock' THEN c.accepted_quantity ELSE 0 END,
      CASE WHEN c.accepted_stock_disposition='non_sellable' THEN c.accepted_quantity ELSE 0 END,c.rejected_quantity
    FROM public.sales_return_events e JOIN public.sales_return_items i ON i.sales_return_event_id=e.id
    JOIN public.sales_return_component_inspections c ON c.sales_return_item_id=i.id
    JOIN public.business_operations op ON op.id=e.operation_id
    WHERE e.cash_shift_id=p_shift_id AND e.settlement_status='settled' AND e.contract_version=401
      AND NOT (op.request_identity_snapshot ? 'physical_sources')
    UNION ALL
    SELECT e.id,i.product_id,CASE WHEN e.stock_disposition='restock' THEN i.quantity ELSE 0 END,
      CASE WHEN e.stock_disposition='damaged' THEN i.quantity ELSE 0 END,0
    FROM public.sales_returns e JOIN public.order_items i ON i.order_id=e.order_id WHERE e.cash_shift_id=p_shift_id
  ) SELECT COALESCE(jsonb_agg(jsonb_build_object('eventId',q.event_id,'productId',q.product_id,
    'productName',COALESCE(p.name_ar,'صنف تاريخي'),'sellableQuantity',q.sellable,
    'defectQuantity',q.defect,'customerDamageQuantity',q.damage) ORDER BY q.event_id,q.product_id),'[]'::JSONB)
  INTO v_quantity_breakdown FROM quantities q LEFT JOIN public.products p ON p.id=q.product_id;
  -- Monetary refund remains event-level. Do not allocate it across physical outcomes.
  RETURN v_report || jsonb_build_object('returnQuantityBreakdown',v_quantity_breakdown);
  $patch$;
  EXECUTE REPLACE(v_definition,v_tail,v_patch || v_tail);
END;
$migration$;

COMMIT;
