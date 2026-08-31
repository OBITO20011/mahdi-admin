export type StorePage = 'home' | 'categories' | 'catalog' | 'favorites' | 'offers';

export interface StoreLocationRoute {
  page: StorePage;
  productKey: string;
  categorySlug: string;
  trackingToken: string;
  receiptToken: string;
  isLegacyHash: boolean;
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return '';
  }
}

function readUuidHash(hash: string, name: 'track' | 'receipt'): string {
  const match = hash.match(new RegExp(`^#${name}=([0-9a-f-]{36})$`, 'i'));
  return match?.[1] || '';
}

/** Public catalog routes use paths; legacy hashes remain supported for old shares. */
export function readStoreLocationRoute(location: Pick<Location, 'pathname' | 'hash'>): StoreLocationRoute {
  const pathSegments = location.pathname
    .split('/')
    .filter(Boolean)
    .map(decodeSegment);
  const [firstSegment = '', secondSegment = ''] = pathSegments;

  const base: StoreLocationRoute = {
    page: 'home',
    productKey: '',
    categorySlug: '',
    trackingToken: readUuidHash(location.hash, 'track'),
    receiptToken: readUuidHash(location.hash, 'receipt'),
    isLegacyHash: false,
  };

  if (firstSegment === 'products' && pathSegments.length === 1) {
    return {...base, page: 'catalog'};
  }
  if (firstSegment === 'offers' && pathSegments.length === 1) {
    return {...base, page: 'offers'};
  }
  if (firstSegment === 'category' && secondSegment && pathSegments.length === 2) {
    return {...base, page: 'catalog', categorySlug: secondSegment};
  }
  if (firstSegment === 'product' && secondSegment && pathSegments.length === 2) {
    return {...base, page: 'catalog', productKey: secondSegment};
  }

  if (location.hash === '#categories') return {...base, page: 'categories', isLegacyHash: true};
  if (location.hash === '#catalog') return {...base, page: 'catalog', isLegacyHash: true};
  if (location.hash === '#favorites') return {...base, page: 'favorites', isLegacyHash: true};
  if (location.hash === '#offers') return {...base, page: 'offers', isLegacyHash: true};
  if (location.hash.startsWith('#product=')) {
    return {
      ...base,
      page: 'catalog',
      productKey: decodeSegment(location.hash.slice('#product='.length)),
      isLegacyHash: true,
    };
  }

  return base;
}

export function getStorePagePath(page: StorePage): string {
  switch (page) {
    case 'catalog': return '/products';
    case 'offers': return '/offers';
    // These are private local UI states, deliberately not indexable paths.
    case 'categories': return '/#categories';
    case 'favorites': return '/#favorites';
    default: return '/';
  }
}

export function getProductPath(productKey: string): string {
  return `/product/${encodeURIComponent(productKey.trim())}`;
}

export function getCategoryPath(categorySlug: string): string {
  return `/category/${encodeURIComponent(categorySlug.trim())}`;
}

export function getCategorySlug(category: {code: string; id: string}): string {
  return (category.code || category.id).trim();
}

export function changeStoreLocation(path: string, replace = false): void {
  window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
}
