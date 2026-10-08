-- Disposable scale data, not a migration or a business mutation API.
-- Historical legacy rows are explicitly synthetic. Operational V2 aftercare
-- below is created through the real authenticated public coordinators.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE e2_parameters AS SELECT :skus::integer skus, :families::integer families,
  :customers::integer customers,:suppliers::integer suppliers,:orders::integer orders,
  :modern::integer modern,:receipts::integer receipts,:payments::integer payments,
  :legacy_returns::integer legacy_returns,:shifts::integer shifts,:movements::integer movements,
  :days::integer days,
  ((NOW() AT TIME ZONE 'Asia/Amman')::date-(:days::integer-1))::timestamp AT TIME ZONE 'Asia/Amman' AS start_at;
CREATE FUNCTION pg_temp.e2_id(kind integer,n bigint) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('929'||LPAD(kind::text,5,'0')||'-0000-4000-8000-'||LPAD(n::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.e2_at(day integer,hours numeric) RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT start_at+make_interval(days=>day)+hours*interval '1 hour' FROM e2_parameters;
$$;
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
VALUES(pg_temp.e2_id(1,1),'authenticated','authenticated','scale-owner@example.test',NOW(),'{}','{}');
INSERT INTO profiles(id,full_name,is_active) VALUES(pg_temp.e2_id(1,1),'مالك فحص الحجم',true);
INSERT INTO roles(code,name_ar) VALUES('owner','مالك النظام') ON CONFLICT(code) DO NOTHING;
INSERT INTO user_roles(user_id,role_id) SELECT pg_temp.e2_id(1,1),id FROM roles WHERE code='owner';
INSERT INTO units(id,code,name_ar) VALUES(pg_temp.e2_id(2,1),'E2-UNIT','باكيت');
INSERT INTO categories(id,code,name_ar,is_active) VALUES(pg_temp.e2_id(3,1),'E2-CATEGORY','حجم سنتين',true);
INSERT INTO branches(id,code,name_ar,is_active) SELECT pg_temp.e2_id(10,n),'E2-B-'||n,'فرع الحجم '||n,true FROM generate_series(1,2) n;
INSERT INTO warehouses(id,branch_id,code,name_ar,is_active,created_at)
SELECT pg_temp.e2_id(11,n),pg_temp.e2_id(10,n),'E2-W-'||n,'مستودع الحجم '||n,true,
  CASE WHEN n=2 THEN '1900-01-01'::timestamptz ELSE '2000-01-01'::timestamptz END FROM generate_series(1,2) n;
INSERT INTO suppliers(id,company_name,is_active,current_balance_in_minor_units)
SELECT pg_temp.e2_id(12,n),'مورد الحجم '||n,true,0 FROM e2_parameters p,generate_series(1,p.suppliers)n;
INSERT INTO customers(id,full_name,phone,credit_limit_in_minor_units)
SELECT pg_temp.e2_id(13,n),'عميل الحجم '||n,'079'||LPAD(n::text,7,'0'),1000000 FROM e2_parameters p,generate_series(1,p.customers)n;
INSERT INTO products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,
  units_per_purchase_unit,units_per_sale_unit,default_purchase_price_in_minor_units,default_sale_price_in_minor_units,
  cost_price_in_minor_units,sale_price_in_minor_units,wholesale_price_in_minor_units,min_stock_level,
  is_active,is_flavor_master,wac_cost_in_minor_units_exact)
SELECT pg_temp.e2_id(14,n),'E2-F-'||LPAD(n::text,5,'0'),'عائلة الحجم '||LPAD(n::text,5,'0'),
  pg_temp.e2_id(3,1),pg_temp.e2_id(2,1),pg_temp.e2_id(2,1),pg_temp.e2_id(2,1),5,5,0,5000,0,1000,5000,0,true,true,0
FROM e2_parameters p,generate_series(1,p.families)n;
INSERT INTO products(id,sku,name_ar,category_id,flavor_master_product_id,flavor_name_ar,
  unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,
  default_purchase_price_in_minor_units,default_sale_price_in_minor_units,cost_price_in_minor_units,
  sale_price_in_minor_units,wholesale_price_in_minor_units,min_stock_level,is_active,wac_cost_in_minor_units_exact)
SELECT pg_temp.e2_id(15,n),'E2-S-'||LPAD(n::text,5,'0'),'باكيت الحجم '||LPAD(n::text,5,'0'),pg_temp.e2_id(3,1),
  pg_temp.e2_id(14,1+(n-1)/25),'نكهة '||LPAD(n::text,5,'0'),pg_temp.e2_id(2,1),pg_temp.e2_id(2,1),pg_temp.e2_id(2,1),
  1,1,500,1000,500,1000,1000,0,true,500 FROM e2_parameters p,generate_series(1,p.skus)n;
-- Current WAC starts at the same known historical cost; no repricing evidence.
UPDATE products SET cost_price_in_minor_units=500,wac_cost_in_minor_units_exact=500
WHERE sku LIKE 'E2-S-%';

CREATE TEMP TABLE e2_legacy_orders AS
SELECT n,pg_temp.e2_id(20,n) id,1+(n-1)%2 branch_n,
  FLOOR((n-1)::numeric*(p.days-1)/(p.orders-p.modern))::integer day_n,
  (n>p.orders-p.modern-p.payments/4) debt,
  (n<=p.legacy_returns) returned
FROM e2_parameters p,generate_series(1,p.orders-p.modern)n;
WITH sales AS (
  SELECT 2*day_n+branch_n shift_n,
    SUM(CASE WHEN NOT debt AND n%2=1 THEN 3000 ELSE 0 END) cash,
    SUM(CASE WHEN NOT debt AND n%2=0 THEN 3000 ELSE 0 END) cliq,
    SUM(CASE WHEN returned AND n%2=1 THEN 3000 ELSE 0 END) cash_refund,
    SUM(CASE WHEN returned AND n%2=0 THEN 3000 ELSE 0 END) cliq_refund
  FROM e2_legacy_orders GROUP BY 2*day_n+branch_n
), payments AS (
  SELECT 2*o.day_n+o.branch_n shift_n,SUM(CASE WHEN payment_n%2=1 THEN 500 ELSE 0 END) cash,
    SUM(CASE WHEN payment_n%2=0 THEN 500 ELSE 0 END) cliq
  FROM e2_parameters p CROSS JOIN generate_series(1,p.payments)payment_seq(payment_n)
  JOIN e2_legacy_orders o ON o.n=p.orders-p.modern-p.payments/4+1+(payment_n-1)%(p.payments/4)
  GROUP BY 2*o.day_n+o.branch_n
)
INSERT INTO cash_shifts(id,shift_number,branch_id,opened_by,opened_at,closed_at,
  opening_cash_in_minor_units,actual_cash_in_minor_units,status,cash_sales_in_minor_units,cliq_sales_in_minor_units,
  cash_receipts_in_minor_units,cliq_receipts_in_minor_units,cash_refunds_in_minor_units,cliq_refunds_in_minor_units,
  expected_cash_in_minor_units,cash_discrepancy_in_minor_units)
SELECT pg_temp.e2_id(16,n),'E2-HISTORY-'||n,pg_temp.e2_id(10,2),
  pg_temp.e2_id(1,1),pg_temp.e2_at(CASE WHEN n>2*(p.days-1) THEN 0 ELSE (n-1)/2 END,
    CASE WHEN n>2*(p.days-1) THEN 6 WHEN n%2=1 THEN 8 ELSE 13 END),
  pg_temp.e2_at(CASE WHEN n>2*(p.days-1) THEN 0 ELSE (n-1)/2 END,
    CASE WHEN n>2*(p.days-1) THEN 7 WHEN n%2=1 THEN 12 ELSE 17 END),
  0,COALESCE(s.cash,0)+COALESCE(pay.cash,0)-COALESCE(s.cash_refund,0),'closed',
  COALESCE(s.cash,0),COALESCE(s.cliq,0),COALESCE(pay.cash,0),COALESCE(pay.cliq,0),
  COALESCE(s.cash_refund,0),COALESCE(s.cliq_refund,0),
  COALESCE(s.cash,0)+COALESCE(pay.cash,0)-COALESCE(s.cash_refund,0),0
FROM e2_parameters p CROSS JOIN generate_series(1,p.shifts-1)n
LEFT JOIN sales s ON s.shift_n=n LEFT JOIN payments pay ON pay.shift_n=n;
INSERT INTO orders(id,order_number,customer_id,customer_name_snapshot,branch_id,warehouse_id,cash_shift_id,
  status,payment_method,payment_status,subtotal_in_minor_units,total_in_minor_units,amount_paid_in_minor_units,
  source,created_at,updated_at)
SELECT o.id,'E2-LEGACY-'||LPAD(o.n::text,7,'0'),pg_temp.e2_id(13,1+(o.n-1)%p.customers),'عميل الحجم',
  pg_temp.e2_id(10,2),pg_temp.e2_id(11,2),pg_temp.e2_id(16,2*o.day_n+o.branch_n),
  CASE WHEN o.returned THEN 'returned' ELSE 'completed' END,
  CASE WHEN o.debt THEN 'debt' WHEN o.n%2=0 THEN 'cliq' ELSE 'cash' END,
  CASE WHEN o.debt THEN 'partially_paid' ELSE 'paid' END,3000,3000,CASE WHEN o.debt THEN 2000 ELSE 3000 END,
  'website',pg_temp.e2_at(o.day_n,CASE WHEN o.branch_n=1 THEN 10 ELSE 15 END),
  pg_temp.e2_at(o.day_n,CASE WHEN o.branch_n=1 THEN 10 ELSE 15 END) FROM e2_legacy_orders o CROSS JOIN e2_parameters p;
INSERT INTO order_status_history(order_id,new_status,changed_by,created_at)
SELECT id,'completed',pg_temp.e2_id(1,1),pg_temp.e2_at(day_n,CASE WHEN branch_n=1 THEN 10 ELSE 15 END) FROM e2_legacy_orders;
INSERT INTO order_status_history(order_id,old_status,new_status,changed_by,created_at)
SELECT id,'completed','returned',pg_temp.e2_id(1,1),pg_temp.e2_at(day_n,CASE WHEN branch_n=1 THEN 11 ELSE 16 END) FROM e2_legacy_orders WHERE returned;
INSERT INTO order_items(id,order_id,product_id,product_name_snapshot,sku_snapshot,quantity,
  unit_price_in_minor_units,line_total_in_minor_units,cogs_in_minor_units,created_at)
SELECT pg_temp.e2_id(21,(o.n-1)*3+k),o.id,pg_temp.e2_id(15,1+((o.n-1)*3+k-1)%p.skus),'باكيت الحجم',
  'E2-S-'||LPAD((1+((o.n-1)*3+k-1)%p.skus)::text,5,'0'),1,1000,1000,500,
  pg_temp.e2_at(o.day_n,CASE WHEN o.branch_n=1 THEN 10 ELSE 15 END)
FROM e2_legacy_orders o CROSS JOIN e2_parameters p CROSS JOIN generate_series(1,3)k;
INSERT INTO customer_payments(id,payment_number,customer_id,order_id,amount_in_minor_units,payment_method,
  reference_number,cash_shift_id,created_by,created_at)
SELECT pg_temp.e2_id(22,payment_n),'E2-PAY-'||payment_n,customer_order.customer_id,o.id,500,CASE WHEN payment_n%2=0 THEN 'cliq' ELSE 'cash' END,
  CASE WHEN payment_n%2=0 THEN 'E2-CLIQ-'||payment_n END,customer_order.cash_shift_id,pg_temp.e2_id(1,1),
  customer_order.created_at+interval '30 minutes'+(payment_n/(p.payments/4))*interval '1 minute'
FROM e2_parameters p CROSS JOIN generate_series(1,p.payments)payment_seq(payment_n)
JOIN e2_legacy_orders o ON o.n=p.orders-p.modern-p.payments/4+1+(payment_n-1)%(p.payments/4)
JOIN orders customer_order ON customer_order.id=o.id;
INSERT INTO sales_returns(id,return_number,order_id,branch_id,warehouse_id,cash_shift_id,stock_disposition,reason,
  refund_method,refund_amount_in_minor_units,reference_number,created_by,created_at)
SELECT pg_temp.e2_id(23,o.n),'E2-OLD-RETURN-'||o.n,o.id,customer_order.branch_id,pg_temp.e2_id(11,2),customer_order.cash_shift_id,
  'restock','بيانات تاريخية مصنّعة للحجم',customer_order.payment_method,3000,
  CASE WHEN customer_order.payment_method='cliq' THEN 'E2-REFUND-'||n END,pg_temp.e2_id(1,1),customer_order.created_at+interval '1 hour'
FROM e2_legacy_orders o JOIN orders customer_order ON customer_order.id=o.id WHERE o.returned;

INSERT INTO supplier_receipts(id,receipt_number,supplier_id,warehouse_id,branch_id,received_at,received_by,
  subtotal_in_minor_units,total_in_minor_units,amount_due_in_minor_units,status,payment_status,created_at)
SELECT pg_temp.e2_id(24,n),'E2-RECEIPT-'||n,pg_temp.e2_id(12,1+(n-1)%p.suppliers),pg_temp.e2_id(11,2),pg_temp.e2_id(10,2),
  pg_temp.e2_at(FLOOR((n-1)::numeric*(p.days-1)/p.receipts)::integer,9),pg_temp.e2_id(1,1),150000,150000,150000,'completed','unpaid',
  pg_temp.e2_at(FLOOR((n-1)::numeric*(p.days-1)/p.receipts)::integer,9) FROM e2_parameters p,generate_series(1,p.receipts)n;
INSERT INTO supplier_receipt_items(id,supplier_receipt_id,product_id,purchase_unit_id,base_unit_id,
  purchase_unit_name,base_unit_name,package_quantity,units_per_package,total_base_units,
  package_price_in_minor_units,base_unit_cost_in_minor_units,line_total_in_minor_units,created_at)
SELECT pg_temp.e2_id(25,(n-1)*3+k),pg_temp.e2_id(24,n),pg_temp.e2_id(15,1+((n-1)*3+k-1)%p.skus),
  pg_temp.e2_id(2,1),pg_temp.e2_id(2,1),'باكيت','باكيت',100,1,100,500,500,50000,
  pg_temp.e2_at(FLOOR((n-1)::numeric*(p.days-1)/p.receipts)::integer,9)
FROM e2_parameters p,generate_series(1,p.receipts)n,generate_series(1,3)k;
UPDATE suppliers supplier SET current_balance_in_minor_units=totals.amount
FROM (SELECT supplier_id,SUM(total_in_minor_units)::bigint amount FROM supplier_receipts GROUP BY supplier_id) totals
WHERE supplier.id=totals.supplier_id;

CREATE TEMP TABLE e2_moves(product_id uuid,quantity integer,at timestamptz,kind text,reference_type text,reference_id uuid,
  supplier_item_id uuid,identity bigint);
INSERT INTO e2_moves SELECT pg_temp.e2_id(15,n),200,pg_temp.e2_at(0,0),'opening_balance','opening_balance',NULL,NULL,n
FROM e2_parameters p,generate_series(1,p.skus)n;
INSERT INTO e2_moves SELECT product_id,100,created_at,'purchase_receipt','supplier_receipt',supplier_receipt_id,id,
  10000000+ROW_NUMBER()OVER(ORDER BY id) FROM supplier_receipt_items;
INSERT INTO e2_moves SELECT product_id,-1,created_at,'sales_deduction','customer_order',order_id,NULL,
  20000000+ROW_NUMBER()OVER(ORDER BY id) FROM order_items;
INSERT INTO e2_moves SELECT item.product_id,1,returned.created_at,'return_in','sales_return',returned.id,NULL,
  30000000+ROW_NUMBER()OVER(ORDER BY item.id) FROM order_items item JOIN sales_returns returned ON returned.order_id=item.order_id;
-- Neutral historical adjustments add/subtract the same physical unit. They
-- are historical (operation_id NULL), never operational aftercare evidence.
INSERT INTO e2_moves
SELECT pg_temp.e2_id(15,1+(pair-1)%p.skus),CASE WHEN side=0 THEN 1 ELSE -1 END,
  pg_temp.e2_at((pair-1)%(p.days-1),15)+side*interval '1 microsecond',
  CASE WHEN side=0 THEN 'adjustment_add' ELSE 'adjustment_subtract' END,'stock_adjustment',NULL,NULL,
  40000000+pair*2+side
FROM e2_parameters p,generate_series(1,(p.movements-(p.skus+p.receipts*3+(p.orders-p.modern)*3+p.legacy_returns*3+p.modern*5))/2)pair,
  generate_series(0,1)side;
CREATE TEMP TABLE e2_ordered_moves AS
SELECT *,SUM(quantity)OVER(PARTITION BY product_id ORDER BY at,identity)::integer after_qty FROM e2_moves;
INSERT INTO inventory_movements(warehouse_id,product_id,movement_type,quantity,balance_before,balance_after,
  reference_type,reference_id,supplier_receipt_item_id,created_by,created_at)
SELECT pg_temp.e2_id(11,2),product_id,kind,quantity,after_qty-quantity,after_qty,reference_type,reference_id,supplier_item_id,
  pg_temp.e2_id(1,1),at FROM e2_ordered_moves ORDER BY product_id,at,identity;
INSERT INTO inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity)
SELECT pg_temp.e2_id(11,2),product_id,SUM(quantity)::integer,0 FROM e2_moves GROUP BY product_id;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='run-advanced-monitoring';
DO $$ BEGIN PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.e2_id(1,1),'role','authenticated','aal','aal2')::text,true); END $$;
GRANT SELECT ON e2_parameters TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.e2_id(integer,bigint) TO authenticated;
CREATE TEMP TABLE e2_modern_state(shift_id uuid);
GRANT SELECT,INSERT ON e2_modern_state TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE p record;f integer;ids uuid[];
BEGIN
  SELECT * INTO p FROM e2_parameters;
  FOR f IN 1..p.families LOOP
    SELECT ARRAY_AGG(pg_temp.e2_id(15,n) ORDER BY n) INTO ids FROM generate_series((f-1)*25+1,f*25)n;
    PERFORM public.save_product_parcel_configuration_v1(pg_temp.e2_id(14,f),'configurable_mix',true,5,ids);
  END LOOP;
  PERFORM public.set_configurable_parcel_feature_state_v1('ENABLED');
  INSERT INTO e2_modern_state VALUES((public.open_cash_shift(pg_temp.e2_id(10,2),10000000)->>'id')::uuid);
