-- QUARANTINED PHASE-1 EXPERIMENT. Not a migration, deployment or owner tool.
-- Applied only by run-sales-only-phase1.mjs to its owned, networkless DB219.
DO $$ BEGIN
 IF current_setting('nawasrah.sales_lite1_test',true) IS DISTINCT FROM 'OWNED_LOCAL_DB219' THEN
  RAISE EXCEPTION 'LITE1_ISOLATED_RUNNER_REQUIRED';
 END IF;
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>180 OR (SELECT max(version::INTEGER) FROM supabase_migrations.schema_migrations)<>219 THEN RAISE EXCEPTION 'LITE1_EXACT_219_REQUIRED';END IF;
END $$;

CREATE SCHEMA sales_lite1;
REVOKE ALL ON SCHEMA sales_lite1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE sales_lite1.mode(id BOOLEAN PRIMARY KEY DEFAULT true CHECK(id),full_accounting BOOLEAN NOT NULL DEFAULT true);
INSERT INTO sales_lite1.mode VALUES(true,true);
CREATE TABLE sales_lite1.availability(product_id UUID PRIMARY KEY REFERENCES public.products(id),available BOOLEAN NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),changed_by UUID NOT NULL REFERENCES public.profiles(id));
CREATE TABLE sales_lite1.requests(key TEXT PRIMARY KEY CHECK(length(key) BETWEEN 8 AND 128),kind TEXT NOT NULL,fingerprint TEXT NOT NULL,actor UUID,result JSONB);
CREATE TABLE sales_lite1.orders(order_id UUID PRIMARY KEY REFERENCES public.orders(id) DEFERRABLE INITIALLY DEFERRED,operation_id UUID NOT NULL UNIQUE REFERENCES public.business_operations(id),recipient JSONB NOT NULL,unavailable_confirmed UUID[] NOT NULL DEFAULT '{}');
CREATE TABLE sales_lite1.completions(order_id UUID PRIMARY KEY REFERENCES sales_lite1.orders(order_id),completed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
CREATE TABLE sales_lite1.shifts(shift_id UUID PRIMARY KEY REFERENCES public.cash_shifts(id));
CREATE TABLE sales_lite1.returns(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),order_id UUID NOT NULL REFERENCES public.orders(id),item_id UUID NOT NULL REFERENCES public.order_items(id),quantity INTEGER NOT NULL CHECK(quantity>0),entitlement BIGINT NOT NULL CHECK(entitlement>0),debt_reduction BIGINT NOT NULL CHECK(debt_reduction>=0),money_refund BIGINT NOT NULL CHECK(money_refund>=0),method TEXT NOT NULL CHECK(method IN('cash','cliq')),shift_id UUID NOT NULL REFERENCES public.cash_shifts(id),key TEXT NOT NULL UNIQUE REFERENCES sales_lite1.requests(key),created_by UUID NOT NULL REFERENCES public.profiles(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),CHECK(entitlement=debt_reduction+money_refund));
DO $$ DECLARE t TEXT;BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='sales_lite1' LOOP
  EXECUTE format('ALTER TABLE sales_lite1.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE sales_lite1.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;

CREATE FUNCTION sales_lite1.enabled() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT NOT full_accounting FROM sales_lite1.mode WHERE id $$;
CREATE FUNCTION sales_lite1.lock_mode() RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 PERFORM 1 FROM sales_lite1.mode WHERE id FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'LITE1_MODE_MISSING';END IF;
END $$;
CREATE FUNCTION sales_lite1.is_order(p_order UUID) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM sales_lite1.orders l JOIN public.orders o ON o.id=l.order_id AND o.operation_id=l.operation_id JOIN public.business_operations b ON b.id=l.operation_id WHERE l.order_id=p_order AND b.operation_type IN('lite1_pos','lite1_guest'));
$$;
CREATE FUNCTION sales_lite1.available(p_product UUID) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p.is_active AND COALESCE(a.available,true) AND COALESCE(f.is_active,true) AND COALESCE(fa.available,true)
 FROM public.products p LEFT JOIN sales_lite1.availability a ON a.product_id=p.id
 LEFT JOIN public.products f ON f.id=p.flavor_master_product_id LEFT JOIN sales_lite1.availability fa ON fa.product_id=f.id WHERE p.id=p_product;
