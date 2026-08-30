-- Phase 4 safety-freeze verification. Runs only in the disposable Supabase
-- project. Three independent shifts place a blocker near the beginning,
-- middle, and end of the ordered preview while retaining several supported
-- operations. Exact JSON snapshots must remain identical after rejection.
\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE full_shift_freeze_results (
  scenario TEXT PRIMARY KEY,
  outcome TEXT NOT NULL CHECK (outcome = 'expected_blocked'),
  before_hash TEXT NOT NULL,
  after_hash TEXT NOT NULL,
  blocker_index INTEGER NOT NULL,
  operation_count INTEGER NOT NULL
) ON COMMIT PRESERVE ROWS;

CREATE OR REPLACE FUNCTION pg_temp.full_shift_state_snapshot(
  p_shift_id UUID,
  p_branch_id UUID,
  p_warehouse_id UUID,
  p_customer_id UUID,
  p_supplier_id UUID
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'shift', (SELECT to_jsonb(cs) FROM public.cash_shifts cs WHERE cs.id=p_shift_id),
    'shift_summary', public.get_cash_shift_summary(p_shift_id),
    'orders', COALESCE((
      SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id)
      FROM public.orders o
      WHERE o.cash_shift_id=p_shift_id
         OR EXISTS (SELECT 1 FROM public.customer_payments cp WHERE cp.cash_shift_id=p_shift_id AND cp.order_id=o.id)
    ), '[]'::JSONB),
    'order_items', COALESCE((
      SELECT jsonb_agg(to_jsonb(oi) ORDER BY oi.id)
      FROM public.order_items oi
      WHERE EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id=oi.order_id
          AND (o.cash_shift_id=p_shift_id OR EXISTS (
            SELECT 1 FROM public.customer_payments cp WHERE cp.cash_shift_id=p_shift_id AND cp.order_id=o.id
          ))
      )
    ), '[]'::JSONB),
    'order_history', COALESCE((
      SELECT jsonb_agg(to_jsonb(osh) ORDER BY osh.id)
      FROM public.order_status_history osh
      WHERE EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id=osh.order_id
          AND (o.cash_shift_id=p_shift_id OR EXISTS (
            SELECT 1 FROM public.customer_payments cp WHERE cp.cash_shift_id=p_shift_id AND cp.order_id=o.id
          ))
      )
    ), '[]'::JSONB),
    'inventory_balances', COALESCE((
      SELECT jsonb_agg(to_jsonb(ib) ORDER BY ib.product_id)
      FROM public.inventory_balances ib WHERE ib.warehouse_id=p_warehouse_id
    ), '[]'::JSONB),
    'inventory_movements', COALESCE((
      SELECT jsonb_agg(to_jsonb(im) ORDER BY im.id)
      FROM public.inventory_movements im WHERE im.warehouse_id=p_warehouse_id
    ), '[]'::JSONB),
    'customer_payments', COALESCE((
      SELECT jsonb_agg(to_jsonb(cp) ORDER BY cp.id)
      FROM public.customer_payments cp WHERE cp.cash_shift_id=p_shift_id
    ), '[]'::JSONB),
    'supplier_payments', COALESCE((
      SELECT jsonb_agg(to_jsonb(sp) ORDER BY sp.id)
      FROM public.supplier_payments sp WHERE sp.cash_shift_id=p_shift_id
    ), '[]'::JSONB),
    'expenses', COALESCE((
      SELECT jsonb_agg(to_jsonb(oe) ORDER BY oe.id)
      FROM public.operational_expenses oe WHERE oe.shift_id=p_shift_id
    ), '[]'::JSONB),
    'returns', COALESCE((
      SELECT jsonb_agg(to_jsonb(sr) ORDER BY sr.id)
      FROM public.sales_returns sr WHERE sr.cash_shift_id=p_shift_id
    ), '[]'::JSONB),
    'purchase_orders', COALESCE((
      SELECT jsonb_agg(to_jsonb(po) ORDER BY po.id)
      FROM public.purchase_orders po
      WHERE EXISTS (
        SELECT 1 FROM public.supplier_payments sp
        WHERE sp.cash_shift_id=p_shift_id AND sp.purchase_order_id=po.id
      )
    ), '[]'::JSONB),
    'supplier', (SELECT to_jsonb(s) FROM public.suppliers s WHERE s.id=p_supplier_id),
    'customer_outstanding_in_minor_units', COALESCE((
      SELECT SUM(GREATEST(o.total_in_minor_units-o.amount_paid_in_minor_units,0))::BIGINT
      FROM public.orders o
      WHERE o.customer_id=p_customer_id AND o.status IN ('completed','returned')
    ), 0),
    'full_reversals', COALESCE((
      SELECT jsonb_agg(to_jsonb(csr) ORDER BY csr.id)
      FROM public.cash_shift_reversals csr WHERE csr.shift_id=p_shift_id
    ), '[]'::JSONB),
    'full_reversal_operations', COALESCE((
      SELECT jsonb_agg(to_jsonb(csro) ORDER BY csro.id)
      FROM public.cash_shift_reversal_operations csro WHERE csro.shift_id=p_shift_id
    ), '[]'::JSONB),
    'pos_reversals', COALESCE((
      SELECT jsonb_agg(to_jsonb(psr) ORDER BY psr.id)
      FROM public.pos_sale_reversals psr
      JOIN public.orders o ON o.id=psr.order_id
      WHERE o.cash_shift_id=p_shift_id
    ), '[]'::JSONB),
    'supplier_reversals', COALESCE((
      SELECT jsonb_agg(to_jsonb(spr) ORDER BY spr.id)
      FROM public.supplier_payment_reversals spr
      JOIN public.supplier_payments sp ON sp.id=spr.supplier_payment_id
      WHERE sp.cash_shift_id=p_shift_id
    ), '[]'::JSONB),
    'audit', COALESCE((
      SELECT jsonb_agg(to_jsonb(al) ORDER BY al.id)
      FROM public.audit_logs al
      WHERE al.entity_id=p_shift_id
         OR al.details->>'cash_shift_id'=p_shift_id::TEXT
         OR al.details->>'shift_id'=p_shift_id::TEXT
    ), '[]'::JSONB),
    'report_sales', public.get_operational_business_report(
      p_branch_id,
      (NOW() AT TIME ZONE 'Asia/Amman')::DATE,
      (NOW() AT TIME ZONE 'Asia/Amman')::DATE
    )->'sales'
  );
