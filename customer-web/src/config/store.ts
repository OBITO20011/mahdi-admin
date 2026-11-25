const viteEnvironment: Record<string, string | undefined> =
  (
    import.meta as ImportMeta & {
      env?: Record<string, string | undefined>;
    }
  ).env ?? {};

// Public shop WhatsApp (owner 25 Nov 2026). Fallback before settings load or when they fail; Vite env may override.
const DEFAULT_STORE_WHATSAPP_NUMBER = '0785857700';

export const STORE_PUBLIC_CONFIG = {
  WHATSAPP_NUMBER:
    viteEnvironment.VITE_STORE_WHATSAPP_NUMBER?.trim() ||
    DEFAULT_STORE_WHATSAPP_NUMBER,
} as const;

export const DEFAULT_STOREFRONT_SETTINGS = {
  storeNameAr: 'النواصرة لتجارة الجملة والمواد الغذائية',
  whatsappNumber: STORE_PUBLIC_CONFIG.WHATSAPP_NUMBER,
  cliqAlias: '',
  ordersEnabled: true,
  announcementText: 'الأسعار والكميات تُحدّث مباشرة من مخزون النواصرة لتجارة الجملة والمواد الغذائية',
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