$$;
CREATE FUNCTION sales_lite1.owner() RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 PERFORM public.assert_erp_role(ARRAY['owner'],'نموذج البيع دون تتبع المخزون');
END $$;
CREATE FUNCTION sales_lite1.lock_request(p_key TEXT,p_kind TEXT,p_request JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE h TEXT; r sales_lite1.requests; BEGIN
 IF p_key IS NULL OR length(p_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'LITE1_KEY_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_key,0));
 h:=encode(extensions.digest(convert_to(p_request::TEXT,'UTF8'),'sha256'),'hex');
 SELECT * INTO r FROM sales_lite1.requests WHERE key=p_key;
 IF FOUND THEN
  IF r.kind<>p_kind OR r.fingerprint<>h OR r.actor IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'LITE1_IDEMPOTENCY_CONFLICT';END IF;
  IF r.result IS NULL THEN RAISE EXCEPTION 'LITE1_INCOMPLETE_REQUEST';END IF;
  RETURN r.result;
 END IF;
 IF EXISTS(SELECT 1 FROM public.business_operations WHERE idempotency_key=p_key) OR EXISTS(SELECT 1 FROM public.orders WHERE idempotency_key=p_key) THEN RAISE EXCEPTION 'LITE1_IDEMPOTENCY_CONFLICT';END IF;
 -- Same mode row lock for every lite mutation; changing mode serializes with it.
 PERFORM 1 FROM sales_lite1.mode WHERE id AND NOT full_accounting FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LITE1_MODE_DISABLED';END IF;
 INSERT INTO sales_lite1.requests VALUES(p_key,p_kind,h,auth.uid(),NULL);
 RETURN NULL;
END $$;
CREATE FUNCTION sales_lite1.finish(p_key TEXT,p_result JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 UPDATE sales_lite1.requests SET result=p_result WHERE key=p_key AND result IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'LITE1_REQUEST_NOT_OPEN';END IF;RETURN p_result;
END $$;
CREATE FUNCTION sales_lite1.immutable() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'LITE1_IMMUTABLE_EVIDENCE';END $$;
CREATE FUNCTION sales_lite1.seal_request() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'LITE1_IMMUTABLE_EVIDENCE';END IF;
 IF OLD.result IS NOT NULL OR NEW.result IS NULL OR (to_jsonb(OLD)-'result') IS DISTINCT FROM(to_jsonb(NEW)-'result') THEN RAISE EXCEPTION 'LITE1_IMMUTABLE_EVIDENCE';END IF;RETURN NEW;
END $$;
DO $$ DECLARE t TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['orders','shifts','returns','completions'] LOOP
  EXECUTE format('CREATE TRIGGER lite1_immutable BEFORE UPDATE OR DELETE ON sales_lite1.%I FOR EACH ROW EXECUTE FUNCTION sales_lite1.immutable()',t);
  EXECUTE format('CREATE TRIGGER lite1_no_truncate BEFORE TRUNCATE ON sales_lite1.%I FOR EACH STATEMENT EXECUTE FUNCTION sales_lite1.immutable()',t);
 END LOOP;
END $$;
CREATE TRIGGER lite1_seal BEFORE UPDATE OR DELETE ON sales_lite1.requests FOR EACH ROW EXECUTE FUNCTION sales_lite1.seal_request();
CREATE TRIGGER lite1_no_truncate BEFORE TRUNCATE ON sales_lite1.requests FOR EACH STATEMENT EXECUTE FUNCTION sales_lite1.immutable();

CREATE FUNCTION public.lite1_set_mode(p_full BOOLEAN) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 PERFORM sales_lite1.owner();
 BEGIN PERFORM 1 FROM sales_lite1.mode WHERE id FOR UPDATE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'LITE1_MODE_BUSY';END;
 IF p_full IS NULL THEN RAISE EXCEPTION 'LITE1_MODE_INVALID';END IF;
 IF EXISTS(SELECT 1 FROM public.cash_shifts WHERE status='open') OR EXISTS(SELECT 1 FROM public.orders WHERE status NOT IN('completed','cancelled','expired','returned')) THEN RAISE EXCEPTION 'LITE1_MODE_REQUIRES_QUIESCENCE';END IF;
 -- Activation is NOT implemented by this prototype. An opening epoch needs phase2.
 IF p_full AND sales_lite1.enabled() THEN RAISE EXCEPTION 'LITE1_ACTIVATION_REQUIRES_PHASE2';END IF;
 UPDATE sales_lite1.mode SET full_accounting=p_full WHERE id;
 INSERT INTO public.audit_logs(user_id,action,entity_name,details) VALUES(auth.uid(),'LITE1_MODE','prototype',jsonb_build_object('fullAccounting',p_full));
 RETURN jsonb_build_object('fullAccounting',p_full);
END $$;
CREATE FUNCTION public.lite1_set_available(p_product UUID,p_available BOOLEAN,p_revision INTEGER) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rev INTEGER;BEGIN
 PERFORM sales_lite1.owner();PERFORM 1 FROM sales_lite1.mode WHERE id FOR SHARE;
 PERFORM 1 FROM public.products WHERE id=p_product FOR UPDATE;IF NOT FOUND OR p_available IS NULL THEN RAISE EXCEPTION 'LITE1_PRODUCT_INVALID';END IF;
 SELECT revision INTO rev FROM sales_lite1.availability WHERE product_id=p_product;
 IF COALESCE(rev,0) IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'LITE1_AVAILABILITY_STALE';END IF;
 INSERT INTO sales_lite1.availability VALUES(p_product,p_available,COALESCE(rev,0)+1,auth.uid()) ON CONFLICT(product_id) DO UPDATE SET available=EXCLUDED.available,revision=EXCLUDED.revision,changed_by=EXCLUDED.changed_by;
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details) VALUES(auth.uid(),'LITE1_AVAILABILITY','products',p_product,jsonb_build_object('available',p_available,'revision',COALESCE(rev,0)+1));
 RETURN jsonb_build_object('available',p_available,'revision',COALESCE(rev,0)+1);
END $$;

-- New admission triggers, not changes to any frozen writer. The order context is
-- private and is inserted before the order, with a deferred foreign key.
CREATE FUNCTION sales_lite1.guard_order() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 PERFORM sales_lite1.lock_mode();
 IF sales_lite1.enabled() AND NOT EXISTS(SELECT 1 FROM sales_lite1.orders l JOIN public.business_operations b ON b.id=l.operation_id WHERE l.order_id=NEW.id AND l.operation_id=NEW.operation_id AND b.operation_type IN('lite1_pos','lite1_guest')) THEN RAISE EXCEPTION 'LITE1_FROZEN_WRITER_DISABLED';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lite1_mode_admission BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION sales_lite1.guard_order();
CREATE FUNCTION sales_lite1.guard_inventory() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 PERFORM sales_lite1.lock_mode();
 IF sales_lite1.enabled() THEN
  IF TG_TABLE_NAME='inventory_balances' THEN
   IF TG_OP='INSERT' AND NEW.on_hand_quantity=0 AND NEW.reserved_quantity=0 THEN RETURN NEW;END IF;
   IF TG_OP='UPDATE' AND NEW.on_hand_quantity=OLD.on_hand_quantity AND NEW.reserved_quantity=OLD.reserved_quantity THEN RETURN NEW;END IF;
  END IF;
  RAISE EXCEPTION 'LITE1_INVENTORY_DISABLED';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
CREATE TRIGGER lite1_no_inventory BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION sales_lite1.guard_inventory();
CREATE TRIGGER lite1_no_reservations BEFORE INSERT OR UPDATE OR DELETE ON public.order_inventory_reservations FOR EACH ROW EXECUTE FUNCTION sales_lite1.guard_inventory();
CREATE TRIGGER lite1_no_balance_changes BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_balances FOR EACH ROW EXECUTE FUNCTION sales_lite1.guard_inventory();
CREATE FUNCTION sales_lite1.guard_cost() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 PERFORM sales_lite1.lock_mode();
 IF sales_lite1.enabled() AND (NEW.cost_price_in_minor_units IS DISTINCT FROM OLD.cost_price_in_minor_units OR NEW.wac_cost_in_minor_units_exact IS DISTINCT FROM OLD.wac_cost_in_minor_units_exact) THEN RAISE EXCEPTION 'LITE1_COST_DISABLED';END IF;RETURN NEW;
END $$;
CREATE TRIGGER lite1_no_cost_changes BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION sales_lite1.guard_cost();
CREATE FUNCTION sales_lite1.mark_shift() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 PERFORM sales_lite1.lock_mode();
 IF sales_lite1.enabled() THEN INSERT INTO sales_lite1.shifts VALUES(NEW.id);END IF;RETURN NEW;
END $$;
CREATE TRIGGER lite1_mark_shift AFTER INSERT ON public.cash_shifts FOR EACH ROW EXECUTE FUNCTION sales_lite1.mark_shift();

-- Phase1 deliberately supports base units/flavors only. No invented parcel,
-- discount, delivery fee or credit policy: the missing parallel planners are
-- explicit phase2 work, and unsupported input fails closed.
CREATE FUNCTION sales_lite1.sale(p_request JSONB,p_key TEXT,p_guest BOOLEAN) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result JSONB; line JSONB; p public.products; customer public.customers;settings public.storefront_settings; c UUID; oid UUID:=gen_random_uuid();op UUID:=gen_random_uuid();bid UUID;wid UUID;sid UUID;method TEXT;initial TEXT;paid BIGINT;total BIGINT:=0;qty INTEGER;price BIGINT;unavailable UUID[]:='{}';v_phone TEXT;amount BIGINT;plan JSONB:='[]';name TEXT;BEGIN
 IF p_guest THEN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'LITE1_GATEWAY_ONLY';END IF;
 ELSE PERFORM sales_lite1.owner();END IF;
 result:=sales_lite1.lock_request(p_key,CASE WHEN p_guest THEN 'guest' ELSE 'pos' END,p_request);IF result IS NOT NULL THEN RETURN result;END IF;
 IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR octet_length(p_request::TEXT)>32768 OR (p_request-ARRAY['branchId','warehouseId','customerId','lines','method','paid','initialMethod','unavailableConfirmed','recipient'])<>'{}'::JSONB THEN RAISE EXCEPTION 'LITE1_REQUEST_INVALID';END IF;
 bid:=(p_request->>'branchId')::UUID;wid:=(p_request->>'warehouseId')::UUID;
 IF NOT EXISTS(SELECT 1 FROM public.branches WHERE id=bid AND is_active) OR NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=wid AND branch_id=bid AND is_active) THEN RAISE EXCEPTION 'LITE1_BRANCH_INVALID';END IF;
 IF jsonb_typeof(p_request->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_request->'lines') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'LITE1_LINES_INVALID';END IF;
 -- Product/parent locks serialize availability changes with the entire sale.
 PERFORM 1 FROM public.products WHERE id IN(SELECT (l->>'productId')::UUID FROM jsonb_array_elements(p_request->'lines') l UNION SELECT flavor_master_product_id FROM public.products WHERE id IN(SELECT (l->>'productId')::UUID FROM jsonb_array_elements(p_request->'lines') l)) ORDER BY id FOR UPDATE;
 IF p_guest THEN
  SELECT * INTO settings FROM public.storefront_settings WHERE orders_enabled FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'LITE1_STORE_CLOSED';END IF;
  IF settings.inside_ramtha_delivery_fee_in_minor_units<>0 OR settings.outside_ramtha_delivery_fee_in_minor_units<>0 THEN RAISE EXCEPTION 'LITE1_PAID_DELIVERY_REQUIRES_PHASE2';END IF;
  IF p_request ? 'customerId' OR COALESCE(p_request->>'method','cash')<>'cash' OR p_request ? 'paid' OR p_request ? 'initialMethod' OR p_request ? 'unavailableConfirmed' THEN RAISE EXCEPTION 'LITE1_GUEST_INPUT_INVALID';END IF;
  name:=btrim(p_request#>>'{recipient,name}');v_phone:=public.normalize_customer_phone(p_request#>>'{recipient,phone}');
  IF name IS NULL OR length(name) NOT BETWEEN 2 AND 120 OR v_phone IS NULL OR v_phone!~'^[0-9]{9,15}$' OR length(btrim(COALESCE(p_request#>>'{recipient,address}',''))) NOT BETWEEN 2 AND 500 THEN RAISE EXCEPTION 'LITE1_RECIPIENT_INVALID';END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_phone)::BIGINT);
  -- Qualified comparison is intentional: never overwrite an existing card.
  SELECT * INTO customer FROM public.customers x WHERE public.normalize_customer_phone(x.phone)=v_phone AND NOT x.is_deleted ORDER BY id LIMIT 1 FOR UPDATE;
  IF FOUND THEN IF customer.is_blocked OR NOT customer.is_active THEN RAISE EXCEPTION 'LITE1_CUSTOMER_BLOCKED';END IF;c:=customer.id;
  ELSE INSERT INTO public.customers(full_name,phone) VALUES(name,v_phone) RETURNING id INTO c;END IF;
  method:='cash_on_delivery';paid:=0;
 ELSE
  c:=NULLIF(p_request->>'customerId','')::UUID;method:=p_request->>'method';paid:=COALESCE((p_request->>'paid')::BIGINT,0);initial:=p_request->>'initialMethod';
  SELECT id INTO sid FROM public.cash_shifts WHERE branch_id=bid AND status='open' FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'LITE1_SHIFT_REQUIRED';END IF;
  IF c IS NOT NULL THEN SELECT * INTO customer FROM public.customers WHERE id=c AND is_active AND NOT is_deleted AND NOT is_blocked FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'LITE1_CUSTOMER_INVALID';END IF;name:=customer.full_name;END IF;
  IF method IS NULL OR method NOT IN('cash','cliq','debt','partial') THEN RAISE EXCEPTION 'LITE1_METHOD_INVALID';END IF;
 END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(p_request->'lines') LOOP
  IF (line-ARRAY['productId','quantity'])<>'{}'::JSONB OR COALESCE(line->>'quantity','')!~'^[1-9][0-9]{0,3}$' THEN RAISE EXCEPTION 'LITE1_LINE_INVALID';END IF;
  SELECT * INTO p FROM public.products WHERE id=(line->>'productId')::UUID;
  IF NOT FOUND OR NOT p.is_active OR p.is_flavor_master OR p.parcel_only THEN RAISE EXCEPTION 'LITE1_UNSUPPORTED_PRODUCT';END IF;
  IF EXISTS(SELECT 1 FROM public.products f WHERE f.id=p.flavor_master_product_id AND NOT f.is_active) THEN RAISE EXCEPTION 'LITE1_INACTIVE_PARENT';END IF;
  IF NOT sales_lite1.available(p.id) THEN
   IF p_guest OR NOT COALESCE(p_request->'unavailableConfirmed' @> to_jsonb(ARRAY[p.id]),false) THEN RAISE EXCEPTION 'LITE1_UNAVAILABLE_CONFIRM_REQUIRED';END IF;
   unavailable:=array_append(unavailable,p.id);
  END IF;
  qty:=(line->>'quantity')::INTEGER;price:=p.sale_price_in_minor_units;
  IF price IS NULL OR price<=0 THEN RAISE EXCEPTION 'LITE1_PRICE_REQUIRED';END IF;
  amount:=qty::BIGINT*price;total:=total+amount;
  IF total>1000000000 THEN RAISE EXCEPTION 'LITE1_TOTAL_LIMIT';END IF;
  plan:=plan||jsonb_build_object('id',p.id,'name',p.name_ar,'sku',p.sku,'qty',qty,'price',price,'amount',amount);
 END LOOP;
 IF p_guest AND total<settings.minimum_order_in_minor_units THEN RAISE EXCEPTION 'LITE1_MINIMUM_ORDER';END IF;
 IF NOT p_guest THEN
  IF method IN('debt','partial') AND c IS NULL THEN RAISE EXCEPTION 'LITE1_DEBT_CUSTOMER_REQUIRED';END IF;
  IF method='partial' AND (paid<=0 OR paid>=total OR initial IS NULL OR initial NOT IN('cash','cliq')) THEN RAISE EXCEPTION 'LITE1_PARTIAL_INVALID';END IF;
  IF method<>'partial' AND paid<>0 THEN RAISE EXCEPTION 'LITE1_UNEXPECTED_PAID';END IF;
 END IF;
 result:=jsonb_build_object('success',true,'orderId',oid,'operationId',op,'totalInMinorUnits',total,'amountPaidInMinorUnits',CASE WHEN method IN('cash','cliq') THEN total ELSE paid END,'unavailableConfirmed',to_jsonb(unavailable),'accountingTracked',false);
 INSERT INTO public.business_operations(id,operation_type,idempotency_key,request_fingerprint,initiated_by,result_snapshot,completed_at) VALUES(op,CASE WHEN p_guest THEN 'lite1_guest' ELSE 'lite1_pos' END,p_key,(SELECT r.fingerprint FROM sales_lite1.requests r WHERE r.key=p_key),auth.uid(),result,now());
 INSERT INTO sales_lite1.orders VALUES(oid,op,COALESCE(p_request->'recipient','{}'),unavailable);
 INSERT INTO public.orders(id,order_number,customer_id,customer_name_snapshot,branch_id,warehouse_id,status,payment_method,payment_status,subtotal_in_minor_units,total_in_minor_units,amount_paid_in_minor_units,source,idempotency_key,operation_id,cash_shift_id)
 VALUES(oid,'L1-'||oid::TEXT,c,name,bid,wid,CASE WHEN p_guest THEN 'new' ELSE 'completed' END,CASE WHEN method='partial' THEN 'debt' ELSE method END,'unpaid',total,total,0,CASE WHEN p_guest THEN 'website' ELSE 'pos' END,p_key,op,sid);
 IF NOT p_guest THEN INSERT INTO sales_lite1.completions(order_id) VALUES(oid);END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(plan) LOOP
  INSERT INTO public.order_items(order_id,product_id,product_name_snapshot,sku_snapshot,quantity,unit_price_in_minor_units,line_total_in_minor_units,commercial_line_kind,base_unit_name_snapshot,allocated_discount_snapshot_in_minor_units,net_refundable_amount_snapshot_in_minor_units)
  VALUES(oid,(line->>'id')::UUID,line->>'name',line->>'sku',(line->>'qty')::INTEGER,(line->>'price')::BIGINT,(line->>'amount')::BIGINT,'base_unit','باكيت',0,(line->>'amount')::BIGINT);
 END LOOP;
 IF method='partial' THEN PERFORM public.record_customer_order_payment_once(oid,paid,initial,NULL,'دفعة أولى نموذج معزول',p_key||'-initial');END IF;
 RETURN sales_lite1.finish(p_key,result);
END $$;
CREATE FUNCTION public.lite1_pos(p_request JSONB,p_key TEXT) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT sales_lite1.sale(p_request,p_key,false) $$;
CREATE FUNCTION public.lite1_guest(p_request JSONB,p_key TEXT) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT sales_lite1.sale(p_request,p_key,true) $$;

CREATE FUNCTION public.lite1_complete(p_order UUID,p_key TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r JSONB;o public.orders;sid UUID;BEGIN
 PERFORM sales_lite1.owner();r:=sales_lite1.lock_request(p_key,'complete',jsonb_build_object('order',p_order));IF r IS NOT NULL THEN RETURN r;END IF;
 PERFORM public.phase4_lock_customer_order_context_internal(p_order,true,false);
 SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
 IF NOT sales_lite1.is_order(p_order) OR o.source<>'website' OR o.status<>'new' THEN RAISE EXCEPTION 'LITE1_ORDER_STATE';END IF;
 SELECT id INTO sid FROM public.cash_shifts WHERE branch_id=o.branch_id AND status='open' FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'LITE1_SHIFT_REQUIRED';END IF;
 UPDATE public.orders SET status='completed',cash_shift_id=sid,payment_method='cash',payment_confirmed_at=now(),payment_confirmed_by=auth.uid() WHERE id=p_order;
 INSERT INTO sales_lite1.completions(order_id) VALUES(p_order);
 RETURN sales_lite1.finish(p_key,jsonb_build_object('success',true,'orderId',p_order));
END $$;
CREATE FUNCTION sales_lite1.assert_return_window(p_completed TIMESTAMPTZ,p_observed TIMESTAMPTZ) RETURNS VOID LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF p_completed IS NULL OR p_observed IS NULL OR p_observed>p_completed+INTERVAL '48 hours' THEN RAISE EXCEPTION 'PHASE4_RETURN_WINDOW_EXPIRED';END IF;
END $$;
CREATE FUNCTION public.lite1_return(p_item UUID,p_qty INTEGER,p_method TEXT,p_key TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r JSONB;i public.order_items;o public.orders;used INTEGER;ent BIGINT;debt BIGINT;refund BIGINT;pos RECORD;sid UUID;rid UUID;BEGIN
 PERFORM sales_lite1.owner();r:=sales_lite1.lock_request(p_key,'return',jsonb_build_object('item',p_item,'qty',p_qty,'method',p_method));IF r IS NOT NULL THEN RETURN r;END IF;
 SELECT * INTO i FROM public.order_items WHERE id=p_item;IF NOT FOUND THEN RAISE EXCEPTION 'LITE1_ITEM_INVALID';END IF;
 PERFORM public.phase4_lock_customer_order_context_internal(i.order_id,true,false);
 SELECT * INTO o FROM public.orders WHERE id=i.order_id FOR UPDATE;
 IF NOT sales_lite1.is_order(o.id) OR o.status<>'completed' OR p_qty IS NULL OR p_qty<=0 OR p_method IS NULL OR p_method NOT IN('cash','cliq') THEN RAISE EXCEPTION 'LITE1_RETURN_INVALID';END IF;
 PERFORM sales_lite1.assert_return_window((SELECT completed_at FROM sales_lite1.completions WHERE order_id=o.id),clock_timestamp());
 SELECT id INTO sid FROM public.cash_shifts WHERE branch_id=o.branch_id AND status='open' FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'LITE1_SHIFT_REQUIRED';END IF;
 SELECT COALESCE(sum(quantity),0) INTO used FROM sales_lite1.returns WHERE item_id=p_item;
 IF p_qty>i.quantity-used THEN RAISE EXCEPTION 'LITE1_RETURN_EXCESS';END IF;
 ent:=p_qty::BIGINT*i.unit_price_in_minor_units;
 SELECT * INTO pos FROM public.phase42_order_financial_position_internal(o.id);
 debt:=LEAST(ent,pos.merchandise_debt_in_minor_units);refund:=ent-debt;
 IF refund>pos.refundable_collected_in_minor_units THEN RAISE EXCEPTION 'LITE1_REFUND_EXCESS';END IF;
 INSERT INTO sales_lite1.returns(order_id,item_id,quantity,entitlement,debt_reduction,money_refund,method,shift_id,key,created_by) VALUES(o.id,p_item,p_qty,ent,debt,refund,p_method,sid,p_key,auth.uid()) RETURNING id INTO rid;
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details) VALUES(auth.uid(),'LITE1_RETURN','orders',o.id,jsonb_build_object('returnId',rid,'quantity',p_qty,'entitlement',ent,'debtReduction',debt,'refund',refund,'method',p_method));
 RETURN sales_lite1.finish(p_key,jsonb_build_object('success',true,'returnId',rid,'entitlement',ent,'debtReduction',debt,'refund',refund));
END $$;
CREATE FUNCTION public.lite1_expense(p_branch UUID,p_amount BIGINT,p_category TEXT,p_description TEXT,p_key TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r JSONB;BEGIN
 PERFORM sales_lite1.owner();r:=sales_lite1.lock_request(p_key,'expense',jsonb_build_object('branch',p_branch,'amount',p_amount,'category',p_category,'description',p_description));IF r IS NOT NULL THEN RETURN r;END IF;
 RETURN sales_lite1.finish(p_key,public.create_operational_expense(p_branch,p_category,p_description,p_amount,'cash',NULL));
END $$;

-- A separate, cost-free closing document feeds the EXISTING immutable close
-- snapshot. Full-mode documents take the untouched original branch instead.
CREATE FUNCTION sales_lite1.closing_report(p_shift UUID) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.cash_shifts;v JSONB;net BIGINT;BEGIN
 SELECT * INTO STRICT s FROM public.cash_shifts WHERE id=p_shift;
 v:=public.get_cash_shift_summary(p_shift);
 -- Same reconciliation meaning as044: both payment channels, BEFORE owner
 -- withdrawals. close_cash_shift194 appends the withdrawal-adjusted figure.
 net:=(v->>'cashSalesInMinorUnits')::BIGINT+(v->>'cliqSalesInMinorUnits')::BIGINT+(v->>'cardSalesInMinorUnits')::BIGINT+(v->>'cashReceiptsInMinorUnits')::BIGINT+(v->>'cliqReceiptsInMinorUnits')::BIGINT
 -(v->>'cashSupplierPaymentsInMinorUnits')::BIGINT-(v->>'cliqSupplierPaymentsInMinorUnits')::BIGINT-(v->>'cashExpensesInMinorUnits')::BIGINT-(v->>'cliqExpensesInMinorUnits')::BIGINT-(v->>'cashRefundsInMinorUnits')::BIGINT-(v->>'cliqRefundsInMinorUnits')::BIGINT;
 RETURN jsonb_build_object('success',true,'accountingTracked',false,'shiftId',s.id,'summary',v,'reconciliation',jsonb_build_object('expectedCashInMinorUnits',s.expected_cash_in_minor_units,'actualCashInMinorUnits',s.actual_cash_in_minor_units,'cashDiscrepancyInMinorUnits',s.cash_discrepancy_in_minor_units,'netMovementInMinorUnits',net),'sales',COALESCE((SELECT jsonb_agg(jsonb_build_object('orderId',o.id,'totalInMinorUnits',o.total_in_minor_units,'collectedInMinorUnits',o.amount_paid_in_minor_units) ORDER BY o.id) FROM public.orders o WHERE o.cash_shift_id=s.id),'[]'::JSONB),'returns',COALESCE((SELECT sum(entitlement) FROM sales_lite1.returns WHERE shift_id=s.id),0),'cashExpensesInMinorUnits',s.cash_expenses_in_minor_units);
END
$$;
CREATE FUNCTION sales_lite1.adjust_shift(p_summary JSONB,p_shift UUID) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE cash BIGINT;cliq BIGINT;BEGIN
 SELECT COALESCE(sum(money_refund) FILTER(WHERE method='cash'),0),COALESCE(sum(money_refund) FILTER(WHERE method='cliq'),0) INTO cash,cliq FROM sales_lite1.returns WHERE shift_id=p_shift;
 IF cash=0 AND cliq=0 THEN RETURN p_summary;END IF;
 RETURN p_summary||jsonb_build_object('cashRefundsInMinorUnits',(p_summary->>'cashRefundsInMinorUnits')::BIGINT+cash,'cliqRefundsInMinorUnits',(p_summary->>'cliqRefundsInMinorUnits')::BIGINT+cliq,'expectedCashInMinorUnits',(p_summary->>'expectedCashInMinorUnits')::BIGINT-cash);
END $$;
CREATE FUNCTION sales_lite1.integrity_count() RETURNS BIGINT LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT (SELECT count(*) FROM sales_lite1.orders l JOIN public.orders o ON o.id=l.order_id WHERE NOT sales_lite1.is_order(o.id) OR o.cost_finalized_at IS NOT NULL)
 +(SELECT count(*) FROM sales_lite1.orders l JOIN public.orders o ON o.id=l.order_id WHERE o.status='completed' AND NOT EXISTS(SELECT 1 FROM sales_lite1.completions c WHERE c.order_id=o.id))
 +(SELECT count(*) FROM public.inventory_movements m JOIN sales_lite1.orders l ON l.order_id=m.reference_id)
 +(SELECT count(*) FROM public.order_inventory_reservations r JOIN sales_lite1.orders l ON l.order_id=r.order_id)
 +(SELECT count(*) FROM public.order_items i JOIN sales_lite1.orders l ON l.order_id=i.order_id WHERE i.unit_cost_in_minor_units<>0 OR i.cogs_in_minor_units<>0 OR i.profit_in_minor_units<>0 OR i.cost_finalized_at IS NOT NULL OR i.exact_cogs_snapshot_in_minor_units IS NOT NULL OR i.unit_cost_snapshot_in_minor_units_exact IS NOT NULL)
 +(SELECT count(*) FROM sales_lite1.returns r JOIN public.order_items i ON i.id=r.item_id WHERE i.order_id<>r.order_id OR NOT sales_lite1.is_order(r.order_id))
 +(SELECT count(*) FROM (SELECT item_id,sum(quantity) q,sum(entitlement) e FROM sales_lite1.returns GROUP BY item_id) r JOIN public.order_items i ON i.id=r.item_id WHERE r.q>i.quantity OR r.e>i.net_refundable_amount_snapshot_in_minor_units);
$$;

-- No default-executable definer helpers, including newly added public RPCs.
DO $$ DECLARE f RECORD;BEGIN
 FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sales_lite1' OR(n.nspname='public' AND p.proname LIKE 'lite1\_%' ESCAPE '\') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.lite1_set_mode(BOOLEAN),public.lite1_set_available(UUID,BOOLEAN,INTEGER),public.lite1_pos(JSONB,TEXT),public.lite1_complete(UUID,TEXT),public.lite1_return(UUID,INTEGER,TEXT,TEXT),public.lite1_expense(UUID,BIGINT,TEXT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lite1_guest(JSONB,TEXT) TO service_role;
