-- =========================================================================
-- Nawasrah ERP - Migration 064
-- Real owner-only staff account management for the administration application.
-- Auth identities are created by the protected Edge Function; every public
-- ERP record mutation stays inside audited SECURITY DEFINER RPC boundaries.
-- =========================================================================

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS job_title TEXT,
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_branch_id
  ON public.profiles(branch_id)
  WHERE branch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_erp_staff_accounts()
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  phone TEXT,
  job_title TEXT,
  branch_id UUID,
  branch_name TEXT,
  is_active BOOLEAN,
  role_code TEXT,
  role_name_ar TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner'],
    'إدارة حسابات الموظفين'
  );

  RETURN QUERY
  SELECT
    profile.id,
    profile.full_name,
    profile.phone,
    profile.job_title,
    profile.branch_id,
    branch.name_ar,
    profile.is_active,
    role_row.code,
    role_row.name_ar,
    profile.created_at,
    profile.updated_at
  FROM public.profiles AS profile
  LEFT JOIN public.branches AS branch ON branch.id = profile.branch_id
  LEFT JOIN LATERAL (
    SELECT role.code, role.name_ar
    FROM public.user_roles AS assignment
    JOIN public.roles AS role ON role.id = assignment.role_id
    WHERE assignment.user_id = profile.id
    ORDER BY assignment.created_at ASC
    LIMIT 1
  ) AS role_row ON true
  ORDER BY profile.is_active DESC, profile.full_name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_erp_staff_account_record(
  p_user_id UUID,
  p_full_name TEXT,
  p_phone TEXT DEFAULT NULL,
  p_role_code TEXT DEFAULT 'cashier',
  p_branch_id UUID DEFAULT NULL,
  p_job_title TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_full_name TEXT := NULLIF(BTRIM(p_full_name), '');
  v_phone TEXT := NULLIF(BTRIM(p_phone), '');
  v_role_code TEXT := LOWER(NULLIF(BTRIM(p_role_code), ''));
  v_job_title TEXT := NULLIF(BTRIM(p_job_title), '');
  v_role_id UUID;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner'],
    'إضافة حساب موظف'
  );

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'معرّف حساب الموظف مطلوب.';
  END IF;

  IF v_full_name IS NULL OR CHAR_LENGTH(v_full_name) < 2 OR CHAR_LENGTH(v_full_name) > 120 THEN
    RAISE EXCEPTION 'اسم الموظف يجب أن يكون بين حرفين و120 حرفًا.';
  END IF;

  IF v_phone IS NOT NULL AND v_phone !~ '^[0-9+() -]{7,24}$' THEN
    RAISE EXCEPTION 'رقم الهاتف غير صالح.';
  END IF;

  IF v_role_code IS NULL OR v_role_code = 'owner' THEN
    RAISE EXCEPTION 'لا يمكن إنشاء مالك جديد من إدارة الموظفين.';
  END IF;

  SELECT id INTO v_role_id
  FROM public.roles
  WHERE code = v_role_code;

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'الدور المحدد غير معتمد.';
  END IF;

  IF p_branch_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.branches
       WHERE id = p_branch_id AND is_active = true
     ) THEN
    RAISE EXCEPTION 'الفرع المحدد غير موجود أو غير فعّال.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'هذا الحساب مرتبط بموظف بالفعل.';
  END IF;

  INSERT INTO public.profiles (
    id,
    full_name,
    phone,
    job_title,
    branch_id,
    is_active
  ) VALUES (
    p_user_id,
    v_full_name,
    v_phone,
    v_job_title,
    p_branch_id,
    true
  );

  INSERT INTO public.user_roles (user_id, role_id)
  VALUES (p_user_id, v_role_id);

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    'إنشاء حساب موظف',
    'staff_account',
    p_user_id,
    jsonb_build_object(
      'full_name', v_full_name,
      'role_code', v_role_code,
      'branch_id', p_branch_id,
      'has_phone', v_phone IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'userId', p_user_id,
    'message', 'تم إنشاء حساب الموظف وتعيين صلاحياته.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_erp_staff_account_record(
  p_user_id UUID,
  p_full_name TEXT,
  p_phone TEXT DEFAULT NULL,
  p_role_code TEXT DEFAULT 'cashier',
  p_branch_id UUID DEFAULT NULL,
  p_job_title TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_full_name TEXT := NULLIF(BTRIM(p_full_name), '');
  v_phone TEXT := NULLIF(BTRIM(p_phone), '');
  v_role_code TEXT := LOWER(NULLIF(BTRIM(p_role_code), ''));
  v_job_title TEXT := NULLIF(BTRIM(p_job_title), '');
  v_role_id UUID;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner'],
    'تعديل حساب موظف'
  );

  IF p_user_id IS NULL OR p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'لا يمكن تعديل حساب المالك الحالي من إدارة الموظفين.';
  END IF;

  IF v_full_name IS NULL OR CHAR_LENGTH(v_full_name) < 2 OR CHAR_LENGTH(v_full_name) > 120 THEN
    RAISE EXCEPTION 'اسم الموظف يجب أن يكون بين حرفين و120 حرفًا.';
  END IF;

  IF v_phone IS NOT NULL AND v_phone !~ '^[0-9+() -]{7,24}$' THEN
    RAISE EXCEPTION 'رقم الهاتف غير صالح.';
  END IF;

  IF v_role_code IS NULL OR v_role_code = 'owner' THEN
    RAISE EXCEPTION 'لا يمكن تعيين دور المالك من إدارة الموظفين.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'حساب الموظف غير موجود.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_roles AS assignment
    JOIN public.roles AS role ON role.id = assignment.role_id
    WHERE assignment.user_id = p_user_id
      AND role.code = 'owner'
  ) THEN
    RAISE EXCEPTION 'لا يمكن تعديل حساب المالك من هذه الشاشة.';
  END IF;

  SELECT id INTO v_role_id
  FROM public.roles
  WHERE code = v_role_code;

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'الدور المحدد غير معتمد.';
  END IF;

  IF p_branch_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.branches
       WHERE id = p_branch_id AND is_active = true
     ) THEN
    RAISE EXCEPTION 'الفرع المحدد غير موجود أو غير فعّال.';
  END IF;

  UPDATE public.profiles
  SET
    full_name = v_full_name,
    phone = v_phone,
    job_title = v_job_title,
    branch_id = p_branch_id
  WHERE id = p_user_id;

  DELETE FROM public.user_roles WHERE user_id = p_user_id;
  INSERT INTO public.user_roles (user_id, role_id)
  VALUES (p_user_id, v_role_id);

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    'تعديل حساب موظف',
    'staff_account',
    p_user_id,
    jsonb_build_object(
      'full_name', v_full_name,
      'role_code', v_role_code,
      'branch_id', p_branch_id,
      'has_phone', v_phone IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'userId', p_user_id,
    'message', 'تم تحديث بيانات الموظف وصلاحياته.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_erp_staff_account_active(
  p_user_id UUID,
  p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_full_name TEXT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner'],
    'تفعيل أو تعطيل حساب موظف'
  );

  IF p_user_id IS NULL OR p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'لا يمكن تعطيل أو تعديل حساب المالك الحالي.';
  END IF;

  SELECT profile.full_name INTO v_full_name
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id;

  IF v_full_name IS NULL THEN
    RAISE EXCEPTION 'حساب الموظف غير موجود.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_roles AS assignment
    JOIN public.roles AS role ON role.id = assignment.role_id
    WHERE assignment.user_id = p_user_id
      AND role.code = 'owner'
  ) THEN
    RAISE EXCEPTION 'لا يمكن تعطيل حساب المالك.';
  END IF;

  UPDATE public.profiles
  SET is_active = COALESCE(p_is_active, false)
  WHERE id = p_user_id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    CASE WHEN COALESCE(p_is_active, false) THEN 'تفعيل حساب موظف' ELSE 'تعطيل حساب موظف' END,
    'staff_account',
    p_user_id,
    jsonb_build_object(
      'full_name', v_full_name,
      'is_active', COALESCE(p_is_active, false)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'userId', p_user_id,
    'isActive', COALESCE(p_is_active, false),
    'message', CASE WHEN COALESCE(p_is_active, false) THEN 'تم تفعيل الحساب.' ELSE 'تم تعطيل الحساب.' END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_erp_staff_password_reset(
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_full_name TEXT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner'],
    'إعادة تعيين كلمة مرور موظف'
  );

  IF p_user_id IS NULL OR p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'لا يمكن إعادة تعيين كلمة مرور حساب المالك من هذه الشاشة.';
  END IF;

  SELECT profile.full_name INTO v_full_name
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id;

  IF v_full_name IS NULL THEN
    RAISE EXCEPTION 'حساب الموظف غير موجود.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_roles AS assignment
    JOIN public.roles AS role ON role.id = assignment.role_id
    WHERE assignment.user_id = p_user_id
      AND role.code = 'owner'
  ) THEN
    RAISE EXCEPTION 'لا يمكن إعادة تعيين كلمة مرور المالك من هذه الشاشة.';
  END IF;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    'إعادة تعيين كلمة مرور موظف',
    'staff_account',
    p_user_id,
    jsonb_build_object('full_name', v_full_name)
  );

  RETURN jsonb_build_object(
    'success', true,
    'userId', p_user_id,
    'message', 'تم تسجيل إعادة تعيين كلمة المرور.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_erp_staff_account_audit_logs(
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  actor_name TEXT,
  action TEXT,
  entity_id UUID,
  details JSONB,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner'],
    'عرض سجل إدارة الموظفين'
  );

  RETURN QUERY
  SELECT
    audit.id,
    COALESCE(actor.full_name, 'النظام'),
    audit.action,
    audit.entity_id,
    audit.details,
    audit.created_at
  FROM public.audit_logs AS audit
  LEFT JOIN public.profiles AS actor ON actor.id = audit.user_id
  WHERE audit.entity_name = 'staff_account'
  ORDER BY audit.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
END;
$$;

REVOKE ALL ON FUNCTION public.get_erp_staff_accounts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_erp_staff_account_record(UUID, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_erp_staff_account_record(UUID, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_erp_staff_account_active(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_erp_staff_password_reset(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_erp_staff_account_audit_logs(INTEGER) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_erp_staff_accounts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_erp_staff_account_record(UUID, TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_erp_staff_account_record(UUID, TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_erp_staff_account_active(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_erp_staff_password_reset(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_erp_staff_account_audit_logs(INTEGER) TO authenticated;

COMMIT;
