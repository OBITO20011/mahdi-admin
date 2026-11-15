/** Display only: Arabic wording, Latin digits, decimal dot and comma grouping. */
export const DISPLAY_LOCALE = 'ar-JO-u-nu-latn';

/** Numeric text already present in a display label; never parse or mutate data. */
export function latinDisplayDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/gu, digit =>
    String(digit.charCodeAt(0) - (digit <= '٩' ? 0x660 : 0x6f0)));
}
