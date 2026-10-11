/**
 * Nawasrah Business Manager - iOS iPhone Frame Wrapper & Container
 */

import React, { useCallback, useEffect, useState } from 'react';
import {FormFields, UiButton} from '../ui';
import {
  shallowEqual,
  useAppStoreActions,
  useAppStoreSelector,
} from '../../stores/useAppStore';
import { useAuthStore } from '../../stores/useAuthStore';
import {isRunningStandalone} from '../../pwa/pwa';
import { SUPABASE_PUBLIC_CONFIG } from '../../config/supabase-public-config';
import { TurnstileWidget } from '../../features/auth/TurnstileWidget';
import {
  Wifi,
  Battery,
  ShieldCheck,
  Scan,
  RefreshCw,
  KeyRound,
  ChevronRight,
  Eye,
  EyeOff,
  Mail,
  LockKeyhole,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AdminToast } from './AdminToast';

interface IPhoneContainerProps {
  children: React.ReactNode;
}

export const IPhoneContainer: React.FC<IPhoneContainerProps> = ({ children }) => {
  const {
    isLockedWithFaceId,
    isBiometricsEnabled,
    currentUserEmail,
    toast,
  } = useAppStoreSelector(
    (state) => ({
      isLockedWithFaceId: state.isLockedWithFaceId,
      isBiometricsEnabled: state.isBiometricsEnabled,
      currentUserEmail: state.currentUser.email,
      toast: state.toast,
    }),
    shallowEqual
  );
  const { unlockFaceId, clearFaceIdLockForPasswordSignIn } =
    useAppStoreActions();
  const {
    user: authenticatedUser,
    isSessionLocked,
    unlockSession,
    reauthenticateForUnlock,
    verifyUnlockMfa,
    authError,
    clearError,
  } = useAuthStore();
  const isApplicationLocked = Boolean(authenticatedUser) &&
    (isSessionLocked || isLockedWithFaceId);
  const canUseBiometricUnlock = Boolean(
    authenticatedUser?.id && isBiometricsEnabled,
  );

  const [isFrameMode, setIsFrameMode] = useState<boolean>(() =>
    typeof window === 'undefined'
      ? false
      : new URLSearchParams(window.location.search).get('preview') === 'phone' &&
        !window.matchMedia('(max-width: 767px)').matches && !isRunningStandalone(),
  );
  const [isVerifyingBiometric, setIsVerifyingBiometric] = useState(false);
  const [unlockMethod, setUnlockMethod] = useState<'biometric' | 'password'>(
    'biometric',
  );
  const [passwordEmail, setPasswordEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isVerifyingPassword, setIsVerifyingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordCaptchaToken, setPasswordCaptchaToken] = useState('');
  const [passwordCaptchaResetKey, setPasswordCaptchaResetKey] = useState(0);
  const [passwordMfaCode, setPasswordMfaCode] = useState('');
  const [isPasswordMfaPending, setIsPasswordMfaPending] = useState(false);

  const handleBiometricUnlock = async () => {
    setIsVerifyingBiometric(true);
    setPasswordError(null);
    try {
      const deviceVerified = await unlockFaceId();
      if (!deviceVerified) return;

      const result = await unlockSession();
      if (!result.success) {
        setPasswordError(result.error || 'تعذر فتح الجلسة. سجّل الدخول مجددًا.');
      }
    } finally {
      setIsVerifyingBiometric(false);
    }
  };

  const showPasswordUnlock = () => {
    clearError();
    setPasswordError(null);
    setPassword('');
    setPasswordCaptchaToken('');
    setPasswordMfaCode('');
    setIsPasswordMfaPending(false);
    setPasswordEmail(authenticatedUser?.email || currentUserEmail || '');
    setUnlockMethod('password');
  };

  const showBiometricUnlock = useCallback(() => {
    clearError();
    setPasswordError(null);
    setPassword('');
    setPasswordCaptchaToken('');
    setPasswordMfaCode('');
    setIsPasswordMfaPending(false);
    setShowPassword(false);
    setUnlockMethod('biometric');
  }, [clearError]);

  const handlePasswordUnlock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isVerifyingPassword) return;

    setPasswordError(null);
    clearError();

    if (!password) {
      setPasswordError('أدخل كلمة المرور للمتابعة.');
      return;
    }
    if (!passwordCaptchaToken) {
      setPasswordError('أكمل التحقق البشري الآمن قبل المتابعة.');
      return;
    }

    setIsVerifyingPassword(true);
    try {
      const result = await reauthenticateForUnlock(
        password,
        passwordCaptchaToken,
      );
      if (!result.success) {
        setPasswordError(result.error || 'تعذر التحقق من بيانات الدخول.');
        return;
      }

      if (result.mfaRequired) {
        setIsPasswordMfaPending(true);
        setPasswordMfaCode('');
        return;
      }

      clearFaceIdLockForPasswordSignIn();
      setPassword('');
      setUnlockMethod('biometric');
    } finally {
      setPasswordCaptchaToken('');
      setPasswordCaptchaResetKey((current) => current + 1);
      setIsVerifyingPassword(false);
    }
  };

  const handlePasswordMfaUnlock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isVerifyingPassword) return;

    if (!/^\d{6}$/.test(passwordMfaCode)) {
      setPasswordError('أدخل رمز تطبيق المصادقة المكوّن من 6 أرقام.');
      return;
    }

    setIsVerifyingPassword(true);
    setPasswordError(null);
    try {
      const result = await verifyUnlockMfa(passwordMfaCode);
      if (!result.success) {
        setPasswordError(result.error || 'تعذر التحقق من رمز المصادقة.');
        return;
      }

      clearFaceIdLockForPasswordSignIn();
      setPassword('');
      setPasswordMfaCode('');
      setIsPasswordMfaPending(false);
      setUnlockMethod('biometric');
    } finally {
      setIsVerifyingPassword(false);
    }
  };

  useEffect(() => {
    const compactViewport = window.matchMedia('(max-width: 767px)');
    const syncRealDeviceViewport = () => {
      if (compactViewport.matches || isRunningStandalone()) {
        setIsFrameMode(false);
      }
    };

    syncRealDeviceViewport();
    compactViewport.addEventListener('change', syncRealDeviceViewport);
    return () => {
      compactViewport.removeEventListener('change', syncRealDeviceViewport);
    };
  }, []);

  useEffect(() => {
    if (!isApplicationLocked) {
      showBiometricUnlock();
      return;
    }

    setPasswordEmail(authenticatedUser?.email || currentUserEmail || '');
    if (!canUseBiometricUnlock) {
      setUnlockMethod('password');
    }
  }, [
    authenticatedUser?.email,
    canUseBiometricUnlock,
    currentUserEmail,
    isApplicationLocked,
    showBiometricUnlock,
  ]);

  return (
    <div
      dir="rtl"
      className="min-h-[100dvh] bg-nw-bg text-nw-text flex flex-col items-center justify-center p-0 md:p-4 lg:p-0 font-sans overflow-x-hidden"
    >
      {/* Main Device Outer Housing */}
      <div
        className={`relative transition-all duration-300 ${
          isFrameMode
            ? 'w-full max-w-[420px] h-[880px] rounded-[54px] border-[10px] border-nw-border bg-nw-surface shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] p-0 overflow-hidden ring-1 ring-nw-border'
            : 'w-full h-[100dvh] bg-nw-surface overflow-hidden md:max-w-[1600px] md:h-[calc(100dvh-2rem)] md:rounded-3xl md:border md:border-nw-border md:shadow-2xl lg:max-w-none lg:h-[100dvh] lg:rounded-none lg:border-0 lg:shadow-none'
        }`}
        style={
          isFrameMode
            ? undefined
            : {
                paddingTop: 'env(safe-area-inset-top)',
                paddingRight: 'env(safe-area-inset-right)',
                paddingBottom: 'env(safe-area-inset-bottom)',
                paddingLeft: 'env(safe-area-inset-left)',
              }
        }
      >
        {/* Dynamic Island / iPhone Notch */}
        {isFrameMode && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-32 h-7 bg-nw-side rounded-full z-50 flex items-center justify-between px-3 text-nw-text pointer-events-none shadow-md">
            <div className="w-2.5 h-2.5 bg-nw-primary rounded-full animate-pulse" />
            <div className="w-3.5 h-3.5 bg-nw-surface-2 rounded-full border border-nw-border flex items-center justify-center">
              <div className="w-1.5 h-1.5 bg-nw-surface rounded-full" />
            </div>
          </div>
        )}

        {/* iOS Top Status Bar */}
        {isFrameMode && <div className="bg-nw-surface text-nw-text px-6 pt-3 pb-1 flex items-center justify-between text-xs font-semibold z-40 select-none border-b border-nw-border">
          <span>9:41</span>
          <div className="flex items-center gap-2">
            <Wifi className="w-3.5 h-3.5 text-nw-muted" />
            <Battery className="w-4 h-4 text-nw-ok" />
          </div>
        </div>}

        {/* Screen Content Wrapper */}
        <div data-ui="admin-screen" className={`relative w-full bg-nw-bg text-nw-text overflow-hidden flex flex-col ${isFrameMode ? 'h-[calc(100%-28px)]' : 'h-full'}`}>
          {!isApplicationLocked && (
            <>
              {children}
              <AdminToast toast={toast} />
            </>
          )}

          {/* Locked sessions do not retain protected Admin content in the DOM. */}
          <AnimatePresence>
            {isApplicationLocked && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-50 bg-nw-bg overflow-y-auto flex flex-col items-center justify-center p-6 text-center"
              >
                {unlockMethod === 'biometric' && canUseBiometricUnlock ? (
                  <>
                    <div className="w-20 h-20 bg-nw-info-bg rounded-full border border-nw-border flex items-center justify-center mb-6 shadow-inner">
                      <Scan className="w-10 h-10 text-nw-info animate-pulse" />
                    </div>
                    <h3 className="text-lg font-bold text-nw-text mb-1">
                      جلسة الإدارة مقفلة
                    </h3>
                    <p className="text-xs text-nw-muted mb-8 max-w-xs leading-relaxed">
                      استخدم Face ID على iPhone أو بصمة الجهاز وWindows Hello
                      للمتابعة.
                    </p>
                    <UiButton variant="plain"
                      type="button"
                      onClick={() => void handleBiometricUnlock()}
                      disabled={isVerifyingBiometric}
                      className="w-full max-w-xs bg-nw-primary hover:bg-nw-primary disabled:cursor-wait disabled:opacity-60 text-nw-on-primary font-bold py-3.5 px-6 rounded-2xl shadow-lg transition active:scale-98 flex items-center justify-center gap-2 text-sm"
                    >
                      {isVerifyingBiometric ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="w-4 h-4" />
                      )}
                      <span>
                        {isVerifyingBiometric
                          ? 'جاري التحقق من الجهاز...'
                          : 'فتح بواسطة بصمة الجهاز'}
                      </span>
                    </UiButton>
                    <UiButton variant="plain"
                      type="button"
                      onClick={showPasswordUnlock}
                      disabled={isVerifyingBiometric}
                      className="mt-3 w-full max-w-xs border border-nw-border bg-nw-surface hover:bg-nw-surface-2 disabled:opacity-60 text-nw-text font-bold py-3.5 px-6 rounded-2xl transition active:scale-98 flex items-center justify-center gap-2 text-sm"
                    >
                      <KeyRound className="w-4 h-4 text-nw-warn" />
                      <span>الدخول بالبريد وكلمة المرور</span>
                    </UiButton>
                  </>
                ) : (
                  <FormFields className="w-full max-w-xs"><form
                    onSubmit={isPasswordMfaPending ? handlePasswordMfaUnlock : handlePasswordUnlock}
                    className="w-full max-w-xs rounded-3xl border border-nw-border bg-nw-surface p-5 text-right shadow-2xl"
                  >
                    {canUseBiometricUnlock && (
                      <UiButton variant="plain"
                        type="button"
                        onClick={showBiometricUnlock}
                        disabled={isVerifyingPassword}
                        className="mb-5 flex items-center gap-1 text-xs font-bold text-nw-info hover:text-nw-info disabled:opacity-50"
                      >
                        <ChevronRight className="h-4 w-4" />
                        <span>الرجوع إلى Face ID</span>
                      </UiButton>
                    )}

                    <div className="mb-5 text-center">
                      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-nw-border bg-nw-warn-bg">
                        <LockKeyhole className="h-7 w-7 text-nw-warn" />
                      </div>
                      <h3 className="text-base font-black text-nw-text">
                        {isPasswordMfaPending ? 'رمز تطبيق المصادقة' : 'الدخول بكلمة المرور'}
                      </h3>
                      <p className="mt-1 text-[10px] leading-relaxed text-nw-muted">
                        {isPasswordMfaPending
                          ? 'أكمل العامل الثاني للحساب قبل فتح التطبيق.'
                          : 'تحقق من حساب الموظف نفسه لفتح الجلسة بأمان.'}
                      </p>
                    </div>

                    {(passwordError || authError) && (
                      <div className="mb-4 rounded-2xl border border-nw-border bg-nw-bad-bg p-3 text-[11px] font-semibold leading-relaxed text-nw-bad">
                        {passwordError || authError}
                      </div>
                    )}

                    {!isPasswordMfaPending && <><label htmlFor="unlock-email" className="mb-1.5 block text-[11px] font-bold text-nw-muted">
                      البريد الإلكتروني
                    </label>
                    <div className="relative mb-4">
                      <input
                        id="unlock-email"
                        type="email"
                        value={passwordEmail}
                        readOnly
                        dir="ltr"
                        className="w-full rounded-2xl border border-nw-border bg-nw-bg px-3.5 py-3 pl-10 text-xs text-nw-muted outline-none"
                      />
                      <Mail className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-nw-muted" />
                    </div>

                    <label htmlFor="unlock-password" className="mb-1.5 block text-[11px] font-bold text-nw-muted">
                      كلمة المرور
                    </label>
                    <div className="relative mb-5">
                      <input
                        id="unlock-password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        disabled={isVerifyingPassword}
                        autoFocus
                        autoComplete="current-password"
                        dir="ltr"
                        placeholder="••••••••"
                        className="w-full rounded-2xl border border-nw-border bg-nw-bg px-3.5 py-3 pl-10 text-xs text-nw-text outline-none transition focus:border-nw-border disabled:opacity-50"
                      />
                      <UiButton variant="plain"
                        type="button"
                        onClick={() => setShowPassword((visible) => !visible)}
                        className="absolute left-0 top-0 h-11 w-11 p-0 text-nw-muted hover:text-nw-text"
                        aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </UiButton>
                    </div>

                    <TurnstileWidget
                      siteKey={SUPABASE_PUBLIC_CONFIG.TURNSTILE_SITE_KEY}
                      resetKey={passwordCaptchaResetKey}
                      onVerify={(token) => {
                        setPasswordCaptchaToken(token);
                        if (token) setPasswordError(null);
                      }}
                      onUnavailable={(message) => setPasswordError(message)}
                    /></>}

                    {isPasswordMfaPending && (
                      <input
                        aria-label="رمز تطبيق المصادقة"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={passwordMfaCode}
                        onChange={(event) =>
                          setPasswordMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                        }
                        placeholder="000000"
                        dir="ltr"
                        autoFocus
                        className="mb-5 w-full rounded-2xl border border-nw-border bg-nw-bg px-4 py-3 text-center font-mono text-2xl font-black tracking-[0.35em] text-nw-text outline-none focus:border-nw-border"
                      />
                    )}

                    <UiButton variant="plain"
                      type="submit"
                      disabled={
                        isVerifyingPassword ||
                        (isPasswordMfaPending
                          ? passwordMfaCode.length !== 6
                          : !passwordCaptchaToken)
                      }
                      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-nw-primary px-6 py-3.5 text-sm font-bold text-nw-on-primary shadow-lg transition hover:bg-nw-primary disabled:cursor-wait disabled:opacity-60"
                    >
                      {isVerifyingPassword ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <KeyRound className="h-4 w-4" />
                      )}
                      <span>
                        {isVerifyingPassword
                          ? 'جاري التحقق...'
                          : isPasswordMfaPending
                          ? 'تأكيد الرمز وفتح التطبيق'
                          : 'فتح التطبيق'}
                      </span>
                    </UiButton>
                  </form></FormFields>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* iOS Home Indicator Bar */}
        {isFrameMode && (
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-32 h-1 bg-nw-surface-2 rounded-full z-50 pointer-events-none" />
        )}
      </div>
    </div>
  );
};
