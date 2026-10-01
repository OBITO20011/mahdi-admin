BEGIN;

-- Slice 4 is a PRIVATE, INACTIVE, zero-write diagnostic read layer. No caller,
-- public writer, projection, trigger, Shift summary or replay is cut over here.
-- Missing private anchors are incomplete evidence, never an implicit inflow.

CREATE FUNCTION phase5_private.discovery_uuid_v1(p_value JSONB)
RETURNS UUID LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF JSONB_TYPEOF(p_value) IS DISTINCT FROM 'string' THEN RETURN NULL; END IF;
  RETURN (p_value #>> '{}')::UUID;
EXCEPTION WHEN INVALID_TEXT_REPRESENTATION THEN RETURN NULL;
END;
$$;

CREATE FUNCTION phase5_private.money_v1(p_value JSONB)
RETURNS BIGINT LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE v_amount NUMERIC;
BEGIN
  IF JSONB_TYPEOF(p_value) IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_MONEY_INVALID';
  END IF;
  v_amount := (p_value #>> '{}')::NUMERIC;
  IF v_amount < 0 OR v_amount <> TRUNC(v_amount) OR v_amount > 9223372036854775807 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_MONEY_INVALID';
  END IF;
  RETURN v_amount::BIGINT;
END;
$$;

-- Typed ownership links, not shared product/customer/warehouse links. Discovery
-- tolerates malformed IDs only to FIND candidates; classification still rejects
-- them. A missing endpoint remains an edge, so reverse ownership is not hidden.
CREATE FUNCTION phase5_private.financial_node_links_v1(p_kind TEXT, j JSONB)
RETURNS TABLE(order_ids UUID[], links TEXT[], sensitive BOOLEAN)
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE v_source_prefix TEXT;
BEGIN
  order_ids := ARRAY[]::UUID[]; links := ARRAY[]::TEXT[]; sensitive := false;
  CASE p_kind
  WHEN 'o' THEN
    order_ids := ARRAY[phase5_private.discovery_uuid_v1(j->'id')];
    links := ARRAY['b:' || (j->>'operation_id')];
  WHEN 'b' THEN
    order_ids := ARRAY[phase5_private.discovery_uuid_v1(j->'request_identity_snapshot'->'order_id'),
      phase5_private.discovery_uuid_v1(j->'result_snapshot'->'orderId'),
      phase5_private.discovery_uuid_v1(j->'result_snapshot'->'order_id')];
    sensitive := j->>'operation_type' = 'phase4_return_v1';
  WHEN 'f' THEN
    order_ids := ARRAY[phase5_private.discovery_uuid_v1(j->'request_identity_snapshot'->'orderId'),
      phase5_private.discovery_uuid_v1(j->'result_snapshot'->'orderId')];
    links := ARRAY['p:' || (j->'request_identity_snapshot'->>'originalPaymentId'),
      'c:' || (j->'request_identity_snapshot'->>'originalCollectionEventId'),
      'c:' || (j->'result_snapshot'->>'collectionEventId'),
      'v:' || (j->'result_snapshot'->>'reversalEventId')];
    sensitive := true;
  WHEN 'p' THEN
    order_ids := ARRAY[phase5_private.discovery_uuid_v1(j->'order_id')];
  WHEN 'c' THEN
    order_ids := ARRAY[phase5_private.discovery_uuid_v1(j->'order_id')];
    links := ARRAY['f:' || (j->>'financial_operation_id'), 'p:' || (j->>'original_payment_id')];
    sensitive := true;
  WHEN 'v' THEN
    order_ids := ARRAY[phase5_private.discovery_uuid_v1(j->'order_id')];
    links := ARRAY['f:' || (j->>'financial_operation_id'), 'p:' || (j->>'original_payment_id'),
      'c:' || (j->>'original_collection_event_id')];
    sensitive := true;
  WHEN 't' THEN
    order_ids := ARRAY[phase5_private.discovery_uuid_v1(j->'order_id')];
    links := ARRAY['f:' || (j->>'operation_id'), 'p:' || (j->>'original_payment_id'),
      'v:' || (j->>'reversal_event_id')];
    sensitive := true;
  WHEN 'd' THEN
    order_ids := ARRAY[phase5_private.discovery_uuid_v1(j->'result_snapshot'->'orderId')];
    links := ARRAY['f:' || (j->>'operation_id')]
      || ARRAY(SELECT 'f:' || value FROM JSONB_ARRAY_ELEMENTS_TEXT(j->'prior_reversal_operation_ids'))
      || ARRAY(SELECT 'b:' || value FROM JSONB_ARRAY_ELEMENTS_TEXT(j->'settled_return_operation_ids'))
      || ARRAY(SELECT CASE WHEN value->>'kind' = 'customer_payment' THEN 'p:' ELSE 'b:' END
        || (value->>'sourceId') FROM JSONB_ARRAY_ELEMENTS(CASE
          WHEN JSONB_TYPEOF(j->'sources_snapshot') = 'array' THEN j->'sources_snapshot' ELSE '[]'::JSONB END));
    sensitive := true;
  WHEN 'r' THEN
    order_ids := ARRAY[phase5_private.discovery_uuid_v1(j->'order_id')];
    links := ARRAY['b:' || (j->>'operation_id')];
    sensitive := j->>'contract_version' = '401';
  WHEN 'i' THEN
    order_ids := ARRAY[phase5_private.discovery_uuid_v1(j->'order_id')];
    links := ARRAY['b:' || (j->>'operation_id'), 'r:' || (j->>'sales_return_event_id'),
      's:' || (j->>'order_item_id'), 'h:' || (j->>'parcel_instance_id')];
    sensitive := j->>'operation_id' IS NOT NULL;
  WHEN 'n' THEN
    links := ARRAY['b:' || (j->>'return_operation_id'), 'i:' || (j->>'sales_return_item_id'),
      'a:' || (j->>'parcel_component_id'), 'b:' || (j->>'original_sale_operation_id')];
    sensitive := true;
  WHEN 'u' THEN
    v_source_prefix := CASE j->>'source_kind' WHEN 'base_order_item' THEN 's:'
      WHEN 'parcel_component' THEN 'a:' WHEN 'replacement_item' THEN 'z:' ELSE 'invalid:' END;
    links := ARRAY['b:' || (j->>'operation_id'), 'i:' || (j->>'return_item_id'),
      'z:' || (j->>'replacement_item_id'), v_source_prefix || (j->>'source_id')];
    sensitive := j->>'consumption_kind' = 'return';
  WHEN 'e' THEN
    order_ids := ARRAY[phase5_private.discovery_uuid_v1(j->'order_id'),
      phase5_private.discovery_uuid_v1(j->'result_snapshot'->'orderId')];
    links := ARRAY['b:' || (j->>'operation_id'), 'r:' || (j->>'return_event_id')];
    sensitive := true;
  WHEN 'x' THEN
    links := ARRAY['b:' || (j->>'operation_id'), 'r:' || (j->>'return_event_id'),
      'm:' || (j->>'inventory_movement_id')];
    sensitive := true;
  WHEN 'm' THEN
    IF j->>'reference_type' = 'phase4_sales_return' THEN
      links := ARRAY['r:' || (j->>'reference_id')]; sensitive := true;
    END IF;
  WHEN 's' THEN
    order_ids := ARRAY[phase5_private.discovery_uuid_v1(j->'order_id')];
    links := ARRAY['b:' || (j->>'operation_id')];
  WHEN 'h' THEN
    order_ids := ARRAY[phase5_private.discovery_uuid_v1(j->'order_id')];
    links := ARRAY['s:' || (j->>'order_item_id'), 'b:' || (j->>'operation_id')];
  WHEN 'a' THEN
    links := ARRAY['h:' || (j->>'parcel_instance_id'), 'b:' || (j->>'operation_id')];
  WHEN 'z' THEN
    links := ARRAY['k:' || (j->>'replacement_event_id'), 'b:' || (j->>'operation_id'),
      's:' || (j->>'root_order_item_id'), 'h:' || (j->>'root_parcel_instance_id'),
      'a:' || (j->>'root_parcel_component_id'), 'z:' || (j->>'parent_replacement_item_id')];
  WHEN 'k' THEN
    order_ids := ARRAY[phase5_private.discovery_uuid_v1(j->'root_order_id')];
    links := ARRAY['b:' || (j->>'operation_id')];
  ELSE RAISE EXCEPTION 'PHASE5_READ_NODE_KIND_INVALID';
  END CASE;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION phase5_private.financial_graph_nodes_v1()
RETURNS TABLE(node_key TEXT, kind TEXT, row_data JSONB, order_ids UUID[], links TEXT[], sensitive BOOLEAN)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
  WITH rows(kind, row_data) AS (
    SELECT 'o', TO_JSONB(t) FROM public.orders t UNION ALL
    SELECT 'b', TO_JSONB(t) FROM public.business_operations t WHERE t.operation_type IN
      ('phase3_pos_sale_v1','phase3_customer_reservation_v1','phase3_customer_completion_v1',
       'phase4_return_v1','phase4_replacement_v1') UNION ALL
    SELECT 'f', TO_JSONB(t) FROM phase5_private.financial_operation_events t UNION ALL
    SELECT 'p', TO_JSONB(t) FROM public.customer_payments t UNION ALL
    SELECT 'c', TO_JSONB(t) FROM phase5_private.collection_events t UNION ALL
    SELECT 'v', TO_JSONB(t) FROM phase5_private.payment_reversal_events t UNION ALL
    SELECT 't', TO_JSONB(t) FROM phase5_private.reversal_tender_movements t UNION ALL
    SELECT 'd', TO_JSONB(t) FROM phase5_private.reversal_coordinator_completions t UNION ALL
    SELECT 'r', TO_JSONB(t) FROM public.sales_return_events t UNION ALL
    SELECT 'i', TO_JSONB(t) FROM public.sales_return_items t UNION ALL
    SELECT 'n', TO_JSONB(t) FROM public.sales_return_component_inspections t UNION ALL
    SELECT 'u', TO_JSONB(t) FROM public.sales_aftercare_consumptions t UNION ALL
    SELECT 'e', TO_JSONB(t) FROM public.phase42_return_settlement_evidence t UNION ALL
    SELECT 'x', TO_JSONB(t) FROM public.phase42_return_inventory_effects t UNION ALL
    SELECT 'm', TO_JSONB(t) FROM public.inventory_movements t UNION ALL
    SELECT 's', TO_JSONB(t) FROM public.order_items t UNION ALL
    SELECT 'h', TO_JSONB(t) FROM public.order_parcel_instances t UNION ALL
    SELECT 'a', TO_JSONB(t) FROM public.order_parcel_components t UNION ALL
    SELECT 'z', TO_JSONB(t) FROM public.sales_replacement_items t UNION ALL
    SELECT 'k', TO_JSONB(t) FROM public.sales_replacement_events t
  )
  SELECT kind || ':' || COALESCE(row_data->>'id', row_data->>'operation_id'),
    kind, row_data, l.order_ids, l.links, l.sensitive
  FROM rows CROSS JOIN LATERAL phase5_private.financial_node_links_v1(kind, row_data) l;
$$;

CREATE FUNCTION phase5_private.discover_order_financial_graph_v1(p_order_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE v_graph JSONB; v_unassignable BOOLEAN; v_cross_order BOOLEAN;
BEGIN
  IF p_order_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PHASE5_READ_ORDER_REQUIRED';
  END IF;
  WITH RECURSIVE nodes AS MATERIALIZED (SELECT * FROM phase5_private.financial_graph_nodes_v1()),
  raw_edges AS (
    SELECT n.node_key a, edge b FROM nodes n CROSS JOIN LATERAL UNNEST(n.links) edge WHERE edge IS NOT NULL
    UNION ALL
    SELECT n.node_key, 'o:' || declared.order_id::TEXT FROM nodes n
      CROSS JOIN LATERAL UNNEST(n.order_ids) declared(order_id)
      JOIN public.orders o ON o.id = declared.order_id
  ), edges AS (SELECT a,b FROM raw_edges UNION SELECT b,a FROM raw_edges),
  reachable(order_id, node_key) AS (
    SELECT o.id, 'o:' || o.id::TEXT FROM public.orders o
    UNION
    SELECT r.order_id, e.b FROM reachable r JOIN edges e ON e.a = r.node_key
  )
  SELECT EXISTS (SELECT 1 FROM nodes n WHERE n.sensitive
      AND NOT EXISTS (SELECT 1 FROM reachable r WHERE r.node_key = n.node_key)),
    EXISTS (SELECT 1 FROM reachable a JOIN reachable b USING(node_key)
      WHERE a.order_id = p_order_id AND b.order_id <> p_order_id),
    COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT('key', n.node_key, 'kind', n.kind, 'row', n.row_data)
      ORDER BY n.node_key) FROM nodes n WHERE EXISTS (SELECT 1 FROM reachable r
        WHERE r.order_id = p_order_id AND r.node_key = n.node_key)), '[]'::JSONB)
  INTO v_unassignable, v_cross_order, v_graph;
  IF v_unassignable THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_UNASSIGNABLE_EVIDENCE';
  END IF;
  IF v_cross_order THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_INCONSISTENT_ORDER_OWNERSHIP';
  END IF;
  RETURN v_graph;
