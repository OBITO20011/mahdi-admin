import { supabase, isSupabaseConfigured } from '../../lib/supabase';

export const ERP_APP_ROLE_CODES = [
  'owner',
  'admin',
  'manager',
  'accountant',
  'cashier',
  'sales',
  'warehouse_keeper',
  'orders',
  'delivery_driver',
  'view_only',
] as const;

const ERP_APP_ROLE_CODE_SET = new Set<string>(ERP_APP_ROLE_CODES);

export function isAuthorizedErpRole(role?: string | null): boolean {
  return ERP_APP_ROLE_CODE_SET.has((role || '').trim().toLowerCase());
}

export interface UserProfile {
  id: string;
  full_name?: string;
  name?: string;
  email?: string;
  phone?: string;
  avatar_url?: string;
  branch_id?: string;
  job_title?: string;
  is_active?: boolean;
}

export interface UserRoleInfo {
  role_id?: string;
  role_code?: string;
  role_name?: string;
  roles?: {
    id?: string;
    name_ar?: string;
    code?: string;
  };
}

export interface FetchUserResult {
  profile: UserProfile | null;
  roles: string[];
  primaryRole: string;
  isAuthorized: boolean;
  reason?: string;
}

export interface UpdateMyProfileInput {
  fullName: string;
  phone: string;
  email: string;
  avatarUrl: string;
  language: 'ar' | 'en';
  timezone: string;
  address: string;
  whatsapp: string;
}

export interface UpdateMyProfileResult {
  emailConfirmationRequired: boolean;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Translate raw Supabase Auth errors to Arabic
 */
export function translateAuthError(errorMessage?: string): string {
  if (!errorMessage) return 'حدث خطأ في عملية المصادقة';

  const msg = errorMessage.toLowerCase();

  if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
    return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  }
  if (msg.includes('email not confirmed')) {
    return 'البريد الإلكتروني غير مؤكد بعد. يرجى تأكيد البريد قبل الدخول.';
  }
  if (msg.includes('user not found')) {
    return 'البريد الإلكتروني غير مسجل في النظام';
  }
  if (msg.includes('too many requests') || msg.includes('rate limit')) {
    return 'محاولات دخول كثيرة خاطئة، يرجى الانتظار دقيقة وإعادة المحاولة';
  }
  if (msg.includes('captcha')) {
    return 'تعذر التحقق البشري. أعد التحقق من Cloudflare ثم حاول تسجيل الدخول.';
  }
  if (msg.includes('network') || msg.includes('fetch')) {
    return 'تعذر الاتصال بخادم الخادم. يرجى التحقق من اتصال الإنترنت';
  }

  return `خطأ في تسجيل الدخول: ${errorMessage}`;
}

export function translateAccountUpdateError(error: unknown): string {
  const message = getErrorMessage(error, 'تعذر تحديث بيانات الحساب.');
  const normalized = message.toLowerCase();

  if (normalized.includes('reauthentication')) {
    return 'يتطلب هذا التغيير تسجيل دخول حديثًا. سجّل الخروج ثم ادخل مرة أخرى وحاول.';
  }
  if (normalized.includes('same password')) {
    return 'كلمة المرور الجديدة مطابقة لكلمة المرور الحالية. اختر كلمة مختلفة.';
  }
  if (normalized.includes('password')) {
    return 'تعذر تحديث كلمة المرور. تأكد من استيفاء متطلبات الأمان ثم حاول.';
  }
  if (normalized.includes('email')) {
    return 'تعذر تحديث البريد الإلكتروني. تأكد من صحة البريد أو استخدم بريدًا غير مستخدم.';
  }

  return message;
}

