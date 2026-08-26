import { useState, useEffect } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  fetchUserProfileAndRole,
  translateAuthError,
  UserProfile,
} from '../services/supabase/auth.service';
import {
  translateMfaError,
  verifyTotpFactor,
} from '../services/supabase/mfa.service';
import { storeEngine } from './useAppStore';
import { Role } from '../types';

function readUserMetadataString(metadata: unknown, key: string): string | undefined {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return undefined;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readUserMetadataLanguage(metadata: unknown): 'ar' | 'en' | undefined {
  const value = readUserMetadataString(metadata, 'language');
  return value === 'ar' || value === 'en' ? value : undefined;
}

export interface AuthState {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  roles: string[];
  roleName: string | null;
  isAuthenticated: boolean;
  mfaRequired: boolean;
  mfaFactorId: string | null;
  mfaCurrentLevel: string | null;
  isLoading: boolean;
  authError: string | null;
}

class AuthStoreEngine {
  private state: AuthState = {
    user: null,
    session: null,
    profile: null,
    roles: [],
    roleName: null,
    isAuthenticated: false,
    mfaRequired: false,
    mfaFactorId: null,
    mfaCurrentLevel: null,
    isLoading: true,
    authError: null,
  };

  private listeners: Set<() => void> = new Set();
  private isInitialized = false;

  constructor() {
    //
  }

  public getState(): AuthState {
    return this.state;
  }

  public subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((listener) => listener());
  }

  private resetSessionState(clearError = true) {
    this.state.user = null;
    this.state.session = null;
    this.state.profile = null;
    this.state.roles = [];
    this.state.roleName = null;
    this.state.isAuthenticated = false;
    this.state.mfaRequired = false;
    this.state.mfaFactorId = null;
    this.state.mfaCurrentLevel = null;
    if (clearError) this.state.authError = null;
  }

  public async initAuth() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    this.state.isLoading = true;
    this.notify();

    if (!supabase || !isSupabaseConfigured) {
      console.warn('[AuthStore] Supabase is not configured, auth disabled.');
      this.state.isLoading = false;
      this.state.isAuthenticated = false;
      this.notify();
      return;
    }

    try {
      // 1. Get initial session
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();

      if (sessionErr) {
        console.error('[AuthStore] Error getting session:', sessionErr.message);
      }

      const initialSession = sessionData?.session || null;

      if (initialSession) {
        await this.handleUserSession(initialSession);
      } else {
        this.resetSessionState();
      }

      // 2. Listen to Auth changes
      supabase.auth.onAuthStateChange(async (event, newSession) => {
        console.log('[AuthStore] Auth event:', event);

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (newSession) {
            await this.handleUserSession(newSession);
          }
        } else if (event === 'SIGNED_OUT') {
          this.resetSessionState();
          this.notify();
        }
      });
    } catch (err: any) {
      console.error('[AuthStore] initAuth Exception:', err);
    } finally {
      this.state.isLoading = false;
      this.notify();
    }
  }

  private async handleUserSession(session: Session) {
    const user = session.user;
    this.state.session = session;
    this.state.user = user;
    this.state.isAuthenticated = false;

    if (!supabase) {
      this.resetSessionState(false);
      this.state.authError = 'تعذر الاتصال بخادم المصادقة.';
      this.notify();
      return;
    }

    // A user with a verified TOTP factor must finish the second factor before
    // any profile, role, inventory, or accounting data is requested.
    const { data: aalData, error: aalError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (aalError) {
      await supabase.auth.signOut();
      this.resetSessionState(false);
      this.state.authError = translateMfaError(aalError);
      this.notify();
      return;
    }

    this.state.mfaCurrentLevel = aalData.currentLevel;

    if (aalData.currentLevel === 'aal1' && aalData.nextLevel === 'aal2') {
      const { data: factorsData, error: factorsError } =
        await supabase.auth.mfa.listFactors();

      if (factorsError || !factorsData.totp[0]) {
        await supabase.auth.signOut();
        this.resetSessionState(false);
        this.state.authError = factorsError
          ? translateMfaError(factorsError)
          : 'تعذر العثور على تطبيق المصادقة المرتبط بهذا الحساب.';
        this.notify();
        return;
      }

      this.state.profile = null;
      this.state.roles = [];
      this.state.roleName = null;
      this.state.mfaRequired = true;
      this.state.mfaFactorId = factorsData.totp[0].id;
      this.state.authError = null;
      this.notify();
      return;
    }

    this.state.mfaRequired = false;
    this.state.mfaFactorId = null;

    // Fetch profile and roles from public tables
    const result = await fetchUserProfileAndRole(user.id);

    if (!result.isAuthorized) {
      console.warn('[AuthStore] User is not authorized:', result.reason);
      await supabase?.auth.signOut();

      this.resetSessionState(false);
      this.state.authError = result.reason || 'ليس لديك صلاحية لدخول لوحة الإدارة.';
      this.notify();
      return;
    }

    // Successfully authorized
    this.state.profile = result.profile;
    this.state.roles = result.roles;
    this.state.roleName = result.primaryRole;
    this.state.isAuthenticated = true;
    this.state.authError = null;

    // Map role string to application Role type
    let appRole: Role = 'View Only';
    const roleLower = (result.primaryRole || '').toLowerCase();
    if (roleLower === 'owner') appRole = 'Owner';
    if (roleLower === 'admin' || roleLower === 'manager') appRole = 'Admin';
    if (roleLower === 'accountant') appRole = 'Accountant';
    if (roleLower === 'cashier') appRole = 'Cashier';
    if (roleLower === 'sales') appRole = 'Sales Employee';
    if (roleLower === 'warehouse_keeper') appRole = 'Warehouse Employee';
    if (roleLower === 'orders') appRole = 'Orders Employee';
    if (roleLower === 'delivery_driver') appRole = 'Delivery Driver';

    const userMetadata = user.user_metadata;

    // Synchronize current logged-in user details to App Store. Profiles and
    // Auth metadata are the source of truth; no persisted UI user object is
    // allowed to overwrite these values.
    storeEngine.setCurrentUser({
      id: user.id,
      name:
        result.profile?.full_name ||
        result.profile?.name ||
        readUserMetadataString(userMetadata, 'full_name') ||
        user.email?.split('@')[0] ||
        'مستخدم نواصرة',
      email: user.email || result.profile?.email || '',
      phone: result.profile?.phone || user.phone || '',
      avatarUrl:
        result.profile?.avatar_url ||
        readUserMetadataString(userMetadata, 'avatar_url') ||
        undefined,
      branchId: result.profile?.branch_id || storeEngine.getState().activeBranch?.id || '',
      jobTitle: result.profile?.job_title || undefined,
      language: readUserMetadataLanguage(userMetadata),
      timezone: readUserMetadataString(userMetadata, 'timezone'),
      address: readUserMetadataString(userMetadata, 'address'),
      whatsapp: readUserMetadataString(userMetadata, 'whatsapp'),
      role: appRole,
      isActive: true,
    });

    this.notify();

    // Product/reference data is non-critical for finishing authentication.
    // Warm it after the first screen gets a chance to request its own data.
    const warmProductData = () => {
      void storeEngine.refreshProductsFromSupabase().catch((err) => {
        console.warn('[AuthStore] Failed refreshing products after auth update:', err);
      });
    };
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(warmProductData, {timeout: 1_500});
    } else {
      window.setTimeout(warmProductData, 250);
    }
  }

  public async signIn(
    email: string,
    password: string,
    captchaToken: string
  ): Promise<{ success: boolean; mfaRequired?: boolean; error?: string }> {
    if (!supabase || !isSupabaseConfigured) {
      return { success: false, error: 'تكوين Supabase غير مكتمل. يرجى التأكد من الإعدادات.' };
    }

    this.state.authError = null;
    this.notify();

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
        options: { captchaToken },
      });

      if (error) {
        const arabicError = translateAuthError(error.message);
        this.state.authError = arabicError;
        this.notify();
        return { success: false, error: arabicError };
      }

      if (!data.session || !data.user) {
        const err = 'تعذر الحصول على جلسة الدخول من الخادم';
        this.state.authError = err;
        this.notify();
        return { success: false, error: err };
      }

      // Handle user authorization & session setup
      await this.handleUserSession(data.session);

      if (this.state.mfaRequired) {
        return { success: true, mfaRequired: true };
      }

      if (!this.state.isAuthenticated) {
        return {
          success: false,
          error: this.state.authError || 'ليس لديك صلاحية لدخول لوحة الإدارة.',
        };
      }

      return { success: true };
    } catch (err: any) {
      console.error('[AuthStore] signIn Exception:', err);
      const arabicError = translateAuthError(err?.message || String(err));
      this.state.authError = arabicError;
      this.notify();
      return { success: false, error: arabicError };
    }
  }

  public async refreshCurrentUser(): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (!supabase || !isSupabaseConfigured) {
      return {success: false, error: 'تعذر الاتصال بخادم المصادقة.'};
    }

    const {data, error} = await supabase.auth.getSession();
    if (error || !data.session) {
      return {
        success: false,
        error: error?.message || 'انتهت جلسة الحساب. سجّل الدخول مجددًا.',
      };
    }

    await this.handleUserSession(data.session);
    return this.state.isAuthenticated
      ? {success: true}
      : {
          success: false,
          error: this.state.authError || 'تعذر تحديث بيانات الحساب.',
        };
  }

  public async verifyMfa(code: string): Promise<{ success: boolean; error?: string }> {
    if (!supabase || !this.state.mfaFactorId) {
      const error = 'لا توجد جلسة تحقق ثنائي نشطة. أعد تسجيل الدخول.';
      this.state.authError = error;
      this.notify();
      return { success: false, error };
    }

    this.state.authError = null;
    this.notify();

    try {
      await verifyTotpFactor(this.state.mfaFactorId, code);
      const { data, error: sessionError } = await supabase.auth.getSession();

      if (sessionError || !data.session) {
        throw sessionError || new Error('تعذر تحديث جلسة الدخول بعد التحقق.');
      }

      await this.handleUserSession(data.session);

      if (!this.state.isAuthenticated) {
        return {
          success: false,
          error: this.state.authError || 'تعذر إكمال تسجيل الدخول الآمن.',
        };
      }

      return { success: true };
    } catch (error) {
      const arabicError = translateMfaError(error);
      this.state.authError = arabicError;
      this.notify();
      return { success: false, error: arabicError };
    }
  }

  public async cancelMfa(): Promise<void> {
    await this.signOut();
  }

  public async signOut(): Promise<void> {
    try {
      if (supabase) {
        await supabase.auth.signOut();
      }
    } catch (err) {
      console.error('[AuthStore] signOut Error:', err);
    } finally {
      this.resetSessionState();
      this.notify();
    }
  }

  public clearError() {
    this.state.authError = null;
    this.notify();
  }
}

export const authStoreEngine = new AuthStoreEngine();

export function useAuthStore() {
  const [state, setState] = useState<AuthState>(authStoreEngine.getState());

  useEffect(() => {
    // Initialize Auth session check on mount
    authStoreEngine.initAuth();

    const unsubscribe = authStoreEngine.subscribe(() => {
      setState({ ...authStoreEngine.getState() });
    });

    return unsubscribe;
  }, []);

  return {
    ...state,
    signIn: (e: string, p: string, captchaToken: string) =>
      authStoreEngine.signIn(e, p, captchaToken),
    verifyMfa: (code: string) => authStoreEngine.verifyMfa(code),
    cancelMfa: () => authStoreEngine.cancelMfa(),
    refreshCurrentUser: () => authStoreEngine.refreshCurrentUser(),
    signOut: () => authStoreEngine.signOut(),
    clearError: () => authStoreEngine.clearError(),
  };
}
