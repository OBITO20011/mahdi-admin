import React, { useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { SUPABASE_PUBLIC_CONFIG } from '../../config/supabase-public-config';
import { TurnstileWidget } from './TurnstileWidget';
import {
  Lock,
  Mail,
  Eye,
  EyeOff,
  ShieldCheck,
  LogIn,
  Loader2,
  Building2,
  Smartphone,
  ArrowRight,
} from 'lucide-react';

export const LoginView: React.FC = () => {
  const {
    signIn,
    verifyMfa,
    cancelMfa,
    mfaRequired,
    authError,
    clearError,
  } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (!email.trim()) {
      setLocalError('يرجى إدخال البريد الإلكتروني');
      return;
    }

    if (!password) {
      setLocalError('يرجى إدخال كلمة المرور');
      return;
    }

    if (!captchaToken) {
      setLocalError('أكمل التحقق البشري الآمن قبل تسجيل الدخول.');
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await signIn(email, password, captchaToken);
      if (!res.success) {
        setLocalError(res.error || 'تعذر تسجيل الدخول. تحقق من البيانات المدخلة.');
      }
    } catch (err: any) {
      setLocalError('حدث خطأ أثناء الاتصال بالنظام. حاول مرة أخرى.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (!/^\d{6}$/.test(mfaCode)) {
      setLocalError('أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await verifyMfa(mfaCode);
      if (!result.success) {
        setLocalError(result.error || 'تعذر التحقق من الرمز.');
      }
    } catch {
      setLocalError('تعذر الاتصال بخادم المصادقة. حاول مرة أخرى.');
    } finally {
      setCaptchaToken('');
      setCaptchaResetKey((current) => current + 1);
      setIsSubmitting(false);
    }
  };

  const handleMfaBack = async () => {
    setIsSubmitting(true);
    setMfaCode('');
    setLocalError(null);
    clearError();
    await cancelMfa();
    setIsSubmitting(false);
  };

  const displayError = localError || authError;

  return (
    <div dir="rtl" className="min-h-full flex flex-col justify-center px-4 py-8 bg-slate-950 text-slate-100 select-none">
      <div className="w-full max-w-sm mx-auto space-y-6">
        {/* App Logo & Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 via-blue-500 to-indigo-600 text-white shadow-xl shadow-blue-500/20 border border-blue-400/30 mb-1">
            <Building2 className="w-8 h-8" />
          </div>

          <h1 className="text-xl font-black text-white tracking-tight">
            نواصرة للمحاسبة وإدارة الأعمال
          </h1>
          <p className="text-xs text-slate-400 font-medium">
            النظام السحابي الموحد لإدارة الفروع والمبيعات والمخزون
          </p>
        </div>

        {/* Login Form Container Card */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-2xl space-y-4 backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-blue-400" />
              <span>{mfaRequired ? 'التحقق بخطوتين' : 'تسجيل الدخول للنظام'}</span>
            </span>
            <span className="text-[10px] bg-blue-950/80 text-blue-300 font-mono font-bold px-2 py-0.5 rounded-full border border-blue-800/60">
              Supabase Auth
            </span>
          </div>

          {/* Error Banner */}
          {displayError && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-300 p-3 rounded-2xl text-xs font-medium space-y-1 animate-fadeIn">
              <div className="flex items-center gap-1.5 font-bold text-red-400">
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span>تعذر الدخول</span>
              </div>
              <p className="text-[11px] leading-relaxed text-red-200">{displayError}</p>
            </div>
          )}

          {mfaRequired ? (
            <form onSubmit={handleMfaSubmit} className="space-y-4">
              <div className="rounded-2xl border border-blue-800/70 bg-blue-950/40 p-4 text-center space-y-2">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600/20 text-blue-300">
                  <Smartphone className="h-6 w-6" />
                </div>
                <h2 className="text-sm font-black text-white">أكد دخولك من تطبيق المصادقة</h2>
                <p className="text-[11px] leading-relaxed text-slate-400">
                  افتح Google Authenticator أو Microsoft Authenticator وأدخل الرمز الحالي.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-300">
                  رمز التحقق المكوّن من 6 أرقام
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={mfaCode}
                  onChange={(event) =>
                    setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  disabled={isSubmitting}
                  placeholder="000000"
                  dir="ltr"
                  autoFocus
                  className="w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-center font-mono text-2xl font-black tracking-[0.35em] text-slate-100 placeholder:text-slate-700 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting || mfaCode.length !== 6}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-3 text-xs font-bold text-white shadow-lg shadow-blue-600/30 transition hover:bg-blue-500 disabled:opacity-50"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                <span>{isSubmitting ? 'جاري التحقق...' : 'تأكيد الرمز والدخول'}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleMfaBack()}
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-800/70 py-2.5 text-xs font-bold text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
              >
                <ArrowRight className="h-4 w-4" />
                <span>الرجوع إلى البريد وكلمة المرور</span>
              </button>
            </form>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Field */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-300">
                البريد الإلكتروني
              </label>
              <div className="relative">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isSubmitting}
                  placeholder="admin@nawasrah.com"
                  dir="ltr"
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-3.5 py-2.5 pl-10 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition disabled:opacity-50"
                  required
                />
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3 pointer-events-none" />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-300">
                كلمة المرور
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting}
                  placeholder="••••••••"
                  dir="ltr"
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-3.5 py-2.5 pl-10 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition disabled:opacity-50"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  aria-pressed={showPassword}
                  className="absolute left-3 top-2.5 text-slate-500 hover:text-slate-300 transition"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Remember Me Option */}
            <div className="flex items-center justify-between text-xs pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 accent-blue-600 rounded cursor-pointer"
                />
                <span className="text-[11px] font-medium">تذكر الدخول على هذا الجهاز</span>
              </label>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-400">
                <span>التحقق البشري الآمن</span>
                {captchaToken && <span className="text-emerald-400">تم التحقق ✓</span>}
              </div>
              <TurnstileWidget
                siteKey={SUPABASE_PUBLIC_CONFIG.TURNSTILE_SITE_KEY}
                resetKey={captchaResetKey}
                onVerify={(token) => {
                  setCaptchaToken(token);
                  if (token) setLocalError(null);
                }}
                onUnavailable={(message) => setLocalError(message)}
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting || !captchaToken}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-2xl shadow-lg shadow-blue-600/30 transition active:scale-98 flex items-center justify-center gap-2 disabled:opacity-50 text-xs"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>جاري التحقق وتسجيل الدخول...</span>
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>تسجيل الدخول</span>
                </>
              )}
            </button>
          </form>
          )}
        </div>

        {/* Footer info */}
        <div className="text-center space-y-1 text-[10px] text-slate-400">
          <p className="font-semibold text-slate-400">نظام إدارة المحاسبة والمبيعات الموحد</p>
          <p>جميع الحقوق محفوظة لمؤسسة نواصرة التجارية © 2026</p>
        </div>
      </div>
    </div>
  );
};
