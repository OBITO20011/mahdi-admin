import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
  type Route,
} from '@playwright/test';

const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);
const isolatedSupabaseOrigin = 'http://127.0.0.1:4176';

const isolatedApiResponse = (route: Route) => {
  const url = new URL(route.request().url());
  const path = url.pathname;
  if (path.endsWith('/get_public_storefront_settings')) {
    return route.fulfill({ json: {
      storeNameAr: 'متجر الاختبار', ordersEnabled: true,
      minimumOrderInMinorUnits: 0, deliveryFeeInMinorUnits: 0,
      insideRamthaDeliveryFeeInMinorUnits: 0,
      outsideRamthaDeliveryFeeInMinorUnits: 0,
      showNewestProducts: false, showBestSellers: false,
      showOffers: false, showLowStock: false,
    } });
  }
  if (path.endsWith('/get_public_storefront_catalog_page')) {
    return route.fulfill({ json: {
      items: [], categories: [], brands: [], saleUnits: [],
      summary: { availableProducts: 0, availableSalePackages: 0, lowStockProducts: 0 },
      total: 0, limit: 24, offset: 0,
    } });
  }
  if (path.endsWith('/get_public_storefront_merchandising')) {
    return route.fulfill({ json: {
      newest: [], bestSellers: [], offers: [], lowStock: [],
    } });
  }
  if (path.endsWith('/get_public_storefront_offers')) {
    return route.fulfill({ json: [] });
  }
  if (path.startsWith('/auth/')) {
    return route.fulfill({ status: 401, json: { message: 'isolated unauthenticated session' } });
  }
  if (path.startsWith('/rest/')) {
    return route.fulfill({ json: [] });
  }
  return route.fulfill({ status: 404, json: { error: 'unconfigured isolated endpoint' } });
};

export const isLoopbackBrowserUrl = (rawUrl: string): boolean => {
  const url = new URL(rawUrl);
  return ['about:', 'blob:', 'data:'].includes(url.protocol)
    || loopbackHosts.has(url.hostname.toLowerCase());
};

export const assertLoopbackTestTarget = (rawUrl: string, label: string): URL => {
  const url = new URL(rawUrl);
  if (!loopbackHosts.has(url.hostname.toLowerCase())) {
    throw new Error(`${label} must use a loopback test target, received ${url.origin}`);
  }
  return url;
};

export const test = base.extend<{ productionNetworkIsolation: void }>({
  productionNetworkIsolation: [async ({ context }, use, testInfo) => {
    const blockedRequests: string[] = [];

    await context.addInitScript(() => {
      const testWindow = window as typeof window & {
        turnstile?: {
          render: (_container: unknown, options: { callback?: (token: string) => void }) => string;
          reset: () => void;
          remove: () => void;
        };
      };
      testWindow.turnstile ??= {
        render: (_container, _options) => {
          return 'isolated-browser-widget';
        },
        reset: () => undefined,
        remove: () => undefined,
      };
      testWindow.open = () => null;
    });

    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === isolatedSupabaseOrigin) {
        await isolatedApiResponse(route);
        return;
      }
      if (isLoopbackBrowserUrl(request.url())) {
        await route.continue();
        return;
      }

      blockedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort('blockedbyclient');
    });

    await use();

    expect(
      blockedRequests,
      `Browser QA attempted non-loopback network access in ${testInfo.titlePath.join(' > ')}`,
    ).toEqual([]);
  }, { auto: true }],
});

export { expect };
export type { BrowserContext, Page, Route };
