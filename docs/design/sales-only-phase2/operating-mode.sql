-- QUARANTINED phase2. Public-safe mode only;no private order/customer evidence.
CREATE FUNCTION public.lite1_operating_mode() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE full_mode BOOLEAN;
BEGIN
 SELECT full_accounting INTO full_mode FROM sales_lite1.mode WHERE id;
 IF full_mode IS NULL THEN RAISE EXCEPTION 'LITE2_MODE_MISSING';END IF;
 RETURN jsonb_build_object('contractVersion','sales-only-phase2-v1','fullAccounting',full_mode);
END $$;
REVOKE ALL ON FUNCTION public.lite1_operating_mode() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_operating_mode() TO anon,authenticated,service_role;

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