$$;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);

DO $$
DECLARE
  v_case INTEGER;
  v_branch UUID;
  v_warehouse UUID;
  v_product UUID;
  v_shift UUID;
  v_pos_order UUID;
  v_web_order UUID;
  v_purchase_order UUID;
  v_result JSONB;
  v_preview JSONB;
  v_before JSONB;
  v_after JSONB;
  v_error TEXT;
  v_blocker_index INTEGER;
  v_operation_count INTEGER;
  v_customer UUID := '83000000-0000-0000-0000-000000000060';
  v_supplier UUID := '83000000-0000-0000-0000-000000000050';
  v_category UUID := '83000000-0000-0000-0000-000000000030';
  v_unit UUID := '83000000-0000-0000-0000-000000000040';
BEGIN
  FOR v_case IN 1..3 LOOP
    v_branch := gen_random_uuid();
    v_warehouse := gen_random_uuid();
    v_product := gen_random_uuid();
    v_web_order := gen_random_uuid();

    INSERT INTO public.branches(id,code,name_ar,is_active)
    VALUES(v_branch,'FREEZE-'||v_case||'-'||substr(v_branch::TEXT,1,8),'فرع تجميد الأمان '||v_case,true);
    INSERT INTO public.warehouses(id,branch_id,code,name_ar,is_active)
    VALUES(v_warehouse,v_branch,'FREEZE-WH-'||v_case||'-'||substr(v_warehouse::TEXT,1,8),'مستودع تجميد الأمان '||v_case,true);
    INSERT INTO public.products(
      id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,
      units_per_purchase_unit,units_per_sale_unit,default_sale_price_in_minor_units,
      cost_price_in_minor_units,sale_price_in_minor_units,wholesale_price_in_minor_units,
      min_stock_level,is_active
    ) VALUES(
      v_product,'FREEZE-'||v_case||'-'||substr(v_product::TEXT,1,8),'صنف تجميد '||v_case,
      v_category,v_unit,v_unit,v_unit,1,1,1000,200,1000,1000,1,true
    );
    INSERT INTO public.inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity)
    VALUES(v_warehouse,v_product,50,0);

    v_result := public.open_cash_shift(v_branch,1000);
    v_shift := (v_result->>'id')::UUID;
    v_result := public.create_pos_sale(
      v_warehouse,v_branch,CASE WHEN v_case=1 THEN v_customer ELSE NULL END,
      'عميل تجميد '||v_case,CASE WHEN v_case=1 THEN 'debt' ELSE 'cash' END,
      jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1)),
      5,0,'freeze-pos-'||v_case||'-'||replace(v_shift::TEXT,'-','')
    );
    v_pos_order := (v_result->>'orderId')::UUID;

    INSERT INTO public.orders(
      id,order_number,customer_id,branch_id,warehouse_id,status,payment_method,
      payment_status,subtotal_in_minor_units,discount_in_minor_units,
      total_in_minor_units,amount_paid_in_minor_units,source,created_at,updated_at
    ) VALUES(
      v_web_order,'FREEZE-WEB-'||v_case||'-'||substr(v_web_order::TEXT,1,8),v_customer,
      v_branch,v_warehouse,'completed','debt','unpaid',700,0,700,0,'website',NOW(),NOW()
    );
    PERFORM public.record_customer_order_payment_once(
      v_web_order,700,'cash',NULL,'قبض مدعوم ضمن اختبار التجميد',
      'freeze-customer-'||v_case||'-'||replace(v_shift::TEXT,'-','')
    );
    PERFORM public.create_operational_expense(
      v_branch,'اختبار التجميد','مصروف CliQ مدعوم',125,'cliq','FREEZE-CLIQ-'||v_case
    );
    v_result := public.create_purchase_order(
      v_supplier,v_branch,v_warehouse,NOW()+INTERVAL '1 day',0,0,
      'FREEZE-PO-INV-'||v_case,'أمر شراء لاختبار دفعة مدعومة',NULL,
      jsonb_build_array(jsonb_build_object(
        'product_id',v_product,'ordered_quantity',1,
        'purchase_price_in_minor_units',300,'discount_in_minor_units',0
      ))
    );
    v_purchase_order := (v_result->>'purchase_order_id')::UUID;
    PERFORM public.record_supplier_payment(
      v_supplier,v_purchase_order,300,'cash',NULL,NOW(),
      'دفعة مورد مدعومة ضمن التجميد',
      'freeze-supplier-'||v_case||'-'||replace(v_shift::TEXT,'-','')
    );

    IF v_case=1 THEN
      -- customer_payment sorts first; a payment on the POS sale is deliberately
      -- unsupported and also protects the sale from being reversed.
      PERFORM public.record_customer_order_payment_once(
        v_pos_order,995,'cash',NULL,'مانع في بداية قائمة العمليات',
        'freeze-begin-block-'||replace(v_shift::TEXT,'-','')
      );
    ELSIF v_case=2 THEN
      -- pos_sale sorts in the middle; a later explicit inventory movement is
      -- a dependency and must freeze the complete shift.
      PERFORM public.adjust_inventory_stock(
        v_warehouse,v_product,
        (SELECT on_hand_quantity+1 FROM public.inventory_balances WHERE warehouse_id=v_warehouse AND product_id=v_product),
        'مانع في وسط قائمة العمليات','manual'
      );
    ELSE
      -- unsupported_sales_return sorts last and must stop the orchestrator
      -- without attempting to reverse the return itself.
      INSERT INTO public.sales_returns(
        return_number,order_id,branch_id,warehouse_id,cash_shift_id,
        stock_disposition,reason,refund_method,refund_amount_in_minor_units,
        notes,created_by
      ) VALUES(
        'FREEZE-RETURN-'||substr(v_shift::TEXT,1,8),v_web_order,v_branch,v_warehouse,v_shift,
        'damaged','مانع في نهاية قائمة العمليات','cash',700,
        'Fixture أمان فقط؛ لا يمثل مسار مرتجع إنتاجي.',
        '83000000-0000-0000-0000-000000000001'
      );
    END IF;

    v_preview := public.preview_cash_shift_full_reversal(v_shift);
    IF COALESCE((v_preview->>'canExecute')::BOOLEAN,true) THEN
      RAISE EXCEPTION 'Safety-freeze case % was incorrectly executable: %',v_case,v_preview;
    END IF;

    SELECT ordinality::INTEGER
    INTO v_blocker_index
    FROM jsonb_array_elements(v_preview->'operations') WITH ORDINALITY AS operation(value,ordinality)
    WHERE value->>'status'='BLOCKED'
    ORDER BY ordinality
    LIMIT 1;
    v_operation_count := jsonb_array_length(v_preview->'operations');

    IF (v_case=1 AND v_blocker_index>2)
      OR (v_case=2 AND (v_blocker_index<=1 OR v_blocker_index>=v_operation_count))
      OR (v_case=3 AND v_blocker_index<>v_operation_count)
    THEN
      RAISE EXCEPTION 'Blocker position assertion failed for case %: index %, count %, preview %',
        v_case,v_blocker_index,v_operation_count,v_preview;
    END IF;

    v_before := pg_temp.full_shift_state_snapshot(v_shift,v_branch,v_warehouse,v_customer,v_supplier);
    BEGIN
      PERFORM public.reverse_cash_shift_with_operations(
        v_shift,'اختبار rollback كامل لموضع المانع '||v_case,
        'freeze-full-reversal-'||v_case||'-'||replace(v_shift::TEXT,'-','')
      );
      RAISE EXCEPTION 'Blocked safety-freeze case % executed.',v_case;
    EXCEPTION WHEN OTHERS THEN
      v_error := SQLERRM;
      IF v_error='Blocked safety-freeze case '||v_case||' executed.' THEN RAISE; END IF;
    END;
    v_after := pg_temp.full_shift_state_snapshot(v_shift,v_branch,v_warehouse,v_customer,v_supplier);
    IF v_before IS DISTINCT FROM v_after THEN
      RAISE EXCEPTION 'Rollback snapshot mismatch in safety-freeze case %.',v_case;
    END IF;

    INSERT INTO full_shift_freeze_results(
      scenario,outcome,before_hash,after_hash,blocker_index,operation_count
    ) VALUES(
      CASE v_case WHEN 1 THEN 'blocker_at_beginning' WHEN 2 THEN 'blocker_in_middle' ELSE 'blocker_at_end' END,
      'expected_blocked',md5(v_before::TEXT),md5(v_after::TEXT),v_blocker_index,v_operation_count
    );
  END LOOP;
END;
$$;

SELECT jsonb_build_object(
  'rollback_scenarios',(SELECT COUNT(*) FROM full_shift_freeze_results),
  'snapshots_equal',NOT EXISTS(SELECT 1 FROM full_shift_freeze_results WHERE before_hash<>after_hash),
  'results',(SELECT jsonb_agg(to_jsonb(r) ORDER BY scenario) FROM full_shift_freeze_results r)
) AS full_shift_freeze_summary;

ROLLBACK;
