import React, { useState } from 'react';
import {Card, FormFields, UiButton} from '../../components/ui';
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
    } catch {
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
    try { await cancelMfa(); } finally { setIsSubmitting(false); }
  };

  const displayError = localError || authError;

  return (
    <FormFields dir="rtl" className="min-h-full overflow-y-auto flex flex-col justify-center px-4 py-8 bg-nw-bg text-nw-text select-none">
      <div className="w-full max-w-sm mx-auto space-y-6">
        {/* App Logo & Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-nw-primary text-nw-on-primary shadow-sm mb-1">
            <Building2 className="w-8 h-8" />
          </div>

          <h1 className="text-xl font-black text-nw-text tracking-tight">
            النواصرة
          </h1>
          <p className="text-xs text-nw-muted font-medium">
            النظام السحابي الموحد لإدارة الفروع والمبيعات والمخزون
          </p>
        </div>

        {/* Login Form Container Card */}
        <Card className="space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-nw-border pb-3">
            <span className="text-xs font-bold text-nw-text flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-nw-info" />
              <span>{mfaRequired ? 'التحقق بخطوتين' : 'تسجيل الدخول للنظام'}</span>
            </span>
            <span className="text-[10px] bg-nw-info-bg text-nw-info font-mono font-bold px-2 py-0.5 rounded-full border border-nw-border">
              دخول آمن
            </span>
          </div>

          {/* Error Banner */}
          {displayError && (
            <div className="bg-nw-bad-bg border border-nw-border text-nw-bad p-3 rounded-2xl text-xs font-medium space-y-1 animate-fadeIn">
              <div className="flex items-center gap-1.5 font-bold text-nw-bad">
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span>تعذر الدخول</span>
              </div>
              <p className="text-[11px] leading-relaxed text-nw-bad">{displayError}</p>
            </div>
          )}

          {mfaRequired ? (
            <form onSubmit={handleMfaSubmit} aria-busy={isSubmitting} className="space-y-4">
              <div className="rounded-2xl border border-nw-border bg-nw-info-bg p-4 text-center space-y-2">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-nw-info-bg text-nw-info">
                  <Smartphone className="h-6 w-6" />
                </div>
                <h2 className="text-sm font-black text-nw-text">أكد دخولك من تطبيق المصادقة</h2>
                <p className="text-[11px] leading-relaxed text-nw-muted">
                  افتح Google Authenticator أو Microsoft Authenticator وأدخل الرمز الحالي.
                </p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="login-mfa" className="block text-xs font-bold text-nw-muted">
                  رمز التحقق المكوّن من 6 أرقام
                </label>
                <input
                  id="login-mfa"
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
                  className="w-full rounded-2xl border border-nw-border bg-nw-bg px-4 py-3 text-center font-mono text-2xl font-black tracking-[0.35em] text-nw-text placeholder:text-nw-muted focus:border-nw-border focus:outline-none disabled:opacity-50"
                />
              </div>

              <UiButton variant="plain"
                type="submit"
                disabled={isSubmitting || mfaCode.length !== 6}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-nw-primary py-3 text-xs font-bold text-nw-on-primary shadow-lg  transition hover:bg-nw-primary disabled:opacity-50"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                <span>{isSubmitting ? 'جاري التحقق...' : 'تأكيد الرمز والدخول'}</span>
              </UiButton>

              <UiButton variant="plain"
                type="button"
                onClick={() => void handleMfaBack()}
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-nw-border bg-nw-surface-2 py-2.5 text-xs font-bold text-nw-muted transition hover:bg-nw-surface-2 disabled:opacity-50"
              >
                <ArrowRight className="h-4 w-4" />
                <span>الرجوع إلى البريد وكلمة المرور</span>
              </UiButton>
            </form>
          ) : (
          <form onSubmit={handleSubmit} aria-busy={isSubmitting} className="space-y-4">
            {/* Email Field */}
            <div className="space-y-1.5">
              <label htmlFor="login-email" className="block text-xs font-bold text-nw-muted">
                البريد الإلكتروني
              </label>
              <div className="relative">
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isSubmitting}
                  placeholder="admin@nawasrah.com"
                  dir="ltr"
                  className="w-full bg-nw-bg border border-nw-border rounded-2xl px-3.5 py-2.5 pl-10 text-xs font-mono text-nw-text placeholder:text-nw-muted focus:outline-none focus:border-nw-border transition disabled:opacity-50"
                  required
                />
                <Mail className="w-4 h-4 text-nw-muted absolute left-3 top-3 pointer-events-none" />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <label htmlFor="login-password" className="block text-xs font-bold text-nw-muted">
                كلمة المرور
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting}
                  placeholder="••••••••"
                  dir="ltr"
                  className="w-full bg-nw-bg border border-nw-border rounded-2xl px-3.5 py-2.5 pl-10 text-xs font-mono text-nw-text placeholder:text-nw-muted focus:outline-none focus:border-nw-border transition disabled:opacity-50"
                  required
                />
                <UiButton variant="plain"
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  aria-pressed={showPassword}
                  className="absolute left-0 top-0 h-11 w-11 p-0 text-nw-muted hover:text-nw-text transition"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </UiButton>
              </div>
            </div>

            {/* Remember Me Option */}
            <div className="flex items-center justify-between text-xs pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-nw-muted">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 accent-nw-primary rounded cursor-pointer"
                />
                <span className="text-[11px] font-medium">تذكر الدخول على هذا الجهاز</span>
              </label>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-bold text-nw-muted">
                <span>التحقق البشري الآمن</span>
                {captchaToken && <span className="text-nw-ok">تم التحقق ✓</span>}
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
            <UiButton variant="plain"
              type="submit"
              disabled={isSubmitting || !captchaToken}
              className="w-full bg-nw-primary hover:bg-nw-primary text-nw-on-primary font-bold py-3 rounded-2xl shadow-lg  transition active:scale-98 flex items-center justify-center gap-2 disabled:opacity-50 text-xs"
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
            </UiButton>
          </form>
          )}
        </Card>

        {/* Footer info */}
        <div className="text-center space-y-1 text-[10px] text-nw-muted">
          <p className="font-semibold text-nw-muted">نظام إدارة المحاسبة والمبيعات الموحد</p>
          <p>جميع الحقوق محفوظة لمؤسسة نواصرة التجارية © 2026</p>
        </div>
      </div>
    </FormFields>
  );
};
