/**
 * Pure presentation helpers for the Package F UI kit.
 * Money is Jordanian dinar with exactly three decimals (fils).
 */

const jodFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

/** Arabic date/time wording, with the same Latin digits used for money. */
export function formatUiDate(value: Date | string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('ar-JO-u-nu-latn', {
    timeZone: 'Asia/Amman', ...options, numberingSystem: 'latn',
  }).format(typeof value === 'string' ? new Date(value) : value);
}

/** Explicit time-first wording: 08:12 ص, independent of locale part order. */
export function formatUiTime(value: Date | string): string {
  const parts = new Intl.DateTimeFormat('ar-JO-u-nu-latn', {
    timeZone: 'Asia/Amman', hour: '2-digit', minute: '2-digit', hour12: true,
  }).formatToParts(typeof value === 'string' ? new Date(value) : value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('hour')}:${part('minute')} ${part('dayPeriod')}`.trim();
}

/** Formats a dinar amount (e.g. 1284.5) as "1,284.500". */
export function formatJod(amount: number): string {
  if (!Number.isFinite(amount)) return '—';
  // Normalise -0 so a zero balance never renders as "-0.000".
  return jodFormatter.format(amount === 0 ? 0 : amount);
}

/** Formats integer minor units (fils) as dinars: 1284500 → "1,284.500". */
export function formatMinorUnits(minor: number | bigint): string {
  if (typeof minor === 'bigint') {
    const negative = minor < 0n;
    const absolute = negative ? -minor : minor;
    const dinars = absolute / 1000n;
    const fils = (absolute % 1000n).toString().padStart(3, '0');
    const grouped = dinars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${negative ? '-' : ''}${grouped}.${fils}`;
  }
  if (!Number.isSafeInteger(minor)) return '—';
  return formatMinorUnits(BigInt(minor));
}

/** Signed amount for statements: "+92.400" / "−42.000" (U+2212 minus). */
export function formatSignedJod(amount: number): string {
  if (!Number.isFinite(amount)) return '—';
  if (amount === 0) return formatJod(0);
  return `${amount > 0 ? '+' : '−'}${formatJod(Math.abs(amount))}`;
}

export type UiTone = 'ok' | 'warn' | 'bad' | 'info' | 'mute';

/** Tailwind classes for a status pill of the given tone (token based). */
export const toneClasses: Readonly<Record<UiTone, string>> = {
  ok: 'bg-nw-ok-bg text-nw-ok',
  warn: 'bg-nw-warn-bg text-nw-warn',
  bad: 'bg-nw-bad-bg text-nw-bad',
  info: 'bg-nw-info-bg text-nw-info',
  mute: 'bg-nw-mute-bg text-nw-mute',
};

/** Foreground-only class for a tone (bars, numbers, dots). */
export const toneTextClasses: Readonly<Record<UiTone, string>> = {
  ok: 'text-nw-ok',
  warn: 'text-nw-warn',
  bad: 'text-nw-bad',
  info: 'text-nw-info',
  mute: 'text-nw-mute',
};

export const toneFillClasses: Readonly<Record<UiTone, string>> = {
  ok: 'bg-nw-ok',
  warn: 'bg-nw-warn',
  bad: 'bg-nw-bad',
  info: 'bg-nw-info',
  mute: 'bg-nw-mute',
};

/** Clamps a ratio to a CSS percentage string for progress bars. */
export function ratioToPercent(value: number, max: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return '0%';
  const ratio = Math.min(1, Math.max(0, value / max));
  return `${Math.round(ratio * 100)}%`;
}

export type DebtAgeBucket = 'fresh' | 'aging' | 'overdue';

/** Debt-age buckets from the spec (§7): 0–7 days, 8–30 days, over 30. */
export function debtAgeBucket(days: number): DebtAgeBucket {
  if (!Number.isFinite(days) || days <= 7) return 'fresh';
  if (days <= 30) return 'aging';
  return 'overdue';
}

export const debtAgeTone: Readonly<Record<DebtAgeBucket, UiTone>> = {
  fresh: 'ok',
  aging: 'warn',
  overdue: 'bad',
};
