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
import {
  type AdminSessionSecuritySnapshot,
  createAdminSessionSecuritySnapshot,
  evaluateAdminSessionSecurity,
  getAdminSessionSecurityStorageKey,
  lockAdminSession,
  readAdminSessionSecuritySnapshot,
  recordAdminSessionActivity,
  removeAdminSessionSecuritySnapshot,
  unlockAdminSession,
  writeAdminSessionSecuritySnapshot,
} from '../services/sessionSecurity.service';

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
  isSessionLocked: boolean;
  absoluteSessionStartedAt: number | null;
  lastActivityAt: number | null;
  isLoading: boolean;
  authError: string | null;
}

type AuthIntent = 'full-login' | 'unlock-reauth' | null;

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
    isSessionLocked: false,
    absoluteSessionStartedAt: null,
    lastActivityAt: null,
    isLoading: true,
    authError: null,
  };

  private listeners: Set<() => void> = new Set();
  private isInitialized = false;
  private authIntent: AuthIntent = null;
  private pendingFullLoginUserId: string | null = null;
  private unlockMfaFactorId: string | null = null;
  private sessionSecuritySnapshot: AdminSessionSecuritySnapshot | null = null;
  private sessionSecurityTimer: number | null = null;
  private sessionSecurityListenersAttached = false;
  private isExpiringAbsoluteSession = false;

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

  private applySessionSecuritySnapshot(
    snapshot: AdminSessionSecuritySnapshot,
  ) {
    const wasLocked = this.state.isSessionLocked;
    this.sessionSecuritySnapshot = snapshot;
    this.state.absoluteSessionStartedAt = snapshot.absoluteSessionStartedAt;
    this.state.lastActivityAt = snapshot.lastActivityAt;
    this.state.isSessionLocked = snapshot.lockedAt !== null;

    if (!wasLocked && this.state.isSessionLocked) {
      storeEngine.closeModal();
      storeEngine.toggleQuickAction(false);
    }

    this.notify();
  }

  private persistSessionSecuritySnapshot(
    snapshot: AdminSessionSecuritySnapshot,
  ) {
    writeAdminSessionSecuritySnapshot(snapshot);
    this.applySessionSecuritySnapshot(snapshot);
  }

  private stopSessionSecurityTracking() {
    if (this.sessionSecurityTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.sessionSecurityTimer);
    }
    this.sessionSecurityTimer = null;
    this.sessionSecuritySnapshot = null;
  }

  private attachSessionSecurityListeners() {
    if (
      this.sessionSecurityListenersAttached ||
      typeof window === 'undefined' ||
      typeof document === 'undefined'
    ) {
      return;
    }

    const recordTrustedActivity = (event: Event) => {
      if (!event.isTrusted) return;
      this.recordSessionActivity();
    };
    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void this.evaluateCurrentSessionSecurity();
      }
    };
    const syncFromAnotherTab = (event: StorageEvent) => {
      const currentUserId = this.state.user?.id;
      if (
        !currentUserId ||
        event.key !== getAdminSessionSecurityStorageKey(currentUserId) ||
        !event.newValue
      ) {
        return;
      }

      const snapshot = readAdminSessionSecuritySnapshot(currentUserId);
      if (!snapshot) return;
      this.applySessionSecuritySnapshot(snapshot);
      void this.evaluateCurrentSessionSecurity();
    };

    window.addEventListener('pointerdown', recordTrustedActivity, true);
    window.addEventListener('touchstart', recordTrustedActivity, {
      capture: true,
      passive: true,
    });
    window.addEventListener('keydown', recordTrustedActivity, true);
    window.addEventListener('wheel', recordTrustedActivity, {
      capture: true,
      passive: true,
    });
    window.addEventListener('storage', syncFromAnotherTab);
    document.addEventListener('visibilitychange', checkWhenVisible);
    this.sessionSecurityListenersAttached = true;
  }

  private startSessionSecurityTracking(
    snapshot: AdminSessionSecuritySnapshot,
  ) {
    this.stopSessionSecurityTracking();
    this.applySessionSecuritySnapshot(snapshot);
    this.attachSessionSecurityListeners();

    if (typeof window !== 'undefined') {
      this.sessionSecurityTimer = window.setInterval(() => {
        void this.evaluateCurrentSessionSecurity();
      }, 15_000);
    }
  }

  private prepareRestoredSessionSecurity(userId: string) {
    const snapshot =
      readAdminSessionSecuritySnapshot(userId) ||
      createAdminSessionSecuritySnapshot(userId);
    writeAdminSessionSecuritySnapshot(snapshot);
    this.startSessionSecurityTracking(snapshot);
    const status = evaluateAdminSessionSecurity(snapshot);
    if (status === 'idle_locked' && snapshot.lockedAt === null) {
      this.persistSessionSecuritySnapshot(lockAdminSession(snapshot));
    }
    return status;
  }

  private beginFullSessionSecurity(userId: string) {
    const snapshot = createAdminSessionSecuritySnapshot(userId);
    writeAdminSessionSecuritySnapshot(snapshot);
    this.startSessionSecurityTracking(snapshot);
  }

  private async evaluateCurrentSessionSecurity() {
    const currentUserId = this.sessionSecuritySnapshot?.userId;
    const snapshot = currentUserId
      ? readAdminSessionSecuritySnapshot(currentUserId) ||
        this.sessionSecuritySnapshot
      : null;
    if (!snapshot || !this.state.session) return;

    const status = evaluateAdminSessionSecurity(snapshot);
    if (status === 'absolute_expired' || status === 'clock_invalid') {
      await this.expireAbsoluteSession();
      return;
    }

    if (status === 'idle_locked' && snapshot.lockedAt === null) {
      this.persistSessionSecuritySnapshot(lockAdminSession(snapshot));
    }
  }

  private async expireAbsoluteSession() {
    if (this.isExpiringAbsoluteSession) return;
    this.isExpiringAbsoluteSession = true;
    try {
      await this.signOut('انتهت مدة الجلسة القصوى. سجّل الدخول مجددًا.');
    } finally {
      this.isExpiringAbsoluteSession = false;
    }
  }

  public recordSessionActivity() {
    const currentUserId = this.sessionSecuritySnapshot?.userId;
    const snapshot = currentUserId
      ? readAdminSessionSecuritySnapshot(currentUserId) ||
        this.sessionSecuritySnapshot
      : null;
    if (
      !snapshot ||
      !this.state.isAuthenticated ||
      this.state.isSessionLocked ||
      snapshot.lockedAt !== null
    ) {
      if (snapshot && snapshot.lockedAt !== null) {
        this.applySessionSecuritySnapshot(snapshot);
      }
      return;
    }

    const status = evaluateAdminSessionSecurity(snapshot);
    if (status === 'absolute_expired' || status === 'clock_invalid') {
      void this.expireAbsoluteSession();
      return;
    }

    this.persistSessionSecuritySnapshot(
      recordAdminSessionActivity(snapshot),
    );
  }

  private resetSessionState(clearError = true) {
    this.stopSessionSecurityTracking();
    this.state.user = null;
    this.state.session = null;
    this.state.profile = null;
    this.state.roles = [];
    this.state.roleName = null;
    this.state.isAuthenticated = false;
    this.state.mfaRequired = false;
    this.state.mfaFactorId = null;
    this.state.mfaCurrentLevel = null;
    this.state.isSessionLocked = false;
    this.state.absoluteSessionStartedAt = null;
    this.state.lastActivityAt = null;
    this.pendingFullLoginUserId = null;
    this.unlockMfaFactorId = null;
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
        const securityStatus = this.prepareRestoredSessionSecurity(
          initialSession.user.id,
        );
        if (
          securityStatus === 'absolute_expired' ||
          securityStatus === 'clock_invalid'
        ) {
          await this.expireAbsoluteSession();
        } else {
          await this.handleUserSession(initialSession);
        }
      } else {
        this.resetSessionState();
      }

      // 2. Listen to Auth changes
      supabase.auth.onAuthStateChange(async (event, newSession) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (newSession) {
            if (this.authIntent !== null) {
              this.state.session = newSession;
              this.state.user = newSession.user;
              this.notify();
              return;
            }

            if (
              !this.sessionSecuritySnapshot ||
              this.sessionSecuritySnapshot.userId !== newSession.user.id
            ) {
              const securityStatus = this.prepareRestoredSessionSecurity(
                newSession.user.id,
              );
              if (
                securityStatus === 'absolute_expired' ||
                securityStatus === 'clock_invalid'
              ) {
                await this.expireAbsoluteSession();
                return;
              }
            }
            await this.handleUserSession(newSession);
          }
        } else if (event === 'SIGNED_OUT') {
          const signedOutUserId =
            this.state.user?.id || this.sessionSecuritySnapshot?.userId;
          if (signedOutUserId) {
            removeAdminSessionSecuritySnapshot(signedOutUserId);
          }
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
      await supabase.auth.signOut({ scope: 'local' });
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
        await supabase.auth.signOut({ scope: 'local' });
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
      await supabase?.auth.signOut({ scope: 'local' });

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
    // Never warm business data while the local application session is locked.
    if (this.state.isSessionLocked) return;

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
      this.authIntent = 'full-login';
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

      this.pendingFullLoginUserId = data.user.id;

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

      this.beginFullSessionSecurity(data.user.id);
      this.pendingFullLoginUserId = null;
      return { success: true };
    } catch (err: any) {
      console.error('[AuthStore] signIn Exception:', err);
      const arabicError = translateAuthError(err?.message || String(err));
      this.state.authError = arabicError;
      this.notify();
      return { success: false, error: arabicError };
    } finally {
      this.authIntent = null;
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
      this.authIntent = 'full-login';
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

      if (this.pendingFullLoginUserId === data.session.user.id) {
        this.beginFullSessionSecurity(data.session.user.id);
        this.pendingFullLoginUserId = null;
      }
      return { success: true };
    } catch (error) {
      const arabicError = translateMfaError(error);
      this.state.authError = arabicError;
      this.notify();
      return { success: false, error: arabicError };
    } finally {
      this.authIntent = null;
    }
  }

  private async completeSessionUnlock(): Promise<{
    success: boolean;
    error?: string;
  }> {
    const snapshot = this.sessionSecuritySnapshot;
    if (!snapshot) {
      return {
        success: false,
        error: 'تعذر التحقق من مدة الجلسة. سجّل الدخول مجددًا.',
      };
    }

    const status = evaluateAdminSessionSecurity(snapshot);
    if (status === 'absolute_expired' || status === 'clock_invalid') {
      await this.expireAbsoluteSession();
      return {
        success: false,
        error: 'انتهت مدة الجلسة القصوى. سجّل الدخول مجددًا.',
      };
    }

    this.persistSessionSecuritySnapshot(unlockAdminSession(snapshot));
    this.unlockMfaFactorId = null;
    this.state.authError = null;
    this.notify();

    // Locked views are unmounted, which tears down their Realtime listeners.
    // Refresh the shared summaries before remounted views resume their own reads.
    void Promise.allSettled([
      storeEngine.refreshOrdersFromSupabase(),
      storeEngine.refreshProductsFromSupabase(),
      storeEngine.refreshStockNotificationsFromSupabase(),
    ]);

    return { success: true };
  }

  public async unlockSession(): Promise<{ success: boolean; error?: string }> {
    return this.completeSessionUnlock();
  }

  public async reauthenticateForUnlock(
    password: string,
    captchaToken: string,
  ): Promise<{ success: boolean; mfaRequired?: boolean; error?: string }> {
    if (!supabase || !this.state.user?.id || !this.state.user.email) {
      return {
        success: false,
        error: 'انتهت جلسة الحساب. سجّل الدخول مجددًا.',
      };
    }
    const expectedUserId = this.state.user.id;
    const expectedEmail = this.state.user.email;
    this.state.authError = null;
    this.authIntent = 'unlock-reauth';
    this.notify();

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: expectedEmail,
        password,
        options: { captchaToken },
      });
      if (error) {
        const arabicError = translateAuthError(error.message);
        this.state.authError = arabicError;
        this.notify();
        return { success: false, error: arabicError };
      }
      if (!data.session || !data.user || data.user.id !== expectedUserId) {
        await supabase.auth.signOut({ scope: 'local' });
        const mismatchError = 'تغيّرت هوية الجلسة. سجّل الدخول مجددًا.';
        this.resetSessionState(false);
        this.state.authError = mismatchError;
        this.notify();
        return { success: false, error: mismatchError };
      }

      this.state.session = data.session;
      this.state.user = data.user;
      const { data: aalData, error: aalError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError) {
        const arabicError = translateMfaError(aalError);
        this.state.authError = arabicError;
        this.notify();
        return { success: false, error: arabicError };
      }

      if (aalData.currentLevel === 'aal1' && aalData.nextLevel === 'aal2') {
        const { data: factorsData, error: factorsError } =
          await supabase.auth.mfa.listFactors();
        const factor = factorsData?.totp[0];
        if (factorsError || !factor) {
          const arabicError = factorsError
            ? translateMfaError(factorsError)
            : 'تعذر العثور على تطبيق المصادقة المرتبط بهذا الحساب.';
          this.state.authError = arabicError;
          this.notify();
          return { success: false, error: arabicError };
        }

        this.unlockMfaFactorId = factor.id;
        return { success: true, mfaRequired: true };
      }

      return await this.completeSessionUnlock();
    } catch (error) {
      const arabicError = translateAuthError(
        error instanceof Error ? error.message : String(error),
      );
      this.state.authError = arabicError;
      this.notify();
      return { success: false, error: arabicError };
    } finally {
      this.authIntent = null;
    }
  }

  public async verifyUnlockMfa(
    code: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (!supabase || !this.unlockMfaFactorId || !this.state.user?.id) {
      return {
        success: false,
        error: 'لا توجد جلسة تحقق ثنائي نشطة. سجّل الدخول مجددًا.',
      };
    }

    const expectedUserId = this.state.user.id;
    this.authIntent = 'unlock-reauth';
    try {
      await verifyTotpFactor(this.unlockMfaFactorId, code);
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session || data.session.user.id !== expectedUserId) {
        throw error || new Error('تعذر تحديث جلسة الدخول بعد التحقق.');
      }

      this.state.session = data.session;
      this.state.user = data.session.user;
      return await this.completeSessionUnlock();
    } catch (error) {
      const arabicError = translateMfaError(error);
      this.state.authError = arabicError;
      this.notify();
      return { success: false, error: arabicError };
    } finally {
      this.authIntent = null;
    }
  }

  public async cancelMfa(): Promise<void> {
    await this.signOut();
  }

  public async signOut(reason?: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const signedOutUserId =
      this.state.user?.id || this.sessionSecuritySnapshot?.userId;
    let signOutError: string | undefined;
    try {
      if (supabase) {
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) signOutError = translateAuthError(error.message);
      }
    } catch (err) {
      console.error('[AuthStore] signOut Error:', err);
      signOutError = translateAuthError(
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      if (signedOutUserId) {
        removeAdminSessionSecuritySnapshot(signedOutUserId);
      }
      this.resetSessionState();
      this.state.authError = reason || signOutError || null;
      this.notify();
    }

    return signOutError
      ? { success: false, error: signOutError }
      : { success: true };
  }

  public clearError() {
    this.state.authError = null;
    this.notify();
  }
}

export const authStoreEngine = new AuthStoreEngine();

const authStoreActions = {
  signIn: (email: string, password: string, captchaToken: string) =>
    authStoreEngine.signIn(email, password, captchaToken),
  verifyMfa: (code: string) => authStoreEngine.verifyMfa(code),
  cancelMfa: () => authStoreEngine.cancelMfa(),
  refreshCurrentUser: () => authStoreEngine.refreshCurrentUser(),
  recordSessionActivity: () => authStoreEngine.recordSessionActivity(),
  unlockSession: () => authStoreEngine.unlockSession(),
  reauthenticateForUnlock: (password: string, captchaToken: string) =>
    authStoreEngine.reauthenticateForUnlock(password, captchaToken),
  verifyUnlockMfa: (code: string) => authStoreEngine.verifyUnlockMfa(code),
  signOut: () => authStoreEngine.signOut(),
  clearError: () => authStoreEngine.clearError(),
};

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
    ...authStoreActions,
  };
}
