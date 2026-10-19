BEGIN;

-- Owner19Oct package2: immutable movement-time damage evidence; no backfill.
CREATE TABLE IF NOT EXISTS public.inventory_damage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  origin TEXT NOT NULL CHECK (origin IN ('shop','customer_return')),
  movement_id UUID UNIQUE REFERENCES public.inventory_movements(id) ON DELETE RESTRICT,
  return_event_id UUID REFERENCES public.sales_return_events(id) ON DELETE RESTRICT,
  source_kind TEXT CHECK (source_kind IN ('base_order_item','parcel_component','replacement_item')),
  source_id UUID,
  quantity INTEGER NOT NULL CHECK (quantity>0),
  unit_cost_in_minor_units_exact NUMERIC(24,6) NOT NULL CHECK (unit_cost_in_minor_units_exact>=0),
  value_in_minor_units_exact NUMERIC(30,6) GENERATED ALWAYS AS (quantity*unit_cost_in_minor_units_exact) STORED,
  loss_in_minor_units BIGINT GENERATED ALWAYS AS (ROUND(quantity*unit_cost_in_minor_units_exact)::BIGINT) STORED,
  reason_code TEXT NOT NULL CHECK (reason_code IN ('shop_breakage','expired','storage_damage','other','customer_return_final')),
  reason TEXT NOT NULL CHECK (NULLIF(BTRIM(reason),'') IS NOT NULL),
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  UNIQUE(return_event_id,source_kind,source_id),
  CHECK ((origin='shop' AND movement_id IS NOT NULL AND return_event_id IS NULL AND source_kind IS NULL AND source_id IS NULL AND reason_code<>'customer_return_final')
    OR (origin='customer_return' AND movement_id IS NULL AND return_event_id IS NOT NULL AND source_kind IS NOT NULL AND source_id IS NOT NULL AND reason_code='customer_return_final'))
);
ALTER TABLE public.inventory_damage_events OWNER TO postgres;
ALTER TABLE public.inventory_damage_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_damage_events FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS inventory_damage_events_period ON public.inventory_damage_events(branch_id,occurred_at);
CREATE INDEX IF NOT EXISTS inventory_damage_events_time ON public.inventory_damage_events(occurred_at);

CREATE OR REPLACE FUNCTION public.inventory_damage_reject_mutation_internal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DAMAGE_EVIDENCE_IMMUTABLE: دليل خسائر التلف ثابت ولا يعدل أو يحذف.';
END; $$;
ALTER FUNCTION public.inventory_damage_reject_mutation_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.inventory_damage_reject_mutation_internal() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS inventory_damage_events_immutable ON public.inventory_damage_events;
CREATE TRIGGER inventory_damage_events_immutable BEFORE UPDATE OR DELETE ON public.inventory_damage_events
FOR EACH ROW EXECUTE FUNCTION public.inventory_damage_reject_mutation_internal();
DROP TRIGGER IF EXISTS inventory_damage_events_no_truncate ON public.inventory_damage_events;
CREATE TRIGGER inventory_damage_events_no_truncate BEFORE TRUNCATE ON public.inventory_damage_events
FOR EACH STATEMENT EXECUTE FUNCTION public.inventory_damage_reject_mutation_internal();

CREATE OR REPLACE FUNCTION public.inventory_damage_period_totals_internal(p_branch_id UUID,p_from TIMESTAMPTZ,p_to TIMESTAMPTZ)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH scoped AS MATERIALIZED (
  SELECT * FROM public.inventory_damage_events
  WHERE (p_branch_id IS NULL OR branch_id=p_branch_id) AND occurred_at>=p_from AND occurred_at<p_to
 ), reasons AS (
  SELECT reason_code,COUNT(*) AS count,SUM(quantity) AS quantity,SUM(loss_in_minor_units) AS amount,
   COALESCE(SUM(loss_in_minor_units) FILTER(WHERE origin='customer_return'),0) AS included
  FROM scoped GROUP BY reason_code
 ) SELECT jsonb_build_object(
  'totalInMinorUnits',COALESCE(SUM(loss_in_minor_units),0),
  'additionalInMinorUnits',COALESCE(SUM(loss_in_minor_units) FILTER(WHERE origin='shop'),0),
  'alreadyIncludedInMinorUnits',COALESCE(SUM(loss_in_minor_units) FILTER(WHERE origin='customer_return'),0),
  'reasons',COALESCE((SELECT jsonb_agg(jsonb_build_object('code',reason_code,'count',count,'quantity',quantity,
   'amountInMinorUnits',amount,'alreadyIncludedInMinorUnits',included) ORDER BY reason_code) FROM reasons),'[]'::jsonb)
 ) FROM scoped;