END;
$$;

-- Additive read-only counterpart of the frozen foundation finalizer's item,
-- inspection and capacity checks. Never invoke that locking/mutating finalizer.
CREATE FUNCTION phase5_private.return_entitlement_v1(p_operation_id UUID)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE
  e public.sales_return_events%ROWTYPE; op public.business_operations%ROWTYPE;
  i public.sales_return_items%ROWTYPE; original public.order_items%ROWTYPE;
  parcel public.order_parcel_instances%ROWTYPE; component public.order_parcel_components%ROWTYPE;
  inspection public.sales_return_component_inspections%ROWTYPE;
  total NUMERIC := 0; prior_quantity NUMERIC; prior_refund NUMERIC;
  refund NUMERIC; damage NUMERIC; consumed NUMERIC; v_root RECORD;
BEGIN
  SELECT * INTO STRICT e FROM public.sales_return_events WHERE operation_id=p_operation_id;
  SELECT * INTO STRICT op FROM public.business_operations WHERE id=p_operation_id;
  IF NOT EXISTS(SELECT 1 FROM public.sales_return_items WHERE operation_id=p_operation_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_READ_RETURN_ITEMS_MISSING';
  END IF;
  FOR i IN SELECT * FROM public.sales_return_items WHERE operation_id=p_operation_id ORDER BY id LOOP
    SELECT * INTO STRICT original FROM public.order_items WHERE id=i.order_item_id;
    IF i.sales_return_event_id IS DISTINCT FROM e.id OR i.order_id IS DISTINCT FROM e.order_id
      OR original.order_id IS DISTINCT FROM e.order_id OR i.returned_quantity IS NULL OR i.returned_quantity<=0 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_READ_RETURN_ITEM_IDENTITY_INVALID';
    END IF;
    damage := 0;
    IF i.return_scope='base_unit' THEN
      IF original.commercial_line_kind IS DISTINCT FROM 'base_unit' OR i.product_id IS DISTINCT FROM original.product_id
        OR original.quantity IS NULL OR original.quantity<=0
        OR i.raw_customer_damage_deduction_in_minor_units IS DISTINCT FROM 0
        OR i.applied_customer_damage_deduction_in_minor_units IS DISTINCT FROM 0
        OR i.accepted_base_quantity+i.rejected_base_quantity IS DISTINCT FROM i.returned_quantity
        OR EXISTS(SELECT 1 FROM public.sales_return_items other JOIN public.sales_return_events h ON h.id=other.sales_return_event_id
          WHERE other.order_item_id=original.id AND other.return_scope='base_unit' AND h.settlement_status='settled'
            AND h.settled_at=e.settled_at AND other.id<>i.id) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_READ_RETURN_BASE_ALLOCATION_INVALID';
      END IF;
      SELECT COALESCE(SUM(other.returned_quantity::NUMERIC),0),COALESCE(SUM(other.refund_amount_snapshot_in_minor_units::NUMERIC),0)
        INTO prior_quantity,prior_refund FROM public.sales_return_items other
        JOIN public.sales_return_events h ON h.id=other.sales_return_event_id
        WHERE other.order_item_id=original.id AND other.return_scope='base_unit'
          AND h.settlement_status='settled' AND h.settled_at<e.settled_at;
      IF prior_quantity+i.returned_quantity>original.quantity THEN RAISE EXCEPTION 'PHASE5_READ_RETURN_CAPACITY_INVALID'; END IF;
      refund := FLOOR(phase5_private.money_v1(TO_JSONB(original.net_refundable_amount_snapshot_in_minor_units))::NUMERIC
        *(prior_quantity+i.returned_quantity)/original.quantity)-prior_refund;
    ELSIF i.return_scope='parcel_instance' THEN
      SELECT * INTO STRICT parcel FROM public.order_parcel_instances WHERE id=i.parcel_instance_id;
      IF original.commercial_line_kind IS DISTINCT FROM 'configurable_parcel' OR parcel.order_id IS DISTINCT FROM e.order_id
        OR parcel.order_item_id IS DISTINCT FROM original.id OR i.returned_quantity IS DISTINCT FROM 1
        OR i.accepted_base_quantity+i.rejected_base_quantity IS DISTINCT FROM parcel.units_per_parcel_snapshot
        OR (SELECT COUNT(*) FROM public.sales_return_items other JOIN public.sales_return_events h ON h.id=other.sales_return_event_id
          WHERE other.parcel_instance_id=parcel.id AND h.settlement_status='settled') IS DISTINCT FROM 1::BIGINT THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_READ_RETURN_PARCEL_CAPACITY_INVALID';
      END IF;
      FOR component IN SELECT * FROM public.order_parcel_components WHERE parcel_instance_id=parcel.id LOOP
        SELECT * INTO STRICT inspection FROM public.sales_return_component_inspections
          WHERE sales_return_item_id=i.id AND parcel_component_id=component.id;
        IF inspection.return_operation_id IS DISTINCT FROM p_operation_id
          OR inspection.product_id IS DISTINCT FROM component.product_id
          OR inspection.original_sale_operation_id IS DISTINCT FROM component.operation_id
          OR inspection.accepted_quantity+inspection.rejected_quantity IS DISTINCT FROM component.base_quantity
          OR inspection.accepted_quantity<0 OR inspection.rejected_quantity<0
          OR (inspection.accepted_quantity>0 AND (inspection.accepted_condition IS NULL OR inspection.accepted_stock_disposition IS NULL))
          OR (inspection.rejected_quantity>0 AND (inspection.rejection_reason IS DISTINCT FROM 'customer_damage'
            OR inspection.rejected_stock_disposition IS DISTINCT FROM 'returned_to_customer'
            OR inspection.effective_standalone_unit_sale_price_snapshot_in_minor_units IS DISTINCT FROM
              component.effective_standalone_unit_sale_price_snapshot_in_minor_units)) THEN
          RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_READ_RETURN_INSPECTION_INVALID';
        END IF;
        damage := damage+inspection.rejected_quantity::NUMERIC*CASE WHEN inspection.rejected_quantity>0
          THEN phase5_private.money_v1(TO_JSONB(component.effective_standalone_unit_sale_price_snapshot_in_minor_units)) ELSE 0 END;
      END LOOP;
      IF (SELECT COUNT(*) FROM public.sales_return_component_inspections WHERE sales_return_item_id=i.id)
        IS DISTINCT FROM (SELECT COUNT(*) FROM public.order_parcel_components WHERE parcel_instance_id=parcel.id) THEN
        RAISE EXCEPTION 'PHASE5_READ_RETURN_INSPECTION_INVALID';
      END IF;
      refund := phase5_private.money_v1(TO_JSONB(parcel.net_refundable_amount_snapshot_in_minor_units))
        -LEAST(phase5_private.money_v1(TO_JSONB(parcel.net_refundable_amount_snapshot_in_minor_units)),damage);
      IF i.raw_customer_damage_deduction_in_minor_units IS DISTINCT FROM damage
        OR i.applied_customer_damage_deduction_in_minor_units IS DISTINCT FROM LEAST(parcel.net_refundable_amount_snapshot_in_minor_units,damage) THEN
        RAISE EXCEPTION 'PHASE5_READ_RETURN_DAMAGE_INVALID';
      END IF;
    ELSE RAISE EXCEPTION 'PHASE5_READ_RETURN_SCOPE_INVALID'; END IF;
    IF refund<0 OR i.refund_amount_snapshot_in_minor_units IS DISTINCT FROM refund THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_READ_RETURN_ENTITLEMENT_INVALID';
    END IF;
    total := total+refund;
  END LOOP;

  -- Per item + logical root, rather than aggregate operation totals. For a
  -- physical request use multiset EXCEPT ALL: duplicate A cannot mask missing B.
  IF op.request_identity_snapshot ? 'physical_sources' THEN
    IF JSONB_TYPEOF(op.request_identity_snapshot->'physical_sources') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'PHASE5_READ_RETURN_PHYSICAL_IDENTITY_INVALID';
    END IF;
    IF EXISTS(WITH expected AS (SELECT s->>'source_kind' kind,(s->>'source_id')::UUID id,
        (s->>'product_id')::UUID product,(s->>'quantity')::INTEGER quantity
        FROM JSONB_ARRAY_ELEMENTS(op.request_identity_snapshot->'physical_sources') s),
      actual AS (SELECT source_kind kind,source_id id,product_id product,consumed_quantity quantity
        FROM public.sales_aftercare_consumptions WHERE operation_id=p_operation_id AND consumption_kind='return'),
      delta AS ((SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
        UNION ALL (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)) SELECT 1 FROM delta) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_READ_RETURN_PHYSICAL_IDENTITY_INVALID';
    END IF;
  END IF;
  FOR v_root IN SELECT item.id item_id,'base_order_item' kind,item.order_item_id root_id,item.product_id product,item.returned_quantity quantity
      FROM public.sales_return_items item WHERE item.operation_id=p_operation_id AND item.return_scope='base_unit'
    UNION ALL SELECT item.id,'parcel_component',c.id,c.product_id,c.base_quantity FROM public.sales_return_items item
      JOIN public.order_parcel_components c ON c.parcel_instance_id=item.parcel_instance_id
      WHERE item.operation_id=p_operation_id AND item.return_scope='parcel_instance' LOOP
    SELECT SUM(c.consumed_quantity::NUMERIC) INTO consumed FROM public.sales_aftercare_consumptions c
      CROSS JOIN LATERAL public.phase4_aftercare_source_root_internal(c.source_kind,c.source_id,c.product_id) r
      WHERE c.operation_id=p_operation_id AND c.return_item_id=v_root.item_id AND c.consumption_kind='return'
        AND c.consumption_state='settled' AND r.root_kind=v_root.kind AND r.root_id=v_root.root_id
        AND r.product_id=v_root.product;
    IF consumed IS DISTINCT FROM v_root.quantity::NUMERIC THEN RAISE EXCEPTION 'PHASE5_READ_RETURN_CONSUMPTION_INVALID'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.sales_aftercare_consumptions c WHERE c.operation_id=p_operation_id AND NOT EXISTS(
    SELECT 1 FROM public.sales_return_items item
    CROSS JOIN LATERAL public.phase4_aftercare_source_root_internal(c.source_kind,c.source_id,c.product_id) r
    WHERE item.id=c.return_item_id AND item.operation_id=p_operation_id AND r.product_id=c.product_id
      AND ((item.return_scope='base_unit' AND r.root_kind='base_order_item' AND r.root_id=item.order_item_id AND item.product_id=c.product_id)
        OR (item.return_scope='parcel_instance' AND r.root_kind='parcel_component' AND EXISTS(SELECT 1 FROM public.order_parcel_components a
          WHERE a.id=r.root_id AND a.parcel_instance_id=item.parcel_instance_id AND a.product_id=c.product_id))))) THEN
    RAISE EXCEPTION 'PHASE5_READ_RETURN_CONSUMPTION_SCOPE_INVALID';
  END IF;
  RETURN total;
END;
$$;

CREATE FUNCTION phase5_private.read_order_financial_facts_v1(p_order_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE
  v_graph JSONB; v_sources JSONB; v_node JSONB; v_row JSONB;
  v_order public.orders%ROWTYPE; v_creation public.business_operations%ROWTYPE;
  v_return public.sales_return_events%ROWTYPE; v_operation public.business_operations%ROWTYPE;
  v_completion public.business_operations%ROWTYPE;
  v_total BIGINT; v_delivery BIGINT; v_merchandise BIGINT; v_entitlement NUMERIC;
  v_debt BIGINT; v_refund BIGINT; v_before_debt BIGINT; v_before_refundable BIGINT;
  v_reversals JSONB := '[]'::JSONB; v_returns JSONB := '[]'::JSONB;
BEGIN
  v_graph := phase5_private.discover_order_financial_graph_v1(p_order_id);
  SELECT * INTO STRICT v_order FROM public.orders WHERE id = p_order_id;
  SELECT * INTO STRICT v_creation FROM public.business_operations WHERE id = v_order.operation_id;
  v_sources := phase5_private.discover_collection_population_v1(p_order_id);
  IF v_creation.operation_type = 'phase3_pos_sale_v1' THEN
    v_total := phase5_private.money_v1(v_creation.result_snapshot->'totalInMinorUnits');
    PERFORM phase5_private.money_v1(v_creation.result_snapshot->'amountPaidInMinorUnits');
    v_delivery := 0;
  ELSIF v_creation.operation_type = 'phase3_customer_reservation_v1' THEN
    SELECT * INTO STRICT v_completion FROM public.business_operations WHERE
      operation_type = 'phase3_customer_completion_v1'
      AND request_identity_snapshot->>'order_id' = p_order_id::TEXT
      AND completed_at = v_order.cost_finalized_at;
    IF v_creation.request_identity_version IS DISTINCT FROM 301
      OR v_creation.request_fingerprint IS DISTINCT FROM public.phase3_request_fingerprint_internal(v_creation.request_identity_snapshot)
      OR v_creation.result_snapshot->'success' IS DISTINCT FROM 'true'::JSONB
      OR v_creation.result_snapshot->>'order_id' IS DISTINCT FROM p_order_id::TEXT
      OR v_creation.result_snapshot->>'operation_id' IS DISTINCT FROM v_creation.id::TEXT
    THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_SALE_ANCHOR_INVALID'; END IF;
    v_total := phase5_private.money_v1(v_completion.result_snapshot->'total_in_minor_units');
    PERFORM phase5_private.money_v1(v_completion.result_snapshot->'amount_paid_in_minor_units');
    PERFORM phase5_private.money_v1(v_completion.result_snapshot->'remaining_in_minor_units');
    v_merchandise := phase5_private.money_v1(v_creation.result_snapshot->'subtotal')
      - phase5_private.money_v1(v_creation.result_snapshot->'discount');
    IF v_merchandise < 0 OR v_total < v_merchandise THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_SALE_ANCHOR_INVALID';
    END IF;
    -- Completion may explicitly change delivery. Frozen merchandise is not repriced.
    v_delivery := v_total - v_merchandise;
  ELSE RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_LEGACY_UNSUPPORTED'; END IF;
  IF v_order.total_in_minor_units IS DISTINCT FROM v_total
    OR v_order.delivery_fee_in_minor_units IS DISTINCT FROM v_delivery THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_SALE_ANCHOR_INVALID';
  END IF;

  IF EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS(v_graph) n WHERE n->>'kind' = 'b'
    AND ((n->'row'->>'operation_type' IN ('phase3_pos_sale_v1','phase3_customer_reservation_v1')
        AND n->'row'->>'id' IS DISTINCT FROM v_creation.id::TEXT)
      OR (n->'row'->>'operation_type' = 'phase3_customer_completion_v1'
        AND n->'row'->>'id' IS DISTINCT FROM v_completion.id::TEXT))) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_SALE_COMPLETION_SET_INVALID';
  END IF;

  -- Validate every discovered operation, INCLUDING request-only orphans. Child
  -- subset validators are reused only after complete bidirectional discovery.
  FOR v_node IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_graph) WHERE value->>'kind' = 'f' LOOP
    v_row := v_node->'row';
    IF v_row->>'operation_type' = 'customer_collection_v1' THEN
      PERFORM phase5_private.validate_customer_collection_operation_v1((v_row->>'id')::UUID);
      IF EXISTS (SELECT 1 FROM phase5_private.payment_reversal_events WHERE financial_operation_id = (v_row->>'id')::UUID)
        OR EXISTS (SELECT 1 FROM phase5_private.reversal_tender_movements WHERE operation_id = (v_row->>'id')::UUID)
        OR EXISTS (SELECT 1 FROM phase5_private.reversal_coordinator_completions WHERE operation_id = (v_row->>'id')::UUID)
      THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_OPERATION_CHILD_MISMATCH'; END IF;
    ELSIF v_row->>'operation_type' = 'customer_payment_reversal_v1' THEN
      PERFORM phase5_private.validate_operational_reversal_v1((v_row->>'id')::UUID);
      IF EXISTS (SELECT 1 FROM phase5_private.collection_events WHERE financial_operation_id = (v_row->>'id')::UUID) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_OPERATION_CHILD_MISMATCH';
      END IF;
      SELECT TO_JSONB(t) INTO STRICT v_row FROM phase5_private.reversal_tender_movements t
        WHERE operation_id = (v_row->>'id')::UUID;
      v_reversals := v_reversals || JSONB_BUILD_ARRAY(v_row);
    ELSE RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_OPERATION_UNSUPPORTED'; END IF;
  END LOOP;
  -- Every child must point to an operation classified above; dangling FK edges
  -- and orphan public evidence cannot be silently dropped by an inner join.
  FOR v_node IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_graph) WHERE value->>'kind' IN ('c','v','t','d') LOOP
    v_row := v_node->'row';
    IF NOT EXISTS (SELECT 1 FROM phase5_private.financial_operation_events
      WHERE id = COALESCE((v_row->>'financial_operation_id')::UUID, (v_row->>'operation_id')::UUID)) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_INCOMPLETE_EVIDENCE';
    END IF;
  END LOOP;

  FOR v_node IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_graph)
    WHERE value->>'kind' = 'b' AND value->'row'->>'operation_type' = 'phase4_return_v1' LOOP
    SELECT * INTO STRICT v_operation FROM public.business_operations WHERE id = (v_node->'row'->>'id')::UUID;
    SELECT * INTO STRICT v_return FROM public.sales_return_events WHERE operation_id = v_operation.id;
    IF v_return.order_id IS DISTINCT FROM p_order_id OR v_return.contract_version IS DISTINCT FROM 401
      OR v_operation.request_identity_version IS DISTINCT FROM 401
      OR v_operation.request_identity_snapshot->>'order_id' IS DISTINCT FROM p_order_id::TEXT
      OR v_operation.request_fingerprint IS DISTINCT FROM public.phase3_request_fingerprint_internal(v_operation.request_identity_snapshot)
    THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_RETURN_BINDING_INVALID'; END IF;
    PERFORM public.phase4_assert_success_result_internal(
      v_operation.id, v_operation.operation_type, v_operation.result_snapshot, v_return.id);
    IF v_return.settlement_status IN ('draft','cancelled') THEN
      -- Phase4 foundation operations already carry a structural result and
      -- completed_at at draft INSERT. Neither is operational settlement truth.
      IF v_return.settled_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.phase42_return_settlement_evidence WHERE operation_id = v_operation.id)
        OR EXISTS (SELECT 1 FROM public.phase42_return_inventory_effects WHERE operation_id = v_operation.id)
        OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE reference_type = 'phase4_sales_return' AND reference_id = v_return.id)
        OR EXISTS (SELECT 1 FROM public.sales_aftercare_consumptions WHERE operation_id = v_operation.id AND consumption_state = 'settled')
      THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_NONTERMINAL_EFFECT_INVALID'; END IF;
      CONTINUE;
    END IF;
    PERFORM phase5_private.money_v1(v_operation.result_snapshot->'merchandiseEntitlementInMinorUnits');
    PERFORM phase5_private.money_v1(v_operation.result_snapshot->'debtReductionInMinorUnits');
    PERFORM phase5_private.money_v1(v_operation.result_snapshot->'moneyRefundInMinorUnits');
    PERFORM phase5_private.money_v1(v_operation.result_snapshot->'deliveryRefundInMinorUnits');
    PERFORM phase5_private.money_v1(v_operation.result_snapshot->'taxRefundInMinorUnits');
    PERFORM public.phase42_assert_operational_return_evidence_internal(v_operation.id, true);
    IF v_operation.completed_at IS NULL OR v_return.settlement_status IS DISTINCT FROM 'settled'
      OR v_operation.result_snapshot->'success' IS DISTINCT FROM 'true'::JSONB
      OR EXISTS (SELECT 1 FROM public.inventory_movements m WHERE m.reference_type = 'phase4_sales_return'
        AND m.reference_id = v_return.id AND NOT EXISTS (SELECT 1 FROM public.phase42_return_inventory_effects e
          WHERE e.operation_id = v_operation.id AND e.inventory_movement_id = m.id))
      OR EXISTS (SELECT 1 FROM public.sales_aftercare_consumptions WHERE operation_id = v_operation.id
        AND (consumption_kind IS DISTINCT FROM 'return' OR consumption_state IS DISTINCT FROM 'settled'))
    THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_RETURN_EVIDENCE_INVALID'; END IF;
    v_entitlement := phase5_private.return_entitlement_v1(v_operation.id);
    IF v_entitlement IS NULL OR v_entitlement < 0 OR v_entitlement > 9223372036854775807
      OR v_return.merchandise_refund_amount_in_minor_units IS DISTINCT FROM v_entitlement THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_RETURN_ENTITLEMENT_INVALID';
    END IF;
    v_debt := phase5_private.money_v1(TO_JSONB(v_return.debt_reduction_amount_in_minor_units));
    v_refund := phase5_private.money_v1(TO_JSONB(v_return.money_refund_amount_in_minor_units));
    v_before_debt := phase5_private.money_v1(TO_JSONB(v_return.outstanding_debt_before_snapshot_in_minor_units));
    v_before_refundable := phase5_private.money_v1(TO_JSONB(v_return.net_collected_before_snapshot_in_minor_units));
    IF v_entitlement <> v_debt::NUMERIC + v_refund OR v_debt <> LEAST(v_entitlement, v_before_debt)
      OR v_refund > v_before_refundable
      OR (v_refund = 0 AND (v_return.refund_method IS NOT NULL OR v_return.reference_number IS NOT NULL OR v_return.cash_shift_id IS NOT NULL))
      OR (v_refund > 0 AND (v_return.refund_method IS NULL OR v_return.refund_method NOT IN ('cash','cliq')
        OR v_return.cash_shift_id IS NULL
        OR (v_return.refund_method = 'cliq' AND NULLIF(BTRIM(v_return.reference_number),'') IS NULL)
        OR NOT EXISTS (SELECT 1 FROM public.cash_shifts s WHERE s.id = v_return.cash_shift_id
          AND s.branch_id = v_order.branch_id AND s.opened_at <= v_return.settled_at
          AND (s.closed_at IS NULL OR s.closed_at >= v_return.settled_at))))
    THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_RETURN_FINANCE_INVALID'; END IF;
    v_returns := v_returns || JSONB_BUILD_ARRAY(TO_JSONB(v_return));
  END LOOP;
  FOR v_node IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_graph) WHERE value->>'kind' IN ('r','i','n','e','x') LOOP
    v_row := v_node->'row';
    IF NOT EXISTS (SELECT 1 FROM public.business_operations WHERE operation_type = 'phase4_return_v1'
      AND id = COALESCE((v_row->>'operation_id')::UUID, (v_row->>'return_operation_id')::UUID)) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_RETURN_ORPHAN_OR_LEGACY';
    END IF;
  END LOOP;
  RETURN JSONB_BUILD_OBJECT('contractVersion',504,'orderId',p_order_id,
    'totalInMinorUnits',v_total,'deliveryInMinorUnits',v_delivery,
    'sources',v_sources,'reversals',v_reversals,'returns',v_returns,
    'discoveredEvidence',v_graph);
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS OR INVALID_TEXT_REPRESENTATION THEN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_INCOMPLETE_EVIDENCE';
END;
$$;

