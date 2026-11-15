import {DISPLAY_LOCALE} from '../components/ui/uiFormat';
export function formatOperationalOrderContents(
  firstProductName: string,
  itemCount: number
): string {
  const productName = firstProductName.trim();
  const safeItemCount = Math.max(0, Math.floor(itemCount || 0));

  if (!productName) {
    if (safeItemCount === 0) return 'طلب بدون أصناف';
    if (safeItemCount === 1) return 'طلب بصنف واحد';
    return `طلب يحتوي ${safeItemCount.toLocaleString(DISPLAY_LOCALE)} أصناف`;
  }

  const additionalCount = Math.max(0, safeItemCount - 1);
  if (additionalCount === 0) return productName;
  if (additionalCount === 1) return `${productName} + صنف إضافي`;
  if (additionalCount === 2) return `${productName} + صنفان إضافيان`;
  if (additionalCount <= 10) {
    return `${productName} + ${additionalCount.toLocaleString(DISPLAY_LOCALE)} أصناف إضافية`;
  }
  return `${productName} + ${additionalCount.toLocaleString(DISPLAY_LOCALE)} صنفًا إضافيًا`;
}
