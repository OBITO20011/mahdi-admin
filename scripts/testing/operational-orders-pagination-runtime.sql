-- Runtime verification for the operational orders paging contract.
-- Runs only in the disposable isolated Supabase database.
\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE r5_orders_results (
  scenario TEXT PRIMARY KEY,
  details JSONB NOT NULL DEFAULT '{}'::JSONB
) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
  v_owner UUID := '95000000-0000-0000-0000-000000000001';
  v_cashier UUID := '95000000-0000-0000-0000-000000000002';
  v_view_only UUID := '95000000-0000-0000-0000-000000000003';
  v_owner_role UUID;
  v_cashier_role UUID;
  v_view_role UUID;
  v_branch UUID := '95000000-0000-0000-0000-000000000010';
  v_shift UUID := '95000000-0000-0000-0000-000000000011';
  v_customer_a UUID := '95000000-0000-0000-0000-000000000020';
  v_customer_b UUID := '95000000-0000-0000-0000-000000000021';
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_owner, 'authenticated', 'authenticated', 'r5-owner@example.test', NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW()),
    (v_cashier, 'authenticated', 'authenticated', 'r5-cashier@example.test', NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW()),
    (v_view_only, 'authenticated', 'authenticated', 'r5-view@example.test', NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, full_name, is_active)
  VALUES
    (v_owner, 'مالك اختبار R5', true),
    (v_cashier, 'كاشير اختبار R5', true),
    (v_view_only, 'مشاهد اختبار R5', true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  INSERT INTO public.roles (code, name_ar)
  VALUES
    ('owner', 'مالك النظام'),
    ('cashier', 'كاشير'),
    ('view_only', 'عرض فقط')
  ON CONFLICT (code) DO NOTHING;

  SELECT id INTO v_owner_role FROM public.roles WHERE code = 'owner';
  SELECT id INTO v_cashier_role FROM public.roles WHERE code = 'cashier';
  SELECT id INTO v_view_role FROM public.roles WHERE code = 'view_only';

  INSERT INTO public.user_roles (user_id, role_id)
  VALUES
    (v_owner, v_owner_role),
    (v_cashier, v_cashier_role),
    (v_view_only, v_view_role)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.branches (id, code, name_ar, is_active)
  VALUES (v_branch, 'R5-BRANCH', 'فرع اختبار R5', true)
  ON CONFLICT (id) DO NOTHING;

  -- Keep the POS exclusion fixture valid under the same production guard that
  -- requires every direct sale to belong to an open cash shift.
  INSERT INTO public.cash_shifts (
    id, shift_number, branch_id, opened_by, opening_cash_in_minor_units, status
  ) VALUES (
    v_shift, 'R5-SHIFT-OPEN', v_branch, v_owner, 0, 'open'
  );

  INSERT INTO public.customers (id, full_name, phone, customer_type)
  VALUES
    (v_customer_a, 'عميل بحث R5 ألف', '0799500001', 'wholesale'),
    (v_customer_b, 'عميل بحث R5 باء', '0799500002', 'wholesale')
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    is_active = true,
    is_blocked = false,
    is_deleted = false;

  INSERT INTO public.orders (
    order_number, customer_id, customer_name_snapshot, branch_id,
    status, payment_method, payment_status,
    subtotal_in_minor_units, total_in_minor_units,
    amount_paid_in_minor_units, source, created_at, updated_at
  )
  SELECT
    'R5-WEB-' || LPAD(series::TEXT, 4, '0'),
    CASE WHEN series % 2 = 1 THEN v_customer_a ELSE v_customer_b END,
    CASE WHEN series % 2 = 1 THEN 'عميل بحث R5 ألف' ELSE 'عميل بحث R5 باء' END,
    v_branch,
    CASE series % 4
      WHEN 0 THEN 'new'
      WHEN 1 THEN 'confirmed'
      WHEN 2 THEN 'completed'
      ELSE 'cancelled'
    END,
    'cash_on_delivery',
    CASE WHEN series % 4 = 2 THEN 'paid' ELSE 'unpaid' END,
    1000,
    1000,
    CASE WHEN series % 4 = 2 THEN 1000 ELSE 0 END,
    'website',
    TIMESTAMPTZ '2026-01-01 10:00:00+00',
    TIMESTAMPTZ '2026-01-01 10:00:00+00'
  FROM generate_series(1, 61) series;

  INSERT INTO public.orders (
    order_number, customer_id, branch_id, status, payment_method,
    payment_status, subtotal_in_minor_units, total_in_minor_units,
    amount_paid_in_minor_units, source
  )
  SELECT
    'R5-POS-' || series,
    v_customer_a,
    v_branch,
    'completed',
    'cash',
    'paid',
    1000,
    1000,
    1000,
    'pos'
  FROM generate_series(1, 3) series;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"95000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);

DO $$
DECLARE
  v_page_1 JSONB;
  v_page_2 JSONB;
  v_page_3 JSONB;
  v_page JSONB;
  v_seen UUID[] := ARRAY[]::UUID[];
  v_id_text TEXT;
  v_expected INTEGER;
  v_before INTEGER;
  v_target UUID;
  v_new UUID;
  v_denied BOOLEAN := false;
BEGIN
  v_page_1 := public.get_operational_orders_page(1, 25, 'all', NULL, 'newest');
  v_page_2 := public.get_operational_orders_page(2, 25, 'all', NULL, 'newest');
  v_page_3 := public.get_operational_orders_page(3, 25, 'all', NULL, 'newest');

  IF (v_page_1->>'total_count')::INTEGER <> 61
    OR jsonb_array_length(v_page_1->'order_ids') <> 25
    OR jsonb_array_length(v_page_2->'order_ids') <> 25
    OR jsonb_array_length(v_page_3->'order_ids') <> 11 THEN
    RAISE EXCEPTION 'First/middle/last page sizes or total count are incorrect.';
  END IF;

  FOR v_id_text IN
    SELECT value
    FROM jsonb_array_elements_text(
      (v_page_1->'order_ids') || (v_page_2->'order_ids') || (v_page_3->'order_ids')
    )
  LOOP
    IF v_id_text::UUID = ANY(v_seen) THEN
      RAISE EXCEPTION 'Duplicate order appeared across stable pages: %', v_id_text;
    END IF;
    v_seen := array_append(v_seen, v_id_text::UUID);
  END LOOP;
  IF cardinality(v_seen) <> 61 THEN
    RAISE EXCEPTION 'A paged order is missing.';
  END IF;
  INSERT INTO r5_orders_results VALUES (
    'first_middle_last_pages',
    jsonb_build_object('total', 61, 'page_sizes', ARRAY[25, 25, 11])
  );

  SELECT COUNT(*)::INTEGER INTO v_expected
  FROM public.orders
  WHERE source = 'website' AND status = 'new';
  v_page := public.get_operational_orders_page(1, 25, 'action', NULL, 'newest');
  IF (v_page->>'total_count')::INTEGER <> v_expected THEN
    RAISE EXCEPTION 'Status filter count is incorrect.';
  END IF;
  INSERT INTO r5_orders_results VALUES (
    'status_filter', jsonb_build_object('new_count', v_expected)
  );

  v_page := public.get_operational_orders_page(1, 25, 'all', '0799500001', 'newest');
  IF (v_page->>'total_count')::INTEGER <> 31 THEN
    RAISE EXCEPTION 'Phone search did not cover the complete server result.';
  END IF;
  v_page := public.get_operational_orders_page(1, 25, 'all', 'R5-WEB-0061', 'newest');
  IF (v_page->>'total_count')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'Order-number search did not return the exact order.';
  END IF;
  INSERT INTO r5_orders_results VALUES (
    'server_search', jsonb_build_object('phone_results', 31, 'exact_order_results', 1)
  );

  SELECT id INTO v_target
  FROM public.orders
  WHERE order_number = 'R5-WEB-0060';
  v_page := public.get_operational_orders_page(1, 25, 'action', NULL, 'newest');
  v_before := (v_page->>'total_count')::INTEGER;
  UPDATE public.orders SET status = 'confirmed', updated_at = NOW() WHERE id = v_target;
  v_page := public.get_operational_orders_page(1, 25, 'action', NULL, 'newest');
  IF (v_page->>'total_count')::INTEGER <> v_before - 1 THEN
    RAISE EXCEPTION 'Updated order was not invalidated from its old status page.';
  END IF;
  INSERT INTO r5_orders_results VALUES (
    'updated_order_invalidation', jsonb_build_object('before', v_before, 'after', v_before - 1)
  );

  INSERT INTO public.orders (
    order_number, customer_id, customer_name_snapshot, branch_id,
    status, payment_method, payment_status,
    subtotal_in_minor_units, total_in_minor_units,
    amount_paid_in_minor_units, source, created_at, updated_at
  ) VALUES (
    'R5-WEB-NEWEST',
    '95000000-0000-0000-0000-000000000020',
    'عميل بحث R5 ألف',
    '95000000-0000-0000-0000-000000000010',
    'new', 'cash_on_delivery', 'unpaid', 1000, 1000, 0, 'website', NOW(), NOW()
  ) RETURNING id INTO v_new;
  v_page := public.get_operational_orders_page(1, 25, 'action', NULL, 'newest');
  IF (v_page->'order_ids'->>0)::UUID IS DISTINCT FROM v_new THEN
    RAISE EXCEPTION 'Newest inserted order did not appear first.';
  END IF;
  INSERT INTO r5_orders_results VALUES (
    'new_order_visible', jsonb_build_object('order_id', v_new)
  );

  v_page := public.get_operational_orders_page(1, 100, 'all', 'R5-POS-', 'newest');
  IF (v_page->>'total_count')::INTEGER <> 0 THEN
    RAISE EXCEPTION 'POS orders leaked into the operational website queue.';
  END IF;
  INSERT INTO r5_orders_results VALUES ('pos_excluded', '{}'::JSONB);

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"95000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',
    true
  );
  PERFORM public.get_operational_orders_page(1, 1, 'action', NULL, 'newest');
  INSERT INTO r5_orders_results VALUES ('cashier_allowed', '{}'::JSONB);

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"95000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',
    true
  );
  BEGIN
    PERFORM public.get_operational_orders_page(1, 1, 'action', NULL, 'newest');
  EXCEPTION WHEN OTHERS THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'view_only unexpectedly accessed the operational order queue.';
  END IF;
  INSERT INTO r5_orders_results VALUES ('view_only_denied', '{}'::JSONB);

  IF has_function_privilege(
    'anon',
    'public.get_operational_orders_page(integer,integer,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Anonymous still has execute privilege.';
  END IF;
  INSERT INTO r5_orders_results VALUES ('anonymous_denied', '{}'::JSONB);
END $$;

RESET ROLE;

SELECT jsonb_build_object(
  'runtime_scenarios', COUNT(*),
  'passed', COUNT(*),
  'unexpected_failures', 0,
  'scenarios', jsonb_object_agg(scenario, details ORDER BY scenario)
)::TEXT
FROM r5_orders_results;

ROLLBACK;
