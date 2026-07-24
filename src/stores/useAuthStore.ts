import { useState, useEffect } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  fetchUserProfileAndRole,
  translateAuthError,
  UserProfile,
} from '../services/supabase/auth.service';
import { storeEngine } from './useAppStore';
import { Role } from '../types';

export interface AuthState {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  roles: string[];
  roleName: string | null;
  isAuthenticated: boolean;
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
        this.state.user = null;
        this.state.session = null;
        this.state.profile = null;
        this.state.roles = [];
        this.state.roleName = null;
        this.state.isAuthenticated = false;
      }

      // 2. Listen to Auth changes
      supabase.auth.onAuthStateChange(async (event, newSession) => {
        console.log('[AuthStore] Auth event:', event);

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (newSession) {
            await this.handleUserSession(newSession);
          }
        } else if (event === 'SIGNED_OUT') {
          this.state.user = null;
          this.state.session = null;
          this.state.profile = null;
          this.state.roles = [];
          this.state.roleName = null;
          this.state.isAuthenticated = false;
          this.state.authError = null;
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

    // Fetch profile and roles from public tables
    const result = await fetchUserProfileAndRole(user.id);

    if (!result.isAuthorized) {
      console.warn('[AuthStore] User is not authorized:', result.reason);
      await supabase?.auth.signOut();

      this.state.user = null;
      this.state.session = null;
      this.state.profile = null;
      this.state.roles = [];
      this.state.roleName = null;
      this.state.isAuthenticated = false;
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
    let appRole: Role = 'Owner';
    const roleLower = (result.primaryRole || '').toLowerCase();
    if (roleLower.includes('admin') || roleLower.includes('مدير')) appRole = 'Admin';
    if (roleLower.includes('account') || roleLower.includes('محاسب')) appRole = 'Accountant';
    if (roleLower.includes('cashier') || roleLower.includes('كاشير')) appRole = 'Cashier';
    if (roleLower.includes('sales') || roleLower.includes('مبيعات')) appRole = 'Sales Employee';
    if (roleLower.includes('warehouse') || roleLower.includes('مخزن')) appRole = 'Warehouse Employee';

    // Synchronize current logged-in user details to App Store
    storeEngine.setCurrentUser({
      id: user.id,
      name:
        result.profile?.full_name ||
        result.profile?.name ||
        user.user_metadata?.full_name ||
        user.email?.split('@')[0] ||
        'مستخدم نواصرة',
      email: user.email || result.profile?.email || '',
      phone: result.profile?.phone || user.phone || '0790000000',
      avatarUrl:
        result.profile?.avatar_url ||
        user.user_metadata?.avatar_url ||
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
      role: appRole,
      isActive: true,
    });

    this.notify();

    // Trigger store refresh so Supabase diagnostic badges immediately show 'authenticated'
    try {
      await storeEngine.refreshProductsFromSupabase();
    } catch (err) {
      console.warn('[AuthStore] Failed refreshing products after auth update:', err);
    }
  }

  public async signIn(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    if (!supabase || !isSupabaseConfigured) {
      return { success: false, error: 'تكوين Supabase غير مكتمل. يرجى التأكد من الإعدادات.' };
    }

    this.state.authError = null;
    this.notify();

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
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

  public async signOut(): Promise<void> {
    try {
      if (supabase) {
        await supabase.auth.signOut();
      }
    } catch (err) {
      console.error('[AuthStore] signOut Error:', err);
    } finally {
      this.state.user = null;
      this.state.session = null;
      this.state.profile = null;
      this.state.roles = [];
      this.state.roleName = null;
      this.state.isAuthenticated = false;
      this.state.authError = null;
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
    signIn: (e: string, p: string) => authStoreEngine.signIn(e, p),
    signOut: () => authStoreEngine.signOut(),
    clearError: () => authStoreEngine.clearError(),
  };
}
