-- QUARANTINED metadata only. Original documents and reader are unchanged.
CREATE FUNCTION sales_lite2.drawer_metadata(p_source TEXT,p_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE oid UUID;
BEGIN
 IF p_source<>'lite_return' THEN RETURN public.trial212_cash_metadata_internal(p_source,p_id);END IF;
 SELECT order_id INTO oid FROM sales_lite1.returns WHERE id=p_id AND money_refund>0;
 IF oid IS NULL THEN RAISE EXCEPTION 'LITE2_DRAWER_RETURN_EVIDENCE_MISSING';END IF;
 RETURN public.trial212_cash_metadata_internal('order',oid);
END $$;
REVOKE ALL ON FUNCTION sales_lite2.drawer_metadata(TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;
