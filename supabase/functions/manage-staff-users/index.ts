import {createClient} from 'npm:@supabase/supabase-js@2.110.8';

type StaffAction =
  | 'list'
  | 'audit'
  | 'create'
  | 'update'
  | 'set_active'
  | 'set_password';

interface StaffRequestBody {
  action?: StaffAction;
  userId?: string;
  fullName?: string;
  email?: string;
  phone?: string | null;
  roleCode?: string;
  branchId?: string | null;
  jobTitle?: string | null;
  isActive?: boolean;
  password?: string;
}

interface StaffRow {
  user_id: string;
  role_code: string | null;
}

const approvedOrigins = new Set([
  'https://nawasrah-admin.pages.dev',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
]);

const isApprovedOrigin = (origin: string | null) => {
  if (!origin) return false;
  if (approvedOrigins.has(origin)) return true;
  return /^https:\/\/[a-z0-9-]+\.nawasrah-admin\.pages\.dev$/i.test(origin);
};

const corsHeaders = (origin: string | null): HeadersInit => ({
  'Access-Control-Allow-Origin': isApprovedOrigin(origin) ? origin! : 'null',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  Vary: 'Origin',
});

const jsonResponse = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), {status, headers: corsHeaders(origin)});

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const validRoleCodes = new Set([
  'admin',
  'manager',
  'accountant',
  'cashier',
  'sales',
  'warehouse_keeper',
  'orders',
  'delivery_driver',
  'view_only',
]);

const normalizeOptionalText = (value: unknown, maxLength: number) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
};

const normalizeEmail = (value: unknown) => {
  const email = normalizeOptionalText(value, 254)?.toLowerCase() || '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
};

