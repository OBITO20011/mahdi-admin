/** Same immutable original path plus a deterministic suffix; old images fall back. */
export function productThumbnailUrl(original: string): string {
  try {
    const url = new URL(original);
    if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash || url.username || url.password || !/\.(?:jpe?g|png|webp)$/iu.test(url.pathname)) return original;
    url.pathname += '-400.webp';
    return url.href;
  } catch { return original; }
}