$$;
ALTER FUNCTION public.inventory_damage_period_totals_internal(UUID,TIMESTAMPTZ,TIMESTAMPTZ) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.inventory_damage_period_totals_internal(UUID,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;

-- Only new settled returns are captured. Cost comes from immutable physical
-- lineage snapshots; rejected customer damage goes back to the customer.
CREATE OR REPLACE FUNCTION public.capture_final_return_damage_internal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 v_request JSONB; v_warehouse UUID; v_branch UUID; v_actor UUID;
 v_source RECORD; v_cost NUMERIC(24,6);
BEGIN
 SELECT b.request_identity_snapshot,o.warehouse_id,o.branch_id,b.initiated_by
 INTO v_request,v_warehouse,v_branch,v_actor
 FROM public.business_operations b JOIN public.orders o ON o.id=NEW.order_id
 WHERE b.id=NEW.operation_id AND b.operation_type='phase4_return_v1';
 IF NOT FOUND THEN RETURN NEW; END IF;
 FOR v_source IN
  WITH physical AS (
   SELECT x->>'source_kind' AS kind,(x->>'source_id')::UUID AS source_id,
    (x->>'product_id')::UUID AS product_id,(x->>'defect_non_sellable_quantity')::INTEGER AS quantity
   FROM jsonb_array_elements(COALESCE(v_request->'physical_sources','[]'::jsonb)) x
   WHERE (x->>'defect_non_sellable_quantity')::INTEGER>0
  ), fallback AS (
   SELECT 'base_order_item' AS kind,i.order_item_id AS source_id,i.product_id,i.accepted_base_quantity AS quantity
   FROM public.sales_return_items i WHERE i.sales_return_event_id=NEW.id
    AND i.return_scope='base_unit' AND i.stock_disposition='damaged' AND i.accepted_base_quantity>0
   UNION ALL
   SELECT 'parcel_component',c.parcel_component_id,c.product_id,c.accepted_quantity
   FROM public.sales_return_component_inspections c JOIN public.sales_return_items i ON i.id=c.sales_return_item_id
   WHERE i.sales_return_event_id=NEW.id AND c.accepted_condition='supplier_defect'
    AND c.accepted_stock_disposition='non_sellable' AND c.accepted_quantity>0
  ) SELECT * FROM physical
  UNION ALL SELECT * FROM fallback WHERE COALESCE(jsonb_array_length(v_request->'physical_sources'),0)=0
 LOOP
  IF v_source.kind='replacement_item' THEN
   SELECT replacement_unit_cost_snapshot_in_minor_units_exact INTO v_cost FROM public.sales_replacement_items WHERE id=v_source.source_id;
  ELSIF v_source.kind='parcel_component' THEN
   SELECT COALESCE(exact_cogs_snapshot_in_minor_units/NULLIF(base_quantity,0),unit_cost_snapshot_in_minor_units)
   INTO v_cost FROM public.order_parcel_components WHERE id=v_source.source_id;
  ELSE
   SELECT COALESCE(unit_cost_snapshot_in_minor_units_exact,unit_cost_in_minor_units::NUMERIC)
   INTO v_cost FROM public.order_items WHERE id=v_source.source_id;
  END IF;
  IF v_cost IS NULL OR v_cost<0 THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DAMAGE_HISTORICAL_COST_MISSING: دليل تكلفة المرتجع التالف غير مكتمل.';
  END IF;
  INSERT INTO public.inventory_damage_events(product_id,warehouse_id,branch_id,origin,return_event_id,source_kind,source_id,
   quantity,unit_cost_in_minor_units_exact,reason_code,reason,occurred_at,created_by)
  VALUES(v_source.product_id,v_warehouse,v_branch,'customer_return',NEW.id,v_source.kind,v_source.source_id,
   v_source.quantity,v_cost,'customer_return_final','مرتجع زبون تالف نهائي',NEW.settled_at,v_actor);
 END LOOP;
 RETURN NEW;
END; $$;
ALTER FUNCTION public.capture_final_return_damage_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.capture_final_return_damage_internal() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS capture_final_return_damage ON public.sales_return_events;
CREATE TRIGGER capture_final_return_damage AFTER UPDATE OF settlement_status ON public.sales_return_events
FOR EACH ROW WHEN (NEW.contract_version=401 AND NEW.settlement_status='settled' AND OLD.settlement_status IS DISTINCT FROM 'settled')
EXECUTE FUNCTION public.capture_final_return_damage_internal();

CREATE OR REPLACE FUNCTION public.adjust_inventory_stock(p_warehouse_id uuid, p_product_id uuid, p_actual_quantity integer, p_reason text, p_adjustment_type text DEFAULT 'stock_count'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_product_name TEXT;
  v_unit_cost NUMERIC(24,6);
  v_previous_quantity INTEGER;
  v_reserved_quantity INTEGER;
  v_quantity_change INTEGER;
  v_movement_type TEXT;
  v_movement_id UUID;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'جرد وتسوية المخزون'
  );

  IF p_warehouse_id IS NULL OR p_product_id IS NULL THEN
    RAISE EXCEPTION 'المنتج والمستودع مطلوبان.';
  END IF;
  IF p_actual_quantity IS NULL OR p_actual_quantity < 0 THEN
    RAISE EXCEPTION 'الكمية الفعلية يجب أن تكون عدداً صحيحاً لا يقل عن صفر.';
  END IF;
  IF NULLIF(TRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'سبب الجرد أو التسوية مطلوب.';
  END IF;
  IF COALESCE(p_adjustment_type, 'stock_count') NOT IN (
    'stock_count',
    'damage',
    'expired',
    'manual'
  ) THEN
    RAISE EXCEPTION 'نوع تسوية المخزون غير معتمد.';
  END IF;

  -- Same sorted advisory/balance/product lock order as receiving and returns.
  PERFORM public.phase2_lock_inventory_products_internal(ARRAY[p_product_id]);
  SELECT p.name_ar, COALESCE(p.wac_cost_in_minor_units_exact,p.cost_price_in_minor_units::NUMERIC)
  INTO v_product_name,v_unit_cost
  FROM public.products p
  WHERE p.id = p_product_id
    AND p.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المنتج المحدد غير موجود أو غير نشط.';
  END IF;

  SELECT on_hand_quantity, reserved_quantity
  INTO v_previous_quantity, v_reserved_quantity
  FROM public.inventory_balances
  WHERE warehouse_id = p_warehouse_id
    AND product_id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'لا يوجد رصيد لهذا المنتج في المستودع المحدد.';
  END IF;

  IF p_actual_quantity < v_reserved_quantity THEN
    RAISE EXCEPTION
      'لا يمكن جعل المخزون الفعلي (%) أقل من الكمية المحجوزة (%).',
      p_actual_quantity,
      v_reserved_quantity;
  END IF;

  v_quantity_change := p_actual_quantity - v_previous_quantity;
  v_movement_type :=
    CASE WHEN v_quantity_change >= 0
      THEN 'adjustment_add'
      ELSE 'adjustment_subtract'
    END;

  UPDATE public.inventory_balances
  SET
    on_hand_quantity = p_actual_quantity,
    updated_at = NOW()
  WHERE warehouse_id = p_warehouse_id
    AND product_id = p_product_id;

  IF v_quantity_change <> 0 THEN
    INSERT INTO public.inventory_movements (
      warehouse_id,
      product_id,
      movement_type,
      quantity,
      balance_before,
      balance_after,
      reference_type,
      reference_id,
      notes,
      created_by
    ) VALUES (
      p_warehouse_id,
      p_product_id,
      v_movement_type,
      v_quantity_change,
      v_previous_quantity,
      p_actual_quantity,
      COALESCE(p_adjustment_type, 'stock_count'),
      NULL,
      TRIM(p_reason),
      v_user_id
    )
    RETURNING id INTO v_movement_id;
    IF v_quantity_change<0 AND p_adjustment_type IN ('damage','expired') THEN
      IF v_unit_cost IS NULL OR v_unit_cost<0 THEN
        RAISE EXCEPTION 'DAMAGE_COST_MISSING: تكلفة حركة التلف غير متاحة.';
      END IF;
      INSERT INTO public.inventory_damage_events(product_id,warehouse_id,branch_id,origin,movement_id,
        quantity,unit_cost_in_minor_units_exact,reason_code,reason,occurred_at,created_by)
      SELECT p_product_id,p_warehouse_id,w.branch_id,'shop',v_movement_id,
        -v_quantity_change,v_unit_cost,CASE
          WHEN p_adjustment_type='expired' OR p_reason LIKE 'انتهت الصلاحية%' THEN 'expired'
          WHEN p_reason LIKE 'انكسر بالمحل%' THEN 'shop_breakage'
          WHEN p_reason LIKE 'تلف تخزين%' THEN 'storage_damage' ELSE 'other' END,
        TRIM(p_reason),m.created_at,v_user_id
      FROM public.warehouses w JOIN public.inventory_movements m ON m.id=v_movement_id
      WHERE w.id=p_warehouse_id;
    END IF;
  END IF;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'ADJUST_INVENTORY_STOCK',
    'inventory_balances',
    p_product_id,
    jsonb_build_object(
      'warehouse_id', p_warehouse_id,
      'product_name', v_product_name,
      'previous_quantity', v_previous_quantity,
      'actual_quantity', p_actual_quantity,
      'quantity_change', v_quantity_change,
      'adjustment_type', COALESCE(p_adjustment_type, 'stock_count'),
      'reason', TRIM(p_reason),
      'movement_id', v_movement_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'productId', p_product_id,
    'productName', v_product_name,
    'warehouseId', p_warehouse_id,
    'previousQuantity', v_previous_quantity,
    'actualQuantity', p_actual_quantity,
    'quantityChange', v_quantity_change,
    'availableQuantity', p_actual_quantity - v_reserved_quantity,
    'movementId', v_movement_id,
    'message', 'تم حفظ الجرد وتسوية المخزون في Supabase بنجاح.'
  );
END;
$function$;
ALTER FUNCTION public.adjust_inventory_stock(UUID,UUID,INTEGER,TEXT,TEXT) OWNER TO postgres;

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
  v_damage JSONB;
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

  v_damage := public.inventory_damage_period_totals_internal(p_branch_id,p_period_start,p_period_end);
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
  ), eligible AS MATERIALIZED (
    SELECT o.id, o.customer_id, o.total_in_minor_units,
      o.amount_paid_in_minor_units, o.operation_id
    FROM public.orders o
    WHERE o.status IN ('completed', 'delivered')
      AND o.customer_id IS NOT NULL
      AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
      AND (COALESCE(o.source, 'website') <> 'pos' OR o.payment_method = 'debt')
  ), prior_debt AS MATERIALIZED (
    -- Exact set-based form of121 phase42_order_financial_position_internal's
    -- prior_debt source. Do not introduce a projection/cache or new authority.
    SELECT e.order_id, SUM(e.debt_reduction_amount_in_minor_units)::BIGINT AS amount
    FROM public.sales_return_events e JOIN eligible o ON o.id = e.order_id
    WHERE e.settlement_status = 'settled' AND e.contract_version = 401
      AND o.amount_paid_in_minor_units < o.total_in_minor_units
    GROUP BY e.order_id
  ), financial_positions AS MATERIALIZED (
    SELECT o.*, CASE
      WHEN o.amount_paid_in_minor_units >= o.total_in_minor_units THEN 0::BIGINT
      ELSE GREATEST(o.total_in_minor_units - o.amount_paid_in_minor_units
        - COALESCE(d.amount, 0), 0)::BIGINT END AS outstanding
    FROM eligible o LEFT JOIN prior_debt d ON d.order_id = o.id
  ), canonical_order_due AS (
    -- Same set-based canonical positions used by192 aging/CRM;see parity guard.
    SELECT id, customer_id, outstanding AS due FROM financial_positions
  ), opening_due AS (
    -- Preserve164 main-branch attribution;do not clamp signed source values.
    SELECT opening.customer_id, opening.outstanding AS due
    FROM public.go_live_customer_opening_positions_internal(NULL) opening
    WHERE p_branch_id IS NULL OR p_branch_id = public.go_live_main_branch_internal()
  ), balances AS (
    SELECT COALESCE(SUM(due), 0)::BIGINT AS due,
      COUNT(*) FILTER (WHERE due > 0 AND is_order) AS orders,
      COUNT(DISTINCT customer_id) FILTER (WHERE due > 0) AS customers
    FROM (
      SELECT true AS is_order, customer_id, due FROM canonical_order_due
      UNION ALL
      SELECT false, customer_id, due FROM opening_due
      UNION ALL
      SELECT false,c.customer_id,c.outstanding FROM public.cheque_customer_claim_positions_internal() c
      JOIN public.cheque_compensation_claims k ON k.id=c.id JOIN public.deferred_cheques q ON q.id=k.cheque_id
      WHERE p_branch_id IS NULL OR q.branch_id=p_branch_id
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
  ), daily_collections AS (
    -- One period-local aggregation. Never rescan all money events twice for
    -- every date in the month; collection/reversal equations are unchanged.
    SELECT (m.at AT TIME ZONE p_timezone)::DATE AS day,
      COALESCE(SUM(m.collection-m.reversal) FILTER(WHERE m.method='cash'),0)::BIGINT AS cash_collected,
      COALESCE(SUM(m.collection-m.reversal) FILTER(WHERE m.method='cliq'),0)::BIGINT AS cliq_collected
    FROM money_events m WHERE m.at>=p_period_start AND m.at<p_period_end
    GROUP BY (m.at AT TIME ZONE p_timezone)::DATE
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
          AND (r.at AT TIME ZONE p_timezone)::DATE = d.day), 0)::BIGINT AS returned,
      COALESCE(dc.cash_collected,0)::BIGINT AS cash_collected,
      COALESCE(dc.cliq_collected,0)::BIGINT AS cliq_collected
    FROM days d LEFT JOIN daily_collections dc ON dc.day=d.day
  ) SELECT jsonb_build_object(
    'sales', jsonb_build_object('grossSalesInMinorUnits', s.gross, 'deliveryFeesInMinorUnits', s.delivery,
      'returnEntitlementInMinorUnits', r.entitlement, 'refundsInMinorUnits', r.refund,
      'debtReductionInMinorUnits', r.debt, 'netSalesInMinorUnits', s.gross - r.entitlement,
      'cogsInMinorUnits', c.cogs, 'replacementCostInMinorUnits', rc.cost,
      'restockRecoveryInMinorUnits', r.recovery, 'grossProfitInMinorUnits', s.gross - s.delivery - c.cogs,
      'aftercareAdjustedMarginInMinorUnits', s.gross - r.entitlement - c.cogs - rc.cost + r.recovery,
      'netProfitInMinorUnits', s.gross - r.entitlement - c.cogs - rc.cost + r.recovery - x.amount
        - (v_damage->>'additionalInMinorUnits')::BIGINT,
      'damageLosses',v_damage,
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
      'returnEntitlementInMinorUnits', returned, 'netSalesInMinorUnits', gross - returned,
      'cashCollectedInMinorUnits',cash_collected,'cliqCollectedInMinorUnits',cliq_collected)
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


CREATE OR REPLACE FUNCTION public._get_home_dashboard_before133()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_business_date DATE := (NOW() AT TIME ZONE 'Asia/Amman')::DATE;
  v_today_start TIMESTAMPTZ;
  v_tomorrow_start TIMESTAMPTZ;
  v_month_start TIMESTAMPTZ;
  v_month JSONB;
  v_week JSONB;
  v_today JSONB;
  v_today_sales BIGINT := 0;
  v_today_completed_orders INTEGER := 0;
  v_month_sales BIGINT := 0;
  v_month_profit BIGINT := 0;
  v_open_orders INTEGER := 0;
  v_new_orders INTEGER := 0;
  v_customer_receivables BIGINT := 0;
  v_supplier_payables BIGINT := 0;
  v_inventory_value BIGINT := 0;
  v_active_products INTEGER := 0;
  v_active_customers INTEGER := 0;
  v_low_stock INTEGER := 0;
  v_out_of_stock INTEGER := 0;
  v_configuration_issues INTEGER := 0;
  v_can_view_profit BOOLEAN := false;
  v_latest_orders JSONB := '[]'::JSONB;
  v_stock_alerts JSONB := '[]'::JSONB;
  v_order_statuses JSONB := '[]'::JSONB;
  v_seven_day_sales JSONB := '[]'::JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY[
      'owner',
      'admin',
      'manager',
      'accountant',
      'sales',
      'warehouse_keeper',
      'delivery_driver'
    ],
    'عرض الصفحة الرئيسية'
  );

  v_today_start :=
    v_business_date::TIMESTAMP AT TIME ZONE 'Asia/Amman';
  v_tomorrow_start :=
    (v_business_date + 1)::TIMESTAMP AT TIME ZONE 'Asia/Amman';
  v_month_start :=
    date_trunc(
      'month',
      v_business_date::TIMESTAMP
    ) AT TIME ZONE 'Asia/Amman';

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND r.code IN ('owner', 'admin', 'manager', 'accountant')
  )
  INTO v_can_view_profit;

  -- The131 equations are unchanged. Only the home reader skips periodic
  -- evidence revalidation; reports and summaries remain strict.
  BEGIN
    v_month := public.phase6_financial_facts_internal(
      NULL, v_month_start, v_tomorrow_start, 'Asia/Amman', false);
    IF v_today_start - INTERVAL '6 days' >= v_month_start THEN
      -- Daily values are period-local by date. Reuse them only when the
      -- complete seven-day interval is contained in the monthly interval.
      SELECT jsonb_build_object('dailyBreakdown', jsonb_agg(day ORDER BY day->>'date'))
      INTO v_week FROM jsonb_array_elements(v_month->'dailyBreakdown') day
      WHERE (day->>'date')::DATE >= v_business_date - 6;
    ELSE
      -- Month boundary: never drop days from the previous month.
      v_week := public.phase6_financial_facts_internal(
        NULL, v_today_start - INTERVAL '6 days', v_tomorrow_start, 'Asia/Amman', false);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Preserve the complete pre131 unavailable response, including its old
    -- financial numbers. Expensive legacy calculations run ONLY on fallback.
    RETURN public._get_home_dashboard_before_phase6()
      || jsonb_build_object('financialFactsStatus', 'unavailable');
  END;
  SELECT day INTO v_today FROM jsonb_array_elements(v_week->'dailyBreakdown') day
  WHERE (day->>'date')::DATE = v_business_date;
  v_today_sales := COALESCE((v_today->>'grossSalesInMinorUnits')::BIGINT, 0);
  v_today_completed_orders := COALESCE((v_today->>'completedOrderCount')::INTEGER, 0);
  v_month_sales := (v_month #>> '{sales,grossSalesInMinorUnits}')::BIGINT;
  v_month_profit := (v_month #>> '{sales,netProfitInMinorUnits}')::BIGINT;
  v_customer_receivables := (v_month #>> '{balances,customerDueInMinorUnits}')::BIGINT;

  SELECT
    COUNT(*) FILTER (
      WHERE status IN (
        'new',
        'confirmed',
        'preparing',
        'ready',
        'out_for_delivery'
      )
    )::INTEGER,
    COUNT(*) FILTER (WHERE status = 'new')::INTEGER
  INTO
    v_open_orders,
    v_new_orders
  FROM public.orders;

  SELECT COALESCE(SUM(GREATEST(s.current_balance_in_minor_units, 0)), 0)
  INTO v_supplier_payables
  FROM public.suppliers s
  WHERE s.is_active = true;

  SELECT ROUND(COALESCE(SUM(
    ib.on_hand_quantity::NUMERIC
      * COALESCE(p.wac_cost_in_minor_units_exact, p.cost_price_in_minor_units::NUMERIC)
  ), 0), 0)::BIGINT
  INTO v_inventory_value
  FROM public.inventory_balances ib
  JOIN public.products p ON p.id = ib.product_id
  WHERE p.is_active = true;

  SELECT COUNT(*)::INTEGER
  INTO v_active_products
  FROM public.products
  WHERE is_active = true;

  SELECT COUNT(*)::INTEGER
  INTO v_active_customers
  FROM public.customers
  WHERE is_active = true
    AND is_deleted = false;

  WITH product_stock AS (
    SELECT
      p.id,
      p.min_stock_level,
      p.sale_unit_id,
      p.units_per_sale_unit,
      p.default_sale_price_in_minor_units,
      COALESCE(
        SUM(ib.on_hand_quantity - ib.reserved_quantity),
        0
      )::INTEGER AS available_quantity
    FROM public.products p
    LEFT JOIN public.inventory_balances ib
      ON ib.product_id = p.id
    WHERE p.is_active = true
    GROUP BY
      p.id,
      p.min_stock_level,
      p.sale_unit_id,
      p.units_per_sale_unit,
      p.default_sale_price_in_minor_units
  )
  SELECT
    COUNT(*) FILTER (
      WHERE sale_unit_id IS NOT NULL
        AND units_per_sale_unit > 1
        AND default_sale_price_in_minor_units > 0
        AND available_quantity < units_per_sale_unit
    )::INTEGER,
    COUNT(*) FILTER (
      WHERE sale_unit_id IS NOT NULL
        AND units_per_sale_unit > 1
        AND default_sale_price_in_minor_units > 0
        AND available_quantity >= units_per_sale_unit
        AND available_quantity <= GREATEST(
          min_stock_level,
          units_per_sale_unit
        )
    )::INTEGER,
    COUNT(*) FILTER (
      WHERE sale_unit_id IS NULL
        OR units_per_sale_unit <= 1
        OR default_sale_price_in_minor_units <= 0
    )::INTEGER
  INTO
    v_out_of_stock,
    v_low_stock,
    v_configuration_issues
  FROM product_stock;

  SELECT COALESCE(JSONB_AGG(order_row), '[]'::JSONB)
  INTO v_latest_orders
  FROM (
    SELECT
      o.id,
      o.order_number AS "orderNumber",
      COALESCE(c.full_name, 'زبون مباشر') AS "customerName",
      o.status,
      o.payment_status AS "paymentStatus",
      o.total_in_minor_units AS "totalInMinorUnits",
      o.source,
      o.created_at AS "createdAt"
    FROM public.orders o
    LEFT JOIN public.customers c ON c.id = o.customer_id
    ORDER BY o.created_at DESC
    LIMIT 5
  ) order_row;

  WITH product_stock AS (
    SELECT
      p.id,
      p.name_ar,
      p.sku,
      p.min_stock_level,
      p.sale_unit_id,
      p.units_per_sale_unit,
      p.default_sale_price_in_minor_units,
      COALESCE(u.name_ar, 'طرد') AS sale_unit_name,
      COALESCE(
        SUM(ib.on_hand_quantity - ib.reserved_quantity),
        0
      )::INTEGER AS available_quantity
    FROM public.products p
    LEFT JOIN public.inventory_balances ib
      ON ib.product_id = p.id
    LEFT JOIN public.units u
      ON u.id = p.sale_unit_id
    WHERE p.is_active = true
    GROUP BY
      p.id,
      p.name_ar,
      p.sku,
      p.min_stock_level,
      p.sale_unit_id,
      p.units_per_sale_unit,
      p.default_sale_price_in_minor_units,
      u.name_ar
  )
  SELECT COALESCE(JSONB_AGG(stock_row), '[]'::JSONB)
  INTO v_stock_alerts
  FROM (
    SELECT
      ps.id,
      ps.name_ar AS "nameAr",
      ps.sku,
      ps.available_quantity AS "availableBaseUnits",
      ps.units_per_sale_unit AS "unitsPerSaleUnit",
      ps.sale_unit_name AS "saleUnitName",
      FLOOR(
        ps.available_quantity::NUMERIC
        / GREATEST(ps.units_per_sale_unit, 1)
      )::INTEGER AS "availableSalePackages",
      CASE
        WHEN ps.sale_unit_id IS NULL
          OR ps.units_per_sale_unit <= 1
          OR ps.default_sale_price_in_minor_units <= 0
          THEN 'configuration'
        WHEN ps.available_quantity < ps.units_per_sale_unit
          THEN 'out_of_stock'
        ELSE 'low_stock'
      END AS severity
    FROM product_stock ps
    WHERE
      ps.sale_unit_id IS NULL
      OR ps.units_per_sale_unit <= 1
      OR ps.default_sale_price_in_minor_units <= 0
      OR ps.available_quantity < ps.units_per_sale_unit
      OR ps.available_quantity <= GREATEST(
        ps.min_stock_level,
        ps.units_per_sale_unit
      )
    ORDER BY
      CASE
        WHEN ps.sale_unit_id IS NULL
          OR ps.units_per_sale_unit <= 1
          OR ps.default_sale_price_in_minor_units <= 0
          THEN 0
        WHEN ps.available_quantity < ps.units_per_sale_unit
          THEN 1
        ELSE 2
      END,
      ps.available_quantity ASC,
      ps.name_ar ASC
    LIMIT 5
  ) stock_row;

  SELECT COALESCE(JSONB_AGG(status_row), '[]'::JSONB)
  INTO v_order_statuses
  FROM (
    SELECT
      status,
      COUNT(*)::INTEGER AS count
    FROM public.orders
    WHERE status IN (
      'new',
      'confirmed',
      'preparing',
      'ready',
      'out_for_delivery',
      'completed'
    )
    GROUP BY status
    ORDER BY CASE status
      WHEN 'new' THEN 1
      WHEN 'confirmed' THEN 2
      WHEN 'preparing' THEN 3
      WHEN 'ready' THEN 4
      WHEN 'out_for_delivery' THEN 5
      WHEN 'completed' THEN 6
      ELSE 7
    END
  ) status_row;

  SELECT COALESCE(jsonb_agg(day || jsonb_build_object(
    'salesInMinorUnits', day->'grossSalesInMinorUnits',
    'dayLabel', to_char((day->>'date')::DATE, 'Dy')
  ) ORDER BY day->>'date'), '[]'::JSONB)
  INTO v_seven_day_sales FROM jsonb_array_elements(v_week->'dailyBreakdown') day;

  RETURN JSONB_BUILD_OBJECT(
    'generatedAt', NOW(),
    'financialFactsStatus', 'available',
    'access', JSONB_BUILD_OBJECT(
      'canViewProfit', v_can_view_profit
    ),
    'summary', JSONB_BUILD_OBJECT(
      'todayCashCollectedInMinorUnits', (v_today->>'cashCollectedInMinorUnits')::BIGINT,
      'todayCliqCollectedInMinorUnits', (v_today->>'cliqCollectedInMinorUnits')::BIGINT,
      'todaySalesInMinorUnits', v_today_sales,
      'todayNetSalesInMinorUnits', COALESCE((v_today->>'netSalesInMinorUnits')::BIGINT, 0),
      'todayCompletedOrders', v_today_completed_orders,
      'monthSalesInMinorUnits', v_month_sales,
      'monthNetSalesInMinorUnits', v_month #> '{sales,netSalesInMinorUnits}',
      'monthProfitInMinorUnits',
        CASE WHEN v_can_view_profit THEN v_month_profit ELSE NULL END,
      'openOrdersCount', v_open_orders,
      'newOrdersCount', v_new_orders,
      'customerReceivablesInMinorUnits', v_customer_receivables,
      'supplierPayablesInMinorUnits', v_supplier_payables,
      'inventoryValueInMinorUnits', v_inventory_value,
      'activeProductsCount', v_active_products,
      'activeCustomersCount', v_active_customers,
      'lowStockCount', v_low_stock,
      'outOfStockCount', v_out_of_stock,
      'configurationIssuesCount', v_configuration_issues
    ),
    'latestOrders', v_latest_orders,
    'stockAlerts', v_stock_alerts,
    'orderStatuses', v_order_statuses,
    'sevenDaySales', v_seven_day_sales
  );
END;
$function$;
ALTER FUNCTION public._get_home_dashboard_before133() OWNER TO postgres;

COMMIT;
