-- =========================================================================
-- Nawasrah ERP - Migration 106
-- Keep the technical monitoring dashboard owner-only while aligning its MFA
-- requirement with the central ERP policy: AAL2 is mandatory after a verified
-- MFA factor exists, and AAL1 remains valid before enrollment.
-- =========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.assert_monitoring_owner()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner'],
    'عرض المراقبة التقنية'
  );

  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_monitoring_owner()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_advanced_monitoring_dashboard()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_advanced_monitoring_dashboard()
  TO authenticated;

COMMENT ON FUNCTION public.assert_monitoring_owner() IS
  'Owner-only monitoring guard using the central enrolled-factor MFA policy; callers cannot execute it directly.';

COMMIT;