export async function updateMyProfileInSupabase(
  input: UpdateMyProfileInput,
): Promise<UpdateMyProfileResult> {
  if (!supabase || !isSupabaseConfigured) {
    throw new Error('إعداد Supabase غير مكتمل. لا يمكن تحديث الملف الشخصي الآن.');
  }

  const fullName = input.fullName.trim();
  const phone = input.phone.trim();
  const email = input.email.trim();
  const avatarUrl = input.avatarUrl.trim();

  const {data: currentUserData, error: currentUserError} =
    await supabase.auth.getUser();
  if (currentUserError || !currentUserData.user) {
    throw currentUserError || new Error('انتهت جلسة الحساب. سجّل الدخول مجددًا.');
  }

  const currentUser = currentUserData.user;
  const emailChanged =
    email.toLocaleLowerCase() !== (currentUser.email || '').toLocaleLowerCase();

  const {data: authUpdateData, error: authUpdateError} =
    await supabase.auth.updateUser({
      ...(emailChanged ? {email} : {}),
      data: {
        language: input.language,
        timezone: input.timezone.trim(),
        address: input.address.trim(),
        whatsapp: input.whatsapp.trim(),
      },
    });

  if (authUpdateError || !authUpdateData.user) {
    throw authUpdateError || new Error('تعذر تحديث إعدادات حساب Supabase.');
  }

  const {data: profilePayload, error: profileError} = await supabase.rpc(
    'update_my_erp_profile',
    {
      p_full_name: fullName,
      p_phone: phone || null,
      p_avatar_url: avatarUrl || null,
    },
  );

  if (profileError) {
    throw profileError;
  }

  if (
    !profilePayload ||
    typeof profilePayload !== 'object' ||
    !('success' in profilePayload) ||
    profilePayload.success !== true
  ) {
    throw new Error('لم تؤكد قاعدة البيانات حفظ الملف الشخصي.');
  }

  return {
    emailConfirmationRequired:
      emailChanged &&
      authUpdateData.user.email.toLocaleLowerCase() !== email.toLocaleLowerCase(),
  };
}

export async function updateMyPasswordInSupabase(
  newPassword: string,
): Promise<void> {
  if (!supabase || !isSupabaseConfigured) {
    throw new Error('إعداد Supabase غير مكتمل. لا يمكن تحديث كلمة المرور الآن.');
  }

  const {error} = await supabase.auth.updateUser({password: newPassword});
  if (error) {
    throw error;
  }
}

/**
 * Fetch profile and role from Supabase tables (public.profiles and public.user_roles)
 */
export async function fetchUserProfileAndRole(userId: string): Promise<FetchUserResult> {
  if (!supabase || !isSupabaseConfigured) {
    return {
      profile: null,
      roles: [],
      primaryRole: '',
      isAuthorized: false,
      reason: 'تكوين Supabase غير مكتمل.',
    };
  }

  try {
    // 1. Fetch profile from public.profiles
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('id, full_name, phone, avatar_url, branch_id, job_title, is_active')
      .eq('id', userId)
      .maybeSingle();

    if (profileErr) {
      console.error('[Supabase Auth Service] Error fetching profiles table:', profileErr);
      return {
        profile: null,
        roles: [],
        primaryRole: '',
        isAuthorized: false,
        reason: 'تعذر التحقق من ملف المستخدم الإداري.',
      };
    }

    if (!profile) {
      return {
        profile: null,
        roles: [],
        primaryRole: '',
        isAuthorized: false,
        reason: 'هذا الحساب غير مرتبط بملف موظف معتمد.',
      };
    }

    // 2. Fetch user roles from public.user_roles
    let rolesList: string[] = [];

    const { data: userRoles, error: rolesErr } = await supabase
      .from('user_roles')
      .select('role_id, roles(id, name_ar, code)')
      .eq('user_id', userId);

    if (rolesErr) {
      console.warn('[Supabase Auth Service] Warning fetching user_roles:', rolesErr.message);
      return {
        profile,
        roles: [],
        primaryRole: '',
        isAuthorized: false,
        reason: 'تعذر التحقق من دور الحساب وصلاحياته.',
      };
    } else if (userRoles && userRoles.length > 0) {
      rolesList = userRoles
        .map((r: any) => String(r.roles?.code || '').trim().toLowerCase())
        .filter(Boolean);
    }

    const primaryRole = rolesList.find(isAuthorizedErpRole) || '';

    if (!primaryRole) {
      return {
        profile,
        roles: rolesList,
        primaryRole: '',
        isAuthorized: false,
        reason: 'هذا الحساب لا يملك دورًا معتمدًا لاستخدام نظام الإدارة.',
      };
    }

    // 3. Authorization Check
    const isActive = profile.is_active === true;

    if (!isActive) {
      return {
        profile,
        roles: rolesList,
        primaryRole,
        isAuthorized: false,
        reason: 'حسابك معطل حالياً. ليس لديك صلاحية لدخول لوحة الإدارة.',
      };
    }

    return {
      profile,
      roles: rolesList,
      primaryRole,
      isAuthorized: true,
    };
  } catch (err: any) {
    console.error('[Supabase Auth Service] Exception fetching profile/role:', err);
    return {
      profile: null,
      roles: [],
      primaryRole: '',
      isAuthorized: false,
      reason: err?.message || 'حدث خطأ عند جلب بيانات الصلاحيات والملف الشخصي.',
    };
  }
}
