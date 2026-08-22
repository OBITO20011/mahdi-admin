import React, {useEffect, useState} from 'react';
import {
  BellOff,
  BellRing,
  CheckCircle2,
  Loader2,
  Smartphone,
} from 'lucide-react';
import {useAppStore} from '../../stores/useAppStore';
import {
  disableOrderPushNotifications,
  enableOrderPushNotifications,
  getPushNotificationState,
  PushNotificationState,
} from '../../services/pushNotifications.service';

export const PushNotificationControls: React.FC = () => {
  const {setToast} = useAppStore();
  const [state, setState] = useState<PushNotificationState | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const refreshState = async () => {
    setState(await getPushNotificationState());
  };

  useEffect(() => {
    void refreshState();
  }, []);

  const runAction = async (
    action: () => Promise<{success: boolean; message: string}>,
  ) => {
    setIsWorking(true);
    try {
      const result = await action();
      setToast(result.message, result.success ? 'success' : 'info');
      await refreshState();
    } catch (error: any) {
      setToast(error?.message || 'تعذر تنفيذ عملية الإشعارات.', 'error');
    } finally {
      setIsWorking(false);
    }
  };

  if (!state) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
        جاري فحص إشعارات هذا الجهاز...
      </div>
    );
  }

  if (!state.supported) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-950/30 p-3">
        <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
        <div>
          <h4 className="font-black text-amber-200">
            {state.requiresInstall
              ? 'ثبّت التطبيق أولاً على iPhone'
              : 'الإشعارات غير مدعومة على هذا الجهاز'}
          </h4>
          <p className="mt-1 text-[10px] leading-5 text-amber-100/70">
            من Safari اختر مشاركة ← إضافة إلى الشاشة الرئيسية، ثم افتح التطبيق من
            الأيقونة واضغط تفعيل الإشعارات.
          </p>
        </div>
      </div>
    );
  }

  const isEnabled = state.permission === 'granted' && state.subscribed;
  const isDenied = state.permission === 'denied';

  return (
    <div className="space-y-3 rounded-2xl border border-blue-500/20 bg-blue-950/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              isEnabled
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-blue-500/15 text-blue-400'
            }`}
          >
            {isEnabled ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <BellRing className="h-4 w-4" />
            )}
          </div>
          <div>
            <h4 className="font-black text-slate-100">
              {isEnabled
                ? 'إشعارات الطلبات مفعّلة'
                : 'إشعارات الطلبات على iPhone'}
            </h4>
            <p className="mt-1 text-[10px] leading-5 text-slate-400">
              {isDenied
                ? 'الإذن مرفوض. فعّله من إعدادات iPhone ← الإشعارات ← إدارة النواصرة.'
                : isEnabled
                  ? `سيصلك الطلب حتى لو كان التطبيق مغلقًا. الأجهزة المفعلة: ${state.activeDeviceCount}`
                  : 'استلم تنبيهًا فور وصول طلب جديد من موقع الزبائن.'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {isEnabled ? (
          <button
            type="button"
            disabled={isWorking}
            onClick={() => void runAction(disableOrderPushNotifications)}
            className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-950/30 px-3 py-2.5 font-black text-rose-300 transition hover:bg-rose-950/50 disabled:opacity-50"
          >
            <BellOff className="h-3.5 w-3.5" />
            إيقاف الإشعارات على هذا الجهاز
          </button>
        ) : (
          <button
            type="button"
            disabled={isWorking || isDenied}
            onClick={() => void runAction(enableOrderPushNotifications)}
            className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-3 font-black text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isWorking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <BellRing className="h-4 w-4" />
            )}
            تفعيل إشعارات الطلبات
          </button>
        )}
      </div>
    </div>
  );
};