const validatePassword = (value: unknown) => {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) {
    return 'كلمة المرور يجب أن تكون بين 10 و128 حرفًا.';
  }
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    return 'كلمة المرور يجب أن تحتوي على حرف ورقم على الأقل.';
  }
  return null;
};

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: isApprovedOrigin(origin) ? 204 : 403,
      headers: corsHeaders(origin),
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse({error: 'Method not allowed'}, 405, origin);
  }
  if (!isApprovedOrigin(origin)) {
    return jsonResponse({error: 'Origin is not allowed'}, 403, origin);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('authorization') || '';

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({error: 'Staff management is not configured'}, 503, origin);
  }
  if (!authorization.startsWith('Bearer ')) {
    return jsonResponse({error: 'Unauthorized'}, 401, origin);
  }

  let body: StaffRequestBody;
  try {
    body = (await request.json()) as StaffRequestBody;
  } catch {
    return jsonResponse({error: 'Invalid JSON payload'}, 400, origin);
  }

  const caller = createClient(supabaseUrl, anonKey, {
    auth: {persistSession: false, autoRefreshToken: false},
    global: {headers: {Authorization: authorization}},
  });
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: {persistSession: false, autoRefreshToken: false},
  });

  const token = authorization.slice('Bearer '.length);
  const {data: callerData, error: callerError} = await caller.auth.getUser(token);
  if (callerError || !callerData.user) {
    return jsonResponse({error: 'Unauthorized'}, 401, origin);
  }

  const loadStaff = async () => {
    const result = await caller.rpc('get_erp_staff_accounts');
    if (result.error || !Array.isArray(result.data)) {
      return {error: result.error?.message || 'Unable to load staff accounts'};
    }
    return {data: result.data as StaffRow[]};
  };

  const ensureManageableTarget = async (userId: unknown) => {
    if (!isUuid(userId) || userId === callerData.user.id) {
      return {error: 'Invalid staff account target'};
    }
    const staff = await loadStaff();
    if (!staff.data) return staff;
    const target = staff.data.find((row) => row.user_id === userId);
    if (!target || target.role_code === 'owner') {
      return {error: 'Invalid staff account target'};
    }
    return {data: target};
  };

  if (body.action === 'list') {
    const staff = await loadStaff();
    if (!staff.data) return jsonResponse({error: staff.error}, 403, origin);

    const {data: authUsers, error: authUsersError} = await service.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (authUsersError) {
      console.error('Unable to list auth users', authUsersError.code);
      return jsonResponse({error: 'Unable to load staff identities'}, 500, origin);
    }

    const identities = new Map(
      authUsers.users.map((user) => [
        user.id,
        {email: user.email || null, lastSignInAt: user.last_sign_in_at || null},
      ]),
    );
    return jsonResponse(
      {
        data: staff.data.map((row) => ({
          ...row,
          email: identities.get(row.user_id)?.email || null,
          last_sign_in_at: identities.get(row.user_id)?.lastSignInAt || null,
        })),
      },
      200,
      origin,
    );
  }

  if (body.action === 'audit') {
    const {data, error} = await caller.rpc('get_erp_staff_account_audit_logs', {
      p_limit: 100,
    });
    if (error) return jsonResponse({error: error.message}, 403, origin);
    return jsonResponse({data: data || []}, 200, origin);
  }

  if (body.action === 'create') {
    const fullName = normalizeOptionalText(body.fullName, 120);
    const email = normalizeEmail(body.email);
    const passwordError = validatePassword(body.password);
    const roleCode = normalizeOptionalText(body.roleCode, 40)?.toLowerCase() || '';
    const branchId = body.branchId === null || body.branchId === '' ? null : body.branchId;

    if (!fullName || !email || passwordError || !validRoleCodes.has(roleCode)) {
      return jsonResponse(
        {error: passwordError || 'بيانات الموظف أو الدور غير صحيحة.'},
        400,
        origin,
      );
    }
    if (branchId !== null && !isUuid(branchId)) {
      return jsonResponse({error: 'الفرع المحدد غير صالح.'}, 400, origin);
    }

    const {data: created, error: createError} = await service.auth.admin.createUser({
      email,
      password: body.password!,
      email_confirm: true,
      user_metadata: {full_name: fullName},
    });
    if (createError || !created.user) {
      return jsonResponse(
        {error: createError?.message || 'تعذر إنشاء حساب الدخول.'},
        409,
        origin,
      );
    }

    const {data, error} = await caller.rpc('create_erp_staff_account_record', {
      p_user_id: created.user.id,
      p_full_name: fullName,
      p_phone: normalizeOptionalText(body.phone, 24),
      p_role_code: roleCode,
      p_branch_id: branchId,
      p_job_title: normalizeOptionalText(body.jobTitle, 120),
    });
    if (error) {
      const {error: rollbackError} = await service.auth.admin.deleteUser(created.user.id);
      if (rollbackError) console.error('Unable to rollback auth user', rollbackError.code);
      return jsonResponse({error: error.message}, 400, origin);
    }
    return jsonResponse({data}, 201, origin);
  }

  if (body.action === 'update') {
    const target = await ensureManageableTarget(body.userId);
    const fullName = normalizeOptionalText(body.fullName, 120);
    const roleCode = normalizeOptionalText(body.roleCode, 40)?.toLowerCase() || '';
    const branchId = body.branchId === null || body.branchId === '' ? null : body.branchId;

    if (!target.data || !fullName || !validRoleCodes.has(roleCode)) {
      return jsonResponse({error: target.error || 'بيانات الموظف أو الدور غير صحيحة.'}, 400, origin);
    }
    if (branchId !== null && !isUuid(branchId)) {
      return jsonResponse({error: 'الفرع المحدد غير صالح.'}, 400, origin);
    }

    const {data, error} = await caller.rpc('update_erp_staff_account_record', {
      p_user_id: body.userId,
      p_full_name: fullName,
      p_phone: normalizeOptionalText(body.phone, 24),
      p_role_code: roleCode,
      p_branch_id: branchId,
      p_job_title: normalizeOptionalText(body.jobTitle, 120),
    });
    if (error) return jsonResponse({error: error.message}, 400, origin);

    const {error: metadataError} = await service.auth.admin.updateUserById(body.userId!, {
      user_metadata: {full_name: fullName},
    });
    if (metadataError) console.error('Unable to update auth metadata', metadataError.code);
    return jsonResponse({data}, 200, origin);
  }

  if (body.action === 'set_active') {
    const target = await ensureManageableTarget(body.userId);
    if (!target.data || typeof body.isActive !== 'boolean') {
      return jsonResponse({error: target.error || 'حالة الحساب غير صحيحة.'}, 400, origin);
    }

    // A disabled profile already fails ERP RLS/RPC guards. Ban the Auth identity
    // too, so a deactivated employee cannot start a fresh password session.
    const desiredBanDuration = body.isActive ? 'none' : '876000h';
    const previousBanDuration = body.isActive ? '876000h' : 'none';
    const {error: authStateError} = await service.auth.admin.updateUserById(body.userId, {
      ban_duration: desiredBanDuration,
    });
    if (authStateError) {
      return jsonResponse({error: 'تعذر تحديث قفل الدخول للحساب.'}, 503, origin);
    }

    const {data, error} = await caller.rpc('set_erp_staff_account_active', {
      p_user_id: body.userId,
      p_is_active: body.isActive,
    });
    if (error) {
      const {error: rollbackError} = await service.auth.admin.updateUserById(body.userId, {
        ban_duration: previousBanDuration,
      });
      if (rollbackError) console.error('Unable to rollback staff auth state', rollbackError.code);
      return jsonResponse({error: error.message}, 400, origin);
    }
    return jsonResponse({data}, 200, origin);
  }

  if (body.action === 'set_password') {
    const target = await ensureManageableTarget(body.userId);
    const passwordError = validatePassword(body.password);
    if (!target.data || passwordError) {
      return jsonResponse({error: target.error || passwordError}, 400, origin);
    }

    const {error: passwordUpdateError} = await service.auth.admin.updateUserById(body.userId!, {
      password: body.password!,
    });
    if (passwordUpdateError) {
      return jsonResponse({error: passwordUpdateError.message}, 400, origin);
    }
    const {data, error} = await caller.rpc('record_erp_staff_password_reset', {
      p_user_id: body.userId,
    });
    if (error) {
      console.error('Password reset audit failed', error.code);
      return jsonResponse(
        {error: 'تم تغيير كلمة المرور، لكن تعذر حفظ سجل التدقيق. راجع دعم النظام.'},
        500,
        origin,
      );
    }
    return jsonResponse({data}, 200, origin);
  }

  return jsonResponse({error: 'Invalid action'}, 400, origin);
});
