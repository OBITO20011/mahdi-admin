-- QUARANTINED phase2. Public-safe mode only;no private order/customer evidence.
CREATE FUNCTION public.lite1_operating_mode(p_guest_key TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE full_mode BOOLEAN;r sales_lite1.requests;operation public.business_operations;
BEGIN
 IF p_guest_key IS NOT NULL THEN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='LITE2_GATEWAY_ONLY';END IF;
  IF p_guest_key!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'PHASE3_IDEMPOTENCY_INPUT_INVALID';END IF;
  -- Routing is only an affordance. Each original writer independently checks
  -- the actor and exact request fingerprint before returning its sealed result.
  SELECT * INTO r FROM sales_lite1.requests WHERE key=p_guest_key;
  IF FOUND THEN
   IF r.kind<>'guest2' OR r.result IS NULL THEN RAISE EXCEPTION 'PHASE3_IDEMPOTENCY_CONFLICT';END IF;
   RETURN jsonb_build_object('contractVersion','sales-only-phase2-v1','fullAccounting',false);
  END IF;
  SELECT * INTO operation FROM public.business_operations WHERE idempotency_key=p_guest_key;
  IF FOUND THEN
   IF operation.operation_type<>'phase3_customer_reservation_v1' OR operation.actor_scope_type<>'guest_gateway' OR operation.completed_at IS NULL THEN RAISE EXCEPTION 'PHASE3_IDEMPOTENCY_CONFLICT';END IF;
   RETURN jsonb_build_object('contractVersion','sales-only-phase2-v1','fullAccounting',true);
  END IF;
 END IF;
 SELECT full_accounting INTO full_mode FROM sales_lite1.mode WHERE id;
 IF full_mode IS NULL THEN RAISE EXCEPTION 'LITE2_MODE_MISSING';END IF;
 RETURN jsonb_build_object('contractVersion','sales-only-phase2-v1','fullAccounting',full_mode);
END $$;
REVOKE ALL ON FUNCTION public.lite1_operating_mode(TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_operating_mode(TEXT) TO anon,authenticated,service_role;

CREATE FUNCTION public.lite1_set_mode2(p_full BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM sales_lite1.owner();
 IF auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN RAISE EXCEPTION 'LITE2_OWNER_AAL2_REQUIRED';END IF;
 -- Enabling after lite needs the opening epoch transaction, never this toggle.
 RETURN public.lite1_set_mode(p_full);
END $$;
REVOKE ALL ON FUNCTION public.lite1_set_mode2(BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_set_mode2(BOOLEAN) TO authenticated;
