import type {AftercareIntegrityStatus,MonitoringDashboard} from '../types/monitoring';

export const AFTERCARE_INTEGRITY_KEY = 'integrity:aftercare:durable-evidence';

export function aftercareIntegrityWarning(
  dashboard: MonitoringDashboard | AftercareIntegrityStatus | null,
  now = Date.now(),
): string | null {
  const full = dashboard && 'checks' in dashboard ? dashboard : null;
  const checks = Array.isArray(full?.checks) ? full.checks : [];
  const check = checks.find(item => item?.key === AFTERCARE_INTEGRITY_KEY) ??
    (dashboard && 'status' in dashboard ? dashboard : null);
  const checkedAt = check?.checkedAt ? Date.parse(check.checkedAt) : NaN;
  if (!check || !Number.isFinite(checkedAt) || checkedAt > now + 5 * 60 * 1000 ||
    now - checkedAt > 24 * 60 * 60 * 1000 || full?.scanErrorCode) {
    return 'تنبيه السلامة: فحص أدلة المرتجعات والاستبدالات غير متاح أو لم يكتمل خلال آخر 24 ساعة. راجع المراقبة قبل اعتماد التقرير.';
  }
  if (check.status !== 'healthy' || ('issueCount' in check && check.issueCount !== 0)) {
    return 'تنبيه السلامة: فحص أدلة المرتجعات والاستبدالات لم ينجح. راجع المراقبة قبل اعتماد التقرير.';
  }
  return null;
}
