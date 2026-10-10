import {Card, FormFields, UiButton, formatUiDate} from '../../components/ui';
import React, {useEffect, useMemo, useState} from 'react';
import {Activity, AlertTriangle, CheckCircle2, CircleHelp, RefreshCw, XCircle} from 'lucide-react';
import {getMonitoringDashboard} from '../../services/supabase/monitoring.service';
import type {MonitoringCheck, MonitoringDashboard, MonitoringHealthStatus} from '../../types/monitoring';

const statusMeta: Record<MonitoringHealthStatus, {label: string; className: string; icon: React.ComponentType<{className?: string}>}> = {
  healthy: {label: 'سليم', className: 'border-nw-ok bg-nw-ok-bg text-nw-ok', icon: CheckCircle2},
  warning: {label: 'تنبيه', className: 'border-nw-warn bg-nw-warn-bg text-nw-warn', icon: AlertTriangle},
  critical: {label: 'حرج', className: 'border-nw-bad bg-nw-bad-bg text-nw-bad', icon: XCircle},
  unknown: {label: 'غير معروف', className: 'border-nw-border bg-nw-surface text-nw-text', icon: CircleHelp},
};

const categoryLabels: Record<string, string> = {
  database: 'قاعدة البيانات', inventory: 'المخزون', accounting: 'المحاسبة', orders: 'الطلبات',
  shifts: 'الورديات', automation: 'الأتمتة', performance: 'الأداء', security: 'الأمان',
  runtime: 'أخطاء التشغيل', backup: 'النسخ والاستعادة', infrastructure: 'Docker وn8n', deployment: 'CI والنشر',
};

const groupChecks = (checks: MonitoringCheck[]) => checks.reduce<Record<string, MonitoringCheck[]>>((groups, item) => {
  (groups[item.category] ??= []).push(item);
  return groups;
}, {});

export const MonitoringDashboardModal: React.FC = () => {
  const [dashboard, setDashboard] = useState<MonitoringDashboard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError('');
    try { setDashboard(await getMonitoringDashboard()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'تعذر تحميل حالة المراقبة.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);
  const groups: Record<string, MonitoringCheck[]> = useMemo(
    () => groupChecks(dashboard?.checks ?? []),
    [dashboard],
  );

  if (loading) return <div className="flex min-h-56 items-center justify-center text-sm text-nw-text">جاري قراءة آخر فحوص المراقبة…</div>;
  if (error) return <div className="space-y-4 rounded-2xl border border-nw-bad bg-nw-bad-bg p-5 text-center"><p className="text-sm font-bold text-nw-bad">{error}</p><UiButton variant="plain" type="button" onClick={() => void load()} className="min-h-11 rounded-xl bg-nw-mute-bg px-4 text-xs font-black text-nw-muted">إعادة المحاولة</UiButton></div>;

  const overall = statusMeta[dashboard?.overallStatus ?? 'unknown'];
  const OverallIcon = overall.icon;
  return (
    <FormFields dir="rtl" className="nw-batch5-fields space-y-4">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <span className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-black ${overall.className}`}><OverallIcon className="h-5 w-5" />الحالة العامة: {overall.label}</span>
          <UiButton variant="plain" type="button" onClick={() => void load()} className="flex min-h-11 items-center gap-2 rounded-xl border border-current/20 px-3 text-xs font-bold"><RefreshCw className="h-4 w-4" />تحديث</UiButton>
        </div>
        <p className="mt-2 text-xs text-nw-muted">آخر فحص: {dashboard?.lastScanAt ? formatUiDate(dashboard.lastScanAt, {dateStyle:'medium',timeStyle:'short'}) : 'غير متاح'}</p>
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(Object.keys(statusMeta) as MonitoringHealthStatus[]).map((status) => {
          const meta = statusMeta[status]; const Icon = meta.icon;
          return <div key={status} className={`rounded-xl border p-3 ${meta.className}`}><Icon className="mb-1 h-4 w-4" /><strong className="block text-lg">{dashboard?.counts[status] ?? 0}</strong><span className="text-xs font-bold">{meta.label}</span></div>;
        })}
      </div>

      <div className="space-y-3">
        {(Object.entries(groups) as Array<[string, MonitoringCheck[]]>).map(([category, checks]) => (
          <Card padded={false} key={category}>
            <h3 className="flex items-center gap-2 border-b border-nw-border px-4 py-3 text-xs font-black text-nw-text"><Activity className="h-4 w-4 text-nw-info" />{categoryLabels[category] ?? category}</h3>
            <div className="divide-y divide-nw-border">
              {checks.map((item) => { const meta=statusMeta[item.status]; const Icon=meta.icon; return (
                <div key={item.key} className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0"><p className="break-words text-sm font-bold text-nw-text">{item.summary}</p><p className="mt-1 text-xs text-nw-muted">آخر تحقق: {formatUiDate(item.checkedAt, {dateStyle:'medium',timeStyle:'short'})}</p></div>
                  <span className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-xs font-black ${meta.className}`}><Icon className="h-3 w-3" />{meta.label}{item.issueCount > 0 ? ` · ${item.issueCount}` : ''}</span>
                </div>
              );})}
            </div>
          </Card>
        ))}
      </div>
      <p className="text-center text-xs leading-5 text-nw-muted">اللوحة للقراءة فقط ولا تُجري أي إصلاح تلقائي. التفاصيل الحساسة لا تُعرض هنا.</p>
    </FormFields>
  );
};
