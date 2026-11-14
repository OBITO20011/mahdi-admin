-- Owner14Nov2026, approved4-6day package. Work-in-progress LOCAL prototype.
-- Not an operational migration yet: lifecycle hooks, alerts and tooling pending.
-- Reserved final number223;221 remains reserved. Never apply to owner demo/hosted here.
BEGIN;
DO $history223$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>182
 OR (SELECT max(version::INTEGER) FROM supabase_migrations.schema_migrations)<>222
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='221') THEN
  RAISE EXCEPTION 'QUANTITY223_EXACT222_REQUIRED';
 END IF;
END $history223$;

CREATE SCHEMA sales_lite3 AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA sales_lite3 FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE sales_lite3.quantity_counters(
 product_id UUID PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
 unit_id UUID NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT false,
 quantity BIGINT NOT NULL CHECK(quantity>=0),
 low_threshold BIGINT NOT NULL CHECK(low_threshold>=0),
 revision BIGINT NOT NULL CHECK(revision>0),
 ever_enabled BOOLEAN NOT NULL DEFAULT false,
 low_sent BOOLEAN NOT NULL DEFAULT false,
 zero_sent BOOLEAN NOT NULL DEFAULT false,
 updated_by UUID REFERENCES public.profiles(id),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE sales_lite3.quantity_events(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id UUID NOT NULL,
 sku_snapshot TEXT NOT NULL,
 name_snapshot TEXT NOT NULL,
 unit_id UUID NOT NULL,
 unit_name_snapshot TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('manual','sale','cancel','return')),
 source_type TEXT NOT NULL CHECK(length(source_type) BETWEEN 2 AND 50),
 source_id UUID NOT NULL,
 order_id UUID REFERENCES public.orders(id) DEFERRABLE INITIALLY DEFERRED,
 quantity_before BIGINT NOT NULL CHECK(quantity_before>=0),
 quantity_after BIGINT NOT NULL CHECK(quantity_after>=0),
 requested_quantity BIGINT NOT NULL CHECK(requested_quantity>=0),
 applied_quantity BIGINT NOT NULL CHECK(applied_quantity>=0),
 shortage_quantity BIGINT NOT NULL CHECK(shortage_quantity>=0),
 revision_before BIGINT NOT NULL CHECK(revision_before>=0),
 revision_after BIGINT NOT NULL CHECK(revision_after=revision_before+1),
 configuration_before JSONB NOT NULL CHECK(jsonb_typeof(configuration_before)='object'),
 configuration_after JSONB NOT NULL CHECK(jsonb_typeof(configuration_after)='object'),
 created_by UUID REFERENCES public.profiles(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(kind,source_type,source_id,product_id)
);
CREATE INDEX quantity_events_order223 ON sales_lite3.quantity_events(order_id,product_id) WHERE order_id IS NOT NULL;
CREATE INDEX quantity_events_product223 ON sales_lite3.quantity_events(product_id,created_at,id);
CREATE TABLE sales_lite3.quantity_requests(
 key UUID PRIMARY KEY,
 actor_id UUID NOT NULL REFERENCES public.profiles(id),
 fingerprint TEXT NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),
 result JSONB NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE sales_lite3.quantity_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_lite3.quantity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_lite3.quantity_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA sales_lite3 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION sales_lite3.immutable223() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 RAISE EXCEPTION 'QUANTITY223_IMMUTABLE_EVIDENCE';
END $$;
CREATE TRIGGER quantity_events_immutable223 BEFORE UPDATE OR DELETE ON sales_lite3.quantity_events FOR EACH ROW EXECUTE FUNCTION sales_lite3.immutable223();
CREATE TRIGGER quantity_events_truncate223 BEFORE TRUNCATE ON sales_lite3.quantity_events FOR EACH STATEMENT EXECUTE FUNCTION sales_lite3.immutable223();
CREATE TRIGGER quantity_requests_immutable223 BEFORE UPDATE OR DELETE ON sales_lite3.quantity_requests FOR EACH ROW EXECUTE FUNCTION sales_lite3.immutable223();
CREATE TRIGGER quantity_requests_truncate223 BEFORE TRUNCATE ON sales_lite3.quantity_requests FOR EACH STATEMENT EXECUTE FUNCTION sales_lite3.immutable223();

CREATE FUNCTION sales_lite3.assert_owner223() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='QUANTITY223_OWNER_AAL2_REQUIRED';
 END IF;
 PERFORM public.assert_erp_role(ARRAY['owner'],'إدارة عدّاد الكمية الاختياري');
 IF NOT sales_lite1.enabled() THEN RAISE EXCEPTION 'QUANTITY223_OFF_REQUIRED';END IF;
END $$;

CREATE FUNCTION public.lite3_counter_context223(p_product_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.products;family BOOLEAN;rows JSONB;
BEGIN
 PERFORM sales_lite3.assert_owner223();
 SELECT * INTO p FROM public.products WHERE id=p_product_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'QUANTITY223_PRODUCT_REQUIRED';END IF;
 family:=p.is_flavor_master OR EXISTS(SELECT 1 FROM public.products c WHERE c.flavor_master_product_id=p.id);
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'productId',leaf.id,'name',leaf.name_ar,'flavorName',leaf.flavor_name_ar,'sku',leaf.sku,
  'unitId',leaf.unit_id,'unitName',COALESCE(u.name_ar,'باكيت'),
  'enabled',COALESCE(c.enabled,false),'quantity',COALESCE(c.quantity,0),
  'threshold',COALESCE(c.low_threshold,0),'revision',COALESCE(c.revision,0),
  'everEnabled',COALESCE(c.ever_enabled,false),'active',leaf.is_active,
  'manualAvailable',COALESCE(sales_lite1.available(leaf.id),false),
  'effectiveAvailable',COALESCE(sales_lite1.available(leaf.id),false) AND(NOT COALESCE(c.enabled,false) OR c.quantity>0)
 ) ORDER BY leaf.sku,leaf.id),'[]') INTO rows
 FROM public.products leaf LEFT JOIN public.units u ON u.id=leaf.unit_id
 LEFT JOIN sales_lite3.quantity_counters c ON c.product_id=leaf.id
 WHERE NOT leaf.is_flavor_master AND((NOT family AND leaf.id=p.id) OR(family AND leaf.flavor_master_product_id=p.id));
 IF jsonb_array_length(rows)>200 THEN RAISE EXCEPTION 'QUANTITY223_CONTEXT_LIMIT';END IF;
 RETURN jsonb_build_object('contractVersion','optional-quantity223-v1','fullAccounting',false,'productId',p.id,'isFamily',family,'products',rows);
