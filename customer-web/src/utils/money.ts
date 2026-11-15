import {DISPLAY_LOCALE} from './displayLocale';
const jodFormatter = new Intl.NumberFormat(DISPLAY_LOCALE, {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

export function formatJod(minorUnits: number): string {
  const safeMinorUnits = Number.isFinite(minorUnits)
    ? Math.max(0, Math.round(minorUnits))
    : 0;
  return `${jodFormatter.format(safeMinorUnits / 1000)} د.أ`;
}
