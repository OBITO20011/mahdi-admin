import {useEffect} from 'react';
import {StorefrontOffer} from '../types/offers';
import {CatalogCategory, CatalogProduct} from '../types/catalog';
import {getCategoryPath, getProductPath, getStorePagePath, StorePage} from './publicRoutes';

const STORE_NAME = 'محلات النواصرة';
const DEFAULT_DESCRIPTION = 'كتالوج محلات النواصرة لطلبات الجملة من المخزون مباشرة.';

interface StorefrontSeoInput {
  activePage: StorePage;
  category?: CatalogCategory;
  product?: CatalogProduct | null;
  offers?: StorefrontOffer[];
  privateState: boolean;
}

function upsertMeta(attribute: 'name' | 'property', key: string, value: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.append(element);
  }
  element.content = value;
}

function upsertCanonical(url: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!element) {
    element = document.createElement('link');
    element.rel = 'canonical';
    document.head.append(element);
  }
  element.href = url;
}

function upsertStructuredData(value: Record<string, unknown> | null) {
  const id = 'storefront-public-structured-data';
  document.getElementById(id)?.remove();
  if (!value) return;
  const script = document.createElement('script');
  script.id = id;
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(value).replace(/</g, '\\u003c');
  document.head.append(script);
}

function publicUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}

function productSchema(product: CatalogProduct): Record<string, unknown> {
  const offer: Record<string, unknown> = {
    '@type': 'Offer',
    priceCurrency: 'JOD',
    price: (product.salePackagePriceInMinorUnits / 1000).toFixed(3),
    availability: product.isAvailable
      ? 'https://schema.org/InStock'
      : 'https://schema.org/OutOfStock',
    url: publicUrl(getProductPath(product.sku || product.id)),
  };
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.nameAr,
    sku: product.sku,
    description: product.description || `${product.saleUnitNameAr} من ${STORE_NAME}`,
    offers: offer,
  };
  if (/^https:\/\//i.test(product.imageUrl)) schema.image = [product.imageUrl];
  return schema;
}

function offersSchema(offers: StorefrontOffer[]): Record<string, unknown> | null {
  if (offers.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'OfferCatalog',
    name: `عروض ${STORE_NAME}`,
    itemListElement: offers.slice(0, 20).map((offer, index) => ({
      '@type': 'Offer',
      position: index + 1,
      name: offer.code,
      description: offer.description || `عرض ${offer.code}`,
      url: publicUrl('/offers'),
      validFrom: offer.startsAt,
      validThrough: offer.expiresAt,
    })),
  };
}

/** Keeps browser navigation metadata accurate; static build shells cover direct crawls. */
export function useStorefrontSeo({activePage, category, product, offers = [], privateState}: StorefrontSeoInput) {
  useEffect(() => {
    if (privateState) {
      document.title = `${STORE_NAME} | طلبات الجملة`;
      upsertMeta('name', 'robots', 'noindex, nofollow, noarchive');
      upsertStructuredData(null);
      return;
    }

    let title = `${STORE_NAME} | طلبات الجملة`;
    let description = DEFAULT_DESCRIPTION;
    let path = getStorePagePath(activePage);
    let structuredData: Record<string, unknown> | null = null;

    if (product) {
      title = `${product.nameAr} | ${STORE_NAME}`;
      description = product.description || `اطلب ${product.nameAr} بالجملة من ${STORE_NAME}.`;
      path = getProductPath(product.sku || product.id);
      structuredData = productSchema(product);
    } else if (category) {
      title = `${category.nameAr} | ${STORE_NAME}`;
      description = `تصفح أصناف ${category.nameAr} بالجملة من ${STORE_NAME}.`;
      path = getCategoryPath(category.code || category.id);
    } else if (activePage === 'catalog') {
      title = `المنتجات بالجملة | ${STORE_NAME}`;
      description = `تصفح كتالوج منتجات الجملة المتاحة من ${STORE_NAME}.`;
    } else if (activePage === 'offers') {
      title = `العروض | ${STORE_NAME}`;
      description = `العروض العامة المتاحة حاليًا من ${STORE_NAME}.`;
      structuredData = offersSchema(offers);
    }

    const canonical = publicUrl(path);
    document.title = title;
    upsertMeta('name', 'description', description);
    upsertMeta('name', 'robots', 'index, follow, max-image-preview:large');
    upsertMeta('property', 'og:title', title);
    upsertMeta('property', 'og:description', description);
    upsertMeta('property', 'og:url', canonical);
    upsertMeta('name', 'twitter:title', title);
    upsertMeta('name', 'twitter:description', description);
    upsertCanonical(canonical);
    upsertStructuredData(structuredData);
  }, [activePage, category, offers, privateState, product]);
}