END $$;

CREATE FUNCTION public.lite3_set_counter223(
 p_product_id UUID,p_enabled BOOLEAN,p_quantity BIGINT,p_low_threshold BIGINT,p_expected_revision BIGINT,p_key UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE p public.products;c sales_lite3.quantity_counters;r sales_lite3.quantity_requests;
 fingerprint TEXT;result JSONB;old_configuration JSONB;new_configuration JSONB;unit_name TEXT;
 old_revision BIGINT;old_quantity BIGINT;next_revision BIGINT;ever_enabled BOOLEAN;low_sent BOOLEAN;zero_sent BOOLEAN;
BEGIN
 PERFORM sales_lite3.assert_owner223();PERFORM sales_lite1.lock_mode();
 IF NOT sales_lite1.enabled() THEN RAISE EXCEPTION 'QUANTITY223_OFF_REQUIRED';END IF;
 IF p_product_id IS NULL OR p_key IS NULL OR p_enabled IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0
 OR p_quantity IS NULL OR p_quantity NOT BETWEEN 0 AND 1000000000
 OR p_low_threshold IS NULL OR p_low_threshold NOT BETWEEN 0 AND 1000000000 THEN
  RAISE EXCEPTION 'QUANTITY223_INPUT_INVALID: أدخل كمية وحدّ تنبيه صحيحين وغير سالبين.';
 END IF;
 fingerprint:=encode(extensions.digest(jsonb_build_object('product',p_product_id,'enabled',p_enabled,'quantity',p_quantity,'threshold',p_low_threshold,'revision',p_expected_revision)::TEXT,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('optional-quantity223:'||p_key::TEXT,0));
 SELECT * INTO r FROM sales_lite3.quantity_requests WHERE key=p_key;
 IF FOUND THEN
  IF r.actor_id IS DISTINCT FROM auth.uid() OR r.fingerprint<>fingerprint THEN RAISE EXCEPTION 'QUANTITY223_IDEMPOTENCY_CONFLICT';END IF;
  RETURN r.result||jsonb_build_object('idempotentReplay',true);
 END IF;
 SELECT * INTO p FROM public.products WHERE id=p_product_id FOR UPDATE;
 IF NOT FOUND OR p.is_flavor_master OR EXISTS(SELECT 1 FROM public.products child WHERE child.flavor_master_product_id=p.id) THEN
  RAISE EXCEPTION 'QUANTITY223_SELLABLE_PRODUCT_REQUIRED: عدّاد مستقل للمنتج القابل للبيع أو لكل نكهة؛ لا يُفعّل للأب.';
 END IF;
 SELECT * INTO c FROM sales_lite3.quantity_counters WHERE product_id=p.id FOR UPDATE;
 old_revision:=COALESCE(c.revision,0);old_quantity:=COALESCE(c.quantity,0);
 IF old_revision<>p_expected_revision THEN RAISE EXCEPTION 'QUANTITY223_CONFLICT: تغيّرت الكمية منذ قراءتها؛ أعد القراءة قبل تعديلها.';END IF;
 IF COALESCE(c.ever_enabled,false) AND c.unit_id IS DISTINCT FROM p.unit_id THEN
  RAISE EXCEPTION 'QUANTITY223_UNIT_REVIEW_REQUIRED';
 END IF;
 SELECT COALESCE(name_ar,'باكيت') INTO unit_name FROM public.units WHERE id=p.unit_id;
 next_revision:=old_revision+1;ever_enabled:=COALESCE(c.ever_enabled,false) OR p_enabled;
 low_sent:=CASE WHEN NOT p_enabled OR p_low_threshold=0 OR p_quantity>=p_low_threshold THEN false ELSE COALESCE(c.low_sent,false) END;
 zero_sent:=CASE WHEN NOT p_enabled OR p_quantity>0 THEN false ELSE COALESCE(c.zero_sent,false) END;
 old_configuration:=jsonb_build_object('enabled',COALESCE(c.enabled,false),'threshold',COALESCE(c.low_threshold,0),'unitId',COALESCE(c.unit_id,p.unit_id));
 new_configuration:=jsonb_build_object('enabled',p_enabled,'threshold',p_low_threshold,'unitId',p.unit_id);
 INSERT INTO sales_lite3.quantity_counters(product_id,unit_id,enabled,quantity,low_threshold,revision,ever_enabled,low_sent,zero_sent,updated_by)
 VALUES(p.id,p.unit_id,p_enabled,p_quantity,p_low_threshold,next_revision,ever_enabled,low_sent,zero_sent,auth.uid())
 ON CONFLICT(product_id) DO UPDATE SET unit_id=excluded.unit_id,enabled=excluded.enabled,quantity=excluded.quantity,
  low_threshold=excluded.low_threshold,revision=excluded.revision,ever_enabled=excluded.ever_enabled,
  low_sent=excluded.low_sent,zero_sent=excluded.zero_sent,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 INSERT INTO sales_lite3.quantity_events(product_id,sku_snapshot,name_snapshot,unit_id,unit_name_snapshot,kind,source_type,source_id,
  quantity_before,quantity_after,requested_quantity,applied_quantity,shortage_quantity,revision_before,revision_after,configuration_before,configuration_after,created_by)
 VALUES(p.id,p.sku,p.name_ar,p.unit_id,COALESCE(unit_name,'باكيت'),'manual','quantity_request',p_key,
  old_quantity,p_quantity,p_quantity,abs(p_quantity-old_quantity),0,old_revision,next_revision,old_configuration,new_configuration,auth.uid());
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details)
 VALUES(auth.uid(),'SET_OPTIONAL_QUANTITY','products',p.id,jsonb_build_object('before',old_configuration||jsonb_build_object('quantity',old_quantity,'revision',old_revision),
  'after',new_configuration||jsonb_build_object('quantity',p_quantity,'revision',next_revision),'requestKey',p_key));
 result:=jsonb_build_object('success',true,'idempotentReplay',false,'productId',p.id,'enabled',p_enabled,'quantity',p_quantity,'threshold',p_low_threshold,'revision',next_revision);
 INSERT INTO sales_lite3.quantity_requests(key,actor_id,fingerprint,result) VALUES(p_key,auth.uid(),fingerprint,result);
 RETURN result;
END $$;

CREATE FUNCTION public.lite3_low_counters223(p_page INTEGER DEFAULT 1,p_page_size INTEGER DEFAULT 20) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rows JSONB;total BIGINT;
BEGIN
 PERFORM sales_lite3.assert_owner223();
 IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'QUANTITY223_PAGE_INVALID';END IF;
 SELECT count(*) INTO total FROM sales_lite3.quantity_counters c JOIN public.products p ON p.id=c.product_id
 WHERE c.enabled AND p.is_active AND NOT p.is_flavor_master AND(c.quantity=0 OR c.quantity<c.low_threshold);
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.quantity,x."productId"),'[]') INTO rows FROM(
  SELECT p.id AS "productId",p.sku,p.name_ar AS name,COALESCE(u.name_ar,'باكيت') AS "unitName",c.quantity,c.low_threshold AS threshold,c.revision
  FROM sales_lite3.quantity_counters c JOIN public.products p ON p.id=c.product_id LEFT JOIN public.units u ON u.id=c.unit_id
  WHERE c.enabled AND p.is_active AND NOT p.is_flavor_master AND(c.quantity=0 OR c.quantity<c.low_threshold)
  ORDER BY c.quantity,p.id LIMIT p_page_size OFFSET(p_page-1)::BIGINT*p_page_size
 ) x;
 RETURN jsonb_build_object('contractVersion','optional-quantity223-v1','products',rows,'total',total,'page',p_page,'pageSize',p_page_size);
END $$;

ALTER FUNCTION sales_lite3.immutable223() OWNER TO postgres;
ALTER FUNCTION sales_lite3.assert_owner223() OWNER TO postgres;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sales_lite3 FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.lite3_counter_context223(UUID) OWNER TO postgres;
ALTER FUNCTION public.lite3_set_counter223(UUID,BOOLEAN,BIGINT,BIGINT,BIGINT,UUID) OWNER TO postgres;
ALTER FUNCTION public.lite3_low_counters223(INTEGER,INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.lite3_counter_context223(UUID),public.lite3_set_counter223(UUID,BOOLEAN,BIGINT,BIGINT,BIGINT,UUID),public.lite3_low_counters223(INTEGER,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite3_counter_context223(UUID),public.lite3_set_counter223(UUID,BOOLEAN,BIGINT,BIGINT,BIGINT,UUID),public.lite3_low_counters223(INTEGER,INTEGER) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
