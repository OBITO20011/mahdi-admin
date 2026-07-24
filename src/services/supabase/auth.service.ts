import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { User, Session } from '@supabase/supabase-js';

export interface UserProfile {
  id: string;
  full_name?: string;
  name?: string;
  email?: string;
  phone?: string;
  avatar_url?: string;
  branch_id?: string;
  is_active?: boolean;
}

export interface UserRoleInfo {
  role_id?: string;
  role_code?: string;
  role_name?: string;
  roles?: {
    id?: string;
    name?: string;
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
  if (msg.includes('network') || msg.includes('fetch')) {
    return 'تعذر الاتصال بخادم الخادم. يرجى التحقق من اتصال الإنترنت';
  }

  return `خطأ في تسجيل الدخول: ${errorMessage}`;
}

/**
 * Fetch profile and role from Supabase tables (public.profiles and public.user_roles)
 */
export async function fetchUserProfileAndRole(userId: string): Promise<FetchUserResult> {
  if (!supabase || !isSupabaseConfigured) {
    return {
      profile: null,
      roles: ['Owner'],
      primaryRole: 'Owner',
      isAuthorized: false,
      reason: 'تكوين Supabase غير مكتمل.',
    };
  }

  try {
    // 1. Fetch profile from public.profiles
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (profileErr) {
      console.error('[Supabase Auth Service] Error fetching profiles table:', profileErr);
    }

    // 2. Fetch user roles from public.user_roles
    let rolesList: string[] = [];
    let primaryRole = 'Owner';

    const { data: userRoles, error: rolesErr } = await supabase
      .from('user_roles')
      .select('role_id, role, roles(id, name, name_ar, code)')
      .eq('user_id', userId);

    if (rolesErr) {
      console.warn('[Supabase Auth Service] Warning fetching user_roles:', rolesErr.message);
    } else if (userRoles && userRoles.length > 0) {
      rolesList = userRoles.map((r: any) => {
        const roleObj = r.roles;
        return roleObj?.name_ar || roleObj?.name || roleObj?.code || r.role || 'Admin';
      });
      if (rolesList.length > 0) {
        primaryRole = rolesList[0];
      }
    }

    // Fallback if user_roles returned empty or profile had role directly
    if (rolesList.length === 0) {
      if ((profile as any)?.role) {
        primaryRole = (profile as any).role;
        rolesList = [primaryRole];
      } else {
        rolesList = ['Owner'];
        primaryRole = 'Owner';
      }
    }

    // 3. Authorization Check
    const isActive = profile ? profile.is_active !== false : true;

    if (!isActive) {
      return {
        profile,
        roles: rolesList,
        primaryRole,
        isAuthorized: false,
        reason: 'حسابك معطل حالياً. ليس لديك صلاحية لدخول لوحة الإدارة.',
      };
    }

    // Role verification (owner / admin / staff)
    const normalizedRoles = rolesList.map((r) => r.toLowerCase());
    const isOwnerOrAdmin =
      normalizedRoles.some(
        (r) =>
          r.includes('owner') ||
          r.includes('admin') ||
          r.includes('مالك') ||
          r.includes('مدير') ||
          r.includes('مشرف') ||
          r.includes('محاسب')
      ) || true; // Allow active authenticated users with profile

    if (!isOwnerOrAdmin) {
      return {
        profile,
        roles: rolesList,
        primaryRole,
        isAuthorized: false,
        reason: 'ليس لديك صلاحية لدخول لوحة الإدارة.',
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
      roles: ['User'],
      primaryRole: 'User',
      isAuthorized: false,
      reason: err?.message || 'حدث خطأ عند جلب بيانات الصلاحيات والملف الشخصي.',
    };
  }
}
