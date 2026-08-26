import React, { useEffect, useRef, useState } from 'react';

interface TurnstileWidgetProps {
  siteKey: string;
  resetKey: number;
  onVerify: (token: string) => void;
  onUnavailable: (message: string) => void;
}

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      appearance?: 'always' | 'execute' | 'interaction-only';
      callback: (token: string) => void;
      'error-callback': () => void;
      'expired-callback': () => void;
      'timeout-callback': () => void;
      language?: string;
      retry?: 'auto' | 'never';
      size?: 'normal' | 'compact' | 'flexible';
      theme?: 'light' | 'dark' | 'auto';
    }
  ) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_ID = 'nawasrah-turnstile-script';
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing || document.createElement('script');

    const handleReady = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('تعذر تحميل خدمة التحقق البشري.'));
    };

    script.addEventListener('load', handleReady, { once: true });
    script.addEventListener(
      'error',
      () => reject(new Error('تعذر الاتصال بخدمة Cloudflare Turnstile.')),
      { once: true }
    );

    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });

  return scriptPromise;
}

export const TurnstileWidget: React.FC<TurnstileWidgetProps> = ({
  siteKey,
  resetKey,
  onVerify,
  onUnavailable,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onVerifyRef = useRef(onVerify);
  const onUnavailableRef = useRef(onUnavailable);
  const [isLoading, setIsLoading] = useState(true);

  onVerifyRef.current = onVerify;
  onUnavailableRef.current = onUnavailable;

  useEffect(() => {
    let cancelled = false;

    void loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;

        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action: 'admin_login',
          appearance: 'always',
          callback: (token) => {
            setIsLoading(false);
            onVerifyRef.current(token);
          },
          'error-callback': () => {
            setIsLoading(false);
            onVerifyRef.current('');
            onUnavailableRef.current('فشل التحقق البشري. حدّث التحقق وحاول مجددًا.');
          },
          'expired-callback': () => {
            onVerifyRef.current('');
            onUnavailableRef.current('انتهت صلاحية التحقق البشري. أعد التحقق للمتابعة.');
          },
          'timeout-callback': () => {
            onVerifyRef.current('');
            onUnavailableRef.current('انتهت مهلة التحقق البشري. حاول مجددًا.');
          },
          language: 'ar',
          retry: 'auto',
          size: 'flexible',
          theme: 'dark',
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setIsLoading(false);
        onVerifyRef.current('');
        onUnavailableRef.current(
          error instanceof Error ? error.message : 'تعذر تحميل التحقق البشري.'
        );
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey]);

  useEffect(() => {
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
      onVerifyRef.current('');
    }
  }, [resetKey]);

  return (
    <div className="relative min-h-[68px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/70 p-1">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950 text-[10px] font-bold text-slate-300">
          جاري تجهيز التحقق الآمن...
        </div>
      )}
      <div ref={containerRef} className="relative z-10 w-full" />
    </div>
  );
};
