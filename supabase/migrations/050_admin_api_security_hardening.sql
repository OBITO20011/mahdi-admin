-- =========================================================================
-- Nawasrah ERP - Migration 050
-- Close anonymous access to internal RPCs and role-guard legacy operations.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- Read-only reports should honor the caller's RLS policies instead of
-- bypassing them as the database owner.
-- -------------------------------------------------------------------------
ALTER FUNCTION public.get_dashboard_analytics() SECURITY INVOKER;
ALTER FUNCTION public.get_cash_shift_summary(UUID) SECURITY INVOKER;
ALTER FUNCTION public.get_cash_shift_display_summary(UUID) SECURITY INVOKER;

-- This helper only inspects the current request role and does not need owner
-- privileges. Setting search_path also removes the mutable-path warning.
ALTER FUNCTION public.is_authenticated() SECURITY INVOKER;
ALTER FUNCTION public.is_authenticated()
  SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.get_dashboard_analytics()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_cash_shift_summary(UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_cash_shift_display_summary(UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_authenticated()
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_dashboard_analytics()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_shift_summary(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_shift_display_summary(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_authenticated()
  TO authenticated;

-- -------------------------------------------------------------------------
-- Preserve legacy purchasing/inventory business logic as private functions.
-- Public wrappers below add the missing active-role checks.
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure(
    'public._receive_inventory_impl(uuid,uuid,integer,text,uuid,text)'
  ) IS NULL THEN
    ALTER FUNCTION public.receive_inventory(
      UUID, UUID, INTEGER, TEXT, UUID, TEXT
    ) RENAME TO _receive_inventory_impl;
  END IF;

  IF to_regprocedure(
    'public._create_purchase_order_impl(uuid,uuid,uuid,timestamp with time zone,bigint,bigint,text,text,text,jsonb)'
  ) IS NULL THEN
    ALTER FUNCTION public.create_purchase_order(
      UUID, UUID, UUID, TIMESTAMPTZ, BIGINT, BIGINT, TEXT, TEXT, TEXT, JSONB
    ) RENAME TO _create_purchase_order_impl;
  END IF;

  IF to_regprocedure(
    'public._update_purchase_order_status_impl(uuid,text,text)'
  ) IS NULL THEN
    ALTER FUNCTION public.update_purchase_order_status(UUID, TEXT, TEXT)
      RENAME TO _update_purchase_order_status_impl;
  END IF;

  IF to_regprocedure(
    'public._receive_purchase_order_impl(uuid,uuid,text,text,jsonb)'
  ) IS NULL THEN
    ALTER FUNCTION public.receive_purchase_order(UUID, UUID, TEXT, TEXT, JSONB)
      RENAME TO _receive_purchase_order_impl;
  END IF;

  IF to_regprocedure(
    'public._record_supplier_payment_impl(uuid,uuid,bigint,text,text,timestamp with time zone,text)'
  ) IS NULL THEN
    ALTER FUNCTION public.record_supplier_payment(
      UUID, UUID, BIGINT, TEXT, TEXT, TIMESTAMPTZ, TEXT
    ) RENAME TO _record_supplier_payment_impl;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._receive_inventory_impl(
  UUID, UUID, INTEGER, TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._create_purchase_order_impl(
  UUID, UUID, UUID, TIMESTAMPTZ, BIGINT, BIGINT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._update_purchase_order_status_impl(
  UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._receive_purchase_order_impl(
  UUID, UUID, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._record_supplier_payment_impl(
  UUID, UUID, BIGINT, TEXT, TEXT, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.receive_inventory(
  p_warehouse_id UUID,
  p_product_id UUID,
  p_quantity INTEGER,
  p_reference_type TEXT DEFAULT 'purchase_order',
  p_reference_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT 'استلام كميات جديدة للمخزن'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'استلام المخزون'
  );

  RETURN public._receive_inventory_impl(
    p_warehouse_id,
    p_product_id,
    p_quantity,
    p_reference_type,
    p_reference_id,
    p_notes
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_purchase_order(
  p_supplier_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_expected_delivery_date TIMESTAMPTZ DEFAULT NULL,
  p_delivery_fee_in_minor_units BIGINT DEFAULT 0,
  p_discount_in_minor_units BIGINT DEFAULT 0,
  p_supplier_invoice_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_internal_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إنشاء أوامر الشراء'
  );

  RETURN public._create_purchase_order_impl(
    p_supplier_id,
    p_branch_id,
    p_warehouse_id,
    p_expected_delivery_date,
    p_delivery_fee_in_minor_units,
    p_discount_in_minor_units,
    p_supplier_invoice_number,
    p_notes,
    p_internal_notes,
    p_items
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_purchase_order_status(
  p_purchase_order_id UUID,
  p_new_status TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'تغيير حالة أمر الشراء'
  );

  RETURN public._update_purchase_order_status_impl(
    p_purchase_order_id,
    p_new_status,
    p_notes
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_purchase_order_id UUID,
  p_warehouse_id UUID DEFAULT NULL,
  p_supplier_delivery_note TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'استلام أوامر الشراء'
  );

  RETURN public._receive_purchase_order_impl(
    p_purchase_order_id,
    p_warehouse_id,
    p_supplier_delivery_note,
    p_notes,
    p_items
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_supplier_payment(
  p_supplier_id UUID,
  p_purchase_order_id UUID DEFAULT NULL,
  p_amount_in_minor_units BIGINT DEFAULT 0,
  p_payment_method TEXT DEFAULT 'cash',
  p_reference_number TEXT DEFAULT NULL,
  p_payment_date TIMESTAMPTZ DEFAULT NOW(),
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'تسجيل دفعات الموردين'
  );

  RETURN public._record_supplier_payment_impl(
    p_supplier_id,
    p_purchase_order_id,
    p_amount_in_minor_units,
    p_payment_method,
    p_reference_number,
    p_payment_date,
    p_notes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.receive_inventory(
  UUID, UUID, INTEGER, TEXT, UUID, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_purchase_order(
  UUID, UUID, UUID, TIMESTAMPTZ, BIGINT, BIGINT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_purchase_order_status(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.receive_purchase_order(
  UUID, UUID, TEXT, TEXT, JSONB
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_supplier_payment(
  UUID, UUID, BIGINT, TEXT, TEXT, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.receive_inventory(
  UUID, UUID, INTEGER, TEXT, UUID, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(
  UUID, UUID, UUID, TIMESTAMPTZ, BIGINT, BIGINT, TEXT, TEXT, TEXT, JSONB
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_purchase_order_status(UUID, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(
  UUID, UUID, TEXT, TEXT, JSONB
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment(
  UUID, UUID, BIGINT, TEXT, TEXT, TIMESTAMPTZ, TEXT
) TO authenticated;

-- cancel_purchase_order delegates to the guarded status wrapper above.
REVOKE ALL ON FUNCTION public.cancel_purchase_order(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_order(UUID, TEXT)
  TO authenticated;

-- Remove the development-only anonymous warehouse policies that were present
-- in migration 010. They are not required by either production application.
DO $$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT *
    FROM (
      VALUES
        ('supplier_returns', 'Allow anon select supplier_returns'),
        ('supplier_return_items', 'Allow anon select supplier_return_items'),
        ('stock_counts', 'Allow anon select stock_counts'),
        ('stock_count_items', 'Allow anon select stock_count_items')
    ) AS policies(table_name, policy_name)
  LOOP
    IF to_regclass(format('public.%I', v_policy.table_name)) IS NOT NULL THEN
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        v_policy.policy_name,
        v_policy.table_name
      );
    END IF;
  END LOOP;
END;
$$;

COMMIT;
