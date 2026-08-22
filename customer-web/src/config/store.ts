const viteEnvironment: Record<string, string | undefined> =
  (
    import.meta as ImportMeta & {
      env?: Record<string, string | undefined>;
    }
  ).env ?? {};

// Public business contact only. Deployments can replace it through Vite env.
const DEFAULT_STORE_WHATSAPP_NUMBER = '0772838886';

export const STORE_PUBLIC_CONFIG = {
  WHATSAPP_NUMBER:
    viteEnvironment.VITE_STORE_WHATSAPP_NUMBER?.trim() ||
    DEFAULT_STORE_WHATSAPP_NUMBER,
} as const;

export const DEFAULT_STOREFRONT_SETTINGS = {
  storeNameAr: 'محلات النواصرة',
  whatsappNumber: STORE_PUBLIC_CONFIG.WHATSAPP_NUMBER,
  cliqAlias: '',
  ordersEnabled: true,
  announcementText: 'الأسعار والكميات تُحدّث مباشرة من مخزون محلات النواصرة',
  businessHoursText: 'يُؤكد وقت التجهيز والتوصيل بعد مراجعة الطلب.',
  deliveryAreasText: 'الرمثا وإربد والمناطق المحيطة، وتُؤكد المنطقة مع الإدارة.',
  deliveryEtaText: 'تعتمد على المنطقة وتوفر الأصناف ويؤكدها فريق المتجر.',
  exchangePolicyText: 'تواصل معنا فورًا عند وجود خطأ أو تلف قبل فتح الطرد.',
  minimumOrderInMinorUnits: 0,
  deliveryFeeInMinorUnits: 0,
  insideRamthaDeliveryFeeInMinorUnits: 0,
  outsideRamthaDeliveryFeeInMinorUnits: 0,
  showNewestProducts: true,
  showBestSellers: true,
  showOffers: true,
  showLowStock: true,
  updatedAt: '',
} as const;
