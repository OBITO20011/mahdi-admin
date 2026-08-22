/**
 * Nawasrah Business Manager - iOS iPhone Frame Wrapper & Container
 */

import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
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
  CheckCircle2,
  XCircle,
  Info,
  KeyRound,
  ChevronRight,
  Eye,
  EyeOff,
  Mail,
  LockKeyhole,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface IPhoneContainerProps {
  children: React.ReactNode;
}

export const IPhoneContainer: React.FC<IPhoneContainerProps> = ({ children }) => {
  const {
    isLockedWithFaceId,
    unlockFaceId,
    clearFaceIdLockForPasswordSignIn,
    currentUser,
    toast,
  } = useAppStore();
  const {
    user: authenticatedUser,
    signIn,
    verifyMfa,
    authError,
    clearError,
  } = useAuthStore();

  const [isFrameMode, setIsFrameMode] = useState<boolean>(() =>
    typeof window === 'undefined'
      ? true
      : !window.matchMedia('(max-width: 767px)').matches &&
        !isRunningStandalone(),
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
    await unlockFaceId();
    setIsVerifyingBiometric(false);
  };

  const showPasswordUnlock = () => {
    clearError();
    setPasswordError(null);
    setPassword('');
    setPasswordCaptchaToken('');
    setPasswordMfaCode('');
    setIsPasswordMfaPending(false);
    setPasswordEmail(authenticatedUser?.email || currentUser.email || '');
    setUnlockMethod('password');
  };

  const showBiometricUnlock = () => {
    clearError();
    setPasswordError(null);
    setPassword('');
    setPasswordCaptchaToken('');
    setPasswordMfaCode('');
    setIsPasswordMfaPending(false);
    setShowPassword(false);
    setUnlockMethod('biometric');
  };

  const handlePasswordUnlock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isVerifyingPassword) return;

    setPasswordError(null);
    clearError();

    if (!passwordEmail.trim() || !password) {
      setPasswordError('أدخل البريد الإلكتروني وكلمة المرور للمتابعة.');
      return;
    }
    if (!passwordCaptchaToken) {
      setPasswordError('أكمل التحقق البشري الآمن قبل المتابعة.');
      return;
    }

    setIsVerifyingPassword(true);
    try {
      const result = await signIn(passwordEmail, password, passwordCaptchaToken);
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
      const result = await verifyMfa(passwordMfaCode);
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
    const useRealDeviceViewport = () => {
      if (compactViewport.matches || isRunningStandalone()) {
        setIsFrameMode(false);
      }
    };

    useRealDeviceViewport();
    compactViewport.addEventListener('change', useRealDeviceViewport);
    return () => {
      compactViewport.removeEventListener('change', useRealDeviceViewport);
    };
  }, []);

  useEffect(() => {
    if (!isLockedWithFaceId) {
      showBiometricUnlock();
    }
  }, [isLockedWithFaceId]);

  return (
    <div
      dir="rtl"
      className="min-h-[100dvh] bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-0 md:p-4 font-sans select-none overflow-x-hidden"
    >
      {/* Main Device Outer Housing */}
      <div
        className={`relative transition-all duration-300 ${
          isFrameMode
            ? 'w-full max-w-[420px] h-[880px] rounded-[54px] border-[10px] border-slate-800 bg-slate-900 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] p-0 overflow-hidden ring-1 ring-slate-700'
            : 'w-full h-[100dvh] bg-slate-900 overflow-hidden md:max-w-4xl md:h-[90vh] md:rounded-3xl md:border md:border-slate-800 md:shadow-2xl'
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
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-32 h-7 bg-black rounded-full z-50 flex items-center justify-between px-3 text-white pointer-events-none shadow-md">
            <div className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-pulse" />
            <div className="w-3.5 h-3.5 bg-slate-800 rounded-full border border-slate-700 flex items-center justify-center">
              <div className="w-1.5 h-1.5 bg-slate-900 rounded-full" />
            </div>
          </div>
        )}

        {/* iOS Top Status Bar */}
        {isFrameMode && <div className="bg-slate-900 text-slate-200 px-6 pt-3 pb-1 flex items-center justify-between text-xs font-semibold z-40 select-none border-b border-slate-800/50">
          <span>9:41</span>
          <div className="flex items-center gap-2">
            <Wifi className="w-3.5 h-3.5 text-slate-300" />
            <Battery className="w-4 h-4 text-emerald-400" />
          </div>
        </div>}

        {/* Screen Content Wrapper */}
        <div className={`relative w-full bg-slate-950 text-slate-100 overflow-hidden flex flex-col ${isFrameMode ? 'h-[calc(100%-28px)]' : 'h-full'}`}>
          {children}

          {/* Toast Notification Container */}
          <AnimatePresence>
            {toast && (
              <motion.div
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                className="absolute top-4 left-4 right-4 z-50 pointer-events-none"
              >
                <div
                  className={`flex items-center gap-3 p-3.5 rounded-2xl shadow-2xl backdrop-blur-md border text-xs font-semibold ${
                    toast.type === 'error'
                      ? 'bg-red-950/95 border-red-800 text-red-200'
                      : toast.type === 'info'
                      ? 'bg-blue-950/95 border-blue-800 text-blue-200'
                      : 'bg-emerald-950/95 border-emerald-800 text-emerald-200'
                  }`}
                >
                  {toast.type === 'error' && <XCircle className="w-5 h-5 text-red-400 shrink-0" />}
                  {toast.type === 'info' && <Info className="w-5 h-5 text-blue-400 shrink-0" />}
                  {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
                  <span className="flex-1">{toast.message}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Face ID Biometric Lock Overlay */}
          <AnimatePresence>
            {isLockedWithFaceId && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-50 bg-slate-950/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center"
              >
                {unlockMethod === 'biometric' ? (
                  <>
                    <div className="w-20 h-20 bg-blue-600/20 rounded-full border border-blue-500/40 flex items-center justify-center mb-6 shadow-inner">
                      <Scan className="w-10 h-10 text-blue-400 animate-pulse" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-100 mb-1">
                      التطبيق مقفل ببصمة الجهاز
                    </h3>
                    <p className="text-xs text-slate-400 mb-8 max-w-xs leading-relaxed">
                      استخدم Face ID على iPhone أو بصمة الجهاز وWindows Hello
                      للمتابعة.
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleBiometricUnlock()}
                      disabled={isVerifyingBiometric}
                      className="w-full max-w-xs bg-blue-600 hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60 text-white font-bold py-3.5 px-6 rounded-2xl shadow-lg transition active:scale-98 flex items-center justify-center gap-2 text-sm"
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
                    </button>
                    <button
                      type="button"
                      onClick={showPasswordUnlock}
                      disabled={isVerifyingBiometric}
                      className="mt-3 w-full max-w-xs border border-slate-700 bg-slate-900/80 hover:bg-slate-800 disabled:opacity-60 text-slate-100 font-bold py-3.5 px-6 rounded-2xl transition active:scale-98 flex items-center justify-center gap-2 text-sm"
                    >
                      <KeyRound className="w-4 h-4 text-amber-400" />
                      <span>الدخول بالبريد وكلمة المرور</span>
                    </button>
                  </>
                ) : (
                  <form
                    onSubmit={isPasswordMfaPending ? handlePasswordMfaUnlock : handlePasswordUnlock}
                    className="w-full max-w-xs rounded-3xl border border-slate-800 bg-slate-900/90 p-5 text-right shadow-2xl"
                  >
                    <button
                      type="button"
                      onClick={showBiometricUnlock}
                      disabled={isVerifyingPassword}
                      className="mb-5 flex items-center gap-1 text-xs font-bold text-blue-300 hover:text-blue-200 disabled:opacity-50"
                    >
                      <ChevronRight className="h-4 w-4" />
                      <span>الرجوع إلى Face ID</span>
                    </button>

                    <div className="mb-5 text-center">
                      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10">
                        <LockKeyhole className="h-7 w-7 text-amber-400" />
                      </div>
                      <h3 className="text-base font-black text-white">
                        {isPasswordMfaPending ? 'رمز تطبيق المصادقة' : 'الدخول بكلمة المرور'}
                      </h3>
                      <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                        {isPasswordMfaPending
                          ? 'أكمل العامل الثاني للحساب قبل فتح التطبيق.'
                          : 'تحقق من حساب الموظف نفسه بدون تعطيل Face ID.'}
                      </p>
                    </div>

                    {(passwordError || authError) && (
                      <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-[11px] font-semibold leading-relaxed text-red-200">
                        {passwordError || authError}
                      </div>
                    )}

                    {!isPasswordMfaPending && <><label className="mb-1.5 block text-[11px] font-bold text-slate-300">
                      البريد الإلكتروني
                    </label>
                    <div className="relative mb-4">
                      <input
                        type="email"
                        value={passwordEmail}
                        readOnly
                        dir="ltr"
                        className="w-full rounded-2xl border border-slate-800 bg-slate-950 px-3.5 py-3 pl-10 text-xs text-slate-300 outline-none"
                      />
                      <Mail className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-500" />
                    </div>

                    <label className="mb-1.5 block text-[11px] font-bold text-slate-300">
                      كلمة المرور
                    </label>
                    <div className="relative mb-5">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        disabled={isVerifyingPassword}
                        autoFocus
                        autoComplete="current-password"
                        dir="ltr"
                        placeholder="••••••••"
                        className="w-full rounded-2xl border border-slate-800 bg-slate-950 px-3.5 py-3 pl-10 text-xs text-white outline-none transition focus:border-blue-500 disabled:opacity-50"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((visible) => !visible)}
                        className="absolute left-3 top-3 text-slate-500 hover:text-slate-300"
                        aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
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
                        className="mb-5 w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-center font-mono text-2xl font-black tracking-[0.35em] text-white outline-none focus:border-blue-500"
                      />
                    )}

                    <button
                      type="submit"
                      disabled={
                        isVerifyingPassword ||
                        (isPasswordMfaPending
                          ? passwordMfaCode.length !== 6
                          : !passwordCaptchaToken)
                      }
                      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg transition hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60"
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
                    </button>
                  </form>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* iOS Home Indicator Bar */}
        {isFrameMode && (
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-32 h-1 bg-slate-500 rounded-full z-50 pointer-events-none" />
        )}
      </div>
    </div>
  );
};