CREATE FUNCTION phase5_private.derive_financial_position_v1(f JSONB)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE
  t NUMERIC; l NUMERIC; c NUMERIC := 0; v NUMERIC := 0; d NUMERIC := 0; r NUMERIC := 0;
  cash_flow NUMERIC := 0; cliq_flow NUMERIC := 0; x NUMERIC; o NUMERIC; delivery_debt NUMERIC;
  collected_delivery NUMERIC; n JSONB; amount BIGINT; tender TEXT; value NUMERIC;
BEGIN
  IF JSONB_TYPEOF(f) IS DISTINCT FROM 'object' OR f->'contractVersion' IS DISTINCT FROM '504'::JSONB
    OR JSONB_TYPEOF(f->'sources') IS DISTINCT FROM 'array'
    OR JSONB_TYPEOF(f->'reversals') IS DISTINCT FROM 'array'
    OR JSONB_TYPEOF(f->'returns') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_FACTS_INVALID';
  END IF;
  t := phase5_private.money_v1(f->'totalInMinorUnits'); l := phase5_private.money_v1(f->'deliveryInMinorUnits');
  FOR n IN SELECT * FROM JSONB_ARRAY_ELEMENTS(f->'sources') LOOP
    amount := phase5_private.money_v1(n->'amountInMinorUnits'); tender := n->>'tenderMethod';
    IF tender IS NULL OR tender NOT IN ('cash','cliq','debt') OR (amount > 0 AND tender = 'debt') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_TENDER_INVALID';
    END IF;
    c := c + amount;
    IF tender = 'cash' THEN cash_flow := cash_flow + amount; ELSIF tender = 'cliq' THEN cliq_flow := cliq_flow + amount; END IF;
  END LOOP;
  FOR n IN SELECT * FROM JSONB_ARRAY_ELEMENTS(f->'reversals') LOOP
    amount := phase5_private.money_v1(n->'amount_in_minor_units'); tender := n->>'actual_tender';
    IF tender IS NULL OR tender NOT IN ('cash','cliq') THEN RAISE EXCEPTION 'PHASE5_READ_TENDER_INVALID'; END IF;
    v := v + amount;
    IF tender = 'cash' THEN cash_flow := cash_flow - amount; ELSE cliq_flow := cliq_flow - amount; END IF;
  END LOOP;
  FOR n IN SELECT * FROM JSONB_ARRAY_ELEMENTS(f->'returns') LOOP
    d := d + phase5_private.money_v1(n->'debt_reduction_amount_in_minor_units');
    amount := phase5_private.money_v1(n->'money_refund_amount_in_minor_units'); r := r + amount;
    tender := n->>'refund_method';
    IF amount > 0 AND (tender IS NULL OR tender NOT IN ('cash','cliq')) THEN RAISE EXCEPTION 'PHASE5_READ_TENDER_INVALID'; END IF;
    IF tender = 'cash' THEN cash_flow := cash_flow - amount; ELSIF tender = 'cliq' THEN cliq_flow := cliq_flow - amount; END IF;
  END LOOP;
  x := c - v;
  IF l > t OR x < 0 OR d+r > t-l OR x+d > t THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_FINANCIAL_DOMAIN_INVALID';
  END IF;
  o := t-x-d; delivery_debt := LEAST(l,o); collected_delivery := l-delivery_debt;
  IF r > x-collected_delivery OR cash_flow+cliq_flow <> x-r THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_READ_FINANCIAL_DOMAIN_INVALID';
  END IF;
  FOREACH value IN ARRAY ARRAY[t,l,c,v,d,r,x,o,delivery_debt,collected_delivery,x-r,x-r-collected_delivery,cash_flow,cliq_flow] LOOP
    IF value < -9223372036854775808 OR value > 9223372036854775807 THEN
      RAISE EXCEPTION USING ERRCODE = '22003', MESSAGE = 'PHASE5_READ_MONEY_OVERFLOW';
    END IF;
  END LOOP;
  -- jsonb_build_object(any) is catalog-STABLE because it permits time-dependent
  -- conversions. Here all emitted money is checked BIGINT and Order identity
  -- is already JSONB: use immutable integer/JSON text conversion, preserving
  -- numeric JSON types without relabeling a STABLE expression as IMMUTABLE.
  RETURN ('{"contractVersion":504,"orderId":' || COALESCE((f->'orderId')::TEXT,'null')
    || ',"totalInMinorUnits":' || t::BIGINT::TEXT
    || ',"deliveryInMinorUnits":' || l::BIGINT::TEXT
    || ',"collectionsInMinorUnits":' || c::BIGINT::TEXT
    || ',"paymentReversalsInMinorUnits":' || v::BIGINT::TEXT
    || ',"collectionCoverageInMinorUnits":' || x::BIGINT::TEXT
    || ',"settledDebtReductionInMinorUnits":' || d::BIGINT::TEXT
    || ',"settledMoneyRefundInMinorUnits":' || r::BIGINT::TEXT
    || ',"settledMerchandiseReturnEntitlementInMinorUnits":' || (d+r)::BIGINT::TEXT
    || ',"outstandingTotalInMinorUnits":' || o::BIGINT::TEXT
    || ',"deliveryOutstandingInMinorUnits":' || delivery_debt::BIGINT::TEXT
    || ',"collectedDeliveryInMinorUnits":' || collected_delivery::BIGINT::TEXT
    || ',"merchandiseDebtInMinorUnits":' || (o-delivery_debt)::BIGINT::TEXT
    || ',"refundableCollectedInMinorUnits":' || (x-r-collected_delivery)::BIGINT::TEXT
    || ',"customerNetMoneyFlowInMinorUnits":' || (x-r)::BIGINT::TEXT
    || ',"customerCashNetFlowInMinorUnits":' || cash_flow::BIGINT::TEXT
    || ',"customerCliqNetFlowInMinorUnits":' || cliq_flow::BIGINT::TEXT || '}')::JSONB;