END;
$$;
RESET ROLE;
COMMIT;

-- E2_BATCH_BEGIN
DO $$
DECLARE p record;i integer;line jsonb;sale jsonb;replacement jsonb;returned jsonb;context jsonb;root uuid;leaf uuid;pid uuid;
BEGIN
  SELECT * INTO p FROM e2_parameters;
  FOR i IN __E2_FROM__..__E2_TO__ LOOP
    SELECT jsonb_agg(jsonb_build_object('commercial_line_kind','base_unit','product_id',pg_temp.e2_id(15,1+(i+k-2)%p.skus),
      'base_quantity',4,'price_authority','server_catalog','line_discount_in_minor_units',0) ORDER BY k) INTO line FROM generate_series(1,3)k;
    sale:=public.create_pos_sale_v2(pg_temp.e2_id(11,2),pg_temp.e2_id(10,2),pg_temp.e2_id(13,1+(i-1)%p.customers),
      'حجم حديث',CASE WHEN i%2=0 THEN 'cliq' ELSE 'cash' END,line,0,12000,pg_temp.e2_id(30,i)::text);
    IF sale->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'E2_POS_FAILED %',i; END IF;
    pid:=pg_temp.e2_id(15,1+(i-1)%p.skus);
    SELECT (item->>'id')::uuid INTO STRICT root FROM jsonb_array_elements(sale->'items') item WHERE item->>'productId'=pid::text;
    replacement:=public.settle_sales_replacement_v1((sale->>'orderId')::uuid,'e2-replacement-'||i,
      jsonb_build_array(jsonb_build_object('sourceKind','base_order_item','sourceId',root,'quantity',1)),'حجم حديث',NULL);
    IF replacement->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'E2_REPLACEMENT_FAILED %',i; END IF;
    context:=public.get_admin_sales_aftercare_context_v1((sale->>'orderId')::uuid);
    SELECT (item->>'replacementItemId')::uuid INTO STRICT leaf FROM jsonb_array_elements(context->'replacements') event
      CROSS JOIN LATERAL jsonb_array_elements(event->'items') item WHERE event->>'replacementId'=replacement->>'replacementId';
    returned:=public.settle_admin_sales_return_v1((sale->>'orderId')::uuid,'e2-return-'||i,
      jsonb_build_array(jsonb_build_object('return_scope','base_unit','order_item_id',root,'quantity',1,'stock_disposition','restock')),
      jsonb_build_array(jsonb_build_object('root_source_kind','base_order_item','root_source_id',root,
        'source_kind','replacement_item','source_id',leaf,'product_id',pid,'quantity',1,
        'sellable_restock_quantity',1,'defect_non_sellable_quantity',0,'customer_damage_quantity',0)),'حجم حديث','cash',NULL,NULL);
    IF returned->>'success' IS DISTINCT FROM 'true' OR (returned->>'moneyRefundInMinorUnits')::bigint<>1000
      THEN RAISE EXCEPTION 'E2_RETURN_FAILED %',i; END IF;
    IF i%100=0 THEN RAISE NOTICE 'E2_PROGRESS modern_operations=%',i; END IF;
  END LOOP;
END;
$$;
-- E2_BATCH_END

BEGIN;
DO $$ BEGIN PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.e2_id(1,1),'role','authenticated','aal','aal2')::text,true); END $$;
SET LOCAL ROLE authenticated;
DO $$DECLARE p record;shift uuid;BEGIN
  SELECT * INTO p FROM e2_parameters;
  SELECT shift_id INTO STRICT shift FROM e2_modern_state;
  PERFORM public.close_cash_shift(shift,10000000+p.modern/2*12000-p.modern*1000,NULL);
END;$$;
RESET ROLE;
COMMIT;
ANALYZE;
