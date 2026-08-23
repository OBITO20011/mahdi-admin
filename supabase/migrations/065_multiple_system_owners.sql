-- Nawasrah ERP - Migration 065: Allow owner-managed multiple system owners.
-- Existing owners may create or promote another owner. The final active owner
-- can never be disabled or demoted, preventing a permanent administration lockout.

BEGIN;

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
  PERFORM public.assert_erp_role(ARRAY['owner'], 'إضافة حساب موظف أو مالك نظام');

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'معرّف حساب المستخدم مطلوب.';
  END IF;
  IF v_full_name IS NULL OR CHAR_LENGTH(v_full_name) < 2 OR CHAR_LENGTH(v_full_name) > 120 THEN
    RAISE EXCEPTION 'اسم المستخدم يجب أن يكون بين حرفين و120 حرفًا.';
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^[0-9+() -]{7,24}$' THEN
    RAISE EXCEPTION 'رقم الهاتف غير صالح.';
  END IF;

  SELECT id INTO v_role_id FROM public.roles WHERE code = v_role_code;
  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'الدور المحدد غير معتمد.';
  END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches WHERE id = p_branch_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'الفرع المحدد غير موجود أو غير فعّال.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'هذا الحساب مرتبط بمستخدم بالفعل.';
  END IF;

  INSERT INTO public.profiles (id, full_name, phone, job_title, branch_id, is_active)
  VALUES (p_user_id, v_full_name, v_phone, v_job_title, p_branch_id, true);
  INSERT INTO public.user_roles (user_id, role_id) VALUES (p_user_id, v_role_id);

  INSERT INTO public.audit_logs (user_id, action, entity_name, entity_id, details)
  VALUES (
    auth.uid(),
    CASE WHEN v_role_code = 'owner' THEN 'إنشاء مالك نظام إضافي' ELSE 'إنشاء حساب موظف' END,
    'staff_account', p_user_id,
    jsonb_build_object('full_name', v_full_name, 'role_code', v_role_code, 'branch_id', p_branch_id, 'has_phone', v_phone IS NOT NULL)
  );

  RETURN jsonb_build_object('success', true, 'userId', p_user_id,
    'message', CASE WHEN v_role_code = 'owner' THEN 'تم إنشاء مالك النظام الإضافي.' ELSE 'تم إنشاء حساب الموظف وتعيين صلاحياته.' END);
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
  v_target_is_owner BOOLEAN := false;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'], 'تعديل حساب موظف أو مالك نظام');

  IF p_user_id IS NULL OR p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'لا يمكن تعديل حسابك الحالي من إدارة المستخدمين.';
  END IF;
  IF v_full_name IS NULL OR CHAR_LENGTH(v_full_name) < 2 OR CHAR_LENGTH(v_full_name) > 120 THEN
    RAISE EXCEPTION 'اسم المستخدم يجب أن يكون بين حرفين و120 حرفًا.';
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^[0-9+() -]{7,24}$' THEN
    RAISE EXCEPTION 'رقم الهاتف غير صالح.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'حساب المستخدم غير موجود.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles assignment
    JOIN public.roles role ON role.id = assignment.role_id
    WHERE assignment.user_id = p_user_id AND role.code = 'owner'
  ) INTO v_target_is_owner;

  -- Serialise owner demotions so two owners cannot demote each other at once.
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtext('nawasrah_active_owner_guard'));

  IF v_target_is_owner AND v_role_code <> 'owner' AND (
    SELECT COUNT(*)
    FROM public.profiles profile
    JOIN public.user_roles assignment ON assignment.user_id = profile.id
    JOIN public.roles role ON role.id = assignment.role_id
    WHERE profile.is_active = true AND role.code = 'owner'
  ) <= 1 THEN
    RAISE EXCEPTION 'لا يمكن خفض صلاحية آخر مالك نظام نشط.';
  END IF;

  SELECT id INTO v_role_id FROM public.roles WHERE code = v_role_code;
  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'الدور المحدد غير معتمد.';
  END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches WHERE id = p_branch_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'الفرع المحدد غير موجود أو غير فعّال.';
  END IF;

  UPDATE public.profiles
  SET full_name = v_full_name, phone = v_phone, job_title = v_job_title, branch_id = p_branch_id
  WHERE id = p_user_id;
  DELETE FROM public.user_roles WHERE user_id = p_user_id;
  INSERT INTO public.user_roles (user_id, role_id) VALUES (p_user_id, v_role_id);

  INSERT INTO public.audit_logs (user_id, action, entity_name, entity_id, details)
  VALUES (
    auth.uid(),
    CASE WHEN v_role_code = 'owner' THEN 'تعيين أو تعديل مالك نظام' ELSE 'تعديل حساب مستخدم' END,
    'staff_account', p_user_id,
    jsonb_build_object('full_name', v_full_name, 'role_code', v_role_code, 'branch_id', p_branch_id, 'was_owner', v_target_is_owner, 'has_phone', v_phone IS NOT NULL)
  );

  RETURN jsonb_build_object('success', true, 'userId', p_user_id,
    'message', CASE WHEN v_role_code = 'owner' THEN 'تم حفظ صلاحيات مالك النظام.' ELSE 'تم تحديث بيانات المستخدم وصلاحياته.' END);
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
  v_target_is_owner BOOLEAN := false;
  v_is_active BOOLEAN := COALESCE(p_is_active, false);
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'], 'تفعيل أو تعطيل حساب مستخدم');

  IF p_user_id IS NULL OR p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'لا يمكن تعطيل أو تعديل حسابك الحالي.';
  END IF;
  SELECT profile.full_name INTO v_full_name FROM public.profiles profile WHERE profile.id = p_user_id;
  IF v_full_name IS NULL THEN
    RAISE EXCEPTION 'حساب المستخدم غير موجود.';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles assignment
    JOIN public.roles role ON role.id = assignment.role_id
    WHERE assignment.user_id = p_user_id AND role.code = 'owner'
  ) INTO v_target_is_owner;

  -- Serialise owner deactivations so there is always an active owner left.
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtext('nawasrah_active_owner_guard'));

  IF NOT v_is_active AND v_target_is_owner AND (
    SELECT COUNT(*)
    FROM public.profiles profile
    JOIN public.user_roles assignment ON assignment.user_id = profile.id
    JOIN public.roles role ON role.id = assignment.role_id
    WHERE profile.is_active = true AND role.code = 'owner'
  ) <= 1 THEN
    RAISE EXCEPTION 'لا يمكن تعطيل آخر مالك نظام نشط.';
  END IF;

  UPDATE public.profiles SET is_active = v_is_active WHERE id = p_user_id;
  INSERT INTO public.audit_logs (user_id, action, entity_name, entity_id, details)
  VALUES (
    auth.uid(),
    CASE
      WHEN v_target_is_owner AND v_is_active THEN 'تفعيل مالك نظام'
      WHEN v_target_is_owner THEN 'تعطيل مالك نظام'
      WHEN v_is_active THEN 'تفعيل حساب مستخدم'
      ELSE 'تعطيل حساب مستخدم'
    END,
    'staff_account', p_user_id,
    jsonb_build_object('full_name', v_full_name, 'is_active', v_is_active, 'is_owner', v_target_is_owner)
  );
  RETURN jsonb_build_object('success', true, 'userId', p_user_id, 'isActive', v_is_active,
    'message', CASE WHEN v_is_active THEN 'تم تفعيل الحساب.' ELSE 'تم تعطيل الحساب.' END);
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
  v_target_is_owner BOOLEAN := false;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'], 'إعادة تعيين كلمة مرور مستخدم');
  IF p_user_id IS NULL OR p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'لا يمكن إعادة تعيين كلمة مرور حسابك الحالي من هذه الشاشة.';
  END IF;
  SELECT profile.full_name INTO v_full_name FROM public.profiles profile WHERE profile.id = p_user_id;
  IF v_full_name IS NULL THEN
    RAISE EXCEPTION 'حساب المستخدم غير موجود.';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles assignment
    JOIN public.roles role ON role.id = assignment.role_id
    WHERE assignment.user_id = p_user_id AND role.code = 'owner'
  ) INTO v_target_is_owner;

  INSERT INTO public.audit_logs (user_id, action, entity_name, entity_id, details)
  VALUES (
    auth.uid(),
    CASE WHEN v_target_is_owner THEN 'إعادة تعيين كلمة مرور مالك نظام' ELSE 'إعادة تعيين كلمة مرور مستخدم' END,
    'staff_account', p_user_id,
    jsonb_build_object('full_name', v_full_name, 'is_owner', v_target_is_owner)
  );
  RETURN jsonb_build_object('success', true, 'userId', p_user_id, 'message', 'تم تسجيل إعادة تعيين كلمة المرور.');
END;
$$;

REVOKE ALL ON FUNCTION public.create_erp_staff_account_record(UUID, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_erp_staff_account_record(UUID, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_erp_staff_account_active(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_erp_staff_password_reset(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_erp_staff_account_record(UUID, TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_erp_staff_account_record(UUID, TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_erp_staff_account_active(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_erp_staff_password_reset(UUID) TO authenticated;

COMMIT;