END;
$$;

CREATE FUNCTION phase5_private.read_order_financial_position_v1(p_order_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
  SELECT phase5_private.derive_financial_position_v1(phase5_private.read_order_financial_facts_v1(p_order_id));
$$;

CREATE FUNCTION phase5_private.reconcile_order_financial_position_v1(p_order_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
  WITH canonical AS MATERIALIZED (SELECT phase5_private.read_order_financial_position_v1(p_order_id) position)
  SELECT JSONB_BUILD_OBJECT('contractVersion',504,'orderId',p_order_id,'canonical',c.position,
    'publicProjection',JSONB_BUILD_OBJECT('amountPaidInMinorUnits',o.amount_paid_in_minor_units,'paymentStatus',o.payment_status),
    'differences',JSONB_BUILD_OBJECT('amountPaidMinusCoverageInMinorUnits',
      o.amount_paid_in_minor_units::NUMERIC-(c.position->>'collectionCoverageInMinorUnits')::NUMERIC),
    'repairPerformed',false)
  FROM canonical c JOIN public.orders o ON o.id=p_order_id;
$$;

ALTER FUNCTION phase5_private.discovery_uuid_v1(JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.money_v1(JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.financial_node_links_v1(TEXT, JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.financial_graph_nodes_v1() OWNER TO postgres;
ALTER FUNCTION phase5_private.discover_order_financial_graph_v1(UUID) OWNER TO postgres;
ALTER FUNCTION phase5_private.return_entitlement_v1(UUID) OWNER TO postgres;
ALTER FUNCTION phase5_private.read_order_financial_facts_v1(UUID) OWNER TO postgres;
ALTER FUNCTION phase5_private.derive_financial_position_v1(JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.read_order_financial_position_v1(UUID) OWNER TO postgres;
ALTER FUNCTION phase5_private.reconcile_order_financial_position_v1(UUID) OWNER TO postgres;

REVOKE ALL ON FUNCTION phase5_private.discovery_uuid_v1(JSONB), phase5_private.money_v1(JSONB),
  phase5_private.financial_node_links_v1(TEXT, JSONB), phase5_private.financial_graph_nodes_v1(),
  phase5_private.discover_order_financial_graph_v1(UUID), phase5_private.return_entitlement_v1(UUID), phase5_private.read_order_financial_facts_v1(UUID),
  phase5_private.derive_financial_position_v1(JSONB), phase5_private.read_order_financial_position_v1(UUID),
  phase5_private.reconcile_order_financial_position_v1(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SCHEMA phase5_private FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION phase5_private.read_order_financial_facts_v1(UUID) IS
  'Private inactive 504 current financial facts: total graph discovery, no implicit anchor or money writes; one calling-query snapshot.';
COMMENT ON FUNCTION phase5_private.read_order_financial_position_v1(UUID) IS
  'Private inactive 504 current position; not historical replay, not a capacity reservation or authority cutover.';
COMMENT ON FUNCTION phase5_private.reconcile_order_financial_position_v1(UUID) IS
  'Private inactive 504 projection diagnostics only, same calling-query snapshot; never repairs public state.';

COMMIT;
