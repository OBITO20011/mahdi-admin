import {isSupabaseConfigured, supabase} from '../lib/supabase';
import {isRunningStandalone} from '../pwa/pwa';

const WEB_PUSH_PUBLIC_KEY =
  'BIU0z5WvGLOyNT8RN96oTfnVa_Caw7dawr-4Ng6x6mHtj7NV9az-hl4BDKdENBSGbto0pKnOtSPd_kZI3KNDQzc';

export interface PushNotificationState {
  supported: boolean;
  requiresInstall: boolean;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
  activeDeviceCount: number;
}

export const urlBase64ToUint8Array = (value: string): Uint8Array => {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const decoded = window.atob(base64);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
};

const hasPushApis = () =>
  typeof window !== 'undefined' &&
  window.isSecureContext &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export async function getPushNotificationState(): Promise<PushNotificationState> {
  const supported = hasPushApis();
  if (!supported) {
    return {
      supported: false,
      requiresInstall: !isRunningStandalone(),
      permission: 'unsupported',
      subscribed: false,
      activeDeviceCount: 0,
    };
  }

  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = registration
    ? await registration.pushManager.getSubscription()
    : null;
  let activeDeviceCount = 0;

  if (isSupabaseConfigured && supabase) {
    const {data} = await supabase.rpc('get_push_subscription_status');
    activeDeviceCount = Number(data?.active_device_count) || 0;
  }

  return {
    supported: true,
    requiresInstall: false,
    permission: Notification.permission,
    subscribed: Boolean(subscription),
    activeDeviceCount,
  };
}

export async function enableOrderPushNotifications(): Promise<{
  success: boolean;
  message: string;
}> {
  if (!hasPushApis()) {
    return {
      success: false,
      message: isRunningStandalone()
        ? 'هذا الجهاز لا يدعم إشعارات Web Push.'
        : 'ثبّت التطبيق على الشاشة الرئيسية وافتحه من الأيقونة أولاً.',
    };
  }
  if (!isSupabaseConfigured || !supabase) {
    return {success: false, message: 'اتصال Supabase غير مهيأ.'};
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return {
      success: false,
      message: 'لم يتم السماح بالإشعارات. يمكنك تفعيلها من إعدادات iPhone.',
    };
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  let createdSubscription = false;

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(WEB_PUSH_PUBLIC_KEY),
    });
    createdSubscription = true;
  }

  const serialized = subscription.toJSON();
  const endpoint = serialized.endpoint;
  const p256dh = serialized.keys?.p256dh;
  const authKey = serialized.keys?.auth;

  if (!endpoint || !p256dh || !authKey) {
    if (createdSubscription) await subscription.unsubscribe();
    return {success: false, message: 'تعذر قراءة بيانات اشتراك الجهاز.'};
  }

  const {data, error} = await supabase.rpc('save_push_subscription', {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth_key: authKey,
    p_user_agent: navigator.userAgent,
    p_device_label: isRunningStandalone()
      ? 'iPhone / تطبيق الشاشة الرئيسية'
      : 'متصفح ويب',
  });

  if (error) {
    if (createdSubscription) await subscription.unsubscribe();
    return {success: false, message: error.message};
  }

  return {
    success: true,
    message: data?.message || 'تم تفعيل إشعارات الطلبات على هذا الجهاز.',
  };
}

export async function disableOrderPushNotifications(): Promise<{
  success: boolean;
  message: string;
}> {
  if (!hasPushApis() || !supabase) {
    return {success: false, message: 'إشعارات الجهاز غير متاحة.'};
  }

  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = registration
    ? await registration.pushManager.getSubscription()
    : null;

  if (!subscription) {
    return {success: true, message: 'الإشعارات متوقفة على هذا الجهاز.'};
  }

  const {data, error} = await supabase.rpc('disable_push_subscription', {
    p_endpoint: subscription.endpoint,
  });
  if (error) return {success: false, message: error.message};

  await subscription.unsubscribe();
  return {
    success: true,
    message: data?.message || 'تم إيقاف إشعارات الطلبات على هذا الجهاز.',
  };
}
