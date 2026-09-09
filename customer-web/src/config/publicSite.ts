const configuredOrigin = import.meta.env.VITE_PUBLIC_SITE_ORIGIN?.trim();

export const PUBLIC_STOREFRONT_ORIGIN = (
  configuredOrigin || 'https://alnawasreh.com'
).replace(/\/+$/, '');

export function getPublicStorefrontUrl(path: string): string {
  return new URL(path, `${PUBLIC_STOREFRONT_ORIGIN}/`).toString();
}
