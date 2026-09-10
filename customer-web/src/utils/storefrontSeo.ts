import {useEffect} from 'react';
import {StorefrontOffer} from '../types/offers';
import {CatalogCategory, CatalogProduct} from '../types/catalog';
import {getCategoryPath, getProductPath, getStorePagePath, StorePage} from './publicRoutes';
import {getPublicStorefrontUrl} from '../config/publicSite';
import {SEO_BRAND} from '../config/seoBrand';

const STORE_NAME = SEO_BRAND.officialName;
const DEFAULT_DESCRIPTION = SEO_BRAND.homepageDescription;

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

function breadcrumbSchema(items: Array<{name: string; path: string}>) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: publicUrl(item.path),
    })),
  };
}

function pageSchema(type: 'CollectionPage' | 'WebPage', name: string, path: string) {
  return {
    '@type': type,
    '@id': `${publicUrl(path)}#webpage`,
    url: publicUrl(path),
    name,
    inLanguage: SEO_BRAND.language,
    isPartOf: {'@id': `${publicUrl('/')}#website`},
  };
}

function graphSchema(...items: Record<string, unknown>[]): Record<string, unknown> {
  return {'@context': 'https://schema.org', '@graph': items};
}

function homeSchema(): Record<string, unknown> {
  const homepage = publicUrl('/');
  return graphSchema(
    {
      '@type': 'Store',
      '@id': `${homepage}#organization`,
      name: SEO_BRAND.officialName,
      alternateName: SEO_BRAND.alternateName,
      url: homepage,
      logo: {'@type': 'ImageObject', url: publicUrl(SEO_BRAND.defaultImagePath)},
      image: publicUrl(SEO_BRAND.defaultImagePath),
    },
    {
      '@type': 'WebSite',
      '@id': `${homepage}#website`,
      url: homepage,
      name: SEO_BRAND.officialName,
      alternateName: SEO_BRAND.alternateName,
      inLanguage: SEO_BRAND.language,
      publisher: {'@id': `${homepage}#organization`},
    },
  );
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
  return getPublicStorefrontUrl(path);
}

function productSchema(product: CatalogProduct): Record<string, unknown> {
  const productPath = getProductPath(product.sku || product.id);
  const offer: Record<string, unknown> = {
    '@type': 'Offer',
    priceCurrency: 'JOD',
    price: (product.salePackagePriceInMinorUnits / 1000).toFixed(3),
    availability: product.isAvailable
      ? 'https://schema.org/InStock'
      : 'https://schema.org/OutOfStock',
    url: publicUrl(productPath),
  };
  const schema: Record<string, unknown> = {
    '@type': 'Product',
    '@id': `${publicUrl(productPath)}#product`,
    url: publicUrl(productPath),
    name: product.nameAr,
    ...(product.sku ? {sku: product.sku} : {}),
    description: product.description || `${product.saleUnitNameAr} من ${STORE_NAME}`,
    brand: {'@type': 'Organization', name: STORE_NAME},
    offers: offer,
  };
  if (/^https:\/\//i.test(product.imageUrl)) schema.image = [product.imageUrl];
  return graphSchema(
    schema,
    pageSchema('WebPage', product.nameAr, productPath),
    breadcrumbSchema([
      {name: 'الرئيسية', path: '/'},
      {name: 'المنتجات', path: '/products/'},
      {name: product.nameAr, path: productPath},
    ]),
  );
}

function offersSchema(offers: StorefrontOffer[]): Record<string, unknown> {
  const offerCatalog = offers.length > 0
    ? [{
        '@type': 'OfferCatalog',
        name: `عروض ${STORE_NAME}`,
        url: publicUrl('/offers/'),
        itemListElement: offers.slice(0, 20).map((offer, index) => ({
          '@type': 'Offer',
          position: index + 1,
          name: offer.code,
          description: offer.description || `عرض ${offer.code}`,
          url: publicUrl('/offers/'),
          validFrom: offer.startsAt,
          validThrough: offer.expiresAt,
        })),
      }]
    : [];
  return {
    '@context': 'https://schema.org',
    '@graph': [
      ...offerCatalog,
      pageSchema('CollectionPage', 'العروض', '/offers/'),
      breadcrumbSchema([
        {name: 'الرئيسية', path: '/'},
        {name: 'العروض', path: '/offers/'},
      ]),
    ],
  };
}

/** Keeps browser navigation metadata accurate; static build shells cover direct crawls. */
export function useStorefrontSeo({activePage, category, product, offers = [], privateState}: StorefrontSeoInput) {
  useEffect(() => {
    if (privateState) {
      document.title = `${SEO_BRAND.alternateName} | طلبات الجملة`;
      upsertMeta('name', 'robots', 'noindex, nofollow, noarchive');
      upsertStructuredData(null);
      return;
    }

    let title: string = SEO_BRAND.homepageTitle;
    let description: string = DEFAULT_DESCRIPTION;
    let path = getStorePagePath(activePage);
    let structuredData: Record<string, unknown> | null = homeSchema();

    if (product) {
      title = `${product.nameAr} | ${STORE_NAME}`;
      description = product.description || `اطلب ${product.nameAr} بالجملة من ${STORE_NAME}.`;
      path = getProductPath(product.sku || product.id);
      structuredData = productSchema(product);
    } else if (category) {
      title = `${category.nameAr} | ${STORE_NAME}`;
      description = `تصفح أصناف ${category.nameAr} بالجملة من ${STORE_NAME}.`;
      path = getCategoryPath(category.code || category.id);
      structuredData = graphSchema(
        pageSchema('CollectionPage', category.nameAr, path),
        breadcrumbSchema([
          {name: 'الرئيسية', path: '/'},
          {name: 'المنتجات', path: '/products/'},
          {name: category.nameAr, path},
        ]),
      );
    } else if (activePage === 'catalog') {
      title = `المنتجات بالجملة | ${STORE_NAME}`;
      description = `تصفح كتالوج منتجات الجملة المتاحة من ${STORE_NAME}.`;
      structuredData = graphSchema(
        pageSchema('CollectionPage', 'المنتجات بالجملة', '/products/'),
        breadcrumbSchema([
          {name: 'الرئيسية', path: '/'},
          {name: 'المنتجات', path: '/products/'},
        ]),
      );
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
    upsertMeta('property', 'og:type', product ? 'product' : 'website');
    upsertMeta('property', 'og:locale', SEO_BRAND.locale);
    upsertMeta('property', 'og:site_name', STORE_NAME);
    const socialImage = /^https:\/\//i.test(product?.imageUrl || '')
      ? product!.imageUrl
      : publicUrl(SEO_BRAND.defaultImagePath);
    upsertMeta('property', 'og:image', socialImage);
    upsertMeta('property', 'og:image:alt', product?.nameAr || STORE_NAME);
    upsertMeta('name', 'twitter:card', 'summary_large_image');
    upsertMeta('name', 'twitter:title', title);
    upsertMeta('name', 'twitter:description', description);
    upsertMeta('name', 'twitter:image', socialImage);
    upsertCanonical(canonical);
    upsertStructuredData(structuredData);
  }, [activePage, category, offers, privateState, product]);
}
