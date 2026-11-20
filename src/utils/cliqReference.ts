/**
 * Owner 2026-11-20: a CliQ reference is optional everywhere. The database still
 * requires a non-empty CliQ reference, so a blank one is recorded as this label
 * and shows as «بدون مرجع» in every receipt and report.
 */
export const CLIQ_NO_REFERENCE = 'بدون مرجع';

export function cliqReferenceForServer(
  method: string | null | undefined,
  reference: string | null | undefined,
): string | null {
  const value = (reference ?? '').trim();
  if (value) return value;
  return method === 'cliq' ? CLIQ_NO_REFERENCE : null;
}
