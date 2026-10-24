// Exact Maps authority contract. Keep the Admin copy byte-identical; parity
// and real SQL cases verify both applications against the same finite hosts.
const mapsHosts = new Set(['maps.app.goo.gl', 'goo.gl', 'maps.google.com', 'google.com', 'www.google.com']);
export function validMapCoordinates(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === 'number' && typeof longitude === 'number' &&
    Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}
export function isSupportedGoogleMapsUrl(value: string): boolean {
  const raw = value.trim();
  if (!raw || raw.length > 1000 || Array.from(raw).some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) return false;
  try {
    const authority = raw.match(/^https:\/\/([^/?#]+)(?:[/?#]|$)/iu)?.[1].toLowerCase();
    if (!authority || !mapsHosts.has(authority)) return false;
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    if (authority === 'maps.app.goo.gl' || authority === 'maps.google.com') return true;
    return /^\/maps(?:\/|$)/iu.test(url.pathname);
  } catch { return false; }
}
export function safeGoogleMapsUrl(value: unknown, latitude?: unknown, longitude?: unknown): string | undefined {
  if (validMapCoordinates(latitude, longitude)) {
    return `https://www.google.com/maps?q=${(latitude as number).toFixed(6)},${(longitude as number).toFixed(6)}`;
  }
  return typeof value === 'string' && isSupportedGoogleMapsUrl(value) ? value.trim() : undefined;
}
