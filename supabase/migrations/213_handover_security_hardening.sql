-- Owner24Oct: bounded handover hardening; no inventory/money data rewrites.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- Keep immutable implementations for postgres-owned DEFINER call chains.
DO $legacy213$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
  WHERE p.pronamespace='public'::regnamespace AND p.proname IN (
   'receive_inventory','create_product_with_opening_stock',
   'create_product_with_opening_stock_v2','create_product_with_opening_stock_v3')
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',f.signature);END LOOP;
END;$legacy213$;

-- These privileges are never needed by the browser API. RLS does not protect
-- TRUNCATE; remove inherited PUBLIC atoms as well as the two direct grants.
DO $tables213$ DECLARE t record;BEGIN
 FOR t IN SELECT c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  AND c.relkind IN('r','p','f')
 LOOP EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM PUBLIC, anon, authenticated',t.relname);END LOOP;
END;$tables213$;

REVOKE ALL ON FUNCTION public.enforce_product_flavor_inheritance()
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.sync_product_flavor_commercial_settings()
 FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.package_d_reject_pos_cancellation_mutation()
 SET search_path=public,pg_temp;

CREATE TABLE public.guest_order_tracking_limits (
 scope TEXT NOT NULL CHECK(scope IN('network','phone')),
 identifier_hash TEXT NOT NULL CHECK(identifier_hash ~ '^[0-9a-f]{64}$'),
 window_started_at TIMESTAMPTZ NOT NULL,
 attempts INTEGER NOT NULL CHECK(attempts BETWEEN 1 AND 121),
 last_seen_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(scope,identifier_hash)
);
CREATE INDEX guest_order_tracking_limits_expiry_idx
 ON public.guest_order_tracking_limits(last_seen_at);
ALTER TABLE public.guest_order_tracking_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guest_order_tracking_limits
 FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE public.guest_order_tracking_limits IS
 '213 private bounded tracking attempts; SHA256 identifiers only, no raw phone/network values. No business balance or order lifecycle state.';

CREATE OR REPLACE FUNCTION public.track_guest_order(
 p_order_number TEXT,p_customer_phone TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,pg_temp AS $track213$
DECLARE
 v_phone TEXT:=CASE WHEN char_length(p_customer_phone)<=64
  THEN public.normalize_customer_phone(p_customer_phone) ELSE NULL END;
 v_order_id UUID;v_now TIMESTAMPTZ:=clock_timestamp();v_window TIMESTAMPTZ;
 v_headers JSONB;v_network TEXT;v_hash TEXT;v_phone_hash TEXT;
 v_lock TEXT;v_attempts INTEGER;
BEGIN
 -- SECURITY DEFINER changes current_user; the SET ROLE GUC retains the API role.
 IF auth.role()='anon' OR current_setting('role',true)='anon' THEN
  -- REST request metadata is only an additional signal. The normalized-phone
  -- bucket always applies, so rotating order numbers/network headers cannot
  -- evade the per-phone guessing bound.
  BEGIN v_headers:=NULLIF(current_setting('request.headers',true),'')::JSONB;
  EXCEPTION WHEN OTHERS THEN v_headers:='{}'::JSONB;END;
  v_network:=left(COALESCE(NULLIF(v_headers->>'cf-connecting-ip',''),
   NULLIF(split_part(v_headers->>'x-forwarded-for',',',1),''),'unknown'),256);
  v_hash:=encode(sha256(convert_to(trim(v_network),'UTF8')),'hex');
  v_phone_hash:=encode(sha256(convert_to(CASE WHEN v_phone ~ '^07[789][0-9]{7}$'
   THEN v_phone ELSE 'invalid' END,'UTF8')),'hex');

  FOR v_lock IN SELECT value FROM unnest(ARRAY['tracking213:network:'||v_hash,
   'tracking213:phone:'||v_phone_hash]) value ORDER BY value
  LOOP PERFORM pg_advisory_xact_lock(hashtextextended(v_lock,0));END LOOP;
  v_now:=clock_timestamp();
  v_window:=to_timestamp(floor(extract(epoch FROM v_now)/600)*600);
  INSERT INTO public.guest_order_tracking_limits(scope,identifier_hash,window_started_at,attempts,last_seen_at)
   VALUES('network',v_hash,v_window,1,v_now)
   ON CONFLICT(scope,identifier_hash) DO UPDATE SET
    attempts=CASE WHEN guest_order_tracking_limits.window_started_at=EXCLUDED.window_started_at
     THEN LEAST(guest_order_tracking_limits.attempts+1,121) ELSE 1 END,
    window_started_at=EXCLUDED.window_started_at,last_seen_at=EXCLUDED.last_seen_at
   RETURNING attempts INTO v_attempts;
  IF v_attempts>120 THEN RETURN jsonb_build_object('success',false,
   'message','محاولات متابعة كثيرة. انتظر بضع دقائق ثم أعد المحاولة، أو استخدم رابط متابعة الطلب.');END IF;
  INSERT INTO public.guest_order_tracking_limits(scope,identifier_hash,window_started_at,attempts,last_seen_at)
   VALUES('phone',v_phone_hash,v_window,1,v_now)
   ON CONFLICT(scope,identifier_hash) DO UPDATE SET
    attempts=CASE WHEN guest_order_tracking_limits.window_started_at=EXCLUDED.window_started_at
     THEN LEAST(guest_order_tracking_limits.attempts+1,31) ELSE 1 END,
    window_started_at=EXCLUDED.window_started_at,last_seen_at=EXCLUDED.last_seen_at
   RETURNING attempts INTO v_attempts;
  IF v_attempts>30 THEN RETURN jsonb_build_object('success',false,
   'message','محاولات متابعة كثيرة. انتظر بضع دقائق ثم أعد المحاولة، أو استخدم رابط متابعة الطلب.');END IF;
  DELETE FROM public.guest_order_tracking_limits WHERE ctid IN(
   SELECT ctid FROM public.guest_order_tracking_limits
    WHERE last_seen_at<v_now-INTERVAL '1 day' ORDER BY last_seen_at
    LIMIT 100 FOR UPDATE SKIP LOCKED);
 END IF;
 IF NULLIF(trim(p_order_number),'') IS NULL OR char_length(trim(p_order_number))>40
  OR v_phone IS NULL OR v_phone !~ '^07[789][0-9]{7}$' THEN
  RETURN jsonb_build_object('success',false,'message','لم نعثر على طلب مطابق لرقم الطلب والهاتف.');
 END IF;
 SELECT o.id INTO v_order_id FROM public.orders o JOIN public.customers c ON c.id=o.customer_id
  WHERE upper(o.order_number)=upper(trim(p_order_number))
   AND public.normalize_customer_phone(c.phone)=v_phone AND o.source='website' LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,
  'message','لم نعثر على طلب مطابق لرقم الطلب والهاتف.');END IF;
 RETURN public.build_public_order_tracking_payload(v_order_id);
END;$track213$;

-- Public bucket delivery bypasses SELECT metadata policies. Staff keep the
-- own-folder metadata read required by existing upload/upsert/delete flows.
DROP POLICY "Public can read product images" ON storage.objects;
CREATE POLICY "ERP staff can read own product image metadata"
 ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='product-images' AND (storage.foldername(name))[1]=auth.uid()::TEXT
  AND public.has_erp_role(ARRAY['owner','admin','manager','warehouse_keeper'])
 );
COMMIT;
