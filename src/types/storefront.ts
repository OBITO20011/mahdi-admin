export interface StorefrontSettings {
  storeNameAr: string;
  whatsappNumber: string;
  cliqAlias: string;
  ordersEnabled: boolean;
  announcementText: string;
  businessHoursText: string;
  deliveryAreasText: string;
  deliveryEtaText: string;
  exchangePolicyText: string;
  minimumOrder: number;
  insideRamthaDeliveryFee: number;
  outsideRamthaDeliveryFee: number;
  showNewestProducts: boolean;
  showBestSellers: boolean;
  showOffers: boolean;
  showLowStock: boolean;
  updatedAt: string;
}

export type StorefrontSettingsInput = Omit<StorefrontSettings, 'updatedAt'>;
