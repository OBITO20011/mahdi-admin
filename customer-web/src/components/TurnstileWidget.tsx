import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

const TURNSTILE_SCRIPT_ID = 'cloudflare-turnstile-script';
const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme: 'light';
      language: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
      'timeout-callback': () => void;
    }
  ): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

interface TurnstileWidgetProps {
  resetSignal: number;
  onTokenChange: (token: string) => void;
  onStatusChange?: (status: TurnstileStatus) => void;
}

export type TurnstileStatus = 'loading' | 'waiting' | 'verified' | 'error';

function configuredSiteKey(): string {
  const value = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim();
  if (value) return value;
  return import.meta.env.DEV ? TURNSTILE_TEST_SITE_KEY : '';
}

export function TurnstileWidget({
  resetSignal,
  onTokenChange,
  onStatusChange,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const callbackRef = useRef(onTokenChange);
  const [status, setStatus] = useState<TurnstileStatus>('loading');
  const [retryNonce, setRetryNonce] = useState(0);

  const updateStatus = useCallback((nextStatus: TurnstileStatus) => {
    setStatus(nextStatus);
    onStatusChange?.(nextStatus);
  }, [onStatusChange]);

  useEffect(() => {
    callbackRef.current = onTokenChange;
  }, [onTokenChange]);

  useEffect(() => {
    const siteKey = configuredSiteKey();
    if (!siteKey) {
      updateStatus('error');
      callbackRef.current('');
      return;
    }

    let cancelled = false;
    let script = document.getElementById(
      TURNSTILE_SCRIPT_ID
    ) as HTMLScriptElement | null;

    const renderWidget = () => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      if (widgetIdRef.current) return;
      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action: 'guest-order',
          theme: 'light',
          language: 'ar',
          callback: (token) => {
            updateStatus('verified');
            callbackRef.current(token);
          },
          'expired-callback': () => {
            updateStatus('waiting');
            callbackRef.current('');
          },
          'timeout-callback': () => {
            updateStatus('waiting');
            callbackRef.current('');
          },
          'error-callback': () => {
            updateStatus('error');
            callbackRef.current('');
          },
        });
        updateStatus('waiting');
      } catch {
        updateStatus('error');
        callbackRef.current('');
      }
    };

    if (window.turnstile) {
      renderWidget();
    } else {
      if (!script) {
        script = document.createElement('script');
        script.id = TURNSTILE_SCRIPT_ID;
        script.src = TURNSTILE_SCRIPT_URL;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', renderWidget);
        script.addEventListener('error', () => {
          if (!cancelled) {
            updateStatus('error');
            callbackRef.current('');
          }
      }, {once: true});
    }

    return () => {
      cancelled = true;
      script?.removeEventListener('load', renderWidget);
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [resetSignal, retryNonce, updateStatus]);

  const retry = () => {
    callbackRef.current('');
    if (!window.turnstile) {
      document.getElementById(TURNSTILE_SCRIPT_ID)?.remove();
    }
    updateStatus('loading');
    setRetryNonce((current) => current + 1);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-black text-slate-700">
        <ShieldCheck className="h-4 w-4 text-emerald-600" />
        تحقق أمني قبل إرسال الطلب
      </div>
      <div ref={containerRef} className="min-h-[65px] overflow-hidden" />
      {status === 'loading' && (
        <p className="mt-2 text-[10px] font-bold text-slate-500" role="status">
          جارٍ تحميل التحقق الأمني…
        </p>
      )}
      {status === 'waiting' && (
        <p className="mt-2 text-[10px] font-bold text-slate-500" role="status">
          جارٍ إكمال التحقق الأمني…
        </p>
      )}
      {status === 'verified' && (
        <p className="mt-2 text-[10px] font-bold text-emerald-700" role="status">
          تم التحقق الأمني وجاهز للإرسال.
        </p>
      )}
      {status === 'error' && (
        <div className="mt-2 flex items-center justify-between gap-3" role="alert">
          <p className="text-[10px] font-bold text-rose-700">
            تعذر تحميل التحقق الأمني. تحقق من الاتصال ثم أعد المحاولة.
          </p>
          <button type="button" onClick={retry} className="min-h-11 shrink-0 rounded-xl border border-rose-200 bg-rose-50 px-3 text-[10px] font-black text-rose-800 transition hover:bg-rose-100">
            إعادة التحقق
          </button>
        </div>
      )}
    </div>
  );
}
