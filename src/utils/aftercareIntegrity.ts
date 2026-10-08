import type {MonitoringDashboard} from '../types/monitoring';

export const AFTERCARE_INTEGRITY_KEY = 'integrity:aftercare:durable-evidence';

export function aftercareIntegrityWarning(
  dashboard: MonitoringDashboard | null,
  now = Date.now(),
): string | null {
  const checks = Array.isArray(dashboard?.checks) ? dashboard.checks : [];
  const check = checks.find(item => item?.key === AFTERCARE_INTEGRITY_KEY);
  const checkedAt = check ? Date.parse(check.checkedAt) : NaN;
  if (!check || !Number.isFinite(checkedAt) || checkedAt > now ||
    now - checkedAt > 24 * 60 * 60 * 1000 || dashboard?.scanErrorCode) {
    return 'تنبيه السلامة: فحص أدلة المرتجعات والاستبدالات غير متاح أو لم يكتمل خلال آخر 24 ساعة. راجع المراقبة قبل اعتماد التقرير.';
  }
  if (check.status !== 'healthy' || check.issueCount !== 0) {
    return 'تنبيه السلامة: فحص أدلة المرتجعات والاستبدالات لم ينجح. راجع المراقبة قبل اعتماد التقرير.';
  }
  return null;
}
