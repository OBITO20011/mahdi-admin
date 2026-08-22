-- =========================================================================
-- Nawasrah ERP - Migration 051
-- Require AAL2 for ERP staff only after they verify an MFA factor.
-- Accounts without an enrolled factor continue to work at AAL1, preventing
-- accidental lockout while MFA is rolled out from the admin profile screen.
-- =========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.is_mfa_policy_satisfied()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      NOT EXISTS (
        SELECT 1
        FROM auth.mfa_factors factor
        WHERE factor.user_id = auth.uid()
          AND factor.status = 'verified'
      )
      OR COALESCE(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    );
$$;

REVOKE ALL ON FUNCTION public.is_mfa_policy_satisfied()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_mfa_policy_satisfied()
  TO authenticated;

-- Central guard used by all inventory and accounting mutation RPCs.
CREATE OR REPLACE FUNCTION public.assert_erp_role(
  p_allowed_roles TEXT[],
  p_operation TEXT DEFAULT 'تنفيذ العملية'
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول من حساب موظف معتمد.';
  END IF;

  IF NOT public.is_mfa_policy_satisfied() THEN
    RAISE EXCEPTION 'يجب تأكيد رمز المصادقة الثنائية قبل %.',
      COALESCE(p_operation, 'تنفيذ العملية');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    JOIN public.roles r ON r.id = ur.role_id
    WHERE p.id = v_user_id
      AND p.is_active = true
      AND r.code = ANY(p_allowed_roles)
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية %.', COALESCE(p_operation, 'تنفيذ العملية');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_erp_role(TEXT[], TEXT)
  FROM PUBLIC, anon, authenticated;

-- Storage mutations and other role predicates must honor the same level.
CREATE OR REPLACE FUNCTION public.has_erp_role(
  p_allowed_roles TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    public.is_mfa_policy_satisfied()
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id
      JOIN public.roles r ON r.id = ur.role_id
      WHERE p.id = auth.uid()
        AND p.is_active = true
        AND r.code = ANY(p_allowed_roles)
    );
$$;

REVOKE ALL ON FUNCTION public.has_erp_role(TEXT[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_erp_role(TEXT[])
  TO authenticated;

CREATE OR REPLACE FUNCTION public.is_active_erp_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    public.is_mfa_policy_satisfied()
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id
      JOIN public.roles r ON r.id = ur.role_id
      WHERE p.id = auth.uid()
        AND p.is_active = true
        AND r.code = ANY (
          ARRAY[
            'owner',
            'admin',
            'manager',
            'accountant',
            'cashier',
            'sales',
            'warehouse_keeper',
            'orders',
            'delivery_driver',
            'view_only'
          ]::TEXT[]
        )
    );
$$;

REVOKE ALL ON FUNCTION public.is_active_erp_staff()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_erp_staff()
  TO authenticated;

-- Existing restrictive RLS policies created in migration 032 already call
-- is_active_erp_staff(). Replacing that predicate above upgrades those policies
-- without creating, dropping, or rewriting policies across the whole schema.
-- Later operational writes use assert_erp_role(), while Storage uses
-- has_erp_role(), so the three existing central boundaries stay consistent.

COMMIT;
