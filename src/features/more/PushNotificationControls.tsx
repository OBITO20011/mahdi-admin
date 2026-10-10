import {UiButton} from '../../components/ui';
import React, {useEffect, useState} from 'react';
import {
  BellOff,
  BellRing,
  CheckCircle2,
  Loader2,
  Smartphone,
} from 'lucide-react';
import {useAppStoreActions} from '../../stores/useAppStore';
import {
  disableOrderPushNotifications,
  enableOrderPushNotifications,
  getPushNotificationState,
  PushNotificationState,
} from '../../services/pushNotifications.service';

export const PushNotificationControls: React.FC = () => {
  const {setToast} = useAppStoreActions();
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
      <div className="flex items-center gap-2 rounded-xl border border-nw-border bg-nw-surface-2 p-3 text-nw-muted">
        <Loader2 className="h-4 w-4 animate-spin text-nw-info" />
        جاري فحص إشعارات هذا الجهاز...
      </div>
    );
  }

  if (!state.supported) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-nw-warn bg-nw-warn-bg p-3">
        <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-nw-warn" />
        <div>
          <h4 className="font-black text-nw-warn">
            {state.requiresInstall
              ? 'ثبّت التطبيق أولاً على iPhone'
              : 'الإشعارات غير مدعومة على هذا الجهاز'}
          </h4>
          <p className="mt-1 text-xs leading-5 text-nw-warn">
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
    <div className="space-y-3 rounded-2xl border border-nw-info bg-nw-info-bg p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              isEnabled
                ? 'bg-nw-ok-bg text-nw-ok'
                : 'bg-nw-info-bg text-nw-info'
            }`}
          >
            {isEnabled ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <BellRing className="h-4 w-4" />
            )}
          </div>
          <div>
            <h4 className="font-black text-nw-text">
              {isEnabled
                ? 'إشعارات الطلبات مفعّلة'
                : 'إشعارات الطلبات على iPhone'}
            </h4>
            <p className="mt-1 text-xs leading-5 text-nw-muted">
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
          <UiButton variant="plain"
            type="button"
            disabled={isWorking}
            onClick={() => void runAction(disableOrderPushNotifications)}
            className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl border border-nw-bad bg-nw-bad-bg px-3 py-2.5 font-black text-nw-bad transition hover:bg-nw-bad-bg disabled:opacity-50"
          >
            <BellOff className="h-3.5 w-3.5" />
            إيقاف الإشعارات على هذا الجهاز
          </UiButton>
        ) : (
          <UiButton variant="plain"
            type="button"
            disabled={isWorking || isDenied}
            onClick={() => void runAction(enableOrderPushNotifications)}
            className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-nw-primary px-3 py-3 font-black text-nw-on-primary transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isWorking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <BellRing className="h-4 w-4" />
            )}
            تفعيل إشعارات الطلبات
          </UiButton>
        )}
      </div>
    </div>
  );
};
