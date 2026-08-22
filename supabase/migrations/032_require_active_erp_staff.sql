-- =========================================================================
-- Nawasrah ERP - Migration 032
-- Require an active ERP profile and assigned role for authenticated reads.
-- =========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.is_active_erp_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    auth.uid() IS NOT NULL
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

-- Earlier migrations intentionally used permissive authenticated policies.
-- This restrictive policy is combined with them, so authenticated requests
-- must also belong to an active ERP employee. Anonymous guest RPCs continue
-- to operate through their explicitly granted SECURITY DEFINER boundaries.
DO $$
DECLARE
  v_table RECORD;
  v_policy_name CONSTANT TEXT := 'Require active ERP staff membership';
BEGIN
  FOR v_table IN
    SELECT namespace.nspname AS schema_name, relation.relname AS table_name
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relrowsecurity = true
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      v_policy_name,
      v_table.schema_name,
      v_table.table_name
    );

    EXECUTE format(
      'CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.is_active_erp_staff())) WITH CHECK ((SELECT public.is_active_erp_staff()))',
      v_policy_name,
      v_table.schema_name,
      v_table.table_name
    );
  END LOOP;
END;
$$;

COMMIT;
